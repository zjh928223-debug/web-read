# Phase 5 Chunk Note Layout Helpers

Date: 2026-06-16

## Scope

Task 6.1 audits `chunk-note-layout-helpers.js` and migrates its helper logic into the Vite module graph.

This task covers the pure canvas/text wrapping helpers:

- `getChunkNoteWrapTokens`
- `splitTokenToFitWidth`
- `wrapChunkNoteTextForCanvas`
- `truncateCanvasLine`

It does not remove the root `<script src="chunk-note-layout-helpers.js">` tag from `index.html`. Root script tag removal is reserved for task 6.5 after all four root regular scripts have module replacements.

## New Owner

Added `src/utils/chunk-note-layout-helpers.js`.

`app.js` now loads the helper module through Vite:

```text
import './src/utils/chunk-note-layout-helpers.js'
```

`src/composables/chunk-note-layout.js` now imports:

```text
wrapChunkNoteTextForCanvas
```

The direct runtime consumers no longer read `window.ChunkNoteLayoutHelpers`.

The new module still assigns `window.ChunkNoteLayoutHelpers` as a compatibility global so the later root script tag removal can preserve the legacy surface while deleting the root regular script.

## Focused Verification

Added `npm run verify:chunk-note-layout-helpers`, backed by `scripts/chunk-note-layout-helpers-module-check.cjs`.

The check guards that:

- `app.js` loads the helper module through Vite
- `app.js` no longer reads `window.ChunkNoteLayoutHelpers`
- `chunk-note-layout.js` imports the wrapping helper directly
- `chunk-note-layout.js` no longer reads `window.ChunkNoteLayoutHelpers`
- the module replacement exports all four helper functions and preserves the compatibility global
- the root script tag remains until the explicit Phase 5 tag-removal task

## Verification Results

Commands run for task 6.1:

```text
Get-Content src/utils/chunk-note-layout-helpers.js | node --input-type=module --check
Get-Content src/composables/chunk-note-layout.js | node --input-type=module --check
node --check scripts/chunk-note-layout-helpers-module-check.cjs
npm run verify:chunk-note-layout-helpers
npm test
npm run build
openspec validate complete-appjs-decomposition --strict
git diff --check
```

All commands passed. The production build still reports the expected warnings for the four root regular scripts that remain loaded by `index.html`.
