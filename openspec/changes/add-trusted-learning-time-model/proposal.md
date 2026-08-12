## Why

当前预习进度只记录整批 `startedAt/completedAt`，一批 50 词即使跨一周完成，也会在完成页上被误读成“今天完成”；同时，预习、24 小时延迟、每日预算和复习会话分别直接读取浏览器时间，无法一致处理系统时钟跳变、后台挂起、离线、跨午夜、夏令时和时区切换。现在需要建立统一且可审计的学习时间模型，让“发生了多久”和“属于哪一个自然日”各自使用正确的时间语义。

## What Changes

- 新增统一的 `TrustedLearningClock` 能力：以同源服务维护的可信 UTC 锚点为主，在浏览器内用单调时钟推进，并显式标注 `internet_verified`、`server_clock`、`offline_anchor`、`local_clock` 等时间质量。
- 为学习事件统一记录精确 UTC、`local_day`、IANA `timezone`、UTC offset、时间质量和时钟观测引用；旧事件保持可读，新增字段采用向后兼容的版本化方式。
- 将预习从“整批两个时间戳”升级为逐词事件：区分卡片出现、释义/例句揭示、首次接触完成，并由逐词事件派生批次跨度、涉及自然日数和每日完成量。
- 将“至少 24 小时”继续定义为真实经过时间 `>= 86_400_000 ms`，并要求不同学习 episode；自然日切换本身不等于经过 24 小时。
- 保留 FSRS 的精确 UTC `due_at`，不把到期时间取整到午夜；每日预算、当日统计和同日限制继续按冻结的 `local_day + timezone` 计算。
- 定义跨午夜、DST、旅行换时区、浏览器后台挂起、刷新、离线、可信时间源不可用以及系统时钟前后跳变时的确定性行为。
- 为现有预习进度制定保守迁移：保留已知批次范围，但不臆造每个单词的历史日期；历史数据标记为 `legacy_batch_only`，从升级后的首次新事件开始获得逐词精度。
- 调整完成页文案和统计语义，明确显示“本批首次接触完成”、实际学习跨度和涉及自然日，避免把跨多日学习归到完成当天。
- 不改变 `SeekPlayerDB` 的版本、object store 或 key path；如需持久化时钟锚点，使用现有存储边界中的版本化 named row 或独立的向后兼容浏览器存储键。

## Capabilities

### New Capabilities

- `trusted-learning-time`: 规定可信 UTC、单调经过时间、自然日归属、逐词预习事件、FSRS 到期语义、降级行为、迁移和时间异常审计的统一契约。

### Modified Capabilities

无。当前 `openspec/specs/` 中没有预习时间或 SRS 时间模型的既有 capability；本变更以新的统一 capability 建立契约，并复用现有实现中的 `due_at`、`local_day` 和 `timezone` 语义。

## Impact

- 预期影响 `src/features/passage-preview/` 的进度持久化、页面状态和完成页展示。
- 预期影响 `src/services/vocabulary/` 与 `src/features/srs-review/` 的时间获取入口、事件元数据、24 小时资格判定和会话日历上下文，但不改变 FSRS 算法本身。
- 需要在 Vite 同源开发/生产服务边界增加只返回时间观测、不接收学习数据的轻量 endpoint 或等价 provider，并在不可用时保留离线学习能力。
- 需要新增纯函数、时间 provider、存储适配器、迁移器、诊断事件和覆盖时间边界的测试夹具。
- 不调整 IndexedDB schema，不向浏览器暴露第三方时间服务凭据，不要求每次学习动作访问公网，也不改动 `src/composables/reader-runtime.js` 或 `src/composables/session-init.js`。
