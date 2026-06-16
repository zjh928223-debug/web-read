# Phase 4 File Picker DOM Wiring

Date: 2026-06-16

## Scope

Task 5.2 continues the file picker control boundary started in task 5.1.

This task only moves `#btn-load-cloze` active-state DOM ownership out of `app.js`. It does not migrate unrelated `app.js` `getElementById(...)` calls.

## Changes

- Removed `document.getElementById('btn-load-cloze')` from `app.js`.
- Removed `loadClozeBtn: loadClozeBtn` from the `initImportHandlers(...)` dependency object in `app.js`.
- Updated `src/composables/import-module.js` to resolve `#btn-load-cloze` itself when a caller does not inject `deps.loadClozeBtn`.
- Extended `scripts/file-input-bindings-check.cjs` to guard that `app.js` does not regain this DOM lookup or injection field.

## Compatibility

`src/composables/import-module.js` still toggles the existing `active` class on `#btn-load-cloze` when cloze data is reset or loaded.

No chunk/cloze JSON parsing behavior changed. No script order changed. No IndexedDB schema changed.

## Verification

```text
Get-Content app.js | node --input-type=module --check
Get-Content src/composables/import-module.js | node --input-type=module --check
node --check scripts/file-input-bindings-check.cjs
npm run verify:file-input-bindings
npm test
npm run build
openspec validate complete-appjs-decomposition --strict
git diff --check
```

All commands passed for this task.
