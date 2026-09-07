## Why

Read-Web 目前以 Windows loopback 单机模式运行，前端页面、持久数据、媒体、AI 能力和重型 workflow 都依附于同一台机器。用户希望在 Mac 上编辑和使用 Vue 前端，同时继续由 Windows 独占数据、媒体、密钥、SQLite、WhisperX、ffmpeg、yt-dlp 和 AI 等后端负载，因此需要在不推翻现有 Windows owner、稳定前门和回滚机制的前提下增加受控的局域网运行模式。

本变更面向一名用户、一台 Mac 和一台 Windows 的个人工具，优先保证功能闭环、唯一 writer、数据可回退和小任务可审核；不建设公网服务、企业级认证、多租户、HA、审计平台或自研 PKI。

## What Changes

- 增加显式 `private-lan` 运行模式，同时保留现有 loopback 模式为默认值。
- 由 Windows 稳定前门统一提供 production `dist`、owner API、workflow API、capability API 和 Range 媒体；内部 FastAPI candidate Host 与 `8776` Node capability sidecar 继续只监听 loopback。
- 支持 Mac 上的远程前端开发模式：Mac 运行轻量 Vite/HMR，Vite 仅代理 `/api` 与媒体请求到 Windows，不在 Mac 启动九组后端 Vite plugin。
- Windows 成为 Reader Session、marks/activity、Passage Preview、Annotation、Vocabulary/SRS 与 Workflow 的唯一 canonical writer；Mac 只保留视图状态、短期缓存和未确认 intent。
- 明确 `marks-activity` 是 marks 的唯一写入 owner；Reader Session 只携带 marks revision 或只读 projection。
- 保持相对、同源媒体 URL，复用现有 Range/ETag/media identity，不在第一版增加短期签名 URL。
- 采用小粒度、分阶段迁移：LAN 前门、网络基础、Reader Session、marks/activity、Workflow、Preview/Annotation、Vocabulary/SRS、发布和真实数据接管。
- 每个实现任务都绑定独立只读 review 任务；阶段末增加集成 gate。review 只报告会导致启动失败、功能回归、数据错误、双 writer、跨机不可用、媒体失败或无法回滚的 P0-P2 问题。
- 保持 monorepo 和现有源码目录，不在跨机迁移阶段同时搬迁 `src/` 或 `tools/subtitle-workflow/`。
- 正式数据接管与开发迁移分离；在获得用户明确批准前，只能使用优化工作区和 `E:\ReadWebData\SubtitleWorkflow-Optimization`。

## Capabilities

### New Capabilities

- `private-lan-reader-host`: Windows 稳定前门的显式局域网模式、同源页面/API、内部服务 loopback 隔离及 Mac 访问行为。
- `mac-remote-frontend-development`: Mac 上编辑 Vue 前端、运行轻量 Vite/HMR，并将 API、polling 和 Range 媒体代理到 Windows 的开发模式。
- `windows-authoritative-learning-domains`: 六个持久域的跨机读取、逐域 writer 接管、marks 单一 owner、receipt/CAS 与本地 writer 退役规则。
- `cross-machine-release-cutover`: 分阶段 release、跨机验收、优化数据演练、真实数据 dry-run、显式接管和回滚要求。

### Modified Capabilities

- `local-application-host`: 在保持 loopback 默认与 production host 语义的同时，允许显式配置的 `private-lan` 稳定前门向 Mac 提供同源页面和 API。
- `reliable-reader-session`: Reader Session 的 authoritative persistence 从浏览器 IndexedDB 迁移到 Windows owner，并将 marks 从会话写入中分离。
- `durable-application-data`: remote mode 下 Windows 成为唯一 canonical writer，浏览器持久层降为迁移/回滚 adapter 或非权威临时状态。
- `workflow-service-reliability`: Mac 通过 Windows 单一入口使用 job、polling、library 和媒体；第一版不远程触发 Windows native picker，也不要求 SSE。

## Impact

- 主要影响 `tools/optimization-stable-front-door.mjs`、Windows request policy、production Host、LAN 专用 RuntimeConfig/launcher、Mac remote-dev Vite 配置、owner API/media adapters、Reader Session 和各学习域的浏览器 writer。
- 保留 `config/runtime.optimization.json` 的 `127.0.0.1:5184/8776` 与优化数据根约束；LAN 模式使用独立配置和启动入口。
- 不改变 `SeekPlayerDB` 名称、version、`files` store 或 key path。
- 不修改受保护的 `E:\read-web-next`、`E:\read-web` 或日常真实数据，除非后续真实接管任务取得用户明确批准。
- 实施采用一个任务一个新对话、`gpt-5.6-luna` + `max` 推理强度、独立 review 与阶段 gate 的执行方式。
