# Phase 2 Keyboard/Event Boundary Tightening

Last updated: 2026-06-16

This document completes task 3.7. It records the keyboard/event boundary cleanup done before the Phase 2 verification task.

## Moved Owner

`src/composables/keyboard-module.js` now owns the input-target classification helper:

- `window.__keyboardModule.isInputLikeTarget(target)`

`app.js` no longer defines the helper. It keeps `window.isInputLikeTarget` only as a legacy export that points at the keyboard module helper.

## Removed Dead Keyboard Path

`src/composables/app-handlers.js` no longer exports the unused `initKeyboard` implementation.

Repository search found no runtime callers of:

- `window.__appHandlers.initKeyboard`
- `initKeyboard(...)` from `app-handlers.js`

The remaining `app-handlers.js` exports stay focused on generic export and marks import handlers.

## Compatibility Preserved

- Existing hotkey state fields remain on `window.__state` as compatibility facades.
- `app.js` still passes current hotkey values and setter callbacks into `keyboard-module.js`; Phase 3 will move real state ownership.
- Existing shortcut behavior remains covered by Playwright interaction verification.
- `index.html` script order is unchanged.

## Focused Verification

Added `npm run verify:keyboard-boundary`, backed by `scripts/keyboard-module-boundary-check.cjs`.

The check covers:

- `window.__keyboardModule` API exposure
- exported `isInputLikeTarget` behavior for text-like inputs and excluded input types

## Phase 2 Verification Results

Task 3.8 was completed after this keyboard boundary change.

Commands run:

- `npm run verify:keyboard-boundary`
- `openspec validate complete-appjs-decomposition --strict`
- `git diff --check`
- `node --check src/composables/keyboard-module.js`
- `node --check src/composables/app-handlers.js`
- `Get-Content app.js | node --input-type=module --check`
- `npm test`
- `npm run build`

`npm test` ran the current Vite verification path, including load, playback, and interaction checks:

- `read26-load-check.cjs`
- `read-web-playback-check.cjs`
- `read-web-interactions-check.cjs`

All commands passed. The production build still reports the existing Vite warnings for the four remaining root regular scripts, which are expected until Phase 5 migrates them.
