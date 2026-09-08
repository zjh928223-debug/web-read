## Context

当前 Windows private-LAN 基础已经完成：稳定前门监听显式 LAN 地址，内部 FastAPI Host 与 `8776` sidecar 保持 loopback，并继续使用独立 optimization profile、端口和数据根。

本项目只有一名用户、一台 Mac 和一台 Windows。Mac 是浏览器阅读器；Windows 是唯一后台和数据所在机器。剩余工作的衡量标准不是建立完整的分布式系统，而是用户能否在 Mac 上完成日常学习流程，且刷新或手动重启 Windows launcher 后数据仍能从 Windows 恢复。

## Goals / Non-Goals

**Goals:**

- Windows 一次启动后给出 Mac 可以打开的 URL。
- Mac 不安装或运行 Read-Web 后台，直接使用 Windows production 页面。
- Mac 能打开 Windows 素材，显示 transcript/chunk，并正常播放、暂停和 seek。
- marks 能保存到 Windows；Mac 能提交 URL，由 Windows 完成现有下载/处理，并在 Mac 查看基本状态和打开结果。
- Preview、Annotation、Vocabulary 和 SRS 只做低成本现状确认，不默认阻塞第一版迁移。
- 页面刷新，或用户停止后台、手动重新运行 Windows launcher 后，Mac 刷新或重试即可恢复必用数据。
- 先在 optimization 数据上完成整条旅程；真实数据只在用户明确授权后备份和切换。

**Non-Goals:**

- 网段扫描、自动发现、MAC 地址或设备指纹。
- 公网访问、多用户、多租户、HA、rate limit、企业审计或复杂认证。
- QR pairing、refresh token、自研 TLS/PKI、短期签名媒体 URL。
- Mac 原生应用、Tauri、Mac production server、Mac 后台或离线 canonical persistence。
- 新建通用同步系统、browser outbox、逐域 checkpoint、复杂 receipt recovery 或长期兼容矩阵。
- 为理论威胁、模拟攻击或企业部署要求扩大实现范围。
- 在跨机可用目标中同时重构目录、重写 scheduler 或重写九组 capability。
- Windows 开机自启、无感自动重连、后台任务断点续作、launcher daemon 或系统服务安装。
- workflow 的 cancel/retry/prioritize 全面重构、远程 NativePicker、SSE 或管理后台。

## Decisions

### 1. 日常路径只有一个入口

Windows stable front door 是 Mac 唯一入口：

```text
Mac browser
    -> http://<windows-lan>:5184
        -> production dist
        -> relative /api requests
        -> relative media requests with Range
            -> Windows internal Host / sidecar / data
```

Mac 不直连内部 Host 或 `8776`，也不需要知道 Windows 文件路径。production 不以 Mac Vite remote-dev 为前置条件；以后确实需要在 Mac 上做 HMR 时再单独增加，不阻塞当前目标。

### 2. 复用现有能力，只修真实阻塞

现有 owner contract、revision、idempotency、receipt、Range/ETag、profile lease 和 launcher 行为如果已经工作，原样复用。实施任务先运行真实路径，再定位失败 seam；不得为了统一架构而重写可用模块。

单用户并不要求删除既有保护，但也不新增多用户并发体系。长任务仍应避免一次点击被重复启动；普通个人操作不为理论并发构建新协议。

### 3. Windows 保存业务数据，Mac 本地状态可丢弃

Mac 可以保存主题、面板状态、临时缓存等 UI 状态。第一版必用的 Reader Session、marks 和 workflow 结果必须能够仅凭 Windows 数据恢复。Preview、Annotation、Vocabulary 和 SRS 不默认阻塞迁移；低成本检查发现问题时记录并暂缓，除非用户明确提升其优先级。

不要求一次性清除所有历史 IndexedDB/localStorage 代码，也不建立逐域 authority checkpoint。验收只要求第一版必用路径不依赖 Mac 上唯一存在的业务数据：清除 Mac 缓存或换一个浏览器后，Windows 中已保存的必用数据仍能重新加载。

### 4. 一个实现任务覆盖 optimization 完整旅程

不再按 API、数据域或文件拆分 E/R/G。一个 `E-201` 对话持续工作到 optimization 完整旅程通过，内部可以按以下顺序推进，但不因此创建新任务：

1. 启动 Windows LAN 模式并从 Mac 打开页面。
2. 修复页面、API 和媒体中的跨机地址问题。
3. 验证 Reader、transcript/chunk、播放和 seek。
4. 验证 marks 与页面刷新恢复。
5. 验证 Mac 提交 URL、Windows 完成现有下载/处理、Mac 查看基本状态并打开完成素材的 workflow 主路径。
6. 停止后台、手动重新运行 Windows launcher，再由 Mac 刷新或重试并恢复必用数据；不要求开机自启、无感重连或任务断点续作。
7. 对 Preview、Annotation、Vocabulary 和 SRS 做低成本现状确认；已工作则不改，失败则记录为非阻塞项，不在 `E-201` 中继续扩张。
8. 运行相关 focused checks、build、production preview 和 LAN smoke。

只有第一版必用路径完成后才创建一个新的 `R-201` 只读审核对话。辅助功能的问题不阻止任务完成，除非用户在执行前明确将某项列为必用。

### 5. Review 只判断真实个人旅程

`R-201` 以 `E-201` 的实机结果、代码 diff 和测试结果为主要证据，只复跑低成本检查、可疑路径或证据缺口，不无理由重复下载、转录、AI 处理等耗时操作。它只接受以下 P0-P2 finding：

- Windows LAN 模式不能启动或 Mac 不能打开页面；
- 素材、transcript/chunk、播放或 seek 不可用；
- 用户操作没有保存到 Windows，或刷新/重启后数据丢失；
- workflow 不能完成 Mac 提交 URL、Windows 下载/处理、Mac 查看基本状态并打开结果的主路径；
- optimization/daily 环境发生串写；
- 浏览器收到不应出现的 secret、完整 Windows 路径或内部端口；
- 本次修改造成明确的现有功能回归。

网段扫描、设备识别、多用户竞争、HA、rate limit、企业认证、压力测试、复杂攻击输入和证据系统完善度不属于 review acceptance criteria。

若审核发现真实问题，只允许一次范围明确的 `F-201` 修复和一次 fresh re-review。第二次仍失败则停止并由用户决定，不扩张为持续修复循环。

### 6. 真实数据切换是独立授权动作

optimization 旅程 PASS 后，`E-301` 必须再次取得用户明确授权才可以检查或处理日常真实数据。动作限制为：

1. 只读确认第一版必用数据实际位于 Windows 数据根、Windows 浏览器 IndexedDB/localStorage 还是其他现有位置。
2. 暂停旧入口写入，确认备份位置，创建普通可恢复备份并确认其存在。
3. 必要时只复用项目已有导出/导入能力，不新建迁移框架。
4. 将已验收入口切换到真实数据配置。
5. 重点确认旧素材和 marks 可见、产生一次新保存、手动重启 launcher 后仍可恢复；复用 optimization 已验证结果，不重复无关的下载、转录或 AI 流程。
6. 若失败，停止新入口并恢复原配置；不删除原数据。

不建设 migration 平台、逐域 checksum 证据包或企业级 rollback rehearsal。若真实数据格式确实不兼容，停止并把它作为一个具体问题报告给用户，而不是预先设计所有迁移分支。

## Risks / Trade-offs

- [Windows LAN 地址变化] → 用户修改或重新解析当前地址并重启；不实现扫描或设备发现。
- [家庭 LAN 中其他设备可访问页面] → 保留已经实现的 Host/Origin/token 和内部服务 loopback 边界；不增加账号系统。
- [Mac 浏览器缓存掩盖 Windows 持久化缺口] → optimization 旅程包含刷新、清除可丢弃缓存或新浏览器恢复，以及手动重启 launcher。
- [单个实现任务较长] → 使用 `gpt-5.6-luna/max` 的一个持续对话按真实路径逐步排障，避免大量任务创建、上下文交接和重复审核。
- [真实数据切换出错] → 切换前做普通备份，保留原数据和旧配置；失败立即停止，不做破坏性清理。

## Execution Plan

1. `E-201`：在 optimization 数据上一次性完成 Mac → Windows 真实个人使用路径。
2. `R-201`：新的只读对话进行一次完整验收；只报告既定真实 P0-P2。
3. 若需要，执行一次 `F-201` 和一次 fresh `R-201`；否则直接继续。
4. 用户明确批准后执行 `E-301`：备份并切换真实数据。
5. `R-301`：最终只读验收，PASS 后即可归档 change。

所有任务严格串行，使用项目 local 环境、`gpt-5.6-luna`、`reasoning effort=max`，不得使用 Git worktree。

## Open Questions

- 最终实机验收使用 Mac 上用户日常采用的浏览器；无需为了本规划预先支持多个浏览器。
- 第一版必用范围固定为 Reader、transcript/chunk、播放/seek、marks 和 URL workflow；Preview、Annotation、Vocabulary、SRS 默认非阻塞，用户以后可单独提升优先级。
