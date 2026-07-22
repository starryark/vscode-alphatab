# Alphatab 0.0.5 (fork)

![](https://img.shields.io/badge/typescript-blue)
![](https://img.shields.io/badge/alphatab.js-org)

> This is a fork of [LSTM-Kirigaya/vscode-alphatab](https://github.com/LSTM-Kirigaya/vscode-alphatab) with fixes and features for the preview webview. The upstream extension fails inside modern VS Code with repeated `importScripts` NetworkErrors and a blank preview.

## What this fork fixes & features 🔧

- **Interactive note jumping:** clicking any note or beat in the rendered preview window automatically moves the VS Code text cursor and selection directly to the corresponding source note in the `.alphatab` file.
- **Worker loading (`importScripts` NetworkError):** alphaTab v1.8.4 renders and synthesizes audio in Web Workers, but workers inside a VS Code webview cannot load scripts from the cross-origin `vscode-resource` CDN. The webview now fetches `alphaTab.min.js` on the main thread and hands the workers a same-origin `blob:` URL (`core.scriptFile`), renders on the main thread (`core.useWorkers: false`), and uses the ScriptProcessor audio path instead of AudioWorklet (`player.outputMode`). Rendering and playback both work.
- **Blank preview on open:** the extension now waits for a `ready` handshake from the webview before sending the initial content, so the first message is no longer lost while the page is still loading.
- Upgraded the bundled alphaTab library to v1.8.4 and refreshed the Bravura fonts.

## Install on another device 💻

**Option A — download the prebuilt VSIX (easiest):**

1. Download `alphatab-0.0.5.vsix` from this fork's [Releases page](https://github.com/starryark/vscode-alphatab/releases).
2. Install it (or use VS Code UI: Extensions panel → `···` menu → *Install from VSIX...*):
   ```
   code --install-extension alphatab-0.0.5.vsix
   ```
3. Restart VS Code. If an older `kirigaya.alphatab` version was installed, uninstall it first: `code --uninstall-extension kirigaya.alphatab`.

**Option B — build from source:**

Requires Node.js 18+ and VS Code's `code` command on PATH.

```
git clone https://github.com/starryark/vscode-alphatab.git
cd vscode-alphatab
npm install
npx --yes @vscode/vsce package        # produces alphatab-0.0.5.vsix (~130 MB, includes soundfonts)
code --install-extension alphatab-0.0.5.vsix
```

Then restart VS Code, open a `.alphatab` file, and click the preview button in the editor title bar. To verify the fix, open *Developer: Open Webview Developer Tools* — there should be no `importScripts` errors.

## Feature ⚛️

- Render Tab with alpha tex ( ✔ )
- Play with three different guitar sounds ( ✔ )
- Interactive preview-to-editor note cursor jump ( ✔ )


---

[github repo](https://github.com/LSTM-Kirigaya/vscode-alphatab), beg for star :D

This is a vscode extension impl of the [AlphaTab](https://alphatab.net/). With alpha tex, a format for guitar tab, you can write and render your guitar tab just in vscode.

## Quick Start 🪽

open vscode, create `<name>.alphatab` and write alphatex, click `open preview` in top right corner of your editor and review the score in webview.

<img src="https://github.com/LSTM-Kirigaya/vscode-alphatab/blob/main/figure/output-1.gif?raw=true" />

You can switch render mode (term as stave profile) through first yellow switch block ╰(*°▽°*)╯.

<img src="https://github.com/LSTM-Kirigaya/vscode-alphatab/blob/main/figure/output-2.gif?raw=true" />

You can even play tab with build-in guitar soundfile! I provide three guitar sounds: 8 bit LOFI guitar, Acoustic Guitar and Electric Guitar. You can use the function to have a quick view over the melody 🎸.

<img src="https://github.com/LSTM-Kirigaya/vscode-alphatab/blob/main/figure/output-3.gif?raw=true" />

## Write and Render

Once open the preview, you can write the alphatex, and webview will receive the change debouncively and rerender the score.

If you aren't familiar with alphatex, [here](https://alphatab.net/docs/alphatex/introduction/) is the tutorial.

If you are a guitar fan like me, welcome to visit my website: [https://kirigaya.cn](https://kirigaya.cn).