# Phase 3 Transcript State Migration

Last updated: 2026-06-16

This document completes task 4.2. It records the transcript state ownership migration away from `app.js` local variables.

## New Runtime Adapter

Added `src/composables/transcript-state.js`.

The adapter provides startup-safe transcript state before Pinia exists, then binds to the real Pinia transcript store after `src/main.js` creates the stores.

Owned fields:

- `segments`
- `words`
- `wordStarts`
- `currentWordIndex`
- `highlightMode`
- `activeWordIdx`
- `activeSegIdx`
- `useVueRendering`

Startup flow:

1. `app.js` imports `transcript-state.js` and reads/writes `window.__transcriptState`.
2. Before Pinia exists, the adapter uses an internal fallback object.
3. `bridgeToPinia()` writes the current adapter snapshot into `window.__bridge.transcript` for the existing startup path.
4. `src/main.js` hydrates `transcriptStore` from `window.__bridge.transcript`.
5. `src/main.js` calls `window.__transcriptState.bindPiniaStore(transcriptStore, { preferStore: true })`.
6. After binding, adapter reads/writes delegate to `src/pinia-stores/transcript.js`.

## app.js Changes

Removed these `app.js` local state variables as transcript sources:

- `words`
- `segments`
- `wordStarts`
- `currentWordIndex`
- `highlightMode`

`app.js` now uses `_tr` (`window.__transcriptState`) for transcript state access.

`window.__state` transcript properties now read/write the adapter:

- `window.__state.segments`
- `window.__state.words`
- `window.__state.wordStarts`
- `window.__state.currentWordIndex`
- `window.__state.highlightMode`

These properties remain compatibility facades and are not removed in this task.

## Related Module Changes

`src/composables/app-handlers.js` now accepts `getSegments()` and `getWords()` callbacks so export/import handlers read the current transcript owner instead of a startup snapshot.

`src/main.js` imports the transcript adapter and binds it to the Pinia transcript store after bridge hydration.

## Preserved Compatibility

- `window.__bridge.transcript` remains in place for startup sync. Reducing it is task 4.9.
- `window.__state` transcript properties remain available for legacy modules and verification scripts.
- `processTranscript()` and import/session restore behavior are unchanged at the public API level.
- Vue components continue reading transcript state from Pinia.
- No IndexedDB schema changes.
- No `index.html` script order changes.

## Focused Verification

Added `npm run verify:transcript-state`, backed by `scripts/transcript-state-check.cjs`.

The check covers:

- adapter API exposure
- fallback state reads/writes
- fallback-to-Pinia binding
- Pinia-preferred binding
- invalid value normalization for transcript arrays and numeric fields

## Verification Results

Commands run for task 4.2:

- `npm run verify:transcript-state`
- `npm test`
- `npm run build`
- `openspec validate complete-appjs-decomposition --strict`
- `git diff --check`
- `node --check src/composables/transcript-state.js`
- `node --check src/composables/app-handlers.js`
- `Get-Content app.js | node --input-type=module --check`
- `Get-Content src/main.js | node --input-type=module --check`

`npm test` ran the current Vite verification path, including load, playback, and interaction checks. All passed before this task was marked complete.

The production build still reports the expected Vite warnings for the four remaining root regular scripts.
