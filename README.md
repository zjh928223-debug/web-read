# Read-Web

Vite + Vue 3 + Pinia migration of a legacy browser-based language reading tool.

The app provides audio playback, synchronized transcript reading, AI chunk mode, cloze quizzes, notes, and generated annotation workflows.

For the detailed current architecture and migration status, see `CURRENT_PROJECT_STATUS.md`.

## Current Status

This is a working hybrid app, not a clean Vue-only rewrite.

```text
legacy DOM + inline handlers
        ↓
app.js central state and compatibility exports
        ↓
window.__state / state adapters / runtime bridgeToPinia compatibility
        ↓
Pinia stores in src/pinia-stores
        ↓
Vue components
```

Vue rendering is currently enabled by default through `window.__USE_VUE_RENDERING = true`, but many actions still go through legacy `window.xxx` functions and DOM event wiring.

## Cleanup Mode

The current project priority is to decompose and remove `app.js` before adding new user-facing features. Use `openspec/changes/complete-appjs-decomposition/phase-0-runtime-baseline.md` as the baseline map for the cleanup route.

- Do not add feature logic to `app.js`.
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
npm run build        # Build and copy required root legacy scripts into dist
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
npm run verify:state-facades # Focused window.__state owner facade check
npm run verify:bridge-startup # Focused adapter-to-Pinia startup check
npm run verify:file-input-bindings # Focused file picker DOM binding check
npm run verify:transcript-interactions # Focused normal transcript interaction check
npm run verify:chunk-interactions # Focused AI chunk interaction check
npm run verify:cloze-interactions # Focused cloze answer interaction check
npm run verify:render-facades # Focused legacy render facade removal check
npm run verify:script-order # Focused index.html script order guard
npm run verify:chunk-note-layout-helpers # Focused chunk note layout helper module check
npm run verify:chunk-note-layout-core # Focused chunk note layout core module check
npm run verify:annotation-bubble # Focused annotation bubble module check
npm run verify:annotation-api-settings-ui # Focused annotation API settings UI module check
npm test             # Same as verify:vite
```

`read-26.html` no longer exists in the project root. Old `read26` script names are compatibility aliases only.

## Runtime Load Order

`index.html` currently loads:

```text
4 root regular scripts
9 src/stores/*.js module compatibility stores
9 src/composables/*.js module compatibility modules
app.js module
src/composables/session-init.js module
/src/main.js Vue + Pinia module
```

The 4 remaining root regular scripts are:

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
├── composables/               # 22 moduleized legacy behavior chunks
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

- `app.js` still owns remaining central runtime state and compatibility facades, but transcript, chunk, cloze, playback transient, and note state now go through focused adapters/modules. No-consumer `window.__state` facades are being removed behind `verify:state-facades`.
- Transcript state now goes through `src/composables/transcript-state.js`, which binds directly to the real Pinia transcript store after Pinia creation.
- Chunk mode state now goes through `src/composables/chunk-state.js`, which binds directly to the real Pinia chunk store after Pinia creation.
- Cloze quiz state now goes through `src/composables/cloze-state.js`, which binds directly to the real Pinia cloze store after Pinia creation.
- Cloze answer draft/check interaction now goes through `src/composables/cloze-interactions.js`; the old cloze render/check facades remain only for legacy fallback cleanup.
- `window.renderTranscript` and `window.renderChunkMode` have been removed; `session-init.js` uses `src/composables/render-runtime.js` while remaining render dependencies are explicit injections.
- Playback transient state now goes through `src/composables/playback-state.js`; `window.__state` remains the compatibility facade for playback and controls modules.
- Chunk note and sentence note subsystem runtime and shared note state now live behind `src/composables/notes-module.js` / `window.__notesState`.
- Annotation lightweight import/export button glue now lives in `src/composables/annotation-lightweight-module.js`; the real import/export implementation remains in `src/composables/session-init.js`.
- Annotation bubble DOM API now lives in `src/composables/annotation-bubble.js`; `app.js` reaches it through a module API while the root script tag remains until Phase 5 tag removal.
- Annotation API settings UI now lives in `src/composables/annotation-api-settings-ui.js`; `session-init.js` reaches it through a module API while the root script tag remains until Phase 5 tag removal.
- `src/composables/session-init.js` mixes startup restore, persisted-state cleanup, and the annotation import/export implementation.
- `src/stores/` and `src/pinia-stores/` both exist. The former is compatibility; the latter is real Pinia.
- Root regular scripts are still required at runtime and must be copied for production builds.
