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
window.__state / window.__bridge
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
- Treat `window.__state`, `window.__bridge`, and `window.*` exports as temporary compatibility surfaces.

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
├── main.js                    # Vue mount + Pinia bridge
├── App.vue                    # Root component
├── components/                # 5 Vue components
├── pinia-stores/              # 9 real Pinia stores
├── stores/                    # 9 legacy window compatibility stores
├── composables/               # 10 moduleized legacy behavior chunks
├── utils/                     # 9 utility ES modules
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

- `app.js` still owns most core runtime state.
- Chunk note state CRUD/import/export-handle rules now live in `src/composables/notes-module.js`; chunk note overlay DOM still remains in `app.js`.
- `src/composables/session-init.js` mixes startup restore, persisted-state cleanup, and annotation import/export glue.
- `src/stores/` and `src/pinia-stores/` both exist. The former is compatibility; the latter is real Pinia.
- Root regular scripts are still required at runtime and must be copied for production builds.
