# Phase 2 Annotation Lightweight Glue Migration

Last updated: 2026-06-16

This document completes task 3.6. It records the lightweight annotation import/export DOM glue moved out of `app.js`.

## Moved Owner

`src/composables/annotation-lightweight-module.js` now owns:

- export button click binding for `#btn-export-annotation-lightweight`
- import button click binding for `#btn-import-annotation-lightweight`
- import file input change binding for `#import-annotation-lightweight-file`
- delegation to `window.__session_exportManualLightweightAnnotations`
- delegation to `window.__session_importManualLightweightAnnotations`
- import success toast message construction
- import error/export error forwarding
- post-import refresh callback invocation

## Compatibility Preserved

- The real export/import implementation remains in `src/composables/session-init.js`.
- Existing `window.__session_exportManualLightweightAnnotations` and `window.__session_importManualLightweightAnnotations` integration points remain unchanged.
- `app.js` still passes render/update dependencies into the module so imported annotations refresh the current view.
- `index.html` script order is unchanged. The new module is imported by `app.js`.

## app.js Facade

`app.js` now only initializes the module:

```js
window.__annotationLightweightModule.initManualLightweightAnnotationControls(...)
```

It no longer owns the lightweight annotation export/import wrappers or button event bodies.

## Focused Verification

Added `npm run verify:annotation-lightweight-module`, backed by `scripts/annotation-lightweight-module-check.cjs`.

The check covers:

- module API exposure
- not-ready export/import errors
- session export delegate
- session import delegate
- import button forwarding to the hidden file input
- file input reset
- post-import refresh callback
- success toast message construction
- import error forwarding

