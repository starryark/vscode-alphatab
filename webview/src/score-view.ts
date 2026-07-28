import { at, AlphaTabApi } from './alphatab-global';
import type { ScoreAddress, RenderSettings, PlayerSettings, Side, BarRange } from '../../src/protocol';

/**
 * 一个 AlphaTabApi 实例的封装。
 *
 * 这里是整个改造里性能收益最大的一处。旧代码每次收到文档变更都：
 *   destroy() → new AlphaTabApi() → 重新加载音色库
 * 也就是说在 100ms 防抖之后，每次敲键盘都要把音色库重新取一遍、重新解码一遍。
 * 配上 92 MB 的原声吉他音色库，编辑体验直接崩掉，而且滚动位置、播放位置、
 * 缩放全部丢失。
 *
 * 现在实例只建一次，内容更新一律走 api.tex()——alphaTab 提供这个方法就是干这个的。
 */

export interface ScoreViewCallbacks {
    onNoteSelect(side: Side, address: ScoreAddress): void;
    onError(message: string, fatal: boolean): void;
    onStateChanged(): void;
}

/** 把 alphaTab 模型里的 beat / note 换算成协议里的地址。 */
function addressOfBeat(beat: any, noteIndex?: number): ScoreAddress {
    const bar = beat.voice.bar;
    const staff = bar.staff;
    return {
        track: staff.track.index,
        staff: staff.index,
        voice: beat.voice.index,
        bar: bar.index,
        beat: beat.index,
        note: noteIndex
    };
}

export class ScoreView {
    private api: AlphaTabApi | undefined;
    private soundFontUri = '';
    private lastTex = '';
    private rendered = false;

    barCount = 0;
    currentBar = 1;
    state: 'paused' | 'playing' = 'paused';
    position = 0;
    duration = 0;
    looping = false;
    loopRange: BarRange | null = null;

    constructor(
        readonly side: Side,
        private readonly element: HTMLElement,
        private readonly callbacks: ScoreViewCallbacks
    ) {}

    get isCreated(): boolean {
        return this.api !== undefined;
    }

    // 注意：outputMode 只在这里生效一次。切换 ScriptProcessor / AudioWorklet
    // 需要重建整个 api，所以改那条设置要重开预览面板。
    create(tex: string, render: RenderSettings, player: PlayerSettings, scriptFile: string | undefined): void {
        this.soundFontUri = player.soundFontUri;
        this.lastTex = tex;

        // alphaTab 在 core.tex 为 true 时读的是 element.textContent。
        // 千万不要用 innerHTML——那等于把谱面源码当 HTML 解析。
        this.element.textContent = tex;

        const settings: any = {
            core: {
                tex: true,
                // 渲染必须留在主线程：webview 里的 worker 没法 importScripts
                // 那个跨源的 vscode-cdn.net 地址（alphaTab 会自己去猜这个地址）。
                useWorkers: false
            },
            display: {
                staveProfile: render.staveProfile,
                layoutMode: render.layoutMode,
                scale: render.scale
            },
            notation: {
                rhythmMode: 'showwithbars'
            },
            player: {
                playerMode: at.PlayerMode.EnabledSynthesizer,
                soundFont: player.soundFontUri,
                scrollElement: this.element.parentElement ?? this.element,
                scrollMode: at.ScrollMode.Continuous,
                enableCursor: true,
                enableUserInteraction: true
            }
        };

        if (render.displayTranspose !== 0) {
            settings.display.transpositionPitches = [render.displayTranspose];
        }

        if (scriptFile) {
            // 合成器**必须**跑在 worker 里，而 worker 只能加载同源脚本，
            // 所以给它一个由主线程 fetch 出来、包成 blob 的同源副本。
            settings.core.scriptFile = scriptFile;
            settings.player.outputMode = player.outputMode === 'audioWorklet'
                ? at.PlayerOutputMode.WebAudioAudioWorklets
                : at.PlayerOutputMode.WebAudioScriptProcessor;
        } else {
            // blob 没准备好就没有播放器。以前这里是静默失败（只 console.warn 一句），
            // 用户只会看到播放按钮点了没反应。
            settings.player.playerMode = at.PlayerMode.Disabled;
            this.callbacks.onError('播放不可用：alphaTab worker 脚本未能加载', false);
        }

        this.api = new at.AlphaTabApi(this.element, settings);
        this.wire();
    }

    private wire(): void {
        const api = this.api;
        if (!api) {
            return;
        }

        api.renderFinished.on(() => {
            this.rendered = true;
            this.barCount = api.score?.masterBars.length ?? 0;
            this.callbacks.onStateChanged();
        });

        api.error.on((error: any) => {
            const message = error?.message ? String(error.message) : String(error);
            // 渲染成功之后再出的错（音色库、播放器）不该把谱子清掉——
            // 旧代码把这类错误完全吞进 console 了。
            this.callbacks.onError(message, !this.rendered);
        });

        api.playerStateChanged.on((e: any) => {
            this.state = e.state === at.synth.PlayerState.Playing ? 'playing' : 'paused';
            this.callbacks.onStateChanged();
        });

        api.playerPositionChanged.on((e: any) => {
            this.position = e.currentTime / 1000;
            this.duration = e.endTime / 1000;
            this.callbacks.onStateChanged();
        });

        api.playedBeatChanged.on((beat: any) => {
            this.currentBar = (beat?.voice?.bar?.index ?? 0) + 1;
            this.callbacks.onStateChanged();
        });

        // 点一个音符时 noteMouseDown 和 beatMouseDown 都会触发，旧代码因此连发两条
        // 消息，粗粒度的那条还可能后到、把精确的音符选区盖掉。这里把同一次点击的
        // 事件攒到一个微任务里再发，并且总是取最精确的那个地址——两个事件谁先谁后都不影响。
        api.noteMouseDown.on((note: any) => {
            if (note?.beat) {
                this.queueSelect(addressOfBeat(note.beat, note.index), true);
            }
        });
        api.beatMouseDown.on((beat: any) => {
            if (beat?.voice?.bar) {
                this.queueSelect(addressOfBeat(beat), false);
            }
        });
    }

    private pendingSelect: ScoreAddress | undefined;
    private selectScheduled = false;

    /** 攒一次点击里的多个事件，只上报最精确的那个地址。 */
    private queueSelect(address: ScoreAddress, precise: boolean): void {
        if (!this.pendingSelect || precise) {
            this.pendingSelect = address;
        }
        if (this.selectScheduled) {
            return;
        }
        this.selectScheduled = true;
        queueMicrotask(() => {
            this.selectScheduled = false;
            const address = this.pendingSelect;
            this.pendingSelect = undefined;
            if (address) {
                this.callbacks.onNoteSelect(this.side, address);
            }
        });
    }

    /** 增量更新谱面内容。不销毁实例，也不重新加载音色库。 */
    update(tex: string): void {
        if (!this.api || tex === this.lastTex) {
            return;
        }
        this.lastTex = tex;
        this.rendered = false;
        this.api.tex(tex);
    }

    applyRenderSettings(render: Partial<RenderSettings>): void {
        const api = this.api as any;
        if (!api) {
            return;
        }
        if (render.staveProfile !== undefined) {
            api.settings.display.staveProfile = staveProfileValue(render.staveProfile);
        }
        if (render.layoutMode !== undefined) {
            api.settings.display.layoutMode = render.layoutMode === 'horizontal'
                ? at.LayoutMode.Horizontal
                : at.LayoutMode.Page;
        }
        if (render.scale !== undefined) {
            api.settings.display.scale = render.scale;
        }
        if (render.displayTranspose !== undefined) {
            api.settings.display.transpositionPitches = render.displayTranspose === 0
                ? []
                : [render.displayTranspose];
        }
        api.updateSettings();
        api.render();
    }

    applyPlayerSettings(player: Partial<PlayerSettings>): void {
        const api = this.api as any;
        if (!api) {
            return;
        }
        // 只有音色库真的换了才重新加载——这是整个 webview 里最贵的一步操作。
        if (player.soundFontUri !== undefined && player.soundFontUri !== this.soundFontUri) {
            this.soundFontUri = player.soundFontUri;
            api.loadSoundFontFromUrl(player.soundFontUri, false);
        }
        if (player.speed !== undefined) {
            api.playbackSpeed = player.speed;
        }
        if (player.metronome !== undefined) {
            api.metronomeVolume = player.metronome ? 1 : 0;
        }
        if (player.countIn !== undefined) {
            api.countInVolume = player.countIn ? 1 : 0;
        }
        if (player.masterVolume !== undefined) {
            api.masterVolume = player.masterVolume;
        }
    }

    playPause(): void {
        (this.api as any)?.playPause();
    }

    stop(): void {
        (this.api as any)?.stop();
    }

    /** 按小节区间循环——审听一个 ≤8 小节的片段时最有用的一个控件。 */
    setLoop(range: BarRange | null): void {
        const api = this.api as any;
        if (!api?.score) {
            return;
        }
        this.loopRange = range;
        if (!range) {
            api.isLooping = false;
            api.playbackRange = null;
            this.looping = false;
            this.callbacks.onStateChanged();
            return;
        }
        const masterBars = api.score.masterBars;
        const first = masterBars[Math.max(0, range.start - 1)];
        const last = masterBars[Math.min(masterBars.length - 1, range.end - 1)];
        if (!first || !last) {
            return;
        }
        api.playbackRange = {
            startTick: first.start,
            endTick: last.start + last.calculateDuration()
        };
        api.isLooping = true;
        this.looping = true;
        this.callbacks.onStateChanged();
    }

    /** 把播放头挪到某一小节（1-based）。 */
    seekToBar(bar: number): void {
        const api = this.api as any;
        const masterBars = api?.score?.masterBars;
        if (!masterBars) {
            return;
        }
        const target = masterBars[Math.min(masterBars.length - 1, Math.max(0, bar - 1))];
        if (target) {
            api.tickPosition = target.start;
        }
    }

    get tickPosition(): number {
        return (this.api as any)?.tickPosition ?? 0;
    }

    set tickPosition(value: number) {
        const api = this.api as any;
        if (api) {
            api.tickPosition = value;
        }
    }

    get tracks(): any[] {
        return (this.api as any)?.score?.tracks ?? [];
    }

    setTrackMute(track: any, mute: boolean): void {
        (this.api as any)?.changeTrackMute([track], mute);
    }

    setTrackSolo(track: any, solo: boolean): void {
        (this.api as any)?.changeTrackSolo([track], solo);
    }

    print(): void {
        (this.api as any)?.print();
    }

    downloadMidi(): void {
        (this.api as any)?.downloadMidi();
    }

    setVisible(visible: boolean): void {
        this.element.hidden = !visible;
        if (visible) {
            // 隐藏期间容器宽度为 0，重新显示后需要按新宽度重排。
            (this.api as any)?.render();
        }
    }
}

function staveProfileValue(profile: RenderSettings['staveProfile']) {
    switch (profile) {
        case 'score': return at.StaveProfile.Score;
        case 'tab': return at.StaveProfile.Tab;
        case 'scoretab': return at.StaveProfile.ScoreTab;
        case 'tabmixed': return at.StaveProfile.TabMixed;
        default: return at.StaveProfile.Default;
    }
}
