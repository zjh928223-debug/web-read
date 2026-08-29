## 背景

本变更建立在现有 Windows 本机稳定化基础上：`Local App Host`、`ApplicationPersistence`、`DurableJsonRepository`、owner receipt/lease、Range media、六域 backup adapter 和 Reader Session `ReaderSessionOwner` 已存在。已完成的 1.x–3.x 与 4.1 代码和检查保留，不在本次范围精简中拆除或返工。

当前仍需把 browser 的 durable writer 逐域收敛到 Host。最终目标是一个单人、单机、Windows loopback 工具：Host 管理六域 canonical repository，browser 只负责 UI、播放和短期状态；legacy browser storage 只用于受控 inventory、一次性 import 或短期 rollback read。

## 目标 / 非目标

**目标：**

- 为六个 durable domain 建立可理解的 Host owner、query/command/receipt 和 revision/CAS seam。
- 安全迁移现有个人数据：按 `read-only inventory → dry-run/容量与格式检查 → freeze old writer → final backup/checksum → one-time final copy/import → verify → switch Host authoritative writer → smoke check → rollback if needed` 执行；freeze 前只允许只读 inventory、预备 backup 或 dry-run，正式切换用的 final backup/checksum 与唯一正式 copy/import 必须在 freeze 后取得/执行。失败时恢复旧 writer 或保持 not-ready，不保留长期双写。
- 保持 `SeekPlayerDB` database `version 1`、store `files`、key path `id`，以及六个 WhisperX/语言处理文件不变。
- 让媒体只以 identity/reference metadata 进入 durable records；browser media element 继续使用 Host 授权 URL 和 Range，不整文件复制。
- 保留基本 atomic write、checksum、幂等 retry、明显 CAS conflict、最小 backup/restore/rollback 和核心用户流程回归。

**非目标：**

- 不开放 Mac、Tailscale、VPN、远程部署、云端、多设备或任何非-loopback transport。
- 不实现六域 global transaction、跨物理存储 material publish、HA、多租户、审计平台或新的通用事务基础设施。
- 不做 multi-tab/高并发/多 writer 全矩阵，不建立长期 shadow、双写、canary 或复杂 cutover coordinator。
- 不新增穷举 fault matrix、hard process-exit 组合、30 分钟 soak、heap/Long Task 性能体系或正式 release readiness 流程。
- 不在本 change 中改变 UI 设计、SRS policy、ECDICT、WhisperX、语言处理或媒体转码功能。

## 已完成基础（历史记录）

1.x 已完成基线、ownership inventory、consumer map、baseline journeys 和 non-goal guard；2.x 已完成 owner registry、lease、typed API、receipt、readiness/auth 基础；3.x 已完成 browser client/status、legacy read-only bridge、media capability/no-copy seam 和三层 focused checks；4.1 已完成 `ReaderSessionOwner` 的 query/prepare/commit/restore、可恢复 snapshot、receipt/CAS/atomic write 及直接行为测试。它们是后续工作输入，不因范围裁剪回退。

## 设计决策

### 1. Windows profile 是唯一 durable authority

Local App Host 为六个 domain 保留唯一 registration。一个 domain 在完成迁移前可以处于 legacy-owner 或 not-ready；完成切换后，canonical record 和新的 durable mutation 只能属于 Host-managed repository。browser `IndexedDB`、`localStorage`、raw JSON 和 compatibility facade 不得作为第二 canonical writer。

| Domain | 最小 canonical 内容 | 目标 owner seam | 排除 |
| --- | --- | --- | --- |
| `reader-session` | transcript/chunk、session revision、`contentId`、media reference、marks reference | `ReaderSessionOwner` query/prepare/commit/restore | 完整媒体、DOM、playback buffer |
| `vocabulary-srs` | entry、acquisition/review/SRS、学习事件 | `VocabularySrsOwner` query/command/receipt | ECDICT transient cache、纯 UI 排序 |
| `passage-preview` | preview envelope、continuation/rating/transition | `PreviewOwner` query/command/receipt | 未注册 key、session-only 候选 |
| `annotation` | scoped generated/status/bundle、轻量 import/export | `AnnotationOwner` query/command/receipt | hit-test index、临时建议 |
| `marks-activity` | marks、activity identity、revision/status | `MarksActivityOwner` query/command/receipt | playback hot-path index、未提交草稿 |
| `workflow` | job snapshot/history/event、reader-index/config、media reference | `WorkflowOwner` query/command/receipt | token/cookie、完整媒体、任意路径 |

### 2. API 与授权保持小而明确

Typed loopback API 使用现有 versioned envelope、`requestId`/`correlationId`、domain、operation、适用时的 `expectedRevision` 和 mutation `idempotencyKey`。Host 校验 loopback Host/Origin、instance token、profile capability 和受限 path/operation；失败在副作用前返回 typed error。只保留轻量 readiness：能确认 owner registry、repository、lease/recovery 状态即可，不把外部 AI、dictionary 或发布信息做成个人工具的可用性前置条件。

### 3. 每域单独提交，不承诺跨域原子事务

每个 domain 复用已有 repository/receipt 工具，采用小型 record envelope、checksum、monotonic revision、expected-revision CAS 和幂等 receipt。写入或 replace 失败时保留旧 canonical snapshot；结果不确定时通过 receipt query/recovery 处理，不盲目重做副作用。

多个 domain 的迁移按固定顺序逐个完成：每个 domain 执行 `read-only inventory → dry-run/容量与格式检查 → freeze old writer → final backup/checksum → one-time final copy/import → verify → switch Host authoritative writer → smoke check → rollback if needed`，成功后才进入下一个 domain。freeze 前只做只读 inventory、预备 backup 或 dry-run；用于切换的 final backup/checksum 和唯一正式 copy/import 必须在 freeze 后取得/执行。任一 domain 失败就停止后续步骤，恢复旧 writer 或保持 not-ready，保留原数据和已生成的 backup/receipt；这里不宣称六域 global transaction 或跨域一致性读取。

### 4. 媒体只走 capability + Range

Reader Session 及其他 durable records 只保存 media identity、size、content type、ETag/revision 和 authorized reference。Host media route 继续限制在配置 root/capability 内，支持 `206`、`Content-Range`、`Accept-Ranges` 和一致 ETag；identity 变化返回 rebind/not-found，不能拼接不同 revision。Browser media element 直接使用授权 URL，API、backup、migration 不接收完整 Blob/ArrayBuffer/bytes/data URI/base64 media。

### 5. 每域一个可理解的 writer 切换流程

切换不使用长期双写。每个 domain 遵循：

`read-only inventory → dry-run/容量与格式检查 → freeze old writer → final backup/checksum → one-time final copy/import → verify → switch Host authoritative writer → smoke check → rollback if needed`。freeze 前只允许只读 inventory、预备 backup 或 dry-run；用于切换的 final backup/checksum 和唯一正式 copy/import 必须在 freeze 后取得/执行。

freeze 后旧 path 只可读；switch 前 Host API 不确认该域新的 canonical write；switch 后新的 durable mutation 只能经 Host receipt。回滚先停止 Host 新写入，再用该域 pre-switch backup 和 revision evidence 恢复旧值或保持 not-ready，确认后才恢复一个 writer。Reader Session 先于其余 domain 切换，其余五域逐域处理。

### 6. 核心验证足够证明个人工具可用

保留已有基础 gate，并为后续每个阶段补直接行为验证：正常 query/command/receipt、相同 key retry、明显 CAS conflict、坏数据/写入失败时旧值保留、Host restart/reopen、Reader 播放与材料切换、backup/restore，以及大媒体 Range/no-copy。验证使用 optimization config、`5184/8776` 和隔离 data root；不做性能实验室或证据归档系统。

## 个人工具范围裁剪

本次明确移除尚未开始且不影响单人单机实际安全的企业级工作：穷举 fault matrix 与多阶段 pending evidence 组合、多标签页/高并发/双 writer 全矩阵、跨六域 global transaction 和复杂 coordinator、shadow/diff/canary/drain/no-in-flight 多层流程、30 分钟 soak 与完整性能指标、release manifest/previous-release 自动恢复、clean-room/trace/screenshot/machine-readable 归档和正式 release review。已有的 lease、receipt、auth、checksum、atomic write、backup、recovery 和 media no-copy 基础继续复用，但不再向多租户、HA、审计或企业安全系统扩展。

## 后续实施阶段

### A. 完成剩余五域最小 Host repository seam

按 ownership matrix 为 `vocabulary-srs`、`passage-preview`、`annotation`、`marks-activity`、`workflow` 补齐必要的 record/query/command/receipt。每域只需能在隔离 profile 中读、写、重试、检测明显 revision conflict，并复用现有 registry、auth、CAS 和 receipt。

### B. 最小备份、恢复与一次性迁移

为六域提供 read-only inventory、dry-run/容量与格式检查，并在每域 freeze old writer 后生成 final manifest/checksum、执行一次性 final copy/import、verify、switch 和 rollback。保留未知/损坏记录与旧值，完整媒体只保留 reference metadata；同时持续冻结 `SeekPlayerDB v1/files/id`。

### C. 先 Reader Session，再逐域切换 writer

先把 Reader Session loader/media 使用接到已完成的 owner seam，验证正常启动、材料切换、播放/seek、失效媒体 rebind 和旧 session 保留。随后按个人工具可控顺序逐域执行上述 `read-only inventory → dry-run/容量与格式检查 → freeze old writer → final backup/checksum → one-time final copy/import → verify → switch Host authoritative writer → smoke check → rollback if needed` 流程，切换后 compatibility path 只读，不允许长期双写。

### D. 核心验证、旧 writer 收敛与文档

运行正常 build/启动、核心 reader/workflow journey、Host restart/reopen、retry/CAS、backup/restore 和大媒体 Range/no-copy 检查；确认各域切换后的 direct writer 已删除或隔离，保留必要的 read-only compatibility reader，更新项目地图、owner contract、backup/recovery 说明和运行状态。

## 风险与取舍

- 单域顺序迁移比 global transaction 简单，但中途失败可能暂时只完成部分 domain；通过每域 backup、旧值保留和停止后续步骤控制风险。
- writer freeze 会让某个 domain 短暂不可写；这是比双写更容易理解的代价，失败时保持旧 owner 或 not-ready。
- 不做多标签页和高并发保证；仍保留单用户重复请求的 idempotency 与明显 CAS conflict，覆盖个人工具最常见的数据风险。
- 通过 URL capability、Range、ETag/identity 和 no-copy 约束避免媒体复制；媒体缺失时 rebind，不删除其他 session 数据。

## 待决问题

- 后续只需在实现阶段确定各 domain 的具体 route/JSON 字段和逐域切换顺序；这些选择不得改变 loopback、唯一 owner、CAS/receipt、backup/rollback 或 no-copy 边界。
- `Local App Host` 继续优先复用现有 FastAPI/domain owner；只有现有 seam 无法承载时才考虑小型受管 sidecar，不为此新增通用平台。
