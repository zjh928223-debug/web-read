# Phase 5 Root Script Tags

Date: 2026-06-16

## Scope

Task 6.5 removes the four remaining root regular script tags from `index.html` after tasks 6.1 through 6.4 added Vite module replacements.

Removed tags:

- `chunk-note-layout-helpers.js`
- `chunk-note-layout-core.js`
- `annotation-bubble.js`
- `annotation-api-settings-ui.js`

The root files still exist and `vite.config.js` still copies them in this task. Removing the stale copy logic is reserved for task 6.6.

## New Load Order

`index.html` now loads:

```text
External Google CSE script
9 src/stores/*.js module compatibility stores
14 src/composables/*.js module compatibility/runtime modules
app.js as an ES module
src/composables/session-init.js as an ES module
/src/main.js as the Vue + Pinia entry
```

The former root regular scripts are now loaded through the Vite module graph:

- `src/utils/chunk-note-layout-helpers.js`
- `src/utils/chunk-note-layout-core.js`
- `src/composables/annotation-bubble.js`
- `src/composables/annotation-api-settings-ui.js`

## Focused Verification

Updated `npm run verify:script-order`, backed by `scripts/script-order-guard-check.cjs`.

The check now guards that:

- the four root regular script tags are absent
- the remaining script order is stable

The focused module checks for the four migrated scripts also now guard that the root script tags stay removed.

## Verification Results

Commands run for task 6.5:

```text
npm run verify:script-order
npm run verify:chunk-note-layout-helpers
npm run verify:chunk-note-layout-core
npm run verify:annotation-bubble
npm run verify:annotation-api-settings-ui
npm test
npm run build
openspec validate complete-appjs-decomposition --strict
git diff --check
```

All commands passed. `npm run build` no longer reports root regular script bundling warnings because `index.html` no longer loads those files directly.
