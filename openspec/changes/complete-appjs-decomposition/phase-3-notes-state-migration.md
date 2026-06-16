# Phase 3 Notes State Migration

Date: 2026-06-16

## Scope

Task 4.6 migrates chunk note and sentence note runtime state ownership out of `app.js` while preserving the current persistence behavior.

This task does not move note rendering, note event ownership, IndexedDB keys, localStorage keys, or session restore sequencing.

## New Owner

`src/composables/notes-module.js` now owns the shared note state through:

- `window.__notesState`
- `window._ns` compatibility alias
- `window.__notesModule.createNotesState(initial)`
- `window.__notesModule.ensureNotesState(state)`
- `window.__notesModule.getNotesState()`

`app.js` no longer creates the `_ns` object literal. It receives the shared state from `window.__notesModule.getNotesState()` and passes that state to the chunk note and sentence note subsystem APIs.

## Migrated State

The shared notes state now owns:

- chunk note records: `chunkNotesMap`
- chunk note visibility/save/selection/context state: `chunkNoteVisible`, `chunkNoteSaveTimer`, `activeChunkNoteId`, `selectedChunkNoteId`, `pendingChunkSelectionCtx`
- chunk note file handle state: `chunkNotesFileHandle`, `chunkNotesFileHandleAudioKey`, `chunkNotesFileName`
- sentence note records and document state: `sentenceNotesMap`, `allSentenceNotesByDoc`, `currentDocId`
- sentence note draft/preview selection state: `sentenceNoteDraft`, `notePreviewEditingItemId`, `notePreviewSavedItemId`, `selectedSentence`

## Compatibility Kept

- `app.js` still keeps a local `_ns` reference, but it points to `window.__notesState`.
- `window._ns` remains available for `session-init.js`.
- `window.__state.chunkNotesFileHandle`, `window.__state.chunkNotesFileHandleAudioKey`, and `window.__state.chunkNotesFileName` remain compatibility facades over `_cnApi`.
- Existing `notes-module` APIs continue to accept an injected `state` object for focused tests and future isolation.

## Persistence Preserved

This migration does not change:

- IndexedDB database name/version/store/key path
- chunk note storage key generation
- chunk note draft localStorage key generation
- sentence notes storage key generation
- legacy sentence notes compatibility loading
- import/export JSON snapshot shapes

## Verification

Required for this task:

```text
node --check src/composables/notes-module.js
Get-Content app.js | node --input-type=module --check
node --check scripts/chunk-notes-state-check.cjs
node --check scripts/sentence-notes-state-check.cjs
npm run verify:chunk-notes-state
npm run verify:sentence-notes-state
npm test
npm run build
openspec validate complete-appjs-decomposition --strict
git diff --check
```
