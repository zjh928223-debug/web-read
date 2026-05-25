## ADDED Requirements

### Requirement: Real annotation API client MUST classify retryability-stable failure types
`annotation-api-client.js` MUST 把底层 request/provider 失败归一化为稳定的 failureType，至少覆盖 `provider_server`、`request_invalid`、`network` 与其他 provider/server error。该 failureType MUST 足够稳定，供 controller 决定是否 retry，并供 UI 与 diagnostics 直接消费。

#### Scenario: 503 becomes provider_server
- **WHEN** annotation API request 收到 HTTP `503`
- **THEN** API client MUST 归一化输出 `provider_server`
- **AND** 归一化结果 MUST 暴露对应 `httpStatus`

#### Scenario: 400 becomes request_invalid
- **WHEN** annotation API request 收到 HTTP `400`
- **THEN** API client MUST 归一化输出 `request_invalid`
- **AND** 归一化结果 MUST 允许上游据此判定“不可重试”

#### Scenario: Fetch-level failure becomes network
- **WHEN** annotation API request 在 fetch/network 层失败，未取得有效 HTTP 响应
- **THEN** API client MUST 归一化输出 `network`
- **AND** 归一化结果 MUST 暴露最关键的错误信息供 diagnostics 与 UI 使用
