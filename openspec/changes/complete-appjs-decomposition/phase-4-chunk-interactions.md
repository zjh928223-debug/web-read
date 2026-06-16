# Phase 4 AI Chunk Interactions

Date: 2026-06-16

## Scope

Task 5.4 moves AI chunk interaction ownership out of direct `ChunkModeView.vue` calls to temporary `window.*` facades and into a focused runtime module.

This task covers:

- chunk word click seek/highlight behavior
- chunk block click seek/highlight behavior
- chunk word contextmenu note/annotation behavior
- chunk block contextmenu note behavior
- selected-sentence capture from chunk targets

It does not migrate chunk rendering, chunk note layout helpers, or root regular scripts.

## New Owner

Added `src/composables/chunk-interactions.js`.

`ChunkModeView.vue` now imports:

```text
handleChunkWordClick
handleChunkWordContextMenu
handleChunkContextMenu
handleChunkClick
```

The component no longer directly calls:

```text
window.forceUpdateUI
window.selectSentenceFromChunkTarget
window.openChunkNoteContextFromEvent
window.notifyAnnotationBubbleWordClick
window.getSelection
document.getElementById('audio-player')
```

`app.js` configures temporary runtime dependencies through `configureChunkInteractions(...)` after playback, note, and annotation functions are initialized.

`ChunkModeView.vue` still uses `window.__chunkNoteLayout.getChunkRef(...)` for chunk note layout identity fallback. That belongs to the later root regular script/module migration boundary.

## Focused Verification

Added `npm run verify:chunk-interactions`, backed by `scripts/chunk-interactions-check.cjs`.

The check guards that:

- `app.js` configures chunk interactions through the module
- `ChunkModeView.vue` uses the interaction module
- `ChunkModeView.vue` no longer calls the temporary interaction `window.*` facades directly
- `chunk-interactions.js` does not create/read `window.*` or `document.*` globals
- the remaining `window.__chunkNoteLayout` usage is explicitly limited to the later layout migration boundary

## Verification Results

Commands run for task 5.4:

```text
Get-Content app.js | node --input-type=module --check
Get-Content src/composables/chunk-interactions.js | node --input-type=module --check
node --check scripts/chunk-interactions-check.cjs
npm run verify:chunk-interactions
npm test
npm run verify:playback
npm run verify:interactions
npm run build
openspec validate complete-appjs-decomposition --strict
git diff --check
```

All commands passed. The production build still reports the expected warnings for the four root regular scripts that remain loaded by `index.html`.
