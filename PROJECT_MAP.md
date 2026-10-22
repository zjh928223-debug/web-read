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

## Mac-Windows deployment modes

The selected production mode is Windows-hosted and same-origin. The Windows stable front door serves the
immutable frontend `dist` and `/api` from one origin; a Mac browser opens that stable entry directly. Static
assets, API calls, event streams and polling, and relative audio/video or other media URLs (including Range
requests) all use that same origin. The Mac does not need a production backend base URL or a separate CORS path.

The selected development mode is a lightweight Mac Vite/HMR process. Its server-side local configuration
proxies relative `/api`, event/polling, and Range media requests to the Windows stable front door. The proxy is
only a development aid: the production browser bundle continues to use relative URLs, and the Windows address
must not be exposed through `VITE_*` values, browser constants, or the built bundle.

Windows remains the boundary for WhisperX, ffmpeg, yt-dlp, AI and other heavy work, secrets, SQLite, media
storage, and durable persistence. The optimization stable front door remains `5184`; the candidate FastAPI
Host keeps its dynamically selected internal port and the `8776` Node capability sidecar remains loopback-only.
The single-user tailnet exception runs Tailscale Serve in front of that same loopback front door and accepts one
explicit full MagicDNS HTTPS origin at runtime; it does not add a general transport mode or expose the internal
Host/sidecar ports.
The optimization profile continues to use `5184/8776` and `E:\ReadWebData\SubtitleWorkflow-Optimization`;
the daily reader ports and data root must not be mixed into this mode.

This decision does not introduce Tauri, a resident Mac production server, Mac offline canonical persistence,
remote Windows NativePicker interaction, self-built pairing/TLS, or a second Git repository. This section records
the deployment boundary; the manual tailnet Serve exception is documented in `docs/OPERATIONS.md`, while the
private-LAN and cross-machine acceptance claims remain limited to their own evidence.

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
├── pinia-stores/                     7 个真实应用 store（当前唯一 store 所有者）
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

### Recent reader responsibility boundaries (2026-09-13)

| 职责 | 当前所有者 |
| --- | --- |
| 预习页面协调 | `src/features/passage-preview/use-passage-preview.js` |
| 阅读保存接线与页面事件 | `src/composables/use-reader-session-persistence.js`（App 唯一 start/stop；Panel 为消费者） |
| 保存范围注入与装配错误 | `src/composables/reader-session-persistence-context.js`（module-local key，无缺注入回退） |
| 素材库、分页重试、任务轮询与完成提示 | `src/composables/use-workflow-library.js`（Panel 范围） |
| workflow revision、operation receipt、变更 single-flight | `src/composables/create-workflow-mutation-coordinator.js`（Panel 范围；在途成功确认后清 receipt） |
| 阅读 outbox 存储 | `src/services/persistence/reader-outbox-storage.js` |
| 保存队列、revision 与冲突 | `src/composables/use-reader-save-coordinator.js` |
| 播放会话、收听统计与事件跟踪 | `src/services/workflow/reader-playback-tracker.js` |
| 标记恢复期间的协调 | `src/composables/create-reader-marks-hydration.js` |
| 句高亮和模式可见性局部同步 | `src/components/TranscriptContainer.vue`、`src/components/ChunkModeView.vue` |

`App.vue` 负责页面组合、Host 恢复和学习记录启动协调，并持有唯一阅读保存范围。`YouTubeWorkflowPanel.vue` 保留材料操作、加载器和素材 UI；通过注入消费同一会话状态，登记 loader 取消函数及可卸载的最近阅读项订阅。标记应用、activity、网络/关闭补发及页面监听由 `use-reader-session-persistence.js` 接线，继续消费原 tracker/coordinator/hydration/outbox 服务。Panel 移除不停止核心保存，重挂不重建保存范围；App 根关闭先取消真实 loader、结束 loading，再 flush/释放。R1 已独立 PASS；R2 已由父独立复审 PASS，见 [R2 独立报告](C:/Users/0/AppData/Local/Temp/reader-r2-independent-review-20261003-b20c8265/review.md)。有限 Vue 夹具仍运行真实 App/Panel/保存/loader；hide/show 为配对的合成 persisted 合同，真实 BFCache 未验证。

R3 关闭保存专项（2026-10-04）执行及父独立审核 PASS，原固定 R3-A1–A6 已独立 PASS：本次补齐 A5 剩余关闭缺口，其余按无漂移源及原证据继承。此专项产品零修改，保留原 open/endLoad 一行补修；失败定位边界是本机 Temp 入口的全量 browser route 拦截。正式完整 App open/mark/switch/真实关闭后服务确认原 session 的 close，原 operation 正常启动幂等补发及确认后清 outbox 通过。原集中批次 close 确认 FAIL 与本专项 route 诊断 FAIL 保留；原完整 Panel、完整 10 组和 12 外观上下文本专项 NOT_RUN，仅按身份继承，见 [R3 关闭保存专项独立审核](C:/Users/0/AppData/Local/Temp/reader-r3-close-save-independent-review-20261004-d7bcf77b/review.md)。R5 待重定界，R6/R8/R9 未启动；原 FAIL/NOT_RUN/NOT_VERIFIED 与文档顶部全仓 Last verified 保持。

SRS review 与 Passage Preview 页面通过 `App.vue` 的 `defineAsyncComponent` 按需加载，`PassagePreviewSettingsDialog.vue` 仍静态加载；服务、Host 恢复和学习记录处理没有随页面延迟。

## Backend ownership

```text
tools/subtitle-workflow/
├── youtube_workflow/service.py       FastAPI routes、材料 JobManager 与 annotation 公开兼容入口
├── youtube_workflow/annotation_backfill_runtime.py  AI 标注操作线程/pool/slots、cancel/deadline 与 run IO
├── youtube_workflow/annotation_backfill_template.py 请求 scope/batch/validate/merge/history helpers
├── youtube_workflow/core.py          外部工具工作流
├── youtube_workflow/history.py       history/activity 持久化
├── youtube_workflow/durable_json.py  crash-safe JSON repository
├── youtube_workflow/runtime_config.py
├── tests/                            后端行为与故障注入
└── requirements-service.txt          已验证直接依赖基线
```

`service.py` 仍拥有 HTTP 注册与普通材料 JobManager；annotation 运行状态集中在 `annotation_backfill_runtime.py`，请求/结果构造集中在 `annotation_backfill_template.py`。公开 annotation 方法与共享 requester 保持兼容，HTTP 注册整理留给 R8。R7 已由父独立审核 PASS：115 项测试、34 个模板样例对照及真实临时 HTTP 通过，见 [R7 独立报告](C:/Users/0/AppData/Local/Temp/reader-r347-independent-review-20261003-f4c052b7/R7-review.md)；R8 未启动。

## Configuration and release

```text
config/runtime-config.schema.json
config/runtime.next.json
config/runtime.daily-production.json
config/performance-budgets.json
scripts/launch-next-preview.ps1
scripts/launch-daily-production.ps1
scripts/initialize-daily-production-application-profile.mjs
scripts/release-shortcut-migration.ps1
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
- cloze UI、Cloze store/adapter 与手工 chunk 导入；当前 `manualChunkStates` 状态/恢复/快照/回滚链已退休，历史偏好清理保留
- unused `passage-preview-learning-launch.js` query helper and `translation-generation-queue.js` (current preview entry, translation/preload, and AI chunk remain)
- former root annotation/chunk-note artifacts (deleted; see `docs/architecture/legacy-deletion-inventory.json`)

历史文件若仍在 Git 中，只能作为追溯材料；不得从 `index.html` 或生产 build 重新接入。

真实 Pinia stores 为 audio、transcript、chunk、marks、UI、theme、annotation；`runtime-registry.js` 提供显式访问，本身不是 store。`runtimeState`/`bridgeToPinia` 是模块接口，旧 `window.__state`、`window.__piniaStores`、`window.bridgeToPinia` 和 `__clozeState`/`__glassEffects`/`__legacyControlBindings` 发布已退休。glass 初始化与 legacy 控件自动绑定仍保留。

## Verification ownership

- `scripts/*-check.*`：focused behavior/architecture contracts。
- `scripts/youtube-workflow-panel-check.cjs`：保留的旧命令兼容入口，实际转接到 V3 panel 检查；package.json 的正式入口为 `verify:youtube-workflow-panel` 与 `verify:youtube-workflow-panel-behavior`。
- `scripts/ui-compatibility-store-check.cjs`：UI Pinia owner 与 retired `__uiStore` 浏览器行为门禁。
- `scripts/verify-fast.mjs`：快速行为门禁。
- `scripts/verify-full.mjs`：隔离浏览器、build 和后端总门禁。
- `scripts/daily-production-launcher-check.ps1`：只使用临时 data root、随机安全端口和临时快捷方式，验证 Plan/授权边界/未知占用者保护/快捷方式 Apply-Rollback。
- `scripts/perf/`：性能与本地 HTTP 基准。
- `openspec/changes/archive/2026-08-17-stabilize-and-simplify-read-web/`：已完成稳定化工作的规格、设计与任务记录。

若此地图与文件树冲突，以实际文件树和通过的行为测试为准，并在同一提交修正文档。

### SRS媒体与翻译边界（R4阶段1）

SrsReviewPage.vue保留页面组合、active/卡watcher、答案/评分/快捷键/历史与布局；src/features/srs-review/use-srs-review-media.js拥有唯一媒体活跃代、来源等待、发音序列与资源释放；同目录use-srs-review-answer-translation.js拥有翻译请求/缓存，并消费媒体代许可。两个新模块不注册重复watcher。父按原 A1–A7 固定产品验收通过，见 [R4 独立复审](C:/Users/0/AppData/Local/Temp/reader-r347-independent-review-20261003-f4c052b7/bounded-closeout-20261003/R4-independent-review.md)。原辅助 18 组比较中 13 PASS、5 个 borderColor 过渡采样 FAIL、aggregate exit1 保留，不表示全部检查全绿；R6 未启动。


N1 本文扫描清退执行记录（2026-10-04）：两个扫描/显示入口及专用生产、显示、词典富集支路已撤除；本文整理、历史来源识别和独立学习入口保留。执行验收未完成：J3 现有手工导入入口不可达，句高亮正式检查失败；独立审核 NOT_RUN，R5 未放行。具体命令、失败与未覆盖项见本轮 Temp handoff.md：C:/Users/0/AppData/Local/Temp/reader-n1-resume-20261004-582b711a/handoff.md。此记录不更新全仓 Last verified 或前轮结论。


N1 补充执行（2026-10-04）：用户授权重定后，句高亮完整检查、匹配 target 的普通 AI/真实轻量合并与旧扫描来源/mark 保护、动画稳定的四组合生产矩阵及 drag/resize/focus、代表 loading/empty/长列表/relearn/error 对照通过。处理中 UI 已观测；补充 producer 完成响应合同错误的原 FAIL 保留，停止追加修补。原手工文件 UI 缺口不伪装为旅程通过，按方案补充范围改用既有 AI 导入链；dictionary 全入口的既有 FAIL 保留并有原 opening 复现。独立审核 NOT_RUN、R5 未放行，见 C:/Users/0/AppData/Local/Temp/reader-n1-supplement-20261004-2c83b798/handoff.md；不更新全仓 Last verified。


### N1 独立收口（2026-10-04）

**N1 独立 PASS，限于方案预先重定后的验收范围，现已收口。** 独立审核未发现阻断收口的 P0–P2 问题，见[独立审核报告](C:/Users/0/AppData/Local/Temp/reader-n1-independent-review-20261004/review.md)。最后 completion 补测已闭合精简完成、进度保存及关闭重开读取；原失败尝试保留。原手工文件 UI 旅程仍为 NOT_RUN，dictionary:test 整入口仍为既有 FAIL，按重定范围保留另案；本审核未重跑业务测试。此前执行/补充段落是各阶段历史记录，不再代表当前 N1 状态。

R5 旧扫描/双入口扫描子范围标为“因功能退休取消”，不是 R5 PASS；R5 保留本文整理职责的方案仍须定稿及明确调度，尚未启动。R5 opening 应以 N1 本次收口后的当前源码及 closing 身份为基线，见 C:/Users/0/AppData/Local/Temp/reader-n1-closeout-20261004-e83a5c18/closing-manifest.json，不以 HEAD 或清退前源码代替。未更改 R9、全仓 Last verified 或推广状态。


### R5 本文整理职责迁移独立收口（2026-10-04）

R5按重定固定A1–A7独立PASS，见[独立报告](C:/Users/0/AppData/Local/Temp/reader-r5-independent-review-20261004-6bfa8721/review.md)。本文整理DOM、候选展示/展开、按钮、拖拽缩放、发音、关闭释放与焦点返回由src/features/vocabulary-preview/create-article-settlement-dialog.js单独拥有；vocabulary-preview-module.js继续负责文章身份、缓存、进度、AI、claim、入库及owner协调。workflow-ui.css仅补准确@source，生产CSS哈希保持。D/M/B前置分别独立PASS；原手工文件旅程NOT_RUN且功能已退役并清退，原dictionary历史FAIL保留。R5当前生产四组合/代表状态/精简保存重开/words-all-skip通过；切文原伪PASS撤回INVALID，当前桌面/移动完成隔离补证有效，opening桌面补测FAIL保留，迟到完成配对仍NOT_VERIFIED。源码及原日志见C:/Users/0/AppData/Local/Temp/reader-r5-settlement-dialog-20261004-01a10648/handoff.md。旧扫描范围因功能退休取消，不改为PASS；不更新全仓Last verified或推广状态。R6/R8/R9尚未施工，后续按R6→R8→R9执行。此前相关段落为历史记录。


### 大文件职责整理有限收尾（2026-10-04）

用户要求简化并尽快完成后，R6模板/弹窗/controller及R8三组HTTP路由已施工；针对性检查、156项后端测试、路由/OpenAPI及生成CSS身份、当前Vite加载/播放/交互通过。R9仅完成身份/接线/清单/文档与现有检查的有限自检；R6/R8及本轮R9独立审核NOT_RUN，原完整跨轮生产旅程未补齐。既有architecture与workflow-streaming检查FAIL已在opening副本复现；当前dictionary:test 30项PASS。此前阶段状态段落保留为历史，不代表最新状态。 详见[2026-10-04 有限收尾交接](E:/read-web-next-optimization/docs/design/reader-large-file-decomposition/handoff.md)。

AI模板与弹窗分别由src/features/annotation-backfill/annotation-backfill-template.js、create-annotation-backfill-dialog.js拥有；annotation-backfill-ai-module.js保留运行/身份/导入协调。youtube_workflow/http下workflow_routes、reader_media_routes、capability_routes及__init__按原顺序集中55个业务端点；service.create_app保留安全/lifespan/metrics/CORS装配，R7及其它service实现保持。源码有限施工已结束，不刷新全仓Last verified，不宣布原R1–R9或全仓独立PASS，功能改造未施工。
