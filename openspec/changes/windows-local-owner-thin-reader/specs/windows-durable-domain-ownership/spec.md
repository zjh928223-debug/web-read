## ADDED Requirements

### Requirement: Windows application profile 必须暴露六个唯一 durable domain owner
Local App Host SHALL 在 profile ready 之前，为 `reader-session`、`vocabulary-srs`、`passage-preview`、`annotation`、`marks-activity` 和 `workflow` 各注册一个 canonical owner facade。每个 registration MUST 声明 canonical records、支持的 schema versions、query/command surface、current revision source、backup adapter 和 recovery handler。在 API-authoritative mode 下，每条 canonical record MUST 位于 Windows Host 管理的 repository 中；该 repository MAY 由独立的 host-managed service 提供，但 browser 的 `IndexedDB`/`localStorage` bridge MUST NOT 成为最终 repository 或 commit executor，browser code 也 MUST NOT 成为第二个 owner。

#### Scenario: Host 启动并完成 owner registry
- **WHEN** Local App Host 完成 Windows application profile 的启动
- **THEN** readiness MUST 列出六个 domain owner 的唯一 identity、支持的 schema 和 current revision evidence
- **THEN** capability response MUST 标明各 domain command 是 writable、read-only 还是 unavailable

#### Scenario: Owner registry 不完整或有歧义
- **WHEN** 某个 domain adapter 缺失、重复、未认领或报告 unsupported schema
- **THEN** Local App Host MUST 对 durable operation 保持 not-ready
- **THEN** host MUST 保留现有 canonical data，并发出包含 domain 和 correlationId 的 typed diagnostic

#### Scenario: Owner registry 仅指向 browser bridge
- **WHEN** 某个 domain 没有具备 transaction/revision/recovery evidence 的 ready Host-managed repository，且只有 browser persistence bridge 可用
- **THEN** 该 domain MUST 按 migration journal 保持 old-owner 或 not-ready/manual-recovery
- **THEN** host MUST NOT 声明 API authority，也 MUST NOT 允许 bridge 确认 canonical commit

### Requirement: Durable domain 写入必须经过 Windows owner API
六个 domain 的所有 durable mutation SHALL 通过 owner facade 及其授权 command contract 进入。Browser component、Pinia store、legacy facade 和 workflow client MUST NOT 直接写入 canonical `IndexedDB`、`localStorage`、SQLite 或 JSON record。Compatibility adapter MAY 仅在显式 migration operation 下读取或 import legacy record，且 MUST NOT 暴露第二条 UI write path。

#### Scenario: Browser 请求正常 durable mutation
- **WHEN** Reader、Vocabulary/SRS、Preview、Annotation、marks/activity 或 workflow UI 提交 mutation
- **THEN** browser MUST 发送包含 domain、operation、correlationId 以及所需 expected revision 或 idempotency key 的 typed owner command
- **THEN** owner MUST 是唯一能够确认 canonical durable write 的 component

#### Scenario: 已退役 direct writer 尝试 canonical write
- **WHEN** legacy browser path 在 owner-mode checkpoint 将该 domain 记录为 API-authoritative 后调用 direct durable writer
- **THEN** architecture/runtime gate MUST 在 canonical record 改变前拒绝或 quarantine 该 write
- **THEN** UI MUST NOT 根据该 rejected path 显示 saved state

### Requirement: Owner commit 必须发布 revision evidence 并防止 lost update
每个可变 domain SHALL 使用 monotonic revision、expected-revision CAS 或等价的 concurrency guard。若 retry 可能重复 side effect，mutation MUST 包含 idempotency key；owner MUST 返回包含 authoritative revision 的 durable commit receipt。durability result 未知的 request MUST 在 receipt query 解决前表示为 `commit-unknown`。

#### Scenario: 两个 client 提交同一 base revision
- **WHEN** 两个 browser client 都基于 revision 7 提交 mutation
- **THEN** 只有一个合法 transition MAY 提交 revision 8
- **THEN** 另一个 client MUST 收到带 current revision 的 typed conflict，且 MUST NOT 覆盖 revision 8

#### Scenario: Owner 写入后 commit result 丢失
- **WHEN** owner 可能已经提交 mutation，但 client 尚未收到 response 时 network 或 process boundary 发生故障
- **THEN** client MUST 保留 dirty/unknown state，并查询 idempotency receipt 或 authoritative revision
- **THEN** 使用相同 idempotency key 重试 MUST NOT 重复该 mutation 或 activity event

### Requirement: 跨 domain durable 变更必须使用 profile lease 和 journal
涉及多个 durable domain 的 operation（包括 full restore、migration cutover 和 material publication）SHALL 在第一次 owner commit 前取得 application-profile lease 并记录 pending journal。该 operation MUST 只从完整 baseline 或完整 staged revision 发布 read，绝不能发布未记录的 domain revision 混合状态。

#### Scenario: 跨 domain commit 达到可见 revision
- **WHEN** profile operation 准备好所有请求的 domain adapter，并在 lease 下完成 commit
- **THEN** 每个 committed domain revision 和 operation id MUST 在新 profile revision 暴露前写入记录
- **THEN** owner read MUST 只能观察到之前的完整 baseline 或完整 committed staged state

#### Scenario: Host 在一个 domain commit 后退出
- **WHEN** process 在两个 domain commit 之间、且 pending journal 仍存在时终止
- **THEN** 下一次 startup MUST 在 readiness 之前将 journal 恢复为完整 baseline 或完整 staged state
- **THEN** host MUST 保持 not-ready，且 MUST NOT 在 recovery evidence 不完整时暴露 partial cross-domain snapshot

### Requirement: Owner health 和 authorization 必须 fail closed
Owner API SHALL 区分 liveness、readiness、domain availability、lease ownership、recovery state 和 authorization。缺失 token、无效 Host/Origin、non-loopback binding、stale capability、缺失 revision evidence、corrupt data 或 unknown schema MUST 阻止受影响的 side effect，而不是选择 browser fallback writer。

#### Scenario: Domain owner 不可用
- **WHEN** browser 在 owner recovering、stopped、conflicted 或 marked corrupt 时请求 mutation
- **THEN** API MUST 在任何 write 之前返回 typed `not-ready`、`conflict`、`corrupt` 或 `manual-recovery` result
- **THEN** browser MUST 保留 unsaved intent，并显示 retry、export、rebind 或 recovery action，且不得在本地写入

#### Scenario: 未授权或 non-loopback request 到达 mutation endpoint
- **WHEN** request 缺少 instance token、未通过 Host/Origin validation 或通过 non-loopback bind 到达
- **THEN** owner MUST 在读取任意路径、凭据或 durable record 之前拒绝 request
- **THEN** canonical domain state、revision 和 job state MUST 保持不变
