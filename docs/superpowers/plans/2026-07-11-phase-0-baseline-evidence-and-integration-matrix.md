# Phase 0 Baseline Evidence and Integration Matrix Implementation Plan

> For agentic workers: REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Approve one self-contained Read-Web integration baseline by recording branch evidence and a complete file-level source-selection matrix before any integration code is changed.

**Architecture:** PR #1 (codex/youtube-material-workflow) remains the product, reader, UI, video, annotation, and frozen vocabulary/SRS baseline. Import only the Subtitle Workflow backend source and source guard from PR #2 (codex/next-feature-20260629), then reconcile startup, package, ignore, and startup-verification boundaries. Do not merge PR #2's alternate UI/runtime snapshot.

**Tech Stack:** Git, GitHub CLI, PowerShell, Node verification scripts, Python/FastAPI, Vite, Vue 3, Pinia.

## Global Constraints

- Scope is Phase 0.1 and 0.2 evidence and planning only; do not create an integration branch or modify product/runtime code.
- Do not change IndexedDB: SeekPlayerDB, version 1, store files, key path id.
- Do not reorder index.html scripts; keep reader-runtime.js and session-init.js thin.
- Do not recreate reader-runtime-shell.js, restore retired features, redesign SRS/review, or remove compatibility surfaces.
- Preserve the existing untracked REFACTORING_README.md; do not stage, remove, or overwrite it.
- Do not commit credentials, generated media, logs, caches, or E:\ReadWebData\SubtitleWorkflow.

---

## Evidence snapshot

Collected 2026-07-11 after git fetch --all --prune:

| Ref | Local head | Remote head | Status |
|---|---|---|---|
| main | 2df89d3b2e0e9ada79366e2a06f1c655646aaa55 | same | matches |
| PR #1 | 5b7a31f9fb6cf3508b380c255b7957d7955561ef | same | Open Draft, CLEAN |
| PR #2 | dfb2f67ed7a9a8a4caa8ede16a01bcce09f035ff | same | Open Draft, CLEAN |

- Merge-base: 1bfbe46c9a9a990b25628fd41d471f852497fa2b.
- Divergence: PR #1 has 5 unique commits; PR #2 has 1.
- Post-base paths: PR #1 = 69, PR #2 = 46, shared = 25.
- Current self-containment defect: PR #1 scripts/start-latest-reader.ps1 points to E:\read-web-worktrees\next-feature-20260629\tools\subtitle-workflow.

## Matrix categories

1. **Keep PR #1** — preserve PR #1 in the integrated tree.
2. **Import PR #2** — bring the PR #2 backend/source path unchanged.
3. **Bounded import** — copy only the named behavior with a dedicated test.
4. **Reconcile** — make a reviewed integrated version; select neither branch wholesale.
5. **Do not carry** — exclude PR #2-only UI/runtime behavior from the Phase 0 baseline.

## File-level integration matrix

### Keep PR #1

Keep these PR #1-only paths; they define the current reader, annotation, and frozen vocabulary/SRS capability:

- CONTEXT.md; design-qa.md; docs/superpowers/plans/2026-07-10-srs-lexical-meaning-refinement.md; package-lock.json.
- scripts/annotation-backfill-ai-module-check.cjs; chunk-interactions-check.cjs; reader-app-runtime-check.cjs; reader-bootstrap-runtime-check.cjs; reader-dom-refs-check.cjs; reader-feature-runtime-deps-check.cjs; transcript-interactions-check.cjs; vocabulary-preview-service-check.cjs; vocabulary-srs-service-check.cjs; youtube-workflow-loader-check.cjs; youtube-workflow-panel-behavior-check.cjs.
- src/components/ChunkModeView.vue; TranscriptContainer.vue.
- src/composables/annotation-backfill-ai-module.js; annotation-bubble-resolver.js; annotation-bubble.js; chunk-interactions.js; reader-bootstrap-runtime.js; reader-dom-refs.js; reader-feature-runtime-deps.js; reader-feature-runtime.js; session-annotation-bundle-merge.js; session-annotation-import-normalization.js; transcript-interactions.js; vocabulary-preview-module.js.
- src/pinia-stores/transcript.js; src/services/annotation/click-resolver.js; result-store.js.
- Every file under src/services/vocabulary/: article-srs-settlement-progress.js; article-srs-settlement.js; index.js; preview-scan.js; settlement-meaning-refinement.js; srs-candidates.js; srs-pending-candidates.js; srs-scheduler.js; vocabulary-models.js; vocabulary-repository.js; vocabulary-service.js.

Keep PR #1 for these shared paths. The byte-identical paths are scripts/script-order-guard-check.cjs, src/App.vue, and src/composables/app-handlers.js, chunk-controls-module.js, controls-module.js, highlight-controls-module.js, keyboard-module.js, playback-runtime-helpers.js, reader-playback-runtime.js, youtube-workflow-loader.js. The PR #1-specific selections are:

- index.html; styles.css.
- scripts/video-player-behavior-check.cjs; video-player-module-check.cjs.
- src/components/VideoPlayerFloat.vue; YouTubeWorkflowPanel.vue.
- src/composables/media-source-module.js; playback-module.js; reader-app-runtime.js.

**Reason and verification:** preserves current PR #1 learning controls, SRS persistence, current video behavior, and compatibility interfaces. After later integration run npm test, npm run build, npm run verify:production-preview, reader-runtime checks, workflow-panel behavior check, video checks, annotation check, and vocabulary checks.

### Import PR #2

Import the following complete backend/source set from PR #2:

- tools/subtitle-workflow/README.md.
- tools/subtitle-workflow/chunk_adapter.py.
- tools/subtitle-workflow/chunker/chunk_config.py; chunk_lexicon.py; chunk_rules.py; spoken_chunker.py.
- tools/subtitle-workflow/language_service.py; requirements-service.txt; subtitle_workflow.py.
- tools/subtitle-workflow/tests/test_language_service.py; test_pyqt_core_delegation.py; test_service_app.py; test_workflow_core.py.
- tools/subtitle-workflow/youtube_workflow/__init__.py; core.py; credentials.py; history.py; prompts/annotation_backfill_prompt.txt; service.py.
- scripts/subtitle-workflow-source-check.cjs.

**Reason and verification:** this makes the existing Materials frontend self-contained. It must start at http://127.0.0.1:8765, report service=subtitle-workflow, report a checkout-local workflowRoot, and retain external mutable data at E:\ReadWebData\SubtitleWorkflow. Run npm run verify:subtitle-workflow-source, all imported Python tests, workflow client/loader/panel checks, and /api/health assertions.

### Bounded import

| Path | Behavior to copy | Verification |
|---|---|---|
| scripts/start-youtube-reader.ps1 | Derive the reader root from PSScriptRoot, derive WorkflowRoot=<ReaderRoot>\tools\subtitle-workflow, use the external data root, validate health service/version/root, and replace a stale matching service safely. | npm run verify:youtube-workflow-startup; start from a checkout without a sibling worktree; assert the health root. |

### Reconcile explicitly

| Path | Approved integrated behavior | Verification |
|---|---|---|
| .gitignore | Keep PR #1's annotation temporary-output ignore and add PR #2's Workflow output, state, Gemini-cache, and Python-bytecode ignores. | git check-ignore and git status --ignored --short. |
| package.json | Keep PR #1 dependencies and vocabulary scripts; add only verify:subtitle-workflow-source. Do not remove ts-fsrs. | npm ci; vocabulary checks; source check. |
| scripts/start-latest-reader.ps1 | Make it the canonical PR #1 launcher with checkout-derived workflow root, while preserving PR #1's -NoOpen, -FrontendOnly, port 5173, logs, data root, and health checks. | Startup check plus health-root assertion. |
| scripts/youtube-workflow-startup-check.cjs | Assert the target contract, not a branch-specific path or PR #2's port 5174: no sibling worktree, checkout-local root, external data root, service/version/root health checks, documented reader URL. | npm run verify:youtube-workflow-startup. |

### Do not carry PR #2 UI/runtime behavior

| Path | Excluded behavior | Reason |
|---|---|---|
| scripts/youtube-workflow-client-check.cjs | deleteJob, clearFailedJobs, and changed manual-video request assertions. | PR #1 UI/client does not consume them; importing tests would invent an unapproved user contract. |
| scripts/youtube-workflow-panel-check.cjs | Failed-record delete/clear and manual-video binding assertions, and removal of PR #1 video-priority/progress assertions. | PR #2 is an alternate older Materials snapshot. |
| src/composables/youtube-workflow-client.js | deleteJob and clearFailedJobs methods. | Backend endpoints may exist, but no Phase 0 PR #1 interface requires them. |

## Task 1: Refresh branch evidence

**Files:**

- Create: docs/superpowers/plans/2026-07-11-phase-0-baseline-evidence-and-integration-matrix.md
- Modify: none
- Test: Git and GitHub CLI read-only evidence commands.

**Interfaces:**

- Consumes: origin/main, origin/codex/youtube-material-workflow, origin/codex/next-feature-20260629, GitHub PR #1 and #2.
- Produces: exact branch evidence for all later baseline decisions.

- [ ] **Step 1: Inspect the worktree**

Run:

~~~powershell
Set-Location E:\read-web
git status --short --branch
git branch -vv
~~~

Expected: preserve the untracked user-owned REFACTORING_README.md.

- [ ] **Step 2: Refresh remote evidence**

Run:

~~~powershell
Set-Location E:\read-web
git fetch --all --prune
git rev-parse main origin/main codex/youtube-material-workflow origin/codex/youtube-material-workflow codex/next-feature-20260629 origin/codex/next-feature-20260629
git merge-base origin/codex/youtube-material-workflow origin/codex/next-feature-20260629
git rev-list --left-right --count origin/codex/youtube-material-workflow...origin/codex/next-feature-20260629
gh pr view 1 --json number,title,state,isDraft,headRefName,baseRefName,mergeStateStatus,updatedAt,url
gh pr view 2 --json number,title,state,isDraft,headRefName,baseRefName,mergeStateStatus,updatedAt,url
~~~

Expected at this evidence date: the snapshot values above, merge-base 1bfbe46, divergence 5 1, and two open Draft PRs.

- [ ] **Step 3: Stop on evidence drift**

If branch heads, merge-base, PR state, or dirty-state conditions differ, update this matrix and request a new Phase 0.2 review. Do not begin integration.

## Task 2: Review the matrix before integration

**Files:**

- Modify: docs/superpowers/plans/2026-07-11-phase-0-baseline-evidence-and-integration-matrix.md
- Test: changed-file and diff checks.

**Interfaces:**

- Consumes: merge-base and branch heads from Task 1.
- Produces: the approved source-selection policy for the dedicated self-contained baseline change.

- [ ] **Step 1: Recompute the file sets**

Run:

~~~powershell
Set-Location E:\read-web
$base = '1bfbe46c9a9a990b25628fd41d471f852497fa2b'
$pr1 = git diff --name-only "$base..origin/codex/youtube-material-workflow"
$pr2 = git diff --name-only "$base..origin/codex/next-feature-20260629"
$shared = Compare-Object $pr1 $pr2 -IncludeEqual -ExcludeDifferent | Where-Object SideIndicator -eq '==' | Select-Object -ExpandProperty InputObject
"PR1=$($pr1.Count) PR2=$($pr2.Count) Shared=$($shared.Count)"
~~~

Expected at this evidence date: PR1=69 PR2=46 Shared=25.

- [ ] **Step 2: Verify the backend-only wholesale import**

Run:

~~~powershell
Set-Location E:\read-web
git diff --name-status origin/codex/youtube-material-workflow origin/codex/next-feature-20260629 -- tools/subtitle-workflow scripts/subtitle-workflow-source-check.cjs
~~~

Expected: every path is added by PR #2 and absent from PR #1.

- [ ] **Step 3: Verify UI/runtime exclusions**

Run:

~~~powershell
Set-Location E:\read-web
git diff --name-status origin/codex/youtube-material-workflow origin/codex/next-feature-20260629 -- index.html styles.css src/App.vue src/components/YouTubeWorkflowPanel.vue src/components/VideoPlayerFloat.vue src/composables/media-source-module.js src/composables/playback-module.js src/composables/reader-app-runtime.js
~~~

Expected: shared UI/runtime paths differ and remain PR #1 selections.

- [ ] **Step 4: Approve only the next integration boundary**

Approval authorizes a new establish-self-contained-reader-baseline OpenSpec change. It does not authorize visual redesign, Shell migration, script-order changes, IndexedDB changes, SRS/review work, facade removal, or wholesale PR #2 UI/runtime merges.

## Phase 0.1/0.2 self-review

- [x] Evidence has exact local and remote commits, PR states, merge-base, divergence, and date.
- [x] Every PR #1 post-base path is assigned to Keep or Reconcile.
- [x] Every PR #2 post-base path is assigned to Import, Bounded import, Reconcile, or Do not carry.
- [x] The backend import list is explicit; no shared UI/runtime file is selected wholesale from PR #2.
- [x] The target startup contract removes the sibling-worktree dependency.
- [x] SRS remains visible but frozen; no schema or behavior work is authorized.
- [x] This plan made no product/runtime code change.

