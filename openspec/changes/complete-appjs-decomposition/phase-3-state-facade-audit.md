# Phase 3 State Facade Audit

Date: 2026-06-16

## Scope

Task 4.7 verifies that the state domains migrated in Phase 3 are exposed through `window.__state` only as compatibility facades over their owners.

This task does not remove `window.__state` properties. Removal is blocked until direct consumers are gone and the runtime map shows no remaining use.

## Owner Facades Verified

`scripts/state-facade-owner-check.cjs` verifies that these migrated fields delegate to their owner:

- transcript fields -> `window.__transcriptState` through `_tr`
- chunk fields -> `window.__chunkState` through `_ch`
- cloze fields -> `window.__clozeState` through `_clz`
- playback transient fields -> `window.__playbackState` through `_pb`
- chunk note file handle fields -> notes subsystem API `_cnApi`, backed by `window.__notesState`

The check also prevents old `app.js` local declarations for migrated domains from returning.

## Compatibility Kept

All audited `window.__state` properties remain because `playback-module.js`, `controls-module.js`, `session-init.js`, verification scripts, import modules, and legacy callers still access `window.__state` directly.

## Verification

```text
node --check scripts/state-facade-owner-check.cjs
npm run verify:state-facades
openspec validate complete-appjs-decomposition --strict
git diff --check
```
