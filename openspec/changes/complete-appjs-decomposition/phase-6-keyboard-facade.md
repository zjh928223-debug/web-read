# Phase 6 Keyboard Helper Window Facade Migration

This slice continues Phase 6 cleanup without marking final removal tasks complete.

## Scope

Moved `window.isInputLikeTarget` ownership out of `app.js` and into `src/composables/keyboard-module.js`.

`app.js` still reads `window.__keyboardModule.isInputLikeTarget` for local dependency injection, but it no longer assigns the global compatibility helper.

## Compatibility

The `window.isInputLikeTarget` compatibility name remains for legacy callers until remaining runtime consumers are migrated. Its implementation and module API already lived in `keyboard-module.js`; this slice only moved the window facade owner.

## Guard

Added `npm run verify:keyboard-facades`, backed by `scripts/keyboard-facades-check.cjs`.

The guard verifies:

- `app.js` does not assign `window.isInputLikeTarget`
- `keyboard-module.js` owns the facade assignment
- `window.__keyboardModule` still exposes `isInputLikeTarget`
- `app.js` still uses the keyboard module API for local injection

`scripts/app-window-facades-check.cjs` now treats this window facade as owned by `keyboard-module.js`.

## Verification

Run on 2026-06-18:

```bash
cmd /c "node --input-type=module --check < app.js"
cmd /c "node --input-type=module --check < src\composables\keyboard-module.js"
npm run verify:keyboard-facades
npm run verify:keyboard-boundary
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
