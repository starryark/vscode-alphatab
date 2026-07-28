# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A VS Code extension that previews alphaTex guitar-tablature source (`.alphatab` files) in a
webview, with audio playback, gate diagnostics, and an A/B compare mode.

This checkout is a **fork** of `LSTM-Kirigaya/vscode-alphatab`. Its reason for existing is a set
of webview workarounds documented under [Invariants](#invariants), plus first-class support for
the `Piano-to-Guitar` workflow (see [Companion tools](#companion-tools)). Without the invariants
the preview renders blank and the webview console floods with `importScripts` NetworkErrors.

## Commands

- `npm run watch` — webpack in watch mode, **both** bundles (extension host + webview app)
- `npm run compile` — one-shot build of both
- `npm run lint` — `eslint src --ext ts` (legacy `.eslintrc.json`, not flat config)
- `npm test` — `pretest` (vendor check + tsc + lint) then mocha over `out/test/**/*.test.js`
- `npm run sync:vendor` / `npm run check:vendor` — refresh / verify the vendored alphaTab assets
- `npx --yes @vscode/vsce package` — build the VSIX (~2.4 MB). `vsce` is deliberately not a devDependency.

## Dev loop

F5 → "Run Extension", which runs the `npm: watch` build task first.

**Both halves now require a rebuild.** This is a change from the old layout, where
`webview/alphatab.html` was read from disk at panel-open time and could be edited without
rebuilding. The webview is now bundled TypeScript, and the HTML shell is generated in
`src/panel.ts` (`buildHtml`). `npm run watch` covers both entry points, so in practice you edit
and reload the webview like any other source file.

## Architecture

Two halves connected by one typed message channel.

**Extension host** (webpack `target: node` → `dist/extension.js`):

| File | Role |
|---|---|
| `src/extension.ts` | `activate()`; registers commands, language providers, document listeners. Everything goes into `context.subscriptions`. |
| `src/panel.ts` | `AlphatabPanel` — one panel per document URI, HTML generation, message dispatch, debounced re-render. |
| `src/score-model.ts` | Wraps alphaTab's `AlphaTexParser`. Address ↔ source-range lookup, `\section` list, parser diagnostics. **Imports no `vscode`**, so it unit-tests directly. |
| `src/protocol.ts` | The message union. Imported by *both* halves — change it and the other side fails to compile. |
| `src/diagnostics.ts` | One `DiagnosticCollection` fed from two independent sources (parser + companion). |
| `src/bar-map.ts` | A-side ↔ B-side bar mapping from `sidecar.json`. vscode-free, unit-tested. |
| `src/partner.ts` | Finds the A/B counterpart file. |
| `src/fretboard.ts` | Fret ↔ pitch math. **The single string-numbering inversion boundary** (see below). |
| `src/provider.ts` | Completion, hover, document symbols, folding. |
| `src/tab-keywords.ts` | The alphaTex keyword table with docs and snippet bodies. |
| `src/companion/` | Companion-tool contract, subprocess runner, Piano-to-Guitar adapter, VS Code service. |

**Webview** (webpack `target: web` → `webview/dist/app.js`):

| File | Role |
|---|---|
| `webview/src/main.ts` | Bootstrap, `ready` handshake, message dispatch, A/B toggle. |
| `webview/src/score-view.ts` | One `AlphaTabApi` instance; **incremental `api.tex()`**, never destroy-and-rebuild. |
| `webview/src/toolbar.ts` | Transport, loop, sections, tracks, display controls. |
| `webview/src/worker-blob.ts` | The same-origin blob wrapper for the synthesizer worker. |
| `webview/src/alphatab-global.ts` | `import type` only — alphaTab is loaded as a plain UMD `<script>`, not bundled. |
| `webview/styles.css` | Theme-aware styling. Replaced Bulma (633 KB for three classes). |

**Why alphaTab is not bundled into the webview app:** the synthesizer worker needs the bundle's
*raw text* to build a same-origin blob (invariant 2), so the file must exist standalone
regardless. Bundling it too would ship the same 1.1 MB twice. `app.js` is ~16 KB as a result.

**Message protocol.** Every message carries `type`; receivers switch on it before touching any
other field. See `src/protocol.ts` for the full union.

| Direction | Messages |
|---|---|
| ext → webview | `init`, `scoreChanged`, `renderSettings`, `playerSettings`, `partner`, `transport`, `reveal`, `loop` |
| webview → ext | `ready`, `noteSelect`, `error`, `state`, `command` |

**Scope.** Only alphaTex plain text (`core.tex: true`). There is no custom editor, no Guitar Pro
/ MusicXML import, and no binary file loading.

## Invariants

These are the fork's bug fixes. Each looks removable in isolation; each breaks the extension.

1. **`core.useWorkers: false`** (`webview/src/score-view.ts`). Workers in a VS Code webview
   cannot `importScripts` the cross-origin `vscode-cdn.net` URL alphaTab auto-detects.
2. **The blob `core.scriptFile`** (`webview/src/worker-blob.ts`). Rendering is on the main
   thread, but the *synthesizer* must still run in a worker, so the bundle is fetched on the main
   thread and wrapped in a same-origin `blob:` URL. If this fails, playback is disabled and the
   user is told — it is no longer a silent `console.warn`.
3. **`player.outputMode = WebAudioScriptProcessor`** is the default. AudioWorklet's `addModule()`
   hits the same cross-origin problem. `alphatab.player.outputMode` can select AudioWorklet, but
   it is opt-in and only takes effect on a fresh panel.
4. **The `ready` handshake** (`src/panel.ts`). `postMessage` calls made before the webview
   attaches its listener are silently dropped; sending initial content at panel creation was the
   original blank-preview bug. `post()` queues anything sent before `ready` arrives.
5. **`webview/font/` must remain a sibling of `webview/alphaTab.min.js`.** Nothing sets
   `core.fontDirectory`; alphaTab derives the Bravura path from the script URL.
6. **The CSP in `buildHtml` must keep `script-src blob:`, `worker-src blob:`, `child-src blob:`
   and `connect-src ${cspSource}`** or invariant 2 breaks. `style-src` needs `'unsafe-inline'`
   because alphaTab injects its own `<style>` elements at runtime.

## Verified facts that contradict the docs

Both were checked empirically against alphaTab 1.8.4 and are locked by tests. Do not "fix" the
code to match the documentation.

- **AST `end` locations are exclusive, not inclusive.** `alphaTab.d.ts` documents `end` as
  "The end (inclusive)", but `text.slice(start.offset, end.offset)` yields exactly the token —
  verified on note, beat, bar and chord nodes. `score-model.ts` therefore converts both ends with
  a plain `-1`, and `src/test/score-model.test.ts` pins it.
- **A bar's source range starts at its leading metadata.** `\track "Bass"` on line 7 followed by
  notes on line 9 produces a bar node starting at line 7, because `metaData` belongs to the bar
  that follows it.

## Two numbering traps

**Bar/beat indices.** alphaTab's *rendered model* numbers bars per-staff and beats per-voice,
while the alphaTex *AST* is one flat `ast.bars[]` array across the whole file — `\track`,
`\staff` and `\voice` appear as `metaData` on the following bar. In a two-track file, track 1's
bar 0 is `ast.bars[2]`. The old code indexed the flat AST with the model's per-staff index, so
any file with a second track, staff or voice jumped to the wrong line.

`ScoreModel` rebuilds the `(track, staff, voice, bar)` cursor while walking the flat list. The
rules — a `\staff` configures the current staff when it is still empty and creates a new one
otherwise; `\voice` always creates, because voice 0 is implicit — were derived from real files
and are cross-validated against `ScoreLoader` in the tests.

Per-voice bar counts legitimately differ inside one staff: piano sources routinely write 58 bars
in one voice and 59 in another, and alphaTab pads the short one. So `staff.bars.length` equals
the **max** over voices, not any single voice's count.

**String numbers are inverted.** In alphaTex source (and `\tuning`), string 1 is the *highest*
string (e); in alphaTab's internal model, `note.string` 1 is the *lowest* (E).
`src/fretboard.ts` owns the conversion (`flipStringNumber`); do not re-derive it elsewhere.

## Companion tools

The extension can shell out to any CLI that takes a file and prints JSON, normalize the output
into `Finding`/`ReportRow` (`src/companion/contract.ts`), and surface it in the Problems panel
and the status bar. `src/companion/piano-to-guitar.ts` is the shipped adapter for
`C:\Users\lyang\Code\Music\Piano-to-Guitar`, auto-detected by walking up for `tools/check.mjs`
plus `AGENTS.md`.

Two traps from that project's own docs are encoded in the adapter and covered by tests that use
**recorded real tool output** (`src/test/fixtures/`):

1. **`playability.mjs` exits 1 on warnings too.** Its exit code is not a pass/fail signal —
   pass/fail is `errors.length === 0`. `tools/fixtures/position-jump-slow.alphatab` really does
   exit 1 with 0 errors and 14 warnings.
2. **A `0/0` gate row is a vacuous pass, not a win** (`AGENTS.md` §A.2). Counts exist **only** on
   the bar-aligned form (`hard.compare.hardGates.{melodicSkeleton,harmonicRoots}` as
   `{covered,total,ok}`). The `--map` form (`mapResults`) carries **no counts at all** —
   inventing `0/0` there marks every span vacuous and buries the real signal.

Also: `validate.mjs`'s `errors[]` array holds all three severities (AT400 hint, AT301 warning,
AT202/AT206 error). Map by the `severity` field, not by the array's name.

A subprocess that times out, cannot start, or prints non-JSON is reported as a **failure**, never
as a pass.

`alphatab.companion.snapOnSave` runs `history.mjs snap` before each save. It is **off by
default** because it writes into the user's repository, but it closes the hole
`docs/workflow.md:211` calls out: a hand edit in VS Code is the one tab state the gate loop does
not snapshot on its own.

## Vendored assets

`webview/alphaTab.min.js` and `webview/font/Bravura.{otf,woff,woff2}` are copied from
`node_modules/@coderline/alphatab/dist/` by `scripts/sync-vendor.mjs`. `npm run check:vendor`
runs in `pretest` and fails on drift — previously these were hand-copied and a dependency bump
could silently leave `webview/` stale. `Bravura.eot` and `Bravura.svg` are deliberately not
synced or shipped: no webview engine can use them.

`@coderline/alphatab` is a **runtime `dependency`**, not a devDependency — `src/score-model.ts`
imports its parser and webpack bundles it into the extension host. It was missing from
`package.json` entirely until recently, which made `npm ci` fail outright.

The extension-host bundle defines `__ALPHATAB_WEBPACK__ = false` so alphaTab does not warn about
the missing `@coderline/alphatab-webpack` plugin on every activation. That plugin exists to wire
up workers, fonts and soundfonts, none of which the host uses — it only needs the parser.

## Packaging

The VSIX is ~2.4 MB. It was 137 MB because `.vscodeignore` did not exclude `webview/sound/**`
(~162 MB of soundfonts). Only `sonivox.sf2` (1.3 MB) ships; additional soundfonts are referenced
by absolute path through the `alphatab.soundFonts` setting and stay on the user's disk. If you
add an asset, check whether it belongs in `.vscodeignore`.

## Settings

All under `alphatab.*`, declared in `package.json` → `contributes.configuration` and localized in
`package.nls.json` / `package.nls.zh-cn.json`. The extension previously had **zero** settings and
hardcoded everything in `openAlphatabPreview`.

Unlike the old code — where the webview overrode several host-supplied fields, making the
host-side values first-render defaults — the host is now the single source of truth and the
webview applies what it is given.

## Conventions

- Explanatory comments in `src/` and `webview/src/` are in Chinese; UI strings are localized via
  `package.nls*.json`. Match the surrounding language when editing.
- `tsconfig.json` is `strict`, ES2020, **no DOM lib** — extension-host code must not touch the
  DOM. `webview/tsconfig.json` is the one with DOM, and the root config excludes `webview/`.
- Tests are plain mocha over compiled JS in `out/`; they need no VS Code host, so everything they
  cover must stay `vscode`-free. JSON fixtures are read from `src/test/fixtures/` at runtime
  because `tsc` does not copy them into `out/`.
