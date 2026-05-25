# FIRST SAFE SPLIT PLAN (Planning Only)

This plan is intentionally conservative and covers only low-risk extraction from `app.js`.
No code changes are executed in this document.

## Implementation Status

- Candidate A: **Implemented**
- Candidate B: **Implemented**
- Candidate D (pure subset plus current-audio state builder: `getFirstFileFromEvent` + `readFileAsText` + `getCurrentAudioFilenameBase` + `buildCurrentAudioMetaState` + `markFileLoaded`): **Implemented**
- Candidate C (smallest safe subset: `ensureLegacySentenceNotesForDoc` + `getCurrentSentenceDocIdForExport`): **Implemented**

## Scope Guardrails

Included candidates only:
- validation/parsing utilities
- storage key + document identity helpers
- import/export shared helpers
- filename/data helper utilities

Explicitly excluded:
- rendering
- playback
- selection
- chunk click logic
- global keydown listeners
- sentence notebook interaction flow

## Candidate A (Do First): `data-utils.js`

### Functions to move
From `app.js`:
- `isPlainObjectRecord` (around line 51)
- `isFiniteNum` (around line 86)
- `normalizeLooseKey` (around line 90)
- `getLooseProp` (around line 94)
- `looksLikeSegmentArray` (around line 104)
- `validateTranscriptData` (around line 118)
- `validateVisualData` (around line 232)
- `validateChunkData` (around line 240)
- `validateMarksArray` (around line 249)

### Why this is safe
- Pure utility/validation functions with no UI/render/playback side-effects.
- They already form a contiguous block near the top.
- Mostly deterministic inputs/outputs; no event timing dependencies.

### Dependencies
- `validateTranscriptData` depends on: `getLooseProp`, `looksLikeSegmentArray`, `isFiniteNum`.
- `validateMarksArray` depends on external runtime data only via `maxWordLen` argument.
- No DOM dependency in this candidate set.

### What must stay in `app.js` for now
- All call sites (import handlers, process functions) should remain in `app.js`.
- Keep error/toast handling and runtime state in `app.js`.

---

## Candidate B (Second): `identity-and-storage-keys.js`

### Functions to move
From `app.js`:
- `buildAudioKey` (around line 259)
- `buildTranscriptKey` (around line 266)
- `buildCurrentSentenceDocId` (around line 311)
- `getChunkNotesStorageKey` (around line 295)
- `getChunkNoteDraftStorageKey` (around line 299)
- `getSentenceNotesStorageKey` (around line 303)
- `getLegacySentenceNotesStorageKey` (around line 307)

### Why this is safe
- Key/identity derivation only; no UI/render/input side-effects.
- Already grouped in one section.
- Return-value behavior is explicit and currently stable.

### Dependencies
- `buildTranscriptKey` currently reads global `segments` fallback.
- key helper functions read global `currentAudioKey`.
- `buildCurrentSentenceDocId` depends on `buildTranscriptKey`.

### What must stay in `app.js` for now
- State variables `segments`, `currentAudioKey`.
- All persistence lifecycle functions/callers that consume these helpers.

---

## Candidate C (Third): `sentence-notes-persistence-utils.js`

### Functions to move
From `app.js` persistence area:
- `loadSentenceNotesForCurrentAudio` (around line 648)
- `ensureLegacySentenceNotesForDoc` (around line 748)
- `persistSentenceNotebookNow` (around line 757)
- `persistSentenceNotesForCurrentDoc` (around line 762)
- `switchSentenceNotesDoc` (around line 778)
- `getCurrentSentenceDocIdForExport` (around line 790)
- `buildSentenceNotesExportSnapshot` (around line 794)
- `triggerSentenceNotesDownload` (around line 803)

### Why this is safe (conditionally)
- This is still “data/persistence focused”, but touches runtime state.
- Safe only if extracted as a module that receives explicit dependency injection (state getters/setters + adapters), not by rewriting behavior.

### Dependencies
- Reads/writes: `currentDocId`, `sentenceNotesMap`, `allSentenceNotesByDoc`, `selectedSentence`, `sentenceNoteDraft`, `notePreviewEditingItemId`, `notePreviewSavedItemId`.
- Calls: `loadFromDB`, `saveToDB`, `normalizeSentenceNotesScope`, `buildCurrentSentenceDocId`, `getLegacySentenceNotesStorageKey`, `getSentenceNotesStorageKey`, `persistSelectedSentenceNote`, `renderNotePreviewSidebar`.
- Uses browser APIs for export blob/download.

### What must stay in `app.js` for now
- Interaction-level functions: `persistSelectedSentenceNote`, selection/update handlers, rendering hooks.
- UI state mutation and sidebar refresh orchestration.

---

## Candidate D (Fourth): `import-export-shared-helpers.js`

### Functions to move
From shared helper section:
- `getFirstFileFromEvent` (around line 818)
- `getCurrentAudioFilenameBase` (around line 822)
- `applyCurrentAudioMeta` (around line 828)
- `markFileLoaded` (around line 834)
- `readFileAsText` (around line 849)

### Why this is safe (partially)
- `getFirstFileFromEvent` and `readFileAsText` are low-risk pure adapter helpers.
- `getCurrentAudioFilenameBase` is low risk but depends on `currentAudioMeta`.
- `applyCurrentAudioMeta` mutates key runtime state; should move only with explicit state adapter.
- `markFileLoaded` is UI-adjacent (DOM class/text), so move only if keeping behavior identical and no styling/event changes.

Implemented refinement:
- Kept runtime writes in `app.js`, but moved the current-audio state derivation into shared helper `buildCurrentAudioMetaState(meta, buildAudioKey)`.
- `app.js` still owns the actual assignments to `currentAudioMeta`, `currentAudioKey`, and `chunkNoteDraftRestoreDone`.

### Dependencies
- `applyCurrentAudioMeta` depends on `buildAudioKey` and `chunkNoteDraftRestoreDone`.
- `buildCurrentAudioMetaState` depends only on injected `buildAudioKey`.
- `markFileLoaded` depends on DOM element references.
- `readFileAsText` depends on `FileReader`.

### What must stay in `app.js` for now
- Import handler orchestration order and side-effect sequencing.
- Any helper that directly mutates UI/runtime state unless wrapped by adapters.

---

## Recommended Split Order (Most Conservative)

1. **Candidate A (`data-utils.js`)**  
   Lowest coupling, mostly pure, minimal side effects.
2. **Candidate B (`identity-and-storage-keys.js`)**  
   Still low risk, but coupled to global `segments/currentAudioKey`.
3. **Candidate D (partial only: pure subset)**  
   Move only `getFirstFileFromEvent` + `readFileAsText` + `getCurrentAudioFilenameBase` + `buildCurrentAudioMetaState` + `markFileLoaded` first.
4. **Candidate C**  
   Highest coupling in “safe set”; do only after adapter boundaries are agreed.

## Deferred/Risky for This First Split

- Anything that reorders event handling.
- Anything touching selection/playback/chunk-click paths.
- Global keydown listener merge.
- Sentence notebook interaction/render timing functions.
- Hidden meta behavior changes.

## First Implementation Slice (strictly safe)

If doing just one first split:
- Create `data-utils.js` with Candidate A functions.
- Keep all existing call sites in `app.js`.
- Import and wire functions without changing call order or branching.
- No behavior tests beyond syntax + existing smoke checks.
