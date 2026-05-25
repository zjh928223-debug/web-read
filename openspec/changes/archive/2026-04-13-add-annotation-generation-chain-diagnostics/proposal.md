## Why

当前 annotation 链路已经支持初始生成、增量补缺、持久化保存、刷新恢复与页面消费，但同一篇文章仍然出现“生成后缺项、增量后仍缺项、刷新后比刷新前更不完整”的系统性问题。现在最缺的不是新的业务功能，而是对 generate、merge、save、restore、render 全链路的可观测性与可定位结论，先把问题发生层级查清楚，再决定最小修复。

## What Changes

- 新增一套 annotation generation chain diagnostics 能力，用最小必要 instrumentation 跟踪同一篇文章在 generate、merge、save、restore、render 各阶段的 target 数量、annotation 数量、scope key 与 storage key。
- 为初始生成与增量生成共用的 controller / planner / storage / restore / render 路径补充统一日志格式，便于追踪同一个 document、同一个 block、同一个 target 子集在链路中的变化。
- 在不改变当前业务语义的前提下，明确记录“模型返回了多少、merge 前后有多少、写入了哪些 key、恢复读回了哪些 key、最终页面索引和渲染里还有多少”。
- 为 annotation identity 与 scope 恢复路径增加诊断输出，重点验证 `audioKey`、`documentId`、`blockId`、`occurrenceKey` 等关键标识在刷新前后是否稳定一致。
- 为最终排查结论预留输出结构，要求能区分问题发生在 generate、merge、save、restore 或 render 层，而不是笼统归因到“模型漏标”。

## Capabilities

### New Capabilities
- `annotation-generation-chain-diagnostics`: 定义 annotation 全链路诊断日志与定位输出的最小可观测性要求。

### Modified Capabilities
- `standalone-annotation-generation-pipeline`: 补充生成链路必须暴露可诊断计数与 identity/scope 观测点的要求。
- `incremental-annotation-generation`: 补充增量 diff、merge、补缺请求次数与增量回写过程的诊断要求。
- `annotation-generation-entry-ui`: 补充页面初始化、刷新恢复、generated index refresh 与最终页面消费结果的诊断要求。

## Impact

- Affected code: `annotation-generation-controller.js`, `annotation-block-planner.js`, `annotation-generation-storage.js`, `annotation-generated-result-store.js`, `annotation-generation-entry-ui.js`, `app.js`，以及必要的薄 helper。
- Affected systems: annotation generate / incremental merge / save / restore / render 全链路。
- APIs and storage: 不新增 provider API，不改现有业务契约；只增加调试输出、诊断汇总和最小必要的链路观测点。
