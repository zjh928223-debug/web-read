# Phase 5 Chunk Note Layout Core

Date: 2026-06-16

## Scope

Task 6.2 audits `chunk-note-layout-core.js` and migrates its layout result helpers into the Vite module graph.

This task covers:

- `normalizeChunkNoteLayoutResult`
- `buildEmptyChunkNoteLayoutResult`
- `buildChunkNoteLayoutResult`

It does not remove the root `<script src="chunk-note-layout-core.js">` tag from `index.html`. Root script tag removal is reserved for task 6.5 after all four root regular scripts have module replacements.

## New Owner

Added `src/utils/chunk-note-layout-core.js`.

`app.js` now loads the core module through Vite:

```text
import './src/utils/chunk-note-layout-core.js'
```

`src/composables/chunk-note-layout.js` now imports:

```text
buildEmptyChunkNoteLayoutResult
buildChunkNoteLayoutResult
```

The direct runtime consumers no longer read `window.ChunkNoteLayoutCore`.

The new module still assigns `window.ChunkNoteLayoutCore` as a compatibility global so the later root script tag removal can preserve the legacy surface while deleting the root regular script.

## Focused Verification

Added `npm run verify:chunk-note-layout-core`, backed by `scripts/chunk-note-layout-core-module-check.cjs`.

The check guards that:

- `app.js` loads the core module through Vite
- `app.js` no longer reads `window.ChunkNoteLayoutCore`
- `chunk-note-layout.js` imports the layout result builders directly
- `chunk-note-layout.js` no longer reads `window.ChunkNoteLayoutCore`
- the module replacement exports all three helper functions and preserves the compatibility global
- the root script tag remains until the explicit Phase 5 tag-removal task

## Verification Results

Commands run for task 6.2:

```text
Get-Content src/utils/chunk-note-layout-core.js | node --input-type=module --check
Get-Content src/composables/chunk-note-layout.js | node --input-type=module --check
node --check scripts/chunk-note-layout-core-module-check.cjs
npm run verify:chunk-note-layout-core
npm test
npm run build
openspec validate complete-appjs-decomposition --strict
git diff --check
```

All commands passed. The production build still reports the expected warnings for the four root regular scripts that remain loaded by `index.html`.
