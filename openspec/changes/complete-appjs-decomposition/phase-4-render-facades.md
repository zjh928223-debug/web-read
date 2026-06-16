# Phase 4 Legacy Render Facades

Date: 2026-06-16

## Scope

Task 5.6 removes the global `window.renderTranscript` and `window.renderChunkMode` facades only after direct callers are moved.

This task covers:

- replacing `session-init.js` direct `window.render*` calls with a focused render runtime module
- configuring that render runtime from `app.js`
- removing the `window.renderTranscript` and `window.renderChunkMode` exports from `app.js`
- preserving local render function injection for modules that still receive explicit dependencies

It does not remove the local `renderTranscript()` / `renderChunkMode()` functions from `app.js`. They still bridge state into Pinia and still serve explicit injected callers such as `import-module.js` and `app-handlers.js`.

## New Owner

Added `src/composables/render-runtime.js`.

`app.js` configures it with:

```text
configureRenderRuntime({
  renderTranscript,
  renderChunkMode
})
```

`src/composables/session-init.js` now imports:

```text
renderTranscript
renderChunkMode
```

The runtime module does not read or write `window.*` globals. It is a temporary explicit module boundary while the remaining render callers are migrated.

## Removed Facades

Removed these global exports from `app.js`:

```text
window.renderTranscript
window.renderChunkMode
```

Remaining render dependencies are no longer global facade consumers:

- `src/composables/import-module.js` receives render functions through `deps.renderTranscript` / `deps.renderChunkMode`
- `src/composables/app-handlers.js` receives render functions through `config.renderTranscript` / `config.renderChunkMode`
- `app.js` still has internal local calls until those workflows get their own owners

## Focused Verification

Added `npm run verify:render-facades`, backed by `scripts/render-facades-check.cjs`.

The check guards that:

- `app.js` configures `render-runtime.js`
- `app.js` no longer exports `window.renderTranscript` or `window.renderChunkMode`
- `session-init.js` no longer calls `window.renderTranscript` or `window.renderChunkMode`
- `render-runtime.js` does not create/read `window.*` or `document.*` globals
- injected render dependencies remain explicit in `import-module.js` and `app-handlers.js`

## Verification Results

Commands run for task 5.6:

```text
Get-Content app.js | node --input-type=module --check
cmd /c "node --input-type=module --check < src\composables\session-init.js"
Get-Content src/composables/render-runtime.js | node --input-type=module --check
node --check scripts/render-facades-check.cjs
npm run verify:render-facades
npm test
npm run build
openspec validate complete-appjs-decomposition --strict
git diff --check
```

All commands passed. The production build still reports the expected warnings for the four root regular scripts that remain loaded by `index.html`.
