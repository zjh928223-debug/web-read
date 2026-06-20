# PROJECT_MAP.md - Read-Web Current Map

## Top-Level Runtime Files

```text
read-web/
├── index.html                         # Vite-served browser entry and legacy DOM shell
├── src/composables/reader-runtime.js  # Thin runtime entry, about 28 lines
├── src/composables/reader-runtime-assembly.js # Remaining runtime assembly, about 51 lines
├── src/composables/session-init.js    # Thin session entry, about 7 lines
├── src/composables/session-runtime-assembly.js # Session startup/annotation assembly, about 253 lines
├── styles.css                         # Global CSS linked by index.html
├── vite.config.js                     # Vite + Vue config
├── package.json                       # Current commands and dependencies
├── chunk-note-layout-helpers.js       # Legacy root file, no longer loaded by index.html
├── chunk-note-layout-core.js          # Legacy root file, no longer loaded by index.html
├── annotation-bubble.js               # Legacy root file, no longer loaded by index.html
└── annotation-api-settings-ui.js      # Legacy root file, no longer loaded by index.html
```

## Browser Execution Order

```text
index.html
├── src/stores/*.js compatibility modules
├── src/composables/*.js compatibility modules
├── src/composables/reader-runtime.js
├── src/composables/session-init.js
└── src/main.js
```

The page no longer contains inline DOM event handlers. Remaining legacy controls are bound by `src/composables/legacy-control-bindings.js`, while focused composables own the remaining compatibility functions exposed on `window`.

## Cleanup Baseline

`complete-appjs-decomposition` has been completed and archived under `openspec/changes/archive/2026-06-18-complete-appjs-decomposition/`. Current cleanup context comes from `CURRENT_PROJECT_STATUS.md` and the active spec at `openspec/specs/legacy-runtime-decomposition/spec.md`.

Cleanup rules:

- Do not add user-facing feature logic to `src/composables/reader-runtime.js`; do not reintroduce `src/composables/reader-runtime-shell.js`.
- Do not add feature logic to `src/composables/session-init.js`; keep it as a thin entry that initializes `src/composables/session-runtime-assembly.js`.
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
│   ├── reader-runtime.js        # thin runtime entry
│   ├── reader-runtime-assembly.js # context/notes/feature assembly sequence
│   ├── session-init.js          # thin session entry
│   ├── session-runtime-assembly.js # session startup/annotation assembly
│   ├── session-state-provider.js # temporary session-init state provider
│   ├── session-annotation-services.js # annotation service/global lookup helpers
│   ├── session-annotation-text.js # annotation text normalization/context helpers
│   ├── session-annotation-export-payload.js # lightweight export payload builder
│   ├── session-annotation-import-normalization.js # lightweight import normalization
│   ├── session-annotation-bundle-merge.js # lightweight generated/status merge
│   ├── session-annotation-generated-index.js # generated annotation index runtime
│   ├── session-annotation-marks.js # annotation mark normalize/rebuild runtime
│   ├── session-annotation-context.js # annotation document context runtime
│   ├── session-annotation-lightweight-io.js # lightweight annotation import/export IO
│   ├── session-annotation-api-settings-runtime.js # API settings session runtime
│   ├── session-restore-runtime.js # persisted session restore runtime
│   ├── session-startup-runtime.js # DB-ready startup orchestration
│   ├── session-startup-cleanup.js # startup persisted cleanup runtime
│   ├── session-ui-settings-restore.js # persisted UI/hotkey restore
│   ├── runtime-state-bindings.js # runtimeState st.* compatibility bindings
│   ├── reader-feature-runtime.js # import/controls/interactions/keyboard/app composition
│   ├── reader-feature-runtime-deps.js # feature runtime dependency assembly
│   ├── reader-runtime-context.js # startup context composition for reader-runtime
│   ├── reader-dom-refs.js       # static reader runtime DOM refs
│   ├── reader-bootstrap-runtime.js # state/helper/audio/hotkey/marks bootstrap
│   ├── reader-runtime-deps.js   # runtime utility/global helper dependency collection
│   ├── reader-notes-session-runtime-deps.js # notes/session dependency assembly
│   ├── reader-notes-session-runtime.js # notes setup + session wrapper composition
│   ├── reader-notes-runtime.js  # notes API setup + Pinia bridge runtime
│   ├── reader-session-runtime.js # session-facing note/audio lifecycle wrappers
│   ├── reader-interaction-runtime.js # render config + playback runtime initialization
│   ├── reader-playback-runtime.js # playback setup + transcript/chunk interactions
│   ├── reader-controls-runtime.js # highlight/chunk/theme/style/settings setup
│   ├── reader-keyboard-runtime.js # keyboard module setup + injected handlers
│   ├── reader-app-runtime.js      # transfer/app handlers/controls/glass/public facades setup
│   ├── reader-import-runtime.js   # session/import/vocab/runtime-state setup
│   ├── reader-runtime-helpers.js # focus/current-note/export-dialog helper runtime
│   ├── import-module.js
│   ├── notes-module.js          # chunk note + sentence note subsystem runtime/state
│   ├── keyboard-module.js
│   ├── style-editor.js          # visual style editor + local style parsing helper
│   ├── playback-module.js
│   ├── playback-runtime-helpers.js # playback helper behavior + sentence jumps
│   ├── app-handlers.js          # mark import/export handlers
│   ├── chunk-note-transfer-module.js # chunk note import/export transfer UI
│   ├── visual-vocab-module.js   # visual vocab state + processVisual compatibility
│   ├── audio-identity-module.js # audio meta/key state + derived storage/doc ids
│   ├── hotkey-state-module.js   # hotkey runtime state
│   ├── marks-state-module.js    # marks runtime state
│   ├── chunk-note-layout.js
│   ├── transcript-state.js
│   ├── chunk-state.js
│   ├── cloze-state.js
│   ├── playback-state.js
│   ├── pinia-bridge-module.js    # bridgeToPinia compatibility owner
│   ├── glass-effects.js         # glass UI decoration + chunk note dimension lock setup
│   ├── controls-module.js
│   ├── chunk-controls-module.js  # AI chunk mode controls + temporary window facades
│   ├── theme-controls-module.js # theme control DOM bindings
│   ├── highlight-controls-module.js # highlight controls + temporary facade
│   ├── file-input-bindings.js   # file picker DOM binding
│   ├── legacy-control-bindings.js # remaining legacy control DOM binding
│   ├── transcript-interactions.js # normal transcript word interaction binding
│   ├── chunk-interactions.js     # AI chunk word/chunk interaction binding
│   ├── cloze-interactions.js     # cloze answer/card interaction binding
│   ├── render-runtime.js         # render facade runtime + legacy cloze fallback binding
│   ├── annotation-bubble.js       # annotation bubble DOM API module
│   ├── annotation-api-settings-ui.js # annotation API settings panel module
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
│   ├── vocab-matching.js
│   ├── chunk-note-layout-helpers.js
│   └── chunk-note-layout-core.js
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
src/composables/runtime-state-facade.js runtimeState
  ↕ temporary window.__state alias
src/composables/reader-runtime.js thin runtime entry
  → src/composables/reader-runtime-assembly.js remaining runtime assembly
  ↕ pinia-bridge-module bridgeToPinia runtime compatibility
  ↕ src/pinia-stores real Pinia state
  ↕ Vue components
src/composables/session-init.js thin session entry
  → src/composables/session-runtime-assembly.js session assembly
  → focused session-* modules for restore/startup/annotation import-export
  → window.__session_* compatibility facades
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

Legacy DOM and module-bound compatibility handlers still exist and must remain compatible until the migration is completed.

## Verification

```text
npm run build        # Vite production build
npm run verify:vite  # Vite dev server + Playwright load check
npm run verify:chunk-notes-state # Focused chunk note state helper check
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
npm run verify:session-runtime-assembly # Focused thin session entry and assembly guard
npm run verify:session-annotation-services # Focused session annotation service helper check
npm run verify:session-annotation-text # Focused session annotation text/context helper check
npm run verify:session-annotation-export-payload # Focused annotation lightweight export payload check
npm run verify:session-annotation-import-normalization # Focused annotation lightweight import normalization check
npm run verify:session-annotation-bundle-merge # Focused annotation lightweight bundle merge check
npm run verify:session-annotation-generated-index # Focused generated annotation index runtime check
npm run verify:session-annotation-marks # Focused annotation marks runtime check
npm run verify:session-annotation-context # Focused annotation document context check
npm run verify:session-annotation-lightweight-io # Focused annotation lightweight IO runtime check
npm run verify:session-annotation-api-settings-runtime # Focused annotation API settings runtime check
npm run verify:session-startup-cleanup # Focused startup cleanup runtime check
npm run verify:session-restore-runtime # Focused persisted session restore runtime check
npm run verify:session-startup-runtime # Focused DB-ready startup orchestration check
npm run verify:session-ui-settings-restore # Focused persisted UI settings restore check
npm run verify:runtime-state-source # Focused runtime state source guard
npm run verify:reader-runtime-shell # Focused retired reader runtime assembly guard
npm run verify:reader-runtime-assembly # Focused reader runtime assembly sequence check
npm run verify:reader-runtime-context # Focused reader startup context composition check
npm run verify:reader-feature-runtime # Focused reader feature runtime composition check
npm run verify:reader-feature-runtime-deps # Focused reader feature runtime dependency assembly check
npm run verify:reader-bootstrap-runtime # Focused reader bootstrap runtime setup check
npm run verify:reader-runtime-deps # Focused reader runtime dependency collection check
npm run verify:reader-notes-session-runtime-deps # Focused reader notes/session runtime dependency assembly check
npm run verify:reader-notes-session-runtime # Focused reader notes/session runtime setup check
npm run verify:reader-notes-runtime # Focused reader notes runtime setup check
npm run verify:reader-session-runtime # Focused reader session runtime setup check
npm run verify:reader-interaction-runtime # Focused reader interaction runtime setup check
npm run verify:reader-playback-runtime # Focused reader playback runtime setup check
npm run verify:reader-controls-runtime # Focused reader controls runtime setup check
npm run verify:reader-keyboard-runtime # Focused reader keyboard runtime setup check
npm run verify:reader-app-runtime # Focused reader app runtime setup check
npm run verify:reader-import-runtime # Focused reader import runtime setup check
npm run verify:reader-runtime-helpers # Focused reader runtime helper extraction check
npm run verify:reader-dom-refs # Focused reader runtime DOM ref collection check
npm run verify:app-window-facades # Focused app.js duplicate window facade guard
npm run verify:pinia-bridge-module # Focused Pinia bridge module check
npm run verify:audio-store-facades # Focused DB compatibility facade check
npm run verify:chunk-note-style-facades # Focused chunk note style facade check
npm run verify:keyboard-facades # Focused keyboard helper facade check
npm run verify:import-facades # Focused transcript/chunk import facade check
npm run verify:chunk-controls-module # Focused AI chunk controls module check
npm run verify:highlight-controls-module # Focused highlight controls module check
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
npm test             # Alias for verify:vite
```

The old `read-26.html` path is gone. Do not use it as the current app entry.
