# Phase 5 Annotation API Settings UI

Date: 2026-06-16

## Scope

Task 6.4 audits `annotation-api-settings-ui.js` and migrates its settings panel API into the Vite module graph.

This task covers the annotation API settings UI API:

- `init`
- `open`
- `close`
- `refreshForm`

It does not remove the root `<script src="annotation-api-settings-ui.js">` tag from `index.html`. Root script tag removal is reserved for task 6.5 after all four root regular scripts have module replacements.

## New Owner

Added `src/composables/annotation-api-settings-ui.js`.

`src/composables/session-init.js` now imports:

```text
getAnnotationApiSettingsUiApi
```

from the module replacement instead of reading `window.AnnotationApiSettingsUI` directly.

`src/main.js` also side-effect imports the module so the settings UI API remains in the Vite graph after `app.js` is retired.

The new module still assigns `window.AnnotationApiSettingsUI` as a compatibility global so the later root script tag removal can preserve the legacy surface while deleting the root regular script.

## Focused Verification

Added `npm run verify:annotation-api-settings-ui`, backed by `scripts/annotation-api-settings-ui-module-check.cjs`.

The check guards that:

- `session-init.js` imports the settings UI API through Vite
- `session-init.js` no longer reads `window.AnnotationApiSettingsUI`
- `src/main.js` loads the module replacement
- the module replacement preserves `window.AnnotationApiSettingsUI`
- the root script tag remains until the explicit Phase 5 tag-removal task

## Verification Results

Commands run for task 6.4:

```text
node --check annotation-api-settings-ui.js
cmd /c "node --input-type=module --check < src\composables\annotation-api-settings-ui.js"
cmd /c "node --input-type=module --check < src\composables\session-init.js"
node --check scripts\annotation-api-settings-ui-module-check.cjs
npm run verify:annotation-api-settings-ui
npm test
npm run build
openspec validate complete-appjs-decomposition --strict
git diff --check
```

All commands passed. The production build still reports the expected warnings for the four root regular scripts that remain loaded by `index.html`.
