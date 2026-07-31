## ADDED Requirements

### Requirement: 学习事件必须追加写入且不可原地改写
系统 MUST 以 append-only 方式保存 acquisition、graduation、review、reassessment 和 policy 事件；对错误记录的纠正 MUST 使用补偿事件。

#### Scenario: 正常追加事件
- **WHEN** 一个业务命令成功提交
- **THEN** 系统追加具有唯一 `event_id` 的事件
- **AND** 已有事件内容保持不变

#### Scenario: 纠正错误元数据
- **WHEN** 系统发现一个已写事件的元数据错误
- **THEN** 系统追加引用原 `event_id` 的 correction event
- **AND** 系统不覆盖原始事件

### Requirement: Event envelope 必须包含可重放与分析所需元数据
系统 MUST 为有效 attempt 记录身份、时间、session 位置、学习单位、策略版本、提示条件、rating、有效耗时、内容版本、来源和前后状态。

#### Scenario: Review attempt
- **WHEN** 用户成功完成一次 review rating
- **THEN** 事件至少包含 `event_id`、`event_type`、`occurred_at`、`session_id`、`session_position`、`learning_unit_id`、`policy_version`、`prompt_mode`、`cue_level`、`rating`、`active_duration_ms`、`before_state` 和 `after_state`

#### Scenario: Acquisition attempt
- **WHEN** 用户完成一次 acquisition 检查
- **THEN** 事件包含目标义项、所用 `ContextEvidence`、是否提前揭示答案和 graduation eligibility 结果

### Requirement: 事件存储不得要求 IndexedDB schema migration
系统 MUST 在 `SeekPlayerDB` version 1 的现有 `files` object store 中以命名 row 和分片保存事件，且不得把无限事件追加到单个无界 JSON row。

#### Scenario: 新月份或达到分片阈值
- **WHEN** 当前事件分片达到大小阈值或进入新的时间分区
- **THEN** repository 创建新的命名分片并原子更新 manifest
- **AND** 不提升数据库版本或创建 object store

#### Scenario: 分片写入失败
- **WHEN** 新分片或 manifest 更新失败
- **THEN** 业务事务按其一致性规则回滚或记录可恢复的 outbox 状态
- **AND** 系统不得静默丢失已报告成功的 attempt

### Requirement: 数据质量与训练资格必须显式标记
系统 MUST 为每个 attempt 计算 `training_eligible` 和 `exclusion_reasons`，并默认排除不可解释 legacy、重复提交、异常耗时、缺失提示元数据和无效状态转换。

#### Scenario: Legacy review log
- **WHEN** 旧 review log 没有可靠的 cue、policy 或目标义项信息
- **THEN** 转换事件标记 `is_legacy: true`
- **AND** `training_eligible` 默认为 false

#### Scenario: 后台停留造成异常耗时
- **WHEN** wall-clock duration 很长但 active duration 不可靠
- **THEN** 事件仍可用于审计
- **AND** 事件不得进入速度估计或参数训练

### Requirement: 用户必须能够导出可解释的数据集
系统 MUST 提供版本化导出，包含事件、字段字典、策略版本、scheduler 配置和排除原因，并且导出不得包含应用无权再分发的完整版权语料。

#### Scenario: 导出个人学习事件
- **WHEN** 用户请求导出
- **THEN** 系统生成可机器读取的数据文件和 schema/version metadata
- **AND** 每个被排除的事件仍保留其 exclusion reason

#### Scenario: 版权语境导出
- **WHEN** 事件引用用户本地导入的受版权保护语境
- **THEN** 默认导出只包含本地 source id、hash 和 locator
- **AND** 只有用户显式选择包含个人内容时才导出句子文本

### Requirement: 个性化优化必须经过样本门槛和时间留出评估
系统 MUST 在合格跨日 review attempt 不足时继续使用默认参数；候选参数 MUST 在按时间切分的 holdout 上优于当前参数并通过 sanity checks。

#### Scenario: 数据不足
- **WHEN** 合格事件少于配置门槛或集中在过少自然日
- **THEN** 系统不生成可发布的个性化参数
- **AND** 系统报告还缺少哪些数据

#### Scenario: 候选参数过拟合
- **WHEN** 候选参数只改善训练集但未改善时间 holdout
- **THEN** 系统拒绝发布该候选

#### Scenario: 候选参数通过
- **WHEN** 候选参数达到样本门槛、改善 holdout 指标并通过边界检查
- **THEN** 系统创建具有版本、训练窗口、指标和影响摘要的待确认候选
- **AND** 系统不自动批量重排现有卡片

### Requirement: 派生报告必须能从原始事件重建
系统 MUST 将速度估计、能力分层、retention 指标和策略比较视为可重建派生数据，而不是唯一事实来源。

#### Scenario: 清除派生缓存
- **WHEN** 派生报告缓存被删除或版本升级
- **THEN** 系统可从 append-only 事件和策略元数据重新计算报告
- **AND** 原始事件不受影响

#### Scenario: 比较同日策略
- **WHEN** 系统比较 `once_daily`、`balanced` 与 `intensive`
- **THEN** 报告使用跨日 retention、耗时和负担指标
- **AND** 报告不得仅以同日正确率判断某一策略更优
