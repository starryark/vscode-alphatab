import * as fspath from 'path';
import * as fs from 'fs';

import * as vscode from 'vscode';

function getWebviewContent(extensionPath: string, panel?: vscode.WebviewPanel): string {
    // 找到你的 index.html 所在文件夹的绝对路径
    const htmlRoot = fspath.join(extensionPath, 'webview');
    const htmlIndexPath = fspath.join(htmlRoot, 'alphatab.html');
    const html = fs.readFileSync(htmlIndexPath, 'utf-8').replace(/(<link.+?href="|<script.+?src="|<img.+?src=")(.+?)"/g, (m, $1, $2) => {
        const absLocalPath = fspath.resolve(htmlRoot, $2);
        // this.panel 就是你创建的 webview 对象
        const webviewUri = panel?.webview.asWebviewUri(vscode.Uri.file(absLocalPath));
        const replaceHref = $1 + webviewUri?.toString() + '"';
        return replaceHref;
    });
    return html;
}

function getSoundFileUri(context: vscode.ExtensionContext, soundFile: string, panel?: vscode.WebviewPanel) {
    const soundFilePath = fspath.join(context.extensionPath, 'webview', 'sound', soundFile);
    return panel?.webview.asWebviewUri(vscode.Uri.file(soundFilePath)).toString();
}

function getSoundDirUri(context: vscode.ExtensionContext, panel?: vscode.WebviewPanel) {
    const soundFilePath = fspath.join(context.extensionPath, 'webview', 'sound');
    return panel?.webview.asWebviewUri(vscode.Uri.file(soundFilePath)).toString();
}

export function openAlphatabPreview(context: vscode.ExtensionContext, uri?: vscode.Uri) {
    const targetUri = uri ?? vscode.window.activeTextEditor?.document.uri;
    const panel = vscode.window.createWebviewPanel(
        'alphatab',
        'Alphatab',
        vscode.ViewColumn.Two,
        {
            enableScripts: true,
            enableCommandUris: true,
            enableFindWidget: true,
            enableForms: true
        }
    );
    
    const iconPath = fspath.join(context.extensionPath, 'icon', 'guitar.dark.svg');
    
    panel.iconPath = vscode.Uri.file(iconPath);
    const html = getWebviewContent(context.extensionPath, panel);
    panel.webview.html = html;

    const setting = {
        staveProfile: 'default',
        core: {
            tex: true,
            // webview 的 worker 无法加载 vscode-resource 脚本，渲染放主线程
            useWorkers: false
        },
        notation: {
            rhythmMode: 'showwithbars',
        },
        player: {
            enablePlayer: true,
            soundFont: '',
            // 1 = WebAudioScriptProcessor，避开 AudioWorklet 加载失败
            outputMode: 1
        }
    };
    const sf2Dir = getSoundDirUri(context, panel);

    let debouncePostMessageHandler: NodeJS.Timeout | undefined = undefined;
    function debouncePostMessage(message: any) {
        if (debouncePostMessageHandler !== undefined) {
            clearTimeout(debouncePostMessageHandler);
        }
        debouncePostMessageHandler = setTimeout(() => {
            debouncePostMessageHandler = undefined;
            panel.webview.postMessage(message);
        }, 100);
    }

    function readTargetAlphatex(): string | undefined {
        if (!targetUri) {
            return undefined;
        }
        const document = vscode.workspace.textDocuments.find(d => d.uri.toString() === targetUri.toString());
        if (document) {
            return document.getText();
        }
        try {
            return fs.readFileSync(targetUri.fsPath, 'utf-8');
        } catch {
            return undefined;
        }
    }

    // 等 webview 加载完 alphaTab.min.js 并发来 ready 后再发送初始内容，
    // 否则消息会在监听器注册之前被丢弃，导致预览一片空白
    const readyListener = panel.webview.onDidReceiveMessage(message => {
        if (message && message.type === 'ready') {
            const alphatex = readTargetAlphatex();
            if (alphatex !== undefined) {
                panel.webview.postMessage({ alphatex, setting, sf2Dir });
            }
        }
    });

    const changeListener = vscode.workspace.onDidChangeTextDocument(e => {
        if (e.contentChanges.length === 0) {
            return;
        }
        if (targetUri ? e.document.uri.toString() !== targetUri.toString() : e.document.languageId !== 'alphatab') {
            return;
        }
        debouncePostMessage({ alphatex: e.document.getText(), setting, sf2Dir });
    });

    panel.onDidDispose(() => {
        if (debouncePostMessageHandler !== undefined) {
            clearTimeout(debouncePostMessageHandler);
        }
        readyListener.dispose();
        changeListener.dispose();
    });
}