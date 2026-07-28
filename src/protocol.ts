/**
 * 扩展宿主 ↔ webview 的消息协议。两边都 import 这个文件，
 * 所以任何一边改了形状，另一边编译就会红。
 *
 * 这个模块不能 import vscode，也不能碰 DOM——它要同时被 node 端和 web 端编译。
 *
 * 旧版协议只有两条消息，而且 webview 那边是无条件 `message.alphatex.trim()`，
 * 任何不带 alphatex 的消息都会抛 TypeError。所以现在每条消息都必须带 `type`，
 * 接收端一律先 switch。
 */

/** 与 score-model.ts 保持一致；这里重新声明是为了不把 alphaTab 依赖拖进 webview 包。 */
export interface ScoreAddress {
    track: number;
    staff: number;
    voice: number;
    bar: number;
    beat?: number;
    note?: number;
}

export type StaveProfile = 'default' | 'scoretab' | 'score' | 'tab' | 'tabmixed';
export type LayoutMode = 'page' | 'horizontal';
export type PlayerState = 'paused' | 'playing';

/** 哪一侧的谱子——A 是主文件，B 是 A/B 对照用的参照文件。 */
export type Side = 'a' | 'b';

export interface RenderSettings {
    staveProfile: StaveProfile;
    layoutMode: LayoutMode;
    scale: number;
    /** 显示用移调（半音）。播放音高不变。 */
    displayTranspose: number;
}

export interface SoundFontOption {
    label: string;
    uri: string;
}

export interface PlayerSettings {
    /** 可选的音色库。内置只有 sonivox，其余来自 alphatab.soundFonts 设置。 */
    soundFonts: SoundFontOption[];
    soundFontUri: string;
    speed: number;
    metronome: boolean;
    countIn: boolean;
    masterVolume: number;
    /** AudioWorklet 在 webview 里可能加载不了，默认还是走 ScriptProcessor。 */
    outputMode: 'scriptProcessor' | 'audioWorklet';
}

/** 一段小节区间，1-based，两端都含。 */
export interface BarRange {
    start: number;
    end: number;
}

// --------------------------------------------------------------------------
// 扩展宿主 → webview
// --------------------------------------------------------------------------

export interface InitMessage {
    type: 'init';
    /**
     * alphaTab.min.js 的 webview URI。webview 会 fetch 它并包成同源 blob，
     * 交给合成器 worker 用。
     *
     * 由宿主传进来，而不是让 webview 去 querySelector('script[src*="alphaTab.min.js"]')
     * ——那种写法等于永久禁止给这个包改名或加内容 hash。
     */
    scriptUri: string;
    alphatex: string;
    fileName: string;
    render: RenderSettings;
    player: PlayerSettings;
}

export interface ScoreChangedMessage {
    type: 'scoreChanged';
    side: Side;
    alphatex: string;
    fileName: string;
}

export interface RenderSettingsMessage {
    type: 'renderSettings';
    render: Partial<RenderSettings>;
}

export interface PlayerSettingsMessage {
    type: 'playerSettings';
    player: Partial<PlayerSettings>;
}

/** 挂上（或撤掉）A/B 对照的另一半。 */
export interface PartnerMessage {
    type: 'partner';
    /** null 表示没有可对照的文件。 */
    partner: {
        alphatex: string;
        fileName: string;
        /**
         * A 侧小节 → B 侧小节的分段映射，来自 sidecar.json 的
         * tabBars / sourceBars。没有 sidecar 时宿主不传，webview 按 1:1 处理。
         */
        barMap?: { from: BarRange; to: BarRange }[];
    } | null;
}

export interface TransportMessage {
    type: 'transport';
    action: 'playPause' | 'stop' | 'toggleLoop' | 'toggleAB';
}

/** 让预览滚动并高亮到某个位置（编辑器光标反向同步）。 */
export interface RevealMessage {
    type: 'reveal';
    address: ScoreAddress;
}

export interface LoopMessage {
    type: 'loop';
    /** null 取消循环。 */
    range: BarRange | null;
}

export type HostToWebview =
    | InitMessage
    | ScoreChangedMessage
    | RenderSettingsMessage
    | PlayerSettingsMessage
    | PartnerMessage
    | TransportMessage
    | RevealMessage
    | LoopMessage;

// --------------------------------------------------------------------------
// webview → 扩展宿主
// --------------------------------------------------------------------------

/** webview 装好监听器了，可以收初始内容了。少了这一步初始消息会被静默丢弃。 */
export interface ReadyMessage {
    type: 'ready';
}

export interface NoteSelectMessage {
    type: 'noteSelect';
    side: Side;
    address: ScoreAddress;
}

/**
 * webview 里出的错。旧版本只在首次渲染前把错误画在谱面上，
 * 渲染成功之后的错误（音色库加载失败、worker blob 没准备好之类）
 * 只进 console，用户完全看不到。
 */
export interface ErrorMessage {
    type: 'error';
    message: string;
    /** true 表示乐谱本身没渲染出来。 */
    fatal: boolean;
}

export interface StateMessage {
    type: 'state';
    state: PlayerState;
    side: Side;
    /** 当前播放到第几小节，1-based。 */
    currentBar: number;
    barCount: number;
    /** 秒 */
    position: number;
    duration: number;
    looping: boolean;
    loopRange: BarRange | null;
}

/** webview 里的工具栏按钮触发的、需要宿主处理的动作。 */
export interface CommandMessage {
    type: 'command';
    command: 'runGate' | 'snapshot' | 'pickPartner' | 'openSettings';
}

export type WebviewToHost =
    | ReadyMessage
    | NoteSelectMessage
    | ErrorMessage
    | StateMessage
    | CommandMessage;
