# Read-Web

Read-Web 是一个本地运行的英语学习阅读器，使用 Vite、Vue 3、Pinia 和 FastAPI。它支持音视频材料、同步字幕、AI 语块、标记、轻量标注、词汇预习、SRS 复习和本地词典。

项目目前仍是混合架构：Vue/Pinia 已承担主要界面和状态，但启动链仍保留一组 `window.*` 与 DOM 兼容边界。不要把它当成已经完成的纯 Vue 重写。

## 当前工作区

本目录 `E:\read-web-next` 是下一版的隔离开发工作区，分支为 `codex/read-web-next`。

- 日常使用版仍位于 `E:\read-web`，使用 `5173/8765`。
- Next 开发预览使用 `5174/8766`。
- 桌面快捷方式在所有发布门禁通过并获得用户确认前不得切换。
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

`verify:full` 只使用隔离端口 `4193/4194`，包含 fast gate、生产构建、3 条浏览器旅程、production preview 和后端测试。它不会启动、停止或复用日常版 `5173/8765`。

启动 Next 预览：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/launch-next-preview.ps1
```

## 当前入口

```text
index.html
├── 7 个 src/stores/*.js 兼容 store
├── 9 个 src/composables/*.js 兼容/运行模块
├── src/composables/reader-runtime.js
├── src/composables/session-init.js
└── src/main.js（Vue + Pinia）
```

主要代码边界：

- `src/components/`：Vue 用户界面。
- `src/pinia-stores/`：真实 Pinia store。
- `src/stores/`：启动期 `window.*` 兼容 store，不是 Pinia。
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

当前实施计划在 [openspec/changes/stabilize-and-simplify-read-web/](openspec/changes/stabilize-and-simplify-read-web/)；它覆盖性能测量、单一生产宿主、原子持久化、大媒体流式播放、后台可靠性、生命周期、兼容层收敛、仓库治理和最终迁移回滚。

历史设计和已完成迁移保留用于追溯，但若与当前代码冲突，以 `CURRENT_PROJECT_STATUS.md`、`PROJECT_MAP.md`、`docs/OPERATIONS.md` 和实际测试为准。
