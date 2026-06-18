# Phase 6 Highlight Controls Module Extraction

This slice continues Phase 6 cleanup without marking final removal tasks complete.

## Scope

Moved highlight mode control behavior out of `app.js` into `src/composables/highlight-controls-module.js`:

- `cycleHighlightMode`
- `updateHighlightModeUI`
- temporary `window.cycleHighlightMode` compatibility facade

`app.js` now initializes the module and passes `highlightControlsApi.updateHighlightModeUI` into `src/composables/chunk-controls-module.js`.

## Compatibility

The `window.cycleHighlightMode` compatibility name remains because it is still used by:

- `src/composables/legacy-control-bindings.js`
- Playwright verification scripts

The owner changed from `app.js` to `src/composables/highlight-controls-module.js`; deletion is still blocked until those consumers move.

## Guard

Added `npm run verify:highlight-controls-module`, backed by `scripts/highlight-controls-module-check.cjs`.

The guard verifies:

- `app.js` imports and initializes the module
- moved functions are not reintroduced as `app.js` function declarations
- `window.cycleHighlightMode` is not assigned by `app.js`
- the new module owns the temporary highlight window facade
- chunk controls receive highlight UI updates through injected deps

`scripts/app-window-facades-check.cjs` now treats `window.cycleHighlightMode` as owned by `highlight-controls-module.js`.

## Verification

Run on 2026-06-18:

```bash
cmd /c "node --input-type=module --check < app.js"
cmd /c "node --input-type=module --check < src\composables\highlight-controls-module.js"
npm run verify:highlight-controls-module
npm run verify:app-window-facades
npm test
npm run build
openspec validate complete-appjs-decomposition --strict
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
