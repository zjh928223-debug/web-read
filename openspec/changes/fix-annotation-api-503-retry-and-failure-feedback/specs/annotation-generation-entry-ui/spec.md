## ADDED Requirements

### Requirement: Entry feedback MUST distinguish retryable and non-retryable API failures
page-level annotation generation entry/status MUST 对 API failure feedback 使用明确分类。UI MUST 让用户区分 `503 Service Unavailable`、`400 request_invalid`、`network error` 与其他 provider/server error，而不是仅显示笼统失败。

#### Scenario: Retryable provider failure is shown honestly
- **WHEN** 某次 generation run 在用尽自动重试后仍以 `503/provider_server` 结束
- **THEN** entry/status MUST 明确显示服务暂时不可用或等价语义
- **AND** entry/status MUST NOT 将其描述为请求无效

#### Scenario: Request-invalid failure is shown honestly
- **WHEN** 某次 generation run 因 `400/request_invalid` 结束
- **THEN** entry/status MUST 明确显示请求无效或等价语义
- **AND** entry/status MUST NOT 将其描述为临时服务波动

### Requirement: Entry status MUST tolerate in-run retries before final failure
entry/status 在同一个 run 内 MUST 允许 block request 先经历可重试失败和 backoff，再等待 controller 给出最终 block/run outcome。系统 MUST NOT 因首次可重试失败就立刻把用户逼回手工再点一次。

#### Scenario: First retryable failure does not immediately become terminal UI failure
- **WHEN** 当前 run 中某个 block 的首个 attempt 命中可重试错误并已安排后续重试
- **THEN** entry/status MUST 保持同一个 run 的进行中语义
- **AND** 只有在达到 retry 上限后仍失败时，entry/status 才能进入最终失败语义
