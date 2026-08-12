## 1. 基线盘点与测试夹具

- [ ] 1.1 运行并记录 `npm run build`、`npm run verify:vite`、现有 vocabulary/SRS/preview focused tests 的基线结果，区分本变更前已有失败
- [ ] 1.2 用 `rg` 建立学习时间调用点清单，覆盖 preview、acquisition、review planner、review service、session ledger、每日统计中的 `new Date()`、`Date.now()`、`performance.now()` 和 timezone 推导
- [ ] 1.3 为本变更建立 fake wall clock、fake monotonic clock、fake timezone 和 fake internet provider 测试夹具，确保测试不读取机器当前时间
- [ ] 1.4 建立时间边界 fixture matrix，至少包含 Asia/Shanghai 跨午夜、DST 23/25 小时日、旅行换时区、前后台、休眠、离线刷新和 wall clock 跳变
- [ ] 1.5 增加 schema guard 测试，固定 `SeekPlayerDB` version `1`、object store `files`、key path `id`，并固定 `reader-runtime.js` 与 `session-init.js` 继续为 thin entry

## 2. 时间契约与纯函数

- [ ] 2.1 新增 `learning-time-observation.v1` normalizer，校验 UTC timestamps、earliest/estimated/latest 顺序、quality、observation ID、anchor age 和 policy version
- [ ] 2.2 新增 `learning-temporal-context.v1` normalizer，校验 trust level、IANA timezone、UTC offset、`local_day` 和 day assignment
- [ ] 2.3 实现 `instant -> StudyDayContext` 纯函数，并测试 Asia/Shanghai、DST、闰日和无效 timezone
- [ ] 2.4 实现 observation quality 到 `trusted/degraded/legacy` 的集中映射，禁止组件自行判断字符串
- [ ] 2.5 实现 interval-based minimum elapsed 纯函数，输出 elapsed、是否满足 `86_400_000 ms` 和 `TIME_EVIDENCE_INSUFFICIENT` 等 reason code
- [ ] 2.6 实现 clock anomaly 比较纯函数和版本化 policy constants，集中管理 quorum tolerance、TTL、max anchor age 与 jump threshold
- [ ] 2.7 为 2.1–2.6 增加 canonical round-trip、unknown field、invalid timestamp 和边界等值测试

## 3. 服务端互联网时间 provider

- [ ] 3.1 定义 `InternetTimeProvider` port 与 provider result DTO，使真实网络 adapter 和 fake provider 可互换
- [ ] 3.2 实现单 provider 请求的 timeout、RTT 单调计时、UTC 解析和 uncertainty 计算，拒绝缺失或无效时间响应
- [ ] 3.3 实现多 provider quorum/median 纯逻辑，覆盖一致、单源、分歧、部分 timeout 和全部失败
- [ ] 3.4 实现服务端 verified anchor cache，以单调 clock 从最近 anchor 外推并在 TTL 前复用
- [ ] 3.5 实现 `server_clock` fallback，确保 provider 失败不会冒充 `internet_verified`
- [ ] 3.6 新增 focused Vite plugin 暴露只读 `GET /api/learning-time`，返回最小 observation DTO，并拒绝非 GET 或带学习 payload 的请求
- [ ] 3.7 将 time plugin 接入 `vite.config.js` 的既有 plugin 顺序，不改变 reader `index.html` script order
- [ ] 3.8 增加 endpoint 测试，覆盖 cache hit、并发请求合并、超时、fallback、无敏感字段和稳定 schema

## 4. 浏览器 `TrustedLearningClock`

- [ ] 4.1 实现可注入的 browser clock port，隔离 fetch、wall clock、monotonic clock、visibility、focus 和 network state
- [ ] 4.2 实现启动同步与 anchor 安装，记录 response receipt monotonic time 并推进 earliest/estimated/latest bounds
- [ ] 4.3 实现同一 runtime 的 monotonic non-decreasing guarantee，确保 wall clock 前后跳不改变后续 trusted instant
- [ ] 4.4 实现 resync lifecycle：启动、恢复 visible/focus、network online 和 anchor 即将过期时触发；加入去重与 in-flight 合并
- [ ] 4.5 实现持久化 anchor 的 versioned storage adapter；刷新后优先 resync，离线时仅生成 `offline_unverified`，不得跨 runtime 伪造 monotonic chain
- [ ] 4.6 实现 quality/anchor-age 状态机，超过 policy max age 后从 trusted 降级
- [ ] 4.7 实现 clock anomaly 和 quality transition diagnostics，限制字段并对重复异常去重
- [ ] 4.8 增加 hidden 八小时、设备休眠、离线 48 小时、离线刷新、网络恢复和系统日期 ±7 天的 lifecycle tests

## 5. 学习事件 temporal context 接入

- [ ] 5.1 在 vocabulary event 创建边界增加 clock observation 依赖，禁止领域 service 在新路径中直接读取全局当前时间
- [ ] 5.2 通过 `extensions.temporal_context` 为兼容事件附加 v1 context，并保持当前严格顶层 schema round-trip
- [ ] 5.3 明确并测试 `occurred_at` 表示事件发生估计、`recorded_at` 表示持久化观察，两者不得在 repository 中互换
- [ ] 5.4 为 degraded 事件实现 pending-time-verification 标记与查询，不丢失原始答案或交互
- [ ] 5.5 实现 reconciliation metadata 追加路径：能收窄时补充证据，不能证明时保留 pending，且绝不覆写原始 event
- [ ] 5.6 增加 event privacy/contract tests，确保 diagnostics 与 time endpoint 不包含 lemma、meaning、sentence、用户标识或 API key

## 6. 预习逐词事件

- [ ] 6.1 定义 `preview_word_seen`、`preview_meaning_revealed`、`preview_word_completed` event schema 和稳定 event ID/command ID 规则
- [ ] 6.2 在 passage preview 页面首次选中 item 时幂等记录 `preview_word_seen`
- [ ] 6.3 在目标义与真实例句首次实际可见时幂等记录 `preview_meaning_revealed`，并将其连接到 acquisition `introduced_at`
- [ ] 6.4 在揭示后进入下一词或完成最后一词时幂等记录 `preview_word_completed`，阻止未揭示 item 被误计为完成
- [ ] 6.5 为 refresh restore、double click、最后一词和重复 command 增加 exactly-once projection tests
- [ ] 6.6 实现 visible + focused active duration tracker，暂停 hidden/blur 区间，并明确该字段不参与事实时间与 24 小时资格
- [ ] 6.7 将 preview clock/event 依赖放入 focused module 或 Vue composable，不在两个 thin runtime entry 中增加逻辑

## 7. 预习 projection、存储升级与完成页

- [ ] 7.1 新增 preview projection，从逐词事件派生 item 状态、批次状态、`started_at`、`completed_at`、`elapsed_span_ms`、`active_day_count` 和 `daily_counts`
- [ ] 7.2 将 snapshot 升级为 `vocabulary.passage-preview.progress.v3`，增加 projection revision 和 event cursor，同时保持 v1/v2 双读
- [ ] 7.3 启动时用 event facts 重建/校验 snapshot，发现漂移时以 event projection 为准并输出不含学习内容的 diagnostic
- [ ] 7.4 修改完成页标题为“本批 N 词首次接触完成”，显示可证明的开始/完成日期、涉及自然日数和每日数量
- [ ] 7.5 增加 UI 分支：仅在所有 completed events 属于同一 confirmed 当日时允许“今天完成 N 词”语义
- [ ] 7.6 增加 legacy UI 分支，显示“逐词日期未知”，不为旧批次绘制伪造 daily counts
- [ ] 7.7 增加 responsive/browser tests，覆盖 50 词跨 7 天、同日完成、部分完成、跨午夜完成和 legacy batch

## 8. Acquisition 24 小时资格迁移

- [ ] 8.1 扩展 graduation eligibility contract，接收 introduction/attempt temporal bounds 与 episode IDs，并新增 `TIME_EVIDENCE_INSUFFICIENT`
- [ ] 8.2 将 `MINIMUM_DELAY_MS = 86_400_000` 判定切换为 conservative minimum elapsed，保留现有 target sense、validated anchor、answer reveal 和 rating 条件
- [ ] 8.3 对 degraded/pending time evidence 保存 attempt 结果但 fail closed，不提前设置 graduated；UI 显示“等待可信时间校验”
- [ ] 8.4 网络恢复 reconciliation 后重新运行资格 projection，仅在全部条件可证明时产生正常 graduation transition
- [ ] 8.5 增加 23:58→00:02、恰好 24 小时、少 1ms、多 1ms、同 episode、系统时钟前跳和不确定区间测试
- [ ] 8.6 增加旧 acquisition event compatibility tests，确认没有 temporal context 的历史记录可读且不会被静默视为 verified

## 9. SRS 到期与每日 session 接入

- [ ] 9.1 将 review orchestration 的 `now/local_day/timezone` 统一从 `TrustedLearningClock` observation + `StudyDayContext` 注入，保持 planner 为纯函数
- [ ] 9.2 审计候选查询和 scheduler，增加 guard tests 证明 `due_at` 未取整到午夜且比较仍为精确 UTC instant
- [ ] 9.3 保持 session ledger 创建时冻结 `local_day + timezone`，并增加跨午夜继续当前 session 的提示状态
- [ ] 9.4 实现显式“开始新日 session”路径，确保不会在进行中的 ledger 内静默换日或重排 cursor
- [ ] 9.5 检测系统 timezone transition，将新 timezone 只用于下一 session，并保留既有事件的 stored day context
- [ ] 9.6 增加当日 18:30 尚未到期、精确到期瞬间、23:50→00:10 session、DST 和旅行换 timezone 的 planner/service tests
- [ ] 9.7 验证每日预算、same-day revisit 和 history grouping 使用冻结 day context，而 24 小时 delay 继续使用 UTC interval

## 10. 历史数据迁移与兼容回滚

- [ ] 10.1 实现 `passage-preview.progress.v1/v2 -> v3` migration，保留已知 `startedAt/completedAt/revealed`，逐词时间设为空并标记 `legacy_batch_only`
- [ ] 10.2 禁止迁移器按 item index、revealed map 或批次跨度平均分配历史日期，并添加 anti-fabrication tests
- [ ] 10.3 对具有 `occurred_at` 但缺少 timezone 的历史 vocabulary/SRS 事件保留 UTC；如生成日历 projection，标记 `derived_timezone_assumed` 而不修改原 event
- [ ] 10.4 增加 feature flag，分别控制 clock shadow observation、preview event projection 和 eligibility enforcement，支持按阶段启用
- [ ] 10.5 在稳定期保留 v1/v2 progress keys 与旧 now provider fallback，验证关闭 flag 后用户进度仍可读取
- [ ] 10.6 编写 migration fixture，覆盖当前真实 50 词 completed snapshot、in-progress snapshot、损坏 JSON、重复事件和部分 v3 数据

## 11. 端到端验证与可观测性

- [ ] 11.1 建立一个 50 词跨 7 个自然日的 deterministic E2E 场景，验证逐词事件、批次摘要、daily counts 和完成页文案
- [ ] 11.2 建立在线→离线→刷新→学习→联网的 E2E 场景，验证 degraded recording、pending eligibility、reconciliation 和原始事件不可变
- [ ] 11.3 建立跨午夜与 DST E2E 场景，证明 local-day 统计、24 小时门槛和 precise `due_at` 三者互不混淆
- [ ] 11.4 建立系统时钟向前七天、向后一天的 E2E 场景，证明不会提前毕业、事件顺序不倒退且 anomaly 可诊断
- [ ] 11.5 验证 endpoint/provider 失败不阻止学习页面加载，且同步请求数量符合启动/恢复/TTL 策略而非每动作请求
- [ ] 11.6 验证所有新增 diagnostics 不包含学习内容或 secret，并测试 provider URL/API key 不进入浏览器 bundle
- [ ] 11.7 运行 `npm run build`、`npm run verify:vite`、相关 focused verification、`git diff --check` 和 OpenSpec strict validation，记录结果

## 12. 文档、发布与收口

- [ ] 12.1 在 README/PROJECT_MAP 更新三层时间语义、模块边界、quality 状态、离线行为和数据迁移说明
- [ ] 12.2 为用户设置说明补充 study timezone 的默认来源、何时应用 timezone 变化以及“等待可信时间校验”的含义
- [ ] 12.3 为开发文档补充 fake clock/provider 用法、policy version 升级规则、endpoint 部署要求和隐私约束
- [ ] 12.4 先启用 shadow observation，检查新旧时间差、quality distribution 和 anomaly；确认阈值后再启用 preview projection
- [ ] 12.5 完成 preview 数据观察期后启用 conservative eligibility enforcement，保留可快速关闭的 feature flag
- [ ] 12.6 在确认无旧版本回滚需求后另行提出清理 change；本变更内不删除旧 progress key、compatibility reader 或历史事件
