## ADDED Requirements

### Requirement: Final generation state MUST reflect target completeness, not only block request success

annotation generation controller 在一次运行结束时 MUST 基于 target-level completeness 判定最终结果。system MUST NOT 仅因为每个 planned block 的 request 成功返回，就把整次运行判成 `complete`。若本次运行后仍存在 missing targets，最终状态 MUST 使用准确的非完成语义。

#### Scenario: Provider returns fewer valid items than requested targets

- **WHEN** 某次 generation run 中，planned targets 已进入 provider request，但 provider `returnedCount` 或 normalize 后的有效 item 数量少于 `requestedTargetCount`
- **THEN** controller MUST 在运行结束时重新判断当前 generated bundle 是否仍存在 missing targets
- **AND** 若仍存在 missing targets，controller MUST NOT 返回 `complete`

### Requirement: Final diagnostics MUST expose requested, generated, missing, and result state together

annotation generation pipeline MUST 在最终 diagnostics 中同时暴露 `requestedTargetCount`、`generatedTargetsCount`、`missingTargetsCount` 与 final result state，便于区分“block 成功返回”与“target 已全部补齐”。

#### Scenario: Completion diagnostics reveals remaining missing targets

- **WHEN** controller 完成一轮全文或增量 generation
- **THEN** diagnostics MUST 记录本次 `requestedTargetCount`
- **AND** diagnostics MUST 记录最终 `generatedTargetsCount` 与 `missingTargetsCount`
- **AND** diagnostics MUST 记录最终 result state
