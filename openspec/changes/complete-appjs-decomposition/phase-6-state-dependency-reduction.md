# Phase 6 State Dependency Reduction

Date: 2026-06-16

## Scope

This is a preparatory slice for task 7.3.

It removes direct `window.__state` reads from:

- `src/composables/controls-module.js`
- `src/composables/playback-module.js`

Both modules now receive their state view through explicit `deps.state` during `app.js` initialization.

## Guard

Added `npm run verify:control-playback-state-deps`, backed by `scripts/control-playback-state-deps-check.cjs`.

The check guards that:

- `controls-module.js` does not reference `window.__state`
- `playback-module.js` does not reference `window.__state`
- `app.js` passes `state: window.__state` explicitly into both modules while the facade still exists

## Remaining Work

Task 7.3 is not complete yet.

Remaining runtime state facade dependencies include:

- `src/composables/session-init.js` direct `window.__state` startup restore dependency
- `src/composables/import-module.js` state dependency passed from `app.js`
- verification scripts that still read/write `window.__state`
