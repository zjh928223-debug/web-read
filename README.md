# Read-Web

Vite + Vue 3 + Pinia migration of a legacy browser-based language reading tool.

The app provides audio playback, synchronized transcript reading, AI chunk mode, marks, lightweight annotation workflows, and annotation API settings.

For the detailed current architecture and migration status, see `CURRENT_PROJECT_STATUS.md`.

## Current Status

This is a working hybrid app, not a clean Vue-only rewrite.

```text
legacy DOM shell + module-bound controls
        ->
src/composables/reader-runtime.js thin runtime entry
        ->
src/composables/reader-runtime-assembly.js remaining runtime assembly
        ->
src/composables/session-init.js thin session entry
        ->
src/composables/session-runtime-assembly.js thin session runtime assembly
        ->
window.__state / state adapters / Pinia bridge module compatibility
        ->
Pinia stores in src/pinia-stores
        ->
Vue components
```

Vue rendering is currently enabled by default through `window.__USE_VUE_RENDERING = true`, but many actions still go through legacy `window.xxx` functions and module-bound DOM event wiring.

## Cleanup Mode

The root `app.js` file has been removed as part of `complete-appjs-decomposition`. `src/composables/reader-runtime-shell.js` has been retired, and `src/composables/session-init.js` is now a thin entry that delegates to focused session runtime modules through `src/composables/session-runtime-assembly.js`.

- Do not add feature logic to `src/composables/reader-runtime.js`.
- Do not reintroduce `src/composables/reader-runtime-shell.js`.
- Do not change the IndexedDB schema without a separate migration.
- Do not reorder `index.html` scripts unless that change is isolated and fully verified.
- Treat `window.__state`, runtime `bridgeToPinia`, former `window.__bridge` expectations, and `window.*` exports as temporary compatibility surfaces.

## Quick Start

```bash
npm install
npm run dev
npm test
npm run build
```

Useful URLs:

- Dev server: `http://127.0.0.1:5173/`
- First-contact vocabulary preview: open `待预习` from the main reader. It shows one compact primary-meaning suggestion and at most one short authentic sentence. The sentence is selected through a versioned source registry; the current default provider uses Tatoeba text with sentence ID, author link, and `CC BY 2.0 FR` attribution. A Wordnik provider slot is reserved but disabled and inert until a resolver is explicitly supplied. If no sense-matched sentence passes the preview limits, the page shows no sentence instead of generating one with AI or falling back to a long IELTS paragraph.
- Standalone SRS review: `http://127.0.0.1:5173/srs-review.html` (uses the gitignored local snapshot)
- Verification server: `http://127.0.0.1:4173/`

## Optional Local Dictionary

ECDICT is an optional, read-only local dictionary. The Node SQLite service remains isolated from
reader and SRS business modules; browser code uses only the HTTP client, enrichment adapter, and
formatter. It enriches article-preview candidates in memory and can show transient assistance after
an SRS answer is revealed. It does not overwrite or persist Vocabulary Entry meanings or review
records; disabled or unavailable dictionary access remains fail-open.

`ECDICT_ENABLED` defaults to `false`. The Vite plugin module may load statically, but it registers no
endpoint while disabled; when enabled, the SQLite service is loaded lazily on the first lookup. See
`src/dictionary/ecdict/README.md` for setup and verification commands.

## Scripts

```bash
npm run dev          # Vite dev server
npm run build        # Vite production build
npm run verify:vite  # Playwright load check against the current root entry
npm run verify:vocab-matching # Focused vocab matching helper check
npm run verify:srs-review # Standalone/live SRS review queue, rating, retry, and fallback check
npm run verify:srs-review-ui-v2 # Acquisition-aware review policy and UI check
npm run verify:passage-preview # Passage Preview unit, live Aria, and browser checks
npm run verify:vocabulary-acquisition-service # Acquisition lifecycle service check
npm run verify:annotation-lightweight-module # Focused annotation lightweight glue check
npm run verify:keyboard-boundary # Focused keyboard boundary helper check
npm run verify:transcript-state # Focused transcript state adapter check
npm run verify:chunk-state # Focused chunk state adapter check
npm run verify:cloze-state # Focused cloze state adapter check
npm run verify:playback-state # Focused playback state adapter check
npm run verify:playback-runtime-helpers # Focused playback runtime helper check
npm run verify:state-facades # Focused window.__state owner facade check
npm run verify:bridge-startup # Focused adapter-to-Pinia startup check
npm run verify:file-input-bindings # Focused file picker DOM binding check
npm run verify:inline-handler-bindings # Focused remaining inline handler migration check
npm run verify:control-playback-state-deps # Focused controls/playback state dependency check
npm run verify:session-state-provider # Focused session-init state provider check
npm run verify:session-runtime-assembly # Focused thin session entry and session assembly guard
npm run verify:session-runtime-deps # Focused session runtime dependency collection check
npm run verify:session-lifecycle-runtime # Focused session lifecycle runtime assembly check
npm run verify:session-annotation-services # Focused session annotation service helper check
npm run verify:session-annotation-text # Focused session annotation text/context helper check
npm run verify:session-annotation-export-payload # Focused annotation lightweight export payload check
npm run verify:session-annotation-import-normalization # Focused annotation lightweight import normalization check
npm run verify:session-annotation-bundle-merge # Focused annotation lightweight bundle merge check
npm run verify:session-annotation-runtime # Focused session annotation runtime assembly check
npm run verify:session-annotation-generated-index # Focused generated annotation index runtime check
npm run verify:session-annotation-marks # Focused annotation marks rebuild/runtime check
npm run verify:session-annotation-context # Focused annotation document context check
npm run verify:session-annotation-lightweight-io # Focused annotation lightweight IO runtime check
npm run verify:session-annotation-api-settings-runtime # Focused annotation API settings runtime check
npm run verify:session-startup-cleanup # Focused session startup cleanup check
npm run verify:session-restore-runtime # Focused session restore runtime check
npm run verify:session-startup-runtime # Focused session startup orchestration check
npm run verify:session-ui-settings-restore # Focused session UI settings restore check
npm run verify:runtime-state-source # Focused runtime state source guard
npm run verify:reader-runtime-shell # Focused retired reader runtime assembly guard
npm run verify:reader-runtime-assembly # Focused reader runtime assembly sequence check
npm run verify:reader-runtime-context # Focused reader startup context composition check
npm run verify:reader-feature-runtime # Focused reader feature runtime composition check
npm run verify:reader-feature-runtime-deps # Focused reader feature runtime dependency assembly check
npm run verify:reader-bootstrap-runtime # Focused reader bootstrap runtime setup check
npm run verify:reader-runtime-deps # Focused reader runtime dependency collection check
npm run verify:reader-notes-session-runtime-deps # Focused reader notes/session runtime dependency assembly check
npm run verify:reader-notes-session-runtime # Focused reader notes/session runtime setup check
npm run verify:reader-notes-runtime # Focused reader notes runtime setup check
npm run verify:reader-session-runtime # Focused reader session runtime setup check
npm run verify:reader-interaction-runtime # Focused reader interaction runtime setup check
npm run verify:reader-playback-runtime # Focused reader playback runtime setup check
npm run verify:reader-controls-runtime # Focused reader controls runtime setup check
npm run verify:reader-keyboard-runtime # Focused reader keyboard runtime setup check
npm run verify:reader-app-runtime # Focused reader app runtime setup check
npm run verify:reader-import-runtime # Focused reader import runtime setup check
npm run verify:reader-runtime-helpers # Focused reader runtime helper extraction check
npm run verify:reader-dom-refs # Focused reader runtime DOM ref collection check
npm run verify:app-window-facades # Focused app.js duplicate window facade guard
npm run verify:pinia-bridge-module # Focused Pinia bridge module check
npm run verify:audio-store-facades # Focused DB compatibility facade check
npm run verify:keyboard-facades # Focused keyboard helper facade check
npm run verify:import-facades # Focused transcript/chunk import facade check
npm run verify:chunk-controls-module # Focused AI chunk controls module check
npm run verify:highlight-controls-module # Focused highlight controls module check
npm run verify:theme-controls-module # Focused theme controls module check
npm run verify:glass-effects # Focused glass effects module check
npm run verify:style-editor-module # Focused style editor module check
npm run verify:app-handlers # Focused app handlers module check
npm run verify:marks-store # Focused marks store ownership check
npm run verify:marks-state-module # Focused marks runtime state module check
npm run verify:visual-vocab-module # Focused visual vocab state module check
npm run verify:legacy-dom-drain # Focused removed legacy DOM lookup check
npm run verify:audio-identity-module # Focused audio identity state module check
npm run verify:hotkey-state-module # Focused hotkey runtime state module check
npm run verify:transcript-interactions # Focused normal transcript interaction check
npm run verify:chunk-interactions # Focused AI chunk interaction check
npm run verify:render-facades # Focused legacy render facade removal check
npm run verify:script-order # Focused index.html script order guard
npm run verify:annotation-bubble # Focused annotation bubble module check
npm run verify:annotation-api-settings-ui # Focused annotation API settings UI module check
npm run verify:legacy-root-copy # Focused legacy root copy removal check
npm run verify:production-preview # Production preview load check against dist
npm test             # Same as verify:vite
```

`read-26.html` no longer exists in the project root. Old `read26` script names are compatibility aliases only.

## Runtime Load Order

`index.html` currently loads:

```text
9 src/stores/*.js module compatibility stores
10 src/composables/*.js module compatibility/runtime modules
src/composables/reader-runtime.js module
src/composables/session-init.js module
/src/main.js Vue + Pinia module
```

The former root regular scripts now load through Vite module replacements and are no longer referenced by `index.html`:

```text
annotation-bubble.js
annotation-api-settings-ui.js
```

## Source Map

```text
src/
|-- main.js                    # Vue mount + Pinia adapter binding
|-- App.vue                    # Root component
|-- srs-review-main.js         # Standalone in-memory SRS review entry
|-- features/passage-preview/  # Isolated five-word local preview overlay
|-- features/srs-review/       # Shared review page, queue, context/audio, and CSS
|-- components/                # 5 Vue components
|-- pinia-stores/              # 9 real Pinia stores
|-- stores/                    # 9 legacy window compatibility stores
|-- composables/               # 78 moduleized legacy behavior chunks
|-- services/pronunciation/    # Strict Aria pronunciation client + Vite endpoint
|-- services/vocabulary/       # Vocabulary, acquisition, events, review policy, and UoW
|-- utils/                     # 11 utility ES modules
`-- services/annotation/       # 14 annotation pipeline ES modules
```

## Data Storage

IndexedDB schema is fixed:

```text
DB name: SeekPlayerDB
Version: 1
Store: files
Key path: id
```

The vocabulary SRS snapshot remains in that existing store under
`vocabulary.srs.store.v1`. The reader's `今日复习` overlay uses the normal
IndexedDB-backed vocabulary service. The standalone `/srs-review.html` entry
instead loads `src/features/srs-review/srs-review.sample.local.json` through an
in-memory repository; that personal snapshot is gitignored and standalone
ratings are discarded on reload.

The live review page builds a stable local-day queue and combines remaining
items with that day's existing `reviewLogs`, so reopening the page does not
shrink the displayed daily total. Its `复习记录` popover groups the existing
logs by local date and counts unique words; no additional store or DB migration
is used.

Review ratings use the four native FSRS levels with keyboard shortcuts `1-4`:
`忘记`, `困难`, `一般`, and `容易`. Recall mode exposes only `忘记` until the
answer is revealed; the other ratings become available after reveal.

The word panel prefers the concise context `simple_meaning` and omits the old
hint row. Previous/next controls (also arrow keys) provide read-only review of
completed Vocabulary Entries without creating duplicate ratings. `R 重读单词和原句` starts
the word/source sequence from the beginning by button or globally captured `R`.
Space globally and silently pauses or resumes active review audio without
adding pause UI. Every English word in the left context is clickable: timed
transcripts seek the original audio to that word, while text-only contexts use
an American system voice for the remaining sentence.

Context words keep a plain-text appearance and only scale slightly on hover.
The replay keycap can capture and persist a replacement single-character
shortcut; letter matching is case-insensitive, while Space and `1-4` remain
reserved. The low-emphasis reread control sits at the lower-right edge of the
word panel instead of mixing with the word and meanings. Stored SRS meanings
are labeled as contextual.

When review opens, `srs-review-meanings.js` sends only words missing a
`general_meaning` to the local workflow service in batches of at most 50. The
service reads Merriam-Webster Collegiate `shortdef` values, translates the
batch into concise Chinese with the saved Gemini credential, and returns both
the English definition and Chinese general meaning. The vocabulary service
writes these fields back into the existing `vocabulary.srs.store.v1` snapshot,
so future review sessions reuse them without another dictionary request. This
adds fields inside the existing row content and does not change IndexedDB
version or object stores.

Vocabulary acquisition and SRS review are now separate lifecycles. New candidates
enter versioned acquisition rows first; only an explicit, transaction-backed
graduation creates a review state. Learning attempts, review attempts, command
receipts, and the session ledger are stored as named or sharded rows inside the
existing `files` object store. Legacy implicit card creation remains behind a
flag-off compatibility adapter while callers migrate.

Passage Preview is an isolated local five-word vertical slice. It imports a
user-selected result package, keeps copyrighted source text in browser-local
storage, never creates a review state, and uses strict Microsoft Aria playback.
The Vite endpoint generates `en-US-AriaNeural` audio on demand; it does not read
preview data or change IndexedDB.

Dictionary parsing follows spelling cross-references such as `centre -> center`
and rejects geographical or biographical name entries. Versioned
`dictionary_source` values invalidate only older Merriam/Gemini results.
General meanings use primary black text; contextual meanings use muted gray
text.

## Personalized Vocabulary Learning Direction

The next vocabulary layer treats the learner as a model that is updated from
observed learning behavior, but it deliberately separates memory, knowledge
needs, and presentation preference:

- Preview is a single low-pressure exposure. It presents the word form, one
  primary sense, and one understandable validated sentence. It does not try to
  create same-day repetition or require immediate recall.
- FSRS remains the per-`LearningUnit` memory scheduler after graduation. A
  `LearningUnit` is a word plus one target sense, not an undifferentiated list
  of every dictionary meaning.
- A skill estimator derives weak areas such as part of speech, inflection,
  derivation, irregular forms, primary/secondary senses, collocation, and
  context transfer from append-only events.
- A constrained curriculum planner decides what must be learned. Weak,
  important skills receive coverage even when the learner dislikes them or
  often skips them.
- A preference model ranks only the presentation form, such as a minimal
  sentence, audio-first prompt, cloze, or later original context. It may make a
  required item easier to approach, but it may not remove required content.

Primary-sense selection is evidence based and deterministic. It combines a
learner-dictionary ordering, WordNet most-frequent-sense evidence, and
general/exam-corpus evidence, records disagreement, and leaves uncertain cases
unresolved. Whole-word frequency from ECDICT is useful metadata but cannot by
itself select a sense. Sentence candidates are provenance-first: user-owned
articles and subtitles plus redistributable open corpora are preferred. AI may
retrieve, rank, simplify a display gloss, or explain an example, but generated
text is not labeled as an authentic source sentence and the original evidence
is immutable.

Raw `LearningEvent` records remain the source of truth. Skill estimates,
preference estimates, reports, and plans are disposable derived state that can
be rebuilt when an algorithm changes. Every decision carries algorithm and
content versions; replacements first run in historical replay and shadow mode,
then behind a feature flag with a deterministic fallback. A new model must not
silently rewrite FSRS ratings, history, or all existing due dates.

The rollout is intentionally progressive: deterministic contracts and
baselines first, diagnostic and preference models in shadow mode second, and
bounded adaptive control only after enough cross-day evidence exists. The
detailed ownership, interfaces, rollout gates, and parallel task prompts are in
[`personalized-learning-parallel-plan.md`](openspec/changes/separate-vocabulary-acquisition-and-review/personalized-learning-parallel-plan.md).

Wave B shadow integration defaults to off. The **模型观察** page now owns a
versioned local **开始模型观察** switch; the review service reads that setting
dynamically whenever it creates a new V2 session. When enabled,
it reads immutable `LearningEvent` and acquisition snapshots only after the
formal review ledger has been persisted, builds a comparison report in the
background, and stores the rebuildable report in the existing `files` object
store row `vocabulary.personalization.shadow-reports.v1`. Shadow output and
failures never change the returned ledger, FSRS due dates, ratings, or review
state.

The read-only diagnostics page is available at
`/personalization-shadow.html` and from the review header's **模型观察** link.
It reads the latest reports from the same derived-cache row and explains queue
movement, weak-skill evidence, presentation preference, and insufficient-data
states. It intentionally exposes no publish, reorder, rating, or due-date write
action. If today's V2 ledger already exists, **补建今天报告** reconstructs only
the derived Shadow report from that frozen ledger and append-only events. It
does not write the ledger, ReviewState, due dates, ratings, or database schema.
If today's review uses only the legacy data source, the page reports that no V2
session is available instead of fabricating a report from legacy logs. Add
`?demo=1` for the deterministic visual/QA fixture; normal use reads local
IndexedDB reports and the local Shadow setting.

Do not change this schema without an explicit migration plan.

## Current High-Risk Areas

- `src/composables/reader-runtime.js` is now a thin runtime entry that directly initializes `src/composables/reader-runtime-assembly.js`; `src/composables/reader-runtime-assembly.js` owns the remaining runtime assembly and delegates direct `window.*` facade ownership, transcript, chunk, cloze, playback transient, reader startup context, reader feature runtime composition, reader feature runtime dependency assembly, reader bootstrap runtime, reader runtime dependency collection, reader notes/session runtime dependency assembly, reader notes/session runtime, reader notes runtime, reader session runtime, reader interaction runtime, reader playback runtime, reader controls runtime, reader keyboard runtime, reader app runtime, reader import runtime, reader runtime helpers, note state, visual/vocab matching state, audio identity state, hotkey runtime state, marks runtime state, and render compatibility behavior through focused adapters/modules.
- Transcript state now goes through `src/composables/transcript-state.js`, which binds directly to the real Pinia transcript store after Pinia creation.
- Chunk mode state now goes through `src/composables/chunk-state.js`, which binds directly to the real Pinia chunk store after Pinia creation.
- Cloze quiz state now goes through `src/composables/cloze-state.js`, which binds directly to the real Pinia cloze store after Pinia creation.
- `window.renderTranscript` and `window.renderChunkMode` have been removed; `session-init.js` uses `src/composables/render-runtime.js`, which owns the current Vue bridge render calls.
- Remaining legacy control inline handlers have been removed from `index.html`; `src/composables/legacy-control-bindings.js` now binds those DOM controls to existing compatibility functions.
- Playback transient state now goes through `src/composables/playback-state.js`; playback and controls modules receive their temporary state view through explicit init deps instead of reading `window.__state` directly.
- Playback helper behavior now goes through `src/composables/playback-runtime-helpers.js`; focused reader runtime modules inject its API into playback and controls modules, including sentence-mode previous/next jumps.
- `src/composables/session-init.js` is now a thin session entry that initializes `src/composables/session-runtime-assembly.js`.
- `src/composables/session-runtime-assembly.js` sequences session runtime deps, annotation runtime setup, lifecycle startup/restore/UI setup, public session facade handler wiring, and API settings initialization.
- `src/composables/session-runtime-deps.js` owns session runtime `window`/DOM/global dependency collection; it no longer installs temporary `window.__session_*` bridge facades.
- `src/composables/session-annotation-runtime.js` composes generated index refresh, annotation context, marks rebuild, lightweight annotation import/export, API settings, and annotation facade support for session startup.
- `src/composables/session-lifecycle-runtime.js` composes startup cleanup, persisted session restore, DB-ready startup orchestration, and UI settings restore for session startup.
- `src/composables/session-annotation-services.js` owns annotation service/global lookup helpers and diagnostics emit for session startup and annotation import/export code.
- `src/composables/runtime-state-facade.js` now owns the `runtimeState` object and exposes it as `window.__state` only as a temporary compatibility facade.
- `src/composables/runtime-state-bindings.js` now owns the `runtimeState` getter/setter bindings that preserve current `st.*` compatibility for startup/session code.
- `src/composables/reader-runtime-assembly.js` owns the runtime initialization sequence for context, notes/session, and feature runtime setup.
- `src/composables/reader-runtime-context.js` owns startup context composition for bootstrap state, DOM refs, focus/current-note helpers, and chunk note transfer dialog access.
- `src/composables/reader-feature-runtime.js` owns feature runtime composition for import, controls, interactions, keyboard, app handlers, and chunk note transfer handoff.
- `src/composables/reader-feature-runtime-deps.js` owns the large feature runtime dependency mapping from runtime context, bootstrap state, DOM refs, and notes/session wrappers.
- `src/composables/reader-dom-refs.js` now owns static reader runtime DOM ref collection; session annotation settings DOM setup is wired through `src/composables/session-annotation-runtime.js` and `src/composables/session-annotation-api-settings-runtime.js`.
- `src/composables/reader-bootstrap-runtime.js` owns initial state adapter references, DB compatibility wrappers, runtime helper collection, audio identity initialization, hotkey state initialization, and marks state initialization for the runtime assembly.
- `src/composables/reader-runtime-deps.js` owns runtime utility/global helper dependency collection for validation, import helpers, identity keys, playback indexes, chunk matching, and vocab matching.
- `src/composables/reader-notes-session-runtime-deps.js` owns notes/session runtime dependency mapping from runtime context, bootstrap state, DOM refs, and legacy global module owners.
- `src/composables/reader-notes-session-runtime.js` composes notes runtime setup with session-facing note/audio lifecycle wrappers for the runtime assembly.
- `src/composables/reader-notes-runtime.js` owns shared notes state, chunk/sentence notes API initialization, and Pinia bridge initialization for the runtime assembly.
- `src/composables/reader-session-runtime.js` owns the session-facing chunk/sentence note lifecycle wrappers and the `applyCurrentAudioMeta(...)` side-effect wrapper for the runtime assembly.
- `src/composables/reader-interaction-runtime.js` owns render runtime configuration and reader playback runtime initialization for the runtime assembly.
- `src/composables/reader-playback-runtime.js` owns annotation bubble resolver setup, playback helper setup, playback module initialization, and transcript/chunk interaction configuration.
- `src/composables/reader-controls-runtime.js` owns highlight/chunk/theme control initialization and style editor initialization for the runtime assembly.
- `src/composables/reader-keyboard-runtime.js` owns keyboard module initialization and injects hotkey, mark, chunk-note, and panel-close dependencies.
- `src/composables/reader-app-runtime.js` owns annotation lightweight controls, app handlers, controls loop, glass effects, and reader public facade initialization for the runtime assembly.
- `src/composables/reader-import-runtime.js` owns session facade/provider setup, visual vocab setup, runtime state bindings, chunk pipeline, and import handler initialization for the runtime assembly.
- `src/composables/reader-runtime-helpers.js` owns reader focus restore, current-note toggling, and chunk-note export dialog access helpers used by import/keyboard callers.
- Local audio identity and chunk note layout API aliases have been removed from `reader-runtime.js`; runtime assembly now injects those module APIs directly.
- `src/composables/session-facades.js`, `annotation-bubble-resolver.js`, `reader-public-facades.js`, `ui-facades.js`, and `render-mode.js` own the remaining public compatibility facade assignments previously made directly by root `app.js`; session runtime now injects session facade handlers directly instead of using `window.__session_*` bridge facades.
- `window.bridgeToPinia` now lives in `src/composables/pinia-bridge-module.js`.
- Duplicate app-level window facades for playback controls, speed, and chunk style controls have moved to their module owners.
- DB compatibility window facades now live in `src/stores/audio.js`, delegating through the current `window.__audioStore` implementation.
- Chunk note style compatibility facades have been removed with the chunk note UI.
- `window.isInputLikeTarget` now lives in `src/composables/keyboard-module.js`.
- `window.processTranscript` and `window.processChunkData` now live in `src/composables/import-module.js`.
- Highlight mode controls and the temporary `window.cycleHighlightMode` facade now live in `src/composables/highlight-controls-module.js`.
- AI chunk mode controls and their temporary window facades now live in `src/composables/chunk-controls-module.js`; focused reader runtime modules initialize the module and pass its API to keyboard/import callers.
- Theme control DOM bindings now live in `src/composables/theme-controls-module.js`; glass sizing setup and style editor parsing helpers are owned by `src/composables/glass-effects.js` and `src/composables/style-editor.js`.
- Marks import button binding now lives in `src/composables/app-handlers.js`; marks toggle behavior remains owned by `src/stores/marks.js`.
- Marks runtime state now lives in `src/composables/marks-state-module.js`; `session-init.js` still restores and rebuilds marks through the unchanged `st.markedMap` state field.
- Chunk note import/export, cloze import/rendering, and the old notes/definition hotkey have been removed from the active runtime.
- Chunk note runtime wrappers and thin keyboard/modal/layout/visual/save/snapshot/context-menu wrappers have been removed from the active runtime.
- Visual/vocab matching state and the temporary `window.processVisual` restore contract now live in `src/composables/visual-vocab-module.js`; `session-init.js` still calls `processVisual(visualData)`.
- Audio identity state and derived storage/doc-id helpers now live in `src/composables/audio-identity-module.js`; `src/composables/reader-session-runtime.js` owns the temporary `applyCurrentAudioMeta(...)` wrapper that preserves the chunk-note draft side effect, and `session-init.js` still calls that public contract unchanged.
- Hotkey runtime state now lives in `src/composables/hotkey-state-module.js`; `session-init.js` still restores persisted hotkeys through the unchanged `st.*Key` state fields.
- No-consumer `chunkNoteModalEl` and `chunkPointerDown` runtime state facades have been removed and are guarded by `verify:state-facades`.
- Absent legacy sidebar/notes DOM lookups and the dead `toggleSidebar()` path have been removed from `reader-runtime.js`.
- Sentence note runtime wrappers and thin sentence interaction wrappers have been removed from the active runtime. Notes facades now resolve to no-op compatibility APIs while callers are drained.
- Annotation lightweight import/export button glue lives in `src/composables/annotation-lightweight-module.js`; session-side payload/export/import/merge behavior now lives in `src/composables/session-annotation-*.js` and `src/composables/session-annotation-lightweight-io.js`, and its export/import handlers are injected explicitly.
- Annotation bubble DOM API now lives in `src/composables/annotation-bubble.js`; generated/vocab bubble hit resolution now lives in `src/composables/annotation-bubble-resolver.js`.
- Annotation API settings UI now lives in `src/composables/annotation-api-settings-ui.js`; session initialization reaches it directly through `src/composables/session-annotation-api-settings-runtime.js`.
- `src/stores/` and `src/pinia-stores/` both exist. The former is compatibility; the latter is real Pinia.
- Former root regular scripts are no longer loaded by `index.html` and are no longer copied by Vite.
