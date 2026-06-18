# Phase 2 Sentence Note / Note Preview Subsystem API

Last scanned: 2026-06-16

This document completes task 3.4. It defines the migration contract for moving sentence note and note preview behavior out of `app.js` without changing user-visible behavior.

## Current Boundary

Sentence notes are currently split across `app.js`, `src/composables/notes-module.js`, and startup/import modules:

| Area | Current owner | Notes |
| --- | --- | --- |
| Normalized sentence note records | `src/composables/notes-module.js` through `_snApi` | Already owns record normalization, item sorting, doc-scoped load/save, legacy migration, doc switching, export snapshot building, and download trigger. |
| Draft/edit state | `app.js` plus `_ns` | `app.js` owns draft commit/discard, edit item id, saved feedback timer, and note preview scroll target state. |
| Selected sentence | `app.js` plus `_ns` | `selectSentenceFromChunkTarget()`, `setSelectedSentence()`, and selection capture still live in `app.js`. |
| Preview rendering | `app.js` | Builds `.sentence-note-item` DOM, textarea events, empty states, saved/editing classes, sidebar body class, and scroll restoration. |
| Preview visibility and resize | `app.js` | Uses `notePreviewVisible`, `notePreviewWidth`, `notePreviewHeight`, `notePreviewResizeRaf`, localStorage, CSS variables, and resize handles. |
| Import/export buttons | `app.js` | Button handlers use `_snApi` for snapshot/download but still parse/import JSON and wire DOM events in `app.js`. |
| Startup/session integration | `session-init.js` through globals | Calls `loadSentenceNotesForCurrentAudio()` and `switchSentenceNotesDoc()` globals, and clears `_ns.selectedSentence` during persisted cleanup. |
| Vue state mirror | `src/pinia-stores/notes.js` | Contains `sentenceNotesMap`, `currentDocId`, and `selectedSentence`, but it is not the real owner yet. |

## Current Compatibility Entrypoints

These entrypoints must remain stable until their consumers move:

| Entrypoint | Current consumers | Target owner | Deletion condition |
| --- | --- | --- | --- |
| `window.loadSentenceNotesForCurrentAudio()` | `src/composables/session-init.js` | sentence note persistence API | `session-init.js` receives/injects the subsystem API directly. |
| `window.switchSentenceNotesDoc(transcriptSource)` | `src/composables/session-init.js`, `src/composables/import-module.js` | sentence note doc/session API | Restore and import flows use the subsystem API directly. |
| `window.selectSentenceFromChunkTarget(target)` | `ChunkModeView.vue`, transcript click path | sentence selection API or Vue event binding | `ChunkModeView.vue` emits selection through a module/component callback instead of calling a global. |
| `renderNotePreviewSidebar()` local wrapper | `_snApi` doc switch callback, draft/edit code | note preview renderer API | `notes-module.js` owns preview rendering and no longer needs an app-local callback. |
| `persistSelectedSentenceNote()` local wrapper | `_snApi.persistSentenceNotebookNow()`, selection transitions | sentence note draft/edit API | Draft/edit persistence lives in the subsystem API. |
| `applyImportedSentenceNotesSnapshot(data)` local function | sentence note import button handler | sentence note import API | Import button handler delegates to subsystem or moves out of `app.js`. |
| `toggleNotePreviewSidebar(forceState)` local function | toolbar button/event binding | note preview visibility API | Toolbar event binding moves to a module/component and no longer calls `app.js`. |
| `initNotePreviewResize()` local function | startup wiring in `app.js` | note preview layout API | Resize handlers move to subsystem or component ownership. |
| `_ns.sentenceNotesMap` / `_ns.allSentenceNotesByDoc` / `_ns.currentDocId` | `app.js`, `notes-module.js`, `session-init.js` cleanup | sentence note state owner | Phase 3 converts `window.__state`/`_ns` fields into facades over the real owner. |
| `_ns.sentenceNoteDraft` / `_ns.notePreviewEditingItemId` / `_ns.notePreviewSavedItemId` / `_ns.selectedSentence` | `app.js`, `notes-module.js`, `session-init.js` cleanup | sentence note UI state owner | No direct runtime consumers remain outside the subsystem/API. |

## Target Public API

Use `_snApi` during migration. It may later be split into smaller modules, but `app.js` should only delegate to it.

### `state`

Owns normalized note records, doc scope, selected sentence, draft item, editing item id, saved feedback id, and preview scroll target.

Required methods:

- `getSentenceNoteRecord(sentenceId)`
- `getSortedSentenceNoteItems(sentenceId)`
- `getSelectedSentence()`
- `setSelectedSentence(nextSentence)`
- `clearSelectedSentence()`
- `getDraft()`
- `discardDraft(shouldRender = true)`
- `commitDraft(shouldRender = true)`
- `findItem(sentenceId, itemId)`
- `persistItem(sentenceId, itemId, shouldRender = true)`

Record format must remain compatible with existing persisted JSON:

```text
sentenceId
items[]
  itemId
  selectedText
  noteBody
  createdAt
  updatedAt
```

Legacy single-note records with `focusPhrase`, `noteBody`, and `updatedAt` must still normalize into `items[]`.

### `persistence`

Owns doc-scoped IndexedDB load/save and legacy migration.

Required methods:

- `loadForCurrentAudio()`
- `saveDebounced()`
- `persistNow()`
- `persistCurrentDoc()`
- `switchDoc(transcriptSource)`
- `ensureLegacyForDoc(docId)`
- `getCurrentDocIdForExport()`
- `buildExportSnapshot()`

Constraints:

- Keep DB name/version/store untouched: `SeekPlayerDB`, version `1`, store `files`, key path `id`.
- Keep current storage keys:
  - `allSentenceNotesByDoc`
  - `sentenceNotes::<audioKey>`
- Keep export payload shape: `{ docId, exportedAt, notes }`.

### `selection`

Owns selecting a chunk/sentence and creating a draft from selected focus text.

Required methods:

- `selectFromChunkTarget(target)`
- `hasActiveTextSelectionWithinChunk()`
- `getSelectionChunkSentence()`
- `maybeCaptureFocusPhrase()`
- `updateFocusPhrase(sentence, focusPhrase)`

Compatibility behavior to preserve:

- Clicking a chunk selects that chunk as the current sentence.
- If text selection exists inside the active chunk, normal audio seek should not override it.
- Selection text inside one `.chunk-block .chunk-en` creates a draft note item for that sentence.
- Selecting a new sentence persists the previous draft/edit state first.

### `preview`

Owns preview sidebar rendering, visibility, resize, and textarea interactions.

Required methods:

- `renderSidebar()`
- `showEmptyState(message)`
- `toggleSidebar(forceState = null)`
- `applySize()`
- `initResize()`
- `formatItemMeta(item, itemId, isEditing = false)`
- `triggerSavedFeedback(itemId = '')`
- `buildItemElement(sentenceId, item, options)`

Compatibility behavior to preserve:

- Toggle `document.body.note-preview-open`.
- Toggle `#toggle-note-preview-btn.active`.
- Toggle `#note-preview-sidebar.note-editing` and `.note-has-selection`.
- Preserve empty-state text behavior.
- Preserve draft item ordering after saved items.
- Preserve scroll restoration and scroll-to-new-draft behavior.
- Persist `notePreviewVisible`, `notePreviewWidth`, and `notePreviewHeight` localStorage keys.
- Keep CSS variables `--note-preview-width` and `--note-preview-height`.
- Keep width clamp `280..520` and height clamp `420..window.innerHeight - 28`.

### `importExport`

Owns sentence note import/export behavior.

Required methods:

- `applyImportedSnapshot(data)`
- `triggerDownload(snapshot, filename)`
- `bindImportExportControls()` or equivalent explicit event module entry

Compatibility behavior to preserve:

- Imported JSON must be a plain object with matching `docId` and plain `notes` payload.
- Import replaces the current doc notes, clears draft/edit/saved transient state, saves to `allSentenceNotesByDoc`, and re-renders preview.
- Export persists current draft/edit state before snapshot.
- Export filename should continue to use the current audio filename base with `_sentence_notes.json`.

## Migration Slices

### 3.5 State, Draft, Selection, Rendering

Move after 3.4 is committed:

- draft commit/discard/edit persistence
- selected sentence state transitions
- focus phrase capture
- preview DOM rendering
- preview visibility and resize wiring
- sentence note import snapshot application

Keep compatibility wrappers in `app.js` until later phases:

- `window.loadSentenceNotesForCurrentAudio`
- `window.switchSentenceNotesDoc`
- `window.selectSentenceFromChunkTarget`
- local handlers that are still passed to `session-init.js`, `import-module.js`, or Vue callers

Do not move in 3.5:

- `session-init.js` startup flow itself
- annotation lightweight import/export glue
- general keyboard ownership
- `index.html` script order or inline handler removal

## Verification Requirements

For 3.5:

- Add or update a focused sentence note check if practical.
- Run `npm test`.
- Run `npm run verify:interactions` through `npm run verify:vite` or with a running Vite server.
- Run `npm run build` if module boundaries or entry loading changed.
- Preserve import/export behavior for current-doc sentence notes.

## Forbidden Moves In This Phase

- Do not change IndexedDB schema.
- Do not change `index.html` script order.
- Do not migrate `session-init.js` annotation glue while moving sentence notes.
- Do not convert the sidebar to a new Vue component design in the same task.
- Do not remove `window.selectSentenceFromChunkTarget` until `ChunkModeView.vue` no longer calls it.
- Do not remove sentence note state facades until Phase 3 state ownership work proves no direct consumers remain.
