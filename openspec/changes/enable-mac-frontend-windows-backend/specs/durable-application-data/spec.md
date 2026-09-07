## MODIFIED Requirements

### Requirement: ApplicationPersistence 必须是共享 files store 的唯一事务边界
本地兼容模式下，所有对 `SeekPlayerDB/files` 的领域写入 SHALL 继续通过 `ApplicationPersistence` 的 typed key registry 与 transaction runner 完成。数据库名称 MUST保持 `SeekPlayerDB`，version MUST保持 `1`，object store MUST保持 `files` 且 key path MUST保持 `id`；本变更不得触发 IndexedDB schema upgrade。remote mode 完成某一领域 authority checkpoint 后，该领域的 canonical mutation MUST只通过 Windows owner；对应 IndexedDB/localStorage/audio-folder adapter MUST降为只读 migration/rollback adapter 或明确的非权威 UI 状态。

#### Scenario: 打开现有用户数据库
- **WHEN** 新版本连接已有 `SeekPlayerDB` version 1
- **THEN** 系统 MUST使用现有 `files` store 完成被允许的本地兼容或迁移读取
- **THEN** `onupgradeneeded` MUST NOT因本变更创建、删除或重建 store
- **THEN** 现有未知 key MUST保持原值

#### Scenario: 本地兼容模式请求持久化
- **WHEN** 未启用 remote authority 的 Reader Session、Vocabulary、Preview、Annotation、marks 或 activity 需要写入本地数据
- **THEN** 调用方 MUST通过注册的 typed key 与事务 API 写入
- **THEN** 调用方 MUST NOT直接持有 `IDBObjectStore` 或执行 `objectStore.clear()`

#### Scenario: remote mode 已完成领域接管
- **WHEN** 某一领域的 Windows authority checkpoint 已提交
- **THEN** 该领域的 canonical mutation MUST只发送到 Windows owner
- **THEN** 浏览器 writer MUST被阻断且 MUST NOT在 Host 不可用时静默恢复写入
