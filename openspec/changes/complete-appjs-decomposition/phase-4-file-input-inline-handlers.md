# Phase 4 File Input Inline Handlers

Date: 2026-06-16

## Scope

Task 5.1 starts DOM/event ownership migration with the smallest current inline-handler boundary: the chunk and cloze file picker launcher buttons.

This task only moves the click launcher behavior for:

- `#btn-load-chunk` -> `#chunk-file`
- `#btn-load-cloze` -> `#cloze-file`

It does not change chunk/cloze JSON parsing, input `change` handlers, import validation, script order, or IndexedDB schema.

## New Owner

Added `src/composables/file-input-bindings.js`.

`src/main.js` imports the module for side effects after the DOM shell exists. The module attaches explicit click listeners to the two launcher buttons and triggers the existing hidden file inputs.

The module exports `bindReaderFileInputLaunchers(...)` for future reuse, but it does not create a new `window.*` compatibility global.

## index.html Changes

Removed these inline handlers:

```text
onclick="document.getElementById('chunk-file').click()"
onclick="document.getElementById('cloze-file').click()"
```

Both buttons now use `type="button"` and keep their existing ids/classes/text.

## Focused Verification

Added `npm run verify:file-input-bindings`, backed by `scripts/file-input-bindings-check.cjs`.

The check guards that:

- the two inline `onclick` handlers stay removed from `index.html`
- the buttons remain button-type launchers
- `src/main.js` imports the binding module
- the binding module targets the expected button/input ids
- the binding module does not add a new `window.*` compatibility global

## Verification Results

Commands run for task 5.1:

```text
Get-Content src/composables/file-input-bindings.js | node --input-type=module --check
node --check scripts/file-input-bindings-check.cjs
npm run verify:file-input-bindings
npm test
npm run build
openspec validate complete-appjs-decomposition --strict
git diff --check
```

All passed. `npm test` covered the current Vite load, playback, and interaction checks. The production build still reports the expected warnings for the four root regular scripts that remain loaded by `index.html`.
