# Phase 2 Chunk Note Overlay Completion

Completed: 2026-06-16

This completes task 3.3. Chunk note overlay and tag interaction behavior now lives behind `_cnApi` in `src/composables/notes-module.js`. `app.js` keeps compatibility wrappers for existing globals, inline handlers, `keyboard-module.js`, `style-editor.js`, and other legacy callers.

## Moved Behind `_cnApi`

- right-click selection/context resolution
- context menu pending-context lifecycle
- popover DOM lifecycle and draft restore
- tag DOM creation
- tag drag/resize/edit handlers
- word underline and active-hover markers
- connector drawing and scheduling
- delete confirmation dialog
- chunk note style modal runtime
- overlay layer sizing and main-area coordinate conversion

## Compatibility Kept

- `window.openChunkNoteContextFromEvent(event)` still exists for `ChunkModeView.vue`.
- `window.openChunkNoteStyleModal()`, `window.closeChunkNoteStyleModal()`, `window.updateChunkNoteStyle()`, and `window.adjustChunkNoteArrowSizeByGap()` still exist for current inline/global callers.
- `app.js` wrapper functions delegate to `_cnApi` and should be removed only after Phase 4 caller migration.
- `window.__state.chunkNoteModalEl` remains a compatibility field for now, although no direct runtime consumer was found.

## Verification

Passed:

```text
npm run verify:chunk-notes-state
npm test
npm run build
```

Note:

```text
npm run verify:interactions
```

requires a running Vite server when run directly. A direct parallel run without a server failed with `ERR_CONNECTION_REFUSED` at `http://127.0.0.1:4173/`; the same interaction check passed through `npm test` / `verify:vite`, which starts the verification server.
