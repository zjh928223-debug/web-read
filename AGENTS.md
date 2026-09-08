# AGENTS.md - Read-Web Current Project Notes

## Canonical Workspace

`E:\read-web-next-optimization` is the only active implementation target for architecture optimization.
`E:\read-web-next` is the protected daily reader and may only be inspected for comparison until the
user explicitly approves promotion. Do not edit, build, launch, or commit from that protected tree.
`E:\read-web` is a read-only historical reference and may only be inspected when locating legacy
behavior for a deliberate migration. Do not edit, build, launch, or commit from the historical tree.

## Optimization Workspace Isolation

- Use `config/runtime.optimization.json` for manual optimization runs.
- Use frontend/backend ports `5184/8776`; never reuse the daily reader's `5174/8766`.
- Use `E:\ReadWebData\SubtitleWorkflow-Optimization`; never write to the daily reader data root.
- Start the optimization preview with `scripts/launch-optimization-preview.ps1`.
- Preserve the copied uncommitted WhisperX/language-processing work unless the user explicitly
  asks to change or discard it.

## What This Is

Read-Web is a Vite-hosted Vue 3 + Pinia migration of a legacy plain HTML/JS language-learning reader.

It supports audio playback, synchronized transcripts, AI chunk mode, marks, and lightweight annotation import/export. Manual chunk import, cloze quizzes, sentence/chunk note UI, note sidebars, annotation API settings, and the old notes/definition hotkey have been removed.

The codebase is still hybrid. Do not treat it as a clean Vue-only app.

## Current Entry Points

- `index.html` - browser entry and legacy DOM shell.
- `src/composables/reader-runtime.js` - thin runtime entry that imports side-effect modules and initializes runtime assembly.
- `src/composables/session-init.js` - thin session entry that initializes session runtime assembly.
- `src/composables/session-runtime-assembly.js` - thin session runtime assembly over focused modules.
- `src/main.js` - Vue mount, Pinia setup, adapter-to-Pinia binding, and compatibility delegation.

There is no `read-26.html` in the current root. Any script or doc that refers to it is legacy context.

## Actual Browser Load Order

Keep this order unless you are deliberately changing the architecture and have verified the full app:

```text
index.html
├── 9 src/composables/*.js module compatibility/runtime modules
└── /src/main.js as type="module" for Pinia setup, runtime imports, and Vue mount
```

`src/main.js` also imports the current utility modules, `src/composables/annotation-bubble.js`, and the annotation service modules for side effects and ES module exports.

## Runtime Architecture

The current state flow is:

```text
src/composables/reader-runtime.js thin runtime entry
  -> src/composables/reader-runtime-assembly.js remaining runtime assembly
  -> module-owned runtimeState getter/setter proxy
  -> module-owned pinia-bridge-module API
  -> src/pinia-stores/*.js real Pinia stores
  -> Vue components
```

Session startup flow is:

```text
src/composables/session-init.js thin session entry
  -> src/composables/session-runtime-assembly.js session assembly
  -> focused session-* modules for restore/startup/annotation import-export
  -> public session compatibility facades plus explicit annotation lightweight wiring
```

Non-component runtime store access is explicit:

```text
src/main.js -> configures src/pinia-stores/runtime-registry.js before importing reader/session runtime
```

The deleted `src/stores/` compatibility layer must not be reintroduced. Real Pinia definitions are under `src/pinia-stores/`.

## ECDICT Boundary

ECDICT lives under `src/dictionary/ecdict/`. Its Node SQLite service remains read-only and isolated
from reader, vocabulary, and SRS repositories. Browser runtime code may import only the local HTTP
client, enrichment adapter, and formatter. Article preview and the SRS answer-reveal area use those
browser modules for transient suggestions. The review page receives its client through a prop and
keeps only a session-memory cache; neither flow persists results or replaces existing meanings.

`ECDICT_ENABLED` defaults to `false`. `vite.config.mjs` may statically import the plugin module, but the
disabled plugin registers no endpoint and does not access the database. When enabled, the SQLite
service loads lazily on the first query.

## Current Rendering State

Vue is the only current transcript/chunk rendering path. The legacy `#transcript-container`
shell remains as a hidden compatibility anchor for adapters that still need its element; the
retired `window.__USE_VUE_RENDERING` switch is no longer part of runtime state.

The Vue components are active but thin. A lot of interaction still relies on
`src/composables/reader-runtime-assembly.js` runtime assembly, focused `window.xxx`
compatibility facades, `src/composables/legacy-control-bindings.js`, and legacy DOM behavior.

## Important Files

- `src/composables/reader-runtime.js` - about 28 lines. Thin runtime entry and side-effect import chain.
- `src/composables/reader-runtime-assembly.js` - about 51 lines. High risk. Remaining runtime assembly and compatibility wiring.
- `src/composables/runtime-state-facade.js` - module-owned `runtimeState` owner.
- `src/composables/runtime-state-bindings.js` - `runtimeState` getter/setter binding layer for current `st.*` compatibility.
- `src/composables/session-annotation-services.js` - annotation service/global lookup helpers and diagnostics emit used by session runtime modules.
- `src/composables/session-init.js` - about 7 lines. Thin session entry only.
- `src/composables/session-runtime-assembly.js` - about 61 lines. Session assembly over focused modules.
- `src/composables/session-runtime-adapters.js` - behavior-bearing annotation/lifecycle adapters that privately resolve session DOM/global dependencies.
- `src/composables/session-annotation-runtime.js` - annotation runtime assembly over generated index, context, marks, and lightweight IO modules.
- `src/composables/session-lifecycle-runtime.js` - about 102 lines. Startup cleanup, persisted restore, DB-ready startup, and UI settings restore assembly.
- `src/composables/session-annotation-text.js` - annotation text normalization, sentence splitting, and context sentence resolution.
- `src/composables/session-annotation-export-payload.js` - lightweight annotation export payload construction.
- `src/composables/session-annotation-import-normalization.js` - lightweight annotation import item normalization and target matching.
- `src/composables/session-annotation-bundle-merge.js` - lightweight annotation generated/status bundle merge.
- `src/composables/session-annotation-generated-index.js` - generated annotation scope/index refresh runtime.
- `src/composables/session-annotation-marks.js` - annotation mark normalization, encoded target parsing, and mark rebuild runtime.
- `src/composables/session-annotation-context.js` - annotation document context and target collection runtime.
- `src/composables/session-annotation-lightweight-io.js` - session-side lightweight annotation import/export IO runtime.
- `src/composables/session-restore-runtime.js` - persisted session restore runtime.
- `src/composables/session-startup-runtime.js` - DB-ready startup orchestration.
- `src/composables/session-startup-cleanup.js` - startup/persisted cleanup runtime.
- `src/composables/session-ui-settings-restore.js` - persisted UI/hotkey settings restore.
- `src/composables/reader-feature-runtime.js` - feature runtime composition for import, controls, interactions, keyboard, app handlers, and annotation controls.
- `src/composables/reader-feature-runtime-deps.js` - feature runtime dependency assembly for runtime context and bootstrap state.
- `src/composables/reader-runtime-context.js` - startup context composition for bootstrap state, DOM refs, focus helpers, and retired transfer dialog compatibility access.
- `src/composables/reader-dom-refs.js` - static reader runtime DOM ref collection.
- `src/composables/reader-bootstrap-runtime.js` - state adapter references, DB compatibility wrappers, runtime helper collection, audio identity, hotkey state, and marks state bootstrap.
- `src/composables/reader-runtime-deps.js` - runtime utility/global helper dependency collection.
- Notes UI/runtime and its no-op compatibility chain are retired. `applyCurrentAudioMeta(...)` is owned by `audio-identity-module.js`.
- `src/composables/reader-interaction-runtime.js` - render runtime configuration and reader playback runtime initialization.
- `src/composables/reader-playback-runtime.js` - annotation bubble resolver, playback helper, playback module, and transcript/chunk interaction setup.
- `src/composables/reader-controls-runtime.js` - highlight/chunk/theme control setup and style editor init.
- `src/composables/reader-keyboard-runtime.js` - keyboard module setup with mark, annotation bubble, AI chunk, seek, and panel-close injected handlers.
- `src/composables/reader-app-runtime.js` - annotation lightweight controls, app handlers, controls loop, glass effects, and reader public facade setup.
- `src/composables/reader-import-runtime.js` - session facade/provider setup, visual vocab setup, runtime state bindings, chunk pipeline, and audio/transcript import handler initialization.
- `src/composables/reader-runtime-helpers.js` - focus restore and retired transfer dialog helper runtime.
- `src/composables/session-facades.js` - public session/annotation facade stubs backed by injected session runtime handlers.
- `src/composables/reader-public-facades.js` - remaining reader public facade assignments.
- `src/composables/annotation-bubble-resolver.js` - generated/vocab annotation bubble hit resolution.
- `src/composables/ui-facades.js` - early toast/error facade owner.
- `src/composables/pinia-bridge-module.js` - explicit module bridge into configured Pinia stores.
- `src/composables/chunk-controls-module.js` - AI chunk mode controls and temporary chunk control window facades.
- `src/composables/highlight-controls-module.js` - highlight mode controls and temporary highlight window facade.
- `src/composables/theme-controls-module.js` - theme control DOM bindings.
- `src/composables/glass-effects.js` - glass UI decoration setup.
- `src/composables/style-editor.js` - visual style editor and local style parsing helper.
- `src/composables/app-handlers.js` - mark import/export handlers.
- `src/composables/visual-vocab-module.js` - visual vocab state and temporary `window.processVisual` compatibility owner.
- `src/composables/audio-identity-module.js` - audio meta/key state and derived storage/doc-id helper owner.
- `src/composables/hotkey-state-module.js` - hotkey runtime state owner.
- `src/composables/marks-state-module.js` - marks runtime state owner.
- `src/composables/playback-runtime-helpers.js` - playback helper behavior and sentence jump owner.
- `src/composables/session-init.js` - thin session entry only. Do not add feature logic here.
- `src/main.js` - Vue/Pinia mount plus adapter-to-Pinia binding.
- `src/pinia-stores/` - 8 real Pinia stores.
- `src/pinia-stores/runtime-registry.js` - explicit store access for non-component runtime modules.
- `src/services/annotation/` - 14 ES modules for generated annotation flow.
- Former root annotation/chunk-note artifacts were deleted after the module migration; see `docs/architecture/legacy-deletion-inventory.json` and `npm run verify:legacy-deletion` for the evidence gate.
- `styles.css` - global CSS loaded directly by `index.html`.

## Hard Constraints

### Review Loop and Verification Scope

- A verifier may validate artifact structure, referenced-file existence, checksums, and explicit
  status rules. It must not grow into a second implementation that attempts to infer whether a
  real browser, restart, network path, or user journey actually occurred from arbitrary log text.
- Define review acceptance criteria before implementation. Review findings must map to those
  criteria or to a concrete P0-P2 product/data/rollback failure; a new review must not invent an
  expanding adversarial specification.
- After two consecutive fix/re-review failures on the same task, stop automatic iteration. Reassess
  the task boundary and ask the user whether to simplify, split, or continue. Do not silently start
  a third fix loop.
- Treat a support script growing beyond roughly 500 lines or more than twice its reviewed baseline
  as a scope warning. Pause and justify the added complexity before continuing.
- For manual or cross-machine acceptance, automation may reject obviously invalid evidence but may
  never declare that static fixtures prove the real journey. The assigned independent review remains
  responsible for interpreting real evidence.

See `docs/architecture/review-loop-and-evidence-validation-lessons.md` for the F-004 retrospective
and the required stop rules for future OpenSpec execution.

### Cleanup Mode

`complete-appjs-decomposition` has been completed and archived under `openspec/changes/archive/2026-06-18-complete-appjs-decomposition/`. Current cleanup context comes from `CURRENT_PROJECT_STATUS.md` and the active spec at `openspec/specs/legacy-runtime-decomposition/spec.md`.

Do not add feature logic to `src/composables/reader-runtime.js`; do not reintroduce `src/composables/reader-runtime-shell.js`. Treat `window.__state`, runtime `bridgeToPinia`, former `window.__bridge` expectations, and `window.*` exports as compatibility surfaces to retire. Migrate one boundary at a time, keep compatibility only until callers move, and run the required verification before starting the next boundary.

### IndexedDB Schema

Do not change the IndexedDB schema unless the user explicitly asks for a migration.

```text
DB name: SeekPlayerDB
Version: 1
Object store: files
Key path: id
```

### Script Order

Do not reorder `index.html` scripts casually. The app still uses globals and side effects for compatibility.

### reader-runtime.js

Do not add new feature logic to `src/composables/reader-runtime.js`; do not reintroduce `src/composables/reader-runtime-shell.js`. Prefer focused modules, Pinia stores, or Vue components, but respect existing runtime compatibility callers while migrating those callers away.

### session-init.js

Do not add feature logic to `src/composables/session-init.js`. It is a thin entry; put session behavior in focused `session-*` modules and wire it through `src/composables/session-runtime-assembly.js`.

## Commands

```bash
npm run dev          # Vite dev server, port 5173
npm run build        # Production build
npm run verify:vite  # Starts Vite on 127.0.0.1:4173 and runs Playwright load check
npm run verify:annotation-lightweight-module  # Focused annotation lightweight glue check
npm run verify:keyboard-boundary  # Focused keyboard boundary helper check
npm run verify:transcript-state  # Focused transcript state adapter check
npm run verify:chunk-state  # Focused chunk state adapter check
npm run verify:cloze-state  # Focused cloze state adapter check
npm run verify:playback-state  # Focused playback state adapter check
npm run verify:playback-runtime-helpers  # Focused playback runtime helper check
npm run verify:state-facades  # Focused window.__state owner facade check
npm run verify:bridge-startup  # Focused adapter-to-Pinia startup check
npm run verify:file-input-bindings  # Focused file picker DOM binding check
npm run verify:inline-handler-bindings  # Focused remaining inline handler migration check
npm run verify:control-playback-state-deps  # Focused controls/playback state dependency check
npm run verify:session-state-provider  # Focused session-init state provider check
npm run verify:session-runtime-assembly  # Focused thin session entry and session assembly guard
npm run verify:session-runtime-adapters  # Focused session runtime adapter behavior check
npm run verify:session-lifecycle-runtime  # Focused session lifecycle runtime assembly check
npm run verify:session-annotation-services  # Focused session annotation service helper check
npm run verify:session-annotation-text  # Focused session annotation text/context helper check
npm run verify:session-annotation-export-payload  # Focused annotation lightweight export payload check
npm run verify:session-annotation-import-normalization  # Focused annotation lightweight import normalization check
npm run verify:session-annotation-bundle-merge  # Focused annotation lightweight bundle merge check
npm run verify:session-annotation-runtime  # Focused session annotation runtime assembly check
npm run verify:session-annotation-generated-index  # Focused generated annotation index runtime check
npm run verify:session-annotation-marks  # Focused annotation marks runtime check
npm run verify:session-annotation-context  # Focused annotation document context check
npm run verify:session-annotation-lightweight-io  # Focused annotation lightweight IO runtime check
npm run verify:session-startup-cleanup  # Focused startup cleanup runtime check
npm run verify:session-restore-runtime  # Focused persisted session restore runtime check
npm run verify:session-startup-runtime  # Focused DB-ready startup orchestration check
npm run verify:session-ui-settings-restore  # Focused persisted UI settings restore check
npm run verify:runtime-state-source  # Focused runtime state source guard
npm run verify:reader-runtime-shell  # Focused retired reader runtime assembly guard
npm run verify:reader-runtime-assembly  # Focused reader runtime assembly sequence check
npm run verify:reader-runtime-context  # Focused reader startup context composition check
npm run verify:reader-feature-runtime  # Focused reader feature runtime composition check
npm run verify:reader-feature-runtime-deps  # Focused reader feature runtime dependency assembly check
npm run verify:reader-bootstrap-runtime  # Focused reader bootstrap runtime setup check
npm run verify:reader-runtime-deps  # Focused reader runtime dependency collection check
npm run verify:reader-interaction-runtime  # Focused reader interaction runtime setup check
npm run verify:reader-playback-runtime  # Focused reader playback runtime setup check
npm run verify:reader-controls-runtime  # Focused reader controls runtime setup check
npm run verify:reader-keyboard-runtime  # Focused reader keyboard runtime setup check
npm run verify:reader-app-runtime  # Focused reader app runtime setup check
npm run verify:reader-import-runtime  # Focused reader import runtime setup check
npm run verify:reader-runtime-helpers  # Focused reader runtime helper extraction check
npm run verify:reader-dom-refs  # Focused reader runtime DOM ref collection check
npm run verify:app-window-facades  # Focused app.js duplicate window facade guard
npm run verify:pinia-bridge-module  # Focused Pinia bridge module check
npm run verify:audio-store-facades  # Focused DB compatibility facade check
npm run verify:keyboard-facades  # Focused keyboard helper facade check
npm run verify:import-facades  # Focused transcript/chunk import facade check
npm run verify:chunk-controls-module  # Focused AI chunk controls module check
npm run verify:highlight-controls-module  # Focused highlight controls module check
npm run verify:theme-controls-module  # Focused theme controls module check
npm run verify:glass-effects  # Focused glass effects module check
npm run verify:style-editor-module  # Focused style editor module check
npm run verify:app-handlers  # Focused app handlers module check
npm run verify:marks-store  # Focused marks store ownership check
npm run verify:marks-state-module  # Focused marks runtime state module check
npm run verify:notes-wrapper-drain  # Focused unused notes runtime wrapper check
npm run verify:visual-vocab-module  # Focused visual vocab state module check
npm run verify:legacy-dom-drain  # Focused removed legacy DOM lookup check
npm run verify:audio-identity-module  # Focused audio identity state module check
npm run verify:hotkey-state-module  # Focused hotkey runtime state module check
npm run verify:transcript-interactions  # Focused normal transcript interaction check
npm run verify:chunk-interactions  # Focused AI chunk interaction check
npm run verify:render-facades  # Focused legacy render facade removal check
npm run verify:script-order  # Focused index.html script order guard
npm run verify:annotation-bubble  # Focused annotation bubble module check
npm run verify:ui-compatibility-store  # Focused UI Pinia owner and retired compatibility store behavior check
npm run verify:legacy-deletion  # Focused root artifact/legacy flag deletion gate
npm run verify:legacy-root-copy  # Focused legacy root copy removal check
npm run verify:production-preview  # Production preview load check against dist
npm test             # Full repository verification (same execution graph as verify:full)
```

Use `verify:vite` for the current Vite load and interaction verification.

## Documentation Status

Use this file, `README.md`, and `PROJECT_MAP.md` as current architecture references. `ES_MODULE_PLAN.md` is historical planning context unless explicitly updated.
