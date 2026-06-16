# Phase 6 State Dependency Reduction

Date: 2026-06-16

## Scope

This is a preparatory slice for task 7.3.

It removes direct `window.__state` reads from:

- `src/composables/controls-module.js`
- `src/composables/playback-module.js`
- `src/composables/session-init.js`

Both modules now receive their state view through explicit `deps.state` during `app.js` initialization.
`session-init.js` now receives its state view through `src/composables/session-state-provider.js`, which is configured by `app.js` after the compatibility facade is created.
`app.js` now owns a local `runtimeState` object and exposes it as `window.__state` only as a compatibility facade.

## Guard

Added `npm run verify:control-playback-state-deps`, backed by `scripts/control-playback-state-deps-check.cjs`.
Added `npm run verify:session-state-provider`, backed by `scripts/session-state-provider-check.cjs`.
Added `npm run verify:runtime-state-source`, backed by `scripts/runtime-state-source-check.cjs`.

The check guards that:

- `controls-module.js` does not reference `window.__state`
- `playback-module.js` does not reference `window.__state`
- `app.js` passes `state: window.__state` explicitly into both modules while the facade still exists
- `session-init.js` does not reference `window.__state`
- `session-state-provider.js` does not reference `window.__state`
- `app.js` configures the session state provider after creating the compatibility facade
- no `src/composables/*.js` module references `window.__state`
- `app.js` injects `runtimeState`, not `window.__state`, into runtime modules

## Remaining Work

Task 7.3 is complete.

Remaining compatibility cleanup:

- verification scripts that still read/write `window.__state`
- `app.js` still exposes `window.__state` until verification and compatibility callers move

## Verification Results

Commands run for task 7.3:

```text
node --check scripts\runtime-state-source-check.cjs
node --check scripts\state-facade-owner-check.cjs
node --check scripts\control-playback-state-deps-check.cjs
node --check scripts\session-state-provider-check.cjs
npm run verify:runtime-state-source
npm run verify:state-facades
npm run verify:control-playback-state-deps
npm run verify:session-state-provider
npm test
npm run build
openspec validate complete-appjs-decomposition --strict
git diff --check
```

Result: all commands passed on 2026-06-16.
