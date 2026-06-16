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

## Guard

Added `npm run verify:control-playback-state-deps`, backed by `scripts/control-playback-state-deps-check.cjs`.
Added `npm run verify:session-state-provider`, backed by `scripts/session-state-provider-check.cjs`.

The check guards that:

- `controls-module.js` does not reference `window.__state`
- `playback-module.js` does not reference `window.__state`
- `app.js` passes `state: window.__state` explicitly into both modules while the facade still exists
- `session-init.js` does not reference `window.__state`
- `session-state-provider.js` does not reference `window.__state`
- `app.js` configures the session state provider after creating the compatibility facade

## Remaining Work

Task 7.3 is not complete yet.

Remaining runtime state facade dependencies include:

- `src/composables/import-module.js` state dependency passed from `app.js`
- verification scripts that still read/write `window.__state`
