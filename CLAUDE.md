# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A VS Code extension that previews alphaTex guitar-tablature source (`.alphatab` files) in a
webview, with audio playback. This checkout is a **fork** of `LSTM-Kirigaya/vscode-alphatab`;
its reason for existing is a set of webview workarounds (commit `ea0e8c5`) documented under
[Invariants](#invariants) below. Without them the preview renders blank and the webview console
floods with `importScripts` NetworkErrors.

## Commands

- `npm run watch` — webpack in watch mode (`src/extension.ts` → `dist/extension.js`)
- `npm run compile` — one-shot webpack build
- `npm run lint` — `eslint src --ext ts` (legacy `.eslintrc.json`, not flat config)
- `npm run package` — production build; also the `vscode:prepublish` hook
- `npx --yes @vscode/vsce package` — build the VSIX. `vsce` is deliberately not a devDependency.
  Output is ~137 MB and slow to produce, because `webview/sound/*.sf2` (~160 MB) is not
  excluded by `.vscodeignore`.

**There are no tests.** `npm test` runs `node ./out/test/runTest.js`, but `src/test/` does not
exist, so it fails with MODULE_NOT_FOUND. `mocha`, `glob`, and `@vscode/test-electron` are
installed but unused, and the "Extension Tests" launch config points at a nonexistent path —
all leftover Yeoman scaffolding. Never report a passing test run here. `npm run pretest` only
meaningfully exercises tsc + webpack + eslint.

## Dev loop

F5 → "Run Extension", which runs the `npm: watch` build task first.

Note the asymmetry between the two halves: `webview/alphatab.html` is read from disk at
panel-open time, so editing it needs **no rebuild** — just reopen the preview. Editing
`src/*.ts` requires the webpack watch to pick it up and the extension host to restart.

## Architecture

Two halves connected by one narrow message channel.

**Extension host** (bundled by webpack):
- `src/extension.ts` — `activate()` registers the completion provider and the
  `alphatab.preview` command. Neither is pushed to `context.subscriptions`.
- `src/webview.ts` — essentially all the logic: panel creation, HTML rewriting, settings,
  message protocol, debounced re-render on document change.
- `src/provider.ts` + `src/tab-keywords.ts` — static `\keyword` completions, triggered on `\`.
  Despite `registerLSP`'s name and the three `vscode-languageserver*` runtime dependencies,
  **there is no language server**; those dependencies are unused.

**Webview** (shipped verbatim, not bundled, not type-checked):
- `webview/alphatab.html` — the entire client app in vanilla JS, inline `<script>`, plus a
  `<style>` block after `</html>`.

**Asset URI rewriting.** `getWebviewContent` (`src/webview.ts:6`) reads the HTML and rewrites
paths with a regex that matches only double-quoted `href`/`src` on `<link>`, `<script>`, and
`<img>`. Any new local asset must be referenced in one of those exact forms or it will 404.
The soundfont directory is the exception — it is resolved separately by `getSoundDirUri` and
passed in every message as `sf2Dir`.

**Message protocol.** Exactly two shapes:

| Direction | Message | Notes |
|---|---|---|
| webview → ext | `{ type: 'ready' }` | the only outbound message; no error/status channel back |
| ext → webview | `{ alphatex, setting, sf2Dir }` | sent on `ready`, then on doc change (100 ms debounce) |

The webview's handler does `message.alphatex.trim()` unconditionally (`alphatab.html:174`), so
any new extension→webview message lacking `alphatex` will throw. Add a `message.type` switch
there before introducing a second message type.

**Scope.** Only `.alphatab` plain text, rendered from alphaTex markup (`core.tex: true`).
There is no custom editor, no Guitar Pro / MusicXML support, and no binary file loading.

## Invariants

These are the fork's bug fixes. Each looks removable in isolation; each breaks the extension.

1. **`core.useWorkers: false`** — set at `src/webview.ts:55` and forced again at
   `alphatab.html:127`. Workers in a VS Code webview cannot `importScripts` the cross-origin
   `vscode-cdn.net` URL that alphaTab auto-detects.
2. **The blob `core.scriptFile`.** `prepareWorkerScript()` (`alphatab.html:53`) fetches the
   bundle on the main thread and wraps it in a same-origin `blob:` URL, because the
   *synthesizer* must still run in a worker. It locates the bundle via
   `document.querySelector('script[src*="alphaTab.min.js"]')`, so **the filename must keep the
   literal substring `alphaTab.min.js`** after URI rewriting. Renaming or content-hashing it
   disables playback silently — the failure is caught and only `console.warn`ed.
3. **`player.outputMode` = `WebAudioScriptProcessor`.** AudioWorklet's `addModule()` hits the
   same cross-origin problem. The literal `1` at `src/webview.ts:64` and the named enum at
   `alphatab.html:131` are duplicated and must stay in agreement.
4. **The `ready` handshake** (`src/webview.ts:97`). `postMessage` calls made before the
   webview attaches its listener are silently dropped; sending initial content at panel
   creation was the blank-preview bug.
5. **`webview/font/` must remain a sibling of `webview/alphaTab.min.js`.** Nothing sets
   `core.fontDirectory`; alphaTab derives the Bravura path from the script URL. Moving either
   breaks music glyph rendering with no clear error.
6. **No CSP or `localResourceRoots` is configured today.** If you add one, it must allow
   `connect-src` to `webview.cspSource` plus `worker-src`/`script-src blob:`, or invariant 2
   breaks.

## Vendored assets

`webview/alphaTab.min.js` and `webview/font/Bravura.*` are hand-copied from
`node_modules/@coderline/alphatab/dist/` (currently byte-identical to v1.8.4). The package is
a devDependency purely as the copy source — **there is no copy script**, and `npm install`
does not refresh them. Upgrading alphaTab means bumping the devDependency and then manually
copying both the JS bundle and the font files.

## Settings precedence

`src/webview.ts:50-66` builds a settings object and posts it; `alphatab.html:114-137` then
overrides several of the same fields. **The webview side wins** — extension-side values are
effectively first-render defaults. Currently overridden there: `core.useWorkers`,
`player.outputMode`, `player.soundFont`, and `staveProfile` (the latter two track the toolbar
dropdowns). A third `defaultSetting` at `alphatab.html:98` is unused and has a stale relative
`soundFont` path.

## Conventions

- Explanatory comments in `src/webview.ts` and `alphatab.html` are in Chinese; UI strings are
  localized via `package.nls.json` / `package.nls.zh-cn.json`. Match the surrounding language
  when editing.
- `tsconfig.json` is `strict: true`, ES2020, with `lib: ["ES2020"]` only — **no DOM lib**, so
  TypeScript files must not touch the DOM.
- Dead code, so it is not mistaken for a live path: `getSoundFileUri` (`src/webview.ts:20`),
  `debounceRender` (`alphatab.html:162`), `defaultSetting` (`alphatab.html:98`), and
  `keywordDefault`'s values (only `Object.keys` is consumed).
