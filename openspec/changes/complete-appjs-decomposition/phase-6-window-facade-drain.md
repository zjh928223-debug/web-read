# Phase 6 Window Facade Drain

Date: 2026-06-18

This checkpoint reduces the final `app.js` deletion risk by moving the remaining direct `window.*` facade ownership out of `app.js`.

## Migrated Owners

- `src/composables/session-facades.js` now owns the public session/annotation facade stubs that delegate to `session-init.js` once it loads.
- `src/composables/annotation-bubble-resolver.js` now owns generated/vocab annotation bubble hit resolution and `window.notifyAnnotationBubbleWordClick`.
- `src/composables/reader-public-facades.js` now owns the remaining note/import/session public facades that are still configured by the runtime entry.
- `src/composables/ui-facades.js` now owns the early `window.showToast` / `window.showError` facade without delegating back through the legacy `__uiStore` recursion path.
- `src/composables/render-mode.js` now owns the default `window.__USE_VUE_RENDERING` value.
- `src/composables/runtime-state-facade.js` now owns the temporary `window.__state` alias and exports `runtimeState` for explicit injection.

## Current Boundary

`app.js` no longer directly assigns any `window.*` facade. It still remains loaded by `index.html` and still configures runtime modules, DOM bindings, and `runtimeState` property facades.

This means tasks 7.1 and 7.6 are not complete yet. The next deletion slice can move the remaining runtime entry into the Vite module graph and remove the root `app.js` file.

## Verification

- `npm run verify:session-facades`
- `npm run verify:annotation-bubble-resolver`
- `npm run verify:reader-public-facades`
- `npm run verify:ui-facades`
- `npm run verify:render-mode`
- `npm run verify:runtime-state-facade`
- `npm run verify:runtime-state-source`
- `npm run verify:session-state-provider`
- `npm run verify:state-facades`
- `npm run verify:app-window-facades`
- `npm test`
- `npm run build`
- `openspec validate complete-appjs-decomposition --strict`
- `git diff --check`
