## Why

`app.js` currently mixes cloze parsing, cloze answer normalization, HTML escaping, UI rendering, and event handling in one contiguous block. The first safe split should reduce file size and improve scanability without changing any user-visible behavior or touching playback, highlight, DOM structure, or event flow.

## What Changes

- Extract cloze-related pure or near-pure utility functions from `app.js` into a new `cloze-utils.js` module.
- Limit the extraction to functions such as `validateClozeData`, `normalizeClozeAnswer`, and `escapeHtml`.
- Update `app.js` to consume those helpers from the new module without changing existing UI markup, render output, event bindings, or playback logic.
- Keep `buildClozeQuizMarkup`, `handleClozeCheck`, and all DOM/event orchestration in `app.js`.

## Capabilities

### New Capabilities
- `cloze-utils-boundary`: Define a stable utility boundary for cloze validation and normalization helpers so these functions can live outside `app.js` without changing reader behavior.

### Modified Capabilities
- None.

## Impact

- Affected code: `app.js`, new `cloze-utils.js`, and the script loading order in `read-26.html`.
- No product behavior changes are intended.
- No API, storage, playback, highlight, or interaction contract changes are intended.
