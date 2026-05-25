## Context

当前 annotation 链路已经具备初始生成、增量补缺、bundle 持久化、刷新恢复、generated index refresh、click resolver 与 bubble 消费能力，但缺少一套跨层一致的诊断视图。用户现在遇到的是系统性不完整问题：同一篇文章在初始生成后缺项、增量后仍缺项、刷新后恢复得比刷新前更不完整。现状里虽然每一层都有自己的状态或数据结构，但没有统一日志把同一篇文章、同一个 scope、同一个 block、同一个 target 子集串起来，因此很难明确判断问题究竟发生在 generate、merge、save、restore 还是 render。

这次 change 的目标不是修复业务逻辑，也不是重构 annotation 系统，而是为现有链路补充最小必要 instrumentation，让后续排查能拿到可信证据。约束是：不改变 provider 调用契约、不改变增量生成主语义、不引入新的存储格式、不把调试逻辑散落到多个风格不一致的输出点。

## Goals / Non-Goals

**Goals:**
- 为 generate、merge、save、restore、render 五层补充统一的诊断事件和计数输出。
- 让同一篇文章的一次初始生成或增量生成可以通过 `audioKey`、`documentId`、`scopeKey`、`blockId`、`occurrenceKey` 等字段追踪。
- 明确记录每个 block 的 target 数量、provider 返回数量、merge 前后 bundle 数量、保存 key、恢复 key、恢复后 index 数量、最终渲染/消费数量。
- 支持区分“模型没返回”“merge 丢了”“保存没写进去”“恢复没读回来”“渲染没显示”这几种不同问题。
- 让 instrumentation 默认足够克制，可在开发排查时打开，不要求变成常驻用户功能。

**Non-Goals:**
- 不直接修复 annotation 缺项问题。
- 不重构 `annotation-generation-controller.js`、`annotation-generation-storage.js`、`app.js` 的主结构。
- 不变更 generated bundle schema、click resolver 契约、bubble UI 契约、API settings UI 主语义。
- 不引入复杂 observability 平台、远程上报、后端日志或数据库诊断表。

## Decisions

### Decision 1: 使用一个薄的 diagnostics helper 统一输出，而不是在各处直接 `console.log`

在 annotation 链路里直接散落 `console.log` 很快会失控，后续也难以按 scope 聚合。更稳的方案是新增一个很薄的 diagnostics helper，统一负责：
- 生成 `scopeKey`
- 统一事件名
- 统一日志字段结构
- 提供启停开关
- 在必要时把事件缓存到内存，便于一次流程结束后回看

这样 controller、storage、restore、render 只负责上报事实，不各自发明日志格式。

备选方案：
- 直接在每个文件写 `console.log`：实现快，但输出分散，难追同一篇文章。
- 引入完整 telemetry store：超出这次诊断范围，过重。

### Decision 2: 诊断维度以 scope + block + target subset 为主，而不是以 UI 事件为主

当前问题横跨生成、增量、恢复和渲染。真正稳定的观测维度不是“用户点了哪个按钮”，而是：
- 哪个 `audioKey`
- 哪个 `documentId`
- 哪个 `scopeKey`
- 哪个 `blockId`
- 这次目标集有多少、缺口有多少、返回有多少、落盘有多少、恢复有多少

所以 diagnostics 事件需要围绕这些维度设计，避免只输出“点击了生成按钮”这种低价值日志。

备选方案：
- 以按钮点击和 UI 状态为主：不足以判断数据在哪层丢失。

### Decision 3: 生成、增量、恢复共用同一套 identity 观测字段

这次排查的关键怀疑点之一就是 key/scope/identity 不稳定。因此 diagnostics 必须把这些字段显式打出来：
- `audioKey`
- `documentId`
- `scopeKey`
- `blockId`
- `targetCount`
- `missingTargetsCount`
- `generatedItemsCount`
- `occurrenceKeySample` 或等价样本

这样才能验证 diff、planner、merge、save、restore、render 是否共享同一套 identity 语义。

备选方案：
- 每层只打自己的局部 id：无法排除跨层错配。

### Decision 4: 保存层和恢复层都必须记录“读写了哪个 key，以及读写后数量是多少”

用户最关心的是“增量结果到底有没有真正持久化”和“刷新后到底恢复了什么”。因此存储诊断必须覆盖：
- 写入的 storage key / file path
- 写入时 generated bundle block/item 数量
- 读取的 storage key / file path
- 读取回来的 generated/status 数量

只有这样才能区分：
- 根本没写
- 写了但写到别的 scope
- 写对了但读错了 scope
- 读回来了但后续又被清掉

### Decision 5: render 侧只加最小必要观测，不引入新的页面调试 UI

这次目标是定位，不是造一个新的 diagnostics 面板。render 侧只需要补最少日志：
- 刷新 generated index 时当前 scope 是什么
- index 里有多少 items
- 最终 click/bubble 消费命中了多少
- 如有“每个 block 实际显示多少 annotation”的现成结构，可附带计数

不新增调试按钮、不新增调试面板，避免把诊断功能做成新产品面。

## Risks / Trade-offs

- [Risk] 日志太散，最后还是看不出链路关系 → Mitigation：统一事件名和字段结构，所有事件带上 `scopeKey`，关键层带 `blockId` 和计数。
- [Risk] 日志过多影响排查效率 → Mitigation：默认只输出关键节点计数与 key，不打整份 payload；必要时只抽样 `occurrenceKey`。
- [Risk] instrumentation 改动过深，反而引入新 bug → Mitigation：限定为只读式观测与最小 helper，不改业务分支判定。
- [Risk] 仅靠日志仍无法区分 provider 漏回和下游丢失 → Mitigation：在 provider 返回后立刻记录 `returnedCount`，并与 block `targetCount`、merge 前后数量成对输出。
- [Risk] 诊断期间输出中文/英文混乱，后续难 grep → Mitigation：事件名和字段名保留英文，说明性 message 才用中文。
