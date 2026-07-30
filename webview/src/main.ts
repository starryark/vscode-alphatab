import { ScoreView } from './score-view';
import { Toolbar, ToolbarState } from './toolbar';
import { prepareWorkerScript } from './worker-blob';
import { mapBar, mapRange, invert, BarMapEntry } from '../../src/bar-map';
import type {
    HostToWebview, WebviewToHost, RenderSettings, PlayerSettings, Side
} from '../../src/protocol';

declare function acquireVsCodeApi(): { postMessage(message: unknown): void };

const vscodeApi = acquireVsCodeApi();
const post = (message: WebviewToHost) => vscodeApi.postMessage(message);

const toolbarRoot = document.getElementById('toolbar')!;
const statusRoot = document.getElementById('status')!;
const elementA = document.getElementById('score-a')!;
const elementB = document.getElementById('score-b')!;

let render: RenderSettings = {
    staveProfile: 'default', layoutMode: 'page', scale: 1, displayTranspose: 0
};
let player: PlayerSettings = {
    soundFonts: [], soundFontUri: '', speed: 1, metronome: false,
    countIn: false, masterVolume: 1, outputMode: 'scriptProcessor'
};

let scriptFile: string | undefined;
let side: Side = 'a';
let barMap: BarMapEntry[] = [];
let fileNameA = '';
let fileNameB = '';
let hasPartner = false;

const callbacks = {
    onNoteSelect: (from: Side, address: any) => post({ type: 'noteSelect', side: from, address }),
    onError: (message: string, fatal: boolean) => {
        showStatus(message, fatal);
        post({ type: 'error', message, fatal });
    },
    onStateChanged: () => scheduleSync()
};

const viewA = new ScoreView('a', elementA, callbacks);
const viewB = new ScoreView('b', elementB, callbacks);
const active = () => (side === 'a' ? viewA : viewB);

// --------------------------------------------------------------------------

function showStatus(message: string, fatal: boolean): void {
    statusRoot.textContent = message;
    statusRoot.hidden = false;
    statusRoot.classList.toggle('fatal', fatal);
    if (!fatal) {
        window.setTimeout(() => { statusRoot.hidden = true; }, 6000);
    }
}

function clearStatus(): void {
    statusRoot.hidden = true;
}

/** 从 alphaTab 模型里读段落标记，不用宿主额外传。 */
function sections(view: ScoreView): { name: string; bar: number }[] {
    const masterBars = (view as any).api?.score?.masterBars ?? [];
    const out: { name: string; bar: number }[] = [];
    for (let i = 0; i < masterBars.length; i++) {
        const text = masterBars[i]?.section?.text;
        if (text) {
            out.push({ name: text, bar: i + 1 });
        }
    }
    return out;
}

function trackRows(view: ScoreView) {
    return view.tracks.map((track: any) => ({
        index: track.index,
        name: track.name || `Track ${track.index + 1}`,
        muted: !!track.playbackInfo?.isMute,
        solo: !!track.playbackInfo?.isSolo
    }));
}

let syncScheduled = false;
function scheduleSync(): void {
    if (syncScheduled) {
        return;
    }
    syncScheduled = true;
    requestAnimationFrame(() => {
        syncScheduled = false;
        syncToolbar();
    });
}

function syncToolbar(): void {
    const view = active();
    const state: ToolbarState = {
        playing: view.state === 'playing',
        currentBar: view.currentBar,
        barCount: view.barCount,
        position: view.position,
        duration: view.duration,
        looping: view.looping,
        loopRange: view.loopRange,
        side,
        hasPartner,
        partnerName: fileNameB,
        fileName: side === 'a' ? fileNameA : fileNameB,
        tracks: trackRows(view),
        sections: sections(view)
    };
    toolbar.update(state);
    post({
        type: 'state',
        state: view.state,
        side,
        currentBar: view.currentBar,
        barCount: view.barCount,
        position: view.position,
        duration: view.duration,
        looping: view.looping,
        loopRange: view.loopRange
    });
}

/**
 * A/B 切换。带着当前小节过去——这正是这个功能存在的意义：
 * 听到改编谱第 12 小节觉得不对，按一下就能听参照谱的对应位置。
 */
function toggleAB(): void {
    if (!hasPartner) {
        post({ type: 'command', command: 'pickPartner' });
        return;
    }
    if (!viewB.isCreated) {
        return;
    }
    const from = active();
    const wasPlaying = from.state === 'playing';
    const fromBar = from.currentBar;

    from.stop();

    const goingToB = side === 'a';
    const entries = goingToB ? barMap : invert(barMap);
    const targetBar = mapBar(fromBar, entries);

    side = goingToB ? 'b' : 'a';
    viewA.setVisible(side === 'a');
    viewB.setVisible(side === 'b');

    setTimeout(() => {
        const to = active();
        to.seekToBar(targetBar);
        // 循环区间也跟着换算过去，两边审的才是同一段音乐。
        if (from.loopRange) {
            to.setLoop(mapRange(from.loopRange, entries));
        }
        if (wasPlaying) {
            to.playPause();
        }
        scheduleSync();
    }, 50);
}

// --------------------------------------------------------------------------

const toolbar = new Toolbar(toolbarRoot, {
    playPause: () => active().playPause(),
    stop: () => active().stop(),
    seekToBar: bar => active().seekToBar(bar),
    setLoop: range => active().setLoop(range),
    setSpeed: speed => { player.speed = speed; bothViews(v => v.applyPlayerSettings({ speed })); },
    setMetronome: on => { player.metronome = on; bothViews(v => v.applyPlayerSettings({ metronome: on })); },
    setCountIn: on => { player.countIn = on; bothViews(v => v.applyPlayerSettings({ countIn: on })); },
    setVolume: value => bothViews(v => v.applyPlayerSettings({ masterVolume: value })),
    setScale: scale => { render.scale = scale; bothViews(v => v.applyRenderSettings({ scale })); },
    setLayout: layoutMode => { render.layoutMode = layoutMode; bothViews(v => v.applyRenderSettings({ layoutMode })); },
    setStaveProfile: staveProfile => {
        render.staveProfile = staveProfile;
        bothViews(v => v.applyRenderSettings({ staveProfile }));
    },
    setSoundFont: (uri, label) => {
        post({ type: 'command', command: 'setDefaultSoundFont', args: [uri, label] });
    },
    setTranspose: semitones => {
        render.displayTranspose = semitones;
        bothViews(v => v.applyRenderSettings({ displayTranspose: semitones }));
    },
    toggleAB,
    toggleTrack: (index, kind, on) => {
        const view = active();
        const track = view.tracks.find((t: any) => t.index === index);
        if (!track) {
            return;
        }
        if (kind === 'mute') {
            view.setTrackMute(track, on);
        } else {
            view.setTrackSolo(track, on);
        }
        scheduleSync();
    },
    print: () => post({ type: 'command', command: 'print' }),
    exportMidi: () => active().downloadMidi(),
    importSoundFont: () => post({ type: 'command', command: 'importSoundFont' })
});

function bothViews(action: (view: ScoreView) => void): void {
    if (viewA.isCreated) {
        action(viewA);
    }
    if (viewB.isCreated) {
        action(viewB);
    }
}

// --------------------------------------------------------------------------
// 消息分发。每条消息都带 type，先 switch 再取字段。
// 旧代码是无条件 `message.alphatex.trim()`，任何新形状的消息都会抛 TypeError。
// --------------------------------------------------------------------------

window.addEventListener('message', event => {
    const message = event.data as HostToWebview;
    if (!message || typeof message.type !== 'string') {
        return;
    }
    switch (message.type) {
        case 'init':
            render = message.render;
            player = message.player;
            fileNameA = message.fileName;
            toolbar.setSoundFonts(player);
            viewA.create(message.alphatex, render, player, scriptFile);
            clearStatus();
            scheduleSync();
            break;

        case 'scoreChanged': {
            const view = message.side === 'a' ? viewA : viewB;
            if (message.side === 'a') {
                fileNameA = message.fileName;
            } else {
                fileNameB = message.fileName;
            }
            // 文件被清空时要真的清掉谱面。旧代码这里是个 falsy 判断，
            // 结果清空文件之后预览还停在旧内容上。
            view.update(message.alphatex);
            clearStatus();
            scheduleSync();
            break;
        }

        case 'renderSettings':
            render = { ...render, ...message.render };
            bothViews(v => v.applyRenderSettings(message.render));
            break;

        case 'playerSettings':
            player = { ...player, ...message.player };
            toolbar.setSoundFonts(player);
            bothViews(v => v.applyPlayerSettings(message.player));
            break;

        case 'partner':
            if (!message.partner) {
                hasPartner = false;
                barMap = [];
                if (side === 'b') {
                    toggleAB();
                }
            } else {
                hasPartner = true;
                barMap = message.partner.barMap ?? [];
                fileNameB = message.partner.fileName;
                if (viewB.isCreated) {
                    viewB.update(message.partner.alphatex);
                } else {
                    viewB.create(message.partner.alphatex, render, player, scriptFile);
                    viewB.setVisible(false);
                }
            }
            scheduleSync();
            break;

        case 'transport':
            if (message.action === 'playPause') {
                active().playPause();
            } else if (message.action === 'stop') {
                active().stop();
            } else if (message.action === 'toggleAB') {
                toggleAB();
            } else if (message.action === 'toggleLoop') {
                active().setLoop(active().looping ? null : { start: 1, end: active().barCount });
            }
            break;

        case 'loop':
            active().setLoop(message.range);
            break;

        case 'reveal':
            active().seekToBar(message.address.bar + 1);
            break;
    }
});

// --------------------------------------------------------------------------
// 启动：先把 worker blob 准备好，再告诉宿主可以发内容了。
// 少了这个握手，初始消息会在页面还没装上监听器时发出来并被丢弃——预览就一片空白。
// --------------------------------------------------------------------------

const scriptUri = globalThis.__alphaTabScriptUri;
prepareWorkerScript(scriptUri ?? '')
    .then(blobUrl => { scriptFile = blobUrl; })
    .finally(() => post({ type: 'ready' }));
