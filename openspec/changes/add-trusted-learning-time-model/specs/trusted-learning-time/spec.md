## ADDED Requirements

### Requirement: 分离事实时间、经过时间与自然日
系统 MUST 将学习事件的 UTC instant、同一 runtime 内的单调经过时间以及 `local_day + IANA timezone` 建模为不同语义，且 MUST NOT 使用自然日切换替代真实经过时长。

#### Scenario: 跨午夜但未经过 24 小时
- **WHEN** 首次接触发生在本地时间 23:58，延迟检查发生在次日 00:02
- **THEN** 系统将两次事件归入不同 `local_day`，但判定未经过 `86_400_000 ms`

#### Scenario: DST 自然日不是固定 24 小时
- **WHEN** study timezone 进入一个 23 小时或 25 小时的 DST 自然日
- **THEN** 系统按 IANA timezone 计算日历归属，并继续按 UTC interval 计算真实经过时间

### Requirement: 提供带质量和边界的可信时间观测
系统 SHALL 通过统一 `TrustedLearningClock` 提供 `estimated_utc`、`earliest_utc`、`latest_utc`、`observation_id`、`time_quality` 和 `clock_policy_version`，并 MUST 对无法证明有限可信边界的观测标记为 degraded。

#### Scenario: 互联网时间 quorum 成功
- **WHEN** 同源服务从足够数量的 provider 获得容差内的一致观测
- **THEN** 系统返回 `internet_verified` observation，并包含有限的 earliest/latest bounds

#### Scenario: 只有服务端系统时间可用
- **WHEN** 同源服务可达但互联网 provider 不满足 quorum
- **THEN** 系统返回 `server_clock` observation，且不得将它标记为 `internet_verified`

#### Scenario: 从未同步且浏览器离线
- **WHEN** 客户端没有可信 anchor 且同源服务不可达
- **THEN** 系统允许生成 `local_clock` observation，但将其标记为 degraded 且不得伪造可信 bounds

### Requirement: 同一页面生命周期使用单调锚点推进
系统 MUST 在同一页面生命周期内基于 `performance.now()` 或等价 monotonic clock 从最近 anchor 推进时间，并 MUST NOT 通过 timer tick 累加经过时长。

#### Scenario: 用户修改系统日期
- **WHEN** 用户在页面仍打开时把系统 wall clock 向前或向后修改
- **THEN** 已建立的 trusted anchor 继续按 monotonic clock 推进，学习 instant 不随 wall clock 跳变

#### Scenario: 页面在后台八小时
- **WHEN** 页面 hidden 八小时后恢复且 timer 被浏览器节流
- **THEN** 系统从前后 monotonic observation 计算跨度并触发 resync，而不是按 timer 执行次数累计

#### Scenario: 新观测造成显著校正
- **WHEN** 新同步的可信 observation 与当前估计超过 policy threshold
- **THEN** 系统记录去重的 clock anomaly diagnostic，采用新 observation 处理后续事件，且不改写历史事件

### Requirement: 学习事件保存不可变的 temporal context
系统 SHALL 为升级后的 preview、acquisition 和 review 事件保存版本化 `temporal_context`，至少包含事件发生时的 UTC 估计、质量、trust level、`local_day`、`timezone`、UTC offset 和 day assignment；历史事件的日历归属 MUST NOT 随当前系统 timezone 静默变化。

#### Scenario: 正常在线事件
- **WHEN** 用户在可信 anchor 有效期内揭示一个单词
- **THEN** 对应事件保存 confirmed day assignment、事件发生时的 IANA timezone 和 trusted temporal context

#### Scenario: 离线事件
- **WHEN** 用户离线完成一个单词且当前观测无法提供可信 bounds
- **THEN** 事件仍被持久化，day assignment 标记为 provisional，并进入待校验状态

#### Scenario: 旅行后查看历史
- **WHEN** 用户在另一个 timezone 打开历史记录
- **THEN** 既有事件继续按记录时保存的 `local_day + timezone` 显示，不按新 timezone 重分组

### Requirement: 逐词记录预习生命周期
系统 SHALL 为每个 preview item 幂等记录 `preview_word_seen`、`preview_meaning_revealed` 和 `preview_word_completed`；acquisition 的 `introduced_at` MUST 来自首次 `preview_meaning_revealed`，而不是批次开始或卡片首次出现。

#### Scenario: 只看到卡片但未揭示
- **WHEN** 用户打开一个单词卡后离开，未查看释义与例句
- **THEN** 系统可记录 `preview_word_seen`，但不得建立该词的 `introduced_at`

#### Scenario: 首次揭示释义和例句
- **WHEN** 用户首次执行揭示动作
- **THEN** 系统只记录一个 `preview_meaning_revealed`，并以该事件作为首次接触时间

#### Scenario: 双击和刷新重放
- **WHEN** 同一揭示或完成 command 因双击、刷新恢复或重试被执行多次
- **THEN** 幂等 event ID 使该 item/event type/episode 只计数一次

### Requirement: 由逐词事实派生批次和每日统计
系统 MUST 从逐词事件派生批次起止、完成状态、实际跨度、涉及自然日数和每日完成数，且 MUST NOT 把跨多日完成的全部单词计入最后一天。

#### Scenario: 50 词跨七个自然日完成
- **WHEN** 一个 50 词批次的 completed events 分布在七个不同 stored local days
- **THEN** 完成摘要显示该批次涉及七个自然日，并按每个事件保存的 day context 汇总 daily counts

#### Scenario: 尚有未完成单词
- **WHEN** 至少一个 preview item 缺少 `preview_word_completed`
- **THEN** 批次状态不是 completed，且批次 `completed_at` 为空

#### Scenario: 同一天完成整个批次
- **WHEN** 所有 completed events 都属于相同的 confirmed local day
- **THEN** 系统可以显示该日完成数量，但仍保留批次起止 instant

### Requirement: 完成页使用准确的时间表述
系统 SHALL 将批次完成表述为“本批 N 词首次接触完成”，并根据可证明的数据展示开始日期、完成日期和自然日跨度；系统 MUST NOT 在跨日或 legacy 数据下暗示全部学习发生在“今天”。

#### Scenario: 跨日完成页
- **WHEN** 当前批次跨多个 local days 完成
- **THEN** 页面显示实际日期范围和涉及自然日数，不显示“今天完成 N 词”

#### Scenario: legacy 批次完成页
- **WHEN** 批次只有迁移前的 `startedAt/completedAt` 与 revealed map
- **THEN** 页面明确说明逐词日期未知，且不生成伪造的每日分布

### Requirement: 24 小时资格采用保守可信区间
系统 MUST 使用 `attempt.earliest_utc - introduction.latest_utc` 计算可证明的最小经过时长；只有该值至少为 `86_400_000 ms`、两个事件属于不同 episode 且其他 acquisition 条件满足时，才允许通过延迟资格。

#### Scenario: 恰好满足 24 小时
- **WHEN** 可证明的 minimum elapsed 等于 `86_400_000 ms` 且 episode 不同
- **THEN** 延迟条件通过

#### Scenario: 同一 episode 已过 24 小时
- **WHEN** 时间条件满足但 introduction 与 attempt 使用相同 episode ID
- **THEN** 延迟资格失败并返回同 episode reason code

#### Scenario: 时间证据不足
- **WHEN** introduction 或 attempt 没有可用于保守计算的可信 bounds
- **THEN** 系统保存本次答案但不授予毕业资格，并返回 `TIME_EVIDENCE_INSUFFICIENT`

#### Scenario: 系统时钟被向前调整七天
- **WHEN** 本地 wall clock 被向前调整七天但可信区间不能证明实际经过 24 小时
- **THEN** 系统不得提前授予延迟资格

### Requirement: FSRS 到期时间保持精确 UTC
系统 MUST 继续以精确 UTC `due_at` 进行 FSRS 调度和到期比较，且 MUST NOT 为自然日计划或统计把 `due_at` 取整到午夜。

#### Scenario: 当日稍晚到期
- **WHEN** 某 review 的 `due_at` 是当前 local day 的 18:30，当前时间为 09:00
- **THEN** 系统不得仅因两者属于同一 local day 就把该 review 当作已到期

#### Scenario: 精确到期瞬间
- **WHEN** trusted now 大于或等于该 review 的精确 `due_at`
- **THEN** 系统按现有队列策略将其视为 due candidate

### Requirement: 每日会话冻结 day context
系统 SHALL 在创建 review session 时冻结 `local_day + timezone`，并 MUST 保持 session ledger 内该上下文不变；timezone 或日期变化只对新 session 生效。

#### Scenario: 会话进行中跨午夜
- **WHEN** session 在 23:50 创建并在次日 00:10 仍未结束
- **THEN** 现有 ledger 保持原 local day，UI 提示日期已变化，并允许用户完成当前 session 或显式开始新日 session

#### Scenario: 会话中系统 timezone 改变
- **WHEN** 用户在 session 进行中改变系统 timezone
- **THEN** 当前 ledger 的 timezone 不变，新 timezone 只在下一 session 被采用并记录 transition

### Requirement: 离线学习不中断但敏感资格 fail closed
系统 SHALL 在 time endpoint 不可达时继续允许 preview 和 review 交互并持久化事件；对依赖可信经过时间的毕业或解锁操作，系统 MUST 在证据不足时暂缓而不是猜测。

#### Scenario: 离线 48 小时但页面未刷新
- **WHEN** 页面持有有效 trusted anchor 后离线 48 小时且 monotonic chain 连续
- **THEN** 系统按 policy 评估 anchor age 与 uncertainty，超出可信范围时降级，不把过期 anchor 无限制视为 trusted

#### Scenario: 离线后刷新
- **WHEN** 用户离线刷新页面，导致旧 runtime 的 monotonic origin 丢失
- **THEN** 系统将新事件标记为 `offline_unverified` 或 `local_clock`，并暂缓依赖可信时间的资格

#### Scenario: 网络恢复
- **WHEN** 网络恢复且客户端取得新 verified observation
- **THEN** 系统处理待校验事件、追加 reconciliation metadata，并保留原始事件不变

### Requirement: 旧预习进度保守迁移
系统 SHALL 读取 `passage-preview.progress.v1/v2` 并生成向后兼容 projection，保存已知批次 `startedAt/completedAt`，将未知逐词时间标记为 `legacy_batch_only`，且 MUST NOT 平均分摊或伪造历史逐词日期。

#### Scenario: 迁移已完成的 v2 批次
- **WHEN** v2 snapshot 表明批次 completed 但没有逐词时间
- **THEN** 新 projection 保留批次起止时间，将 item-level timestamps 留空并标记 legacy

#### Scenario: 迁移后继续学习
- **WHEN** 用户在迁移后的批次或新批次产生新交互
- **THEN** 仅升级后真实发生的事件获得逐词 temporal context，旧事件保持未知

#### Scenario: 回滚读取
- **WHEN** 新时间功能通过 feature flag 关闭
- **THEN** 旧 progress key 在稳定期内仍可读取，用户已知进度不被删除

### Requirement: 不改变数据库 schema 与隐私边界
系统 MUST 保持 `SeekPlayerDB` version `1`、object store `files` 和 key path `id` 不变；time endpoint MUST NOT 接收单词、释义、例句、用户标识或学习 payload，浏览器 MUST NOT 直接访问第三方 time provider。

#### Scenario: 持久化新锚点或事件
- **WHEN** 新时间模型需要本地持久化
- **THEN** 系统使用现有 repository 的 versioned named row、现有 event envelope 或向后兼容 localStorage key，不新增 object store 或提升 DB version

#### Scenario: 请求同源时间
- **WHEN** 客户端同步时钟
- **THEN** 请求只发送时间同步所需的通用 metadata，第三方 provider 由服务端 adapter 访问且不获得学习内容

### Requirement: 时间模型可确定性测试与诊断
系统 SHALL 允许注入 fake wall clock、monotonic clock、timezone 和 provider，并 SHALL 输出不含学习内容的质量/异常 diagnostics，以便重现时间边界行为。

#### Scenario: 固定时间测试
- **WHEN** 测试注入固定 UTC、monotonic sequence 和 IANA timezone
- **THEN** preview projection、24 小时资格和 session day context 产生与机器当前时间无关的确定结果

#### Scenario: 诊断不泄露学习数据
- **WHEN** provider disagreement 或 clock jump 产生 diagnostic
- **THEN** diagnostic 只包含 observation/quality/RTT/anchor age/jump metadata，不包含单词、释义、例句或 API key
