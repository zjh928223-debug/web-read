# Phase 4 Normal Transcript Interactions

Date: 2026-06-16

## Scope

Task 5.3 moves normal transcript word interaction ownership out of the legacy `app.js` container click listener and into `TranscriptContainer.vue` plus a focused runtime module.

This task covers normal transcript word click and contextmenu behavior:

- word click seeks the audio player and updates active transcript highlighting
- word click keeps current-word state available for mark shortcuts
- word click notifies the generated annotation bubble resolver
- word contextmenu can force-open the annotation bubble when an annotation is available

It does not migrate AI chunk interactions. Those remain task 5.4.

## New Owner

Added `src/composables/transcript-interactions.js`.

`TranscriptContainer.vue` now imports:

```text
handleTranscriptWordClick
handleTranscriptWordContextMenu
```

The component no longer directly calls:

```text
window.forceUpdateUI
window.notifyAnnotationBubbleWordClick
document.getElementById('audio-player')
```

`app.js` now only configures temporary runtime dependencies through `configureTranscriptInteractions(...)` after playback and annotation functions are initialized.

## Legacy Compatibility

The old `transcriptContainer.addEventListener('click', ...)` implementation was removed from `app.js`.

For the temporary legacy transcript path, `transcript-interactions.js` can bind the existing legacy container through the configured `legacyTranscriptContainer`. This preserves fallback behavior while moving event logic ownership out of `app.js`.

## Focused Verification

Added `npm run verify:transcript-interactions`, backed by `scripts/transcript-interactions-check.cjs`.

The check guards that:

- `app.js` configures transcript interactions through the module
- `app.js` does not regain the normal transcript click listener
- `TranscriptContainer.vue` uses the interaction module
- `TranscriptContainer.vue` no longer calls the temporary `window.*` interaction facades directly
- `transcript-interactions.js` does not create or read `window.*` globals

## Verification Results

Commands run for task 5.3:

```text
Get-Content app.js | node --input-type=module --check
Get-Content src/composables/transcript-interactions.js | node --input-type=module --check
node --check scripts/transcript-interactions-check.cjs
npm run verify:transcript-interactions
npm test
npm run verify:playback
npm run verify:interactions
npm run build
openspec validate complete-appjs-decomposition --strict
git diff --check
```

All commands passed. The production build still reports the expected warnings for the four root regular scripts that remain loaded by `index.html`.
