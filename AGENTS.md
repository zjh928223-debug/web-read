# AGENTS.md - Read-Web Current Project Notes

## What This Is

Read-Web is a Vite-hosted Vue 3 + Pinia migration of a legacy plain HTML/JS language-learning reader.

It supports audio playback, synchronized transcripts, AI chunk mode, cloze quizzes, sentence/chunk notes, and generated annotations through API-backed annotation modules.

The codebase is still hybrid. Do not treat it as a clean Vue-only app.

## Current Entry Points

- `index.html` - browser entry and legacy DOM shell.
- `app.js` - legacy central bus, still owns remaining runtime state and many UI handlers.
- `src/composables/session-init.js` - startup/session restore plus annotation import/export glue.
- `src/main.js` - Vue mount, Pinia setup, adapter-to-Pinia binding, and compatibility delegation.

There is no `read-26.html` in the current root. Any script or doc that refers to it is legacy context.

## Actual Browser Load Order

Keep this order unless you are deliberately changing the architecture and have verified the full app:

```text
index.html
├── 4 root regular scripts
│   ├── chunk-note-layout-helpers.js
│   ├── chunk-note-layout-core.js
│   ├── annotation-bubble.js
│   └── annotation-api-settings-ui.js
├── 9 src/stores/*.js module compatibility stores
├── 9 src/composables/*.js module compatibility modules
├── app.js as type="module"
├── src/composables/session-init.js as type="module"
└── /src/main.js as type="module" for Vue + Pinia
```

`src/main.js` also imports the 9 `src/utils/*.js` modules and 14 `src/services/annotation/*.js` modules for side effects and ES module exports.

## Runtime Architecture

The current state flow is:

```text
app.js remaining let variables and runtime state adapters/modules
  -> window.__state getter/setter proxy
  -> direct adapter-to-Pinia binding plus runtime bridgeToPinia compatibility
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

The Vue components are active but thin. A lot of interaction still relies on `app.js`, `window.xxx` exports, inline `onclick`/`oninput` handlers in `index.html`, and legacy DOM behavior.

## Important Files

- `app.js` - about 1823 lines. High risk. Remaining central state, playback wiring, compatibility facades, and legacy exports.
- `src/composables/session-init.js` - high risk. Startup restore, persisted state cleanup, and annotation import/export glue.
- `src/main.js` - Vue/Pinia mount plus adapter-to-Pinia binding.
- `src/pinia-stores/` - 9 real Pinia stores.
- `src/stores/` - 9 window compatibility stores.
- `src/services/annotation/` - 14 ES modules for generated annotation flow.
- Root `annotation-*.js` and `chunk-note-layout-*.js` - 4 remaining regular scripts still required by `index.html`.
- `styles.css` - global CSS loaded directly by `index.html`.

## Hard Constraints

### Cleanup Mode

The current priority is to finish `complete-appjs-decomposition` before adding new user-facing features. Use `openspec/changes/complete-appjs-decomposition/phase-0-runtime-baseline.md` as the current cleanup baseline.

Do not add feature logic to `app.js`. Treat `window.__state`, runtime `bridgeToPinia`, former `window.__bridge` expectations, and `window.*` exports as compatibility surfaces to retire. Migrate one boundary at a time, keep compatibility only until callers move, and run the required verification before starting the next boundary.

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

### app.js

Do not add new feature logic to `app.js`. Prefer focused modules, Pinia stores, or Vue components, but respect existing runtime compatibility callers while migrating those callers away.

### session-init.js

Treat `src/composables/session-init.js` as high-risk. It is not just startup code; it also owns annotation workflow glue and persisted session behavior.

## Commands

```bash
npm run dev          # Vite dev server, port 5173
npm run build        # Production build, copies 4 legacy root scripts into dist
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
npm run verify:transcript-interactions  # Focused normal transcript interaction check
npm test             # Same as verify:vite
```

`verify:read26` is now only a legacy alias to the current Vite verification.

## Documentation Status

Use this file, `README.md`, and `PROJECT_MAP.md` as current architecture references. `ES_MODULE_PLAN.md` is historical planning context unless explicitly updated.
