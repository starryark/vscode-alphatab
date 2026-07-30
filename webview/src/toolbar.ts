import type { RenderSettings, PlayerSettings, BarRange, Side } from '../../src/protocol';

/**
 * 工具栏。旧版只有三个控件（播放/暂停、谱表样式、音色库），而且换个下拉框
 * 就要把整个播放器拆了重建。这里所有控件都走增量更新。
 */

export interface ToolbarHandlers {
    playPause(): void;
    stop(): void;
    seekToBar(bar: number): void;
    setLoop(range: BarRange | null): void;
    setSpeed(speed: number): void;
    setMetronome(on: boolean): void;
    setCountIn(on: boolean): void;
    setVolume(value: number): void;
    setScale(scale: number): void;
    setLayout(layout: RenderSettings['layoutMode']): void;
    setStaveProfile(profile: RenderSettings['staveProfile']): void;
    setSoundFont(uri: string, label?: string): void;
    setTranspose(semitones: number): void;
    toggleAB(): void;
    toggleTrack(index: number, kind: 'mute' | 'solo', on: boolean): void;
    print(): void;
    exportMidi(): void;
    importSoundFont?(): void;
}

export interface ToolbarState {
    playing: boolean;
    currentBar: number;
    barCount: number;
    position: number;
    duration: number;
    looping: boolean;
    loopRange: BarRange | null;
    side: Side;
    hasPartner: boolean;
    partnerName: string;
    fileName: string;
    tracks: { index: number; name: string; muted: boolean; solo: boolean }[];
    sections: { name: string; bar: number }[];
}

function el<K extends keyof HTMLElementTagNameMap>(
    tag: K, className?: string, text?: string
): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    if (className) {
        node.className = className;
    }
    if (text !== undefined) {
        node.textContent = text;
    }
    return node;
}

function formatTime(seconds: number): string {
    if (!isFinite(seconds) || seconds < 0) {
        seconds = 0;
    }
    const total = Math.floor(seconds);
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
}

export class Toolbar {
    private readonly playButton: HTMLButtonElement;
    private readonly stopButton: HTMLButtonElement;
    private readonly seek: HTMLInputElement;
    private readonly timeLabel: HTMLSpanElement;
    private readonly barLabel: HTMLSpanElement;
    private readonly loopButton: HTMLButtonElement;
    private readonly loopFrom: HTMLInputElement;
    private readonly loopTo: HTMLInputElement;
    private readonly abButton: HTMLButtonElement;
    private readonly sectionSelect: HTMLSelectElement;
    private readonly soundFontSelect: HTMLSelectElement;
    private readonly trackList: HTMLDivElement;
    private seeking = false;

    constructor(
        root: HTMLElement,
        private readonly handlers: ToolbarHandlers
    ) {
        root.innerHTML = '';

        // ---- 走带 ----
        const transport = el('div', 'group');
        this.playButton = el('button', 'btn primary', '▶');
        this.playButton.title = '播放 / 暂停 (Alt+Space)';
        this.playButton.onclick = () => handlers.playPause();

        this.stopButton = el('button', 'btn', '■');
        this.stopButton.title = '停止';
        this.stopButton.onclick = () => handlers.stop();

        this.seek = el('input', 'seek');
        this.seek.type = 'range';
        this.seek.min = '1';
        this.seek.max = '1';
        this.seek.value = '1';
        this.seek.title = '跳转到小节';
        this.seek.oninput = () => { this.seeking = true; this.renderSeekLabel(); };
        this.seek.onchange = () => {
            this.seeking = false;
            handlers.seekToBar(Number(this.seek.value));
        };

        this.barLabel = el('span', 'readout', '1 / 1');
        this.timeLabel = el('span', 'readout dim', '0:00 / 0:00');

        transport.append(this.playButton, this.stopButton, this.seek, this.barLabel, this.timeLabel);

        // ---- 循环 ----
        // 审听一个 Gate-B 片段（≤8 小节）时最常用的控件。
        const loop = el('div', 'group');
        this.loopButton = el('button', 'btn', '⟲');
        this.loopButton.title = '循环选定小节 (Alt+L)';
        this.loopButton.onclick = () => {
            if (this.state.looping) {
                handlers.setLoop(null);
            } else {
                handlers.setLoop(this.readLoopRange());
            }
        };
        this.loopFrom = this.barInput('起始小节');
        this.loopTo = this.barInput('结束小节');
        const applyLoop = () => {
            if (this.state.looping) {
                handlers.setLoop(this.readLoopRange());
            }
        };
        this.loopFrom.onchange = applyLoop;
        this.loopTo.onchange = applyLoop;
        loop.append(this.loopButton, this.loopFrom, el('span', 'dash', '–'), this.loopTo);

        // ---- 段落导航 ----
        this.sectionSelect = el('select', 'select');
        this.sectionSelect.title = '跳转到段落';
        this.sectionSelect.onchange = () => {
            const bar = Number(this.sectionSelect.value);
            if (bar > 0) {
                handlers.seekToBar(bar);
                this.seek.value = String(bar);
            }
        };

        // ---- A/B ----
        const ab = el('div', 'group');
        this.abButton = el('button', 'btn ab', 'A');
        this.abButton.title = '对照参照谱 (Alt+B)';
        this.abButton.onclick = () => handlers.toggleAB();
        ab.append(this.abButton);

        // ---- 播放参数 ----
        const audio = el('div', 'group');
        const speed = el('select', 'select');
        for (const value of [0.25, 0.5, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 2]) {
            const option = el('option', undefined, `${value}×`);
            option.value = String(value);
            if (value === 1) {
                option.selected = true;
            }
            speed.append(option);
        }
        speed.title = '播放速度';
        speed.onchange = () => handlers.setSpeed(Number(speed.value));

        const metronome = this.toggleButton('🎵', '节拍器', on => handlers.setMetronome(on));
        const countIn = this.toggleButton('⏱', '预备拍', on => handlers.setCountIn(on));

        const volume = el('input', 'slider');
        volume.type = 'range';
        volume.min = '0';
        volume.max = '1';
        volume.step = '0.05';
        volume.value = '1';
        volume.title = '总音量';
        volume.oninput = () => handlers.setVolume(Number(volume.value));

        this.soundFontSelect = el('select', 'select');
        this.soundFontSelect.title = '音色库';
        this.soundFontSelect.onchange = () => {
            if (this.soundFontSelect.value === '__import__') {
                handlers.importSoundFont?.();
                // We don't have access to the old value immediately, but the host will send new settings shortly.
                // Or user can manually re-select if they cancel.
            } else {
                const selectedOption = this.soundFontSelect.options[this.soundFontSelect.selectedIndex];
                handlers.setSoundFont(this.soundFontSelect.value, selectedOption.dataset.label);
            }
        };

        audio.append(speed, metronome, countIn, volume, this.soundFontSelect);

        // ---- 显示 ----
        const view = el('div', 'group');
        const stave = el('select', 'select');
        for (const [value, label] of [
            ['default', '默认'], ['scoretab', '五线谱+六线谱'],
            ['score', '五线谱'], ['tab', '六线谱'], ['tabmixed', '混合六线谱']
        ] as const) {
            const option = el('option', undefined, label);
            option.value = value;
            stave.append(option);
        }
        stave.title = '谱表样式';
        stave.onchange = () => handlers.setStaveProfile(stave.value as RenderSettings['staveProfile']);

        const layout = el('select', 'select');
        for (const [value, label] of [['page', '分页'], ['horizontal', '横向']] as const) {
            const option = el('option', undefined, label);
            option.value = value;
            layout.append(option);
        }
        layout.title = '排版方式';
        layout.onchange = () => handlers.setLayout(layout.value as RenderSettings['layoutMode']);

        const zoom = el('select', 'select');
        for (const value of [0.6, 0.75, 0.9, 1, 1.25, 1.5, 2]) {
            const option = el('option', undefined, `${Math.round(value * 100)}%`);
            option.value = String(value);
            if (value === 1) {
                option.selected = true;
            }
            zoom.append(option);
        }
        zoom.title = '缩放';
        zoom.onchange = () => handlers.setScale(Number(zoom.value));

        const transpose = el('input', 'number');
        transpose.type = 'number';
        transpose.min = '-24';
        transpose.max = '24';
        transpose.value = '0';
        transpose.title = '显示移调（半音，不改变播放音高）';
        transpose.onchange = () => handlers.setTranspose(Number(transpose.value));

        view.append(stave, layout, zoom, transpose);

        // ---- 输出 ----
        const output = el('div', 'group');
        const printButton = el('button', 'btn', '🖨');
        printButton.title = '打印';
        printButton.onclick = () => handlers.print();
        const midiButton = el('button', 'btn', 'MIDI');
        midiButton.title = '导出 MIDI';
        midiButton.onclick = () => handlers.exportMidi();
        output.append(printButton, midiButton);

        this.trackList = el('div', 'tracks');

        root.append(transport, loop, this.sectionSelect, ab, audio, view, output, this.trackList);
    }

    private barInput(title: string): HTMLInputElement {
        const input = el('input', 'number');
        input.type = 'number';
        input.min = '1';
        input.value = '1';
        input.title = title;
        return input;
    }

    private toggleButton(label: string, title: string, onToggle: (on: boolean) => void): HTMLButtonElement {
        const button = el('button', 'btn', label);
        button.title = title;
        button.onclick = () => {
            const on = !button.classList.contains('on');
            button.classList.toggle('on', on);
            onToggle(on);
        };
        return button;
    }

    private readLoopRange(): BarRange {
        const start = Math.max(1, Number(this.loopFrom.value) || 1);
        const end = Math.max(start, Number(this.loopTo.value) || start);
        return { start, end };
    }

    private renderSeekLabel(): void {
        this.barLabel.textContent = `${this.seek.value} / ${this.state.barCount || 1}`;
    }

    private state: ToolbarState = {
        playing: false, currentBar: 1, barCount: 0, position: 0, duration: 0,
        looping: false, loopRange: null, side: 'a', hasPartner: false,
        partnerName: '', fileName: '', tracks: [], sections: []
    };

    setSoundFonts(player: PlayerSettings): void {
        this.soundFontSelect.innerHTML = '';
        for (const font of player.soundFonts) {
            const option = el('option', undefined, font.label);
            option.value = font.uri;
            option.dataset.label = font.label;
            option.selected = font.uri === player.soundFontUri;
            this.soundFontSelect.append(option);
        }
        const importOption = el('option', undefined, '导入音色库... (Import SoundFont)');
        importOption.value = '__import__';
        this.soundFontSelect.append(importOption);
        this.soundFontSelect.hidden = false;
    }

    update(state: ToolbarState): void {
        this.state = state;

        this.playButton.textContent = state.playing ? '⏸' : '▶';
        this.seek.max = String(Math.max(1, state.barCount));
        if (!this.seeking) {
            this.seek.value = String(state.currentBar);
            this.barLabel.textContent = `${state.currentBar} / ${state.barCount || 1}`;
        }
        this.timeLabel.textContent = `${formatTime(state.position)} / ${formatTime(state.duration)}`;

        this.loopButton.classList.toggle('on', state.looping);
        if (state.loopRange) {
            this.loopFrom.value = String(state.loopRange.start);
            this.loopTo.value = String(state.loopRange.end);
        }
        this.loopFrom.max = String(Math.max(1, state.barCount));
        this.loopTo.max = String(Math.max(1, state.barCount));

        this.abButton.textContent = state.side === 'a' ? 'A' : 'B';
        this.abButton.classList.toggle('on', state.side === 'b');
        this.abButton.disabled = false;
        this.abButton.title = state.hasPartner
            ? `对照 ${state.partnerName} (Alt+B)`
            : '选择对照谱 (Alt+B)';

        this.renderSections(state.sections);
        this.renderTracks(state.tracks);
    }

    private lastSectionKey = '';
    private renderSections(sections: ToolbarState['sections']): void {
        const key = sections.map(s => `${s.bar}:${s.name}`).join('|');
        if (key === this.lastSectionKey) {
            return;
        }
        this.lastSectionKey = key;
        this.sectionSelect.innerHTML = '';
        this.sectionSelect.hidden = sections.length === 0;
        const head = el('option', undefined, '段落…');
        head.value = '0';
        this.sectionSelect.append(head);
        for (const section of sections) {
            const option = el('option', undefined, `${section.bar}. ${section.name}`);
            option.value = String(section.bar);
            this.sectionSelect.append(option);
        }
    }

    private lastTrackKey = '';
    private renderTracks(tracks: ToolbarState['tracks']): void {
        const key = tracks.map(t => `${t.index}:${t.name}:${t.muted}:${t.solo}`).join('|');
        if (key === this.lastTrackKey) {
            return;
        }
        this.lastTrackKey = key;
        this.trackList.innerHTML = '';
        // 单轨谱不需要这一排控件——绝大多数吉他改编都是单轨。
        this.trackList.hidden = tracks.length < 2;
        for (const track of tracks) {
            const row = el('span', 'track');
            row.append(el('span', 'track-name', track.name));
            const mute = el('button', `chip${track.muted ? ' on' : ''}`, 'M');
            mute.title = '静音';
            mute.onclick = () => this.handlers.toggleTrack(track.index, 'mute', !track.muted);
            const solo = el('button', `chip${track.solo ? ' on' : ''}`, 'S');
            solo.title = '独奏';
            solo.onclick = () => this.handlers.toggleTrack(track.index, 'solo', !track.solo);
            row.append(mute, solo);
            this.trackList.append(row);
        }
    }
}
