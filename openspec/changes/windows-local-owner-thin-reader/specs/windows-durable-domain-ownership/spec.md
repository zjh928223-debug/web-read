## ADDED Requirements

### Requirement: Windows application profile 必须为六域建立唯一 owner registration

Local App Host SHALL 为 `reader-session`、`vocabulary-srs`、`passage-preview`、`annotation`、`marks-activity` 和 `workflow` 各注册一个 canonical owner facade。每个 registration MUST 声明最小 canonical record、支持的 schema、query/command surface、revision source 和 backup/restore target。某个 domain 完成切换后，其 canonical record MUST 位于 Host-managed repository；browser `IndexedDB`/`localStorage` bridge MUST NOT 成为最终 repository、commit executor 或第二 owner。

#### Scenario: owner registry 可用

- **WHEN** Local App Host 为 profile 建立六域 registry
- **THEN** capability/readiness MUST 能标识每个 domain 的 owner、当前 revision 和 `ready`/`legacy`/`not-ready` 状态
- **THEN** 已切换 domain 的新 durable mutation MUST 只能进入 Host-managed repository

#### Scenario: registry 或某个 domain 尚未准备好

- **WHEN** domain owner、repository、schema 或 revision evidence 缺失或无效
- **THEN** 该 domain MUST 保持 legacy-owner 或 not-ready，并保留现有数据
- **THEN** host MUST NOT 允许 browser fallback writer 冒充 canonical owner

### Requirement: Durable domain mutation 必须经过 owner API 并提供基本 receipt

六域新的 durable mutation SHALL 通过 owner facade 及 typed command 进入。每个可变 domain MUST 使用 monotonic revision、expected-revision CAS 或等价的单用户 lost-update guard；可能重试的 mutation MUST 带 idempotency key。提交成功 MUST 返回 authoritative revision 和 durable receipt；结果未知时 MUST 返回或可查询 `commit-unknown`，不得盲目重复副作用。已切换 domain 的 legacy path 只能 read-only/inventory/import-evidence。

#### Scenario: 正常 mutation 与重复 retry

- **WHEN** browser 通过 owner API 提交带 expected revision 和 idempotency key 的 command
- **THEN** owner MUST 原子写入该 domain，并返回 revision/receipt
- **THEN** 使用相同 key 重试 MUST 返回同一 logical result，不得重复写入

#### Scenario: 明显 revision conflict

- **WHEN** command 的 expected revision 不是当前 revision
- **THEN** owner MUST 返回 typed conflict
- **THEN** canonical record MUST 保持原值，不得由 browser storage 补写

### Requirement: Owner authorization 必须保持 loopback fail-closed

Owner API SHALL 只绑定 Windows loopback，并对 durable command、受保护文件读取和 workflow 高权限操作校验 Host、Origin、instance token、profile capability、path/operation 和适用的 revision/idempotency。缺失或不匹配的授权 MUST 在副作用前拒绝；错误不得暴露 token、完整受保护路径或媒体 bytes。

#### Scenario: 未授权或越界请求

- **WHEN** request 使用 non-loopback、错误 Host/Origin、无效 token/capability 或越界 path/operation
- **THEN** service MUST 返回 typed unauthorized/permission result
- **THEN** domain revision、job state 和 filesystem state MUST 保持不变

#### Scenario: 已切换 direct writer 尝试写入

- **WHEN** legacy browser path 尝试修改已 API-authoritative domain
- **THEN** host/runtime gate MUST 拒绝或隔离该 write
- **THEN** UI MUST NOT 根据该 path 显示 saved
