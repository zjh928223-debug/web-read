# Phase 2 Chunk Note Overlay Pass 1

Completed: 2026-06-16

This is a partial task 3.3 pass. It does not close task 3.3 yet; popover DOM, rendered tag lifecycle, connectors, context-menu resolution, drag/resize/edit, delete dialog DOM, and style runtime still remain in `app.js`.

## Moved Behind `_cnApi`

`src/composables/notes-module.js` now owns these overlay-adjacent APIs:

- `getChunkNotesForBlockRefs(refs)`
- `getChunkNoteTagById(noteId)`
- `setSelectedChunkNote(noteId)`
- `getSelectedChunkNoteId()`
- `getActiveChunkNoteId()`
- `clearChunkNoteDraft()`
- `persistChunkNoteDraft(ctx, text, modalRect, immediate)`
- `readChunkNoteDraft()`
- `cancelChunkNoteDraftSaveTimer()`
- `getPendingChunkSelectionCtx()`
- `consumePendingChunkSelectionCtx()`

## `app.js` Changes

`app.js` no longer directly reads these chunk note internals:

- `_ns.chunkNotesMap`
- `_ns.activeChunkNoteId`
- local `selectedChunkNoteId`
- local `chunkNoteDraftSaveTimer`
- direct `chunkNoteDraft::*` localStorage reads/writes
- direct pending context reads from `_ns.pendingChunkSelectionCtx`

Remaining visual functions now read through `_cnApi`:

- `refreshChunkNoteTagPositions()`
- `renderAllChunkNoteTags()`
- `redrawAllChunkNoteConnectors()`
- `getChunkNotesForRef()`
- `getChunkNotesForBlock()`
- glass effects chunk note dimension lock

## Verification

RED:

```text
npm run verify:chunk-notes-state
exit 1
reason: missing getChunkNotesForBlockRefs helper

npm run verify:chunk-notes-state
exit 1
reason: missing clearChunkNoteDraft helper

npm run verify:chunk-notes-state
exit 1
reason: missing getPendingChunkSelectionCtx helper
```

GREEN:

```text
npm run verify:chunk-notes-state
exit 0
chunk notes state check passed
```

## Still Pending For 3.3

Move the remaining overlay interaction implementation behind a subsystem API:

- right-click selection/context resolution
- context menu DOM positioning
- popover lifecycle and DOM-driven draft restore
- tag DOM creation
- drag/resize/edit handlers
- connector drawing and scheduling
- delete dialog DOM
- chunk note style runtime
