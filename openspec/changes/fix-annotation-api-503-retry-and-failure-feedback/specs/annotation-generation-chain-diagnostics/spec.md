## ADDED Requirements

### Requirement: Chain diagnostics MUST expose retry attempt and backoff history
annotation generation chain diagnostics MUST 对每个 block request attempt 暴露可追踪的 retry history。每个事件 MUST 至少记录 `runId`、`blockId`、`attempt`、`maxAttempts`、`failureType`、`httpStatus`、`retryScheduled` 与 `backoffMs`。

#### Scenario: Retry history can be reconstructed from records
- **WHEN** 某个 block 在同一个 run 内发生首发失败并安排后续自动重试
- **THEN** diagnostics records MUST 让开发者看出该 block 共经历了多少次 attempt
- **AND** diagnostics records MUST 让开发者看出每次 retry 前等待了多久

### Requirement: Final attempt diagnostics MUST expose final block and run outcomes
annotation generation chain diagnostics MUST 在 retry 路径结束时暴露 `finalAttempt`、`finalBlockOutcome` 与 `finalRunState`，以便区分“中间失败但最终成功”与“达到重试上限后最终失败”。

#### Scenario: Final outcome stays visible after retry path ends
- **WHEN** 某个 block 的 retry 链路结束，无论最终成功还是最终失败
- **THEN** diagnostics records MUST 记录该次最终 attempt 是否为 `finalAttempt`
- **AND** diagnostics records MUST 同时记录 `finalBlockOutcome` 与 `finalRunState`
