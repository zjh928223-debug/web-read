## Why

真实 diagnostics records 已确认，当前 annotation API 高频失败的主因是 `503/provider_server`，并且失败集中在同一个 `block-0000`、`attempt = 1`。这说明系统当前没有把可重试失败收敛在同一个 run 内处理，而是把用户逼回跨 run 的手工重复点击，直接拖慢补生成效率。

同时，真实 records 里还混有少量 `400 request_invalid` 和 `network` 错误。现有 failure feedback 过于笼统，无法让用户快速判断这次失败到底是临时服务不可用、请求本身无效，还是网络问题，也无法从 diagnostics 中直接复盘同一个 run 内到底经历了多少次 attempt 与 backoff。

## What Changes

- 为 annotation block request 增加同 run 内自动重试，只覆盖 `503/provider_server` 与 `network` 两类可重试失败。
- 固定第一版 retry policy：`503/provider_server` 最多重试 2 次，`network` 最多重试 2 次，backoff 为 `500ms -> 1500ms`，不做无限重试，不做并发重试。
- 保持 retry 粒度在 block request 层；只重试当前失败 block，不引入整篇文章级 retry manager，不重启整轮 run。
- 对 `400 request_invalid` 保持非重试语义，立即终止当前 block，并给出明确的 failure feedback。
- 扩展 diagnostics records，记录同一 run 内每次 attempt、是否安排 retry、backoff 时长、final attempt、final block outcome 与 final run state。
- 调整 controller 与 entry result message 的 failure feedback，使用户能区分 `503 Service Unavailable`、`400 request_invalid`、`network error` 以及其他 provider/server error。
- 明确本次 change 不修改 annotation render、restore、merge replace/repair、entry restore 状态逻辑、bubble 显示逻辑，也不做大重构。

## Capabilities

### New Capabilities
- `annotation-api-retry-failure-handling`: 定义 annotation API block 级自动重试、不可重试错误终止规则，以及用户可见的 failure feedback 与 attempt/backoff diagnostics 契约。

### Modified Capabilities
- `standalone-annotation-generation-pipeline`: generation controller 的 block failure 处理将从“首次失败即终止”升级为“按固定 policy 在同 run 内重试可重试错误，并据最终 attempt 结果决定 block/run 状态”。
- `annotation-generation-entry-ui`: page-level generation entry/status 的 failure message 将区分 `503`、`400`、`network` 与其他 provider/server error，而不是只显示笼统失败。
- `annotation-generation-chain-diagnostics`: diagnostics 需要补充 run/block 级 attempt、retryScheduled、backoffMs、finalAttempt、finalBlockOutcome 与 finalRunState，支持复盘同一 run 内的自动重试过程。
- `real-annotation-api-client`: API client 的错误分类输出将需要稳定暴露 `provider_server`、`request_invalid`、`network` 等 failure type 与关键错误信息，供 controller retry policy 和 UI feedback 使用。

## Impact

- 主要影响 `annotation-api-client.js`、`annotation-generation-controller.js`、diagnostics record/helper 相关代码，以及 page-level entry/status 的 failure feedback 映射。
- 不引入新的 provider、不修改 prompt/build/merge/restore/render 主逻辑，不改变 `appendGeneratedItems()` 的 add-only merge 语义。
- 验证重点将放在真实高频 `503` 场景下是否显著减少跨 run 人工重复点击，以及 `400 request_invalid` 是否保持立即终止且清晰提示。
