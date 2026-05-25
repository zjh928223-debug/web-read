## Why

当前 annotation 链路又暴露出两类新的高频问题：一类是全文生成与补生成时 API 失败非常频繁，但系统没有把失败类型和关键原因说清楚；另一类是 UI 看起来像“都生成了”，但前台实际点开注释时内容为空。现在最需要的不是先修业务逻辑，而是把真实失败位置、失败类型分布、以及“空内容”在 provider、normalize、merge、save、load、index、click、render 哪一层丢失查清楚，并把运行时证据稳定记录下来。

## What Changes

- 为 annotation API failure 与 empty-content 排查新增一套 developer-facing diagnostics capability，支持按 `audioKey + documentId + scopeKey + runId` 持续查看运行证据
- 扩充全文生成 / 补生成链路 diagnostics，记录 `runId`、`blockId`、attempt、targetCount、请求起止时间、耗时、是否真正发出 request、HTTP status、provider 错误码、错误消息、error body 安全摘要、`returnedCount`、`normalizedCount`
- 扩充 merge / save / load / generated index refresh diagnostics，记录 merge 前后 itemCount、save 是否成功、写到了哪里、save 后 generated bundle itemCount、refresh 后 indexedItemCount
- 扩充 entry/UI 侧 diagnostics 和最小用户提示，让失败时至少能看出是网络失败、超时、abort、429、5xx、解析失败、normalize 后为空、保存失败，还是后续 load/index/render 问题
- 单独把“UI 显示已生成但前台无内容”的链路串起来，要求 diagnostics 能区分 bundle 为空、bundle 有内容但 index 为空、index 有内容但 click 未命中、以及 UI 状态误判
- 明确记录并验证 `annotation-full-export.json` 的角色，区分它是运行时依赖还是导出产物，避免把它的缺失和前台无内容直接混为一谈
- 明确本次不修改 provider retry 策略、不修改 merge 逻辑、不修改 restore 逻辑、不修改 render 主逻辑，只做 diagnostics 和定位增强

## Capabilities

### New Capabilities
- `annotation-api-failure-and-empty-content-diagnostics`: 面向开发排查的持久化 diagnostics 记录与查看能力，专门覆盖 API failure 与前台空内容问题

### Modified Capabilities
- `annotation-generation-chain-diagnostics`: 扩展全链路 diagnostics，支持 run 级、attempt 级、持久化可回查的 failure 与 empty-content 证据
- `standalone-annotation-generation-pipeline`: 增加 provider request / normalize / merge / save 的细粒度失败分类与计数输出
- `annotation-generation-entry-ui`: 增加失败类型提示与 run 结果摘要，避免只显示笼统失败
- `generated-annotation-click-resolver`: 增加 generated bundle / index / click hit-miss / bubble-consumption 链路的空内容诊断证据

## Impact

- Affected code: `annotation-generation-controller.js`、`annotation-api-client.js`、`annotation-generation-storage.js`、`annotation-generated-result-store.js`、`annotation-click-resolver.js`、`annotation-generation-entry-ui.js`、`app.js`，以及新增的 diagnostics helper / persisted record helper
- Affected systems: full-article generation、incremental generation、provider request tracing、generated bundle save/load、generated index refresh、click-to-bubble consumption、developer diagnostics persistence
- Non-impact: 不修改 provider retry 策略，不修改 merge replace/repair，不修改 restore 主逻辑，不修改 bubble / render 业务行为，不引入后端代理或大重构
