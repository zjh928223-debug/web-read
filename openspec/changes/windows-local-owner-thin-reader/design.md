## 背景

本变更建立在当前 Windows 本机稳定化基线上，而不是重新发明已有持久化设施。当前证据包括：

- `CURRENT_PROJECT_STATUS.md` 与 `PROJECT_MAP.md` 记录了 Vite + Vue 3 + Pinia + FastAPI 的混合运行时、`Local App Host`、`ApplicationPersistence`、Range media、latest-wins marks/activity ledger，以及仍需逐步收敛的 browser compatibility 面。
- `docs/persistence/application-backup.md` 已把 `reader-session`、`marks-activity`、`vocabulary-srs`、`passage-preview`、`annotation`、`workflow` 列为完整备份所需的六个 durable domain；现有 adapter registry、checksum、dry-run restore、journal、quarantine、cross-process lease 和 isolated real-profile rehearsal 可作为本变更的基线。
- `src/services/persistence/application-persistence.js` 与现有 `durable-application-data` spec 固定 `SeekPlayerDB` version `1`、object store `files`、key path `id`。本变更只迁移 owner/call boundary，不升级、重建或删除这个 schema。
- Reader Session 的运行时组装在 `src/composables/session-*`、`src/services/persistence/reader-session-persistence.js` 与 `src/composables/reader-session-publisher.js`；Vocabulary/SRS、Preview、Annotation、marks/activity 和 workflow 分别已有 focused services/features、Python owner 和 focused verification scripts，但 browser 仍可直接触达部分 durable storage。
- `openspec/specs/local-application-host`、`durable-application-data`、`reliable-reader-session`、`workflow-service-reliability` 已覆盖 host 安全、事务、Range、CAS、恢复和 workflow 可靠性；本变更补上跨 domain 的唯一 owner 与 API-first 迁移语义。

“唯一 owner”指 Windows application profile 的唯一 canonical authority 与写入入口，不要求六个 domain 在同一进程或同一种物理存储中实现。API-authoritative 阶段的六域 canonical durable records MUST 落在由 Windows Local App Host 管理生命周期、锁、事务、backup/recovery 和 revision 的 repository 中；该 repository 可以由 FastAPI host 进程或受管 Node sidecar 提供，但不能由 browser storage 提供。Local App Host 负责 profile lease、授权、capability、readiness、备份/恢复协调和统一 API。迁移期间，旧 `SeekPlayerDB/files` 和 browser keys 只能作为受控的只读 inventory、一次性 import source 或 rollback-window compatibility reader，不能作为最终 repository、commit executor 或 canonical writer。

## 目标 / 非目标

**目标：**

- 建立六个 durable domain 的 ownership matrix，明确 canonical record、owner、API command/query、revision/CAS、commit receipt、故障语义和备份范围。
- 先为 Windows 本机提供正式 typed loopback API，让本机 browser 使用与未来远程式调用相同的 request/response、auth、revision、idempotency 和 error contract。
- 让 browser 保留 UI、playback、短期 cache、in-flight request 和 Pinia view-model 等 ephemeral state；所有 durable read/write 经过 API owner facade。
- 保持媒体授权 URL、HTTP `Range`/`ETag` 和生命周期 owner 语义；不把大媒体 Blob/ArrayBuffer 复制到 browser durable state 或备份包。
- 逐 domain 退役 browser durable writers，使用备份、迁移 checkpoint、read-only compatibility adapter、差分读取和明确 rollback target 保留回退能力。
- 将 API-authoritative 阶段的最终 canonical durable records 固定到 Windows Host-managed repository；browser bridge 仅允许只读 inventory、一次性 import 和 rollback-window compatibility read。
- 将每域 commit 与跨域 backup/restore 的 atomicity、CAS、corrupt quarantine、unknown schema、recovery-before-ready 和 fail-closed 行为变成可测试契约。
- 明确可并行和必须串行的实施边界，并在优化 workspace 的隔离 config/data root 上完成行为、故障注入和恢复演练。

**非目标：**

- 不设计或开放 Mac、Tailscale、VPN、远程部署、多设备同步、云端服务或任何非-loopback transport。
- 不改变 `SeekPlayerDB` 的 database name、version、object store 或 key path；任何未来 schema migration、重建或数据删除都必须是另一个获得用户明确授权的 change。
- 不复制或重新实现 UI、SRS policy、ECDICT、WhisperX、语言处理或媒体转码功能；只定义它们访问 durable owner 的边界。
- 不承诺跨异构物理存储的隐式 distributed transaction；需要跨域一致性的操作必须使用显式 profile journal/lease 协议。
- 不在本 change 中删除所有 legacy rows 或 compatibility code；删除必须等待 cutover、回滚窗口和 consumer gate 全部完成。

## 设计决策

### 1. 以 Windows application profile 作为唯一 authority boundary

Local App Host 为 profile 的 owner coordinator，持有跨进程 profile lease，并把六个 domain 的 Windows Host-managed repository/adapter 注册为完整 registry。浏览器、Vue/Pinia、workflow worker 和外部进程都只能通过 host 认可的 domain facade 产生 durable side effect。最终 canonical record 必须写入 host-managed repository；`DurableJsonRepository`、SQLite 或受控 Python owner 可以作为该 repository 的实现，`ApplicationPersistence` 只能在 host 明确管理其生命周期且不改变 frozen schema 时作为受控 adapter 使用。browser `IndexedDB`/`localStorage` bridge 只允许 inventory、一次性 import 或 rollback-window compatibility read，不能执行 canonical commit。

选择 profile boundary 而不是“一个进程/一个 store”是为了覆盖当前 Node、browser 和 Python service 的混合架构，同时复用已经存在的 host lifetime lease、backup registry 和 workflow owner。浏览器直接作为 owner 会继续保留双 writer；把六域强行合并为一个 SQLite 会扩大迁移范围并诱发 schema 变化，这两种方案都拒绝。

Ownership matrix 的初始语义如下：

| Domain | canonical durable 内容 | Windows owner facade | 明确排除 |
| --- | --- | --- | --- |
| `reader-session` | manifest、transcript/chunk 小资源、session revision、`contentId`、媒体 identity 引用、恢复/隔离证据 | `ReaderSessionOwner` 的 prepare/commit/restore/query | 完整媒体 bytes、playback time、DOM |
| `vocabulary-srs` | vocabulary entry、acquisition/review/SRS state、learning events 和已纳入当前契约的 personalization rows | `VocabularySrsOwner` 的 command/query/receipt | ECDICT/外部词典缓存、纯 UI 派生排序 |
| `passage-preview` | preview envelope、continuation/rating/transition durable state 和已注册 legacy keys | `PreviewOwner` 的 batch read/commit/restore | 句子候选的 session-memory cache、未注册 key |
| `annotation` | scoped generated/status/bundle、轻量 annotation import/export state、corrupt evidence | `AnnotationOwner` 的 scoped command/query | 仅用于渲染的 hit-test index、临时 API response |
| `marks-activity` | marks ledger、activity event identity、latest-wins revision 和 dirty/saved/error evidence | `MarksActivityOwner` 的 coalesced commit/event receipt | playback hot-path 当前 index、未提交 UI 草稿 |
| `workflow` | job snapshot、history/event ring、reader-index/config、输出 JSON 和媒体 identity/reference | `WorkflowOwner` 的 authorized job command/query | 完整媒体备份、token/cookie、任意路径副作用 |

### 2. 先建立 typed loopback API，再迁移任何 browser writer

API 采用 versioned JSON contract；每个 request 带 `requestId`、`correlationId`、`domain`、operation、`expectedRevision`（适用时）和 `idempotencyKey`（mutation 必需）。每个 response 带 authoritative `revision`、`commitStatus`、capability/diagnostic metadata 和 typed error。写入只有在对应 owner 完成事务、fsync/atomic replace 或等价提交并取得 revision evidence 后才返回 `committed`；结果未知必须返回 `commit-unknown`，保留 dirty 状态并通过 receipt 查询恢复，不能盲目重复副作用。

API 族只定义稳定语义，不在本 change 锁死每个 route 名称：capability/readiness、domain snapshot/query、domain command/receipt、Reader Session prepare/commit、backup/restore dry-run/execute、media capability/Range。所有 mutation 经过统一授权 middleware，再进入 domain adapter。未来 transport 可以复用该 contract，但本变更只允许 Windows loopback。

本机 browser 也必须调用这个 facade。迁移期间可以有一个只负责读取 legacy `SeekPlayerDB/files` 或 localStorage 并生成一次性 API import snapshot 的 compatibility bridge；bridge 不向 UI 暴露 raw `IDBObjectStore`/`localStorage`，不接受新的 browser-side durable write，不执行 host repository commit，并在 owner-mode 切换后只保留 read-only/quarantine compatibility read。

### 3. 每域原子 commit，跨域使用显式 profile journal

单域 command 使用 domain repository 的 transaction boundary、revision/CAS 和 idempotency receipt。`Reader Session` 使用 prepare/validate/commit，确保新材料无效时旧 session 保持可用；marks/activity 继续 one-in-flight latest-wins；workflow 使用合法 state transition 与 job revision。

涉及多个 domain 的 restore、迁移切换或 material publish 不假设 JSON、IndexedDB、SQLite 和 Python service 自动形成一个 transaction。host 在 profile lease 下创建 pending journal，先完成所有 adapter 的 prepare/validation，再按固定顺序提交并记录每个 domain 的 committed revision；在此期间阻止不一致的 owner read/readiness。重启时依据 journal 和 commit evidence 恢复到完整 baseline 或完整 staged revision；缺少 evidence、CAS 冲突或未知 domain 一律停在 recovery-required，而不是返回半完成组合。

### 4. 大媒体永远走 capability + Range streaming

Reader Session 只保存 media identity、size、mtime/ETag、授权 capability 和可重绑定引用。host 的 media endpoint 只在允许 root/capability 下读取请求的 byte range，返回正确的 `206`、`Content-Range`、`Accept-Ranges` 和稳定 `ETag`。browser 的 `MediaResourceOwner` 管理 URL、`src` 和 revoke/dispose；任何 API adapter、backup adapter 或 migration helper 看到完整 Blob/ArrayBuffer 都拒绝该操作。

这样可保留当前 300–540MB fixture 的首次可播放和 seek 预算，也避免把“owner”误解为复制媒体。媒体文件缺失或 identity 变化时只返回 typed rebind/not-found，不删除 Reader Session 或其他五个 domain。

### 5. 逐 domain API-first cutover，compatibility 只读且可回滚

每个 domain 的最终 canonical records 先准备到 Windows Host-managed repository，并按以下严格状态机切换：`inventory → backup/checksum → dry-run/shadow → isolated host-repository canary → acquire profile lease + journal → freeze/block old writer → compatibility-read-only (no commit) → drain and verify no in-flight mutation → single atomic owner-mode checkpoint (old writer blocked + Host repository authoritative) → post-cutover verification/rollback window → retire old writer`。`shadow` 与 isolated canary 只读取或写入隔离 staging target，不触碰 production canonical state；切换前 Host API 不得对该 production domain 接受 canonical commit。freeze 步骤必须先阻断旧 writer，并将 compatibility path 置为 read-only；单一 checkpoint 必须在同一 profile lease/journal transition 中记录旧 writer 已阻断、compatibility path read-only、in-flight mutation 为零、Host repository revision/base checksum 和 API authority；checkpoint 前后不得存在两个 authoritative writers。

冻结旧 writer 后，compatibility path 立即进入 read-only/import-evidence 模式；任何新的旧路径 mutation 必须被拒绝，已有 mutation 必须 drain 到零并取得明确结果；无法 drain、checkpoint 或取得 revision evidence 时，系统只能保持旧 owner mode（仅当 journal 证明 freeze 尚未生效），或保持 not-ready/manual-recovery，不能开放 Host writer 形成双写。checkpoint 成功后，旧 writer 永久 blocked，compatibility path 继续只能 read-only/import-evidence，所有新的 durable mutation 只能由 Host repository API commit。

回滚不是让两个 writer 再次同时工作。若 post-cutover verification 或 rollback window 失败，先阻断 Host API 新 commit，依据 migration journal、expected revision 和 pre-cutover backup 恢复一个完整可读版本，再以一次新的 owner-mode checkpoint 选择旧 owner 或保持 not-ready/manual-recovery；恢复旧 owner 前必须确认 Host writer 已 blocked 且无 in-flight mutation。host 不可用、API contract mismatch、unknown schema、corrupt record 或 recovery 未完成时，browser 只能显示 `not-ready/recovery-required`、提供导出/重试/重新绑定等操作，不能把未确认写入标记为 saved，也不能静默写回 localStorage/IndexedDB。

`SeekPlayerDB` 现有 `v1/files/id` 在整个流程中保持可打开、可审计和可回滚。迁移可以把已验证记录导入 host-owned repository，或在短期内由受控 adapter 代管旧记录，但不得执行 schema upgrade；若未来必须移动/重建该 schema，另开 change 并要求用户授权、迁移前备份、逆向 reader 和独立恢复演练。

### 6. readiness、auth 和 diagnostics 是 owner contract 的一部分

host 只绑定明确的 loopback address；高权限 API 同时校验 Host、Origin、短期 instance token、capability 和参数范围。`/health`/capabilities 既区分 liveness、readiness、domain owner 状态和可选依赖，也报告当前 profile revision、pending journal、backup/recovery 状态及脱敏 correlationId。缺失 adapter、lease、token、revision evidence 或 registry contract 时，host 不进入 ready，API 不执行副作用。

错误统一映射为 `unauthorized`、`not-ready`、`not-found`、`conflict`、`unsupported-schema`、`corrupt`、`quota`、`timeout`、`upstream`、`commit-unknown`、`manual-recovery` 等 typed category；diagnostics 不写 token、cookie、API key、完整个人路径或媒体 bytes。

### 7. 行为门禁优先于源码形状，源码门禁作为 owner 保护

验收分为四层：

1. contract gates：API schema、auth/loopback、lease、revision/CAS、idempotency、commit receipt 和 error taxonomy；
2. architecture gates：所有六域 adapter 都注册、browser direct writer consumer map 逐域归零、`SeekPlayerDB` schema guard、Range/no-copy guard；
3. isolated behavior gates：六条领域 journey、host restart/crash、A/B/A、multi-tab conflict、offline/timeout、workflow cancel、Quota/corrupt/unknown schema；
4. release/recovery gates：real-profile read-only snapshot、isolated restore/reopen、逐域 checksum、zero network、30 分钟播放/seek、backup/rollback 和 release health。

手工优化运行只使用 `config/runtime.optimization.json`、frontend/backend `5184/8776` 和 `E:\ReadWebData\SubtitleWorkflow-Optimization`；所有 fixture、日志和 restore target 写入显式临时隔离目录。不得为验证启动、构建或修改 `E:\read-web-next`、`E:\read-web` 或其数据根。

## 风险 / 权衡

- [迁移范围横跨 browser、Node、Python 和六个 domain] → 先冻结 API/ownership matrix 和 profile lease；领域 adapter 与 contract fixtures 可并行，writer cutover 必须逐域串行且每域单独 gate。
- [现有 browser state 的物理位置与 host-owned repository 不同] → 最终 canonical 落点固定为 Host-managed repository；先做只读 inventory/checksum 和显式一次性 import snapshot，旧 `SeekPlayerDB` 保持 schema 不变，任何物理 schema 重建另开授权 change。
- [严格 fail-closed 可能暂时降低可用性] → 提供可操作的 retry、rebind、export、recovery status 和旧 release rollback；不把不确定的写入伪装成成功。
- [跨域恢复没有真正的异构 distributed transaction] → 使用 profile lease、pending journal、逐域 revision evidence 和 recovery-before-ready；公开 read 只看到完整 baseline 或完整 staged revision。
- [loopback API 与现有 DOM/Pinia compatibility ordering 可能互相影响] → 保留当前 `index.html` script order，先接入薄 API client/adapter，再按 consumer map 逐项移除 direct storage，禁止在 `reader-runtime.js` 或 `session-init.js` 堆新逻辑。
- [Range capability 泄露本地文件或造成 TOCTOU] → 复用 RuntimeConfig root/capability mapping、identity/ETag 校验、Host/Origin/token 和 typed not-found/permission；备份只保存 media identity metadata。
- [双读差分会带来额外 I/O 和诊断复杂度] → 仅在切换前的可配置迁移窗口启用、限制 payload/bytes、脱敏并记录 revision；差分和 isolated canary 不触碰 production canonical state，也不产生第二个 commit executor。

## 迁移计划

实施顺序和依赖如下；其中同一波次可并行的项目必须仍以固定 contract 为输入。

### 必须串行的主干

1. **Freeze baseline**：记录隔离 profile、六域 adapter registry、direct-writer inventory、现有 checksums、`SeekPlayerDB v1/files/id` 证据、Range/reader/workflow journey baseline；确认未提交 WhisperX/语言处理改动保持原样。
2. **Owner foundation**：落地 ownership matrix、Windows Host-managed repository contract、typed API envelope、loopback auth、profile lease、capability/readiness、commit receipt 和 fail-closed error mapping。没有这一阶段的 contract/repository green，不迁移任何 writer。
3. **Reader Session/media seam**：先让 Windows 本机 Reader 通过 API 访问 Host-managed repository，完成 prepare/query/commit/restore，并确认 Range streaming 与 `MediaResourceOwner` 无大文件复制；这是其余 material/workflow domain 的引用基线。
4. **Domain cutover**：按 `marks-activity → passage-preview → annotation → vocabulary-srs → workflow` 的顺序逐域完成 backup、shadow/diff、isolated host-repository canary、profile lease/journal、freeze/block old writer、compatibility read-only、drain/no-in-flight verification、single atomic owner-mode checkpoint、post-cutover verification 和 rollback window；checkpoint 后 compatibility read-only 必须继续保持。每次只允许一个 domain 改变 authoritative writer；若失败，保持旧 owner 或 not-ready/manual-recovery，绝不开放双写。
5. **Cross-domain recovery**：六域全部 API-authoritative 后，启用 profile journal 的迁移/restore 原子可见性，完成 crash/kill/restart、CAS、quota、corrupt/unknown schema 和 pending recovery 全矩阵。
6. **Retirement/release**：回滚窗口结束且行为门禁连续通过后，删除或隔离 direct browser writer；保留 read-only compatibility reader、previous release、pre-cutover backup 和恢复说明。最后才运行 release health/rollback rehearsal，等待用户另行确认任何外部 shortcut 或生产切换。

### 可并行的边界

- `Preview`、`Annotation`、`Vocabulary/SRS` 的 read-only adapter、Host repository contract fixtures、schema inventory 和 isolated canary 可以并行；它们不得直接修改同一 profile 的 production authoritative state。
- `marks/activity` ledger 的 API receipt 测试可以与 Preview/Annotation adapter 开发并行，但其 authoritative cutover 要等 Reader Session playback/mark reference contract green。
- workflow 的 snapshot/event、ProcessSupervisor 和 API auth 测试可以并行准备；workflow writer cutover 必须等 Reader Session/media capability 以及 host recovery-before-ready green。
- backup manifest、restore dry-run、fault matrix 和 direct-writer consumer map 可以从 owner foundation 后并行建设；最终 real-profile restore 与每次 owner-mode checkpoint 必须串行执行并锁定 profile。

### 回滚与恢复

每个 cutover 前生成带 release、domain、base revision、record/domain checksum 和 migration id 的 pre-cutover backup。API owner 记录 pending checkpoint 和 commit evidence；发现异常时停止新 writer，先检查是否存在已提交 revision，再按 expected-revision CAS 恢复。若有并发 writer 或证据不足，返回 `conflict/manual-recovery` 并保留较新状态，不能盲目覆盖。

恢复演练至少覆盖：每个 domain 单独损坏、unknown/future schema、checksum mismatch、Quota/disk-full、transaction abort、进程在每个 commit boundary 被终止、host restart、重复 restore、revision conflict、失效媒体 identity、token/Origin 错误和 workflow 子进程取消。演练目标目录必须隔离，重开后验证六域 record count/checksum、Reader/Vocabulary/SRS/Preview/Annotation/workflow journeys、Range playback 和 zero network；失败时 host 必须在 recovery 完成前保持 not-ready。

## 待决问题

- API-authoritative 阶段的 canonical records 固定由 Windows Host-managed repository 接管；browser bridge 的职责只限于只读 inventory、一次性 import 和 rollback-window compatibility read，不得代管最终 repository、执行 commit 或成为 canonical writer。
- Local App Host 继续由 FastAPI 单 host 承载全部 domain facade，还是保留 Node sidecar 作为仅限本机的 broker，需要用 startup、Range、lease 和故障恢复证据决定；对 browser 的 typed API contract 不因进程选择改变。
- 多标签页是否允许多个 reader client 并发读取、只允许单一 mutation lease，还是在 profile 级阻止第二个 writer，需要以 conflict journey 和实际 UX 决定；无论选择如何，不能恢复 browser direct writer。
- API 的具体 route 命名、JSON serialization 和 capability token 注入通道应在 implementation 任务中冻结，并写入 contract fixture；本 change 只冻结语义和 loopback 范围。
