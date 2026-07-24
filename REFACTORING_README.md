# Read-Web Refactoring Program README

> **For agentic workers:** This document is the governing program plan for the Read-Web refactor. Do not interpret it as permission to rewrite the whole application in one change. Complete the phases in order, satisfy every exit gate, and create a focused OpenSpec change plus a task-level implementation plan before modifying a new architectural boundary.

**Document date:** 2026-07-11 (Asia/Shanghai)

**Goal:** Turn the current working but structurally inconsistent hybrid reader into a coherent product with one verified baseline, explicit product boundaries, a stable application shell, predictable overlay behavior, one visual system, and an incremental migration path that preserves existing behavior.

**Architecture direction:** Keep the existing Vue 3 + Pinia hybrid runtime operational while product structure and DOM ownership are clarified. UI work must migrate one boundary at a time through existing compatibility APIs. Runtime compatibility cleanup happens after callers have moved, not during broad visual changes.

**Tech stack:** Vite, Vue 3, Pinia, JavaScript ES modules, legacy compatibility modules, IndexedDB, a local FastAPI Subtitle Workflow service, Playwright/Node verification scripts, and OpenSpec.

---

## 1. How to use this document

This is a program-level refactoring README for models or engineers who do not yet know the project. It provides:

- the historical and architectural background needed to avoid destructive assumptions;
- the current Git/PR baseline problem;
- the product and UI problems already observed;
- hard technical and data constraints;
- the required phase order from baseline convergence through OpenSpec decomposition;
- detailed work, deliverables, acceptance criteria, and exit gates for every phase;
- the handoff protocol for turning approved phases into small implementation changes.

This document does **not** provide permission to:

- rewrite the application as a clean Vue SPA in one pass;
- merge both Draft PRs wholesale;
- alter the IndexedDB schema;
- reorder script loading casually;
- remove compatibility facades before their callers move;
- restore retired cloze or notes features;
- begin SRS/review product work as part of this refactor;
- combine visual redesign, state migration, backend integration, and facade removal in one PR.

Before starting any work, read these files in this order:

1. `AGENTS.md`
2. `REFACTORING_README.md` (this document)
3. `CURRENT_PROJECT_STATUS.md`
4. `PROJECT_MAP.md`
5. `README.md`
6. `docs/design/precision-reading-utility.md`
7. the active OpenSpec artifacts for the change being worked on

Some current project documents predate the July workflow/SRS additions and contain stale file counts or references. When documents conflict, verify against the actual checkout and record the discrepancy instead of silently choosing one description.

---

## 2. Project background

### 2.1 Product evolution

Read-Web began as a browser-based English listening and reading tool. The original product loaded local audio and transcript JSON, synchronized playback with words and sentences, supported normal transcript and AI chunk modes, and exposed learning controls through a dense single-page toolbar.

The implementation originally relied on:

- a single HTML/JavaScript application;
- direct DOM mutation;
- shared global variables;
- `window.*` functions;
- script load order and side effects.

The 2026 migration did not replace the legacy application in one rewrite. It gradually added Vite, Vue 3, Pinia, ES modules, focused runtime modules, and compatibility facades while preserving behavior.

The product later expanded from a local reader into a local learning workstation:

```text
YouTube or existing local material
        ->
Subtitle Workflow (download, transcription, chunking, translation, artifacts)
        ->
Reader (audio/video, transcript/chunk, marks)
        ->
Annotation and preview vocabulary workflows
        ->
Article vocabulary settlement
```

SRS storage and scheduling foundations exist, but the SRS/review product is deliberately deferred from this refactor. See Section 6.

### 2.2 Important history

The historical sequence that matters for the refactor is:

- **2026-04:** annotation, generated-result, chunk, and helper boundaries were developed through OpenSpec changes.
- **2026-05:** Vite/Vue/Pinia migration phases established Vue rendering while retaining legacy behavior and compatibility stores.
- **2026-05 to 2026-06-18:** the root `app.js` monolith was decomposed into focused composables and services.
- **2026-06-18:** `complete-appjs-decomposition` was archived.
- **2026-06-20:** `reader-runtime-shell.js` was retired.
- **2026-06-21:** the session runtime assembly was split into focused session modules.
- **2026-06-23 onward:** the YouTube/material workflow, recent reading, history, maintenance, local service integration, and annotation backfill were added.
- **2026-07-09 to 2026-07-11:** video playback, vocabulary foundations, preview vocabulary, article settlement, meaning refinement, and additional UI work were added on the Draft branches.

The result is a functional hybrid application, not a clean Vue-only application.

---

## 3. Current Git and PR reality

### 3.1 Branches at the document date

At the time this document was written:

| Branch | Commit | Role |
|---|---|---|
| `main` | `2df89d3` | Pre-workflow cleanup baseline |
| `codex/youtube-material-workflow` | `5b7a31f` | Draft PR #1; current frontend, workflow UI history, annotations, video, vocabulary/article settlement |
| `codex/next-feature-20260629` | `dfb2f67` | Draft PR #2; Subtitle Workflow backend plus an alternative workflow/video/UI snapshot |

Draft PR links:

- PR #1: `https://github.com/zjh928223-debug/web-read/pull/1`
- PR #2: `https://github.com/zjh928223-debug/web-read/pull/2`

The branches share merge-base:

```text
1bfbe46 Persist reader marks on annotation changes
```

After that merge-base, PR #1 has five unique commits and PR #2 has one unique commit. Both modify a shared set of UI/runtime files, including:

- `index.html`
- `styles.css`
- `src/App.vue`
- `src/components/YouTubeWorkflowPanel.vue`
- `src/components/VideoPlayerFloat.vue`
- `src/composables/media-source-module.js`
- workflow client/loader modules
- reader playback/runtime modules
- startup and verification scripts

Do not treat these PRs as two independent patches.

### 3.2 Current non-self-contained runtime

The current `codex/youtube-material-workflow` checkout contains the newer frontend and learning UI, but its startup script points to the backend in the other worktree:

```text
E:\read-web-worktrees\next-feature-20260629\tools\subtitle-workflow
```

The running `/api/health` response at analysis time reported that same external `workflowRoot`.

Therefore, PR #1 is not currently a self-contained product baseline. Deleting the PR #2 worktree would remove the backend source used by PR #1.

### 3.3 Governing baseline recommendation

Use this recommendation unless Phase 0 evidence disproves it:

> Use PR #1 as the frontend, current learning-capability, and visual baseline. Integrate the Subtitle Workflow backend and verified missing backend/startup behavior from PR #2. Do not merge or cherry-pick PR #2's shared UI/runtime changes wholesale.

This is a recommendation, not a substitute for the Phase 0 file-by-file integration matrix.

Before implementation, re-check remote PR heads and local branch heads. If they changed after the document date, update the matrix and the baseline decision.

---

## 4. Current runtime architecture

### 4.1 Browser startup flow

The real startup path is hybrid:

```text
index.html
  -> legacy DOM shell and fixed DOM ids
  -> src/stores/* compatibility stores
  -> src/composables/* compatibility/runtime modules
  -> src/composables/reader-runtime.js (thin entry)
  -> src/composables/reader-runtime-assembly.js
  -> src/composables/session-init.js (thin entry)
  -> src/composables/session-runtime-assembly.js
  -> runtimeState / window.__state / window facades
  -> Pinia stores in src/pinia-stores
  -> src/main.js and Vue components
```

Vue rendering is enabled by default, but many actions still travel through compatibility functions or DOM-bound modules.

### 4.2 Current UI ownership types

The interface currently has at least four ownership models:

1. Static legacy DOM in `index.html`.
2. Vue components mounted through `src/App.vue`.
3. Command-style DOM created by composables, such as annotation and vocabulary dialogs.
4. Vue Teleports into legacy `.controls` or `document.body`.

This mixed ownership is a primary refactor risk. A visual move can break DOM queries, event binding, initialization order, facade calls, or persistence behavior even when business logic is unchanged.

### 4.3 High-risk UI files at the document date

Approximate current sizes:

| File | Size | Why it matters |
|---|---:|---|
| `styles.css` | 4,700 lines | Legacy, glass, PRU, overlays, workflow, annotation, and vocabulary styles share one cascade |
| `src/components/YouTubeWorkflowPanel.vue` | 2,290 lines | Navigation, requests, state, window geometry, playback tracking, mark sync, history, settings |
| `src/composables/annotation-backfill-ai-module.js` | 1,517 lines | Dialog UI, annotation requests, history, imports, dormant inline SRS code |
| `src/composables/vocabulary-preview-module.js` | 1,193 lines | Preview dialog, highlighting, article settlement UI, persistence, AI refinement |
| `src/components/VideoPlayerFloat.vue` | 271 lines | Independent draggable/resizable utility window |

Do not split these files mechanically by line count. Split them only after product boundaries and UI ownership are approved.

### 4.4 State reality

Real Pinia stores exist under `src/pinia-stores`, while compatibility stores live under `src/stores`. Production code still uses:

- `window.__state`;
- `window.__piniaStores`;
- `window.__audioStore`, `window.__marksStore`, and other store facades;
- `window.__mediaSource`;
- reader/session public facades;
- DOM ids as compatibility contracts.

Do not assume a Vue component can replace an old control by reading Pinia alone. Existing actions may still require facade calls to preserve side effects and persistence.

---

## 5. Data and security boundaries

### 5.1 IndexedDB schema

The browser database is fixed:

```text
Database: SeekPlayerDB
Version: 1
Object store: files
Key path: id
```

Do not change the schema without a separately approved migration.

Reader state, marks, annotation data, vocabulary data, article settlement progress, and compatibility storage records currently share this object store through different record ids.

### 5.2 Subtitle Workflow data

The local service data root is:

```text
E:\ReadWebData\SubtitleWorkflow
```

Generated media, workflow state, logs, caches, credentials, and user data must remain outside Git.

### 5.3 Credentials

API keys are not repository content. The UI may use a session value or system credential storage. Never:

- commit a key;
- place a real key in screenshots or documentation;
- copy a key into a test fixture;
- expose a key in a generated report;
- move credential ownership into frontend source code.

---

## 6. Refactor scope

### 6.1 In scope

- branch and backend/frontend baseline convergence;
- current capability inventory and documentation correction;
- product model and terminology;
- Materials, Reader Workspace, Learning Tools, and Settings/Diagnostics boundaries;
- application shell and navigation;
- reader control hierarchy;
- empty, loading, offline, unavailable, and error states;
- overlay/window classification, focus, Escape, drag/resize, z-index, and coexistence rules;
- consolidation around the existing Precision Reading Utility direction;
- DOM ownership and compatibility migration design;
- focused OpenSpec changes and incremental execution gates.

### 6.2 SRS is deferred

The following are explicitly outside this refactor:

- design of the SRS library;
- FSRS scheduling behavior;
- due-review lists;
- Again/Hard/Good/Easy review UI;
- vocabulary/SRS schema changes;
- enabling or deleting the dormant inline-SRS flow;
- redesigning vocabulary entry statuses or review state transitions.

The visible controls `预习生词`, `显示预习词`, and `已学完本篇` / `整理本篇生词` must still be included in the capability and control-placement inventories so they are not lost. Their SRS internals remain frozen. During this refactor they may be assigned a stable Learning Tools location, but their data behavior must not be redesigned.

### 6.3 Retired features that must stay retired

Do not restore these features unless a separate product proposal explicitly approves them:

- manual AI chunk JSON import UI;
- cloze quiz import/rendering UI;
- the old notes/definition hotkey;
- chunk note bubble/import/export/style UI;
- sentence note sidebar runtime;
- root `app.js`;
- `read-26.html`;
- `reader-runtime-shell.js`.

---

## 7. Observed product and UI problems

These findings explain why the program order starts with baseline and product structure rather than visual polish.

### 7.1 Initial shell

In a 1280x720 observation with no article loaded:

- the page exposed 25 visible buttons and 6 disabled buttons;
- the application had no visible heading;
- the Vue reading area had no meaningful empty-state content;
- app-level, playback, mode, data, annotation, vocabulary, style, and hotkey controls appeared as peers;
- the theme control visually competed with the legacy file entry;
- controls remained visible even when no current article made them useful.

### 7.2 Materials is an application inside the application

`YouTubeWorkflowPanel.vue` has its own header, navigation, pages, settings, status, window geometry, and persistence, but it appears as a floating panel over the reader. This creates two simultaneous shells:

- the legacy reader shell;
- the Materials mini-application shell.

The Materials pages are locally clearer than the reader toolbar, but their role in the whole product is unclear.

### 7.3 Duplicate or unclear product concepts

- `最近` and `历史` display many of the same materials with different metadata and actions.
- model and credential controls appear in both `添加` and `设置`.
- `已学完本篇` opens vocabulary settlement rather than simply recording article completion.
- `显示预习词` is a display toggle but appears as a peer learning action.
- settings, state, toggles, and one-shot actions frequently use the same button treatment.

### 7.4 Overlay behavior is numeric rather than semantic

Current layers use several independent z-index ranges, including workflow, video, annotation, vocabulary, chunk style, theme, and toast layers. The application lacks one shared overlay/window manager or an approved coexistence matrix.

Observed accessibility risks include:

- the Materials dialog did not declare `aria-modal` at the inspected root;
- background controls were not inert or `aria-hidden`;
- focus remained on the opener after the panel opened;
- keyboard shortcut behavior across overlapping surfaces is not centrally defined.

### 7.5 Design-system reality

The project already contains a detailed Precision Reading Utility specification and `--pru-*` tokens. The problem is not the absence of design thinking. The problem is coexistence of:

- legacy variables and selectors;
- glass-system variables and broad global rules;
- PRU variables and later overrides;
- repeated selectors for the same workflow surfaces;
- independent overlay styles.

The refactor must consolidate the existing direction, not invent a fourth visual system.

---

## 8. Non-negotiable engineering constraints

Every phase and child OpenSpec change inherits these constraints:

1. Do not change the IndexedDB schema without a separate migration proposal.
2. Do not casually reorder scripts in `index.html`.
3. Keep `src/composables/reader-runtime.js` a thin entry.
4. Keep `src/composables/session-init.js` a thin entry.
5. Do not recreate `src/composables/reader-runtime-shell.js`.
6. Treat `window.__state`, bridge/facade APIs, compatibility stores, and DOM ids as migration surfaces, not permanent architecture and not disposable clutter.
7. Move one boundary at a time and verify before starting the next boundary.
8. Do not combine broad visual work with runtime/state cleanup in one change.
9. Preserve current user behavior unless the approved product specification explicitly changes it.
10. Preserve unrelated user changes in a dirty worktree.
11. Do not commit generated materials, credentials, logs, caches, or local workflow state.
12. Do not reintroduce retired features through visual cleanup.
13. Keep SRS/review work outside this program.

---

## 9. Program order and gates

The required sequence is:

```text
Phase 0: Baseline convergence
    -> Gate 0: one self-contained, verified baseline
Phase 1: Product model
    -> Gate 1: approved product regions, journeys, terms, and states
Phase 2: Information architecture
    -> Gate 2: approved shell, navigation, controls, and empty states
Phase 3: Overlay rules
    -> Gate 3: approved overlay taxonomy and coexistence behavior
Phase 4: Design-system convergence
    -> Gate 4: approved tokens, primitives, and reference surfaces
Phase 5: Technical migration design
    -> Gate 5: approved ownership map, compatibility plan, waves, and verification
Phase 6: OpenSpec decomposition
    -> Gate 6: small independent changes ready for implementation planning
Implementation begins only after the relevant gate passes.
```

Do not skip ahead because a later phase appears easier or more visible.

---

# Phase 0: Baseline convergence

## Objective

Establish one source of truth that is self-contained, reproducible, and protected by a capability/verification baseline.

## 0.1 Re-check branch evidence

### Work

- Fetch or inspect current remote branch heads without modifying working files.
- Record `main`, PR #1, and PR #2 head commits.
- Recompute the merge-base.
- Recompute unique commit counts.
- Generate a list of post-base files for each branch.
- Generate the shared post-base overlap list.
- Record whether GitHub marks either PR as changed, merged, closed, or conflicting.

### Evidence commands

```powershell
git status --short --branch
git branch -vv
git fetch --all --prune
git merge-base origin/codex/youtube-material-workflow origin/codex/next-feature-20260629
git rev-list --left-right --count origin/codex/youtube-material-workflow...origin/codex/next-feature-20260629
gh pr view 1 --json number,title,state,isDraft,headRefName,baseRefName,mergeStateStatus,updatedAt,url
gh pr view 2 --json number,title,state,isDraft,headRefName,baseRefName,mergeStateStatus,updatedAt,url
```

If fetching would overwrite or disrupt local work, stop and report the condition instead of forcing an update.

### Deliverables

- dated branch evidence table;
- merge-base and divergence record;
- post-base overlap list;
- note describing any difference from this document.

### Acceptance criteria

- All branch decisions refer to explicit commit hashes.
- The evidence date is recorded.
- Remote and local heads are distinguished.
- No branch is called “the baseline” using only its name.
- Any change since 2026-07-11 is described before the original recommendation is reused.

## 0.2 Build the file-level integration matrix

### Work

Classify every post-base changed file into exactly one category:

1. Keep PR #1 version.
2. Import PR #2 version.
3. Import only a bounded behavior or hunk from PR #2.
4. Reconcile through an explicit design decision.
5. Do not carry forward.

For each file record:

- file path;
- PR #1 behavior;
- PR #2 behavior;
- user-facing consequence;
- runtime/data consequence;
- test coverage on each branch;
- recommended result;
- verification required after integration.

Required focused areas:

- `tools/subtitle-workflow/**`;
- startup scripts;
- `index.html`;
- `styles.css`;
- `src/App.vue`;
- `YouTubeWorkflowPanel.vue`;
- `VideoPlayerFloat.vue`;
- media-source and playback modules;
- workflow client and loader;
- reader runtime modules touched by both branches;
- workflow/video/startup verification scripts.

### Deliverables

- integration matrix;
- explicit list of PR #2 backend files to import;
- explicit list of shared PR #2 UI/runtime files not to merge wholesale;
- unresolved-decision list, which must be empty before Gate 0.

### Acceptance criteria

- Every overlapping file has one classification.
- No core file is left without a classification and named decision owner.
- The matrix distinguishes code ownership from product preference.
- Every imported behavior has a named verification.
- The recommended integrated tree can be explained without referring to both branches at runtime.

## 0.3 Create a self-contained integration baseline

### Work

- Create a dedicated integration branch only after the matrix is approved.
- Bring the approved Subtitle Workflow source into the same checkout.
- Make startup paths derive from the checkout rather than a sibling worktree.
- Keep user data in `E:\ReadWebData\SubtitleWorkflow`.
- Ensure Python dependencies and startup expectations are documented.
- Preserve the service identity/version health checks.
- Do not mix UI redesign into this integration.

### Target startup contract

```text
ReaderRoot = current checkout root
WorkflowRoot = <ReaderRoot>\tools\subtitle-workflow
WorkflowDataRoot = E:\ReadWebData\SubtitleWorkflow
Reader URL = documented local Vite URL
Service URL = http://127.0.0.1:8765
```

### Acceptance criteria

- A fresh checkout can start frontend and backend using only documented dependencies.
- Startup does not reference `E:\read-web-worktrees\next-feature-20260629`.
- `/api/health` returns `service=subtitle-workflow`.
- `/api/health.workflowRoot` resolves inside the active checkout.
- Removing other worktrees does not break startup.
- No user data or credential is added to Git.
- The integration contains no unrelated UI redesign.

## 0.4 Create the capability truth matrix

### Work

Classify each capability as:

- active and complete;
- active but partial;
- implemented but not enabled;
- compatibility-only;
- retired but guarded;
- fully removed;
- deferred from this program;
- unknown and requiring verification.

For each capability record:

- user-visible name;
- entry control and DOM id;
- Vue/DOM owner;
- state owner;
- persistence owner;
- service/backend dependency;
- automated verification;
- manual verification;
- target product region;
- refactor status.

Minimum capability set:

- material URLs and local import;
- queue, recent, history, maintenance, settings;
- audio/video preference and current media;
- playback, seeking, sentence navigation, speed, follow;
- normal transcript and AI chunk;
- marks and import/export;
- lightweight annotation and AI annotation backfill;
- annotation bubble;
- preview vocabulary, display preview vocabulary, article settlement;
- theme, display preferences, style editor, hotkeys;
- service state, credentials, errors, diagnostics;
- all retired cloze/notes/chunk-note paths;
- SRS/review foundations marked deferred.

### Acceptance criteria

- Every visible control in `index.html` maps to a matrix row.
- Every Vue component and command-created dialog maps to a matrix row.
- Every matrix row has an owner and a status.
- No deleted module is described as active.
- No dormant module is described as user-visible.
- SRS-related entries are present but marked deferred/frozen.
- Retired features have an explicit “do not restore” note.

## 0.5 Establish the verification baseline

### Work

- Separate the default `npm test` suite from focused verification commands.
- Map active capabilities to focused scripts.
- Identify user journeys with no automated protection.
- Establish safe fixture data that does not use private materials or credentials.
- Capture current visual/reference states for later comparison.
- Record known pre-existing defects so they are not mislabeled as refactor regressions.

### Required baseline commands

At minimum, run and record:

```powershell
npm test
npm run build
npm run verify:production-preview
npm run verify:script-order
npm run verify:reader-runtime-assembly
npm run verify:session-runtime-assembly
npm run verify:youtube-workflow-client
npm run verify:youtube-workflow-loader
npm run verify:youtube-workflow-panel
npm run verify:youtube-workflow-panel-behavior
npm run verify:video-player
npm run verify:video-player-behavior
npm run verify:annotation-backfill-ai
npm run verify:vocabulary-preview
```

Adjust the exact focused list using the capability matrix; do not reduce it merely to make the gate easier.

### Acceptance criteria

- Every active core capability has an automated check or a written manual procedure.
- The expected pass/fail result of every baseline command is recorded.
- Known failures are explicitly accepted, fixed in a separate change, or treated as Gate 0 blockers.
- Workflow/video/annotation/vocabulary coverage is not inferred from `npm test` alone.
- Test fixtures do not require real API keys or private user material.

## Gate 0 exit criteria

Phase 0 is complete only when:

- one exact integrated commit is designated as the baseline;
- the baseline is self-contained;
- the backend no longer comes from another worktree;
- the capability matrix is complete;
- the documentation-drift list is complete;
- the verification baseline is recorded;
- SRS is explicitly frozen;
- no unresolved core integration decision remains.

Do not begin UI implementation before Gate 0.

---

# Phase 1: Product model

## Objective

Define what product Read-Web is now, what stable regions it contains, which user journeys it supports, and what terminology those journeys use.

## 1.1 Define primary user journeys

Required journeys:

1. Add or import learning material.
2. Observe processing and recover from failures.
3. Continue the most recent reading session.
4. Open a completed material from the library.
5. Listen and read the current article.
6. Switch between normal transcript and AI chunk reading.
7. Mark and inspect learning targets.
8. Run or import annotation explanations.
9. Use current preview-vocabulary and article-settlement entrances without redesigning SRS internals.
10. Configure or diagnose the local service.

For each journey define:

- trigger;
- prerequisites;
- primary success state;
- recoverable failure states;
- cancellation behavior;
- persisted state;
- transition back to Reader or Materials.

### Acceptance criteria

- Every active capability supports at least one journey.
- No journey exists only to justify an existing file.
- Materials and Reader have distinct purposes.
- Each journey has one primary success state.
- Offline, missing credential, provider failure, missing artifact, and switched-article cases are not collapsed into one generic error.

## 1.2 Approve stable product regions

Recommended model for this program:

```text
App Shell
  - Materials
  - Reader Workspace
  - Learning Tools
  - Settings & Diagnostics
```

No Review/SRS top-level region is created in this program.

### Region responsibilities

**Materials**

- add URLs;
- import old local materials;
- processing queue;
- recent activity view;
- searchable material history/library;
- material maintenance.

**Reader Workspace**

- current material identity;
- audio/video playback;
- transcript or AI chunk content;
- sentence navigation;
- reading progress;
- high-frequency reading modes.

**Learning Tools**

- marks;
- annotation bubble;
- annotation generation/import/export;
- current preview-vocabulary and article-settlement entrances as frozen behavior.

**Settings & Diagnostics**

- workflow service connection;
- model/credential configuration;
- reader display preferences;
- keyboard shortcuts;
- theme configuration;
- diagnostics and maintenance entry points.

### Acceptance criteria

- Every capability has one primary region.
- A capability may be invoked elsewhere only through a clearly defined shortcut.
- Settings are not duplicated across Materials and Reader without a documented reason.
- Materials is no longer described as a minor reader toolbar action.
- Learning Tools does not become a dumping ground for settings or diagnostics.
- SRS remains deferred.

## 1.3 Approve a ubiquitous product vocabulary

Terms requiring explicit definitions:

- material;
- processing task/job;
- queue;
- recent reading;
- history/library;
- current article;
- reading completion;
- mark;
- annotation;
- explanation;
- lightweight backfill;
- preview vocabulary;
- display preview vocabulary;
- article vocabulary settlement;
- media preference;
- current active media;
- service offline;
- credential missing;
- provider failure;
- artifact unavailable.

### Acceptance criteria

- Each term has one definition and preferred UI label.
- Action labels use verbs; statuses use state language.
- The same label is not used for two different data states.
- `最近` and `历史/材料库` can be distinguished in one sentence each.
- The meaning of `已学完本篇` is explicitly decided.
- Technical implementation names are not used as primary user-facing copy unless users need them.

## 1.4 Define the product state model

Required states include:

- no material selected;
- service offline;
- service online without credentials;
- URL ready to enqueue;
- queued;
- processing by stage;
- canceled;
- failed and retryable;
- failed and non-retryable;
- artifact ready;
- current article loading;
- current article active;
- reading paused/playing/completed;
- annotation idle/running/failed/available;
- article switch blocked by an unfinished decision;
- local data available but media unavailable.

### Acceptance criteria

- Every state has a visible user-facing representation.
- Every state has allowed actions.
- Every recoverable failure has a recovery action.
- Buttons are not merely disabled when an explanation or primary next action is required.
- Switching articles has an approved protection policy.

## Gate 1 exit criteria

- Primary journeys are approved.
- Product regions are approved.
- The glossary has no unresolved core ambiguity.
- The product state model covers the active capabilities.
- The capability matrix maps cleanly into the approved regions.
- SRS remains outside the product model for this program.

---

# Phase 2: Information architecture

## Objective

Define application-level navigation, the relationship between Materials and Reader, reader control hierarchy, contextual actions, and all important empty states before visual polishing or component migration.

## 2.1 Choose the App Shell model

Compare at least these options:

1. Reader-first shell with a dockable Materials panel.
2. Two application workspaces: Materials and Reader.
3. Reader-first shell with a temporary full-height Materials drawer.

For each option evaluate:

- speed of returning to recent reading;
- how processing can be monitored while reading;
- space for transcript reading;
- video coexistence;
- narrow-window behavior;
- legacy DOM migration cost;
- keyboard and focus behavior.

The current floating mini-application must not be retained by default merely because it already works.

### Acceptance criteria

- The chosen shell clearly indicates whether the user is in Materials or Reader.
- Opening/continuing a recent article takes no more than two primary actions from launch.
- Current material identity remains visible in Reader.
- Processing progress remains discoverable without permanently covering the transcript.
- The chosen structure has a documented desktop and narrow-window behavior.

## 2.2 Define the reader control hierarchy

Classify every reader control into:

1. Media and playback.
2. Reading mode.
3. Current-article learning actions.
4. Data import/export.
5. Display preferences.
6. Keyboard shortcuts and advanced settings.
7. Status only.

High-frequency controls may remain visible. Low-frequency controls move to secondary surfaces but keep compatibility ids until callers move.

### Acceptance criteria

- Playback actions, modes, settings, and statuses are visually and structurally distinct.
- Only context-relevant controls appear when no article is loaded.
- No status is styled as a primary action.
- No control performs two unrelated actions.
- Import/export and shortcut configuration do not dominate the default reading surface.
- Existing learning controls are mapped even when their internals are frozen.

## 2.3 Define application and reader navigation

Required decisions:

- where Materials opens;
- how to return to Reader;
- how previous/next article navigation differs from previous/next sentence;
- where global settings live;
- where current service status appears;
- how history/library differs from recent activity;
- how a processing task becomes an opened article.

### Acceptance criteria

- Previous/next article and previous/next sentence are never visually confusable.
- Global navigation is separate from article actions.
- Settings has one canonical entry.
- Service state is visible without opening the full settings surface.
- Recent and Library have different purposes, filters, metadata, and primary actions.

## 2.4 Specify empty, loading, and unavailable states

Required states:

- first launch;
- no current article;
- no recent items;
- no history results;
- empty queue;
- service offline;
- service starting;
- missing credentials;
- material unavailable;
- transcript unavailable;
- video unavailable while audio exists;
- no marks or annotations;
- feature unavailable for non-workflow local files.

For each state specify:

- title;
- explanation;
- one primary action;
- optional secondary action;
- controls that remain visible;
- controls that are hidden;
- diagnostic details that stay secondary.

### Acceptance criteria

- Every state explains what happened and what the user can do next.
- Each empty state has at most one primary action.
- A blank canvas plus disabled controls is not accepted as an empty state.
- Error details do not replace plain-language recovery guidance.
- States work in light and dark themes.

## 2.5 Produce the control-placement matrix

For every current control record:

- current label;
- DOM id or component source;
- current owner;
- target region;
- target surface;
- visibility rule;
- enablement rule;
- compatibility-id decision;
- migration wave;
- regression verification.

### Acceptance criteria

- Every active control has a target position.
- No active control disappears through omission.
- Every retained DOM id has a reason and retirement condition.
- Every deferred SRS-related control is explicitly marked deferred rather than redesigned.
- Retired controls are absent and remain guarded.

## Gate 2 exit criteria

- The App Shell option is approved.
- Materials/Reader navigation is approved.
- Reader control hierarchy is approved.
- Required empty/loading/error states are approved.
- The control-placement matrix is complete.
- Low-fidelity structure can be reviewed without relying on visual style.

---

# Phase 3: Overlay and window rules

## Objective

Replace independent z-index and window behavior with an approved semantic model covering modality, focus, keyboard behavior, drag/resize, viewport boundaries, and coexistence.

## 3.1 Inventory every overlay

Include at least:

- Materials panel and backdrop;
- Materials subwindows and switch dialogs;
- task/material capsule;
- video utility window;
- annotation bubble;
- annotation backfill dialog;
- preview vocabulary dialog;
- article settlement dialog;
- chunk style dialog;
- theme custom panel;
- toast/error surfaces;
- any remaining helper/sidebar surface.

For each record:

- owner;
- mount target;
- blocking/non-blocking behavior;
- z-index;
- focus behavior;
- Escape behavior;
- backdrop behavior;
- drag/resize behavior;
- persisted geometry;
- narrow-window behavior.

### Acceptance criteria

- Every visible overlay is inventoried.
- Every overlay has one owner and one category.
- Unknown focus or close behavior is treated as an unresolved blocker.

## 3.2 Approve an overlay taxonomy

Recommended categories:

- **Modal:** blocks the underlying task until completed or canceled.
- **Drawer/Panel:** non-blocking application surface attached to the shell.
- **Utility Window:** draggable/resizable tool such as video.
- **Popover/Bubble:** contextual transient surface such as annotation detail.
- **Toast:** short-lived feedback that never captures task focus.

### Acceptance criteria

- Every overlay has exactly one category.
- Category determines behavior rather than arbitrary z-index.
- Only one blocking modal may be active at a time.
- Non-blocking utility windows do not pretend to be modal.

## 3.3 Produce the coexistence matrix

Evaluate at least:

- Materials x video;
- Materials x annotation bubble;
- video x annotation bubble;
- AI annotation dialog x preview/settlement dialog;
- chunk style dialog x all other modals;
- theme panel x modal;
- toast x every surface;
- article switch x every open surface.

Each pair must be classified:

- may coexist;
- opening one closes the other;
- opening is blocked with explanation;
- one is suspended and restored later.

### Acceptance criteria

- Every pair has a rule.
- No modal can appear underneath a non-modal overlay.
- Article switching has a consistent cleanup/protection policy.
- The rules cover keyboard shortcuts as well as visual stacking.

## 3.4 Approve focus and keyboard rules

### Acceptance criteria

- Opening a modal moves focus inside it.
- Background content becomes non-interactive and is removed from the accessible focus order.
- Tab navigation stays inside the active modal.
- Escape behavior is consistent and documented.
- Closing returns focus to the opener or the nearest valid successor.
- Reader hotkeys do not fire through a modal or focused text input.
- Dragging and resizing do not make keyboard access impossible.

## 3.5 Approve geometry and responsive rules

### Acceptance criteria

- Draggable windows cannot be moved completely off-screen.
- A close control always remains reachable.
- Minimum and maximum dimensions are defined.
- At narrow widths, draggable surfaces convert to an approved full-screen, drawer, or bottom-sheet form.
- Critical controls remain reachable at 200% zoom.
- Persisted geometry is clamped when viewport dimensions change.

## 3.6 Define semantic layer tokens

The exact values are a design-system decision, but the semantic order must cover:

```text
base content
sticky shell controls
popover/bubble
drawer/panel
utility window
modal backdrop
modal
toast/critical notification
```

### Acceptance criteria

- Components use semantic layer tokens rather than new arbitrary numbers.
- The token order matches the coexistence matrix.
- Existing exceptional values have a migration disposition.

## Gate 3 exit criteria

- Overlay inventory is complete.
- Taxonomy is approved.
- Coexistence matrix is approved.
- Focus/keyboard rules are approved.
- Geometry/responsive rules are approved.
- Semantic layer order is approved.

---

# Phase 4: Design-system convergence

## Objective

Use the existing Precision Reading Utility direction as the candidate source of truth and eliminate competing visual systems incrementally.

## 4.1 Audit the existing token systems

Inventory:

- `--pru-*` tokens;
- legacy `--bg-*`, `--btn-*`, `--input-*`, and radius tokens;
- `--glass-*` and liquid-glass tokens;
- dark-theme overrides;
- component-specific colors and dimensions;
- hard-coded z-index values;
- global `button`, input, and surface selectors;
- repeated workflow selectors.

Classify every token family as:

- canonical;
- temporary alias;
- legacy but still required;
- migrate when touched;
- retire after named surface migration.

### Acceptance criteria

- No fourth token system is introduced.
- Every existing family has a disposition.
- Light/dark ownership is explicit.
- Reader paper surfaces and application shell surfaces are distinguished.
- Semantic layer tokens from Phase 3 are included.

## 4.2 Approve foundational primitives

Minimum primitives:

- Button;
- Icon Button;
- Input;
- Search;
- Select;
- Toggle;
- Badge/Status;
- Toolbar Group;
- List Row;
- Section Header;
- Empty State;
- Dialog;
- Drawer/Panel;
- Utility Window;
- Popover/Bubble;
- Toast.

Each primitive must define:

- purpose;
- variants;
- size scale;
- default, hover, focus, active, disabled, loading, and error states;
- icon/text rules;
- light/dark values;
- accessibility expectations;
- legacy-class migration mapping.

### Acceptance criteria

- The same semantic action uses the same primitive across Materials and Reader.
- Focus is always visible.
- Disabled and loading are visually distinct.
- Status is not represented by color alone.
- Random radii, shadows, and control heights are prohibited.
- Icon-only actions require accessible names and tooltips where useful.

## 4.3 Approve typography and density

### Acceptance criteria

- UI and reading typography have separate approved roles.
- Heading, body, metadata, badge, and transcript scales are documented.
- Dense utility UI does not reduce critical target sizes below the approved minimum.
- Reader line length, line height, and paragraph spacing are documented.
- Chinese and English fallback behavior is tested.

## 4.4 Select three reference surfaces

Required reference surfaces:

1. Reader Shell with no article.
2. Reader with an active article and core playback/learning controls.
3. Materials with recent or library content.

These surfaces become the visual contract before styling every dialog.

### Acceptance criteria

- The three references cover shell, controls, content, rows, statuses, and empty states.
- Light and dark versions exist.
- Existing PRU direction is reused or explicitly revised with reasons.
- Reference comparison uses the same viewport and application state.
- No production CSS rewrite begins before references are approved.

## 4.5 Define the CSS migration rule

### Acceptance criteria

- New/refactored surfaces use approved semantic tokens.
- Legacy rules are removed only after their consumers move.
- Broad global selectors are not expanded.
- Selector removal is protected by focused visual/behavior verification.
- `styles.css` is reduced through bounded surface migrations rather than one mechanical split.

## Gate 4 exit criteria

- Token disposition table is approved.
- Primitive specifications are approved.
- Typography/density rules are approved.
- Three reference surfaces pass design review in light and dark modes.
- CSS migration rules are approved.

---

# Phase 5: Technical migration design

## Objective

Translate the approved product, information architecture, overlay, and design-system decisions into a safe sequence of ownership migrations without implementing them yet.

## 5.1 Produce the DOM ownership map

For every visible region record:

- current DOM or component;
- mount target;
- event-binding owner;
- state owner;
- persistence owner;
- compatibility callers;
- target owner;
- migration preconditions;
- retirement conditions;
- focused verification.

Required regions:

- theme control;
- legacy file entry;
- global controls area;
- audio/video player;
- seek/speed controls;
- transcript header/actions;
- transcript and chunk content;
- Materials entry and panel;
- video utility window;
- annotation bubble/dialog;
- vocabulary dialogs as frozen behavior surfaces;
- chunk style dialog;
- toast/error surfaces.

### Acceptance criteria

- Every region has one current owner and one target owner.
- Vue and legacy code are not both allowed to mutate a target without an explicit adapter.
- Teleport dependencies are documented.
- Command-created dialogs have a migration or retention decision.
- Every ownership move has a test boundary.

## 5.2 Produce the compatibility-surface map

Include:

- `window.__state` fields;
- `window.__piniaStores`;
- `window.__xxxStore` facades;
- `window.__mediaSource`;
- reader/session public facades;
- DOM ids;
- bridge functions;
- script-order dependencies.

For each surface record:

- owner;
- callers;
- side effects;
- persistence implications;
- replacement interface;
- caller-migration order;
- removal guard;
- verification.

### Acceptance criteria

- No facade is removed while callers remain.
- No UI component assumes Pinia is the only state path without evidence.
- Every removal has a focused guard/test.
- Script order remains unchanged unless a dedicated approved change targets it.
- `reader-runtime.js` and `session-init.js` remain thin.

## 5.3 Approve migration waves

Recommended order:

### Wave 1: Shell and empty states

- establish the approved App Shell structure;
- make the no-article state useful;
- preserve all business behavior through existing controls/adapters.

### Wave 2: Reader control hierarchy

- regroup high-frequency and secondary controls;
- preserve DOM ids and event owners where necessary;
- do not migrate state ownership merely to change layout.

### Wave 3: Materials/Reader relationship

- move Materials into the approved workspace/panel model;
- preserve workflow actions and service behavior;
- separate global navigation from article navigation.

### Wave 4: Overlay behavior

- introduce semantic overlay behavior and focus rules;
- migrate surfaces one category at a time;
- avoid rewriting dialog business logic.

### Wave 5: Learning Tools placement

- place marks, annotation, preview vocabulary, and article settlement entrances in the approved structure;
- keep SRS internals frozen;
- preserve command/controller behavior until a later focused migration.

### Wave 6: Design-system rollout and CSS drainage

- apply approved primitives/tokens surface by surface;
- remove legacy rules only after their surfaces move.

### Wave 7: Compatibility drainage

- migrate remaining callers;
- remove facades only after focused verification proves no consumers remain.

### Acceptance criteria for every wave

- The wave is independently reviewable.
- The application remains usable if later waves never happen.
- The wave has an explicit rollback point.
- Behavior and visual changes are distinguished in the review.
- Tests identify the boundary changed by the wave.
- No wave changes the IndexedDB schema.
- No wave restores retired features.

## 5.4 Define the verification matrix

Every implementation wave must specify:

- failing contract/guard test added before implementation where behavior changes;
- focused module checks;
- `npm test`;
- `npm run build`;
- production preview;
- script-order verification when relevant;
- light/dark screenshots at fixed viewports;
- keyboard/focus checks;
- service offline and online states;
- clean startup from a new checkout for baseline/startup changes;
- manual journey checks with safe fixture data.

### Acceptance criteria

- Every planned change maps to at least one verification.
- “The page loads” is never the only UI acceptance signal.
- Every user-facing state changed by a wave has a screenshot or structured behavior assertion.
- Every compatibility removal has a no-consumer guard.
- Verification commands and expected results are written before implementation begins.

## 5.5 Define commit and review boundaries

### Acceptance criteria

- Each commit has one coherent purpose.
- Mechanical moves and behavior changes are separate commits.
- Generated files and local user data are excluded.
- Reviewers can reject one wave/task without rejecting unrelated work.
- Each OpenSpec task ends in an independently testable deliverable.

## Gate 5 exit criteria

- DOM ownership map is complete.
- Compatibility map is complete.
- Migration waves are approved.
- Verification matrix is approved.
- Commit/review boundaries are approved.
- Engineering can create task-level implementation plans without inventing architecture.

---

# Phase 6: OpenSpec decomposition

## Objective

Convert the approved program into small OpenSpec changes. Do not create one giant “refactor Read-Web” change.

## 6.1 Recommended change sequence

Names may be adjusted to match OpenSpec conventions, but scopes must remain separate:

1. `establish-self-contained-reader-baseline`
2. `define-reader-product-and-ui-ownership`
3. `restructure-reader-shell-and-control-hierarchy`
4. `unify-reader-overlay-interaction-model`
5. `consolidate-pru-design-system`
6. `migrate-material-workflow-surface`
7. `migrate-learning-tool-surfaces`
8. later compatibility-drain changes, one facade boundary at a time

SRS/review must be a separate future program/change and is not included above.

## 6.2 Required artifacts for each change

Every change must contain:

- `proposal.md` with problem, scope, non-goals, and impact;
- `design.md` with decisions, dependencies, risks, rollback, and ownership;
- capability specs with explicit requirements and scenarios;
- `tasks.md` with small testable tasks;
- exact verification commands and expected outcomes;
- file/owner boundaries;
- compatibility behavior;
- explicit deferred work.

### Acceptance criteria

- No artifact contains unresolved placeholders or vague outcome-free requirements.
- Requirements describe observable behavior.
- Every requirement maps to at least one task.
- Every task maps to at least one verification.
- The change can be implemented and reviewed independently.
- Two active changes do not both broadly rewrite the same core boundary.
- Rollback does not require undoing unrelated completed phases.

## 6.3 Change start rule

Before starting implementation of any child change:

1. Confirm the previous gate is complete.
2. Confirm the worktree/branch and dirty state.
3. Read all change artifacts.
4. Create a task-level implementation plan with exact file paths and tests.
5. Run the pre-change verification baseline.
6. Implement one boundary.
7. Run focused verification, full relevant verification, and build.
8. Review the diff for unrelated changes.
9. Update artifacts/status only after evidence is fresh.

## Gate 6 exit criteria

- The approved program is decomposed into independent changes.
- The first change is ready for a task-level implementation plan.
- Later changes do not need to invent missing product or architecture decisions.
- SRS is explicitly deferred.
- Implementation can begin without reopening the entire product definition.

---

## 10. Program-wide acceptance checklist

The overall refactor program is ready for implementation only when all applicable items are true:

- [ ] One exact self-contained baseline commit is approved.
- [ ] Backend and frontend live in the intended checkout structure.
- [ ] The capability truth matrix is complete.
- [ ] Documentation drift is recorded and scheduled for correction.
- [ ] Product regions and primary journeys are approved.
- [ ] Product terminology is approved.
- [ ] Product states and recovery actions are approved.
- [ ] App Shell and navigation are approved.
- [ ] Reader control hierarchy is approved.
- [ ] Empty/loading/error states are approved.
- [ ] Overlay taxonomy and coexistence matrix are approved.
- [ ] Focus, keyboard, geometry, and responsive rules are approved.
- [ ] PRU/token disposition is approved.
- [ ] Primitive component specifications are approved.
- [ ] Three reference surfaces are approved in light and dark modes.
- [ ] DOM ownership and compatibility maps are complete.
- [ ] Migration waves, rollback points, and verification matrices are approved.
- [ ] OpenSpec changes are small, independent, and ordered.
- [ ] SRS/review remains outside this program.
- [ ] No implementation phase depends on another worktree at runtime.

---

## 11. Handoff rules for other models

An implementation model must begin its response by stating:

1. the phase and gate it is working on;
2. the exact branch and commit it inspected;
3. the approved OpenSpec change name, if implementation has begun;
4. the files and compatibility boundaries in scope;
5. the verification it will run;
6. the explicitly excluded work.

The model must stop and request direction when:

- the branch heads differ from the approved integration matrix;
- a required product decision is not approved;
- a change would alter the IndexedDB schema;
- a change would require script-order changes outside its scope;
- an existing user modification overlaps the intended files and cannot be preserved;
- a supposedly retired feature still has active callers;
- implementation requires enabling, redesigning, or deleting SRS behavior;
- a phase gate has not been satisfied.

The model must not claim completion without fresh evidence from the required commands and acceptance checklist.

---

## 12. First authorized next step

The first work item is **Phase 0.1 and 0.2 only**:

1. re-check current PR/branch evidence;
2. produce the file-level integration matrix;
3. draft the exact baseline decision;
4. do not integrate code until the matrix is reviewed.

After the matrix is approved, proceed to the self-contained integration baseline as a dedicated change. Do not begin shell or visual work before Gate 0 passes.
