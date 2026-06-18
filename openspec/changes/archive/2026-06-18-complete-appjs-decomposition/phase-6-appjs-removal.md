# Phase 6 app.js Removal

Date: 2026-06-18

## Result

- Root `app.js` has been deleted.
- `index.html` now loads `src/composables/reader-runtime.js` in the same order slot that previously loaded `app.js`.
- `package.json` no longer points `"main"` at `app.js`.
- Current project docs now describe `reader-runtime.js` as the remaining runtime assembly layer.

## Compatibility State

`reader-runtime.js` still contains remaining runtime assembly and should continue shrinking, but the removed root `app.js` no longer exists as an entry point or compatibility owner.

Focused facade owners remain:

- `src/composables/runtime-state-facade.js`
- `src/composables/session-facades.js`
- `src/composables/reader-public-facades.js`
- `src/composables/annotation-bubble-resolver.js`
- `src/composables/ui-facades.js`
- `src/composables/render-mode.js`

## Verification

- `npm run verify:script-order`
- `npm run verify:inline-handler-bindings`
- `npm run verify:runtime-state-source`
- `npm run verify:bridge-startup`
- `npm test`
- `npm run verify:playback`
- `npm run verify:interactions`
- `npm run build`
- `npm run verify:production-preview`
- Browser smoke against `http://127.0.0.1:5173/`

The dev server was started with `npm run dev -- --host 127.0.0.1` and the smoke check loaded `http://127.0.0.1:5173/` without page or console errors.
