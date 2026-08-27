## 为什么

当前 Read-Web 已有 Windows 本机 `Local App Host`、`ApplicationPersistence`、Reader Session 原子切换、Range media 和六域备份/恢复基础，但浏览器运行时仍是混合架构：部分 durable state 仍可由 browser 直接写入，部分能力通过 `window.*`/DOM compatibility 面连接。这样会留下双 writer、跨进程恢复边界不清、回滚时数据格式与 owner 不一致等风险，也无法把“本机可用”与“数据已安全提交”区分开。

现在先把 Windows 本机定义为唯一 data owner，并让同一台机器上的 browser 也通过正式 loopback API 成为薄 Reader，可以在引入任何未来跨设备 transport 前固定 ownership、atomicity、备份恢复和 fail-closed 契约；本变更不提前设计 Mac、Tailscale 或任何非-loopback transport。

## 变更内容

- **BREAKING**：将 Windows `Local App Host` 定义为以下六个 durable domain 的唯一 data owner：`Reader Session`、`Vocabulary/SRS`、`Preview`、`Annotation`、`marks/activity`、`workflow`。浏览器只能通过正式 API 读写 canonical durable state，不再把 browser storage 当作第二权威来源。
- 为六个 domain 建立可审查的 ownership/API 矩阵：每个 domain 明确 canonical record、read/write command、revision/CAS、commit acknowledgement、错误分类和 owner health 状态；跨 domain 只通过受控 command/manifest 协调，不假设异构存储存在隐式 distributed transaction。
- 让 Windows 本机前端先走与未来远程式调用相同的 typed loopback API；API 具备 Host/Origin/token、correlationId、revision、capability/readiness 和 fail-closed 语义。
- 保持 media bytes 不进入 browser durable state：媒体继续由 Windows host 提供授权 URL、HTTP `Range`/`ETag` streaming；Reader 只持有短生命周期 playback/resource handle，不下载或复制大文件。
- 以 domain 为单位退役 browser durable writers，保留可观测、可回滚的 compatibility reader/adapter；owner 不可用、契约不兼容、未知版本或数据损坏时拒绝写入，不静默回落到另一份 browser-owned state。
- 冻结最终落点：API-authoritative 阶段的六域 canonical durable records 必须存放在 Windows Host 管理的 repository；browser bridge 只能做只读 inventory、一次性 import 或 rollback-window compatibility reader，不能成为 repository、commit executor 或 canonical writer。
- 以 profile lease + journal 保护原子 owner-mode 切换：先冻结并阻断旧 writer，将 compatibility path 置为 read-only，确认无 in-flight mutation，再用单一 checkpoint 同时记录旧 writer blocked 与 Host repository authoritative；失败只能保持旧 owner 或进入 not-ready/manual-recovery，不能出现双写窗口。
- 建立备份 manifest、逐域 checksum、dry-run restore、冲突/未知数据隔离、原子恢复和恢复演练要求。继续保持 `SeekPlayerDB` `version 1`、`files`、`keyPath id`；任何 schema migration 必须另行获得用户明确授权并单独设计。
- 把边界拆成可并行与必须串行的实施阶段，并为每一阶段设置行为门禁、旧/新 owner 双读差分、故障注入、冷启/重启/回滚和完成定义。

## 能力

### 新增能力

- `windows-durable-domain-ownership`: Windows 本机六个 durable domain 的唯一 owner、canonical records、写入授权、revision/CAS、commit acknowledgement、health 和 fail-closed contract。
- `windows-thin-reader-api`: browser 作为薄 Reader 使用的 typed loopback API、权限/能力边界、ephemeral state、Range media 和禁止大文件复制的 contract。
- `windows-durable-state-migration`: browser durable state 退役、兼容迁移、备份/恢复、corrupt quarantine、rollback 和恢复演练的 contract。

### 修改能力

- `local-application-host`: 从“提供本地静态资源和高权限 endpoint”扩展为六个 durable domain 的唯一 Windows owner，并在 readiness 中声明 domain/API 能力。
- `durable-application-data`: 将现有事务、版本 envelope、冲突、备份/恢复要求绑定到六个 domain 的 owner boundary；明确不得在本变更中改变 `SeekPlayerDB v1/files/id` schema。
- `reliable-reader-session`: Reader Session 的 durable prepare/commit 和恢复通过 Windows API 完成；媒体继续 URL/Range streaming，browser 不复制大媒体。
- `workflow-service-reliability`: workflow durable state、job command 和相关文件引用必须继承 Windows owner/API 授权与 fail-closed boundary。

## 影响

- 主要影响 `tools/subtitle-workflow/youtube_workflow/service.py` 及其 persistence/health/auth seams、`src/services/persistence/`、`src/services/runtime/`、Reader/Preview/Vocabulary/Annotation/SRS 访问层和现有 compatibility adapters；具体文件拆分留在 `design.md`/`tasks.md`，本提案不修改业务源码。
- 需要新增 typed API contract、Windows Host-managed repository contract、domain ownership matrix、profile lease/readiness 诊断、backup/restore rehearsal fixtures 和 browser/backend behavior gates；现有 `ApplicationPersistence` 可作为冻结 schema 的 legacy inventory/import/rollback-window adapter，不能作为 API-authoritative 阶段的最终 repository。
- API transport 仅限 Windows 本机 loopback，使用当前 optimization workspace 的隔离配置/数据根；不得触碰 `E:\read-web-next`、`E:\read-web` 或日常端口/数据。
- 这是数据边界和调用方式的 BREAKING 变更，实施必须先落 API contract 与 owner observability，再迁移 browser writers；任何 schema、Mac、Tailscale、远程部署或非-loopback transport 均不在本 change 范围内。
