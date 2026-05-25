## ADDED Requirements

### Requirement: Retryable API failures MUST be retried within the same block run
系统 MUST 在 annotation API block request 层对可重试失败执行同 run 内自动重试，而不是要求用户重新开启整轮 generation run。第一版仅允许 `503/provider_server` 与 `network` 进入自动重试。

#### Scenario: Provider server failure is retried in place
- **WHEN** 某个 block request 返回 `503/provider_server`
- **THEN** 系统 MUST 在同一个 `runId` 与同一个 `blockId` 内安排后续 attempt
- **AND** 系统 MUST NOT 要求用户手工重新点击整篇 generation 才继续该 block

#### Scenario: Network failure is retried in place
- **WHEN** 某个 block request 失败类型为 `network`
- **THEN** 系统 MUST 在同一个 `runId` 与同一个 `blockId` 内安排后续 attempt
- **AND** 系统 MUST NOT 启动新的整篇 run 作为默认重试方式

### Requirement: Retry policy MUST remain fixed and bounded
第一版 retry policy MUST 固定为有限次数、递增退避的最小实现。系统 MUST 对 `503/provider_server` 与 `network` 最多重试 2 次，backoff 固定为 `500ms -> 1500ms`。系统 MUST NOT 做无限重试，也 MUST NOT 做并发重试。

#### Scenario: Retry budget is capped
- **WHEN** 某个 block 连续遇到可重试失败
- **THEN** 系统 MUST 最多执行 1 次首发请求加 2 次重试
- **AND** 达到上限后 MUST 停止继续自动重试

#### Scenario: Backoff stays fixed for first version
- **WHEN** 系统为某个 block 安排第 1 次和第 2 次自动重试
- **THEN** 第 1 次重试前 MUST 等待 `500ms`
- **AND** 第 2 次重试前 MUST 等待 `1500ms`

### Requirement: Request-invalid failures MUST NOT be retried
`400/request_invalid` MUST 被视为不可重试失败。系统 MUST 立即终止当前 block 的自动重试路径，并向上游暴露明确、不可混淆的 failure semantics。

#### Scenario: Request invalid stops immediately
- **WHEN** annotation API 返回 `400/request_invalid`
- **THEN** 系统 MUST NOT 为该 block 安排任何自动重试
- **AND** 系统 MUST 将该 block 作为不可重试失败向 controller 和 UI 暴露

### Requirement: Failure feedback MUST expose the primary error class clearly
系统 MUST 向用户清楚区分 `503 Service Unavailable`、`400 request_invalid`、`network error` 与其他 provider/server error。系统 MUST NOT 仅显示笼统失败文案。

#### Scenario: User sees request-invalid instead of temporary-unavailable wording
- **WHEN** 某次 generation run 因 `400/request_invalid` 失败
- **THEN** UI MUST 明确显示请求无效或等价语义
- **AND** UI MUST NOT 把该失败伪装成“服务暂时不可用”

#### Scenario: User sees temporary-unavailable wording for 503
- **WHEN** 某次 generation run 的最终失败类型为 `503/provider_server`
- **THEN** UI MUST 明确显示服务暂时不可用或等价语义
- **AND** UI MUST 允许用户理解这是 provider/server 侧暂时性错误

### Requirement: Retry diagnostics MUST preserve attempt and outcome history
系统 MUST 为每次 block request attempt 记录可持久化 diagnostics，至少包含 `runId`、`blockId`、`attempt`、`maxAttempts`、`failureType`、`httpStatus`、`retryScheduled`、`backoffMs`、`finalAttempt`、`finalBlockOutcome` 与 `finalRunState`。

#### Scenario: Retry history survives page inspection
- **WHEN** 某个 block 在同一个 run 内经历首发请求和后续自动重试
- **THEN** diagnostics records MUST 持久化记录每一次 attempt 的关键信息
- **AND** 开发者 MUST 能在刷新后继续查看这些 attempt、backoff 与最终 outcome
