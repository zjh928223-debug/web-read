# Read-Web Current Project Status

Last verified: 2026-08-16

本文档只描述 `E:\read-web-next` 的当前事实。日常学习版仍在 `E:\read-web`；两者不得混用进程、端口或写数据目录。

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
├── 3 个 src/stores 兼容 store
├── glass/app/style/import/keyboard/media/playback/controls/legacy bindings
├── src/composables/reader-runtime.js
├── src/composables/session-init.js
└── src/main.js
    ├── 创建 Vue 与 Pinia
    ├── 绑定兼容 state adapter
    └── 挂载 App.vue
```

`reader-runtime.js` 和 `session-init.js` 都是薄入口。功能逻辑应进入 focused module、service、store 或 Vue component，不应重新堆进入口文件。

## 3. 状态与数据所有权

- `src/pinia-stores/` 是真实 Pinia 状态所有者。
- `src/stores/` 是预 Pinia 启动兼容层，仅为仍未迁移的 `window.*` 调用者服务；UI toast/error 已直接由 Pinia `ui` store 与 `ui-facades` 提供，不再加载 UI compatibility store。
- `runtime-state-facade.js`、state adapter 和 `pinia-bridge-module.js` 是待收敛的兼容边界。
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

Vite 仍承载 9 组本地能力插件。正式单一 Local App Host 已有原型，但尚未成为最终发布宿主，因此单独部署 `dist/` 仍不是完整产品。

## 5. 性能与已确认风险

已确认并正在处理的主要风险：

- 大材料打开链必须保证不下载并复制整份 300–540MB 媒体；
- Reader feature/session assembly 仍有过宽参数袋和较多 global ordering；
- 个别持久化域仍是多文档、无 CAS 或 legacy writer；
- AI/backfill、外部进程取消和资源分阶段队列仍需深化；
- 源码形状 guard 很多，行为与性能门禁仍在逐步补齐；
- `YouTubeWorkflowPanel.vue` 和后台 service 仍过大，需在可靠性边界稳定后按领域拆分。

性能预算目前区分 diagnostic baseline 与 enforced gate，不用拍脑袋的数字伪装完成。浏览器 journeys 会采集错误、请求失败、Long Task 与交互时延；后端 benchmark 使用隔离端口和临时数据。

## 6. 验证层级

- `npm run verify:fast`：固定工具链与关键纯行为检查。
- `node scripts/verify-full.mjs`：fast、build、隔离 dev journeys、production preview、完整 Python suite。
- focused `verify:*`：模块迁移与架构边界检查。
- `verify:ui-compatibility-store`：UI Pinia 唯一 owner、retired `__uiStore` 缺失与可见 toast/error 行为检查。
- `openspec validate stabilize-and-simplify-read-web --strict`：规格结构校验。

`npm test` 当前执行 canonical `verify:full`。12.3 已用真实 browser/workflow 数据的只读副本完成六域隔离恢复、重开、checksum 与六条旅程验证；12.4 已完成三次冷启、30 分钟播放、A/B/A 快速切换、服务重启、进程取消、36 格 Quota/损坏恢复和内存增长验收。12.5 已完成旧版与 Next 的同 fixture 三轮差分：两版各 21/21 journeys、零浏览器/网络错误，十项指标中六项改善，总体比率 1.055。12.6 已补齐 current/previous manifest、逐 artifact SHA-256、health 与原子 release-target rollback。发布仍被 12.7–12.8 的快捷方式回滚演练和用户确认门禁阻断。

## 7. 隔离与迁移状态

- Next workspace：`E:\read-web-next`，分支 `codex/read-web-next`。
- Next 预览：`5174/8766`；自动浏览器验证：`4193/4194/4195`。
- 日常版：`E:\read-web`，`5173/8765`。
- Desktop shortcut 仍指向日常版。
- 当前不允许自动切换快捷方式。

只有在构建、行为、性能、数据备份/恢复、长时运行、故障注入、Release Manifest 和回滚演练全部通过，并再次获得用户确认后，才可迁移快捷方式。

## 8. 文档优先级

当前事实按以下顺序判断：

1. 实际代码与可重复测试；
2. 本文档；
3. `PROJECT_MAP.md`；
4. `docs/OPERATIONS.md`；
5. `AGENTS.md`。

标有“历史/Archived”的设计与迁移文档只用于追溯，不是当前操作说明。
