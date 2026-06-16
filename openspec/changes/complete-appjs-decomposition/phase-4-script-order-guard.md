# Phase 4 Script Order Guard

Date: 2026-06-16

## Scope

Task 5.7 keeps `index.html` script order changes isolated and fully verified.

This task does not change `index.html`. Instead, it records the current order in a focused guard so future entry/script-order edits fail loudly unless they are made deliberately.

## Guarded Order

Added `scripts/script-order-guard-check.cjs`, which parses every `<script src="...">` in `index.html` and compares the sequence to the current Phase 4 baseline:

```text
Google CSE external script
4 root regular scripts
9 src/stores/*.js compatibility modules
9 direct src/composables/*.js compatibility modules
app.js
src/composables/session-init.js
/src/main.js
```

The guard also verifies the four root legacy scripts remain regular scripts until Phase 5 migrates them:

```text
chunk-note-layout-helpers.js
chunk-note-layout-core.js
annotation-bubble.js
annotation-api-settings-ui.js
```

## Focused Verification

Added `npm run verify:script-order`, backed by `scripts/script-order-guard-check.cjs`.

The check guards that:

- `index.html` script order matches the current Phase 4 baseline exactly
- the four root legacy scripts have not been silently converted to module scripts
- entry order remains separate from DOM/event ownership cleanup work

## Verification Results

Commands run for task 5.7:

```text
node --check scripts/script-order-guard-check.cjs
npm run verify:script-order
npm test
npm run build
openspec validate complete-appjs-decomposition --strict
git diff --check
```

All commands passed. `index.html` was not changed in this task. The production build still reports the expected warnings for the four root regular scripts that remain loaded by `index.html`.
