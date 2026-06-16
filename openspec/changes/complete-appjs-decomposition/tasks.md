## 1. Phase 0 - Baseline and Guardrails

- [x] 1.1 Create an `app.js` runtime map that lists all `window.*` exports, their current consumers, and their intended final owner.
- [x] 1.2 Create a `window.__state` map that lists every proxied field, the backing `app.js` variable, current readers/writers, and the target owner.
- [x] 1.3 Create a `window.__bridge` map that lists startup/runtime sync fields and the Pinia store fields they mirror.
- [x] 1.4 Create an `index.html` integration map that lists script order, inline handlers, DOM ids used by runtime code, and root regular script dependencies.
- [x] 1.5 Create a verification matrix that maps each high-risk area to required commands: `npm test`, `npm run verify:playback`, `npm run verify:interactions`, `npm run build`, and browser smoke checks.
- [x] 1.6 Add cleanup guardrails to the current project docs: no new feature logic in `app.js`, no IndexedDB schema changes, no script order changes without full verification.
- [x] 1.7 Run baseline `npm test` and `npm run build`, then record the result in the Phase 0 notes.

## 2. Phase 1 - Pure Logic Extraction

- [x] 2.1 Audit `app.js` for remaining pure or near-pure helper families that do not require DOM ownership or event ordering.
- [x] 2.2 Move any remaining chunk matching or text normalization helpers out of `app.js` into `src/utils/`, preserving existing fallback behavior.
- [x] 2.3 Move remaining playback index/time mapping helpers out of `app.js` or thin wrappers into `src/utils/` or `src/composables/playback-module.js`, preserving current playback behavior.
- [x] 2.4 Move remaining cloze view-model or answer normalization helpers out of `app.js` into `src/utils/` or existing cloze modules.
- [x] 2.5 Move remaining import/export parse helpers out of `app.js` into `src/utils/` or `src/composables/import-module.js`.
- [x] 2.6 Add or update focused tests/checks for extracted helper behavior where practical.
- [x] 2.7 Run `npm test`; also run `npm run verify:playback` if playback helpers changed.
- [x] 2.8 Update the runtime map to mark migrated helper exports as delegated, removed, or still pending.

## 3. Phase 2 - Subsystem Extraction

- [x] 3.1 Define the public API and deletion conditions for the chunk note subsystem before moving additional chunk note logic.
- [x] 3.2 Move chunk note non-rendering state/persistence orchestration out of `app.js` while keeping legacy `window.*` facade behavior stable.
- [x] 3.3 Move chunk note overlay/tag interaction logic behind a subsystem API, preserving right-click note creation, underline markers, connectors, drag/resize/edit, and delete prompt behavior.
- [x] 3.4 Define the public API and deletion conditions for the sentence note / note preview subsystem.
- [x] 3.5 Move sentence note draft, persistence, selection, and sidebar rendering orchestration out of `app.js` or into Vue/runtime modules, preserving existing import/export behavior.
- [x] 3.6 Move annotation lightweight import/export glue out of `app.js` into a focused module, preserving existing `session-init.js` integration points.
- [x] 3.7 Tighten `keyboard-module.js` and event boundary ownership so `app.js` no longer owns shortcut behavior beyond temporary delegation.
- [x] 3.8 Run `npm test` and `npm run verify:interactions`; run `npm run verify:playback` if shortcut or playback navigation behavior changed.
- [x] 3.9 Update the runtime map to mark subsystem facades and their deletion conditions.

## 4. Phase 3 - State Ownership Migration

- [x] 4.1 Pick one state domain and document its new owner before migrating it: transcript, chunk, cloze, playback, chunk note, or sentence note.
- [x] 4.2 Migrate transcript state ownership from `app.js` local variables to the real Pinia transcript store or a clearly owned runtime module.
- [x] 4.3 Migrate chunk state ownership from `app.js` local variables to the real Pinia chunk store or chunk runtime module.
- [x] 4.4 Migrate cloze state ownership from `app.js` local variables to the real Pinia cloze store or cloze runtime module.
- [x] 4.5 Migrate playback transient state ownership out of `app.js`, preserving highlight, seek, backward/forward, and page-style follow behavior.
- [x] 4.6 Migrate chunk note and sentence note state ownership out of `app.js`, preserving persisted session behavior.
- [x] 4.7 Convert affected `window.__state` properties into compatibility facades over the new owner.
- [x] 4.8 Remove `window.__state` properties only after the runtime map shows no remaining direct consumers.
- [x] 4.9 Reduce `window.__bridge` usage after Vue/Pinia startup no longer depends on bridged snapshots.
- [ ] 4.10 Run `npm test`, `npm run verify:playback`, and `npm run verify:interactions`.

## 5. Phase 4 - DOM and Event Ownership Migration

- [ ] 5.1 Move one inline handler at a time from `index.html` to Vue component events or a centralized DOM bindings module.
- [ ] 5.2 Replace legacy `getElementById` wiring in `app.js` with explicit module or component ownership for the same controls.
- [ ] 5.3 Move normal transcript interaction ownership into `TranscriptContainer.vue` and its store/module dependencies.
- [ ] 5.4 Move AI chunk interaction ownership into `ChunkModeView.vue` and its store/module dependencies.
- [ ] 5.5 Move cloze interaction ownership into `ClozeQuizView.vue` / `ClozeCard.vue` and cloze store/module dependencies.
- [ ] 5.6 Remove legacy render facades only after no caller depends on them.
- [ ] 5.7 Treat any `index.html` script order change as a standalone task and run full verification immediately after.
- [ ] 5.8 Run `npm test`, `npm run verify:playback`, `npm run verify:interactions`, and `npm run build`.

## 6. Phase 5 - Root Script and Entry Cleanup

- [ ] 6.1 Audit consumers of `chunk-note-layout-helpers.js` and migrate it into the Vite module graph if no regular script semantics remain necessary.
- [ ] 6.2 Audit consumers of `chunk-note-layout-core.js` and migrate it into the Vite module graph if no regular script semantics remain necessary.
- [ ] 6.3 Audit consumers of `annotation-bubble.js` and migrate it into the Vite module graph if no regular script semantics remain necessary.
- [ ] 6.4 Audit consumers of `annotation-api-settings-ui.js` and migrate it into the Vite module graph if no regular script semantics remain necessary.
- [ ] 6.5 Remove root script tags from `index.html` only after their module replacements are loaded by Vite.
- [ ] 6.6 Remove `vite.config.js` legacy root script copy logic only after production build no longer needs those files copied.
- [ ] 6.7 Run `npm run build`, `npm test`, and production preview/load verification.

## 7. Phase 6 - Remove app.js

- [ ] 7.1 Confirm `index.html` no longer loads `app.js`.
- [ ] 7.2 Confirm no inline handler calls an `app.js` export.
- [ ] 7.3 Confirm no runtime module depends on `window.__state` as a real state source.
- [ ] 7.4 Confirm `window.__bridge` no longer participates in Vue/Pinia startup sync.
- [ ] 7.5 Delete unused `window.*` compatibility facades.
- [ ] 7.6 Delete `app.js`.
- [ ] 7.7 Remove stale documentation that describes `app.js` as the runtime center.
- [ ] 7.8 Run `npm test`, `npm run verify:playback`, `npm run verify:interactions`, `npm run build`, and a browser smoke test against `http://127.0.0.1:5173/`.

## 8. Archive Readiness

- [ ] 8.1 Verify `legacy-runtime-decomposition` requirements are satisfied.
- [ ] 8.2 Update `CURRENT_PROJECT_STATUS.md`, `README.md`, `PROJECT_MAP.md`, and `AGENTS.md` to describe the final architecture.
- [ ] 8.3 Archive this OpenSpec change only after `app.js` is removed or explicitly retained as an empty/near-empty bootstrap with documented reason.
