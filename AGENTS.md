# AGENTS.md - Read-Web Current Project Notes

## What This Is

Read-Web is a Vite-hosted Vue 3 + Pinia migration of a legacy plain HTML/JS language-learning reader.

It supports audio playback, synchronized transcripts, AI chunk mode, cloze quizzes, sentence/chunk notes, and generated annotations through API-backed annotation modules.

The codebase is still hybrid. Do not treat it as a clean Vue-only app.

## Current Entry Points

- `index.html` - browser entry and legacy DOM shell.
- `src/composables/reader-runtime.js` - remaining runtime assembly shell, no longer owns direct `window.*` facade assignments.
- `src/composables/session-init.js` - startup/session restore plus annotation import/export glue.
- `src/main.js` - Vue mount, Pinia setup, adapter-to-Pinia binding, and compatibility delegation.

There is no `read-26.html` in the current root. Any script or doc that refers to it is legacy context.

## Actual Browser Load Order

Keep this order unless you are deliberately changing the architecture and have verified the full app:

```text
index.html
├── 9 src/stores/*.js module compatibility stores
├── 10 src/composables/*.js module compatibility/runtime modules
├── src/composables/reader-runtime.js as type="module"
├── src/composables/session-init.js as type="module"
└── /src/main.js as type="module" for Vue + Pinia
```

`src/main.js` also imports the 11 `src/utils/*.js` modules, `src/composables/annotation-bubble.js`, `src/composables/annotation-api-settings-ui.js`, and 14 `src/services/annotation/*.js` modules for side effects and ES module exports.

## Runtime Architecture

The current state flow is:

```text
src/composables/reader-runtime.js remaining let variables and runtime shell adapters/modules
  -> window.__state getter/setter proxy
  -> pinia-bridge-module bridgeToPinia compatibility
  -> src/pinia-stores/*.js real Pinia stores
  -> Vue components
```

There is also a compatibility layer:

```text
src/stores/*.js -> window.__themeStore / __audioStore / __uiStore / ...
src/main.js     -> replaces selected window store methods with Pinia delegation
```

Do not confuse `src/stores/` with real Pinia stores. The real Pinia definitions are under `src/pinia-stores/`.

## Current Rendering State

Vue rendering is enabled by default:

```js
window.__USE_VUE_RENDERING = true
```

The Vue components are active but thin. A lot of interaction still relies on `src/composables/reader-runtime.js` runtime assembly, focused `window.xxx` compatibility facades, `src/composables/legacy-control-bindings.js`, and legacy DOM behavior.

## Important Files

- `src/composables/reader-runtime.js` - about 1091 lines. High risk. Remaining runtime assembly and compatibility wiring.
- `src/composables/runtime-state-facade.js` - `runtimeState` and temporary `window.__state` compatibility owner.
- `src/composables/session-facades.js` - public session/annotation facade stubs.
- `src/composables/reader-public-facades.js` - remaining reader public facade assignments.
- `src/composables/annotation-bubble-resolver.js` - generated/vocab annotation bubble hit resolution.
- `src/composables/ui-facades.js` - early toast/error facade owner.
- `src/composables/render-mode.js` - default Vue rendering flag owner.
- `src/composables/pinia-bridge-module.js` - `bridgeToPinia` compatibility owner.
- `src/composables/chunk-controls-module.js` - AI chunk mode controls and temporary chunk control window facades.
- `src/composables/highlight-controls-module.js` - highlight mode controls and temporary highlight window facade.
- `src/composables/theme-controls-module.js` - theme control DOM bindings.
- `src/composables/glass-effects.js` - glass UI decoration and chunk note dimension lock setup.
- `src/composables/style-editor.js` - visual style editor and local style parsing helper.
- `src/composables/app-handlers.js` - mark import/export handlers.
- `src/composables/chunk-note-transfer-module.js` - chunk note import/export transfer UI.
- `src/composables/visual-vocab-module.js` - visual vocab state and temporary `window.processVisual` compatibility owner.
- `src/composables/session-init.js` - high risk. Startup restore, persisted state cleanup, and annotation import/export glue.
- `src/main.js` - Vue/Pinia mount plus adapter-to-Pinia binding.
- `src/pinia-stores/` - 9 real Pinia stores.
- `src/stores/` - 9 window compatibility stores.
- `src/services/annotation/` - 14 ES modules for generated annotation flow.
- Root `annotation-*.js` and `chunk-note-layout-*.js` - legacy root files no longer loaded by `index.html` or copied by Vite.
- `styles.css` - global CSS loaded directly by `index.html`.

## Hard Constraints

### Cleanup Mode

`complete-appjs-decomposition` has been completed and archived under `openspec/changes/archive/2026-06-18-complete-appjs-decomposition/`. Current cleanup context comes from `CURRENT_PROJECT_STATUS.md` and the active spec at `openspec/specs/legacy-runtime-decomposition/spec.md`.

Do not add feature logic to `src/composables/reader-runtime.js`. Treat `window.__state`, runtime `bridgeToPinia`, former `window.__bridge` expectations, and `window.*` exports as compatibility surfaces to retire. Migrate one boundary at a time, keep compatibility only until callers move, and run the required verification before starting the next boundary.

### IndexedDB Schema

Do not change the IndexedDB schema unless the user explicitly asks for a migration.

```text
DB name: SeekPlayerDB
Version: 1
Object store: files
Key path: id
```

### Script Order

Do not reorder `index.html` scripts casually. The app still uses globals and side effects for compatibility.

### reader-runtime.js

Do not add new feature logic to `src/composables/reader-runtime.js`. Prefer focused modules, Pinia stores, or Vue components, but respect existing runtime compatibility callers while migrating those callers away.

### session-init.js

Treat `src/composables/session-init.js` as high-risk. It is not just startup code; it also owns annotation workflow glue and persisted session behavior.

## Commands

```bash
npm run dev          # Vite dev server, port 5173
npm run build        # Production build
npm run verify:vite  # Starts Vite on 127.0.0.1:4173 and runs Playwright load check
npm run verify:chunk-notes-state  # Focused chunk note state helper check
npm run verify:sentence-notes-state  # Focused sentence note state helper check
npm run verify:annotation-lightweight-module  # Focused annotation lightweight glue check
npm run verify:keyboard-boundary  # Focused keyboard boundary helper check
npm run verify:transcript-state  # Focused transcript state adapter check
npm run verify:chunk-state  # Focused chunk state adapter check
npm run verify:cloze-state  # Focused cloze state adapter check
npm run verify:playback-state  # Focused playback state adapter check
npm run verify:state-facades  # Focused window.__state owner facade check
npm run verify:bridge-startup  # Focused adapter-to-Pinia startup check
npm run verify:file-input-bindings  # Focused file picker DOM binding check
npm run verify:inline-handler-bindings  # Focused remaining inline handler migration check
npm run verify:control-playback-state-deps  # Focused controls/playback state dependency check
npm run verify:session-state-provider  # Focused session-init state provider check
npm run verify:runtime-state-source  # Focused runtime state source guard
npm run verify:app-window-facades  # Focused app.js duplicate window facade guard
npm run verify:pinia-bridge-module  # Focused Pinia bridge module check
npm run verify:audio-store-facades  # Focused DB compatibility facade check
npm run verify:chunk-note-style-facades  # Focused chunk note style facade check
npm run verify:keyboard-facades  # Focused keyboard helper facade check
npm run verify:import-facades  # Focused transcript/chunk import facade check
npm run verify:chunk-controls-module  # Focused AI chunk controls module check
npm run verify:highlight-controls-module  # Focused highlight controls module check
npm run verify:theme-controls-module  # Focused theme controls module check
npm run verify:glass-effects  # Focused glass effects module check
npm run verify:style-editor-module  # Focused style editor module check
npm run verify:app-handlers  # Focused app handlers module check
npm run verify:marks-store  # Focused marks store ownership check
npm run verify:chunk-note-transfer  # Focused chunk note import/export transfer check
npm run verify:notes-wrapper-drain  # Focused unused notes runtime wrapper check
npm run verify:visual-vocab-module  # Focused visual vocab state module check
npm run verify:legacy-dom-drain  # Focused removed legacy DOM lookup check
npm run verify:transcript-interactions  # Focused normal transcript interaction check
npm run verify:chunk-interactions  # Focused AI chunk interaction check
npm run verify:cloze-interactions  # Focused cloze answer interaction check
npm run verify:render-facades  # Focused legacy render facade removal check
npm run verify:script-order  # Focused index.html script order guard
npm run verify:chunk-note-layout-helpers  # Focused chunk note layout helper module check
npm run verify:chunk-note-layout-core  # Focused chunk note layout core module check
npm run verify:annotation-bubble  # Focused annotation bubble module check
npm run verify:annotation-api-settings-ui  # Focused annotation API settings UI module check
npm run verify:legacy-root-copy  # Focused legacy root copy removal check
npm run verify:production-preview  # Production preview load check against dist
npm test             # Same as verify:vite
```

`verify:read26` is now only a legacy alias to the current Vite verification.

## Documentation Status

Use this file, `README.md`, and `PROJECT_MAP.md` as current architecture references. `ES_MODULE_PLAN.md` is historical planning context unless explicitly updated.
