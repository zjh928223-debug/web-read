# PROJECT_MAP.md - Read-Web Current Map

## Top-Level Runtime Files

```text
read-web/
├── index.html                         # Vite-served browser entry and legacy DOM shell
├── app.js                             # Legacy central bus, about 1826 lines
├── styles.css                         # Global CSS linked by index.html
├── vite.config.js                     # Vite + Vue config, copies remaining root scripts on build
├── package.json                       # Current commands and dependencies
├── chunk-note-layout-helpers.js       # Remaining regular script
├── chunk-note-layout-core.js          # Remaining regular script
├── annotation-bubble.js               # Remaining regular script
└── annotation-api-settings-ui.js      # Remaining regular script
```

## Browser Execution Order

```text
index.html
├── root regular scripts
├── src/stores/*.js compatibility modules
├── src/composables/*.js compatibility modules
├── app.js
├── src/composables/session-init.js
└── src/main.js
```

The page still contains inline `onclick` and `oninput` handlers. `app.js` and some composables therefore export functions onto `window`.

## Cleanup Baseline

Current cleanup work follows `openspec/changes/complete-appjs-decomposition/`. The Phase 0 runtime map is `openspec/changes/complete-appjs-decomposition/phase-0-runtime-baseline.md`.

Cleanup rules:

- Do not add user-facing feature logic to `app.js`.
- Migrate one boundary at a time and keep compatibility globals only until callers are moved.
- Do not change IndexedDB schema or `index.html` script order without an explicit migration and full verification.
- Treat `src/stores/` as compatibility only; long-term ownership belongs in `src/pinia-stores/`, focused runtime modules, or Vue components.

## `src/` Structure

```text
src/
├── main.js
├── App.vue
├── components/
│   ├── ToastMessage.vue
│   ├── ClozeQuizView.vue
│   ├── ClozeCard.vue
│   ├── TranscriptContainer.vue
│   └── ChunkModeView.vue
├── pinia-stores/
│   ├── theme.js
│   ├── ui.js
│   ├── audio.js
│   ├── marks.js
│   ├── cloze.js
│   ├── transcript.js
│   ├── chunk.js
│   ├── notes.js
│   └── annotation.js
├── stores/
│   ├── theme.js
│   ├── ui.js
│   ├── audio.js
│   ├── marks.js
│   ├── cloze.js
│   ├── transcript.js
│   ├── chunk.js
│   ├── notes.js
│   └── annotation.js
├── composables/
│   ├── session-init.js
│   ├── import-module.js
│   ├── notes-module.js          # chunk note + sentence note subsystem runtime/state
│   ├── keyboard-module.js
│   ├── style-editor.js
│   ├── playback-module.js
│   ├── app-handlers.js
│   ├── chunk-note-layout.js
│   ├── transcript-state.js
│   ├── chunk-state.js
│   ├── cloze-state.js
│   ├── playback-state.js
│   ├── glass-effects.js
│   ├── controls-module.js
│   ├── file-input-bindings.js   # file picker DOM binding
│   └── annotation-lightweight-module.js
├── utils/
│   ├── data-utils.js
│   ├── identity-storage-keys.js
│   ├── import-export-helpers.js
│   ├── sentence-notes-persistence.js
│   ├── cloze-utils.js
│   ├── cloze-view-model.js
│   ├── playback-index.js
│   ├── chunk-matching.js
│   └── vocab-matching.js
└── services/annotation/
    ├── controller.js
    ├── api-client.js
    ├── api-config.js
    ├── storage.js
    ├── target-source.js
    ├── block-planner.js
    ├── prompt-builder.js
    ├── result-store.js
    ├── progress-store.js
    ├── click-resolver.js
    ├── diagnostics.js
    ├── diagnostics-records.js
    ├── run-diagnostics.js
    └── diff.js
```

## State Ownership

Current state ownership is transitional:

```text
app.js remaining let state + runtime state adapters
  ↕ window.__state proxy
  ↕ direct adapter-to-Pinia binding + bridgeToPinia runtime compatibility
  ↕ src/pinia-stores real Pinia state
  ↕ Vue components
```

Compatibility stores in `src/stores/` attach `window.__themeStore`, `window.__audioStore`, `window.__uiStore`, and similar objects. `src/main.js` replaces selected compatibility methods with Pinia-backed methods after the Vue app is mounted.

## Rendering

Vue rendering is enabled by default.

```text
TranscriptContainer.vue   # normal transcript rendering
ChunkModeView.vue         # AI chunk rendering
ClozeQuizView.vue         # quiz list
ClozeCard.vue             # quiz card
ToastMessage.vue          # reactive toast
```

Legacy DOM and handlers still exist and must remain compatible until the migration is completed.

## Verification

```text
npm run build        # Vite build and legacy script copy
npm run verify:vite  # Vite dev server + Playwright load check
npm run verify:chunk-notes-state # Focused chunk note state helper check
npm run verify:chunk-state # Focused chunk state adapter check
npm run verify:cloze-state # Focused cloze state adapter check
npm run verify:playback-state # Focused playback state adapter check
npm run verify:state-facades # Focused window.__state owner facade check
npm run verify:bridge-startup # Focused adapter-to-Pinia startup check
npm run verify:file-input-bindings # Focused file picker DOM binding check
npm test             # Alias for verify:vite
```

The old `read-26.html` path is gone. Do not use it as the current app entry.
