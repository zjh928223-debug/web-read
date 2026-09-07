## Context

当前 production 路径已经不是单纯的 Vite dev server：`5184` 是稳定前门，FastAPI candidate Host 使用内部动态端口，`8776` 是仍承载九组 Node endpoint plugin 的 loopback capability sidecar。FastAPI Host 已能提供不可变 `dist`、workflow/owner API 与 Range 媒体，并通过 profile lease、activation journal 和 previous release 保持单机切换可恢复。

现有 contract 和六个 owner module 已具备 typed envelope、revision/CAS、idempotency 与 receipt，但当前 transport 明确限定为 loopback，优化 profile 仍处于 pre-cutover。浏览器端也仍存在 IndexedDB、localStorage、audio-folder 和兼容 outbox writer。跨机迁移的主要工作不是重写数据层，而是增加一个明确的 LAN transport mode，并按域移除 Mac 端 canonical writer。

用户只有一台 Mac 和一台 Windows。Mac 需要能够编辑前端源码，但不应承担 WhisperX、ffmpeg、yt-dlp、SQLite、ECDICT、AI provider、媒体存储或持久数据处理负载。

## Goals / Non-Goals

**Goals:**

- Mac 能在开发时运行轻量 Vite/HMR，并通过 dev proxy 使用 Windows API 与媒体。
- 日常使用时由 Windows 同源提供 production `dist` 和 `/api`，Mac 只运行浏览器前端。
- `private-lan` 必须显式启用；现有 loopback profile、端口和数据根保持不变。
- Windows 是六个持久域的唯一 canonical writer，Mac 只持有 view state、缓存和未确认 intent。
- 保持 Range/ETag、owner receipt、revision/CAS、profile lease 和 release rollback 等现有有效机制。
- 将实施拆成适合独立短对话执行的细粒度任务，并为每个实现任务安排独立 review。

**Non-Goals:**

- 不提供公网访问、远程互联网部署、多租户、HA、企业审计或自研 PKI。
- 不在第一版实现 QR pairing、短期 access/refresh token、自研证书更新或短期签名媒体 URL。
- 不构建 Mac 原生应用或 Tauri 包装，也不支持 Mac 离线 canonical persistence。
- 不支持 Mac 本地大媒体上传，也不让 Mac 远程弹出 Windows native picker。
- 不在本变更中将九组 Node capability 全部重写为 Python。
- 不拆分 Git 仓库，不搬迁大型源码目录，不修改 IndexedDB schema。

## Decisions

### 1. production 使用 Windows 同源页面

日常页面由 Windows Host 提供，Mac 浏览器直接访问 Windows 稳定前门。前端代码仍在 Mac 浏览器执行，但静态资源、API 和媒体共享同一 origin。

这比 Mac 长期运行独立静态服务器更适合个人工具：不需要 production CORS、backend base URL、跨域 Cookie 或媒体签名 URL，前后端 release 也不会因分别部署而自然漂移。

备选方案是 Mac 独立 static server/Tauri。它只在明确要求 Windows 不可用时仍需打开前端时有价值，本变更不采用。

### 2. development 使用 Mac Vite proxy

Mac checkout 可以编辑完整 Vue/CSS/JS。remote-dev Vite mode 禁用九组后端 plugin，并将 `/api`、event stream 和 Range 媒体代理到 Windows `5184`。业务代码继续使用相对 URL，Windows IP 只存在于 Mac 本地、非 `VITE_*` 的 server-side dev 配置中。

production 不依赖 Mac Vite。前端修改通过 Git 同步并进入 Windows release build；也可以由 Mac build 后将受校验的 `dist` 交给 Windows release 流程，但不维护独立运行版本。

### 3. 扩展稳定前门，而不是复用 8776

`5184` 继续作为外部稳定入口；`8776` 继续是 loopback capability sidecar；FastAPI candidate Host 继续使用内部端口。`private-lan` 只改变稳定前门的显式 bind/Host/Origin 规则，不允许 Mac 直连内部服务。

现有 `config/runtime.optimization.json` 保持不变。LAN 使用独立配置和独立 launcher 入口，避免影响日常 reader 与优化 profile。

### 4. 第一版采用个人局域网最小授权

不建设 pairing 和 PKI。运行模式限定在用户明确配置的家庭 LAN 地址，内部服务不公开，现有 service token/Host/Origin 检查继续保留。若用户所处局域网不可信，可在部署层使用现成私网方案；这不是应用内新系统。

### 5. 媒体保持同源相对 URL

复用现有 `authorizedUrl`、Range、ETag 与 media identity。descriptor 第一版不增加 `expiresAt`，不允许 Windows 路径和完整媒体进入 JSON。Mac remote-dev 由 Vite proxy 透明转发相对媒体 URL和 Range header。

### 6. 每个域只有一个 writer

迁移顺序保持：Reader Session、marks/activity、Workflow 闭环、Passage Preview/Annotation、Vocabulary/SRS。每个域先远程只读，再接入远程 command，最后用 authority checkpoint 阻断旧 writer。

`marks-activity` 是 marks 唯一写入 owner。Reader Session 只能携带 `marksRevision` 或只读 projection；Reader Session commit 不得覆盖 marks。

### 7. SRS 第一版不重写 scheduler

Mac 可以暂时复用现有 scheduler 计算，并使用 expected revision/CAS 将结果提交 Windows。只有实际测得 payload 或冲突问题后，才单独评估把 scheduler 深化到 Windows。

### 8. 源码布局保持不变

本变更通过配置、adapter、launcher 和 release artifact 建立部署边界，不通过立即创建 `apps/mac-web`、`backend/windows-host` 等目录制造大范围移动。跨机闭环稳定后，可另立 change 评估源码重排。

### 9. 实现和 review 分离

每个 `E-*` 实现任务必须由一个新对话执行，并输出基点、HEAD、diff 范围、测试和未解决事项。对应 `R-*` 由独立新对话只读审核。review 失败时使用新的 `F-*` 修复对话，之后重新 review。

并行只允许发生在文件集合不重叠的 lane。`App.vue`、`YouTubeWorkflowPanel.vue`、`src/main.js`、owner API client、production Host、request policy、launcher 和 contract 文件均视为串行热点。

## Risks / Trade-offs

- [Windows IP 变化导致 Mac dev proxy 失效] → Windows LAN 地址只保存在 Mac 本地配置，变更后只修改该配置；不把 IP 编译进前端 bundle。
- [开放稳定前门时意外暴露内部服务] → LAN 模式只绑定稳定前门，验收必须证明 internal Host 和 `8776` 从 Mac 不可达。
- [remote mode 仍触发浏览器 writer] → 每个域使用先读、再写、最后 checkpoint 的顺序，并以 writer inventory 和独立 review 阻断双 writer。
- [Mac dev proxy 破坏 Range/seek] → 在接入业务域前先完成真实 audio/video Range 与 seek 验收。
- [前端旧缓存与新 Host 不兼容] → health 暴露 release/contract compatibility；只支持当前版本和前一版本，失败时提示刷新。
- [任务过长导致执行模型臆造完成] → 一个任务只处理一个接口或用户路径；每项独立 review，阶段 gate 使用已集成 commit 重新验证。
- [真实数据迁移误伤日常版] → P0-P8 只能使用优化根；真实数据只读盘点、dry-run、正式迁移和接管分成不同任务，正式写入必须再次取得用户批准。

## Migration Plan

1. 固定已验收基点、部署决策、contract delta 和跨机验收清单。
2. 为稳定前门增加显式 LAN mode，并保持内部服务 loopback。
3. 在 Mac remote-dev 和 production 同源两种路径上验证 health、owner query、capability、polling 与媒体 Range。
4. Reader Session 先只读接入 Windows，再接入 commit，并阻断 remote mode IndexedDB writer。
5. 将 marks/activity 切到唯一 Windows owner，验证 revision、idempotency、receipt 和断线恢复。
6. 验证 YouTube workflow、library、任务控制和完成素材打开的完整闭环。
7. Passage Preview 与 Annotation 分 lane 迁移并集成。
8. Vocabulary/SRS 迁移到 Windows persistence，保留现有 scheduler 的第一版计算位置。
9. 清点并逐组关闭 remote mode 的旧 canonical writer，完成 build、升级兼容和 launcher 验收。
10. 在优化根执行 backup/restore rehearsal；之后才对日常真实数据做只读盘点和 dry-run。
11. 正式真实数据迁移、日常入口接管和回滚演练必须分别通过 review，并在写入前取得用户明确批准。

每个阶段失败时保持上一阶段的已集成 release 与 authority checkpoint，不跨阶段继续实施。需要回滚时撤回当前域的 checkpoint、恢复上一 release/backup，并重新验证旧 writer 是唯一 writer。

## Open Questions

- Windows LAN 地址由路由器 DHCP reservation、固定 IP 还是现成私网名称提供，由部署时选择；应用只要求一个稳定可配置地址。
- Mac 主要验收浏览器是 Safari 还是 Chrome，需要在 P2 开始前确定；至少完整验证用户日常使用的一个浏览器。
- 前端 production build 最终固定在 Windows 构建，还是允许 Mac 生成后交由 Windows manifest 校验，可在 P8 根据实际工作流选择。
