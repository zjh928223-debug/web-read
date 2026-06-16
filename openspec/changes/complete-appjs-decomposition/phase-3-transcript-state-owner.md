# Phase 3 Transcript State Owner

Last updated: 2026-06-16

This document completes task 4.1. It selects the first Phase 3 state domain and defines its owner before code migration starts.

## Selected Domain

First state domain: transcript state.

Reason:

- Task 4.2 explicitly targets transcript ownership next.
- `src/pinia-stores/transcript.js` already has the core fields needed by Vue rendering.
- Vue components already read transcript state from Pinia.
- Current `app.js` transcript variables are heavily bridged, so migrating this domain reduces central runtime risk before chunk/cloze/playback state moves.

## Target Owner

Canonical owner: `src/pinia-stores/transcript.js`.

Owned fields:

- `segments`
- `words`
- `wordStarts`
- `currentWordIndex`
- `highlightMode`
- `activeWordIdx`
- `activeSegIdx`
- `useVueRendering`

`app.js` may temporarily keep compatibility facades, but it must stop being the real source of these fields.

## Current Sources and Consumers

Current real source:

- `app.js` local variables: `segments`, `words`, `wordStarts`, `currentWordIndex`, `highlightMode`
- playback active indexes are partly local/runtime and partly pushed to Pinia through playback sync

Current Pinia consumers:

- `TranscriptContainer.vue`
- `ChunkModeView.vue`
- `ClozeQuizView.vue` through `useVueRendering`
- verification scripts through `window.__piniaStores.transcript`

Current compatibility consumers:

- `window.__state.segments`
- `window.__state.words`
- `window.__state.wordStarts`
- `window.__state.currentWordIndex`
- `window.__state.highlightMode`
- `playback-module.js` through `window.__state`
- `controls-module.js` through `window.__state`
- `import-module.js` through injected state object
- `session-init.js` through `window.__state`
- marks/app handlers that still receive `words` or `segments` from `app.js`

## Migration Boundary for 4.2

Move only transcript state ownership in 4.2:

- create a small transcript runtime adapter if needed, but keep the canonical state in Pinia
- make `window.__state` transcript fields read/write the Pinia transcript store after stores exist
- keep startup bridge behavior until `src/main.js` no longer needs it
- preserve `processTranscript()` behavior and payload shape
- preserve `renderTranscript()` as a temporary facade
- preserve verification script access to `window.__state` and `window.__piniaStores.transcript`

Do not move in 4.2:

- chunk mode state
- cloze state
- playback transient follow/suppress state
- marks storage
- annotation session glue
- `index.html` inline handlers

## Deletion Conditions

Transcript compatibility facades may only be removed after:

- `import-module.js`, `session-init.js`, `playback-module.js`, and `controls-module.js` stop depending on `window.__state` as their real transcript source
- verification scripts no longer require transcript fields on `window.__state`
- `window.__bridge.transcript` no longer participates in startup sync
- `npm test`, playback verification, and interaction verification pass

## Required Verification for 4.2

- focused transcript state check if practical
- `npm test`
- `npm run verify:playback`
- `npm run verify:interactions`
- `openspec validate complete-appjs-decomposition --strict`
- `git diff --check`
