# Change Log

All notable changes to the "alphatab" extension are documented in this file.
This fork diverges from [LSTM-Kirigaya/vscode-alphatab](https://github.com/LSTM-Kirigaya/vscode-alphatab)
at 0.0.2; everything from 0.0.4 onward is fork-only.

The format follows [Keep a Changelog](http://keepachangelog.com/).

## [0.1.0] — 2026-07-28

### Added

- **A/B audition mode.** One panel holds both the arrangement and its reference score; `Alt+B`
  swaps between them, keeping the bar position and resuming playback where it left off. When a
  `sidecar.json` is present its `tabBars`/`sourceBars` entries drive a piecewise bar mapping, so
  the swap lands on the corresponding bar even where the two scores do not line up 1:1. Loop
  range, speed and metronome are shared across both sides.
- **Real transport controls**: stop, a seek bar with bar and time readouts, **loop over a bar
  range**, playback speed, metronome, count-in, master volume, zoom, page/horizontal layout,
  display transpose, per-track mute/solo, print, and MIDI export. Previously there was one
  play/pause button and two dropdowns.
- **Diagnostics in the Problems panel.** alphaTab's own lexer and parser diagnostics are read
  in-process and update as you type — no subprocess, and a partially broken file still reports
  precise positions instead of failing wholesale.
- **Companion tool integration.** Any CLI that takes a file and prints JSON can feed the Problems
  panel and a status-bar gate indicator. A `piano-to-guitar` preset auto-detects that toolchain
  and runs `validate` / `playability`, plus `check` when a `sidecar.json` and digest are present.
  `alphatab.companion.snapOnSave` optionally runs `history.mjs snap` before each save.
- **Editing features**: hover on `\keywords` and on fret tokens (`5.3` → *G3 · string 3 · fret 5*),
  document symbols and folding from `\section`, snippets, and completions that carry
  documentation and insert real snippet bodies. The keyword table grew from 12 entries to 44.
- **Editor → preview cursor sync**, the reverse of the existing click-a-note-to-jump behaviour.
- **User settings.** The extension previously had none; everything was hardcoded.
- Keybindings: `Alt+Space` play/pause, `Alt+B` A/B, `Alt+L` loop.
- A test suite (49 cases). `npm test` previously failed with MODULE_NOT_FOUND because
  `src/test/` did not exist.

### Changed

- **The webview no longer rebuilds the player on every keystroke.** It kept one `AlphaTabApi`
  instance and updates through `api.tex()`, so an edit no longer re-fetches and re-decodes the
  soundfont — with a 92 MB instrument bank that was a 92 MB reload per debounced keystroke — and
  scroll position, playback position and loop range now survive editing.
- The webview is bundled TypeScript sharing a typed message protocol with the extension host,
  replacing the hand-written inline script. Every message is now tagged and switched on; the old
  handler called `message.alphatex.trim()` unconditionally and threw on any other shape.
- One preview panel per file, titled with the file name, reusing the existing panel instead of
  stacking a new one per invocation, and surviving being hidden.
- Score colours follow the VS Code theme without flattening alphaTab's own highlight colours, and
  the toolbar no longer lets the score scroll underneath it.
- Playback and worker failures are reported to the user instead of only reaching the console.

### Fixed

- **`npm ci` no longer fails.** `@coderline/alphatab` is imported at runtime by
  `src/ast-parser.ts` but was missing from `package.json` entirely (it existed only in
  `package-lock.json`). It is now a declared dependency. Previously a clean install
  pruned the package and the webpack build broke.
- **The `.vsix` shrank from 137 MB to a few MB.** `.vscodeignore` did not exclude
  `webview/sound/**` (~162 MB of soundfonts). Only the 1.3 MB general-purpose bank
  ships now; the legacy `Bravura.eot`/`.svg` fonts and the demo GIFs are excluded too.
- **Score source is no longer parsed as HTML.** The webview assigned the document text
  with `innerHTML` while `enableScripts` and `enableCommandUris` were both on, so a
  crafted `.alphatab` file could run JavaScript and invoke VS Code commands. alphaTab
  reads `textContent` under `core.tex`, so the assignment now uses `textContent` — which
  also stops titles and lyrics containing `<` or `&` from being mangled.
- **Fret notation is highlighted again.** The TextMate number rules were written as
  `[0-9]+\\.[0-9]+`, which in JSON is *backslash followed by any character*, not an
  escaped dot — so `12.2` never matched and only the bare-integer rule fired. Numbers
  are also rescoped from `support.function.number.` to `constant.numeric`.
- Command registration and the completion provider are now disposed via
  `context.subscriptions` instead of being leaked.
- **Clicking a note jumped to the wrong line in any multi-track file.** The webview reported the
  rendered model's per-staff bar index, but the resolver indexed the flat alphaTex AST, where
  every track's bars sit end to end. Track 1's bar 0 is `ast.bars[2]` in a two-track file. The
  mapping is now rebuilt explicitly and cross-checked against alphaTab's own model.
- A single note click sent two messages (`noteMouseDown` and `beatMouseDown` both fire); the
  coarser one could arrive last and replace the precise note selection.
- Emptying a file left the previous score on screen.
- Playback used a load guard that could never fire, and its user-facing message called a function
  that did not exist.
- The play-along highlight rule referenced `--main-color`, a variable defined nowhere.

### Changed

- The webview may only read from the extension's own `webview/` directory
  (`localResourceRoots`), and `enableCommandUris` is off — nothing used it.
- `npm run sync:vendor` copies `alphaTab.min.js` and the Bravura fonts out of
  `node_modules`; `npm run check:vendor` fails the build on drift. These files were
  hand-copied before, so a dependency bump could silently leave `webview/` stale.
- Dropped the three unused `vscode-languageserver*` runtime dependencies. Despite
  `registerLSP`'s name there is no language server.

## [0.0.5] — 2026-07-21

- Clicking a note or beat in the preview moves the editor cursor and selection to the
  corresponding note in the `.alphatab` source.

## [0.0.4] — 2026-07-17

- Fixed the repeated `importScripts` NetworkError that left the preview blank. Workers
  in a VS Code webview cannot load the cross-origin `vscode-cdn.net` URL alphaTab
  auto-detects, so the bundle is fetched on the main thread and handed to the
  synthesizer worker as a same-origin `blob:` URL, rendering moves to the main thread
  (`core.useWorkers: false`), and audio uses the ScriptProcessor path rather than
  AudioWorklet.
- Fixed the blank preview on open: the extension now waits for a `ready` handshake
  before sending initial content, instead of posting a message the webview was not yet
  listening for.
- Upgraded the bundled alphaTab to v1.8.4 and refreshed the Bravura fonts.

## [0.0.2] — 2024-08-19

- Audio playback with three selectable guitar soundfonts.

## [0.0.1] — 2024-07-08

- Initial release: render alphaTex in a preview webview, `\keyword` completions.
