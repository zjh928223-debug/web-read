## Context

Read-Web 当前同时存在三类时间需求，但它们尚未由统一边界提供：

1. **事件事实时间**：某个单词何时被看到、何时揭示释义、何时完成首次接触、何时作答；需要可持久化、可排序、可审计的 UTC。
2. **经过时间**：首次接触与延迟检查之间是否真的经过至少 `86_400_000 ms`，以及一次尝试的 `active_duration_ms`；需要不受系统时钟修改影响的单调时间。
3. **日历归属**：事件属于用户所在时区的哪一个自然日，用于每日预算、预习量、复习会话和统计；需要 `local_day + IANA timezone`，不能用固定 24 小时模拟一天。

现有复习实现已经具备较好的基础：`srs-review-policy.js`、`srs-session-planner.js`、`srs-review-service-v2.js` 和 session ledger 使用精确 UTC `due_at`、`local_day` 与 `timezone`。现有预习实现则只在 `passage-preview-storage.js` 的 `progress.v2` 中保存整批 `startedAt/completedAt` 和 `revealed` map，无法还原每个单词实际发生在哪一天。

项目约束如下：

- `SeekPlayerDB` 必须继续使用 version `1`、object store `files`、key path `id`。
- 不在 `src/composables/reader-runtime.js` 或 `src/composables/session-init.js` 中新增功能逻辑。
- 浏览器不能依赖每次学习动作访问第三方时间服务；离线时不能阻止用户学习。
- 旧数据中不存在的信息不能通过平均分摊或猜测伪造。
- FSRS 的 `due_at` 是一个精确 instant，不得为了自然日统计而取整到午夜。

## Goals / Non-Goals

**Goals:**

- 建立一个可注入、可测试的 `TrustedLearningClock`，统一所有新增学习事件的时间获取。
- 让可信 UTC、单调经过时间和自然日归属各司其职，并提供明确的转换函数。
- 逐词记录预习事实，并由这些事实派生批次跨度、自然日数和每日数量。
- 在系统时钟跳变、页面后台挂起、断网、刷新、DST 和旅行换时区时保持确定性。
- 在时间证据不充分时采用保守资格判定，同时允许学习流程继续。
- 分阶段迁移现有调用点，保留当前复习契约和历史数据可读性。

**Non-Goals:**

- 不实现操作系统级 NTP daemon，也不承诺毫秒级法定计时精度。
- 不把所有 `Date` 使用一次性清零；只迁移学习事实、资格、会话计划和相关 UI 边界。
- 不重写 FSRS 算法、评分含义、队列优先级或每日预算策略。
- 不为旧 50 词臆造逐词时间，不回填无法证明的精确自然日。
- 不要求用户持续联网，不因为时间服务暂时不可用而禁止预习或复习。
- 不用长期运行的 `setInterval` 累加“经过时长”。

## Decisions

### 1. 使用三个明确的时间类型，而不是一个全能 `now()`

新增三个逻辑类型：

- `TrustedInstant`：UTC ISO-8601 instant，附带可信区间与来源质量。
- `ElapsedDuration`：同一 runtime 内基于 `performance.now()` 的单调毫秒数。
- `StudyDayContext`：`{ local_day, timezone, utc_offset_minutes }`。

业务代码不能再自行组合 `new Date()`、`Date.now()` 和本地日期字符串来做学习判定；它必须从时钟端口取得 observation，或调用纯函数把 observation 转换为 day context。

选择此方案是因为“跨过午夜”与“经过 24 小时”是不同问题。替代方案——统一按自然日或统一按毫秒——分别会在 23:59 到 00:01、DST 的 23/25 小时日和旅行换时区时产生错误。

### 2. 可信时间采用同源 `/api/learning-time` + 服务端缓存锚点

浏览器只请求同源 `/api/learning-time`。服务端的 `InternetTimeProvider` 负责从可配置、无密钥的 HTTPS 时间来源取得观测，使用 request/response 单调计时估算 RTT，并在多个来源可用时执行容差内 quorum；服务端以 `process.hrtime` 等单调计时从最近可信锚点推进当前时间。

endpoint 返回最小化 DTO：

```text
schema_version
observation_id
estimated_utc
earliest_utc
latest_utc
quality
source_count
synchronized_at
anchor_age_ms
```

浏览器不接触 provider URL 细节、学习数据或任何 API key。服务端按短 TTL 缓存结果，客户端启动、恢复前台、网络恢复和锚点即将过期时才同步，不在每次翻词时发请求。

选择同源代理是为了控制 CORS、隐私、超时、速率和降级。直接从浏览器访问公共 time API 会把学习活动时间暴露给第三方，也会把核心流程绑定到外部可用性。仅信任浏览器 `Date.now()` 则无法抵抗用户或系统时间跳变。

provider 名单和网络参数属于部署配置；契约只要求 adapter、quorum、超时、缓存和可观测质量，不把某个公共网站写死到领域层。

### 3. 客户端锚点在单次页面生命周期内用单调时钟推进

客户端收到 observation 时同时记录 `performance.now()`，之后用：

```text
estimated_now = anchor.estimated_utc + (performance.now() - anchor.monotonic_at_receipt)
```

推进 earliest/latest bounds。网络 RTT、provider 分歧和 anchor age 进入 uncertainty；输出不得早于同一 runtime 已发出的最后一个 `TrustedInstant`。如果新同步结果显著早于或晚于当前估计，时钟端口发出 anomaly diagnostic，并从新 observation 开始，但绝不改写已经持久化的原始事件。

`performance.now()` 只在当前页面生命周期内比较。刷新后如果在线，立即取得新同源 observation；如果离线，只能结合已持久化 anchor 与 wall clock 生成 `offline_unverified` observation，不能把它伪装成可信单调经过时间。

### 4. 时间质量分级，并以区间而非单点做敏感判定

统一质量枚举：

- `internet_verified`：新鲜 quorum 观测。
- `trusted_anchor_estimate`：从新鲜可信锚点用单调时钟外推。
- `server_clock`：同源服务可达，但互联网 quorum 不可得，仅能使用服务端 OS clock。
- `offline_unverified`：刷新后离线，只能从持久化 anchor 与 wall clock 估计。
- `local_clock`：从未获得锚点，只能使用浏览器 wall clock。
- `legacy_batch_only`：迁移前只有批次级历史信息。

前两类为 `trusted`，其余为 `degraded` 或 `legacy`。每个 observation 提供 `estimated_utc`；可信观测还提供有限的 `earliest_utc/latest_utc`。延迟资格采用保守下界：

```text
minimum_elapsed = attempt.earliest_utc - introduction.latest_utc
```

只有 `minimum_elapsed >= 86_400_000` 且 episode 不同时才满足延迟条件。任一边界不可证明时返回 `TIME_EVIDENCE_INSUFFICIENT`，不授予资格。这样可以容忍一秒级网络时间误差，又不会因系统时钟被调快而提前毕业。

### 5. 学习事件附带统一 `temporal_context`

新增事件或现有事件的 `extensions.temporal_context` 使用版本化结构，避免一次性破坏当前严格字段白名单：

```text
schema_version: learning-temporal-context.v1
observation_id
estimated_utc
earliest_utc
latest_utc
time_quality
trust_level
local_day
timezone
utc_offset_minutes
day_assignment: confirmed | provisional | legacy_unknown
clock_policy_version
```

事件顶层现有 `occurred_at` 继续保存规范化 UTC 估计值，`recorded_at` 继续表示持久化观察时间；两者语义不互换。`local_day` 必须由事件发生时的 instant 与冻结 timezone 推导，不允许以后按当前 timezone 静默重算。

### 6. 预习改为逐词事实，批次状态是派生摘要

对每个 preview item 记录幂等事件：

- `preview_word_seen`：卡片首次成为当前项。
- `preview_meaning_revealed`：用户首次看到目标义与真实例句；这是 acquisition 的 `introduced_at`。
- `preview_word_completed`：揭示后点击下一词，或在最后一词完成。

每个事件包含 `event_id`、`batch_id`、`item_id`、`learning_unit_id/target_sense_key`（可得时）、episode、temporal context。事件 ID 由稳定 command ID 或 `batch_id + item_id + event_type + episode_id` 保证双击、刷新和重放不重复计数。

`progress.v3` 可以继续使用 localStorage 作为当前页面恢复快照，但事件事实必须写入现有 vocabulary repository/event 边界；若该边界尚未接入 preview，则先以独立版本化 event envelope 落到现有 storage adapter，随后再统一。不得通过增加 IndexedDB object store 来实现。

批次字段由逐词事件派生：

- `started_at = min(preview_word_seen.occurred_at)`
- `completed_at = max(preview_word_completed.occurred_at)`，仅在所有项完成时存在
- `elapsed_span_ms = completed_at - started_at`
- `active_day_count = distinct confirmed/provisional local_day`
- `daily_counts = group completed events by stored local_day + timezone`

`active_duration_ms` 仅统计页面可见且窗口 focus 的交互时间，可用于速度估算，不能作为事实时间或 24 小时资格来源。

### 7. 完成页说清“批次完成”与“今天完成”的差别

完成页主标题使用“本批 50 词首次接触完成”。副信息显示实际数据能够证明的范围：开始日期、完成日期、涉及自然日数和每日数量。只有该批所有完成事件确实属于同一个当日时，才允许出现“今天完成 50 词”式表述。

对于 `legacy_batch_only`，UI 显示“旧进度仅保存批次起止时间，逐词日期未知”，不把 50 词全部归入最后一天，也不伪造日历热力图。

### 8. 自然日服务于计划与统计，FSRS 继续使用精确 instant

`due_at`、`last_review_at` 和 event `occurred_at` 始终保持 UTC instant。候选是否到期使用 `due_at <= trusted_now`；不在保存或查询时取整到 `00:00`。

每日预算、今日完成量和同日 revisit 使用 session ledger 冻结的 `local_day + timezone`。一次 session 创建后即使跨午夜或系统 timezone 改变，也不静默改变 ledger；下一次新建 session 才使用新的 day context。跨午夜时 UI 提示当前 session 属于上一日，并允许用户完成当前 session 或显式开始新日 session。

默认 study timezone 取启动 session 时 `Intl.DateTimeFormat().resolvedOptions().timeZone`。用户旅行或手动切换系统 timezone 时，变更从下一 session 生效，并记录 timezone transition；既有事件不重新分组。

### 9. 后台、休眠和离线都通过重新观测计算，不累计 timer tick

页面变为 hidden 时停止 active duration；恢复 visible/focus 时立即基于当前单调值结算并触发异步 resync。设备休眠造成的长空档由前后 observation 处理，而不是假设 `setInterval` 正常运行。

离线时：

- 允许预习、揭示、完成和复习作答。
- 事件带 degraded temporal context 并进入待校验集合。
- 日历 UI 可按 provisional local day 暂时显示。
- 涉及 24 小时毕业的敏感动作 fail closed，显示“等待可信时间校验”，不丢失答案。
- 网络恢复后重新同步；如果仍处于同一 runtime 且有单调链，可收窄 bounds，否则只追加 reconciliation metadata，不覆写原始事件。

### 10. 时间策略参数版本化

`clock_policy_version` 管理 quorum tolerance、同步 TTL、最大 anchor age、异常跳变阈值和降级规则。默认值在实现阶段集中定义并通过 fake clock 测试，不散落在组件中。改变这些参数时提升 policy version，使历史资格结果可重现。

### 11. 可观测性最小化且不记录敏感内容

诊断只记录 observation ID、quality、RTT、anchor age、provider count、跳变方向/幅度和状态转换；不记录单词、释义、例句或 API key。重复异常需去重，避免日志膨胀。endpoint 不接收用户标识或学习 payload。

## Data Flow

```text
InternetTimeProvider(s)
  -> server quorum + monotonic cached anchor
  -> GET /api/learning-time
  -> TrustedLearningClock client anchor
  -> TrustedInstant + StudyDayContext
  -> preview/review/acquisition command
  -> event temporal_context
  -> repository
  -> batch/day/session projections
```

## Module Boundaries

建议新增或调整以下 focused modules；最终文件名可在实现时按现有目录风格微调：

- `src/services/time/internet-time-provider.mjs`：服务端 provider port 与 quorum 纯逻辑。
- `src/services/time/learning-time-vite-plugin.mjs`：同源 endpoint、缓存、超时和响应 DTO。
- `src/services/time/trusted-learning-clock.js`：浏览器时钟端口、锚点和 resync lifecycle。
- `src/services/time/learning-temporal-context.js`：schema normalization、day conversion、quality/trust 判定。
- `src/services/time/elapsed-time.js`：可见/focus active duration 与单调 duration helper。
- `src/features/passage-preview/passage-preview-events.js`：逐词命令与幂等事件。
- `src/features/passage-preview/passage-preview-projection.js`：progress/batch/day projection。
- `src/features/passage-preview/passage-preview-storage.js`：`v2 -> v3` snapshot migration，不承担时间判定。
- vocabulary/SRS service：通过依赖注入接收 clock observation，领域纯函数不直接读全局时间。

## Risks / Trade-offs

- [公共 HTTPS 时间来源可能超时、被拦截或彼此不一致] → provider adapter + quorum + 短超时 + 缓存 + 明确降级；学习流程不硬依赖公网。
- [HTTP 时间精度通常低于 NTP] → 使用 uncertainty bounds；本产品的自然日和 24 小时门槛不需要毫秒级绝对精度，资格按保守下界判断。
- [刷新后离线无法建立跨 runtime 的可信单调链] → 标记 `offline_unverified`，保留事件但不授予敏感资格，联网后 reconciliation。
- [新增事件字段影响严格 contract validator] → 第一阶段放入版本化 `extensions.temporal_context`，随后在明确版本升级中提升顶层 schema；提供双读和 round-trip 测试。
- [预习事实同时存在 snapshot 与 event log，可能漂移] → event log 为事实源，snapshot 只作恢复缓存；启动时可重建并比较 projection revision。
- [时区变化导致用户看到一天被拆成两组] → session 冻结 timezone，下一 session 才生效，UI 显示 timezone；不重写历史。
- [旧 50 词无法恢复逐词日期] → 明确标记 `legacy_batch_only`，只展示已知范围；从升级后的新事件开始准确。
- [背景页面造成 duration 夸大] → active duration 只累计 visible + focused 区间，并设合理上限/异常过滤；日历跨度仍取事实 instant。

## Migration Plan

1. **建立纯契约与 fake clock**：先实现 DTO normalizer、quality/trust、local-day conversion、interval elapsed 判定和边界测试，不连接 UI。
2. **接入同源时钟**：增加 Vite plugin 与客户端 clock；在 diagnostics 页面或开发日志验证同步/降级，不改变业务结果。
3. **影子观测**：现有 preview/SRS 继续使用原结果，同时记录新旧 now 差异和 quality，确认无明显跳变后再切换。
4. **预习逐词事件**：升级 snapshot 到 `progress.v3`，从新交互开始发 event；完成页改用 projection。旧 snapshot 保留回退读取。
5. **资格判定切换**：24 小时门槛改用可信区间和 episode，新增 `TIME_EVIDENCE_INSUFFICIENT`；FSRS `due_at` 保持不变。
6. **每日/session 接入**：把 review planner 的 `now/local_day/timezone` 统一从 clock context 提供，保留现有 ledger freeze 行为。
7. **历史迁移**：读取 `progress.v1/v2` 时生成 `legacy_batch_only` projection；不删除旧 key，完成稳定期后才考虑清理。
8. **观察与收口**：验证 anomaly、offline queue、reconciliation 和统计；移除影子比较，但保留 provider 注入和 fake clock。

回滚时关闭 time provider feature flag，并恢复旧 now provider；新增 temporal extensions 与 preview event 保留为向前兼容数据，不删除用户进度。`progress.v2` 双读在稳定期内保持，因此 UI 可回退。

## Verification Strategy

- 纯函数测试固定 fake UTC、monotonic time 与 IANA timezone，不依赖机器当前时间。
- endpoint 测试模拟 quorum 成功、单源、provider disagreement、timeout、cache hit 和 server clock fallback。
- preview 测试覆盖双击、刷新、最后一词、50 词跨 7 天和 legacy snapshot。
- eligibility 测试覆盖 `23:58 -> 次日 00:02`、恰好 24 小时、不同 episode、系统时间前跳/后跳和不确定区间。
- 日历测试覆盖 Asia/Shanghai、DST 23/25 小时、跨午夜 session 和旅行换 timezone。
- lifecycle 测试覆盖 hidden 8 小时、设备休眠、离线 48 小时、离线刷新和网络恢复。
- 回归测试确认 `due_at` 未取整、IndexedDB schema 未变、两个 thin runtime entry 未承载新逻辑。

## Open Questions

无阻塞性开放问题。具体 provider 名单、quorum tolerance、TTL 和异常阈值在实现阶段以部署环境实测值写入集中式 `clock_policy_version`，不得改变上述信任分级和保守判定契约。
