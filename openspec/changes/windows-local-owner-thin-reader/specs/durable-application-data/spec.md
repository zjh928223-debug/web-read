## MODIFIED Requirements

### Requirement: ApplicationPersistence 必须是共享 files store 的唯一事务边界
所有仍然触及 `SeekPlayerDB/files` 的 legacy inventory、一次性 import 或 rollback-window compatibility 操作 SHALL 通过受控的 `ApplicationPersistence` typed key registry 与 transaction runner 完成。数据库名称 MUST 保持 `SeekPlayerDB`，version MUST 保持 `1`，object store MUST 保持 `files` 且 key path MUST 保持 `id`；本变更不得触发 IndexedDB schema upgrade。API-authoritative 阶段的六域 canonical durable records MUST 位于 Windows Host-managed repository，browser `ApplicationPersistence`/compatibility facade MUST NOT 成为最终 repository、commit executor 或 canonical writer。

#### Scenario: 打开现有用户数据库
- **WHEN** 新版本连接已有 `SeekPlayerDB` version 1
- **THEN** 系统 MUST 使用现有 `files` store 完成受 owner 控制的读写
- **THEN** `onupgradeneeded` MUST NOT 因本变更创建、删除或重建 store
- **THEN** 现有未知 key MUST 保持原值

#### Scenario: legacy domain record 请求受控 operation
- **WHEN** migration inventory、一次性 import 或 rollback-window compatibility 需要访问 `Reader Session`、Vocabulary、Preview、Annotation、marks 或 activity 的 legacy record
- **THEN** 调用方 MUST 通过注册的 typed key 与 `ApplicationPersistence` transaction API 访问，并把 API-authoritative import target 指向 Windows Host-managed repository
- **THEN** 调用方 MUST NOT 直接持有 `IDBObjectStore` 或执行 `objectStore.clear()`，且该 browser store MUST NOT acknowledge a canonical commit

#### Scenario: API-authoritative domain 请求 durable mutation
- **WHEN** a domain has completed its owner-mode checkpoint and the browser submits a new durable mutation
- **THEN** the Windows owner API MUST commit the record in the Host-managed repository and return its revision/receipt
- **THEN** `ApplicationPersistence`/browser bridge MUST NOT execute or acknowledge that canonical mutation

#### Scenario: domain cutover 后 browser direct writer 已退役
- **WHEN** 一个 domain 的 owner-mode checkpoint 已记录 Host repository authoritative 且旧 writer blocked
- **THEN** `ApplicationPersistence` 只能由受控 owner adapter 或显式 migration/import operation 使用
- **THEN** browser direct writer、localStorage fallback 和 raw IndexedDB facade MUST 被 architecture/runtime gate 拒绝或标记为 compatibility-read-only

### Requirement: Legacy 数据迁移必须幂等且可回退
将 legacy plain record、localStorage、`SeekPlayerDB/files` 或分散文件迁入 owner-managed versioned envelope 时，系统 SHALL 先只读扫描并生成 migration plan，再创建包含六个 domain checksum 的备份，然后以 per-domain/per-record checkpoint 执行。重复运行 MUST 产生相同结果；失败 MUST 能回到迁移前数据，且不得改变 `SeekPlayerDB` version 或 `files` store 结构。迁移完成后 legacy browser source MUST 至少保留为 read-only rollback source，直到回滚窗口结束。

#### Scenario: 迁移在部分记录完成后中断
- **WHEN** 进程或页面在迁移 checkpoint 之后意外终止
- **THEN** 再次运行 MUST 从已验证 checkpoint 安全继续或完整回退
- **THEN** 已迁移记录 MUST NOT 被重复转换
- **THEN** legacy source MUST 在验收前保留

#### Scenario: dry-run 发现无法识别的记录
- **WHEN** migration dry-run 遇到未知 key 或无法确定语义的 payload
- **THEN** 报告 MUST 列出该记录且真实数据 MUST 保持不变
- **THEN** 正式迁移 MUST 在无明确策略时阻止继续覆盖该记录

#### Scenario: API cutover 需要回滚
- **WHEN** domain 的 isolated Host-repository canary、owner-mode checkpoint 或 post-cutover journey 失败且 owner revision 可能已经前进
- **THEN** 系统 MUST 先停止新 writer、读取 migration journal 和 committed revision evidence，再以 expected-revision CAS 使用 pre-cutover backup 回滚
- **THEN** 系统 MUST NOT 重新打开两个同时可写的 authoritative writer；证据不足或发现更新 writer 时 MUST 返回 conflict/manual-recovery 并保留较新状态

### Requirement: 全量备份与恢复必须可验证且可演练
系统 SHALL 导出包含 format version、application/release version、创建时间、row registry、record counts、checksums 与引用关系的 backup manifest，并明确列出 `reader-session`、`vocabulary-srs`、`passage-preview`、`annotation`、`marks-activity`、`workflow` 六个 domain。默认备份 SHALL 包含所有用户生成和学习状态数据；大媒体默认只包含 identity、metadata 与可重绑定引用，不复制媒体内容。restore MUST 先 dry-run 验证兼容性、完整性、空间与冲突，再在 profile lease 下写入隔离目标并支持 journal recovery/rollback。

#### Scenario: 创建完整学习数据备份
- **WHEN** 用户或迁移流程请求 full backup
- **THEN** backup MUST 包含 Reader Session 小型数据、Vocabulary、Review、Annotation、marks、activity 与 workflow durable state 的清单和 checksum
- **THEN** backup MUST 排除 access token、API secret、临时文件与完整大媒体 Blob
- **THEN** backup verification MUST 在不依赖当前进程内状态的情况下重新读取并校验产物

#### Scenario: 恢复包包含冲突 revision
- **WHEN** restore dry-run 发现目标数据的 revision 新于 backup
- **THEN** 系统 MUST 输出逐领域冲突报告并阻止静默覆盖
- **THEN** 用户或迁移任务 MUST 明确选择 keep、restore 或 merge 后才能 commit

#### Scenario: 隔离目录恢复演练
- **WHEN** release gate 在空的隔离数据目录执行 restore rehearsal
- **THEN** 恢复后的 record counts、checksums 与关键用户 journey MUST 通过验证
- **THEN** 原始日用数据目录 MUST 保持只读且不发生变化

#### Scenario: owner 在跨域 restore 中途退出
- **WHEN** host 在某个 domain 已提交但 profile journal 尚未完成时退出
- **THEN** 下一次 startup MUST 在 readiness 前完成 baseline 或 staged revision 的恢复并验证六域 checksum
- **THEN** 对外的 owner read MUST NOT 返回半完成的跨域组合
