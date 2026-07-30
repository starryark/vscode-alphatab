import * as fspath from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import * as vscode from 'vscode';

import { ScoreModel } from './score-model';
import { DiagnosticSink, toVsRange } from './diagnostics';
import { findPartner } from './partner';
import {
    HostToWebview, WebviewToHost, RenderSettings, PlayerSettings,
    StaveProfile, LayoutMode, Side, BarRange, ScoreAddress, PartnerMessage
} from './protocol';

/**
 * 预览面板。每个文档最多一个，重复触发命令是 reveal 而不是再开一个。
 *
 * 和旧版 webview.ts 的几个关键差别：
 *   - 每个 URI 只有一个面板，标题是文件名而不是写死的 "Alphatab"
 *   - retainContextWhenHidden：切走标签页不再销毁播放状态
 *   - HTML 由这里生成并带 nonce CSP，不再用正则改写磁盘上的 html
 *   - alphaTab.min.js 的地址由宿主下发，webview 不用再靠文件名去 querySelector
 */

const VIEW_TYPE = 'alphatab.preview';

/** 音色库要能被 webview 读到，所以它所在目录必须进 localResourceRoots。 */
interface SoundFont {
    label: string;
    fsPath: string;
}

function readConfig(scope?: vscode.Uri) {
    return vscode.workspace.getConfiguration('alphatab', scope);
}

function resolveRenderSettings(scope?: vscode.Uri): RenderSettings {
    const config = readConfig(scope);
    return {
        staveProfile: config.get<StaveProfile>('staveProfile', 'default'),
        layoutMode: config.get<LayoutMode>('layoutMode', 'page'),
        scale: config.get<number>('scale', 1),
        displayTranspose: 0
    };
}

/**
 * 内置只带 sonivox（1.3 MB）。想用别的音色库就在 alphatab.soundFonts 里
 * 填本地 .sf2 的绝对路径——它们留在用户磁盘上，不进扩展包。
 * 之前那两个吉他音色库一共 162 MB，是 VSIX 曾经有 137 MB 的全部原因。
 */
function resolveSoundFonts(context: vscode.ExtensionContext, scope?: vscode.Uri): SoundFont[] {
    const bundled = fspath.join(context.extensionPath, 'webview', 'sound', 'sonivox.sf2');
    const fonts: SoundFont[] = [];
    if (fs.existsSync(bundled)) {
        fonts.push({ label: 'sonivox (bundled)', fsPath: bundled });
    }
    for (const entry of readConfig(scope).get<string[]>('soundFonts', [])) {
        const resolved = entry.replace(/^~(?=[\\/])/, process.env.HOME ?? process.env.USERPROFILE ?? '~');
        if (!fs.existsSync(resolved)) {
            continue;
        }
        fonts.push({ label: fspath.basename(resolved, '.sf2'), fsPath: resolved });
    }
    return fonts;
}

function pickSoundFont(fonts: SoundFont[], scope?: vscode.Uri): SoundFont | undefined {
    const preferred = readConfig(scope).get<string>('defaultSoundFont', '');
    if (preferred) {
        const hit = fonts.find(f => f.label === preferred || f.fsPath === preferred);
        if (hit) {
            return hit;
        }
    }
    return fonts[0];
}

export class AlphatabPanel {
    private static readonly open = new Map<string, AlphatabPanel>();

    private readonly disposables: vscode.Disposable[] = [];
    private debounce: NodeJS.Timeout | undefined;
    private ready = false;
    private pending: HostToWebview[] = [];
    private soundFonts: SoundFont[] = [];

    static reveal(
        context: vscode.ExtensionContext,
        diagnostics: DiagnosticSink,
        uri: vscode.Uri
    ): AlphatabPanel {
        const key = uri.toString();
        const existing = AlphatabPanel.open.get(key);
        if (existing) {
            existing.panel.reveal(existing.panel.viewColumn ?? vscode.ViewColumn.Two, true);
            return existing;
        }
        const created = new AlphatabPanel(context, diagnostics, uri);
        AlphatabPanel.open.set(key, created);
        return created;
    }

    static forUri(uri: vscode.Uri): AlphatabPanel | undefined {
        return AlphatabPanel.open.get(uri.toString());
    }

    static get active(): AlphatabPanel | undefined {
        for (const panel of AlphatabPanel.open.values()) {
            if (panel.panel.active) {
                return panel;
            }
        }
        return undefined;
    }

    static disposeAll(): void {
        for (const panel of [...AlphatabPanel.open.values()]) {
            panel.panel.dispose();
        }
    }

    private constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly diagnostics: DiagnosticSink,
        readonly uri: vscode.Uri,
        private readonly panel: vscode.WebviewPanel = AlphatabPanel.createPanel(context, uri)
    ) {
        this.soundFonts = resolveSoundFonts(context, uri);
        this.panel.webview.html = this.buildHtml();

        this.disposables.push(
            this.panel.webview.onDidReceiveMessage(message => this.onMessage(message as WebviewToHost)),
            vscode.workspace.onDidChangeTextDocument(event => this.onDocumentChanged(event)),
            vscode.workspace.onDidChangeConfiguration(event => this.onConfigChanged(event))
        );

        this.panel.onDidDispose(() => this.dispose());
    }

    private static createPanel(context: vscode.ExtensionContext, uri: vscode.Uri): vscode.WebviewPanel {
        const roots = [vscode.Uri.file(fspath.join(context.extensionPath, 'webview'))];
        for (const font of resolveSoundFonts(context, uri)) {
            roots.push(vscode.Uri.file(fspath.dirname(font.fsPath)));
        }

        const panel = vscode.window.createWebviewPanel(
            VIEW_TYPE,
            fspath.basename(uri.fsPath),
            { viewColumn: vscode.ViewColumn.Two, preserveFocus: true },
            {
                enableScripts: true,
                enableFindWidget: true,
                // 切到别的标签页时不销毁 webview。否则回来要重新解析、重新加载音色库，
                // 播放位置和滚动位置也全丢了。
                retainContextWhenHidden: true,
                localResourceRoots: roots
            }
        );
        panel.iconPath = {
            light: vscode.Uri.file(fspath.join(context.extensionPath, 'icon', 'guitar.light.svg')),
            dark: vscode.Uri.file(fspath.join(context.extensionPath, 'icon', 'guitar.dark.svg'))
        };
        return panel;
    }

    // ---- HTML ------------------------------------------------------------

    private assetUri(...segments: string[]): vscode.Uri {
        return this.panel.webview.asWebviewUri(
            vscode.Uri.file(fspath.join(this.context.extensionPath, ...segments))
        );
    }

    private buildHtml(): string {
        const nonce = crypto.randomBytes(16).toString('base64');
        const cspSource = this.panel.webview.cspSource;
        const appUri = this.assetUri('webview', 'dist', 'app.js');
        const styleUri = this.assetUri('webview', 'styles.css');
        const alphaTabUri = this.assetUri('webview', 'alphaTab.min.js');

        // CSP 的每一条都对应一个已知约束，别随手删：
        //   script-src blob:  合成器 worker 跑的是同源 blob 脚本（见 webview/src/worker.ts）
        //   worker-src blob:  创建那个 worker 本身
        //   connect-src       fetch alphaTab.min.js 和 .sf2 音色库
        //   style-src unsafe-inline  alphaTab 运行时会自己插 <style>
        const csp = [
            `default-src 'none'`,
            `script-src 'nonce-${nonce}' ${cspSource} blob:`,
            `worker-src blob:`,
            `child-src blob:`,
            `style-src ${cspSource} 'unsafe-inline'`,
            `font-src ${cspSource}`,
            `img-src ${cspSource} data:`,
            `connect-src ${cspSource} blob:`,
            `media-src ${cspSource} blob:`
        ].join('; ');

        return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${styleUri}">
<title>${escapeHtml(fspath.basename(this.uri.fsPath))}</title>
</head>
<body>
<div id="toolbar" class="toolbar"></div>
<div id="status" class="status" hidden></div>
<div id="viewport" class="viewport">
  <div id="score-a" class="score"></div>
  <div id="score-b" class="score" hidden></div>
</div>
<script nonce="${nonce}">window.__alphaTabScriptUri = ${JSON.stringify(alphaTabUri.toString())};</script>
<script nonce="${nonce}" src="${alphaTabUri}"></script>
<script nonce="${nonce}" src="${appUri}"></script>
</body>
</html>`;
    }

    // ---- 消息 ------------------------------------------------------------

    private post(message: HostToWebview): void {
        if (!this.ready) {
            // ready 握手之前发出去的消息会被静默丢弃——这正是以前预览一片空白的原因。
            this.pending.push(message);
            return;
        }
        void this.panel.webview.postMessage(message);
    }

    private onMessage(message: WebviewToHost): void {
        if (!message || typeof message.type !== 'string') {
            return;
        }
        switch (message.type) {
            case 'ready':
                this.ready = true;
                this.sendInit();
                for (const queued of this.pending.splice(0)) {
                    void this.panel.webview.postMessage(queued);
                }
                break;
            case 'noteSelect':
                this.jumpToSource(message.side, message.address);
                break;
            case 'error':
                if (message.fatal) {
                    vscode.window.setStatusBarMessage(`alphaTab: ${message.message}`, 5000);
                }
                console.warn('[alphatab webview]', message.message);
                break;
            case 'state':
                this.lastState = message;
                break;
            case 'command':
                if (message.args) {
                    void vscode.commands.executeCommand(`alphatab.${message.command}`, this.uri, ...message.args);
                } else {
                    void vscode.commands.executeCommand(`alphatab.${message.command}`, this.uri);
                }
                break;
        }
    }

    private lastState: Extract<WebviewToHost, { type: 'state' }> | undefined;

    get currentBar(): number {
        return this.lastState?.currentBar ?? 1;
    }

    private sendInit(): void {
        const text = this.readText();
        if (text === undefined) {
            return;
        }
        this.post({
            type: 'init',
            scriptUri: this.assetUri('webview', 'alphaTab.min.js').toString(),
            alphatex: text,
            fileName: fspath.basename(this.uri.fsPath),
            render: resolveRenderSettings(this.uri),
            player: this.resolvePlayerSettings()
        });
        this.refreshDiagnostics(text);
        this.refreshPartner();
    }

    /** 找同目录的参照谱，找到就把它送进 webview 的 B 侧。 */
    refreshPartner(): void {
        const partner = findPartner(this.uri);
        this.partnerUri = partner?.uri;
        this.post({
            type: 'partner',
            partner: partner
                ? { alphatex: partner.alphatex, fileName: partner.fileName, barMap: partner.barMap }
                : null
        });
    }

    private partnerUri: vscode.Uri | undefined;

    private resolvePlayerSettings(): PlayerSettings {
        const config = readConfig(this.uri);
        const font = pickSoundFont(this.soundFonts, this.uri);
        const uri = font
            ? this.panel.webview.asWebviewUri(vscode.Uri.file(font.fsPath)).toString()
            : '';
        return {
            soundFonts: this.soundFonts.map(f => ({
                label: f.label,
                uri: this.panel.webview.asWebviewUri(vscode.Uri.file(f.fsPath)).toString()
            })),
            soundFontUri: uri,
            speed: 1,
            metronome: false,
            countIn: false,
            masterVolume: config.get<number>('masterVolume', 1),
            outputMode: config.get<'scriptProcessor' | 'audioWorklet'>(
                'player.outputMode', 'scriptProcessor'
            )
        };
    }

    private readText(): string | undefined {
        const document = vscode.workspace.textDocuments.find(
            d => d.uri.toString() === this.uri.toString()
        );
        if (document) {
            return document.getText();
        }
        try {
            return fs.readFileSync(this.uri.fsPath, 'utf-8');
        } catch {
            return undefined;
        }
    }

    private refreshDiagnostics(text: string): void {
        this.diagnostics.setParseDiagnostics(this.uri, ScoreModel.parse(text));
    }

    private onDocumentChanged(event: vscode.TextDocumentChangeEvent): void {
        if (event.contentChanges.length === 0) {
            return;
        }
        // 参照谱也可能正被编辑（A/B 的两个文件常常同时开着）
        if (this.partnerUri && event.document.uri.toString() === this.partnerUri.toString()) {
            this.post({
                type: 'scoreChanged',
                side: 'b',
                alphatex: event.document.getText(),
                fileName: fspath.basename(this.partnerUri.fsPath)
            });
            return;
        }
        if (event.document.uri.toString() !== this.uri.toString()) {
            return;
        }
        const delay = readConfig(this.uri).get<number>('renderDebounceMs', 150);
        if (this.debounce !== undefined) {
            clearTimeout(this.debounce);
        }
        this.debounce = setTimeout(() => {
            this.debounce = undefined;
            const text = event.document.getText();
            this.post({
                type: 'scoreChanged',
                side: 'a',
                alphatex: text,
                fileName: fspath.basename(this.uri.fsPath)
            });
            this.refreshDiagnostics(text);
        }, delay);
    }

    private onConfigChanged(event: vscode.ConfigurationChangeEvent): void {
        if (!event.affectsConfiguration('alphatab')) {
            return;
        }
        this.post({ type: 'renderSettings', render: resolveRenderSettings(this.uri) });
        this.soundFonts = resolveSoundFonts(this.context, this.uri);
        this.post({ type: 'playerSettings', player: this.resolvePlayerSettings() });
    }

    /** 预览里点音符 → 编辑器光标跳到对应的源码位置。 */
    private jumpToSource(side: Side, address: ScoreAddress): void {
        if (side !== 'a') {
            return; // B 侧是参照文件，不动主编辑器
        }
        const text = this.readText();
        if (text === undefined) {
            return;
        }
        const range = ScoreModel.parse(text).rangeOf(address);
        if (!range) {
            return;
        }
        const editor = vscode.window.visibleTextEditors.find(
            e => e.document.uri.toString() === this.uri.toString()
        );
        if (!editor) {
            return;
        }
        const selection = toVsRange(range);
        editor.selection = new vscode.Selection(selection.start, selection.end);
        editor.revealRange(selection, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    }

    // ---- 对外操作（命令用） ------------------------------------------------

    transport(action: 'playPause' | 'stop' | 'toggleLoop' | 'toggleAB'): void {
        this.post({ type: 'transport', action });
    }

    setLoop(range: BarRange | null): void {
        this.post({ type: 'loop', range });
    }

    revealAddress(address: ScoreAddress): void {
        this.post({ type: 'reveal', address });
    }

    setPartner(partner: PartnerMessage['partner']): void {
        this.post({ type: 'partner', partner });
    }

    private dispose(): void {
        AlphatabPanel.open.delete(this.uri.toString());
        if (this.debounce !== undefined) {
            clearTimeout(this.debounce);
        }
        for (const disposable of this.disposables.splice(0)) {
            disposable.dispose();
        }
        this.diagnostics.forget(this.uri);
    }
}

function escapeHtml(value: string): string {
    return value.replace(/[&<>"']/g, character => {
        switch (character) {
            case '&': return '&amp;';
            case '<': return '&lt;';
            case '>': return '&gt;';
            case '"': return '&quot;';
            default: return '&#39;';
        }
    });
}
