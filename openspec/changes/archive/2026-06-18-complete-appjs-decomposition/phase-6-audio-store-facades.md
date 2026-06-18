# Phase 6 Audio Store Window Facade Migration

This slice continues Phase 6 cleanup without marking final removal tasks complete.

## Scope

Moved DB compatibility window facades out of `app.js` and into `src/stores/audio.js`:

- `window.initDB`
- `window.saveToDB`
- `window.loadFromDB`
- `window.deleteFromDB`
- `window.clearDBStore`

The new facades delegate through the current `window.__audioStore` methods. This preserves the existing `src/main.js` behavior that replaces `window.__audioStore` methods with Pinia-backed implementations after Vue startup.

`app.js` still keeps local `saveToDB` and `loadFromDB` wrappers because several runtime modules receive those as explicit injected dependencies. It no longer owns the DB window facade assignments and no longer keeps unused local `initDB`, `deleteFromDB`, or `clearDBStore` wrappers.

## Compatibility

The DB window names remain because `src/composables/session-init.js` still calls them as legacy globals during startup restore and cleanup.

The owner changed from `app.js` to `src/stores/audio.js`; deletion is still blocked until those startup consumers move to explicit imports/deps.

## Guard

Added `npm run verify:audio-store-facades`, backed by `scripts/audio-store-facades-check.cjs`.

The guard verifies:

- `app.js` does not assign DB window facades
- `src/stores/audio.js` owns those facade assignments
- facades delegate through current `window.__audioStore` methods
- `src/main.js` still replaces the audio store methods with Pinia-backed implementations
- unused local DB wrappers do not return to `app.js`

`scripts/app-window-facades-check.cjs` now treats these window facades as owned by `src/stores/audio.js`.

## Verification

Run on 2026-06-18:

```bash
cmd /c "node --input-type=module --check < app.js"
cmd /c "node --input-type=module --check < src\stores\audio.js"
npm run verify:audio-store-facades
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
