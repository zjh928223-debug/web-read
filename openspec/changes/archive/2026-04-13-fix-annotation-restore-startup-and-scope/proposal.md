## Why

当前 annotation 刷新后无法完整恢复，已定位到两个独立根因：正常启动时过早清空 IndexedDB 内容，导致 `restoreSession()` 拿不到 transcript；以及手动导入 transcript 时生成保存使用的 `currentDocId` 与刷新恢复使用的 derived doc id 不一致，导致 generated bundle 恢复 scope 对不上。现在需要的是针对 restore 链路做最小修复，而不是混入 merge replace/repair 或 annotation 系统重构。

## What Changes

- 修正 startup restore 流程，正常启动时不再无条件 `clearDBStore()`，避免 transcript / marks 在 annotation restore 之前被清空。
- 修正手动导入 transcript 的路径，在 `processTranscript()` 或等价接线点同步更新 `currentDocId`，确保生成保存与刷新恢复使用同一 document scope。
- 保留当前 annotation diagnostics 的关键输出，继续暴露 save scope、restore scope、generated index refresh 与 render 消费的关键证据，便于复测。
- 明确这次修复不改变 `appendGeneratedItems()` 的 add-only merge 语义，不引入 replace/repair，不扩展为 annotation 重构。

## Capabilities

### New Capabilities
- `annotation-restore-scope-integrity`: 定义 annotation restore 启动流程和 document scope 一致性的最小修复要求。

### Modified Capabilities
- `standalone-annotation-generation-pipeline`: 修正 generated bundle 保存与恢复依赖的 document scope 一致性要求。
- `annotation-generation-entry-ui`: 修正刷新恢复时 transcript / generated annotation 的恢复前提与 restore 后状态语义要求。

## Impact

- Affected code: `app.js`，以及必要时极薄的 restore/helper 接线。
- Affected systems: startup restore、transcript import、annotation generated restore、generated index refresh。
- Non-impact: 不修改 merge replace/repair 逻辑，不修改 `appendGeneratedItems()` 语义，不改 bubble、resolver、planner、API client 或 annotation settings 主逻辑。
