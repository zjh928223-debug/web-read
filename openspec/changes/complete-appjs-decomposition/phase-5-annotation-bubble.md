# Phase 5 Annotation Bubble

Date: 2026-06-16

## Scope

Task 6.3 audits `annotation-bubble.js` and migrates its DOM bubble API into the Vite module graph.

This task covers the annotation bubble API:

- `init`
- `show`
- `hide`
- `toggle`
- `isVisible`
- `setAnnotation`
- `clearAnnotation`

It does not remove the root `<script src="annotation-bubble.js">` tag from `index.html`. Root script tag removal is reserved for task 6.5 after all four root regular scripts have module replacements.

## New Owner

Added `src/composables/annotation-bubble.js`.

`app.js` now imports:

```text
getAnnotationBubbleApi
```

from the module replacement instead of reading `window.AnnotationBubble` directly.

`src/main.js` also side-effect imports the module so the bubble API remains in the Vite graph after `app.js` is retired.

The new module still assigns `window.AnnotationBubble` as a compatibility global so the later root script tag removal can preserve the legacy surface while deleting the root regular script.

## Focused Verification

Added `npm run verify:annotation-bubble`, backed by `scripts/annotation-bubble-module-check.cjs`.

The check guards that:

- `app.js` imports the bubble API through Vite
- `app.js` no longer reads `window.AnnotationBubble`
- `src/main.js` loads the module replacement
- the module replacement preserves `window.AnnotationBubble`
- the root script tag remains until the explicit Phase 5 tag-removal task

## Verification Results

Commands run for task 6.3:

```text
node --check annotation-bubble.js
cmd /c "node --input-type=module --check < src\composables\annotation-bubble.js"
node --check scripts\annotation-bubble-module-check.cjs
npm run verify:annotation-bubble
npm test
npm run build
openspec validate complete-appjs-decomposition --strict
git diff --check
```

All commands passed. The production build still reports the expected warnings for the four root regular scripts that remain loaded by `index.html`.
