# Read-Web Optimization Current Project Status

Last verified: 2026-08-30

本文档描述 `E:\read-web-next-optimization` 的当前事实。`E:\read-web-next` 是受保护的日常 reader，`E:\read-web` 是历史只读参考；两者不得被本工作区读取、构建、启动或写入。

## Optimization owner milestone (2026-08-30)

六域 C2 已在临时 optimization profile 中按 `Reader Session → marks-activity → passage-preview →
annotation → vocabulary-srs → workflow` 完成真实 Host cutover journey。每域都经过只读 inventory/dry-run、
持久 freeze、freeze 后 final backup/checksum、唯一 import、verify、per-domain checkpoint、typed smoke 和
Local App Host 重开读取；已打开 browser guard 能在 final backup 前观察 freeze。成功 checkpoint 后旧的
browser canonical writer 由 domain guard 阻断，typed Host API 是 durable mutation path；未有 checkpoint 的
普通 profile 仍保持 pre-cutover/not-ready。

生产入口是显式 optimization-only 的 `runWindowsOwnerProductionCutover`，只使用隔离 profile，不自动迁移
日常数据，不改变外部 shortcut，也不开放非-loopback transport。完整媒体仍只传 identity/reference 与授权
Range URL，`SeekPlayerDB` 仍为 v1/files/id，`reader-runtime.js` 与 `session-init.js` 仍为薄入口。

受控的一次性 wrapper 是 `scripts/windows-owner-production-entry.mjs`，提供显式 `plan`、`inventory`、
`dry-run`、`apply`、`resume`、`rollback` 命令。apply/resume 需要当前 browser guard 在每个 freeze 后提供
evidence；wrapper 目前只做 fixture verification，不读取或迁移日常 profile。

已通过的核心证据包括 `npm run verify:windows-owner-c2`、C1/C2b/C2c 与六域 owner focused gates、
`npm run verify:windows-owner-focused-boundaries`、`npm run build`、`npm run verify:fast`、test inventory
和 OpenSpec strict validation。`npm run verify:full` 在既有 Python dependency-health 阶段因安装环境中同时
存在多个 `networkx` 与 `torchaudio` 版本而停止，未把该阻断后的阶段当作通过。

## 本轮单人工具优化收尾（2026-09-13）

本节只记录 `task-op-1`～`task-op-14` 的局部优化边界，不修改文档顶部的全仓库 `Last verified: 2026-08-30`，也不表示历史 Host、发布、迁移或 full 验证结果已被重新核实。

六个方向的状态如下：

1. 健康检查请求协调：完成。
2. 优化环境默认配置：完成。
3. 大文件职责拆分：本轮既定前端边界已收尾；预习、outbox、保存队列/冲突、播放跟踪和标记恢复已有独立所有者，面板仍保留材料操作与生命周期接线。
4. 长材料渲染：共享高亮索引、句高亮局部更新和普通/chunk 模式切换优化已收尾。
5. 学习页面按需加载：完成；SRS 与 Passage Preview 页面延迟加载，设置弹窗保持静态加载。
6. 旧检查与文档整理：本批入口核对、旧 panel 兼容入口保留和架构文档同步完成。

task-op-12/13 的历史报告显示，10,000 词材料的稳定跨帧切换 p95 为普通→chunk `38.8～42.0ms`、chunk→普通 `52.9～59.2ms`，句高亮约 `13ms` 且长任务为零。上述数字来自隔离 Vite 开发环境的合成材料测量，本批没有复测；稳定跨帧计时与原 mode 计时不可混用。剩余布局成本不在本轮继续拆分，也不作为追加虚拟列表任务的理由。

### 本轮检查入口与归属

| 范围 | 当前入口 | 归属与边界 |
| --- | --- | --- |
| transcript state | `npm run verify:transcript-state` | package.json 正式行为入口 |
| panel V3 | `npm run verify:youtube-workflow-panel`；浏览器为 `npm run verify:youtube-workflow-panel-behavior` | package.json 正式入口；旧 `node scripts/youtube-workflow-panel-check.cjs` 保留并转接 V3 |
| reader marks hydration | `node scripts/reader-marks-hydration-check.mjs` | inventory-only focused behavior 入口 |
| reader playback tracker | `node scripts/reader-playback-tracker-check.mjs` | inventory-only focused behavior 入口 |
| workflow reader marks ledger | `npm run verify:workflow-reader-ledger` | package.json 正式架构/行为入口 |
| learning page lazy load | `node scripts/learning-page-lazy-load-check.cjs` | inventory-only browser 入口；沿用已有 Vite 与 dist preview 前置 |
| vocabulary preview UI | `npm run verify:vocabulary-preview-ui` | package.json 正式 browser/behavior 入口；无 `READ_WEB_URL` 时脚本自启隔离 Vite |
| sentence highlight UI | `node scripts/sentence-highlight-ui-check.mjs` | inventory-only browser 入口；默认自启隔离 Vite |
| playback scale capture/diagnostics | `npm run verify:performance:playback-scale` | package.json 性能入口；sentence/mode 诊断仍由既有环境变量可选开启，本批不再做性能实验 |

panel browser 检查继续使用既有 `READ_WEB_URL`/运行中 Vite 前置；playback-scale 入口默认自启隔离服务。上述入口未重新串成总入口，`docs/architecture/script-inventory.json` 与 `docs/architecture/test-inventory.json` 本批无须改动。

本批不刷新 Host cutover、发布、数据迁移、旧 full 结果或 BFCache 的既有合成覆盖；这些历史边界仍按原文记录处理。

## 1. 产品与运行形态

Read-Web 是本地英语学习应用，前端为 Vite + Vue 3 + Pinia，材料处理服务为 FastAPI。当前可用能力包括：

- 音视频与同步字幕阅读；
- word/sentence/chunk 高亮、seek 和跟随；
- marks、轻量 annotation 导入/导出；
- YouTube/本地材料处理工作流；
- 词汇预习、SRS、个性化只读诊断；
- 可选本地 ECDICT、句库、TTS 与翻译服务。

应用仍是混合架构。Vue/Pinia 和 legacy DOM/window 兼容层并存；稳定化工作按边界逐步移除兼容面，而不是一次性重写。

## 2. 当前入口与加载顺序

浏览器入口是 `index.html`，不是已退役的 `read-26.html`。

```text
index.html
├── glass/app/style/import/keyboard/media/playback/controls/legacy bindings
└── src/main.js
    ├── 创建 Vue 与 Pinia
    ├── 配置显式 runtime store registry 并绑定 state adapter
    ├── 导入 reader/session 薄入口
    └── 挂载 App.vue
```

`reader-runtime.js` 和 `session-init.js` 都是薄入口。功能逻辑应进入 focused module、service、store 或 Vue component，不应重新堆进入口文件。

## 3. 状态与数据所有权

- `src/pinia-stores/` 是真实 Pinia 状态所有者。
- theme/audio/marks/UI 状态由 `src/pinia-stores/` 单独拥有；旧 `src/stores/` 启动兼容层已删除。
- `runtimeState` 和 `bridgeToPinia` 只通过模块导入使用；`window.__state`、`window.__piniaStores` 与 `window.bridgeToPinia` 已删除。
- `ApplicationPersistence` 统一打开 `SeekPlayerDB` v1/files，并以 transaction complete 作为成功条件。
- YouTube Reader Session 已具备 generation/abort/latest-wins 与 committed manifest/revision/contentId 校验；损坏的 committed session fail-closed。
- marks/activity 通过 latest-wins ledger 合并写入。
- 大媒体通过授权 URL、HTTP Range、ETag 播放；Blob/Object URL 必须由显式 owner 释放。

IndexedDB 固定为：

```text
SeekPlayerDB / version 1 / files / keyPath id
```

## 4. 本地后台

`tools/subtitle-workflow/youtube_workflow/service.py` 提供材料任务、历史、媒体 Range、Reader activity/marks、维护和诊断接口。

当前可靠性边界包括：

- loopback Host/Origin 校验；可选短期 token capability；
- batch job snapshot 与前端 single-flight polling；
- 有界内存 event ring，持久化 snapshot 不保存完整 stdout；
- crash-safe JSON temp/fsync/replace/backup/recovery；
- requestId、Server-Timing 和有界 route metrics；
- NativePicker 的单实例、超时、取消与 typed outcome；
- app lifespan 负责关闭 worker/timer 并完成最终持久化。

Vite 仍承载 9 组本地能力插件。optimization 已有 built-dist 单一 Local App Host；daily-production 入口也只允许以 built-dist Host 作为候选，但它不会把未完成的六域 owner migration 伪装成 authoritative。

## 5. 性能与已确认风险

已确认并正在处理的主要风险：

- 大材料打开链必须保证不下载并复制整份 300–540MB 媒体；
- Reader feature/session assembly 仍有过宽参数袋和较多 global ordering；
- 个别持久化域仍是多文档、无 CAS 或 legacy writer；
- AI/backfill、外部进程取消和资源分阶段队列仍需深化；
- 源码形状 guard 很多，行为与性能门禁仍在逐步补齐；
- `YouTubeWorkflowPanel.vue` 仍保留材料操作、标记应用、网络/关闭补发与生命周期接线；本轮已拆出的 outbox、保存队列/冲突、播放跟踪和标记恢复职责有独立所有者。`tools/subtitle-workflow/youtube_workflow/service.py` 仍是独立的后台维护问题，不能被本轮前端整理视为已解决，也不在本批新增任务。

性能预算目前区分 diagnostic baseline 与 enforced gate，不用拍脑袋的数字伪装完成。浏览器 journeys 会采集错误、请求失败、Long Task 与交互时延；后端 benchmark 使用隔离端口和临时数据。

## 6. 验证层级

- `npm run verify:fast`：固定工具链与关键纯行为检查。
- `node scripts/verify-full.mjs`：fast、build、隔离 dev journeys、production preview、完整 Python suite。
- focused `verify:*`：模块迁移与架构边界检查。
- `verify:ui-compatibility-store`：UI Pinia 唯一 owner、retired `__uiStore` 缺失与可见 toast/error 行为检查。
- `openspec validate stabilize-and-simplify-read-web --strict`：规格结构校验。

`npm test` 当前执行 canonical `verify:full`。12.3 已用真实 browser/workflow 数据的只读副本完成六域隔离恢复、重开、checksum 与六条旅程验证；12.4 已完成三次冷启、30 分钟播放、A/B/A 快速切换、服务重启、进程取消、36 格 Quota/损坏恢复和内存增长验收。12.5 已完成旧版与 Next 的同 fixture 三轮差分：两版各 21/21 journeys、零浏览器/网络错误，十项指标中六项改善，总体比率 1.055。12.6 已补齐 current/previous manifest、逐 artifact SHA-256、health 与原子 release-target rollback；12.7 已完成快捷方式隔离回滚演练。真实桌面快捷方式不属于本 worktree 验证范围，daily-production promotion 仍需新的明确确认。

## 7. 隔离与迁移状态

- 优化 workspace：`E:\read-web-next-optimization`；手工 built Host 使用 `5184/8776` 与 `E:\ReadWebData\SubtitleWorkflow-Optimization`。
- Tailnet 入口是本 change 新增的显式例外：手动运行 optimization launcher 后，由 Tailscale Serve 将
  `127.0.0.1:5184` 发布为 tailnet 私有 HTTPS `:5184`；不新增通用 transport mode，不启用 Funnel，
  内部 Host 动态端口与 `8776` 继续 loopback。完整 MagicDNS 名称只在运行时传入前门参数，不提交到代码。
- 当前日常安装/工作区：`E:\read-web-next`，现有 origin 使用 `5174/8766` 与 `E:\ReadWebData\SubtitleWorkflow-Next`；该树和现有 Vite/dev 兼容 launcher 受保护。
- daily-production 候选由本 worktree 的独立 launcher 以 built-dist Host 提供，不能把当前日常 origin 的现有 Vite/dev owner 误写成 built Host。
- 旧日常回退参考：`E:\read-web`，`5173/8765`；不得由本 worktree 构建、启动或写入。
- 自动浏览器验证使用 `4193/4194` 和随机 browser-safe 端口，并排除上述两组日常端口。
- 桌面快捷方式不属于本次实现范围；验证不会读取、改写或删除它。正式切换必须另行获得用户明确确认，并保留旧目标。

此前的 Next 迁移记录仅作为历史上下文；本次 daily-production promotion 不默认重放该切换，也不把快捷方式状态当作本 worktree 的事实。

### daily-production promotion（显式、最小入口）

`scripts/launch-daily-production.ps1` 默认执行只读 `Plan`，固定识别 profile `daily-production`、当前日常 `5174/8766` 和 `SubtitleWorkflow-Next`。`Apply` 必须带 `-ConfirmDailyProductionApply`；它只构建并启动本 worktree 产出的 built-dist Host，要求两个端口空闲，不会自动停止旧进程，也不会接管未知占用者。`Start`、`Stop`、`Rollback` 均使用 PID/start-time/executable/argument、health、release、profile 和 data-root identity；release、目标状态和 rollback state 分开保留。

Host health 的 `ownerMode.authoritativeDomains` 未覆盖 `reader-session`、`marks-activity`、`passage-preview`、`annotation`、`vocabulary-srs`、`workflow` 六域时，promotion 输出 `legacy-browser-owner/pre-cutover`；只有六域全部 checkpoint 后才能显示 `host-api-authoritative`。

## 8. 文档优先级

当前事实按以下顺序判断：

1. 实际代码与可重复测试；
2. 本文档；
3. `PROJECT_MAP.md`；
4. `docs/OPERATIONS.md`；
5. `AGENTS.md`。

标有“历史/Archived”的设计与迁移文档只用于追溯，不是当前操作说明。
