# Phase 3 Bridge Startup Reduction

Date: 2026-06-16

## Scope

Task 4.9 reduces `window.__bridge` usage after Phase 3 state adapters became the startup-safe state owners for transcript, chunk, and cloze data.

This task does not remove `window.bridgeToPinia()`. That function still exists for runtime compatibility callers, but it writes directly to `window.__piniaStores` and no longer creates or updates `window.__bridge`.

## Changes

- Removed `window.__bridge` initialization from `app.js`.
- Removed `window.__bridge` writes from `bridgeToPinia()`.
- Removed `src/main.js` startup reads from `window.__bridge`.
- Changed `src/main.js` to seed Pinia by binding state adapters directly:
  - `window.__transcriptState.bindPiniaStore(transcriptStore)`
  - `window.__chunkState.bindPiniaStore(chunkStore)`
  - `window.__clozeState.bindPiniaStore(clozeStore)`

## Compatibility Kept

- `window.bridgeToPinia()` remains exported because import/session modules and verification scripts still call it.
- Runtime direct Pinia writes remain inside `bridgeToPinia()` for existing callers.

## Verification

```text
node --check scripts/bridge-startup-check.cjs
Get-Content app.js | node --input-type=module --check
Get-Content src/main.js | node --input-type=module --check
npm run verify:bridge-startup
npm test
npm run build
openspec validate complete-appjs-decomposition --strict
git diff --check
```
