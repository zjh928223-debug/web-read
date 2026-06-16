# Phase 2 Chunk Note Subsystem API

Last scanned: 2026-06-16

This document completes task 3.1. It defines the migration contract for moving chunk note behavior out of `app.js` without changing user-visible behavior.

## Current Boundary

Chunk notes are currently split across several compatibility layers:

| Area | Current owner | Notes |
| --- | --- | --- |
| Persisted note map | `src/composables/notes-module.js` through `_cnApi` | Task 3.2 moved CRUD, import normalization, snapshot saving, and export file handle state. `app.js` still reads the map for overlay/tag rendering until 3.3. |
| Visibility | `notes-module.js` via `setChunkNoteVisible()` wrapper in `app.js` | Uses `localStorage.chunkNoteVisible`, `body.hide-chunk-note`, overlay refresh, and connector redraw. |
| Draft note modal state | `app.js` | Uses `chunkNoteDraft::*` localStorage keys plus DOM-derived modal position. |
| Context menu | `notes-module.js` plus `keyboard-module.js` and `app.js` | `notes-module.js` positions the menu; `keyboard-module.js` binds the add button; `app.js` builds the context from selection/right-click. |
| Tag rendering and overlay | `app.js` | Creates `.chunk-note-tag`, image text rendering, drag/resize/edit behavior, selection state, and connector SVG paths. |
| Style modal | `app.js` inline-handler globals | `index.html` calls `openChunkNoteStyleModal()`, `closeChunkNoteStyleModal()`, and `updateChunkNoteStyle()`. |
| Import/export | `notes-module.js` plus `app.js` button/dialog wiring | JSON normalization and file handle state moved in 3.2; button bindings, File System Access overwrite dialog, and download trigger still remain in `app.js`. |
| Layout helpers | `src/composables/chunk-note-layout.js` plus root scripts | `chunk-note-layout-helpers.js` and `chunk-note-layout-core.js` still expose globals; root script migration is Phase 5, not Phase 2. |

## Current Compatibility Entrypoints

These `app.js` entrypoints must remain stable until their consumers move:

| Entrypoint | Current consumers | Target owner | Deletion condition |
| --- | --- | --- | --- |
| `window.loadChunkNotesForCurrentAudio()` | `src/composables/import-module.js`, `src/composables/session-init.js` | chunk note persistence API | Consumers receive/import the subsystem API directly. |
| `window.setChunkNoteVisible(next, persist)` | `keyboard-module.js`, `app-handlers.js`, `session-init.js` | chunk note visibility API plus chunk/notes store bridge | Keyboard, app handlers, and restore flow use the subsystem or store directly. |
| `window.openChunkNoteContextFromEvent(event)` | `ChunkModeView.vue` | chunk note interaction API | `ChunkModeView.vue` emits/injects context-menu handling instead of calling a global. |
| `window.openChunkNoteStyleModal()` | `index.html` inline `onclick` | chunk note style API or Vue modal | Inline opener is removed from `index.html`. |
| `window.closeChunkNoteStyleModal()` | `index.html` inline `onclick` | chunk note style API or Vue modal | Inline close handler is removed from `index.html`. |
| `window.updateChunkNoteStyle()` | `index.html` inline `oninput` | chunk note style API or Vue binding | Inline style inputs are removed from `index.html`. |
| `window.adjustChunkNoteArrowSizeByGap()` | `style-editor.js`, `session-init.js` | chunk note style/layout API | Callers use imported or injected style API. |
| `window.__state.chunkNoteModalEl` | no direct external consumer found | chunk note interaction API internal state | No module needs modal element through `window.__state`. |
| `window.__state.chunkNotesFileHandle` | no direct external consumer found | chunk note import/export API internal state | Import/export flow owns file handle state internally. |
| `window.__state.chunkNotesFileHandleAudioKey` | no direct external consumer found | chunk note import/export API internal state | Import/export flow owns file handle state internally. |
| `window.__state.chunkNotesFileName` | no direct external consumer found | chunk note import/export API internal state | Import/export flow owns file handle state internally. |

## Target Public API

Use one facade object during migration, even if its internals are split into smaller files:

```js
window.__chunkNoteSubsystem = {
  state,
  persistence,
  visibility,
  selection,
  draft,
  contextMenu,
  overlay,
  importExport,
  style
}
```

`app.js` may temporarily delegate to this object, but it must not keep real chunk note business rules once the matching API exists.

### `state`

Owns normalized note records and selected/active note ids.

Required methods:

- `getNotesMap()`
- `replaceNotesMap(nextMap)`
- `listNotes()`
- `getNote(noteId)`
- `getNotesForRef(chunkRef)`
- `getNotesForBlockRefs(refs)`
- `setSelectedNote(noteId)`
- `getSelectedNoteId()`
- `setActiveNote(noteId)`
- `getActiveNoteId()`
- `upsertNoteFromContext(ctx, noteText, layoutContext)`
- `deleteNote(noteId)`

Record format must remain compatible with the existing persisted JSON:

```text
id, chunkRef, chunkIdx, startGlobal, endGlobal, selectedText, note,
coordSpace, x, y, offsetX, offsetY, w, h, autoSize, fontSize, color, updatedAt
```

### `persistence`

Owns IndexedDB snapshot load/save for the current audio key.

Required methods:

- `buildSnapshot()`
- `loadForCurrentAudio()`
- `saveDebounced()`
- `saveNow()`

Constraints:

- Keep DB name/version/store untouched: `SeekPlayerDB`, version `1`, store `files`, key path `id`.
- Keep snapshot `version: 1`.
- Keep storage key semantics from `IdentityStorageKeys.getChunkNotesStorageKey(currentAudioKey)`.

### `visibility`

Owns the visible/hidden state and its side effects.

Required methods:

- `isVisible()`
- `setVisible(next, persist = true)`

Compatibility behavior to preserve:

- Toggle `document.body.classList` with `hide-chunk-note`.
- Persist to `localStorage.chunkNoteVisible` when requested.
- Closing notes hides context menu, popover, and connectors.
- Showing notes in chunk mode ensures overlay layers and schedules layout/connector refresh.

### `draft`

Owns note draft persistence, but DOM reads for modal geometry can remain in the interaction layer until 3.3.

Required methods:

- `clearDraft()`
- `persistDraft(ctx, text, modalRect, immediate = false)`
- `readDraft()`
- `restoreDraftIfPossible(resolveAnchor)`

Constraints:

- Keep `chunkNoteDraft::*` key semantics.
- Keep draft payload `version: 1`.
- Do not restore more than once per audio/chunk-mode load cycle.

### `contextMenu`

Owns building and opening note context from right-click/selection.

Required methods:

- `openFromEvent(event)`
- `openAt(clientX, clientY, ctx)`
- `close()`
- `getPendingContext()`
- `consumePendingContext()`

Compatibility behavior to preserve:

- Right-click on a selected word range opens the add-note context.
- Right-click without selection falls back to the nearest chunk word.
- Right-click outside a chunk closes the menu and returns `false`.
- `ChunkModeView.vue` can continue to call `window.openChunkNoteContextFromEvent()` until component ownership moves later.

### `overlay`

Owns rendered note tags, word annotations, hover state, connectors, popover, drag/resize/edit, and delete dialog behavior.

Required methods:

- `ensureLayers()`
- `renderAllTags()`
- `refreshForChunkRef(chunkRef)`
- `refreshAllVisuals()`
- `scheduleLayoutRefresh()`
- `scheduleConnectorRedraw()`
- `clearConnectors()`
- `openPopover(ctx)`
- `closePopover()`
- `savePopover()`
- `cancelPopover()`
- `openDeleteDialog(noteId)`
- `closeDeleteDialog()`
- `setHoverTarget(noteId)`

Compatibility behavior to preserve:

- `.annotated*` underline classes and `data-note-id`.
- Active hover classes and connector path drawing.
- Tag selection, Delete/Backspace prompt, and Escape dismissal.
- Drag updates `x`, `y`, `offsetX`, `offsetY`, `coordSpace`.
- Resize updates `w`, `h`, `autoSize`.
- Inline edit saves changed text, deletes empty notes, and preserves compact image-mode rendering.

### `importExport`

Owns JSON import/export and File System Access handle state.

Required methods:

- `applyImportedChunkNotes(data)`
- `exportToFile()`
- `closeExportDialog()`

Compatibility behavior to preserve:

- Accept either a raw array or `{ notes: [...] }`.
- Normalize the same note fields as the current `app.js` importer.
- After import, save the snapshot, enter chunk mode when AI chunk data exists, show notes, render chunk mode, and toast success.
- Preserve direct overwrite when `window.showSaveFilePicker` is available and the saved handle belongs to the current audio key.
- Preserve download fallback when direct overwrite is unavailable.

### `style`

Owns chunk note CSS variable reads/writes and the style modal.

Required methods:

- `openStyleModal()`
- `closeStyleModal()`
- `updateStyleFromInputs()`
- `adjustArrowSizeByGap()`

Compatibility behavior to preserve:

- Keep localStorage keys: `chunkNoteSize`, `chunkNoteColor`, `chunkNoteWidth`, `chunkNoteMinHeight`, `chunkNoteArrowSize`.
- Keep CSS variables: `--chunk-note-size`, `--chunk-note-color`, `--chunk-note-width`, `--chunk-note-min-height`, `--chunk-note-arrow-size`, `--chunk-note-arrow-size-effective`.
- After updates, refresh note tags in chunk mode and schedule connector redraw.

## Migration Slices

### 3.2 State and Persistence

Move first:

- snapshot build/load/save
- note map replace/list/get/delete/upsert
- imported JSON normalization
- file handle state
- draft storage helpers that do not require DOM ownership

Keep in `app.js` as delegates only:

- existing `window.loadChunkNotesForCurrentAudio`
- existing `window.setChunkNoteVisible`
- existing import/export button bindings if their DOM handlers have not moved yet

Do not move in 3.2:

- tag DOM creation
- drag/resize/edit handlers
- delete dialog DOM
- context-menu selection resolving
- style modal inline handlers

### 3.3 Overlay and Interaction

Move after 3.2 is verified:

- context-menu resolution from DOM event to note context
- popover lifecycle
- rendered tag lifecycle
- word annotation marking
- connectors
- delete dialog
- style modal runtime

Keep compatibility globals until component/inline handler work happens in later phases.

## Verification Requirements

For 3.2:

- Add or update a focused check for note normalization/snapshot/upsert/delete behavior when practical.
- Run `npm test`.
- Run `npm run verify:interactions` if import/export, visible state, or keyboard paths changed.

For 3.3:

- Run `npm test`.
- Run `npm run verify:interactions`.
- Run `npm run verify:playback` only if chunk click, seek, or playback-follow behavior changes.
- Browser smoke at `http://127.0.0.1:5173/` should cover right-click add, underline, hover connector, drag, resize, inline edit, delete prompt, style update, import, and export.

## Forbidden Moves In This Phase

- Do not change IndexedDB schema.
- Do not change `index.html` script order.
- Do not migrate root regular scripts; that belongs to Phase 5.
- Do not remove `window.openChunkNoteContextFromEvent` until `ChunkModeView.vue` no longer calls it.
- Do not remove note style inline handlers until DOM/event ownership migration.
- Do not convert the note UI to a new user-facing design while cleanup is in progress.
