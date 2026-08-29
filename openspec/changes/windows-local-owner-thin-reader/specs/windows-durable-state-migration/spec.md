## ADDED Requirements

### Requirement: 迁移必须以逐域 inventory、backup、import 和 verify 执行

Windows backup、import 和 owner migration SHALL 使用为六域注册的 adapter，并以 `inventory → backup/checksum → one-time import/dry-run → verify` 的顺序处理每个 domain。最小 manifest MUST 记录 format/schema、domain、record count、checksum、revision 和 media reference metadata；unknown key、unsupported schema、corrupt payload 或 unclaimed record MUST 阻止受影响 domain 继续写入，不能静默丢弃。

#### Scenario: 创建切换前 backup

- **WHEN** domain 准备从 browser direct writer 转移到 Host
- **THEN** system MUST 完成 read-only inventory 并保存该 domain 的 checksum/rollback backup
- **THEN** backup MUST 列出六域（空域也列出），排除 secret、temporary file 和完整 media bytes

#### Scenario: dry-run 发现无法迁移的 record

- **WHEN** inventory 或 restore dry-run 发现 unknown key、schema mismatch、checksum/reference 错误或明显 revision conflict
- **THEN** operation MUST 返回 typed blocked/conflict result
- **THEN** canonical value、legacy source 和既有 backup MUST 保持不变

### Requirement: 每个 domain 的 writer switch 必须简单、单一且可回退

每个 domain SHALL 在自己的 profile lease/必要 journal 下执行 `freeze old writer → copy/import → verify → switch to Host → smoke check`。freeze 后 compatibility path 只能 read-only/import-evidence；switch 后新的 durable mutation 只能由 Host-managed repository API 提交，不得保留长期双写。某个 domain 失败时 MUST 停止后续该域步骤，使用该域 pre-switch backup/ revision evidence 回退或保持 not-ready；本变更不要求六域 global transaction。

#### Scenario: domain 切换成功

- **WHEN** backup、import/dry-run、checksum 和核心 smoke check 通过，且旧 writer 已冻结
- **THEN** Host-managed repository MUST 成为该 domain 的唯一 canonical writer
- **THEN** legacy browser path MUST 保持 read-only，所有新的 mutation MUST 返回 Host receipt

#### Scenario: freeze、verify 或 switch 失败

- **WHEN** 旧 writer 无法冻结、导入校验失败或 Host replace 失败
- **THEN** system MUST NOT 打开双写
- **THEN** 旧 canonical value MUST 保留或从 pre-switch backup 恢复，并返回 typed failure/not-ready

### Requirement: API-authoritative record 与媒体引用必须留在 Host boundary

完成切换的 domain 的 canonical record MUST 存放在由 Windows Local App Host 管理 lifecycle、lock、revision、backup 和 recovery 的 repository 中。Browser `IndexedDB`/`localStorage` bridge 只可提供 read-only inventory、一次性 import input 或 rollback compatibility read。完整媒体 MUST 不进入 repository、backup 或 migration；只保存 identity/reference metadata 和可重绑定信息。

#### Scenario: 只有 browser bridge 可用

- **WHEN** Host repository 缺失或无法提供 commit/recovery evidence
- **THEN** domain MUST 保持 legacy-owner 或 not-ready
- **THEN** system MUST NOT 声明 Host authority 或打开 browser fallback writer

#### Scenario: 迁移大媒体引用

- **WHEN** inventory/import 处理 audio/video record
- **THEN** migration MUST 只复制 media identity、size、content type、ETag/revision 和 authorized reference
- **THEN** migration MUST NOT 读取或写入完整 Blob/ArrayBuffer/bytes/data URI/base64 media

### Requirement: 当前 IndexedDB schema 必须保持 frozen

Migration MUST 继续使用 `SeekPlayerDB` version `1`、object store `files` 和 key path `id`，并 MUST NOT 创建、删除、重命名、clear 或重建该 store。若未来确实需要 schema change，当前 change MUST 停止并指向另一个明确授权的 migration change。

#### Scenario: legacy import 保留 schema

- **WHEN** migration 读取包含 `SeekPlayerDB/files` 的 profile
- **THEN** system MUST 保留 database/version/store/keyPath 和 unknown key evidence
- **THEN** operation MUST NOT 触发 `onupgradeneeded` 或 reset
