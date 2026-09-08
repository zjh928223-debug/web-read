## ADDED Requirements

### Requirement: Mac 的第一版必用操作必须使用 Windows 持久化能力
Mac remote 使用路径 SHALL 复用现有 Windows owner/API 完成 Reader Session、marks 与 Workflow 的读取和保存。实现 MUST 以 Reader、播放/seek、marks，以及 URL 提交、Windows 下载/处理、基本状态和结果打开能否真实工作为准，不要求为每个数据域建立独立 query/command/checkpoint/review 阶段。

#### Scenario: 某个必用功能已经能够跨机使用
- **WHEN** 真实 Mac 用户旅程证明该必用功能能从 Windows 加载、保存并在刷新后恢复
- **THEN** 实现任务 MUST 保留现有路径
- **THEN** 实现任务 MUST NOT仅为了统一架构而重写 owner、adapter 或 persistence

#### Scenario: 某个必用功能仍依赖 Mac 唯一业务副本
- **WHEN** 清除可丢弃缓存或使用新浏览器后该必用功能无法从 Windows 恢复
- **THEN** 实现任务 MUST 最小修复该功能与现有 Windows API 的连接
- **THEN** 修复 MUST NOT扩展为通用离线同步、browser outbox 或多 writer 系统

### Requirement: 辅助学习功能默认不得阻塞第一版迁移
Preview、Annotation、Vocabulary 和 SRS SHALL 只进行低成本现状确认。已经工作的路径 MUST 保持；失败路径 SHALL 记录为非阻塞问题并暂缓，除非用户在执行前明确将某项提升为第一版必用功能。

#### Scenario: 辅助功能在 Mac 上失败
- **WHEN** Reader、marks 和 workflow 主路径已经可用，但某个辅助功能仍有跨机问题
- **THEN** `E-201` MAY 在报告中记录该问题并继续完成
- **THEN** `R-201` MUST NOT仅因该辅助功能问题判定迁移失败

### Requirement: Windows 不可用时不得静默产生 Mac canonical writer
Windows Host 暂时不可用时，Mac SHALL 保留当前 UI 状态或显示重试提示，但 MUST NOT将新的业务 mutation 仅持久化到 Mac 并宣告成功。

#### Scenario: 保存操作期间失去 Windows 连接
- **WHEN** Mac 无法确认 Windows 已保存用户操作
- **THEN** UI MUST显示失败、未知或可重试状态
- **THEN** UI MUST NOT把只写入 Mac 缓存视为 durable success

### Requirement: 个人工具范围不得扩展为企业或多用户系统
本变更 MUST NOT实现网段扫描、MAC/设备指纹、多用户协调、HA、rate limit、复杂账号系统、应用内 PKI、长期兼容矩阵或为理论威胁建立的额外防护。已经存在且正常工作的边界 MAY 保留。

#### Scenario: 评审提出范围外防护
- **WHEN** 建议不对应单用户 Mac → Windows 真实功能、数据恢复、环境隔离或明确回归风险
- **THEN** 建议 MUST记录为 non-goal 或未来可选项
- **THEN** 当前实现和验收 MUST NOT因此阻塞
