## ADDED Requirements

### Requirement: Block execution MUST retry retryable API failures before finalizing block failure
annotation generation pipeline MUST 在 block execution 层对可重试 API 失败进行同 run 内重试。controller MUST 在达到 retry 上限前保留该 block 的可恢复状态，而不是在首次 `503/provider_server` 或 `network` 时立刻终结整次 run。

#### Scenario: Retryable block failure stays in the same run
- **WHEN** 某个 planned block 的首个 attempt 失败类型属于可重试集合
- **THEN** controller MUST 在同一个 `runId` 内继续执行该 block 的后续 attempt
- **AND** controller MUST NOT 立即把整次 run 终结为最终 `failed` 或 `partial-failed`

#### Scenario: Exhausted retry budget finalizes block failure
- **WHEN** 某个 block 已达到 retry 上限后仍然失败
- **THEN** controller MUST 将该 block 视为最终失败
- **AND** controller MUST 基于该最终失败更新整次 run 的最终状态

### Requirement: Final run state MUST reflect post-retry outcome
controller MUST 基于 block 在所有允许 attempt 结束后的最终 outcome 决定 final run state。若某个 block 经过自动重试后成功，整次 run MUST 继续正常推进；若最终仍失败，run 才能进入 `failed` 或 `partial-failed`。

#### Scenario: Successful retry keeps run on success path
- **WHEN** 某个 block 的首个 attempt 失败，但后续自动重试成功并产生有效结果
- **THEN** controller MUST 将该 block 视为成功完成
- **AND** final run state MUST NOT 因此前一次中间失败而被固定为最终失败
