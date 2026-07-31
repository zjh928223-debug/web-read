## ADDED Requirements

### Requirement: 复习评分必须保持四级且语义稳定
系统 MUST 只向 FSRS 调度器提交 `again`、`hard`、`good`、`easy` 四种 rating，并在 UI 中分别呈现为“忘记、困难、一般、容易”。

#### Scenario: 四级评分提交
- **WHEN** 用户选择任一中文评分
- **THEN** 系统提交唯一对应的 FSRS rating
- **AND** review log 保存相同 rating

#### Scenario: 非法评分
- **WHEN** 调用方提交四级以外的 rating
- **THEN** 系统拒绝提交且不改变 `ReviewState`

### Requirement: Rating 与提示条件必须分开记录
系统 MUST 在每个 review attempt 中分别记录 rating、`prompt_mode`、`cue_level` 和评分前是否揭示答案。

#### Scenario: 借助原句答对
- **WHEN** 用户在 `original_context` 下评分为 `good`
- **THEN** 调度器接收 `good`
- **AND** 事件同时保留 `original_context` 和实际 `cue_level`

#### Scenario: 孤立词答对
- **WHEN** 用户在 `word_only` 且未揭示答案时评分为 `good`
- **THEN** 系统不得将该 attempt 与已显示中文释义的 `good` 合并为相同分析样本

### Requirement: 复习队列必须只包含已毕业学习单位
系统 MUST 从存在 active `ReviewState` 的 graduated `LearningUnit` 构建正式 review queue。

#### Scenario: acquiring 词到期
- **WHEN** 一个 acquiring 词具有 acquisition 内部的下一次检查时间
- **THEN** 它进入 acquisition queue
- **AND** 它不进入正式 review queue

#### Scenario: 已毕业词到期
- **WHEN** graduated `LearningUnit` 的 `ReviewState.due_at` 已到期
- **THEN** 系统可将其加入 review session ledger

### Requirement: 系统必须支持三种同日策略
系统 MUST 支持 `once_daily`、`balanced` 和 `intensive`，并 MUST 将选中的 mode 与 `policy_version` 固化到 session。

#### Scenario: once_daily
- **WHEN** mode 为 `once_daily` 且某学习单位当天已经提交一次正式 review attempt
- **THEN** 系统当天不再次展示该学习单位

#### Scenario: balanced 的成熟正确卡
- **WHEN** mode 为 `balanced` 且 mature review card 评分为 `hard`、`good` 或 `easy`
- **THEN** 系统当天不再次展示该学习单位

#### Scenario: balanced 的新词或答错词
- **WHEN** mode 为 `balanced` 且学习单位处于 new/learning/relearning 或评分为 `again`
- **THEN** 系统可在 10–20 分钟后安排最多一次同日 revisit
- **AND** revisit 仍受 session 时间预算和单日上限约束

#### Scenario: intensive
- **WHEN** mode 为 `intensive`
- **THEN** 系统可展示 scheduler 产生的全部合格 short steps
- **AND** 系统仍执行防无限循环和总时间上限

#### Scenario: 会话中切换设置
- **WHEN** 用户在 session 进行中改变同日策略
- **THEN** 当前 session ledger 和 `policy_version` 保持不变
- **AND** 新设置从下一 session 生效

### Requirement: Session queue 必须是可解释的固定 ledger
系统 MUST 在 session 开始时生成有序 ledger，并为每个条目记录入队原因、来源队列、预计时长和 policy 决策。

#### Scenario: 完成一个评分
- **WHEN** 用户完成当前条目的评分
- **THEN** 系统只推进 ledger 或按已记录规则插入允许的 revisit
- **AND** 系统不得重新查询后静默改变其他条目的优先级

#### Scenario: 重新打开未完成 session
- **WHEN** 用户在有效恢复窗口内重新打开未完成 session
- **THEN** 系统恢复 ledger、当前位置和已完成记录
- **AND** 已成功提交的 attempt 不得重复提交

### Requirement: 每日计划必须按时间预算分配
系统 MUST 使用时间预算而非固定词数作为计划约束，并按 due review、relearning/revisit、reassessment、acquisition 的顺序分配时间。

#### Scenario: 初始无个人速度数据
- **WHEN** 用户没有足够的历史耗时数据且预算为 60 分钟
- **THEN** 系统使用约 36 秒/attempt 的初始估算生成计划
- **AND** UI 显示这是估算值而非保证完成的词数

#### Scenario: due 队列超过预算
- **WHEN** overdue/due review 的预计时间已经超过每日预算
- **THEN** 系统优先填充 due review
- **AND** 系统显示未处理 backlog 和预计额外时间
- **AND** 系统不把未处理项目标记为完成

#### Scenario: 更新个人速度
- **WHEN** 系统具有足够的近期有效 attempt
- **THEN** 系统用排除异常值的个人 active duration 更新预计速度

### Requirement: 调度状态变更必须可追溯
系统 MUST 为每次成功 rating 保存 `before_state`、`after_state`、rating、时间、scheduler version 与 correlation id。

#### Scenario: rating 保存成功
- **WHEN** scheduler 成功计算并提交新状态
- **THEN** review log 与学习事件可通过 correlation id 对应
- **AND** due date 与状态转换可从记录中解释

#### Scenario: 重复提交
- **WHEN** 相同 attempt id 被网络重试或 UI 重复动作再次提交
- **THEN** 系统返回首次提交结果
- **AND** 不再次调度或追加第二条有效 attempt

### Requirement: 策略切换不得重写历史或静默批量重排
系统 MUST 将策略变化作为版本化未来决策，不得修改历史事件、历史 rating 或在没有预览确认时批量重排全部 due date。

#### Scenario: 从 once_daily 切换到 balanced
- **WHEN** 用户切换 mode
- **THEN** 历史 session 保留原 mode 和 policy version
- **AND** 下一 session 使用新 mode

#### Scenario: 新参数影响排期
- **WHEN** 一个新 scheduler parameter set 被选择
- **THEN** 系统先展示影响摘要
- **AND** 未经明确发布操作不得改写所有现有 `ReviewState`
