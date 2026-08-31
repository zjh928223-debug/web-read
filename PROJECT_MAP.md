# Read-Web Optimization Project Map

Last verified: 2026-08-30

本地图描述隔离工作区 `E:\read-web-next-optimization`；`E:\read-web-next` 与 `E:\read-web` 均不属于本轮修改范围。

## Windows owner cutover

```text
scripts/lib/windows-owner-cutover.mjs
  -> explicit optimization-only production entry
  -> existing B backup/migration controller and read-only legacy bridge
  -> real Python Local App Host owners + typed owner client
  -> per-domain freeze marker/checkpoint/rollback

scripts/windows-owner-production-entry.mjs
  -> explicit plan/inventory/dry-run/apply/resume/rollback wrapper
  -> JSON-only staged source snapshot and live browser-freeze evidence gate

src/services/windows-owner-domain-cutover.js
  -> health/readiness and per-domain browser guard
  -> typed Host query/command after checkpoint
  -> legacy canonical writes blocked for switched domains
```

The six-domain order is `reader-session → marks-activity → passage-preview → annotation → vocabulary-srs →
workflow`. The cutover entry requires an explicit optimization opt-in and an isolated profile; a normal profile
without a persisted domain checkpoint remains pre-cutover/not-ready. The old browser storage remains available
only for legacy read/inventory/rollback boundaries after a domain switches, with no long-lived dual write.

The reproducible journey is `npm run verify:windows-owner-c2`; C1, C2b and C2c add the Reader/media,
passage/annotation and vocabulary/workflow browser and owner behavior checks. Host reopen queries read the
profile-scoped canonical repositories, not the browser backup composition.

## Runtime entry

```text
index.html
├── src/composables/glass-effects.js
├── src/composables/app-handlers.js
├── src/composables/style-editor.js
├── src/composables/import-module.js
├── src/composables/keyboard-module.js
├── src/composables/media-source-module.js
├── src/composables/playback-module.js
├── src/composables/controls-module.js
├── src/composables/legacy-control-bindings.js
└── src/main.js
    ├── configure Pinia runtime registry
    ├── import reader-runtime.js and session-init.js
    └── mount Vue
```

不要随意改变该顺序。兼容模块仍依赖 import side effect 和启动时 global。

## Frontend ownership

```text
src/
├── App.vue / main.js                 Vue root 与 Pinia 启动
├── components/                       Reader、Chunk、Video、Workflow UI
├── pinia-stores/                     真实应用 store（当前唯一 store 所有者）
├── composables/
│   ├── reader-runtime-assembly.js    Reader 顶层顺序
│   ├── reader-*-runtime.js           import/control/playback/keyboard/app 行为域
│   ├── session-runtime-assembly.js   Session 顶层顺序
│   ├── session-*.js                  restore/annotation/startup/UI 行为域
│   └── *-module.js                   legacy DOM 行为的 focused module
├── services/
│   ├── persistence/                  IndexedDB、session、ledger
│   ├── runtime/                      lifecycle/request/error/URL owner
│   ├── workflow/                     job polling
│   ├── annotation/                   annotation pipeline
│   └── vocabulary/                   acquisition/review/events/UoW
├── dictionary/                       ECDICT 与本地句库边界
└── features/                         Passage Preview、SRS 等独立功能
```

## Backend ownership

```text
tools/subtitle-workflow/
├── youtube_workflow/service.py       FastAPI routes 与 JobManager
├── youtube_workflow/core.py          外部工具工作流
├── youtube_workflow/history.py       history/activity 持久化
├── youtube_workflow/durable_json.py  crash-safe JSON repository
├── youtube_workflow/runtime_config.py
├── tests/                            后端行为与故障注入
└── requirements-service.txt          已验证直接依赖基线
```

`service.py` 当前仍过大；拆分前先保持 route、repository、process 和 lifecycle seam 的行为测试。

## Configuration and release

```text
config/runtime-config.schema.json
config/runtime.next.json
config/performance-budgets.json
scripts/launch-next-preview.ps1
scripts/verify-fast.mjs
scripts/verify-full.mjs
scripts/perf/
docs/OPERATIONS.md
docs/NEXT_WORKSPACE.md
```

## Retired surfaces

以下不是当前入口：

- `read-26.html`
- root `app.js`
- `reader-runtime-shell.js`
- `src/stores/` window 兼容 store layer（已删除）
- reader notes runtime/session/store/persistence
- cloze UI 与手工 chunk 导入
- former root annotation/chunk-note artifacts (deleted; see `docs/architecture/legacy-deletion-inventory.json`)

历史文件若仍在 Git 中，只能作为追溯材料；不得从 `index.html` 或生产 build 重新接入。

## Verification ownership

- `scripts/*-check.*`：focused behavior/architecture contracts。
- `scripts/ui-compatibility-store-check.cjs`：UI Pinia owner 与 retired `__uiStore` 浏览器行为门禁。
- `scripts/verify-fast.mjs`：快速行为门禁。
- `scripts/verify-full.mjs`：隔离浏览器、build 和后端总门禁。
- `scripts/perf/`：性能与本地 HTTP 基准。
- `openspec/changes/archive/2026-08-17-stabilize-and-simplify-read-web/`：已完成稳定化工作的规格、设计与任务记录。

若此地图与文件树冲突，以实际文件树和通过的行为测试为准，并在同一提交修正文档。
