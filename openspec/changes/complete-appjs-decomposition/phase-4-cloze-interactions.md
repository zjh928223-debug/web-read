# Phase 4 Cloze Interactions

Date: 2026-06-16

## Scope

Task 5.5 moves Vue cloze answer interaction ownership out of direct `window.*` facade calls and DOM input lookups.

This task covers:

- cloze card draft answer updates
- cloze answer checking in the Vue quiz path
- cloze card view-model construction in the Vue quiz path
- shared answer-state checking for the remaining legacy check facade

It does not remove the legacy cloze render facades. `window.__clozeCheck` and `window.__buildClozeQuizMarkup` remain until task 5.6 decides which render facades no longer have callers.

## New Owner

Added `src/composables/cloze-interactions.js`.

`ClozeCard.vue` now imports:

```text
updateClozeDraftAnswer
```

`ClozeQuizView.vue` now imports:

```text
buildClozeCards
checkClozeStoreAnswer
```

The Vue components no longer directly call:

```text
window.ClozeViewModelHelpers
window.__clozeCheck
document.querySelector
```

`src/composables/import-module.js` keeps the legacy `window.__clozeCheck` facade for non-Vue fallback behavior, but its answer-state creation/checking now delegates to `cloze-interactions.js`.

## Focused Verification

Added `npm run verify:cloze-interactions`, backed by `scripts/cloze-interactions-check.cjs`.

The check guards that:

- `ClozeCard.vue` updates draft answers through the interaction module
- `ClozeCard.vue` no longer queries DOM input state
- `ClozeQuizView.vue` builds cards and checks answers through the interaction module
- `ClozeQuizView.vue` no longer calls cloze `window.*` facades
- `cloze-interactions.js` does not create/read `window.*` or `document.*` globals
- the legacy `import-module.js` check facade reuses the shared cloze answer helper

## Verification Results

Commands run for task 5.5:

```text
Get-Content src/composables/cloze-interactions.js | node --input-type=module --check
Get-Content src/composables/import-module.js | node --input-type=module --check
node --check scripts/cloze-interactions-check.cjs
npm run verify:cloze-interactions
npm test
npm run build
openspec validate complete-appjs-decomposition --strict
git diff --check
```

All commands passed. The production build still reports the expected warnings for the four root regular scripts that remain loaded by `index.html`.
