# Phase 3 Cloze State Migration

Last updated: 2026-06-16

This document completes task 4.4. It records the cloze state ownership migration away from `app.js` local variables.

## New Runtime Adapter

Added `src/composables/cloze-state.js`.

The adapter provides startup-safe cloze state before Pinia exists, then binds to the real Pinia cloze store after `src/main.js` creates the stores.

Owned fields:

- `clozeItems`
- `hasClozeData`
- `clozeAnswerState`

The adapter keeps the legacy field names used by `window.__state` and maps them to `src/pinia-stores/cloze.js` fields:

- `clozeItems` -> `items`
- `hasClozeData` -> `hasData`
- `clozeAnswerState` -> `answerState`

## app.js Changes

Removed these `app.js` local variables as cloze state sources:

- `clozeItems`
- `hasClozeData`
- `clozeAnswerState`

`app.js` now uses `_clz` (`window.__clozeState`) for cloze state access.

`window.__state` cloze properties now read/write the adapter:

- `window.__state.clozeItems`
- `window.__state.hasClozeData`
- `window.__state.clozeAnswerState`

These properties remain compatibility facades and are not removed in this task.

## Related Module Changes

`src/main.js` imports the cloze adapter and binds it to the Pinia cloze store after bridge hydration.

`src/composables/import-module.js` remains the current cloze import/check orchestration owner. It still reads/writes the injected `state` object, so it now updates the cloze adapter through `window.__state`.

## Preserved Compatibility

- `window.__bridge` cloze fields remain in place for startup sync. Reducing them is task 4.9.
- `window.__state` cloze properties remain available for `import-module.js` and verification scripts.
- `window.__clozeCheck`, `window.__buildClozeQuizMarkup`, `window.__clozeItems`, `window.__clozeAnswerState`, and `window.__hasClozeData` remain as existing compatibility globals.
- No IndexedDB schema changes.
- No `index.html` script order changes.

## Focused Verification

Added `npm run verify:cloze-state`, backed by `scripts/cloze-state-check.cjs`.

The check covers:

- adapter API exposure
- fallback state reads/writes
- fallback-to-Pinia binding
- Pinia-preferred binding
- mapping between legacy fields and Pinia fields
- invalid value normalization for array and boolean fields

## Required Verification for 4.4

- `npm run verify:cloze-state`
- `npm test`
- `npm run build`
- `openspec validate complete-appjs-decomposition --strict`
- `git diff --check`
- syntax checks for changed JS modules
