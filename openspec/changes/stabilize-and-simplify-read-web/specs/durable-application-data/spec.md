## ADDED Requirements

### Requirement: ApplicationPersistence 必须是共享 files store 的唯一事务边界
所有对 `SeekPlayerDB/files` 的领域写入 SHALL 通过 `ApplicationPersistence` 的 typed key registry 与 transaction runner 完成。数据库名称 MUST 保持 `SeekPlayerDB`，version MUST 保持 `1`，object store MUST 保持 `files` 且 key path MUST 保持 `id`；本变更不得触发 IndexedDB schema upgrade。

#### Scenario: 打开现有用户数据库
- **WHEN** 新版本连接已有 `SeekPlayerDB` version 1
- **THEN** 系统 MUST 使用现有 `files` store 完成读写
- **THEN** `onupgradeneeded` MUST NOT 因本变更创建、删除或重建 store
- **THEN** 现有未知 key MUST 保持原值

#### Scenario: 领域代码请求持久化
- **WHEN** Reader Session、Vocabulary、Preview、Annotation、marks 或 activity 需要写入数据
- **THEN** 调用方 MUST 通过注册的 typed key 与事务 API 写入
- **THEN** 调用方 MUST NOT 直接持有 `IDBObjectStore` 或执行 `objectStore.clear()`

### Requirement: 持久化成功必须以 transaction 完成为准
transaction runner SHALL 仅在 `tx.oncomplete` 后 resolve 成功；request success、排队成功或函数返回 MUST NOT 被当作 durability 成功。任一 request error、transaction abort、quota error 或关闭连接 MUST reject 整个 Unit of Work，并向调用方返回可分类错误。

#### Scenario: 最后一个 put 成功后 transaction abort
- **WHEN** 所有 `put` request 已触发 success 但 transaction 随后 abort
- **THEN** persistence promise MUST reject
- **THEN** UI/store MUST NOT 将记录标记为 saved
- **THEN** 调用方 MUST 能保留 dirty state 并重试

#### Scenario: 多条相关记录共同提交
- **WHEN** 一个 Unit of Work 同时更新 entry、review state 与 activity
- **THEN** 所有更新 MUST 在同一个 readwrite transaction 中全部提交或全部回滚
- **THEN** 任何消费者 MUST NOT 观察到只完成部分更新的状态

### Requirement: 持久化记录必须使用可校验的版本化 envelope
受管数据 SHALL 使用包含 schema version、domain key、revision、updatedAt、payload 与 checksum 或等价完整性字段的 versioned envelope；Reader Session 数据还 MUST 包含 `contentId` 和 session revision。reader MUST 明确支持的 schema version，unknown 或 future schema MUST 被拒绝且原始值保持不变。

#### Scenario: 读取未来 schema version
- **WHEN** 当前应用读取到高于已支持版本的 envelope
- **THEN** 系统 MUST 返回 unsupported-schema 错误并保留原始记录
- **THEN** 系统 MUST NOT 用默认值或 normalize 后的数据覆盖该记录

#### Scenario: checksum 不匹配
- **WHEN** envelope payload 与其 checksum 不一致
- **THEN** 系统 MUST 将记录标记为 corrupt 并从正常读取路径隔离
- **THEN** 最近一个有效快照或备份 MUST 仍可用于恢复

### Requirement: 并发写入必须检测冲突并防止 lost update
对可由多个组件、标签页或后台任务更新的记录，系统 SHALL 使用 revision/CAS 或等价 optimistic concurrency control。提交时的 base revision 与当前 revision 不一致 MUST 产生 conflict，不得静默 last-write-wins；冲突解决 MUST 明确选择 reload、merge 或用户确认。

#### Scenario: 两个标签页修改同一 Vocabulary Entry
- **WHEN** 标签页 A 基于 revision 7 提交 revision 8 后，标签页 B 仍基于 revision 7 提交
- **THEN** 标签页 B 的写入 MUST 被拒绝为 conflict
- **THEN** revision 8 的数据 MUST 保持不变
- **THEN** 标签页 B MUST 获得可 reload 或 merge 的冲突信息

#### Scenario: 迟到的自动保存覆盖新编辑
- **WHEN** 较早 generation 的自动保存晚于较新编辑完成
- **THEN** revision guard MUST 阻止旧 payload 覆盖新 payload
- **THEN** dirty/saved 状态 MUST 对应当前 revision

### Requirement: 高频 marks 与 activity 写入必须合并且保持可见状态
marks 与 activity SHALL 由 one-in-flight、latest-wins ledger 管理；同一记录的高频更新 MUST 合并提交，且 store/UI MUST 暴露 dirty、saving、saved、conflict 与 error。失败不得丢弃内存中的最新意图，重试不得重复累计同一 activity event。

#### Scenario: 连续快速添加和删除 mark
- **WHEN** 第一笔 marks 保存未完成时又产生多次更改
- **THEN** 系统 MUST 最多保留一个 active write 与一个最新待提交快照
- **THEN** 最终持久化结果 MUST 等于用户最后一次编辑状态
- **THEN** 中间失败 MUST 显示 error/dirty 而不是虚假 saved

#### Scenario: activity 重试发生在 transaction 结果未知后
- **WHEN** 客户端因连接中断无法确认 activity transaction 结果并执行重试
- **THEN** event identity 或幂等 key MUST 防止同一 activity 被重复计数

### Requirement: DurableJsonRepository 必须提供崩溃安全的文件提交
后端可变 JSON 状态 SHALL 通过共享 `DurableJsonRepository` 写入：在同一文件系统创建唯一 temp、完整序列化、flush、`fsync`、以 `os.replace` 原子替换，并保留上一有效 backup 与 checksum。进程中断、磁盘满或并发 writer 失败 MUST NOT 破坏最后一个有效版本。

#### Scenario: 写入 JSON 中途进程终止
- **WHEN** 进程在 temp 写入后但 `os.replace` 前终止
- **THEN** canonical JSON MUST 保持为上一完整版本
- **THEN** 启动恢复 MUST 能安全识别并清理或隔离残留 temp

#### Scenario: canonical JSON 被截断
- **WHEN** 启动时 canonical 文件解析失败或 checksum 不匹配且上一 backup 有效
- **THEN** repository MUST 隔离损坏文件并从 backup 恢复可用状态
- **THEN** 隔离文件名与诊断事件 MUST 能关联原路径和失败原因

#### Scenario: 两个 writer 同时提交同一文件
- **WHEN** 两个并发操作尝试更新同一个 repository
- **THEN** repository MUST 通过进程内锁与 revision 检查串行化 commit
- **THEN** temp 文件名 MUST 唯一且后提交者 MUST 基于最新 revision 或得到 conflict

### Requirement: SQLite 衍生资产替换前必须验证完整性
通过导入、生成或升级得到的 SQLite 文件 SHALL 在独立 temp 路径构建，完成 transaction、关闭连接并通过 `PRAGMA integrity_check` 或等价验证后才能 atomic swap。现有 ECDICT SQLite service MUST 继续保持只读边界，且不得被 Reader Session、Vocabulary 或 SRS repository 直接写入。

#### Scenario: 新 SQLite 构建未通过完整性检查
- **WHEN** temp SQLite 的 integrity check 返回非 `ok`
- **THEN** 系统 MUST 拒绝替换 canonical 数据库
- **THEN** 当前有效数据库 MUST 保持可读
- **THEN** 失败 temp MUST 被隔离或删除并产生诊断记录

#### Scenario: ECDICT 查询触发 enrichment
- **WHEN** reader 或 SRS 请求 ECDICT transient suggestion
- **THEN** service MUST 只读查询 ECDICT
- **THEN** suggestion MUST NOT 自动持久化或覆盖用户已有 meaning

### Requirement: 损坏与未知数据必须隔离而不是自动清除
系统 SHALL 为 parse error、checksum mismatch、unsupported schema、invalid reference 与 partial legacy record 提供 corrupt/unknown quarantine。自动恢复 MUST 保留原始字节或值、来源 key、检测时间和原因；任何单条损坏 MUST NOT 触发全库清空。

#### Scenario: files store 中单条 annotation 记录损坏
- **WHEN** 其他 Reader Session 与 Vocabulary 记录仍然有效但一条 annotation 无法解析
- **THEN** 系统 MUST 只隔离该 annotation key
- **THEN** 其他领域数据 MUST 正常可用
- **THEN** 系统 MUST 提供导出诊断或从有效备份恢复该记录的路径

### Requirement: Legacy 数据迁移必须幂等且可回退
将 legacy plain record、localStorage 或分散文件迁入 versioned envelope 时，系统 SHALL 先只读扫描并生成 migration plan，再创建备份，然后以 per-record checkpoint 执行。重复运行 MUST 产生相同结果；失败 MUST 能回到迁移前数据，且不得改变 `SeekPlayerDB` version 或 `files` store 结构。

#### Scenario: 迁移在部分记录完成后中断
- **WHEN** 进程或页面在迁移 checkpoint 之后意外终止
- **THEN** 再次运行 MUST 从已验证 checkpoint 安全继续或完整回退
- **THEN** 已迁移记录 MUST NOT 被重复转换
- **THEN** legacy source MUST 在验收前保留

#### Scenario: dry-run 发现无法识别的记录
- **WHEN** migration dry-run 遇到未知 key 或无法确定语义的 payload
- **THEN** 报告 MUST 列出该记录且真实数据 MUST 保持不变
- **THEN** 正式迁移 MUST 在无明确策略时阻止继续覆盖该记录

### Requirement: 全量备份与恢复必须可验证且可演练
系统 SHALL 导出包含 format version、application/release version、创建时间、row registry、record counts、checksums 与引用关系的 backup manifest。默认备份 SHALL 包含所有用户生成和学习状态数据；大媒体默认只包含 identity、metadata 与可重绑定引用，不复制媒体内容。restore MUST 先 dry-run 验证兼容性、完整性、空间与冲突，再写入隔离目标并支持回滚。

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

### Requirement: 持久化层必须通过故障注入验证恢复语义
系统 SHALL 对 IndexedDB abort/quota、JSON 截断、`fsync` 或 replace 失败、SQLite integrity failure、重复 writer、进程终止和 restore 中断建立自动化 fault-injection tests。测试 MUST 验证最后有效数据、dirty/error 状态、quarantine evidence 与重试幂等性，而不只验证函数返回值。

#### Scenario: release verification 注入持久化故障
- **WHEN** `verify:release` 执行规定的 durability fault matrix
- **THEN** 每个故障点 MUST 证明数据处于旧版本或完整新版本，不能处于撕裂状态
- **THEN** 测试 MUST 保存 machine-readable 恢复结果和失败证据
- **THEN** 任一静默丢失、静默覆盖或无法回退 MUST 阻断发布
