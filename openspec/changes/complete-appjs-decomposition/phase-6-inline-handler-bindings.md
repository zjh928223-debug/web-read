# Phase 6 Inline Handler Bindings

Date: 2026-06-16

## Scope

Task 7.2 removes the remaining inline DOM event handlers from `index.html`.

Removed inline handlers:

- playback previous/next buttons
- playback speed buttons
- highlight mode button
- AI chunk mode/focus controls
- chunk style modal buttons and inputs
- chunk note style modal buttons and inputs

This task does not remove the underlying `window.*` compatibility exports yet. Those exports remain until their remaining runtime and verification consumers are migrated.

## New Owner

Added `src/composables/legacy-control-bindings.js`.

The module binds the existing DOM controls to the same current handlers at event time:

- `handleBackwardClick`
- `handleForwardClick`
- `changeSpeed`
- `cycleHighlightMode`
- `toggleChunkMode`
- `openChunkStyleModal`
- `toggleChunkFocusMode`
- `openChunkNoteStyleModal`
- `closeChunkStyleModal`
- `toggleChunkShadowManual`
- `closeChunkNoteStyleModal`
- `updateChunkStyle`
- `updateChunkNoteStyle`

## Focused Verification

Added `npm run verify:inline-handler-bindings`, backed by `scripts/inline-handler-bindings-check.cjs`.

The check guards that:

- `index.html` has no inline DOM event handlers
- `index.html` loads `src/composables/legacy-control-bindings.js`
- the binding module references every migrated handler

## Verification Results

Commands run for task 7.2:

```text
cmd /c "node --input-type=module --check < src\composables\legacy-control-bindings.js"
node --check scripts\inline-handler-bindings-check.cjs
npm run verify:inline-handler-bindings
npm run verify:script-order
npm test
npm run build
openspec validate complete-appjs-decomposition --strict
git diff --check
```

Result: all commands passed on 2026-06-16.
