## Why

当前 annotation generation 已经能从 unified target source 生成并持久化结果，但每次点击“生成全文注释”仍按整篇思路处理。对已经生成过的大部分 target 来说，这会重复消耗 provider request，也会让“只是补一个新标记”的场景显得过重。现在需要把这条链路升级为基于稳定 target identity 的补缺式增量生成，让系统只为尚未生成的 target 调用 API，并在无缺口时诚实返回无操作结果。

## What Changes

- 新增一条基于稳定 target identity 的 incremental annotation generation 能力，用于计算当前 target 集与已生成 annotation 集之间的差集。
- 修改现有 generation entry 行为：点击“生成全文注释”后先做 diff；若无 missing targets，则不发 provider request，并返回可区分于普通 complete 的 no-op 结果。
- 修改现有 planner/controller 接线，使 planner 只围绕 missing targets 规划 blocks，而不是对整篇全量 targets 重新规划再过滤。
- 修改现有 generated bundle merge 语义为“补缺优先”：新增结果只合并缺失 target，不覆盖或重复插入已存在 target。
- 修改现有 page-level status 语义，使用户能区分“本次无需生成”和“本次补生成了若干项”。

## Capabilities

### New Capabilities
- `incremental-annotation-generation`: 基于稳定 target identity 计算 missing targets、驱动补缺式生成、并在无缺口时返回 no-op 结果。

### Modified Capabilities
- `standalone-annotation-generation-pipeline`: generation pipeline 从整篇重跑语义升级为默认优先补全未生成 target，并统一 diff、planner、merge 使用同一套 target identity。
- `annotation-generation-entry-ui`: page-level generation entry/status 需要诚实表达“无缺口未发请求”和“补生成了若干项”的差异。

## Impact

- Affected code:
  - `annotation-target-source.js`
  - `annotation-block-planner.js`
  - `annotation-generation-controller.js`
  - `annotation-generation-storage.js`
  - `annotation-generated-result-store.js`
  - `annotation-generation-entry-ui.js`
  - `app.js`
  - 新增一个轻量 diff helper/store 模块
- Affected systems:
  - unified target source
  - generation planning/orchestration
  - generated bundle merge/restore/refresh
  - page-level generation status rendering
- APIs:
  - 不新增新的 provider API 契约
  - 继续复用现有 `window.__ANNOTATION_API_CONFIG__`、existing generated bundle shape、click resolver/bubble consumption chain
