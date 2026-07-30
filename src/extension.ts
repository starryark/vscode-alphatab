import * as vscode from 'vscode';

import * as fspath from 'path';
import * as fs from 'fs';

import {
    alphatabKeywordCompletionItemProvider, alphatabHoverProvider,
    alphatabSymbolProvider, alphatabFoldingProvider
} from './provider';
import { AlphatabPanel } from './panel';
import { DiagnosticSink } from './diagnostics';
import { ScoreModel } from './score-model';
import { CompanionService } from './companion/service';
import { findToolRoot } from './companion/piano-to-guitar';
import { runCommand } from './companion/runner';
import { barMapFromSidecar, Sidecar } from './bar-map';
/**
 * 语言相关的 provider。注意这里没有 language server——registerLSP 这个旧名字
 * 和曾经的三个 vscode-languageserver 依赖都是误导，依赖已经删掉了。
 */
function registerLanguageFeatures(context: vscode.ExtensionContext): void {
    // 不再限定 scheme: 'file'，这样未保存的缓冲区和远程/虚拟文件系统也能用。
    const selector: vscode.DocumentSelector = { language: 'alphatab' };
    context.subscriptions.push(
        vscode.languages.registerCompletionItemProvider(
            selector, alphatabKeywordCompletionItemProvider, '\\'
        ),
        vscode.languages.registerHoverProvider(selector, alphatabHoverProvider),
        vscode.languages.registerDocumentSymbolProvider(selector, alphatabSymbolProvider),
        vscode.languages.registerFoldingRangeProvider(selector, alphatabFoldingProvider)
    );
}

function activeAlphatabUri(uri?: vscode.Uri): vscode.Uri | undefined {
    if (uri) {
        return uri;
    }
    const editor = vscode.window.activeTextEditor;
    if (editor?.document.languageId === 'alphatab') {
        return editor.document.uri;
    }
    return AlphatabPanel.active?.uri;
}

/**
 * 手动存盘前先打个快照。
 *
 * docs/workflow.md:211 明确写过：在 VS Code 里手改已批准的小节，是整个门禁循环
 * **唯一不会自动留快照**的状态。这条命令就是来补这个洞的。
 * 默认关闭——它会往用户的仓库里写东西。
 */
async function snapshot(uri: vscode.Uri, note: string): Promise<void> {
    const tools = findToolRoot(fspath.dirname(uri.fsPath));
    if (!tools) {
        return;
    }
    const history = fspath.join(tools.root, 'tools', 'history.mjs');
    if (!fs.existsSync(history)) {
        return;
    }
    const result = await runCommand({
        name: 'snapshot',
        argv: [process.execPath, history, 'snap', '--note', note],
        cwd: fspath.dirname(uri.fsPath),
        trustExitCode: true
    });
    if (result.exitCode !== 0 && result.failure) {
        void vscode.window.showWarningMessage(`alphaTab: 快照失败 — ${result.failure}`);
    }
}

export function activate(context: vscode.ExtensionContext): void {
    const diagnostics = new DiagnosticSink();
    const companion = new CompanionService(diagnostics);
    context.subscriptions.push(diagnostics, companion);

    registerLanguageFeatures(context);

    const command = (name: string, handler: (uri?: vscode.Uri, ...args: any[]) => void) =>
        context.subscriptions.push(
            vscode.commands.registerCommand(`alphatab.${name}`, handler)
        );

    command('preview', uri => {
        const target = activeAlphatabUri(uri);
        if (!target) {
            void vscode.window.showInformationMessage('没有可预览的 .alphatab 文件');
            return;
        }
        AlphatabPanel.reveal(context, diagnostics, target);
    });

    const withPanel = (uri: vscode.Uri | undefined, action: (panel: AlphatabPanel) => void) => {
        const target = activeAlphatabUri(uri);
        const panel = target ? AlphatabPanel.forUri(target) : AlphatabPanel.active;
        if (panel) {
            action(panel);
        }
    };

    command('playPause', uri => withPanel(uri, p => p.transport('playPause')));
    command('stop', uri => withPanel(uri, p => p.transport('stop')));
    command('toggleAB', uri => withPanel(uri, p => p.transport('toggleAB')));
    command('toggleLoop', uri => withPanel(uri, p => p.transport('toggleLoop')));

    command('runGate', uri => {
        const target = activeAlphatabUri(uri);
        if (!target) {
            return;
        }
        const document = vscode.workspace.textDocuments.find(
            d => d.uri.toString() === target.toString()
        );
        const text = document?.getText() ?? readFileSafe(target.fsPath);
        if (text === undefined) {
            return;
        }
        void companion.run(target, text).then(gate => {
            if (!gate) {
                void vscode.window.showInformationMessage(
                    'alphaTab: 当前文件没有找到可用的伴生工具'
                );
            }
        });
    });

    command('snapshot', uri => {
        const target = activeAlphatabUri(uri);
        if (target) {
            void snapshot(target, 'vscode 手动快照');
        }
    });

    command('importSoundFont', async uri => {
        const uris = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: false,
            filters: { 'SoundFont': ['sf2'] },
            title: '导入音色库 (SoundFont)'
        });
        if (!uris || uris.length === 0) {
            return;
        }
        const file = uris[0].fsPath;
        const config = vscode.workspace.getConfiguration('alphatab');
        const fonts = config.get<string[]>('soundFonts', []) || [];
        if (!fonts.includes(file)) {
            const newFonts = [...fonts, file];
            await config.update('soundFonts', newFonts, vscode.ConfigurationTarget.Global);
        }
        await config.update('defaultSoundFont', file, vscode.ConfigurationTarget.Global);
    });

    command('setDefaultSoundFont', async (uri, fontUri: string, label?: string) => {
        if (!label) return;
        const config = vscode.workspace.getConfiguration('alphatab');
        await config.update('defaultSoundFont', label, vscode.ConfigurationTarget.Global);
    });

    command('pickPartner', async uri => {
        const target = activeAlphatabUri(uri);
        if (!target) return;
        const panel = AlphatabPanel.forUri(target);
        if (!panel) return;
        
        const uris = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: false,
            filters: { 'alphaTab': ['alphatab', 'tex', 'gp3', 'gp4', 'gp5', 'gp'] },
            defaultUri: vscode.Uri.file(fspath.dirname(target.fsPath)),
            title: '选择对照参照谱'
        });
        
        if (!uris || uris.length === 0) return;
        
        const partnerUri = uris[0];
        let alphatex: string;
        try {
            alphatex = fs.readFileSync(partnerUri.fsPath, 'utf-8');
        } catch {
            return;
        }
        
        const dir = fspath.dirname(target.fsPath);
        let sidecar: Sidecar | undefined;
        try {
            sidecar = JSON.parse(fs.readFileSync(fspath.join(dir, 'sidecar.json'), 'utf-8')) as Sidecar;
        } catch {
            sidecar = undefined;
        }
        
        const forward = barMapFromSidecar(sidecar);
        // We assume the active file is the cover (tab), and the picked file is the source.
        panel.setPartner({
            alphatex,
            fileName: fspath.basename(partnerUri.fsPath),
            barMap: forward
        });
    });

    command('print', async uri => {
        const target = activeAlphatabUri(uri);
        if (!target) return;
        const document = vscode.workspace.textDocuments.find(d => d.uri.toString() === target.toString());
        const text = document?.getText() ?? readFileSafe(target.fsPath);
        if (text === undefined) return;

        const tmpHtml = fspath.join(require('os').tmpdir(), `alphatab-print-${Date.now()}.html`);
        const b64 = Buffer.from(text).toString('base64');
        const html = `<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>Print - ${fspath.basename(target.fsPath)}</title>
    <script src="https://cdn.jsdelivr.net/npm/@coderline/alphatab@latest/dist/alphaTab.js"></script>
    <style>body { margin: 0; padding: 0; }</style>
</head>
<body>
    <div id="alphaTab"></div>
    <script>
        const tex = decodeURIComponent(escape(atob("${b64}")));
        const api = new alphaTab.AlphaTabApi(document.getElementById('alphaTab'), {
            display: { layoutMode: 'page' },
            player: { enablePlayer: false }
        });
        api.renderFinished.on(() => {
            setTimeout(() => window.print(), 500);
        });
        api.tex(tex);
    </script>
</body>
</html>`;
        fs.writeFileSync(tmpHtml, html);
        await vscode.env.openExternal(vscode.Uri.file(tmpHtml));
    });

    // 诊断跟着文档走，不需要先打开预览面板。alphaTab 的解析器在进程内就能跑，
    // 所以这一条几乎不花钱。
    const refresh = (document: vscode.TextDocument) => {
        if (document.languageId !== 'alphatab') {
            return;
        }
        diagnostics.setParseDiagnostics(document.uri, ScoreModel.parse(document.getText()));
    };

    context.subscriptions.push(
        vscode.workspace.onDidOpenTextDocument(refresh),
        vscode.workspace.onDidChangeTextDocument(event => refresh(event.document)),
        vscode.workspace.onDidCloseTextDocument(document => {
            if (document.languageId === 'alphatab') {
                diagnostics.forget(document.uri);
                companion.clear(document.uri);
            }
        }),
        // 编辑器光标 → 预览。这是原有「点音符跳到源码」的反方向：
        // 在源码里移动光标，预览会滚到对应的小节。
        vscode.window.onDidChangeTextEditorSelection(event => {
            const document = event.textEditor.document;
            if (document.languageId !== 'alphatab') {
                return;
            }
            if (!vscode.workspace.getConfiguration('alphatab', document.uri).get<boolean>('syncCursor', true)) {
                return;
            }
            // 只响应人为移动光标，避免和预览点音符造成的选区变化打架
            if (event.kind !== vscode.TextEditorSelectionChangeKind.Keyboard &&
                event.kind !== vscode.TextEditorSelectionChangeKind.Mouse) {
                return;
            }
            const panel = AlphatabPanel.forUri(document.uri);
            if (!panel) {
                return;
            }
            const position = event.selections[0]?.active;
            if (!position) {
                return;
            }
            const address = ScoreModel.parse(document.getText())
                .addressAt(position.line, position.character);
            if (address) {
                panel.revealAddress(address);
            }
        }),
        vscode.workspace.onDidSaveTextDocument(document => {
            if (document.languageId !== 'alphatab') {
                return;
            }
            const config = vscode.workspace.getConfiguration('alphatab', document.uri);
            if (config.get<boolean>('companion.snapOnSave', false)) {
                void snapshot(document.uri, 'vscode 存盘前快照');
            }
            if (config.get<string>('companion.runOn', 'save') === 'save') {
                void companion.run(document.uri, document.getText());
            }
        })
    );
    for (const document of vscode.workspace.textDocuments) {
        refresh(document);
    }
}

function readFileSafe(path: string): string | undefined {
    try {
        return fs.readFileSync(path, 'utf-8');
    } catch {
        return undefined;
    }
}

export function deactivate(): void {
    AlphatabPanel.disposeAll();
}
