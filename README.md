# Read-Web

Vite + Vue 3 + Pinia migration of a legacy browser-based language reading tool.

The app provides audio playback, synchronized transcript reading, AI chunk mode, cloze quizzes, notes, and generated annotation workflows.

For the detailed current architecture and migration status, see `CURRENT_PROJECT_STATUS.md`.

## Current Status

This is a working hybrid app, not a clean Vue-only rewrite.

```text
legacy DOM shell + module-bound controls
        ↓
src/composables/reader-runtime.js remaining runtime assembly shell
        ↓
window.__state / state adapters / Pinia bridge module compatibility
        ↓
Pinia stores in src/pinia-stores
        ↓
Vue components
```

Vue rendering is currently enabled by default through `window.__USE_VUE_RENDERING = true`, but many actions still go through legacy `window.xxx` functions and module-bound DOM event wiring.

## Cleanup Mode

The root `app.js` file has been removed as part of `complete-appjs-decomposition`. The current cleanup priority is to keep shrinking `src/composables/reader-runtime.js` before adding new user-facing features.

- Do not add feature logic to `src/composables/reader-runtime.js`.
- Do not change the IndexedDB schema without a separate migration.
- Do not reorder `index.html` scripts unless that change is isolated and fully verified.
- Treat `window.__state`, runtime `bridgeToPinia`, former `window.__bridge` expectations, and `window.*` exports as temporary compatibility surfaces.

## Quick Start

```bash
npm install
npm run dev
npm test
npm run build
```

Useful URLs:

- Dev server: `http://127.0.0.1:5173/`
- Verification server: `http://127.0.0.1:4173/`

## Scripts

```bash
npm run dev          # Vite dev server
npm run build        # Vite production build
npm run verify:vite  # Playwright load check against the current root entry
npm run verify:vocab-matching # Focused vocab matching helper check
npm run verify:chunk-notes-state # Focused chunk note state helper check
npm run verify:sentence-notes-state # Focused sentence note state helper check
npm run verify:annotation-lightweight-module # Focused annotation lightweight glue check
npm run verify:keyboard-boundary # Focused keyboard boundary helper check
npm run verify:transcript-state # Focused transcript state adapter check
npm run verify:chunk-state # Focused chunk state adapter check
npm run verify:cloze-state # Focused cloze state adapter check
npm run verify:playback-state # Focused playback state adapter check
npm run verify:playback-runtime-helpers # Focused playback runtime helper check
npm run verify:state-facades # Focused window.__state owner facade check
npm run verify:bridge-startup # Focused adapter-to-Pinia startup check
npm run verify:file-input-bindings # Focused file picker DOM binding check
npm run verify:inline-handler-bindings # Focused remaining inline handler migration check
npm run verify:control-playback-state-deps # Focused controls/playback state dependency check
npm run verify:session-state-provider # Focused session-init state provider check
npm run verify:runtime-state-source # Focused runtime state source guard
npm run verify:reader-dom-refs # Focused reader runtime DOM ref collection check
npm run verify:app-window-facades # Focused app.js duplicate window facade guard
npm run verify:pinia-bridge-module # Focused Pinia bridge module check
npm run verify:audio-store-facades # Focused DB compatibility facade check
npm run verify:chunk-note-style-facades # Focused chunk note style facade check
npm run verify:keyboard-facades # Focused keyboard helper facade check
npm run verify:import-facades # Focused transcript/chunk import facade check
npm run verify:chunk-controls-module # Focused AI chunk controls module check
npm run verify:highlight-controls-module # Focused highlight controls module check
npm run verify:theme-controls-module # Focused theme controls module check
npm run verify:glass-effects # Focused glass effects module check
npm run verify:style-editor-module # Focused style editor module check
npm run verify:app-handlers # Focused app handlers module check
npm run verify:marks-store # Focused marks store ownership check
npm run verify:marks-state-module # Focused marks runtime state module check
npm run verify:chunk-note-transfer # Focused chunk note import/export transfer check
npm run verify:notes-wrapper-drain # Focused unused notes runtime wrapper check
npm run verify:visual-vocab-module # Focused visual vocab state module check
npm run verify:legacy-dom-drain # Focused removed legacy DOM lookup check
npm run verify:sentence-wrapper-drain # Focused unused sentence note runtime wrapper check
npm run verify:audio-identity-module # Focused audio identity state module check
npm run verify:hotkey-state-module # Focused hotkey runtime state module check
npm run verify:transcript-interactions # Focused normal transcript interaction check
npm run verify:chunk-interactions # Focused AI chunk interaction check
npm run verify:cloze-interactions # Focused cloze answer interaction check
npm run verify:render-facades # Focused legacy render facade removal check
npm run verify:script-order # Focused index.html script order guard
npm run verify:chunk-note-layout-helpers # Focused chunk note layout helper module check
npm run verify:chunk-note-layout-core # Focused chunk note layout core module check
npm run verify:annotation-bubble # Focused annotation bubble module check
npm run verify:annotation-api-settings-ui # Focused annotation API settings UI module check
npm run verify:legacy-root-copy # Focused legacy root copy removal check
npm run verify:production-preview # Production preview load check against dist
npm test             # Same as verify:vite
```

`read-26.html` no longer exists in the project root. Old `read26` script names are compatibility aliases only.

## Runtime Load Order

`index.html` currently loads:

```text
9 src/stores/*.js module compatibility stores
10 src/composables/*.js module compatibility/runtime modules
src/composables/reader-runtime.js module
src/composables/session-init.js module
/src/main.js Vue + Pinia module
```

The former root regular scripts now load through Vite module replacements and are no longer referenced by `index.html`:

```text
chunk-note-layout-helpers.js
chunk-note-layout-core.js
annotation-bubble.js
annotation-api-settings-ui.js
```

## Source Map

```text
src/
├── main.js                    # Vue mount + Pinia adapter binding
├── App.vue                    # Root component
├── components/                # 5 Vue components
├── pinia-stores/              # 9 real Pinia stores
├── stores/                    # 9 legacy window compatibility stores
├── composables/               # 41 moduleized legacy behavior chunks
├── utils/                     # 11 utility ES modules
└── services/annotation/       # 14 annotation pipeline ES modules
```

## Data Storage

IndexedDB schema is fixed:

```text
DB name: SeekPlayerDB
Version: 1
Store: files
Key path: id
```

Do not change this schema without an explicit migration plan.

## Current High-Risk Areas

- `src/composables/reader-runtime.js` is the remaining runtime assembly shell. Direct `window.*` facade ownership has moved to focused modules, while transcript, chunk, cloze, playback transient, note state, visual/vocab matching state, audio identity state, hotkey runtime state, and marks runtime state go through focused adapters/modules.
- Transcript state now goes through `src/composables/transcript-state.js`, which binds directly to the real Pinia transcript store after Pinia creation.
- Chunk mode state now goes through `src/composables/chunk-state.js`, which binds directly to the real Pinia chunk store after Pinia creation.
- Cloze quiz state now goes through `src/composables/cloze-state.js`, which binds directly to the real Pinia cloze store after Pinia creation.
- Cloze answer draft/check interaction now goes through `src/composables/cloze-interactions.js`; the old cloze render/check facades remain only for legacy fallback cleanup.
- `window.renderTranscript` and `window.renderChunkMode` have been removed; `session-init.js` uses `src/composables/render-runtime.js` while remaining render dependencies are explicit injections.
- Remaining legacy control inline handlers have been removed from `index.html`; `src/composables/legacy-control-bindings.js` now binds those DOM controls to existing compatibility functions.
- Playback transient state now goes through `src/composables/playback-state.js`; playback and controls modules receive their temporary state view through explicit init deps instead of reading `window.__state` directly.
- Playback helper behavior now goes through `src/composables/playback-runtime-helpers.js`; `reader-runtime.js` only injects its API into playback and controls modules, including sentence-mode previous/next jumps.
- `src/composables/session-init.js` receives its temporary state view through `src/composables/session-state-provider.js` instead of reading `window.__state` directly.
- `src/composables/runtime-state-facade.js` now owns the `runtimeState` object and exposes it as `window.__state` only as a temporary compatibility facade.
- `src/composables/runtime-state-bindings.js` now owns the `runtimeState` getter/setter bindings that preserve current `st.*` compatibility for startup/session code.
- `src/composables/reader-dom-refs.js` now owns static reader runtime DOM ref collection; `session-init.js` still owns its annotation settings DOM setup.
- Local audio identity and chunk note layout API aliases have been removed from `reader-runtime.js`; runtime assembly now injects those module APIs directly.
- `src/composables/session-facades.js`, `annotation-bubble-resolver.js`, `reader-public-facades.js`, `ui-facades.js`, and `render-mode.js` own the remaining compatibility facade assignments previously made directly by root `app.js`.
- `window.bridgeToPinia` now lives in `src/composables/pinia-bridge-module.js`.
- Duplicate app-level window facades for playback controls, speed, and chunk style controls have moved to their module owners.
- DB compatibility window facades now live in `src/stores/audio.js`, delegating through the current `window.__audioStore` implementation.
- Chunk note style compatibility facades now live in `src/composables/notes-module.js`.
- `window.isInputLikeTarget` now lives in `src/composables/keyboard-module.js`.
- `window.processTranscript` and `window.processChunkData` now live in `src/composables/import-module.js`.
- Highlight mode controls and the temporary `window.cycleHighlightMode` facade now live in `src/composables/highlight-controls-module.js`.
- AI chunk mode controls and their temporary window facades now live in `src/composables/chunk-controls-module.js`; `reader-runtime.js` only initializes the module and passes its API to keyboard/import callers.
- Theme control DOM bindings now live in `src/composables/theme-controls-module.js`; glass sizing setup and style editor parsing helpers are owned by `src/composables/glass-effects.js` and `src/composables/style-editor.js`.
- Marks import button binding now lives in `src/composables/app-handlers.js`; marks toggle behavior remains owned by `src/stores/marks.js`.
- Marks runtime state now lives in `src/composables/marks-state-module.js`; `session-init.js` still restores and rebuilds marks through the unchanged `st.markedMap` state field.
- Chunk note import/export button binding, download/write handling, and export overwrite dialog now live in `src/composables/chunk-note-transfer-module.js`.
- Unused chunk note runtime wrappers and thin keyboard/modal/layout/visual/save/snapshot/context-menu chunk note wrappers have been removed from `reader-runtime.js`; behavior remains owned by `src/composables/notes-module.js`.
- Visual/vocab matching state and the temporary `window.processVisual` restore contract now live in `src/composables/visual-vocab-module.js`; `session-init.js` still calls `processVisual(visualData)`.
- Audio identity state and derived storage/doc-id helpers now live in `src/composables/audio-identity-module.js`; `session-init.js` still calls `applyCurrentAudioMeta(...)` and reads `st.currentAudioKey/currentAudioMeta`.
- Hotkey runtime state now lives in `src/composables/hotkey-state-module.js`; `session-init.js` still restores persisted hotkeys through the unchanged `st.*Key` state fields.
- No-consumer `chunkNoteModalEl` and `chunkPointerDown` runtime state facades have been removed and are guarded by `verify:state-facades`.
- Absent legacy sidebar/notes DOM lookups and the dead `toggleSidebar()` path have been removed from `reader-runtime.js`.
- Unused sentence note runtime wrappers and thin sentence interaction wrappers have been removed from `reader-runtime.js`; behavior remains owned by `src/composables/notes-module.js` while session restore entry points are kept.
- Chunk note and sentence note subsystem runtime and shared note state now live behind `src/composables/notes-module.js` / `window.__notesState`.
- Annotation lightweight import/export button glue now lives in `src/composables/annotation-lightweight-module.js`; the real import/export implementation remains in `src/composables/session-init.js`.
- Annotation bubble DOM API now lives in `src/composables/annotation-bubble.js`; generated/vocab bubble hit resolution now lives in `src/composables/annotation-bubble-resolver.js`.
- Annotation API settings UI now lives in `src/composables/annotation-api-settings-ui.js`; `session-init.js` reaches it through a module API.
- `src/composables/session-init.js` mixes startup restore, persisted-state cleanup, and the annotation import/export implementation.
- `src/stores/` and `src/pinia-stores/` both exist. The former is compatibility; the latter is real Pinia.
- Former root regular scripts are no longer loaded by `index.html` and are no longer copied by Vite.
