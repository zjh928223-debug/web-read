# Phase 2 Sentence Note / Note Preview Migration

Last updated: 2026-06-16

This document completes task 3.5. It records the sentence note and note preview logic moved out of `app.js` while preserving the existing compatibility entrypoints.

## Moved Owner

`src/composables/notes-module.js` now owns the sentence note runtime orchestration for:

- selected sentence transitions
- focus phrase capture from AI chunk text selection
- draft creation, discard, commit, edit persistence, and empty-note deletion
- saved-note feedback state and timer
- note preview sidebar rendering and empty states
- note preview visibility, CSS size variables, resize handles, and localStorage persistence
- current-doc sentence note import snapshot application

The existing doc-scoped persistence, normalization, legacy migration, doc switching, export snapshot, and download helpers remain in the same module.

## app.js Facades

`app.js` now delegates these local functions to `_snApi`:

- `selectSentenceFromChunkTarget`
- `hasActiveTextSelectionWithinChunk`
- `applyNotePreviewWidth`
- `formatSentenceNoteItemMeta`
- `triggerSentenceNoteSavedFeedback`
- `findSentenceNoteItem`
- `discardSentenceNoteDraft`
- `commitSentenceNoteDraft`
- `persistSentenceNoteItem`
- `persistSelectedSentenceNote`
- `buildSentenceNoteItemElement`
- `renderNotePreviewSidebar`
- `showNotePreviewEmptyState`
- `toggleNotePreviewSidebar`
- `setSelectedSentence`
- `updateSentenceFocusPhrase`
- `getSelectionChunkSentence`
- `maybeCaptureSentenceFocusPhrase`
- `applyImportedSentenceNotesSnapshot`
- `initNotePreviewResize`

The `window.selectSentenceFromChunkTarget` export remains because `ChunkModeView.vue` still calls it. The global sentence note load/switch wrappers also remain because `session-init.js` and import flow still use them.

## Compatibility Preserved

- No IndexedDB schema changes.
- No `index.html` script order changes.
- No `session-init.js` startup or annotation glue migration in this task.
- Existing sentence note import payload validation is preserved: plain object, matching `docId`, and plain `notes` payload.
- Existing export payload shape remains `{ docId, exportedAt, notes }`.
- Existing note preview localStorage keys remain `notePreviewVisible`, `notePreviewWidth`, and `notePreviewHeight`.

## Focused Verification

Added `npm run verify:sentence-notes-state`, backed by `scripts/sentence-notes-state-check.cjs`.

The check covers:

- `_snApi` sentence note API exposure
- legacy single-note record normalization
- selected sentence and empty preview state
- focus phrase draft creation
- draft commit and persisted save call
- blank edited item deletion
- current-doc import validation and save behavior
- chunk target selection delegation
- active selection capture inside `.chunk-block .chunk-en`
- export snapshot shape
- note preview visibility localStorage persistence

