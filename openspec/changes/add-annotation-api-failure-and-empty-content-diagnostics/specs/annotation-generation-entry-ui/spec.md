## ADDED Requirements

### Requirement: Entry UI MUST surface the primary failure category instead of generic failure only

page-level annotation generation entry/status MUST 在 generation run 失败时显示最关键的失败类别，而不是只显示笼统失败。最少必须能区分网络失败、超时、abort、429、5xx、解析失败、normalize 后为空、保存失败以及后续 load/index/render 侧问题。

#### Scenario: User can see primary failure category immediately
- **WHEN** 一次全文生成或补生成失败
- **THEN** entry UI MUST 显示该次失败的主类别或最关键失败原因
- **AND** entry UI MUST NOT 只停留在“失败了”的笼统提示

### Requirement: Entry UI diagnostics MUST expose run-level summary for investigation

entry UI 相关 diagnostics MUST 记录本次 run 的结果摘要，至少包括 `runId`、result state、主要 failure type、`requestedTargetCount`、`returnedCount`、`normalizedCount`、`generatedTargetsCount` 与 `missingTargetsCount`，便于将 UI 状态与下游 bundle/index 状态对齐。

#### Scenario: UI summary can be matched to persisted diagnostics
- **WHEN** 排查者查看一次 run 的 entry 结果
- **THEN** diagnostics MUST 提供该次 run 的 `runId` 与摘要计数
- **AND** 该摘要 MUST 能与持久化 diagnostics record 对齐
