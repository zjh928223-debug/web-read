## 为什么

当前 Read-Web 已有 Windows 本机 `Local App Host`、`ApplicationPersistence`、Reader Session 原子切换、Range media 和六域备份/恢复基础，但浏览器运行时仍有部分 durable state 直接写入 browser storage。这样会留下两个 owner、恢复边界不清，以及“请求成功”与“数据已安全提交”难以区分的问题。

本变更把 Windows loopback Host 定义为个人工具的唯一 durable owner，让 browser 成为薄 Reader，并在未来跨设备 transport 之前固定最小的 ownership、校验、备份和回退语义。范围只面向单人、单机、Windows loopback 使用，不追求多租户、高可用或企业级审计系统。

## 变更内容

- **BREAKING**：Windows `Local App Host` 最终成为 `Reader Session`、`Vocabulary/SRS`、`Preview`、`Annotation`、`marks/activity`、`workflow` 六个 durable domain 的唯一 canonical owner；browser 通过 typed owner API 读写，完成切换后不再直接写 canonical `IndexedDB`、`localStorage` 或 JSON。
- 保留已经完成的 1.x–3.x 与 4.1 基础：owner registry、loopback/auth、lease/receipt、typed API、media capability/no-copy 检查，以及 `ReaderSessionOwner` 的 query/prepare/commit/restore。它们不在本次范围精简中拆除或返工。
- 为剩余五域建立必要的 query/command/receipt seam；每个 domain 使用可解释的 revision/CAS、幂等 key、atomic write、checksum、失败保留旧值和最小恢复状态。
- 以逐域顺序完成 `read-only inventory → dry-run/容量与格式检查 → freeze old writer → final backup/checksum → one-time final copy/import → verify → switch Host authoritative writer → smoke check → rollback if needed`；freeze 前可以做只读 inventory、预备 backup 或 dry-run，但用于切换的最终 backup/checksum 和唯一正式 copy/import 必须在 freeze 后取得/执行；不建立长期双写，也不声称跨异构存储存在 global transaction。
- 保持媒体只保存 identity/reference metadata，浏览器直接使用 Host 授权 URL 和 HTTP `Range`/`ETag`；不把完整媒体 Blob/ArrayBuffer 放入 API、repository、backup 或 migration。
- 保持 `SeekPlayerDB` database `version 1`、store `files`、key path `id` 不变；六个用户 WhisperX/语言处理文件继续不碰。
- 将后续实施压缩为少量 A–D 阶段，并只保留正常使用、重复请求、明显 CAS 冲突、启动/恢复、核心播放切换和大媒体不整文件复制等直接影响个人数据与可用性的验证。

## 能力

### 新增能力

- `windows-durable-domain-ownership`：六域唯一 owner、canonical records、query/command/receipt、revision/CAS 和 loopback fail-closed 边界。
- `windows-thin-reader-api`：browser 薄 Reader 的 typed loopback API、授权 capability、ephemeral state、Range media 和 no-copy contract。
- `windows-durable-state-migration`：逐域 inventory、最小备份/恢复、一次性 import、旧值保留和可回退 writer 切换。

### 修改能力

- `local-application-host`：补充六域 owner/readiness、loopback authorization 和 media Range boundary。
- `durable-application-data`：把现有事务与备份能力绑定到 owner boundary，并冻结 `SeekPlayerDB v1/files/id`。
- `reliable-reader-session`：Reader Session 的 durable prepare/commit/restore 继续通过 Host owner，媒体继续 URL/Range streaming。
- `workflow-service-reliability`：workflow durable state、job command 和文件引用继承 owner API、CAS/receipt 与 loopback boundary。

## 影响

- 主要影响 `tools/subtitle-workflow/youtube_workflow/` 的 Host/domain seam、`src/services/persistence/`、Reader/Preview/Vocabulary/Annotation/SRS 访问层和现有 compatibility adapters；具体实施只在后续任务中进行，本轮不修改业务源码。
- 迁移目标是隔离的 optimization config/data root，使用 Windows loopback；不得触碰 `E:\read-web-next`、`E:\read-web`、日常端口或日常数据根。
- 现有 lease、receipt、backup、health 和 fail-closed 基础设施继续复用，但后续不再扩展成多租户、HA、审计或复杂跨域协调平台。
- Mac、Tailscale、VPN、远程部署和任何非-loopback transport 不在本 change 范围内。
