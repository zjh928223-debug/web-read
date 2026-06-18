# Phase 2 Runtime Map Update

Last updated: 2026-06-16

This document completes task 3.9. It records the runtime map updates after Phase 2 subsystem extraction work.

## Updated Facades

The Phase 0 runtime map now marks these entries as delegated:

- `selectSentenceFromChunkTarget` -> `src/composables/notes-module.js`, re-exported by `app.js`
- `openChunkNoteContextFromEvent` -> `src/composables/notes-module.js`, re-exported by `app.js`
- `loadChunkNotesForCurrentAudio` -> `src/composables/notes-module.js`, re-exported by `app.js`
- `setChunkNoteVisible` -> `src/composables/notes-module.js`, re-exported by `app.js`
- `loadSentenceNotesForCurrentAudio` -> `src/composables/notes-module.js`, re-exported by `app.js`
- `switchSentenceNotesDoc` -> `src/composables/notes-module.js`, re-exported by `app.js`
- `isInputLikeTarget` -> `src/composables/keyboard-module.js`, re-exported by `app.js`

## Updated Consumers

- Removed `app-handlers.js` as a keyboard consumer after its unused `initKeyboard` path was deleted.
- Added `window.__annotationLightweightModule` to the compatibility globals list.
- Added `src/composables/annotation-lightweight-module.js` to the browser/runtime module map.

## Updated Verification Matrix

- Keyboard/event boundary changes now include `npm run verify:keyboard-boundary`.
- Annotation lightweight import/export glue changes now include `npm run verify:annotation-lightweight-module`.

## Pending Deletion Conditions

No compatibility global is deleted by this task. The remaining deletion conditions are unchanged:

- `ChunkModeView.vue` must stop calling `window.selectSentenceFromChunkTarget` and `window.openChunkNoteContextFromEvent`.
- `session-init.js` and `import-module.js` must receive chunk/sentence note APIs directly before their global wrappers are removed.
- `window.isInputLikeTarget` can be deleted after no legacy callers use the global.
- Annotation lightweight session hooks remain in `session-init.js` until annotation session ownership is split out.
