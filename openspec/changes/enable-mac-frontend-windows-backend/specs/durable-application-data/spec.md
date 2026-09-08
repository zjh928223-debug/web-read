## MODIFIED Requirements

### Requirement: Mac remote 使用路径的必用数据必须可从 Windows 恢复
Mac 通过 Windows production 页面使用应用时，Reader Session、marks 与 Workflow 结果 SHALL 能从 Windows 数据恢复。Mac MAY 保存主题、布局、面板状态和可丢弃缓存，但 Mac 本地状态 MUST NOT 是恢复第一版必用数据的唯一来源。Preview、Annotation、Vocabulary/SRS 默认是非阻塞辅助功能；除非用户明确提升优先级，它们的问题 MUST NOT阻止第一版迁移。

#### Scenario: 清除 Mac 可丢弃缓存或更换浏览器
- **WHEN** 用户重新打开 Windows 提供的页面
- **THEN** 已保存在 Windows 的素材、Reader Session、marks 和 workflow 结果 MUST 能重新加载
- **THEN** 系统 MUST NOT要求从 Mac IndexedDB、localStorage 或 audio-folder 找回唯一业务副本

#### Scenario: Windows 暂时不可用
- **WHEN** Mac 无法连接 Windows
- **THEN** 页面 MUST 显示不可用或可重试状态
- **THEN** 页面 MUST NOT把 Mac 缓存提升为新的 canonical 数据源

### Requirement: 本变更不得升级现有 IndexedDB schema
数据库名称 MUST保持 `SeekPlayerDB`，version MUST保持 `1`，object store MUST保持 `files` 且 key path MUST保持 `id`。为了支持 Mac remote 使用，系统 MUST NOT创建、删除或重建 store。

#### Scenario: 打开现有本地兼容数据库
- **WHEN** 应用连接已有 `SeekPlayerDB` version 1
- **THEN** 现有 store 和未知 key MUST保持不变
- **THEN** 本变更 MUST NOT触发 schema upgrade
