## 1. API 错误分类与 retry policy

- [x] 1.1 审查 `annotation-api-client.js` 当前 `503`、`400`、`network` 等 failureType 的归一化出口，确认 controller 可稳定消费的错误形状
- [x] 1.2 在 API client 层补齐 `provider_server`、`request_invalid`、`network` 与其他 provider/server error 的稳定分类与关键信息暴露
- [x] 1.3 固定第一版 retry policy 常量与 helper：`503/provider_server` 最多重试 2 次、`network` 最多重试 2 次、`400/request_invalid` 不重试、backoff 为 `500ms -> 1500ms`

## 2. Controller 同 run 内 block retry

- [x] 2.1 审查 `annotation-generation-controller.js` 当前 block request / block failure / run summary 状态流转点，确认在哪一层接入 block 级 retry 最小改动
- [x] 2.2 实现只针对当前失败 block 的同 run 内自动重试，不重启整轮 run，不引入整篇级 retry manager
- [x] 2.3 确保首次可重试失败不会立刻把整次 run 终结为最终 `failed / partial-failed`
- [x] 2.4 确保达到 retry 上限后仍失败时才落最终失败；若后续 attempt 成功，则 run 继续正常完成
- [x] 2.5 确保 `400/request_invalid` 直接终止当前 block，不进入自动重试路径

## 3. Failure feedback 与 diagnostics records

- [x] 3.1 扩展 diagnostics records，记录 `runId`、`blockId`、`attempt`、`maxAttempts`、`failureType`、`httpStatus`、`retryScheduled`、`backoffMs`、`finalAttempt`、`finalBlockOutcome`、`finalRunState`
- [x] 3.2 在 block request / block failure / run summary 路径上串联 attempt、retry、backoff 与最终 outcome 的持久化输出
- [x] 3.3 调整 controller result message 与相关 UI feedback，使用户能明确区分 `503 Service Unavailable`、`400 request_invalid`、`network error` 与其他 provider/server error
- [x] 3.4 确认本次 failure feedback 改动不触碰 entry restore 状态逻辑、不触碰 render / bubble / merge replace/repair

## 4. 验证

- [x] 4.1 增加或更新验证脚本，覆盖 `503/provider_server` 在同 run 内自动重试并最终成功的场景
- [x] 4.2 验证 `network` 错误按同样规则重试，且 diagnostics 能记录每次 attempt 与 backoff
- [x] 4.3 验证 `400/request_invalid` 不重试、立即终止，并在 UI / diagnostics 中单独标记
- [x] 4.4 验证最终 records 能清楚显示同一个 run 内的 retry 次数、每次失败类型、backoff 时长与 final run state
- [x] 4.5 运行 `node --check` 覆盖相关文件，确认这次修复未扩展到 render、restore、merge replace/repair 或 entry restore 状态逻辑
