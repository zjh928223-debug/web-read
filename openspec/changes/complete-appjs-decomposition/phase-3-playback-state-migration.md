# Phase 3 Playback State Migration

Date: 2026-06-16

## Scope

Task 4.5 migrates playback transient state ownership out of `app.js` while preserving the current playback behavior:

- highlight follow state
- user scroll suppression timer
- active word/sentence/chunk DOM references
- playback loop UI signature
- sentence previous-tap navigation state

This task does not move playback algorithms, event ownership, or DOM binding ownership. `src/composables/playback-module.js` and `src/composables/controls-module.js` continue to read and write through `window.__state` until their callers are migrated.

## New Owner

`src/composables/playback-state.js` owns the migrated fields through `window.__playbackState`:

| Legacy field | New owner |
| --- | --- |
| `autoFollow` | `window.__playbackState.autoFollow` |
| `userScrollSuppress` | `window.__playbackState.userScrollSuppress` |
| `suppressTimer` | `window.__playbackState.suppressTimer` |
| `lastActiveSegIndex` | `window.__playbackState.lastActiveSegIndex` |
| `activeWordHighlightEl` | `window.__playbackState.activeWordHighlightEl` |
| `activeSentenceEl` | `window.__playbackState.activeSentenceEl` |
| `activeChunkEl` | `window.__playbackState.activeChunkEl` |
| `playbackUiSignature` | `window.__playbackState.playbackUiSignature` |
| `lastSentencePrevTapSegIndex` | `window.__playbackState.lastSentencePrevTapSegIndex` |
| `lastSentencePrevTapAt` | `window.__playbackState.lastSentencePrevTapAt` |

`app.js` now keeps only compatibility properties on `window.__state`; those getters/setters delegate to `window.__playbackState`.

## Compatibility Kept

- `window.__state.autoFollow`
- `window.__state.userScrollSuppress`
- `window.__state.suppressTimer`
- `window.__state.lastActiveSegIndex`
- `window.__state.activeWordHighlightEl`
- `window.__state.activeSentenceEl`
- `window.__state.activeChunkEl`
- `window.__state.playbackUiSignature`
- `window.__state.lastSentencePrevTapSegIndex` and `window.__state.lastSentencePrevTapAt` were removed in task 4.8 after the runtime map showed no direct external consumers.

These facades remain because `playback-module.js`, `controls-module.js`, and Playwright verification scripts still access `window.__state` directly.

## Deletion Conditions

Remove the compatibility fields only after:

- playback and controls modules no longer use `window.__state` as their playback state source
- verification scripts no longer depend on direct `window.__state` playback field access
- `npm run verify:playback`, `npm run verify:interactions`, and `npm test` pass after removal

## Verification

Required for this task:

```text
node --check src/composables/playback-state.js
node --check scripts/playback-state-check.cjs
Get-Content app.js | node --input-type=module --check
npm run verify:playback-state
npm test
npm run build
openspec validate complete-appjs-decomposition --strict
git diff --check
```
