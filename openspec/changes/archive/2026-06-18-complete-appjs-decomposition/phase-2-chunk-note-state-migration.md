# Phase 2 Chunk Note State Migration

Completed: 2026-06-16

This document records task 3.2. Runtime behavior stays compatible; the moved logic is limited to non-rendering state and persistence orchestration.

## Moved Out Of `app.js`

`src/composables/notes-module.js` now owns these chunk note state APIs:

- `getChunkNotesMap()`
- `replaceChunkNotesMap(nextMap)`
- `listChunkNotes()`
- `getChunkNote(noteId)`
- `getChunkNotesForRef(chunkRef)`
- `deleteChunkNote(noteId)`
- `upsertChunkNote(ctx, noteText, layoutContext)`
- `applyImportedChunkNotes(data)`
- `saveChunkNotesNow()`
- `getChunkNotesFileState()`
- `setChunkNotesFileState(next)`
- `clearChunkNotesFileState()`

The moved behavior includes:

- note record construction and preservation of existing coordinates/sizes/colors
- empty-note deletion
- imported JSON normalization
- loaded snapshot normalization
- snapshot sorting
- immediate save after chunk note import
- chunk note export file handle state

## Kept As Compatibility In `app.js`

`app.js` still keeps the legacy function names and DOM wiring, but delegates the state rules to `_cnApi`:

- delete prompt confirm -> `_cnApi.deleteChunkNote()`
- inline edit empty text -> `_cnApi.deleteChunkNote()`
- modal save -> `upsertChunkNote()` facade -> `_cnApi.upsertChunkNote()`
- modal cancel for unsaved note -> `_cnApi.deleteChunkNote()`
- import JSON -> `_cnApi.applyImportedChunkNotes()` and `_cnApi.saveChunkNotesNow()`
- export file handle reads/writes -> `_cnApi.getChunkNotesFileState()` / `_cnApi.setChunkNotesFileState()`

`window.__state.chunkNotesFileHandle`, `window.__state.chunkNotesFileHandleAudioKey`, and `window.__state.chunkNotesFileName` now delegate through `_cnApi` instead of directly owning the file handle state.

## Still Pending For 3.3

The remaining `app.js` chunk note map reads are visual/interaction reads and should move with the overlay subsystem:

```text
refreshChunkNoteTagPositions()
renderAllChunkNoteTags()
redrawAllChunkNoteConnectors()
getChunkNotesForRef()
getChunkNotesForBlock()
glass effects chunk note dimension lock
```

Do not remove `window.openChunkNoteContextFromEvent()` yet. `ChunkModeView.vue` still calls it.

## Verification

RED:

```text
npm run verify:chunk-notes-state
exit 1
reason: missing getChunkNotesMap helper
```

GREEN:

```text
npm run verify:chunk-notes-state
exit 0
chunk notes state check passed
```

Regression:

```text
npm test
exit 0
read-web load check passed
read-web playback check passed
read-web interaction check passed

npm run verify:interactions
exit 0
read-web interaction check passed

git diff --check
exit 0
only CRLF conversion warnings were reported
```
