# Phase 1 Pure Helper Audit

Last scanned: 2026-06-16

This audit covers task 2.1 and the first Phase 1 extraction completed in this change.

## Current Utility Baseline

`app.js` already delegates many helper families to `src/utils/` or existing compatibility modules:

```text
src/utils/data-utils.js
src/utils/identity-storage-keys.js
src/utils/import-export-helpers.js
src/utils/sentence-notes-persistence.js
src/utils/cloze-utils.js
src/utils/cloze-view-model.js
src/utils/playback-index.js
src/utils/chunk-matching.js
src/utils/vocab-matching.js
```

## Candidate Review

| Candidate | Current status | Decision |
| --- | --- | --- |
| Chunk matching helpers in `processChunkData` | Already extracted to `src/utils/chunk-matching.js` and used through `window.ChunkMatchingHelpers` | No additional migration in this pass |
| Playback index helpers | Already extracted to `src/utils/playback-index.js`; playback behavior remains in `src/composables/playback-module.js` and `app.js` dependencies | Leave core playback behavior for a later targeted pass |
| Cloze helpers | Validation and view-model helpers already extracted to `src/utils/cloze-utils.js` and `src/utils/cloze-view-model.js` | No additional migration in this pass |
| Import/export helpers | Shared helpers already extracted to `src/utils/import-export-helpers.js`; orchestration remains in `src/composables/import-module.js` | Leave orchestration for later boundary work |
| `safeParseLocalJSON()` | Small local helper still in `app.js`; depends on `localStorage` and is only used by style initialization | Leave until style/settings boundary work |
| `isInputLikeTarget()` | Small DOM target utility used by keyboard/app handlers | Leave until keyboard/event boundary work |
| `rebuildVocabMatching()` text matching algorithm | Pure text matching was still embedded in `app.js` | Extracted to `src/utils/vocab-matching.js` |

## Completed Extraction

Extracted:

```text
app.js rebuildVocabMatching() embedded normalization/matching loop
  -> src/utils/vocab-matching.js
  -> window.VocabMatchingHelpers.buildVocabMatchMap()
```

The new helper:

- accepts `words` and `globalVocab` through explicit parameters
- returns a new `Map`
- preserves the existing result shape: `{ data: vData, group: groupIndices }`
- preserves multi-word group sharing semantics
- does not read DOM, `window.__state`, `audioPlayer`, or persisted storage

`app.js` now keeps only the boundary behavior:

```text
clear existing vocabMatchMap
guard on current transcript/global vocab availability
copy helper result into existing vocabMatchMap
```

## Verification

RED:

```text
npm run verify:vocab-matching
exit 1
reason: missing buildVocabMatchMap helper
```

GREEN:

```text
npm run verify:vocab-matching
exit 0
vocab matching helper check passed
```

Regression:

```text
npm test
exit 0
read-web load check passed
read-web playback check passed
read-web interaction check passed

npm run build
exit 0
Vite production build completed
expected root regular script warnings remain
```

## Pending Phase 1 Items

- Task 2.3: closed by audit. Playback index helpers already live in `src/utils/playback-index.js`. Remaining playback wrappers in `app.js` and `src/composables/playback-module.js` are state/event orchestration and belong to later playback/runtime ownership work.
- Task 2.4: closed by audit. Cloze validation and view-model helpers already live in `src/utils/cloze-utils.js` and `src/utils/cloze-view-model.js`. Remaining cloze functions in `src/composables/import-module.js` are rendering/store orchestration, not pure helper extraction.
- Task 2.5: closed by audit. Shared import/export helpers already live in `src/utils/import-export-helpers.js`. Remaining import/export code is file input orchestration, DB writes, and session/annotation coordination, so it belongs to later boundary work.
- Task 2.8: runtime map updated to include `window.VocabMatchingHelpers`.
