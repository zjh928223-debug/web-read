## MODIFIED Requirements

### Requirement: ApplicationPersistence 必须保持 frozen files store 的受控边界

所有仍触及 `SeekPlayerDB/files` 的 legacy inventory、一次性 import 或 rollback compatibility 操作 SHALL 通过受控的 `ApplicationPersistence` typed key registry 与 transaction runner 完成。数据库名称 MUST 保持 `SeekPlayerDB`，version MUST 保持 `1`，object store MUST 保持 `files` 且 key path MUST 保持 `id`；本变更不得触发 schema upgrade。完成某个 domain 的 owner 切换后，browser bridge MUST NOT 成为该 domain 的 canonical repository、commit executor 或 writer。

#### Scenario: 打开现有用户数据库

- **WHEN** 新版本连接已有 `SeekPlayerDB` version 1
- **THEN** 系统 MUST 使用现有 `files` store 完成受 owner 控制的读取或显式 migration operation
- **THEN** `onupgradeneeded` MUST NOT 因本变更创建、删除或重建 store
- **THEN** 现有未知 key MUST 保持原值

#### Scenario: legacy domain record 请求受控 operation

- **WHEN** inventory、一次性 import 或 rollback compatibility 需要访问六域的 legacy record
- **THEN** 调用方 MUST 通过注册的 typed key 与 `ApplicationPersistence` transaction API 访问，并把 import target 指向 Windows Host-managed repository
- **THEN** 调用方 MUST NOT 直接持有 `IDBObjectStore`、执行 `objectStore.clear()` 或确认新的 canonical commit

### Requirement: 备份与逐域迁移必须可校验、可回退且不复制媒体

系统 SHALL 对每个 domain 按 `read-only inventory → dry-run/容量与格式检查 → freeze old writer → final backup/checksum → one-time final copy/import → verify → switch Host authoritative writer → smoke check → rollback if needed` 执行迁移。freeze 前只允许只读 inventory、预备 backup 或 dry-run；用于切换的 final backup/checksum 和唯一正式 copy/import MUST 在 freeze 后取得/执行。最小 backup manifest MUST 记录 format/schema、domain counts、checksums、revision 和 media reference metadata；一次性 final copy/import 和 restore MUST 在写入前校验 schema、checksum、content/reference 与明显 revision conflict。每个 domain 以自己的 backup、旧值和 rollback target 完成或停止，不要求跨异构存储的 global transaction。失败 MUST 保留旧 canonical value，且未知或损坏记录不得被静默丢弃。完整媒体 MUST 不进入 backup 或 migration。

#### Scenario: 冻结后创建切换用 final backup

- **WHEN** 某个 domain 准备从 browser writer 转移到 Host
- **THEN** system MUST 先完成该 domain 的 read-only inventory 和 dry-run/容量与格式检查
- **THEN** freeze old writer 后 system MUST 保存用于切换的 final checksum 和可回退 backup
- **THEN** backup MUST 记录六域清单（空域也要列出）并排除 secret、temporary file 与完整 media bytes

#### Scenario: 一次性 import 或 restore 发现问题

- **WHEN** dry-run 发现 unknown key、unsupported schema、checksum mismatch、content/reference 不匹配或目标 revision 冲突
- **THEN** operation MUST 返回 typed blocked/conflict result，且 MUST NOT 覆盖当前 canonical value
- **THEN** 原始 legacy source 和已有 backup MUST 保持可读

#### Scenario: 单域写入失败后回退

- **WHEN** import、restore 或 owner switch 在一个 domain 的 write/replace 阶段失败
- **THEN** 该 domain MUST 保留旧值或恢复到该 domain 的 pre-switch backup
- **THEN** 系统 MUST 停止该域后续切换，不得打开长期双写，也不得把完整媒体写入任何 durable store
