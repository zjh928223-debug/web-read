## Why

当前 annotation 全文生成存在一个状态判定错误：某些 target 已经进入 plan，但 provider / normalize 没有产出完整 item 时，generated bundle 实际仍然缺条目，controller 和入口 UI 却仍把这次运行判成 `complete`。这会让用户误以为“已经全部生成完”，而不是诚实地暴露“仍有 missing targets 尚未补齐”。

## What Changes

- 修正 `startFullArticle()` 结束时的 final-state derivation，不再只因为 block request 成功返回就把整次运行判成 `complete`
- 将 `requestedTargetCount`、`generatedTargetsCount`、`missingTargetsCount`、provider `returnedCount`、normalize / merge 后的实际写入结果纳入完成态判断
- 在 target 未补齐时引入准确的非完成语义，用于表达“本次运行后仍有 missing targets”
- 调整 `buildFinalMessage()` 与 controller -> entry UI 的状态映射，让用户能区分“真的 complete”与“本次仍未补齐”
- 保留并补足 diagnostics，继续输出 requested / returned / normalized / generated / missing / final state 这些关键证据
- 明确本次不修改 provider 行为、不修改 entry restore 状态逻辑、不引入 merge replace/repair 策略

## Capabilities

### New Capabilities
<!-- None -->

### Modified Capabilities
- `standalone-annotation-generation-pipeline`: 调整 controller 对“生成成功但 target 未补齐”场景的完成态与诊断要求
- `incremental-annotation-generation`: 明确 missing targets 仍存在时不得落成 `complete`
- `annotation-generation-entry-ui`: 调整 entry 对 controller resultState 的表达语义，避免把未补齐结果显示成完成

## Impact

- Affected code: `annotation-generation-controller.js`、`annotation-generation-entry-ui.js`，以及必要时极薄的 diagnostics 接线
- Affected systems: full-article generation final state、incremental completion semantics、controller -> UI 状态映射、diagnostics 输出
- Non-impact: 不修改 provider request 策略，不修改 `appendGeneratedItems()` add-only merge 语义，不修改 entry restore 状态逻辑，不修改 bubble / click resolver / storage / restore 主链路
