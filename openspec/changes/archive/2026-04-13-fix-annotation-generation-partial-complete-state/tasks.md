## 1. Controller 完成态判定

- [x] 1.1 审查 `startFullArticle()` 结束时可用的 `requestedTargetCount`、`generatedTargetsCount`、`missingTargetsCount`、`returnedCount`、`normalizedCount` 来源
- [x] 1.2 调整 `deriveBundleState()`，让 target 未补齐时不再返回 `complete`
- [x] 1.3 调整 `buildFinalMessage()`，明确区分真正完成与仍有 missing targets 的结果文案
- [x] 1.4 保持 `appendGeneratedItems()` 的 add-only merge 语义不变，不引入 replace/repair

## 2. Controller 到 UI 的结果映射

- [x] 2.1 审查 controller `resultState` 到 entry UI 展示状态的映射点
- [x] 2.2 调整 entry UI 结果映射，确保 target 未补齐时不再显示为 `complete`
- [x] 2.3 确认本次修改不触碰 refresh 后的 entry restore 状态逻辑

## 3. Diagnostics 与验证

- [x] 3.1 补足并串联 `requestedTargetCount`、`returnedCount`、`normalizedCount`、`generatedTargetsCount`、`missingTargetsCount`、`final result state` diagnostics
- [x] 3.2 验证 provider 或 normalize 少产出时，controller 不会再误判 `complete`
- [x] 3.3 验证后续补生成成功补齐 targets 后，状态能回到真正的完成语义
- [x] 3.4 验证本次改动未修改 entry restore 状态逻辑，也未修改 merge replace/repair 行为
