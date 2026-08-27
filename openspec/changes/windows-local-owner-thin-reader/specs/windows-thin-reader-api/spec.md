## ADDED Requirements

### Requirement: Windows browser 必须使用 versioned typed owner API 访问 durable state
本机 browser Reader SHALL 使用 versioned typed loopback API 获取所有 durable domain query、command、Reader Session prepare/commit、backup/restore operation 和 owner capability check。API-authoritative command MUST 只提交到 Windows Host-managed repository；browser persistence bridge MAY 提供 inventory/import input 或 rollback-window compatibility read，但 MUST NOT 成为最终 repository、commit executor 或 canonical writer。API contract MUST 携带 request/correlation identity、domain、operation，以及适用时的 revision 或 idempotency data，并返回 typed result category。UI module MUST NOT 把 raw browser persistence primitive 当作 public domain API。

#### Scenario: Reader 对 API-authoritative host 启动
- **WHEN** browser 加载 Windows application 且 host 报告 ready capability
- **THEN** Reader、Vocabulary/SRS、Preview、Annotation、marks/activity 和 workflow client MUST 通过 owner API 获取 durable state
- **THEN** browser MAY 只在本地保留 view-model、playback、in-flight request 和有界 session-cache state

#### Scenario: Owner API 在 startup 期间不可用
- **WHEN** browser 无法建立 ready API session，或 capability contract 不兼容
- **THEN** durable read 和 write MUST 进入明确的 not-ready/recovery-required state
- **THEN** browser code MUST NOT 静默回退到直接 `IndexedDB`/`localStorage` write，也 MUST NOT 把 mutation 报告为 saved

### Requirement: Loopback API 必须执行 instance authorization 和 bounded capability 校验
Host API SHALL 只绑定配置的 Windows loopback address，并 MUST 对高权限或 durable operation 校验 Host、Origin、短期 instance token、capability 和 path/operation。CORS MUST NOT 被当作 authentication；token MUST NOT 持久化在 URL、browser durable storage 或普通 diagnostics 中。

#### Scenario: 授权的 browser command
- **WHEN** browser request 使用当前 instance token、受信任的 loopback Host/Origin，以及覆盖所请求 domain operation 的 capability
- **THEN** owner MAY 只在配置的 profile/data root 内执行声明的 operation
- **THEN** response MUST 包含 correlationId 和 typed commit/read result，且不得暴露 secret 或不受限路径

#### Scenario: Request 超出 loopback 或 capability boundary
- **WHEN** request 使用无效 token、不受信任 Origin、过期 capability、non-loopback binding 或 granted root 之外的 path
- **THEN** endpoint MUST 在 durable read、file read、process start 或 credential use 之前拒绝 request
- **THEN** 拒绝 MUST 保持 domain revision 和 filesystem state 不变，并只返回脱敏的 diagnostic context

### Requirement: Browser durable state 必须与 ephemeral Reader state 分离
Browser SHALL 将 Pinia view state、playback time、active index、transient annotation suggestion、in-flight request、有界 cache 和 media handle 视为 ephemeral。只有 owner 返回 committed revision/receipt 后，durable UI status MAY 变为 `saved`；`dirty`、`conflict`、`commit-unknown` 和 `not-ready` MUST 保持可区分。

#### Scenario: Owner command in-flight 时用户编辑
- **WHEN** browser 有新的 mark、vocabulary rating、preview change、annotation mutation 或 workflow command 正在等待 owner receipt
- **THEN** UI MUST 保留 latest intent，并按情况显示 saving/dirty/unknown state
- **THEN** UI MUST NOT 持久化第二份 local canonical copy，也 MUST NOT 在 receipt 到达前标记为 saved

#### Scenario: 未确认 mutation 后 browser reload
- **WHEN** 上一个 page 结束时 owner response 为 unknown 或 conflicted
- **THEN** startup MUST 查询 authoritative receipt/revision，或显示可恢复的 pending state
- **THEN** startup MUST NOT 根据 local cache 猜测并 replay mutation

### Requirement: 大媒体必须保持为 host-owned Range stream
Reader SHALL 从 host 获取有界 media capability 或 authorized URL，并使用 HTTP `Range`/`ETag` 语义播放 audio/video。Browser durable adapter、API response、backup artifact 和 migration helper MUST 拒绝完整 media bytes，且 MUST NOT 在 playback 前把大媒体复制到 `SeekPlayerDB/files`、`localStorage`、JSON envelope 或内存中的 import buffer。

#### Scenario: Reader 打开大体积本地视频
- **WHEN** browser 从 ready host 打开 300MB 或更大的 media reference
- **THEN** playback MUST 从 authorized URL 和请求的 byte range 开始
- **THEN** browser 和 durable owner MUST 只保存 media identity/reference metadata，不得保存完整 media Blob 或 ArrayBuffer

#### Scenario: 用户 seek 到当前 buffer 之外
- **WHEN** media element 为新的 seek position 请求 bytes
- **THEN** host MUST 返回带 `206`、`Content-Range`、`Accept-Ranges` 和匹配 `ETag` 的 authorized range
- **THEN** Reader MUST NOT 回退到 full-file download，也 MUST NOT 拼接不相关的 media revision

### Requirement: API response 必须明确 commit 和 failure semantics
每个 mutation response SHALL 声明 `committed`、`rejected`、`conflict`、`commit-unknown`、`not-ready` 或其他已注册的 typed outcome；当结果为 committed 时，还 MUST 返回 authoritative domain revision。Browser MUST 将 outcome 映射为可见且可 retry 的 state，不能把 transport success 转换成 durability success。

#### Scenario: Owner transaction 在 request success 后 abort
- **WHEN** owner 在 durable commit evidence 产生前报告 transaction/request failure
- **THEN** API MUST 返回 non-committed typed error
- **THEN** browser MUST 保持当前 intent 为 dirty，且 MUST NOT 前进 authoritative revision

#### Scenario: Owner commit 并返回 receipt
- **WHEN** domain transaction 完成，owner 暴露有效的 committed revision
- **THEN** API MUST 返回该 revision 和幂等的 receipt identity
- **THEN** browser MAY 只将 durable view 更新到该 revision
