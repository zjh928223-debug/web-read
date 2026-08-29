## ADDED Requirements

### Requirement: Windows browser 必须使用 versioned typed owner API

本机 browser Reader SHALL 使用 versioned typed loopback API 获取六域 durable query/command、Reader Session prepare/commit/restore、receipt 和 owner capability。API-authoritative command MUST 只提交到 Windows Host-managed repository；browser persistence bridge MAY 提供 inventory/import input 或 rollback compatibility read，但 MUST NOT 成为最终 repository、commit executor 或 canonical writer。Request MUST 携带 request/correlation identity、domain、operation，以及适用的 revision/idempotency data；response MUST 返回 typed result category。

#### Scenario: host ready

- **WHEN** browser 加载 Windows application 且 Host 报告某 domain ready
- **THEN** 该 domain client MUST 通过 owner API 获取 durable state
- **THEN** browser MAY 只保留 view-model、playback、in-flight request 和有界 session cache

#### Scenario: owner 尚未 ready

- **WHEN** browser 无法建立 ready API session 或 contract 不兼容
- **THEN** durable read/write MUST 进入明确的 not-ready/recovery state
- **THEN** browser MUST NOT 静默回退到 `IndexedDB`/`localStorage` write 或把 request success 报告为 saved

### Requirement: Loopback API 必须执行 bounded authorization

Host API SHALL 只绑定 Windows loopback，并对 durable operation 校验 Host、Origin、短期 instance token、profile capability 和 path/operation。CORS MUST NOT 被当作 authentication；token MUST NOT 持久化在 URL、browser durable storage、日志或普通 diagnostics 中。

#### Scenario: request 越界或未授权

- **WHEN** request 使用错误 token、不可信 Host/Origin、non-loopback bind、过期 capability 或越界 path/operation
- **THEN** endpoint MUST 在 durable/file/process side effect 前拒绝 request
- **THEN** revision、filesystem state 和 job state MUST 保持不变，并只返回脱敏 diagnostic

### Requirement: Browser durable state 必须与 Reader ephemeral state 分离

Browser SHALL 将 Pinia view state、playback time、active index、transient suggestion、in-flight request、有界 cache 和 media handle 视为 ephemeral。只有 owner 返回 committed revision/receipt 后，durable UI status MAY 变为 `saved`；`dirty`、`conflict`、`commit-unknown` 和 `not-ready` MUST 保持可区分。单用户相同 key retry MUST 查询/复用 authoritative receipt，明显 CAS conflict MUST 保留当前 intent。

#### Scenario: mutation 未确认或 revision 冲突

- **WHEN** owner response 为 unknown/conflicted 或浏览器再次提交旧 expected revision
- **THEN** browser MUST 保留 dirty/unknown intent 并显示可重试状态
- **THEN** browser MUST NOT 根据 local cache 猜测 committed state 或写第二份 canonical copy

### Requirement: 大媒体必须保持为 host-owned Range stream

Reader SHALL 从 Host 获取有界 media capability 或 authorized URL，并使用 HTTP `Range`/`ETag` 语义播放 audio/video。Browser durable adapter、API response、backup artifact 和 migration helper MUST 拒绝完整 media bytes，不得把大媒体复制到 `SeekPlayerDB/files`、`localStorage`、JSON 或 import buffer。

#### Scenario: 打开或 seek 大媒体

- **WHEN** browser media element 打开或 seek 到尚未缓冲的位置
- **THEN** element MUST 直接使用 authorized URL 发起范围请求
- **THEN** Host MUST 返回 `206`、`Content-Range`、`Accept-Ranges` 和匹配 ETag，Reader MUST NOT 回退为 full-file download

#### Scenario: media identity 变化

- **WHEN** 后续 response 的 ETag、identity 或 media revision 与当前 reference 不一致
- **THEN** Reader MUST 停止继续使用不一致内容并返回 rebind/not-found
- **THEN** Reader MUST NOT 拼接不同 media revision
