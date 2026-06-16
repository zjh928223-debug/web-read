# Phase 3 State Facade Removal

Date: 2026-06-16

## Scope

Task 4.8 removes only `window.__state` properties whose direct consumers were absent from the runtime map or migrated in this task.

This task does not remove heavily used `window.__state` fields such as transcript, chunk, cloze, playback highlight, hotkey, marks, or session identity fields.

## Removed Facades

Removed from `window.__state`:

- `chunkNotesFileHandle`
- `chunkNotesFileHandleAudioKey`
- `chunkNotesFileName`
- `isHoldingChunkCn`
- `holdPrevChunkCnVisible`
- `lastSentencePrevTapSegIndex`
- `lastSentencePrevTapAt`

## Consumer Migration

`src/composables/import-module.js` previously reset chunk note file-handle state through `state.chunkNotesFileHandle*`. It now receives `clearChunkNotesFileState` from `app.js`, which delegates to `_cnApi.clearChunkNotesFileState()` and the `window.__notesState` owner.

Chunk Chinese hold state and sentence previous-tap state already use their real owners directly in `app.js` and runtime modules:

- `window.__chunkState`
- `window.__playbackState`

## Guard

`scripts/state-facade-owner-check.cjs` now checks both sides:

- migrated fields that still need compatibility must delegate to their owner
- removed fields must not reappear on `window.__state`

## Verification

```text
node --check scripts/state-facade-owner-check.cjs
Get-Content app.js | node --input-type=module --check
node --check src/composables/import-module.js
npm run verify:state-facades
npm run verify:chunk-notes-state
npm run verify:chunk-state
npm run verify:playback-state
```
