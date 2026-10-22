# Read-Web

Read-Web 是一个本地运行的英语学习阅读器，使用 Vite、Vue 3、Pinia 和 FastAPI。它支持音视频材料、同步字幕、AI 语块、标记、轻量标注、词汇预习、SRS 复习和本地词典。

项目目前仍是混合架构：Vue/Pinia 已承担主要界面和状态，但启动链仍保留一组 `window.*` 与 DOM 兼容边界。不要把它当成已经完成的纯 Vue 重写。

## 当前工作区

本目录 `E:\read-web-next-optimization` 是优化实现工作区；受保护的当前日常安装/工作区是 `E:\read-web-next`。

- 当前日常 origin/root 是 `E:\read-web-next`、`5174/8766` 和 `E:\ReadWebData\SubtitleWorkflow-Next`；现有日常 launcher 仍是受保护的 Vite/dev 兼容入口。
- `scripts/launch-daily-production.ps1` 是从本 worktree 生成 built-dist Host 的独立 promotion 候选入口。
- 旧日常目标 `E:\read-web` 及 `5173/8765` 仍作为快速回退参考保留。
- 本 worktree 的 optimization 手工运行仍只使用 `5184/8776` 和 `E:\ReadWebData\SubtitleWorkflow-Optimization`。
- 快捷方式不会由验证自动改写；任何切换都必须单独显式确认并保留旧目标。
- 学习数据、媒体、凭据和大型词典不进入 Git。

当前架构事实见 [CURRENT_PROJECT_STATUS.md](CURRENT_PROJECT_STATUS.md)，文件所有权见 [PROJECT_MAP.md](PROJECT_MAP.md)，启动、验证和故障处理见 [docs/OPERATIONS.md](docs/OPERATIONS.md)。

素材工作流 R3 已完成阶段一职责迁移：`use-workflow-library.js` 持有列表、分页、重试、轮询与完成提示计时器；`create-workflow-mutation-coordinator.js` 持有 workflow revision、receipt 和同操作 single-flight。Panel 保留表单、凭据/配置、quality 弹窗及材料打开，并继续消费 R2 保存范围。关闭保存专项（2026-10-04）执行及父独立审核 PASS，原固定 R3-A1–A6 已独立 PASS：本次补齐 A5 剩余关闭缺口，其余按无漂移源及原证据继承。此专项产品零修改，保留原 open/endLoad 一行补修；失败定位边界是本机 Temp 入口的全量 browser route 拦截。正式完整 App open/mark/switch/真实关闭后服务确认原 session 的 close，原 operation 正常启动幂等补发及确认后清 outbox 通过。原集中批次 close 确认 FAIL 与本专项 route 诊断 FAIL 保留；原完整 Panel、完整 10 组和 12 外观上下文本专项 NOT_RUN，仅按身份继承，见 [R3 关闭保存专项独立审核](C:/Users/0/AppData/Local/Temp/reader-r3-close-save-independent-review-20261004-d7bcf77b/review.md)。

R7 已由父独立审核 PASS：115 项测试、34 个模板样例对照及真实临时 HTTP 通过，见 [R7 独立报告](C:/Users/0/AppData/Local/Temp/reader-r347-independent-review-20261003-f4c052b7/R7-review.md)。R5 待重定界，R6/R8/R9 未启动；原 FAIL/NOT_RUN/NOT_VERIFIED 保留。


## 快速验证

```powershell
npm ci
npm run verify:toolchain
npm run verify:fast
npm run build
node scripts/verify-full.mjs
```

`verify:full` 固定拥有隔离 Vite 端口 `4193`（development）和 `4194`（production preview）；其他自拥有 browser journeys 使用共享策略分配的随机 browser-safe 端口。它不会启动、停止或复用当前日常 `5174/8766` 或旧回退 `5173/8765`。

在本工作区执行 `npm run dev` 时，Vite 默认使用 `config/runtime.optimization.json`（`5184/8776` 和 optimization 数据根目录）。如需指定其他运行配置，可设置 `READ_WEB_RUNTIME_CONFIG`。

查看 daily-production 正式接管计划（默认无副作用）：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/launch-daily-production.ps1 -Action Plan -NoOpen
```

该入口只在用户明确确认后才允许 Apply；Apply 使用 built-dist Local App Host，不复制 workflow/media，不自动停止旧进程或接管未知端口。Rollback 只处理本 worktree 自己的 owned pair，不会访问或重启受保护的旧 Vite/dev 进程；旧 launcher/shortcut target 始终保留。六域 Host owner 未全部 checkpoint 时，状态必须显示 `legacy-browser-owner/pre-cutover`。

## 当前入口

```text
index.html
├── 9 个 src/composables/*.js 兼容/运行模块
└── src/main.js（先创建 Pinia，再导入 reader/session runtime 并挂载 Vue）
```

主要代码边界：

- `src/components/`：Vue 用户界面。
- `src/pinia-stores/`：7 个真实 Pinia store（audio、transcript、chunk、marks、UI、theme、annotation）。
- `src/pinia-stores/runtime-registry.js`：为非组件 runtime 提供显式 Pinia store registry，不发布 `window.__piniaStores`。
- `src/composables/`：Reader/Session 运行时组装与旧 DOM 行为迁移层。
- `src/services/persistence/`：IndexedDB、Reader Session 和 latest-wins 持久化边界。
- `src/services/runtime/`：生命周期、请求监管、错误呈现和 Object URL 资源所有权。
- `tools/subtitle-workflow/`：本地 FastAPI 材料处理服务。

## 数据约束

IndexedDB schema 在当前稳定化工作中保持不变：

```text
Database: SeekPlayerDB
Version: 1
Object store: files
Key path: id
```

改变数据库版本、object store 或 key path 必须有单独的数据迁移、备份和回滚方案。

## 已退役能力

`use-reader-session-persistence.js` 集中阅读 marks/activity/outbox 和页面事件接线。`App.vue` 创建并启动唯一保存范围，通过 module-local provide/inject 向 `YouTubeWorkflowPanel.vue` 提供只读会话状态和有限操作；面板卸载只取消其素材加载及 UI 订阅，核心保存继续存活。根卸载先取消登记的 loader，再关闭落盘并释放保存监听。R1 已独立 PASS；R2 已由父独立复审 PASS，见 [R2 独立报告](C:/Users/0/AppData/Local/Temp/reader-r2-independent-review-20261003-b20c8265/review.md)。合成生命周期覆盖不证明真实 BFCache，历史失败及未运行状态保留。

`read-26.html`、根 `app.js`、`reader-runtime-shell.js`、手工 chunk 导入、cloze UI、sentence/chunk notes UI 与对应 notes runtime 已退役。不要恢复它们，也不要把旧规划文档当作当前入口说明。

Cloze store/adapter 与当前 `manualChunkStates` 装配、恢复、快照及回滚字段也已退役；现有启动清理仍移除历史 `st.manualChunkStates` 偏好。未接入产品的预习 query-launch helper 和 translation queue 已删除，当前预习入口、翻译/预加载与 AI chunk 保留。

`runtimeState`、`bridgeToPinia` 通过模块导入使用；`window.__state`、`window.__piniaStores`、`window.bridgeToPinia` 以及 `__clozeState`、`__glassEffects`、`__legacyControlBindings` 发布已退休。glass 初始化和旧控件自动绑定仍正常接入。

## 稳定化计划

已完成的实施计划归档在 [openspec/changes/archive/2026-08-17-stabilize-and-simplify-read-web/](openspec/changes/archive/2026-08-17-stabilize-and-simplify-read-web/)；它覆盖性能测量、单一生产宿主、原子持久化、大媒体流式播放、后台可靠性、生命周期、兼容层收敛、仓库治理和最终迁移回滚。

历史设计和已完成迁移保留用于追溯，但若与当前代码冲突，以 `CURRENT_PROJECT_STATUS.md`、`PROJECT_MAP.md`、`docs/OPERATIONS.md` 和实际测试为准。

## SRS职责整理进度（R4）

SRS复习页的媒体状态、播放与资源释放已集中到 use-srs-review-media.js，整句翻译请求与缓存集中到 use-srs-review-answer-translation.js。页面继续协调active/卡切换、答案、评分、历史与快捷键；模板和皮肤保持。父按原 A1–A7 固定产品验收通过，见 [R4 独立复审](C:/Users/0/AppData/Local/Temp/reader-r347-independent-review-20261003-f4c052b7/bounded-closeout-20261003/R4-independent-review.md)。原辅助 18 组比较中 13 PASS、5 个 borderColor 过渡采样 FAIL、aggregate exit1 保留，不表示全部检查全绿；R6 未启动。


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
