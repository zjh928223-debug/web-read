# Phase 6 Import Window Facade Migration

This slice continues Phase 6 cleanup without marking final removal tasks complete.

## Scope

Moved transcript/chunk import compatibility window facades out of `app.js` and into `src/composables/import-module.js`:

- `window.processTranscript`
- `window.processChunkData`

`app.js` no longer keeps the `_importApi` temporary wrapper object or the local `processTranscript` / `processChunkData` wrapper functions.

## Compatibility

The import window names remain because they are still used by:

- `src/composables/session-init.js`
- Playwright verification scripts
- legacy helper checks that wait for `window.processTranscript`

The owner changed from `app.js` to `src/composables/import-module.js`; deletion is still blocked until those consumers move to explicit deps or module APIs.

## Guard

Added `npm run verify:import-facades`, backed by `scripts/import-facades-check.cjs`.

The guard verifies:

- `app.js` does not assign `window.processTranscript` or `window.processChunkData`
- `app.js` does not keep the removed wrappers or `_importApi`
- `import-module.js` owns those facade assignments
- `session-init.js` still reaches the compatibility entries

`scripts/app-window-facades-check.cjs` now treats these window facades as owned by `import-module.js`.

## Verification

Run on 2026-06-18:

```bash
cmd /c "node --input-type=module --check < app.js"
cmd /c "node --input-type=module --check < src\composables\import-module.js"
npm run verify:import-facades
npm run verify:app-window-facades
npm test
npm run build
```

All commands passed. `npm test` ran the Vite load, playback, and interaction checks.

## Remaining Phase 6 Work

The following tasks remain incomplete after this slice:

- 7.1 Confirm `index.html` no longer loads `app.js`.
- 7.6 Delete `app.js`.
- 7.7 Remove stale documentation that describes `app.js` as the runtime center.
- 7.8 Run final verification.
- 8.1 Verify `legacy-runtime-decomposition` requirements.
- 8.2 Update final architecture docs.
- 8.3 Archive readiness.
