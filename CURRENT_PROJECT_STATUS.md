# Read-Web Current Project Status

Last scanned: 2026-06-21

This document records the current state of the `E:\read-web` project from the actual file tree and entry files. It should be treated as the primary current-status document when it conflicts with older migration notes.

## 1. What This Project Is

Read-Web is a browser-based language reading tool currently hosted by Vite. It is a migration from a legacy single-page HTML/JavaScript reader into a Vue 3 + Pinia structure.

The project is not a clean Vue-only app yet. It is a working hybrid:

```text
index.html legacy DOM shell
  -> compatibility ES modules under src/stores and src/composables
  -> src/composables/reader-runtime.js thin runtime entry
  -> src/composables/reader-runtime-assembly.js remaining runtime assembly
  -> src/composables/session-init.js thin session entry
  -> src/composables/session-runtime-assembly.js thin session runtime assembly
  -> src/main.js Vue + Pinia mount
```

Current user-facing features include:

- audio file loading and playback
- synchronized transcript reading
- sentence and word highlighting
- page-style auto-follow during playback
- custom hotkeys
- mark import/export
- AI chunk reading mode
- chunk Chinese display modes
- lightweight annotation template export/import
- annotation API settings UI

Recently removed user-facing features:

- manual AI chunk JSON import UI (`导切分`)
- cloze quiz import/rendering UI (`导填空`)
- old notes/definition hotkey (`释义`)
- chunk note bubbles/import/export/style UI and sentence note sidebar runtime

## 2. Current Entry Points

Top-level runtime files:

```text
index.html                         browser entry and legacy DOM shell
src/composables/reader-runtime.js  thin runtime entry, about 28 lines
src/composables/reader-runtime-assembly.js  remaining runtime assembly, about 51 lines
src/composables/session-init.js    thin session entry, about 7 lines
src/composables/session-runtime-assembly.js  session runtime assembly, about 61 lines
src/composables/session-runtime-deps.js  session runtime window/DOM/global dependency collection, about 62 lines
src/composables/session-annotation-runtime.js  session annotation runtime assembly, about 134 lines
src/composables/session-lifecycle-runtime.js  session startup/restore/UI lifecycle assembly, about 102 lines
styles.css                         global styles, about 2322 lines
vite.config.js                     Vite + Vue config
package.json                       scripts and dependencies
src/main.js                        Vue mount, Pinia setup, side-effect imports, about 149 lines
src/App.vue                        root Vue component
src/composables/session-init.js    thin session entry, about 7 lines
src/composables/session-runtime-assembly.js  session runtime assembly, about 61 lines
src/composables/session-runtime-deps.js  session runtime window/DOM/global dependency collection, about 62 lines
src/composables/session-annotation-runtime.js  session annotation runtime assembly, about 134 lines
src/composables/session-lifecycle-runtime.js  session startup/restore/UI lifecycle assembly, about 102 lines
```

There is no `read-26.html` in the current project root. Any reference to `read-26.html` is legacy context from the source project, not the current web app entry.

## 3. Browser Load Order

`index.html` currently loads these scripts in this order:

```text
1. External Google CSE script
2. 9 compatibility store modules under src/stores/
3. 10 compatibility/runtime modules under src/composables/
4. src/composables/reader-runtime.js as an ES module
5. src/composables/session-init.js as an ES module
6. /src/main.js as the Vue + Pinia entry
```

Do not casually reorder these scripts. The app still depends on global side effects and `window.*` exports.

## 4. Current Source Layout

Actual `src/` counts from the current file tree:

```text
src/
  App.vue                         1 root Vue component
  main.js                         1 Vue/Pinia bootstrap module
  components/                     5 Vue components
  composables/                    78 compatibility/runtime modules
  pinia-stores/                   9 real Pinia stores
  stores/                         9 compatibility window stores
  utils/                          11 utility modules
  services/annotation/            14 annotation pipeline modules
```

Current Vue components:

```text
ChunkModeView.vue                 AI chunk rendering
TranscriptContainer.vue           normal transcript rendering
ToastMessage.vue                  toast UI
```

`SentenceNoteSidebar.vue` has been removed from the current tree.

Current composables:

```text
session-init.js                   about 7 lines
session-runtime-assembly.js       about 61 lines
session-runtime-deps.js           about 62 lines
session-annotation-runtime.js     about 134 lines
session-lifecycle-runtime.js      about 102 lines
session-annotation-services.js    about 43 lines
session-annotation-text.js        about 560 lines
session-annotation-export-payload.js about 68 lines
session-annotation-import-normalization.js about 115 lines
session-annotation-bundle-merge.js about 167 lines
session-annotation-generated-index.js about 172 lines
session-annotation-marks.js       about 174 lines
session-annotation-context.js     about 89 lines
session-annotation-lightweight-io.js about 129 lines
session-annotation-api-settings-runtime.js about 27 lines
session-startup-cleanup.js        about 48 lines
session-restore-runtime.js        about 94 lines
session-startup-runtime.js        about 58 lines
session-ui-settings-restore.js    about 69 lines
reader-runtime.js                 about 28 lines
reader-runtime-assembly.js        about 51 lines
reader-feature-runtime.js         about 231 lines
reader-feature-runtime-deps.js    about 100 lines
reader-runtime-context.js         about 45 lines
session-state-provider.js         about 15 lines
runtime-state-bindings.js         about 72 lines
reader-dom-refs.js                about 64 lines
reader-bootstrap-runtime.js       about 45 lines
reader-runtime-deps.js            about 41 lines
reader-notes-session-runtime-deps.js about 28 lines
reader-notes-session-runtime.js   about 41 lines
reader-notes-runtime.js           about 68 lines
reader-session-runtime.js         about 31 lines
reader-interaction-runtime.js     about 40 lines
reader-playback-runtime.js        about 69 lines
reader-controls-runtime.js        about 57 lines
reader-keyboard-runtime.js        about 80 lines
reader-app-runtime.js             about 90 lines
reader-import-runtime.js          about 105 lines
reader-runtime-helpers.js         about 61 lines
import-module.js                  audio/transcript import plus chunk pipeline
keyboard-module.js                about 394 lines
playback-module.js                about 253 lines
playback-runtime-helpers.js       about 103 lines
style-editor.js                   about 211 lines
app-handlers.js                   about 97 lines
visual-vocab-module.js            about 112 lines
audio-identity-module.js          about 86 lines
hotkey-state-module.js            about 35 lines
marks-state-module.js             about 20 lines
transcript-state.js               about 112 lines
chunk-state.js                    about 161 lines
cloze-state.js                    about 109 lines
playback-state.js                 about 85 lines
runtime-state-facade.js           about 8 lines
render-mode.js                    about 9 lines
ui-facades.js                     about 24 lines
session-facades.js                about 129 lines
reader-public-facades.js          about 60 lines
annotation-bubble-resolver.js     about 160 lines
pinia-bridge-module.js            about 41 lines
glass-effects.js                  about 116 lines
controls-module.js                about 63 lines
chunk-controls-module.js          about 222 lines
theme-controls-module.js          about 61 lines
highlight-controls-module.js      about 42 lines
file-input-bindings.js            about 22 lines
legacy-control-bindings.js        about 73 lines
transcript-interactions.js        about 111 lines
chunk-interactions.js             about 136 lines
render-runtime.js                 render bridge runtime
annotation-bubble.js              about 369 lines
annotation-api-settings-ui.js     about 432 lines
annotation-lightweight-module.js  about 99 lines
```

Current annotation service modules:

```text
controller.js                     about 1500 lines
api-client.js                     about 732 lines
api-config.js                     about 483 lines
target-source.js                  about 350 lines
run-diagnostics.js                about 306 lines
block-planner.js                  about 289 lines
storage.js                        about 238 lines
click-resolver.js                 about 190 lines
result-store.js                   about 191 lines
diagnostics-records.js            about 151 lines
diagnostics.js                    about 145 lines
prompt-builder.js                 about 147 lines
progress-store.js                 about 109 lines
diff.js                           about 38 lines
```

## 5. Runtime Architecture

The root `app.js` file has been removed. `src/composables/reader-runtime.js` now only acts as the runtime entry and directly initializes `src/composables/reader-runtime-assembly.js`, which should continue shrinking behind focused module owners.

Current state flow:

```text
src/composables/runtime-state-facade.js runtimeState
  <-> temporary window.__state getter/setter alias
src/composables/reader-runtime.js thin runtime entry
  <-> src/composables/reader-runtime-assembly.js remaining runtime assembly
  <-> src/composables/pinia-bridge-module.js bridgeToPinia compatibility
  <-> src/pinia-stores/*.js real Pinia stores
  <-> Vue components
```

There are two store layers:

- `src/pinia-stores/`: real Pinia stores used by Vue components.
- `src/stores/`: compatibility modules that attach objects such as `window.__themeStore`, `window.__audioStore`, `window.__uiStore`, and similar globals.

`src/main.js` imports utilities and annotation services for side effects, creates the Pinia app, then replaces selected compatibility store methods with Pinia-backed methods.

## 6. Rendering State

`src/composables/render-mode.js` initializes:

```js
window.__USE_VUE_RENDERING = true
```

`src/main.js` then mirrors the render flag into the transcript Pinia store and applies the legacy/Vue container display mode. The Vue components are active, but many interactions still rely on:

- module-bound legacy controls from `src/composables/legacy-control-bindings.js`
- startup context setup delegated through `src/composables/reader-runtime-context.js`
- bootstrap state/helper setup delegated through `src/composables/reader-bootstrap-runtime.js`
- runtime initialization sequence delegated through `src/composables/reader-runtime-assembly.js`
- notes/session composition delegated through `src/composables/reader-notes-session-runtime.js`
- feature runtime setup delegated through `src/composables/reader-feature-runtime.js`
- feature runtime dependency assembly delegated through `src/composables/reader-feature-runtime-deps.js`
- notes/session runtime dependency assembly delegated through `src/composables/reader-notes-session-runtime-deps.js`
- render/playback setup delegated through `src/composables/reader-interaction-runtime.js`
- control setup delegated through `src/composables/reader-controls-runtime.js`
- annotation runtime setup delegated through `src/composables/session-annotation-runtime.js`
- startup/restore/UI settings lifecycle setup delegated through `src/composables/session-lifecycle-runtime.js`
- annotation API settings UI initialization delegated through `src/composables/session-annotation-api-settings-runtime.js`
- keyboard setup delegated through `src/composables/reader-keyboard-runtime.js`
- app/runtime setup delegated through `src/composables/reader-app-runtime.js`
- import/session/runtime-state setup delegated through `src/composables/reader-import-runtime.js`
- `window.xxx` compatibility functions owned by focused composables
- direct DOM reads/writes
- legacy CSS classes

The current cleanup direction should be to keep behavior stable while gradually moving remaining assembly code out of `src/composables/reader-runtime-assembly.js`. `src/composables/reader-runtime.js` is now only the side-effect import entry and assembly initializer.

Transcript, chunk, cloze, and playback transient state have moved behind focused adapters: `src/composables/transcript-state.js`, `src/composables/chunk-state.js`, `src/composables/cloze-state.js`, and `src/composables/playback-state.js`. The transcript/chunk/cloze adapters bind directly to the real Pinia stores after Pinia creation; playback state currently stays in its runtime adapter. `window.__state` fields remain as compatibility facades, but controls/playback/session-init now receive state through explicit deps/provider instead of direct global reads.

## 7. Important Runtime Behaviors

### Audio and Transcript

- Audio is loaded through `#audio-file`.
- Audio identity state (`currentAudioMeta`, `currentAudioKey`, storage-key helpers, and current sentence doc id derivation) now lives in `src/composables/audio-identity-module.js`; `session-init.js` still reaches it through the unchanged `applyCurrentAudioMeta(...)` and `st.currentAudioKey/currentAudioMeta` contract.
- Hotkey state (`markKey`, annotation bubble key, AI chunk keys, and seek keys) now lives in `src/composables/hotkey-state-module.js`; the old notes/definition hotkey has been removed.
- Marks runtime state (`markedMap`) now lives in `src/composables/marks-state-module.js`; `session-init.js` still restores and rebuilds marks through the unchanged `st.markedMap` runtime state contract.
- Transcript JSON is loaded through `#transcript-file`.
- `processTranscript(...)` remains a central transcript ingestion entry; its compatibility window facade is owned by `src/composables/import-module.js`.
- Visual/vocab matching state (`globalVocab`, `vocabMatchMap`, and `window.processVisual`) now lives in `src/composables/visual-vocab-module.js`; `session-init.js` still calls `processVisual(visualData)` through the unchanged compatibility contract.
- Normal transcript rendering is handled by `TranscriptContainer.vue` when Vue rendering is active.
- Normal transcript word click/contextmenu interaction is owned by `TranscriptContainer.vue` plus `src/composables/transcript-interactions.js`; `src/composables/reader-runtime-assembly.js` reaches this through focused runtime modules.
- `window.renderTranscript` and `window.renderChunkMode` have been removed. `session-init.js` now reaches the temporary render boundary through `src/composables/render-runtime.js`, which owns the current Vue bridge render calls plus the legacy cloze fallback binding.
- `session-init.js` now reaches the temporary state boundary through `src/composables/session-state-provider.js`.

### Playback Highlighting and Follow

- `src/composables/playback-module.js` owns the migrated playback update functions.
- `src/composables/playback-state.js` owns playback transient state such as auto-follow, scroll suppression, active highlight element refs, playback loop signature, and sentence previous-tap navigation state.
- `src/composables/playback-runtime-helpers.js` owns playback helper functions for active-class swapping, AI chunk index lookup, page-style follow scrolling, and sentence-mode previous/next jumps; focused reader runtime modules initialize and inject its API.
- Auto-follow now behaves like page turning: when the active sentence reaches the lower trigger area, it scrolls the active sentence near the top of the viewport instead of centering it.
- The follow threshold is based on the current scroll container height, so resizing or zooming recalculates the visible zone dynamically.

### AI Chunk Mode

- Manual chunk JSON loading through `#chunk-file` / `导切分` has been removed.
- `processChunkData(...)` remains the central chunk ingestion entry for restored/generated AI chunk data; its compatibility window facade is owned by `src/composables/import-module.js`.
- `ChunkModeView.vue` renders chunk blocks.
- AI chunk word/chunk click and contextmenu interaction is owned by `ChunkModeView.vue` plus `src/composables/chunk-interactions.js`; `src/composables/reader-runtime-assembly.js` reaches this through focused runtime modules.
- Chunk mode state now goes through `src/composables/chunk-state.js`, which binds to `src/pinia-stores/chunk.js`.
- Highlight mode cycling and the temporary `window.cycleHighlightMode` facade now live in `src/composables/highlight-controls-module.js`; focused reader runtime modules initialize the module.
- AI chunk mode toggle, Chinese visible/hold behavior, focus mode UI, shadow toggle, and the temporary `window.toggleChunkMode` / `window.toggleChunkFocusMode` / `window.toggleChunkShadowManual` / `window.updateChunkCnHoldBtn` facades now live in `src/composables/chunk-controls-module.js`; focused reader runtime modules initialize the module and pass its API to keyboard/import callers.
- Chunk mode defaults are currently focus-oriented:
  - sentence highlighting by default
  - Chinese hidden unless held, depending on current state
  - focus mode available through `#btn-chunk-focus`

### Removed Cloze And Notes

- Cloze quiz UI, cloze import, cloze interaction helpers, and cloze Vue components have been removed.
- Chunk note DOM, chunk note import/export/style UI, chunk note layout helpers, and `notes-module.js` have been removed from the active runtime.
- Sentence note sidebar behavior has been removed from the active runtime.
- `src/composables/reader-notes-runtime.js` now returns no-op compatibility APIs so older session/public facade callers do not crash while those compatibility surfaces are drained.

### Annotation Tools

- Full generated-annotation prompt UI was removed from the main toolbar.
- Lightweight annotation export/import remains:
  - `#btn-export-annotation-lightweight`
  - `#btn-import-annotation-lightweight`
  - `#import-annotation-lightweight-file`
- Lightweight annotation import/export button glue now lives in `src/composables/annotation-lightweight-module.js`; session-side export/import/merge behavior lives in `src/composables/session-annotation-*.js` and `src/composables/session-annotation-lightweight-io.js`, with handlers injected explicitly instead of using `window.__session_exportManualLightweightAnnotations` / `window.__session_importManualLightweightAnnotations`.
- API settings UI now lives in `src/composables/annotation-api-settings-ui.js`; session initialization reaches it directly through `src/composables/session-annotation-api-settings-runtime.js`, all `window.__session_*` internal bridge facades have been retired, and `index.html` no longer loads the root regular script.

## 8. Current Commands

```bash
npm run dev
npm run build
npm run verify:vite
npm run verify:playback
npm run verify:interactions
npm run verify:vocab-matching
npm run verify:chunk-notes-state
npm run verify:chunk-state
npm run verify:cloze-state
npm run verify:playback-state
npm run verify:playback-runtime-helpers
npm run verify:state-facades
npm run verify:bridge-startup
npm run verify:file-input-bindings
npm run verify:inline-handler-bindings
npm run verify:control-playback-state-deps
npm run verify:session-state-provider
npm run verify:session-runtime-assembly
npm run verify:session-runtime-deps
npm run verify:session-lifecycle-runtime
npm run verify:session-annotation-services
npm run verify:session-annotation-text
npm run verify:session-annotation-export-payload
npm run verify:session-annotation-import-normalization
npm run verify:session-annotation-bundle-merge
npm run verify:session-annotation-runtime
npm run verify:session-annotation-generated-index
npm run verify:session-annotation-marks
npm run verify:session-annotation-context
npm run verify:session-annotation-lightweight-io
npm run verify:session-annotation-api-settings-runtime
npm run verify:session-startup-cleanup
npm run verify:session-restore-runtime
npm run verify:session-startup-runtime
npm run verify:session-ui-settings-restore
npm run verify:runtime-state-source
npm run verify:reader-runtime-shell
npm run verify:reader-runtime-assembly
npm run verify:reader-runtime-context
npm run verify:reader-feature-runtime
npm run verify:reader-feature-runtime-deps
npm run verify:reader-bootstrap-runtime
npm run verify:reader-runtime-deps
npm run verify:reader-notes-session-runtime-deps
npm run verify:reader-notes-session-runtime
npm run verify:reader-notes-runtime
npm run verify:reader-session-runtime
npm run verify:reader-interaction-runtime
npm run verify:reader-playback-runtime
npm run verify:reader-controls-runtime
npm run verify:reader-keyboard-runtime
npm run verify:reader-app-runtime
npm run verify:reader-import-runtime
npm run verify:reader-runtime-helpers
npm run verify:reader-dom-refs
npm run verify:app-window-facades
npm run verify:pinia-bridge-module
npm run verify:audio-store-facades
npm run verify:chunk-note-style-facades
npm run verify:keyboard-facades
npm run verify:import-facades
npm run verify:chunk-controls-module
npm run verify:highlight-controls-module
npm run verify:theme-controls-module
npm run verify:glass-effects
npm run verify:style-editor-module
npm run verify:app-handlers
npm run verify:marks-store
npm run verify:marks-state-module
npm run verify:visual-vocab-module
npm run verify:legacy-dom-drain
npm run verify:audio-identity-module
npm run verify:hotkey-state-module
npm run verify:transcript-interactions
npm run verify:chunk-interactions
npm run verify:render-facades
npm run verify:script-order
npm run verify:annotation-bubble
npm run verify:annotation-api-settings-ui
npm run verify:legacy-root-copy
npm run verify:production-preview
npm test
```

Ports:

```text
dev server:          http://127.0.0.1:5173/
verification server: http://127.0.0.1:4173/
```

`npm test` runs `npm run verify:vite`, which starts the Vite verification flow and runs the Playwright checks.

## 9. Verification Coverage

Current verification scripts:

```text
scripts/vite-verify.js
scripts/vite-verify.cjs
scripts/read26-load-check.js
scripts/read26-load-check.cjs
scripts/read-web-playback-check.cjs
scripts/read-web-interactions-check.cjs
scripts/vocab-matching-helper-check.cjs
scripts/annotation-lightweight-module-check.cjs
scripts/transcript-state-check.cjs
scripts/chunk-state-check.cjs
scripts/cloze-state-check.cjs
scripts/playback-state-check.cjs
scripts/state-facade-owner-check.cjs
scripts/bridge-startup-check.cjs
scripts/file-input-bindings-check.cjs
scripts/inline-handler-bindings-check.cjs
scripts/control-playback-state-deps-check.cjs
scripts/session-state-provider-check.cjs
scripts/session-runtime-assembly-check.cjs
scripts/session-runtime-deps-check.cjs
scripts/session-lifecycle-runtime-check.cjs
scripts/session-annotation-runtime-check.cjs
scripts/session-annotation-services-check.cjs
scripts/session-annotation-text-check.cjs
scripts/session-annotation-export-payload-check.cjs
scripts/session-annotation-import-normalization-check.cjs
scripts/session-annotation-bundle-merge-check.cjs
scripts/session-annotation-generated-index-check.cjs
scripts/session-annotation-marks-check.cjs
scripts/session-annotation-context-check.cjs
scripts/session-annotation-lightweight-io-check.cjs
scripts/session-annotation-api-settings-runtime-check.cjs
scripts/session-startup-cleanup-check.cjs
scripts/session-restore-runtime-check.cjs
scripts/session-startup-runtime-check.cjs
scripts/session-ui-settings-restore-check.cjs
scripts/runtime-state-source-check.cjs
scripts/reader-runtime-shell-check.cjs
scripts/reader-runtime-assembly-check.cjs
scripts/reader-feature-runtime-check.cjs
scripts/reader-feature-runtime-deps-check.cjs
scripts/reader-notes-session-runtime-deps-check.cjs
scripts/reader-controls-runtime-check.cjs
scripts/reader-keyboard-runtime-check.cjs
scripts/reader-app-runtime-check.cjs
scripts/reader-import-runtime-check.cjs
scripts/app-window-facades-check.cjs
scripts/pinia-bridge-module-check.cjs
scripts/audio-store-facades-check.cjs
scripts/keyboard-facades-check.cjs
scripts/import-facades-check.cjs
scripts/chunk-controls-module-check.cjs
scripts/highlight-controls-module-check.cjs
scripts/theme-controls-module-check.cjs
scripts/glass-effects-check.cjs
scripts/style-editor-module-check.cjs
scripts/app-handlers-check.cjs
scripts/marks-store-check.cjs
scripts/marks-state-module-check.cjs
scripts/visual-vocab-module-check.cjs
scripts/legacy-dom-drain-check.cjs
scripts/audio-identity-module-check.cjs
scripts/hotkey-state-module-check.cjs
scripts/transcript-interactions-check.cjs
scripts/chunk-interactions-check.cjs
scripts/render-facades-check.cjs
scripts/script-order-guard-check.cjs
scripts/annotation-bubble-module-check.cjs
scripts/annotation-api-settings-ui-module-check.cjs
scripts/legacy-root-copy-check.cjs
scripts/production-preview-load-check.cjs
```

Despite the `read26` script names, verification targets the current Vite root page, not a `read-26.html` file.

Current checks cover:

- app load on Vite
- transcript/audio playback behavior
- highlighting and active sentence/word behavior
- hotkey customization
- AI chunk auto-entry
- chunk Chinese focus/hold behavior
- annotation lightweight DOM glue through `verify:annotation-lightweight-module`
- keyboard boundary helper ownership through `verify:keyboard-boundary`
- transcript state adapter ownership through `verify:transcript-state`
- chunk state adapter ownership through `verify:chunk-state`
- playback transient state adapter ownership through `verify:playback-state`
- migrated playback runtime helpers and sentence-mode jump helpers into `src/composables/playback-runtime-helpers.js` through `verify:playback-runtime-helpers`
- migrated `window.__state` owner facades through `verify:state-facades`
- removed no-consumer `window.__state` facades are guarded from reappearing through `verify:state-facades`
- removed no-consumer `chunkNoteModalEl` and `chunkPointerDown` runtime state facades through `verify:state-facades`
- removed `window.__bridge` startup dependency through `verify:bridge-startup`
- Phase 3 state ownership stage gate passed through `npm test`, `npm run verify:playback`, and `npm run verify:interactions`
- removed manual chunk/cloze file picker buttons and updated file input binding coverage through `verify:file-input-bindings`
- removed remaining inline DOM handlers from `index.html` through `verify:inline-handler-bindings`
- removed direct `window.__state` reads from controls/playback modules through `verify:control-playback-state-deps`
- removed direct `window.__state` reads from `session-init.js` through `verify:session-state-provider`
- moved annotation service/global lookup helpers and diagnostics emit out of `session-init.js` into `src/composables/session-annotation-services.js` through `verify:session-annotation-services`
- moved session annotation runtime setup out of `session-runtime-assembly.js` into `src/composables/session-annotation-runtime.js` through `verify:session-annotation-runtime`
- moved startup cleanup, persisted restore, DB-ready startup, and UI settings restore wiring out of `session-runtime-assembly.js` into `src/composables/session-lifecycle-runtime.js`, leaving session assembly focused on sequencing deps, annotation runtime, lifecycle runtime, facade handler wiring, and API settings init through `verify:session-lifecycle-runtime`
- migrated `runtimeState` and the temporary `window.__state` alias into `src/composables/runtime-state-facade.js` through `verify:runtime-state-facade`
- migrated runtimeState getter/setter bindings for `st.*` compatibility into `src/composables/runtime-state-bindings.js` while keeping `session-init.js` state provider calls unchanged through `verify:state-facades`
- moved startup context composition for bootstrap state, DOM refs, and focus helpers out of `reader-runtime.js` into `src/composables/reader-runtime-context.js` while keeping `session-init.js` restore/public contracts unchanged through `verify:reader-runtime-context`
- moved feature runtime composition for import, controls, interactions, keyboard, app handlers, and annotation controls out of `reader-runtime.js` into `src/composables/reader-feature-runtime.js` while keeping `session-init.js` restore/public contracts unchanged through `verify:reader-feature-runtime`
- moved feature runtime dependency assembly out of `reader-runtime-shell.js` into `src/composables/reader-feature-runtime-deps.js`, leaving the feature dependency mapping outside the thin shell while preserving session restore/public contracts through `verify:reader-feature-runtime-deps`
- moved notes/session runtime dependency assembly out of `reader-runtime-shell.js` into `src/composables/reader-notes-session-runtime-deps.js`, leaving the notes/session dependency mapping outside the thin shell while preserving notes/session public contracts through `verify:reader-notes-session-runtime-deps`
- moved the remaining context/notes/feature initialization sequence out of `reader-runtime-shell.js` into `src/composables/reader-runtime-assembly.js`; `reader-runtime-shell.js` was later retired and is guarded from reappearing through `verify:reader-runtime-shell`
- migrated static DOM ref collection out of `reader-runtime.js` into `src/composables/reader-dom-refs.js` and removed no-consumer runtime DOM lookups while keeping `session-init.js` annotation settings DOM ownership unchanged through `verify:reader-dom-refs`
- moved bootstrap state adapter references, DB compatibility wrappers, runtime helper collection, audio identity initialization, hotkey state initialization, and marks state initialization out of `reader-runtime.js` into `src/composables/reader-bootstrap-runtime.js` while keeping `session-init.js` state/audio/hotkey/marks contracts unchanged through `verify:reader-bootstrap-runtime`
- moved reader runtime utility/global helper dependency collection out of `reader-runtime.js` into `src/composables/reader-runtime-deps.js` while keeping import/chunk/playback/session contracts unchanged through `verify:reader-runtime-deps`
- moved notes runtime and session wrapper composition out of `reader-runtime.js` into `src/composables/reader-notes-session-runtime.js` while keeping notes/session public contracts unchanged through `verify:reader-notes-session-runtime`
- replaced shared notes runtime with disabled no-op compatibility APIs in `src/composables/reader-notes-runtime.js` while old callers are drained
- kept session-facing disabled note lifecycle wrappers and the `applyCurrentAudioMeta(...)` side-effect wrapper in `src/composables/reader-session-runtime.js`
- moved render runtime configuration and reader playback runtime initialization out of `reader-runtime.js` into `src/composables/reader-interaction-runtime.js` while keeping `session-init.js` render/import/restore contracts unchanged through `verify:reader-interaction-runtime`
- moved annotation bubble resolver setup, playback helper setup, playback module init, and transcript/chunk interaction configuration out of `reader-runtime.js` into `src/composables/reader-playback-runtime.js` while keeping playback/interaction/session contracts unchanged through `verify:reader-playback-runtime`
- moved highlight/chunk/theme control initialization and style editor initialization out of `reader-runtime.js` into `src/composables/reader-controls-runtime.js` while keeping control contracts unchanged through `verify:reader-controls-runtime`
- moved keyboard event/module initialization out of `reader-runtime.js` into `src/composables/reader-keyboard-runtime.js` while keeping hotkey, mark toggle, and session restore contracts unchanged through `verify:reader-keyboard-runtime`
- moved annotation lightweight controls, app handlers, controls loop, glass effects, and reader public facade initialization out of `reader-runtime.js` into `src/composables/reader-app-runtime.js` while keeping session/import/public contracts unchanged through `verify:reader-app-runtime`
- moved session facade setup, session state provider setup, visual vocab setup, runtime state bindings, chunk pipeline, and import handler initialization out of `reader-runtime.js` into `src/composables/reader-import-runtime.js` while keeping `session-init.js` import/restore contracts unchanged through `verify:reader-import-runtime`
- moved reader focus restore helpers out of `reader-runtime.js` into `src/composables/reader-runtime-helpers.js`; current-note toggling was removed with the notes/definition hotkey
- moved the remaining runtime assembly out of `src/composables/reader-runtime.js` into `src/composables/reader-runtime-shell.js`, then moved the remaining shell sequence into `src/composables/reader-runtime-assembly.js`, and later retired `reader-runtime-shell.js`; `reader-runtime.js` is now a thin side-effect import entry that directly initializes `reader-runtime-assembly.js`, and `session-init.js` public contracts are guarded through `verify:reader-runtime-shell` and `verify:reader-runtime-assembly`
- removed local audio identity aliases from `reader-runtime.js`, injecting module APIs directly while preserving `session-init.js` public facade calls through `verify:audio-identity-module`
- moved the `renderTranscript` / `renderChunkMode` implementation body out of `reader-runtime.js` and into `src/composables/render-runtime.js`, while preserving the unchanged `session-init.js` render imports through `verify:render-facades`
- guarded `runtimeState` as the runtime module source while `window.__state` remains only a compatibility alias through `verify:runtime-state-source`
- confirmed `window.__bridge` is not part of Vue/Pinia startup sync through `verify:bridge-startup`
- migrated `window.bridgeToPinia` and the Pinia sync implementation into `src/composables/pinia-bridge-module.js` through `verify:pinia-bridge-module`
- removed direct app-level window facade ownership through `verify:app-window-facades`
- migrated session, annotation bubble resolver, reader public, UI, render-mode, and runtime-state facades into focused modules through `verify:session-facades`, `verify:annotation-bubble-resolver`, `verify:reader-public-facades`, `verify:ui-facades`, `verify:render-mode`, and `verify:runtime-state-facade`
- migrated DB compatibility window facades into `src/stores/audio.js` through `verify:audio-store-facades`
- migrated `window.isInputLikeTarget` into `src/composables/keyboard-module.js` through `verify:keyboard-facades`
- migrated `window.processTranscript` and `window.processChunkData` into `src/composables/import-module.js` through `verify:import-facades`
- migrated AI chunk mode controls and their temporary window facades into `src/composables/chunk-controls-module.js` through `verify:chunk-controls-module`
- migrated highlight mode controls and the temporary `window.cycleHighlightMode` facade into `src/composables/highlight-controls-module.js` through `verify:highlight-controls-module`
- migrated theme control DOM bindings into `src/composables/theme-controls-module.js` through `verify:theme-controls-module`
- migrated glass UI setup into `src/composables/glass-effects.js` through `verify:glass-effects`
- migrated style editor local JSON parsing into `src/composables/style-editor.js` through `verify:style-editor-module`
- migrated initial chunk CN hold button label update into `src/composables/chunk-controls-module.js` through `verify:chunk-controls-module`
- migrated marks import button binding into `src/composables/app-handlers.js` through `verify:app-handlers`
- removed thin marks toggle wrappers from `reader-runtime.js` while keeping `src/stores/marks.js` as behavior owner through `verify:marks-store`
- migrated marks runtime state into `src/composables/marks-state-module.js` while keeping `session-init.js` marks restore/rebuild writes on `st.markedMap` through `verify:marks-state-module`
- removed chunk note runtime wrappers plus thin keyboard/modal/layout/visual/save/snapshot/context-menu chunk note wrappers from the active runtime
- migrated visual/vocab state ownership and `window.processVisual` into `src/composables/visual-vocab-module.js` while keeping the `session-init.js` restore call unchanged through `verify:visual-vocab-module`
- removed absent legacy sidebar/notes DOM lookups and the dead `toggleSidebar()` path from `reader-runtime.js` through `verify:legacy-dom-drain`
- removed sentence note runtime wrappers and thin sentence interaction wrappers from the active runtime
- migrated audio identity state and derived storage/doc-id helpers into `src/composables/audio-identity-module.js` while keeping `session-init.js` audio restore calls unchanged through `verify:audio-identity-module`
- migrated hotkey runtime state into `src/composables/hotkey-state-module.js` while keeping `session-init.js` hotkey restore writes unchanged through `verify:hotkey-state-module`
- migrated normal transcript word click/contextmenu ownership through `verify:transcript-interactions`
- migrated AI chunk word/chunk click/contextmenu ownership through `verify:chunk-interactions`
- removed global render facades through `verify:render-facades`
- guarded current `index.html` script order through `verify:script-order`
- Phase 4 DOM/event ownership checkpoint passed through `npm test`, standalone `npm run verify:playback`, standalone `npm run verify:interactions`, and `npm run build`
- migrated `annotation-bubble.js` logic into `src/composables/annotation-bubble.js` through `verify:annotation-bubble`
- migrated `annotation-api-settings-ui.js` logic into `src/composables/annotation-api-settings-ui.js` through `verify:annotation-api-settings-ui`
- removed the four root regular script tags from `index.html` and updated `verify:script-order`
- removed stale `vite.config.js` root script copy logic through `verify:legacy-root-copy`
- Phase 5 root script and entry cleanup checkpoint passed through `npm run build`, `npm test`, and `npm run verify:production-preview`
- annotation lightweight export/import UI presence
- page-style follow positioning at different viewport heights

## 10. Build Behavior

`vite.config.js` uses the Vue plugin without legacy root script copy logic.

These legacy root files still exist in the repository, but `index.html` no longer loads them and production build no longer copies them as root assets:

```text
chunk-note-layout-helpers.js
chunk-note-layout-core.js
annotation-bubble.js
annotation-api-settings-ui.js
```

Their module replacements are loaded through Vite.

## 11. Storage Constraints

IndexedDB schema:

```text
DB name: SeekPlayerDB
Version: 1
Object store: files
Key path: id
```

Do not change this schema without an explicit migration plan.

Local/session storage is also used for UI state, hotkeys, chunk mode settings, and annotation-related state.

## 12. Current High-Risk Areas

Treat these as sensitive when editing:

```text
src/composables/reader-runtime.js
src/composables/session-init.js
src/composables/keyboard-module.js
src/components/ChunkModeView.vue
src/components/TranscriptContainer.vue
src/services/annotation/controller.js
styles.css
index.html script order
```

Main risks:

- Root `app.js` has been removed. `src/composables/reader-runtime.js` is now a thin runtime entry; `src/composables/reader-runtime-shell.js` has been retired, and remaining runtime assembly lives in `src/composables/reader-runtime-assembly.js`, while direct global facade ownership, transcript, chunk, cloze, playback transient, playback helper behavior, reader startup context, reader bootstrap runtime, reader feature runtime composition, reader feature runtime dependency assembly, reader runtime dependency collection, reader notes/session runtime dependency assembly, reader notes/session runtime, reader notes runtime, reader session runtime, reader interaction runtime, reader playback runtime, reader controls runtime, reader keyboard runtime, reader app runtime, reader import runtime, reader runtime helpers, note state, visual/vocab matching state, audio identity state, hotkey runtime state, marks runtime state, Pinia bridge, DB facades, import facades, chunk note style facades, keyboard helper facades, highlight controls, and AI chunk controls now delegate through focused adapters/modules. A small set of no-consumer `window.__state` facades has been removed.
- `session-init.js` is now a thin entry that initializes `session-runtime-assembly.js`; session runtime dependency collection lives in `session-runtime-deps.js`, annotation runtime setup lives in `session-annotation-runtime.js`, startup/restore/UI lifecycle setup lives in `session-lifecycle-runtime.js`, public session compatibility functions are wired through `configureSessionFacades(...)`, and the former `window.__session_*` internal bridge facades have been retired.
- Vue and legacy DOM both render or influence reading state.
- `src/stores/` and `src/pinia-stores/` can be confused.
- Some modules depend on import-time side effects.
- The annotation pipeline is large and split across many ES modules.
- Root regular script files still exist, but `index.html` no longer loads them and Vite no longer copies them as root assets.

## 13. Documentation Status

Current useful docs:

```text
CURRENT_PROJECT_STATUS.md         this file; current detailed status
README.md                         short project overview and commands
PROJECT_MAP.md                    compact file map, but verify against current tree before trusting details
AGENTS.md                         operating notes for coding agents
ES_MODULE_PLAN.md                 historical migration planning context
```

When documents conflict, prefer this file, then verify against the actual file tree.

## 14. Maintenance Rules

- Prefer small, behavior-preserving changes.
- Current cleanup mode: root `app.js` has been removed; do not add user-facing features to `reader-runtime.js` or the remaining `reader-runtime-assembly.js` layer.
- Do not move script order unless the full app is verified afterward.
- Do not add new feature logic to `src/composables/reader-runtime.js`; do not reintroduce `src/composables/reader-runtime-shell.js`.
- Prefer modules, Pinia stores, and Vue components for new work.
- Keep compatibility globals in place until the caller paths are migrated.
- Treat `window.__state`, runtime `bridgeToPinia`, former `window.__bridge` expectations, and `window.*` exports as compatibility surfaces to retire, not as places to add new architecture.
- Keep each cleanup step stage-gated: update the runtime map, migrate one boundary, then run the required verification before starting the next boundary.
- Do not use `file:///E:/read-web/index.html` as the normal launch path; use Vite.
- Do not treat `read-26.html` as the current project entry.
- Run `npm test` for behavior changes.
- Run `npm run build` when changing entry files, scripts, Vite config, or root regular scripts.
