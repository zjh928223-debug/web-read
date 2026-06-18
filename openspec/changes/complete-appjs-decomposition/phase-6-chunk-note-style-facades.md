# Phase 6 Chunk Note Style Window Facade Migration

This slice continues Phase 6 cleanup without marking final removal tasks complete.

## Scope

Moved chunk note style compatibility window facades out of `app.js` and into `src/composables/notes-module.js`:

- `window.openChunkNoteStyleModal`
- `window.closeChunkNoteStyleModal`
- `window.updateChunkNoteStyle`
- `window.adjustChunkNoteArrowSizeByGap`

`app.js` no longer keeps thin wrappers for those note style APIs. It injects `_cnApi.adjustChunkNoteArrowSizeByGap` into `src/composables/style-editor.js` directly.

## Compatibility

The note style window names remain because they are still used by:

- `src/composables/legacy-control-bindings.js`
- `src/composables/session-init.js`
- style-related startup and chunk note paths

The owner changed from `app.js` to `src/composables/notes-module.js`; deletion is still blocked until those consumers move to explicit deps.

## Guard

Added `npm run verify:chunk-note-style-facades`, backed by `scripts/chunk-note-style-facades-check.cjs`.

The guard verifies:

- `app.js` does not assign chunk note style window facades
- `app.js` does not keep the removed wrapper functions
- `notes-module.js` owns those facade assignments
- style editor still receives note style adjustment as an injected dependency
- legacy control bindings still point at the same compatibility names

`scripts/app-window-facades-check.cjs` now treats these window facades as owned by `notes-module.js`.

## Debug Note

The first implementation accidentally inserted the facade assignments into `createNotesState()` instead of `initChunkNotes()` and caused an import-time `ReferenceError`. The fix moved the assignments to the end of `initChunkNotes()`, after the note style functions are defined and before the API object is returned.

## Verification

Run on 2026-06-18:

```bash
cmd /c "node --input-type=module --check < app.js"
cmd /c "node --input-type=module --check < src\composables\notes-module.js"
npm run verify:chunk-note-style-facades
npm run verify:app-window-facades
npm test
npm run build
```

All commands passed after the assignment-order fix. `npm test` ran the Vite load, playback, and interaction checks.

## Remaining Phase 6 Work

The following tasks remain incomplete after this slice:

- 7.1 Confirm `index.html` no longer loads `app.js`.
- 7.6 Delete `app.js`.
- 7.7 Remove stale documentation that describes `app.js` as the runtime center.
- 7.8 Run final verification.
- 8.1 Verify `legacy-runtime-decomposition` requirements.
- 8.2 Update final architecture docs.
- 8.3 Archive readiness.
