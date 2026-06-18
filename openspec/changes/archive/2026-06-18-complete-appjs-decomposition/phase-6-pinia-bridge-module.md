# Phase 6 Pinia Bridge Module Extraction

This slice continues Phase 6 cleanup without marking final removal tasks complete.

## Scope

Moved the `bridgeToPinia` implementation and `window.bridgeToPinia` compatibility facade out of `app.js` into `src/composables/pinia-bridge-module.js`.

`app.js` now initializes the bridge module once and keeps the returned function for explicit dependency injection into import/chunk/runtime callers.

## Compatibility

The `window.bridgeToPinia` compatibility name remains because it is still used by:

- `src/composables/session-init.js`
- Playwright verification scripts
- runtime modules that still receive `bridgeToPinia` as an injected callback

The owner changed from `app.js` to `src/composables/pinia-bridge-module.js`; deletion is still blocked until those consumers move to explicit deps or no longer need manual bridge sync.

## Guard

Added `npm run verify:pinia-bridge-module`, backed by `scripts/pinia-bridge-module-check.cjs`.

Updated `npm run verify:bridge-startup` so it now verifies:

- `window.__bridge` is still absent from startup
- `app.js` does not own the `bridgeToPinia` implementation or window facade
- `app.js` initializes `pinia-bridge-module.js`
- the bridge module writes directly to `window.__piniaStores`

`scripts/app-window-facades-check.cjs` now treats `window.bridgeToPinia` as owned by `pinia-bridge-module.js`.

## Verification

Run on 2026-06-18:

```bash
cmd /c "node --input-type=module --check < app.js"
cmd /c "node --input-type=module --check < src\composables\pinia-bridge-module.js"
npm run verify:pinia-bridge-module
npm run verify:bridge-startup
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
