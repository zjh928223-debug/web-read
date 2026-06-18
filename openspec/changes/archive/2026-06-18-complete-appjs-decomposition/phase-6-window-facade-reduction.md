# Phase 6 Window Facade Reduction

Date: 2026-06-16

## Scope

This is a preparatory slice for task 7.5.

It removes duplicate `app.js` ownership for window facades that already have module owners:

- `window.handleBackwardClick`
- `window.handleForwardClick`
- `window.forceUpdateUI`
- `window.mainUpdateHighlight`
- `window.changeSpeed`
- `window.openChunkStyleModal`
- `window.closeChunkStyleModal`
- `window.updateChunkStyle`
- `window.toggleChunkBtn`

The window functions still exist for compatibility, but their owners are now:

- `src/composables/playback-module.js`
- `src/composables/controls-module.js`
- `src/composables/style-editor.js`
- direct DOM lookup inside `src/composables/session-init.js` for the one startup cleanup button reset

## Guard

Added `npm run verify:app-window-facades`, backed by `scripts/app-window-facades-check.cjs`.

The check guards that `app.js` does not re-export these facades, that the module owners still export them, and that remaining app-level window assignments stay within an explicit allowlist.

## Remaining Work

Task 7.5 is complete.

Remaining app-level compatibility exports have known consumers and still need consumer-by-consumer migration before `app.js` can be removed.

## Verification Results

Commands run for this 7.5 preparatory slice:

```text
node --check scripts\app-window-facades-check.cjs
npm run verify:app-window-facades
npm run verify:inline-handler-bindings
npm test
npm run build
openspec validate complete-appjs-decomposition --strict
git diff --check
```

Result: all commands passed on 2026-06-16.
