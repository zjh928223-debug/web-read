# Read-Web Current Project Status

Last scanned: 2026-06-16

This document records the current state of the `E:\read-web` project from the actual file tree and entry files. It should be treated as the primary current-status document when it conflicts with older migration notes.

## 1. What This Project Is

Read-Web is a browser-based language reading tool currently hosted by Vite. It is a migration from a legacy single-page HTML/JavaScript reader into a Vue 3 + Pinia structure.

The project is not a clean Vue-only app yet. It is a working hybrid:

```text
index.html legacy DOM shell
  -> compatibility ES modules under src/stores and src/composables
  -> app.js legacy central runtime
  -> session-init.js startup and annotation glue
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
- chunk note bubbles with selection annotations and connector lines
- cloze quiz rendering
- lightweight annotation template export/import
- annotation API settings UI

## 2. Current Entry Points

Top-level runtime files:

```text
index.html                         browser entry and legacy DOM shell
app.js                             legacy central runtime, about 1815 lines
styles.css                         global styles, about 2322 lines
vite.config.js                     Vite + Vue config
package.json                       scripts and dependencies
src/main.js                        Vue mount, Pinia setup, side-effect imports, about 149 lines
src/App.vue                        root Vue component
src/composables/session-init.js    startup restore and annotation/session glue
```

There is no `read-26.html` in the current project root. Any reference to `read-26.html` is legacy context from the source project, not the current web app entry.

## 3. Browser Load Order

`index.html` currently loads these scripts in this order:

```text
1. External Google CSE script
2. 9 compatibility store modules under src/stores/
3. 10 compatibility/runtime modules under src/composables/
4. app.js as an ES module
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
  composables/                    24 compatibility/runtime modules
  pinia-stores/                   9 real Pinia stores
  stores/                         9 compatibility window stores
  utils/                          11 utility modules
  services/annotation/            14 annotation pipeline modules
```

Current Vue components:

```text
ChunkModeView.vue                 AI chunk rendering, about 126 lines
TranscriptContainer.vue           normal transcript rendering, about 89 lines
ClozeCard.vue                     cloze card UI, about 68 lines
ClozeQuizView.vue                 cloze quiz list, about 46 lines
ToastMessage.vue                  toast UI, about 27 lines
```

`SentenceNoteSidebar.vue` has been removed from the current tree.

Current composables:

```text
session-init.js                   about 1590 lines
session-state-provider.js         about 15 lines
import-module.js                  about 544 lines
notes-module.js                   about 2485 lines
keyboard-module.js                about 384 lines
playback-module.js                about 253 lines
style-editor.js                   about 201 lines
app-handlers.js                   about 99 lines
chunk-note-layout.js              about 169 lines
transcript-state.js               about 112 lines
chunk-state.js                    about 161 lines
cloze-state.js                    about 109 lines
playback-state.js                 about 85 lines
glass-effects.js                  about 95 lines
controls-module.js                about 63 lines
file-input-bindings.js            about 22 lines
legacy-control-bindings.js        about 73 lines
transcript-interactions.js        about 111 lines
chunk-interactions.js             about 136 lines
cloze-interactions.js             about 93 lines
render-runtime.js                 about 21 lines
annotation-bubble.js              about 369 lines
annotation-api-settings-ui.js     about 432 lines
annotation-lightweight-module.js  about 82 lines
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

The app is still centered on `app.js`.

Current state flow:

```text
app.js remaining local variables and runtime state adapters
  <-> window.__state getter/setter proxy
  <-> direct adapter-to-Pinia binding and runtime bridgeToPinia compatibility
  <-> src/pinia-stores/*.js real Pinia stores
  <-> Vue components
```

There are two store layers:

- `src/pinia-stores/`: real Pinia stores used by Vue components.
- `src/stores/`: compatibility modules that attach objects such as `window.__themeStore`, `window.__audioStore`, `window.__uiStore`, and similar globals.

`src/main.js` imports utilities and annotation services for side effects, creates the Pinia app, then replaces selected compatibility store methods with Pinia-backed methods.

## 6. Rendering State

`app.js` initializes:

```js
window.__USE_VUE_RENDERING = true
```

`src/main.js` then mirrors the render flag into the transcript Pinia store and applies the legacy/Vue container display mode. The Vue components are active, but many interactions still rely on:

- module-bound legacy controls from `src/composables/legacy-control-bindings.js`
- `window.xxx` functions exported by `app.js` and composables
- direct DOM reads/writes
- legacy CSS classes

The current migration goal should be to keep behavior stable while gradually moving state ownership and rendering out of `app.js`.

Transcript, chunk, cloze, and playback transient state have started moving out of `app.js`: `src/composables/transcript-state.js`, `src/composables/chunk-state.js`, `src/composables/cloze-state.js`, and `src/composables/playback-state.js` provide focused adapters. The transcript/chunk/cloze adapters bind directly to the real Pinia stores after Pinia creation; playback state currently stays in its runtime adapter. `window.__state` fields remain as compatibility facades, but controls/playback/session-init now receive state through explicit deps/provider instead of direct global reads.

## 7. Important Runtime Behaviors

### Audio and Transcript

- Audio is loaded through `#audio-file`.
- Transcript JSON is loaded through `#transcript-file`.
- `processTranscript(...)` remains a central entry for transcript ingestion.
- Normal transcript rendering is handled by `TranscriptContainer.vue` when Vue rendering is active.
- Normal transcript word click/contextmenu interaction is owned by `TranscriptContainer.vue` plus `src/composables/transcript-interactions.js`; `app.js` only configures temporary runtime dependencies.
- `window.renderTranscript` and `window.renderChunkMode` have been removed. `session-init.js` now reaches the temporary render boundary through `src/composables/render-runtime.js`.
- `session-init.js` now reaches the temporary state boundary through `src/composables/session-state-provider.js`.

### Playback Highlighting and Follow

- `src/composables/playback-module.js` owns the migrated playback update functions.
- `src/composables/playback-state.js` owns playback transient state such as auto-follow, scroll suppression, active highlight element refs, playback loop signature, and sentence previous-tap navigation state.
- `app.js` still provides dependencies such as `followPlaybackTarget`.
- Auto-follow now behaves like page turning: when the active sentence reaches the lower trigger area, it scrolls the active sentence near the top of the viewport instead of centering it.
- The follow threshold is based on the current scroll container height, so resizing or zooming recalculates the visible zone dynamically.

### AI Chunk Mode

- Chunk data is loaded through `#chunk-file`.
- `processChunkData(...)` is the central chunk ingestion entry.
- `ChunkModeView.vue` renders chunk blocks.
- AI chunk word/chunk click and contextmenu interaction is owned by `ChunkModeView.vue` plus `src/composables/chunk-interactions.js`; `app.js` only configures temporary runtime dependencies.
- Chunk mode state now goes through `src/composables/chunk-state.js`, which binds to `src/pinia-stores/chunk.js`.
- Chunk mode defaults are currently focus-oriented:
  - sentence highlighting by default
  - Chinese hidden unless held, depending on current state
  - focus mode available through `#btn-chunk-focus`

### Cloze Quiz

- Cloze data is loaded through `#cloze-file`.
- Cloze quiz state now goes through `src/composables/cloze-state.js`, which binds to `src/pinia-stores/cloze.js`.
- `src/composables/import-module.js` still owns cloze import and legacy render/check facades through the app-injected state compatibility facade.
- `ClozeQuizView.vue` builds cards and checks answers through `src/composables/cloze-interactions.js` against the cloze Pinia store.
- `ClozeCard.vue` updates draft answers through `src/composables/cloze-interactions.js` and no longer queries DOM input state on check.
- The legacy `window.__clozeCheck` facade remains for the non-Vue fallback path, but its answer-state check now reuses the same cloze interaction helper.

### Chunk Notes

- Chunk notes are still high-risk because they cross legacy DOM, Vue-rendered chunks, and compatibility globals.
- Chunk note record CRUD, import normalization, snapshot saving, export file handle state, selected/active note state, block-ref note lookup, draft storage, pending context access, right-click context resolution, popover DOM, rendered tag lifecycle, drag/resize/edit behavior, connector drawing, delete prompt, and style modal runtime now delegate through `src/composables/notes-module.js`.
- `src/composables/notes-module.js` now owns shared chunk/sentence note runtime state through `window.__notesState`; `app.js` keeps only a local `_ns` reference to that owner for compatibility.
- `app.js` still keeps compatibility wrappers for existing global callers, but `index.html` no longer uses inline handlers and the chunk note overlay/tag interaction implementation has moved behind the `_cnApi` subsystem API.
- Right-click or selected text can create chunk note bubbles.
- Saved notes add underline markers to selected words.
- Hovering note tags can draw connector lines through `#chunk-note-svg-layer`.
- Delete key on selected note tags should open a delete confirmation.

### Sentence Notes

- Sentence note draft, edit persistence, selected sentence transitions, focus phrase capture, note preview rendering, preview visibility/resize state, and current-doc import snapshot application now delegate through `src/composables/notes-module.js`.
- `app.js` still keeps thin compatibility wrappers for existing global, inline, startup, import, and Vue callers, while the note state itself is owned by `window.__notesState`.
- `window.selectSentenceFromChunkTarget` remains as a compatibility export, but `ChunkModeView.vue` now reaches it through `src/composables/chunk-interactions.js` runtime configuration instead of a direct component call.
- `session-init.js` still uses global sentence note load/switch entrypoints; direct API injection is a later cleanup step.

### Annotation Tools

- Full generated-annotation prompt UI was removed from the main toolbar.
- Lightweight annotation export/import remains:
  - `#btn-export-annotation-lightweight`
  - `#btn-import-annotation-lightweight`
  - `#import-annotation-lightweight-file`
- Lightweight annotation import/export button glue now lives in `src/composables/annotation-lightweight-module.js`; the real import/export implementation remains in `src/composables/session-init.js`.
- API settings UI now lives in `src/composables/annotation-api-settings-ui.js`; `index.html` no longer loads the root regular script.

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
npm run verify:state-facades
npm run verify:bridge-startup
npm run verify:file-input-bindings
npm run verify:inline-handler-bindings
npm run verify:control-playback-state-deps
npm run verify:session-state-provider
npm run verify:transcript-interactions
npm run verify:chunk-interactions
npm run verify:cloze-interactions
npm run verify:render-facades
npm run verify:script-order
npm run verify:chunk-note-layout-helpers
npm run verify:chunk-note-layout-core
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
scripts/chunk-notes-state-check.cjs
scripts/sentence-notes-state-check.cjs
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
scripts/transcript-interactions-check.cjs
scripts/chunk-interactions-check.cjs
scripts/cloze-interactions-check.cjs
scripts/render-facades-check.cjs
scripts/script-order-guard-check.cjs
scripts/chunk-note-layout-helpers-module-check.cjs
scripts/chunk-note-layout-core-module-check.cjs
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
- chunk note right-click, save, underline, connector, and delete prompt
- chunk note state normalization/upsert/delete/import/file-handle behavior through `verify:chunk-notes-state`
- sentence note selection/draft/persistence/import/export behavior through `verify:sentence-notes-state`
- annotation lightweight DOM glue through `verify:annotation-lightweight-module`
- keyboard boundary helper ownership through `verify:keyboard-boundary`
- transcript state adapter ownership through `verify:transcript-state`
- chunk state adapter ownership through `verify:chunk-state`
- cloze state adapter ownership through `verify:cloze-state`
- playback transient state adapter ownership through `verify:playback-state`
- migrated `window.__state` owner facades through `verify:state-facades`
- removed no-consumer `window.__state` facades are guarded from reappearing through `verify:state-facades`
- removed `window.__bridge` startup dependency through `verify:bridge-startup`
- Phase 3 state ownership stage gate passed through `npm test`, `npm run verify:playback`, and `npm run verify:interactions`
- migrated chunk/cloze file picker inline handlers and cloze button DOM ownership through `verify:file-input-bindings`
- removed remaining inline DOM handlers from `index.html` through `verify:inline-handler-bindings`
- removed direct `window.__state` reads from controls/playback modules through `verify:control-playback-state-deps`
- removed direct `window.__state` reads from `session-init.js` through `verify:session-state-provider`
- migrated normal transcript word click/contextmenu ownership through `verify:transcript-interactions`
- migrated AI chunk word/chunk click/contextmenu ownership through `verify:chunk-interactions`
- migrated Vue cloze answer draft/check ownership through `verify:cloze-interactions`
- removed global render facades through `verify:render-facades`
- guarded current `index.html` script order through `verify:script-order`
- Phase 4 DOM/event ownership checkpoint passed through `npm test`, standalone `npm run verify:playback`, standalone `npm run verify:interactions`, and `npm run build`
- migrated `chunk-note-layout-helpers.js` logic into `src/utils/chunk-note-layout-helpers.js` through `verify:chunk-note-layout-helpers`
- migrated `chunk-note-layout-core.js` logic into `src/utils/chunk-note-layout-core.js` through `verify:chunk-note-layout-core`
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
app.js
src/composables/session-init.js
src/composables/keyboard-module.js
src/composables/notes-module.js
src/components/ChunkModeView.vue
src/components/TranscriptContainer.vue
src/services/annotation/controller.js
styles.css
index.html script order
```

Main risks:

- `app.js` still owns some remaining central runtime state and many global exports, while transcript, chunk, cloze, playback transient, and note state now delegate through focused adapters/modules. A small set of no-consumer `window.__state` facades has been removed.
- `session-init.js` mixes startup restore, persisted cleanup, annotation import/export, and diagnostics.
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
- Current cleanup mode: do not add user-facing features until the `complete-appjs-decomposition` route has removed or fully neutralized `app.js`.
- Do not move script order unless the full app is verified afterward.
- Do not add new feature logic to `app.js` unless there is no safer place.
- Prefer modules, Pinia stores, and Vue components for new work.
- Keep compatibility globals in place until the caller paths are migrated.
- Treat `window.__state`, runtime `bridgeToPinia`, former `window.__bridge` expectations, and `window.*` exports as compatibility surfaces to retire, not as places to add new architecture.
- Keep each cleanup step stage-gated: update the runtime map, migrate one boundary, then run the required verification before starting the next boundary.
- Do not use `file:///E:/read-web/index.html` as the normal launch path; use Vite.
- Do not treat `read-26.html` as the current project entry.
- Run `npm test` for behavior changes.
- Run `npm run build` when changing entry files, scripts, Vite config, or root regular scripts.
