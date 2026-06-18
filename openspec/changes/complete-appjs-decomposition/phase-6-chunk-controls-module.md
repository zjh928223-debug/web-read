# Phase 6 Chunk Controls Module Extraction

This slice continues Phase 6 cleanup without marking final removal tasks complete.

## Scope

Moved AI chunk control behavior out of `app.js` into `src/composables/chunk-controls-module.js`:

- chunk mode toggle and scroll anchoring
- chunk Chinese visible/hold behavior
- chunk Chinese hold button binding and label update
- chunk focus-mode UI sync
- chunk shadow toggle
- temporary compatibility facades:
  - `window.toggleChunkMode`
  - `window.toggleChunkFocusMode`
  - `window.toggleChunkShadowManual`
  - `window.updateChunkCnHoldBtn`

`app.js` now initializes the module and injects the returned API into keyboard/import/style callers. It no longer owns the moved function implementations or their window facade assignments.

## Compatibility

The compatibility names remain because they are still used by:

- `src/composables/legacy-control-bindings.js`
- `src/composables/session-init.js`
- Playwright verification scripts

The owner changed from `app.js` to `src/composables/chunk-controls-module.js`; deletion is still blocked until those consumers move.

## Guard

Added `npm run verify:chunk-controls-module`, backed by `scripts/chunk-controls-module-check.cjs`.

The guard verifies:

- `app.js` imports and initializes the module
- moved functions are not reintroduced as `app.js` function declarations
- moved window facades are not assigned by `app.js`
- the new module owns the temporary chunk control window facades
- keyboard/import callers delegate through `chunkControlsApi`

`scripts/app-window-facades-check.cjs` now treats these window facades as owned by `chunk-controls-module.js`.

## Verification

Run on 2026-06-18:

```bash
cmd /c "node --input-type=module --check < app.js"
cmd /c "node --input-type=module --check < src\composables\chunk-controls-module.js"
node --check scripts\chunk-controls-module-check.cjs
npm run verify:chunk-controls-module
npm run verify:app-window-facades
npm run verify:inline-handler-bindings
npm run verify:state-facades
npm run verify:keyboard-boundary
npm run verify:playback
npm run verify:interactions
npm test
npm run build
```

All commands passed. Standalone `verify:playback` and `verify:interactions` were run against a temporary Vite dev server on `http://127.0.0.1:4173/`.

## Remaining Phase 6 Work

The following tasks remain incomplete after this slice:

- 7.1 Confirm `index.html` no longer loads `app.js`.
- 7.6 Delete `app.js`.
- 7.7 Remove stale documentation that describes `app.js` as the runtime center.
- 7.8 Run final verification.
- 8.1 Verify `legacy-runtime-decomposition` requirements.
- 8.2 Update final architecture docs.
- 8.3 Archive readiness.
