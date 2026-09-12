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
- `src/pinia-stores/`：真实 Pinia store。
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

`read-26.html`、根 `app.js`、`reader-runtime-shell.js`、手工 chunk 导入、cloze UI、sentence/chunk notes UI 与对应 notes runtime 已退役。不要恢复它们，也不要把旧规划文档当作当前入口说明。

## 稳定化计划

已完成的实施计划归档在 [openspec/changes/archive/2026-08-17-stabilize-and-simplify-read-web/](openspec/changes/archive/2026-08-17-stabilize-and-simplify-read-web/)；它覆盖性能测量、单一生产宿主、原子持久化、大媒体流式播放、后台可靠性、生命周期、兼容层收敛、仓库治理和最终迁移回滚。

历史设计和已完成迁移保留用于追溯，但若与当前代码冲突，以 `CURRENT_PROJECT_STATUS.md`、`PROJECT_MAP.md`、`docs/OPERATIONS.md` 和实际测试为准。
