# Phase 3 Chunk State Migration

Last updated: 2026-06-16

This document completes task 4.3. It records the chunk state ownership migration away from `app.js` local variables.

## New Runtime Adapter

Added `src/composables/chunk-state.js`.

The adapter provides startup-safe chunk state before Pinia exists, then binds to the real Pinia chunk store after `src/main.js` creates the stores.

Owned fields:

- `isChunkMode`
- `chunkItems`
- `hasAiChunkData`
- `chunkCnVisible`
- `chunkCnHoldMode`
- `isHoldingChunkCn`
- `holdPrevChunkCnVisible`
- `isChunkShadowOn`
- `chunkCnMode`
- `manualChunkStates`
- `lastActiveChunkIndex`
- `lastAiPrevTapChunkIndex`
- `lastAiPrevTapAt`

`lastActiveChunkIndex` is mapped to `src/pinia-stores/chunk.js` field `activeChunkIdx`. `chunkCnMode` remains the legacy string facade (`focus` or `global`) and maps to Pinia field `chunkFocusMode`.

## app.js Changes

Removed these `app.js` local variables as chunk state sources:

- `isChunkMode`
- `chunkItems`
- `chunkCnVisible`
- `chunkCnHoldMode`
- `isHoldingChunkCn`
- `holdPrevChunkCnVisible`
- `isChunkShadowOn`
- `chunkCnMode`
- `manualChunkStates`
- `lastActiveChunkIndex`
- `lastAiPrevTapChunkIndex`
- `lastAiPrevTapAt`
- `hasAiChunkData`

`app.js` now uses `_ch` (`window.__chunkState`) for chunk state access.

`window.__state` chunk properties now read/write the adapter:

- `window.__state.chunkItems`
- `window.__state.hasAiChunkData`
- `window.__state.manualChunkStates`
- `window.__state.isChunkMode`
- `window.__state.chunkCnVisible`
- `window.__state.chunkCnHoldMode`
- `window.__state.isChunkShadowOn`
- `window.__state.chunkCnMode`
- `window.__state.lastActiveChunkIndex`
- `window.__state.lastAiPrevTapChunkIndex`
- `window.__state.lastAiPrevTapAt`

`window.__state.isHoldingChunkCn` and `window.__state.holdPrevChunkCnVisible` were removed in task 4.8 after the runtime map showed no direct external consumers. The remaining properties stay as compatibility facades.

## Related Module Changes

`src/pinia-stores/chunk.js` now owns the additional chunk runtime fields needed by the adapter:

- `manualChunkStates`
- `isHoldingChunkCn`
- `holdPrevChunkCnVisible`
- `lastAiPrevTapChunkIndex`
- `lastAiPrevTapAt`

`src/main.js` imports the chunk adapter and binds it to the Pinia chunk store after bridge hydration.

`src/composables/session-init.js` now reads chunk items through `st.chunkItems` in the annotation-generation document context instead of an undeclared `chunkItems` reference.

## Preserved Compatibility

- `window.__bridge` chunk fields remain in place for startup sync. Reducing them is task 4.9.
- Remaining `window.__state` chunk properties stay available for `session-init.js`, `playback-module.js`, `controls-module.js`, and verification scripts.
- `toggleChunkMode()`, chunk Chinese hold/focus behavior, chunk shadow toggles, chunk playback navigation, and import/session restore paths retain their public entrypoints.
- No IndexedDB schema changes.
- No `index.html` script order changes.

## Focused Verification

Added `npm run verify:chunk-state`, backed by `scripts/chunk-state-check.cjs`.

The check covers:

- adapter API exposure
- fallback state reads/writes
- fallback-to-Pinia binding
- Pinia-preferred binding
- mapping between legacy fields and Pinia fields
- invalid value normalization for arrays, objects, booleans, mode strings, and numeric fields

## Required Verification for 4.3

- `npm run verify:chunk-state`
- `npm test`
- `npm run build`
- `openspec validate complete-appjs-decomposition --strict`
- `git diff --check`
- syntax checks for changed JS modules
