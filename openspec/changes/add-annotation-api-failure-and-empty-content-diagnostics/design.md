## Context

当前 annotation 链路已经有基础 diagnostics，但它更偏向 generate / merge / save / restore / render 的通用计数追踪，无法回答这次最关键的两个问题：一是 API 为什么高频失败、失败类型如何分布、每次失败究竟发生在 request、response、parse、normalize 还是 save；二是 UI 看起来像“已生成”，但前台点击时内容为空时，真实断点究竟在 bundle、index、click resolver、bubble render，还是只是 UI 状态误判。

这次 change 明确不修业务逻辑。范围只限于补齐证据链，并把证据写成刷新后可回查的持久化记录。约束也很明确：不改 provider retry 策略、不改 merge replace/repair、不改 restore 主逻辑、不改 render 主逻辑、不把 diagnostics 扩展成复杂产品功能。

## Goals / Non-Goals

**Goals:**
- 为每次全文生成和补生成建立稳定的 `runId` / `scopeKey` / `blockId` / attempt 级别诊断证据
- 把 API failure 按网络错误、超时、abort、429、5xx、解析失败、normalize 后为空、保存失败等类型分类并持久化
- 把 provider return、normalize、merge、save、load、generated index refresh、click resolver、bubble consumption 串成一条可核对的链路
- 在失败时给出最小但明确的用户侧提示，让排查者一眼看出最关键失败类型
- 对“UI 显示已生成但前台无内容”建立逐层证据，明确 runtime 依赖的数据源以及 `annotation-full-export.json` 的真实角色

**Non-Goals:**
- 不修改 provider 重试与退避策略
- 不修改 merge 逻辑、replace/repair、增量补全策略
- 不修改 restore 主逻辑或 generated bundle 主数据结构
- 不重构 bubble、click resolver、entry UI 整体架构
- 不把 diagnostics 扩展成面向普通用户的大型设置中心或运营级 telemetry 系统

## Decisions

### Decision 1: 使用持久化 run 记录而不是只扩充 console diagnostics
仅靠 `console.info` 无法支撑刷新后的对比排查，也无法稳定统计 API 失败分布。这次会在现有 diagnostics 体系之上新增一层轻量持久化 run record，按 `audioKey + documentId + scopeKey` 组织，并为每次生成分配 `runId`。这样一次 run 中的 request、normalize、merge、save、load、index、click 证据可以在刷新后继续查看。

备选方案：
- 只保留 console diagnostics：刷新后丢失，无法满足用户“持续查看”的诉求
- 直接引入远程 telemetry：超范围，也不符合当前本地 reader 的设计约束

### Decision 2: API failure 采用“分类 + 安全摘要”结构，不直接裸存完整 response body
这次需要记录失败原因，但不应把可能包含敏感字段或大体积内容的原始 body 无约束落盘。设计上应保留：
- `failureType`
- `httpStatus`
- `providerErrorCode`
- `errorMessage`
- `errorBodySummary`
- `durationMs`
- `requestStartedAt` / `requestFinishedAt`

其中 `errorBodySummary` 只保留安全摘要，用于区分限流、5xx、返回格式异常、空 payload 等问题。

备选方案：
- 完整落盘原始 body：信息最多，但有安全和体积风险
- 只存 failureType：过于粗糙，无法支持后续定位

### Decision 3: 空内容问题按“数据源链路”逐层打点，而不是只盯某一个导出文件
这次不能先假设 `annotation-full-export.json` 是根因。设计上会把前台链路拆成：
`provider return -> normalize -> merge -> save -> load bundle -> generated index refresh -> click resolve -> bubble/content render`

同时单独记录：
- 当前前台消费的数据源是什么
- `annotation-full-export.json` 是否存在
- 当前页面显示是否直接依赖该文件

这样才能回答“它是不是运行时必需文件”而不是凭直觉下结论。

备选方案：
- 直接围绕 `annotation-full-export.json` 加日志：风险是把导出文件和运行时数据源混淆

### Decision 4: entry/UI 只做最小失败原因提示，不承载复杂诊断分析
用户希望失败时能一眼知道关键原因，但这次不做大 UI。设计上 entry/UI 只承担两件事：
- 用明确状态消息表达 failureType 或最关键异常类别
- 暴露 `runId` 或等价 trace 标识，方便和持久化 diagnostics 对照

详细统计和逐层证据仍放到 diagnostics record 中。

备选方案：
- 在 UI 里直接塞完整 diagnostics 面板：信息多，但会快速越界到产品改造
- 完全不做用户侧提示：又回到“只知道失败了”的问题

## Risks / Trade-offs

- [Risk] diagnostics 事件量显著上升，持久化后可能变得嘈杂  
  → Mitigation：按 `runId` 聚合，只保留关键字段，并限制每个 scope 的历史 run 数量

- [Risk] failure 分类过粗会继续掩盖真实问题，过细又容易不稳定  
  → Mitigation：先采用少数高价值类别（网络、超时、abort、429、5xx、parse failure、normalize empty、save failure、index/render mismatch），未知情况统一落到 `unknown`

- [Risk] 为了诊断空内容问题新增的事件过多，可能干扰正常阅读流程  
  → Mitigation：只在 generation run、bundle load、index refresh、click/bubble consumption 等关键边界打点，不把日志散落到所有 UI 微交互

- [Risk] 诊断记录若不带稳定 scope/run 信息，刷新前后仍难以关联  
  → Mitigation：所有持久化记录强制带 `runId`、`audioKey`、`documentId`、`scopeKey`
