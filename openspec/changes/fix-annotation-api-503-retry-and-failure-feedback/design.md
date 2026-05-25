## Context

真实 diagnostics records 已证明，当前 annotation API 高频失败并不是“用户没有打到 API”或“normalize 为空”，而是同一篇文章、同一个 `block-0000` 在多个独立 run 中反复遇到 `503/provider_server`。同时还夹杂少量 `400 request_invalid` 和 `network`，说明系统需要的不是笼统的“失败后再试”，而是稳定的错误分类、同 run 内 block 级自动重试，以及对不可重试错误的明确终止与反馈。

当前链路的关键缺口有两个：

- controller 在 block request 失败后没有同 run 内 retry seam，用户只能反复手工重开 run。
- diagnostics 和 UI feedback 虽然已经能区分部分 failureType，但还不足以完整表达一次 run 内的 `attempt -> backoff -> final outcome` 过程。

这次 change 只覆盖 API 调用失败处理，不碰 render、restore、merge replace/repair、entry restore 状态逻辑和 bubble 显示逻辑。

## Goals / Non-Goals

**Goals:**

- 为 `503/provider_server` 与 `network` 增加 block 级、同 run 内、有限次数的自动重试。
- 固定第一版 retry policy：最多 2 次重试，backoff 为 `500ms -> 1500ms`。
- 保持 `400 request_invalid` 非重试，并在 UI 与 diagnostics 中单独暴露。
- 让 controller 的 block/run 状态映射能够区分“首个 attempt 失败但后续已重试成功”与“达到重试上限后仍失败”。
- 让 diagnostics records 能完整复盘同一 run 内每次 attempt、backoff、最终 block outcome 与 final run state。

**Non-Goals:**

- 不修改 annotation render、restore、click resolver、bubble 显示逻辑。
- 不修改 `appendGeneratedItems()` 的 add-only merge 语义，也不引入 replace/repair。
- 不引入整篇文章级 retry manager，不做并发重试，不做无限重试。
- 不在这次 change 中修复 `400 request_invalid` 的根因，只要求其不重试且清晰提示。

## Decisions

### 1. Retry 粒度固定在 block request 层

选择只对当前失败 block 做重试，而不是整 run 重来。

原因：

- 真实 records 已证明失败集中在 `block-0000`，没有证据表明整 run 重启是必要的。
- block 级 retry 可以最大化复用已有 planner、progress、bundle merge 与 diagnostics 结构。
- 这能把“用户手工反复点”收回到当前 run 内，且不会把未失败 block 重新请求。

备选方案：

- 整 run 自动重试：实现简单，但会重复请求已经成功的 block，范围过大，且违背当前定位结果。

### 2. Retry policy 固定为小而硬的第一版

固定规则：

- `503/provider_server`：最多重试 2 次
- `network`：最多重试 2 次
- `400/request_invalid`：0 次重试
- backoff：`500ms -> 1500ms`

原因：

- 真实 records 里的主因是 `503`，需要先解决最主要的高频失败。
- 小而固定的 policy 更容易验证，也不容易在首次修复中把控制器复杂化。
- `400` 明显属于不可重试类；重试只会徒增噪音。

备选方案：

- 可配置 retry policy：灵活，但会把这次修复扩展成配置与策略系统。
- 更长 backoff / 更多 attempt：可能提高成功率，但没有真实证据支撑，且会拉长单次 run 等待时间。

### 3. 错误分类在 API client 输出稳定 failureType，在 controller 决定是否 retry

`annotation-api-client.js` 负责把底层失败归一化为稳定的 failure shape，例如 `provider_server`、`request_invalid`、`network`。`annotation-generation-controller.js` 只根据这个 failure shape 应用 retry policy、backoff 和最终 block/run 状态流转。

原因：

- 错误分类属于 API 边界责任，controller 不应重复解读原始 fetch/provider error。
- controller 更适合决定“是否 retry”和“run 最终怎么收口”。
- 这样 diagnostics 和 UI message 可以复用同一套 failureType，而不是各层自行判断。

备选方案：

- 在 controller 内直接解析原始 error：会让状态机与底层网络/provider 细节强耦合。

### 4. 首次可重试失败不能立刻把 run 终结为最终失败

可重试失败在首个 attempt 发生时，只记录 block 级 retry 计划与中间状态；只有达到重试上限后仍失败，才进入最终 `failed` 或 `partial-failed`。若后续 attempt 成功，则 run 继续正常推进。

原因：

- 当前痛点正是“第一次失败就逼用户重开 run”。
- 若在第一次 `503` 时就先把 run 写成最终失败，再在后续 attempt 成功后修正，会让状态流与 UI message 变脏。

备选方案：

- 第一次失败先落临时 failed 再反转：实现上更危险，容易留下错误的终态和 message。

### 5. Diagnostics 采用追加字段，而不是另起一套平行记录

沿用当前 diagnostics records 体系，在 block request / block failure / run summary 事件上新增：

- `attempt`
- `maxAttempts`
- `retryScheduled`
- `backoffMs`
- `finalAttempt`
- `finalBlockOutcome`
- `finalRunState`

原因：

- 这次修复依赖已有 records 做验收，继续沿用同一体系可以直接和现有 records 对比。
- 新增字段即可支持复盘，不必新建第二套 retry telemetry。

## Risks / Trade-offs

- [Risk] 同 run 内 retry 会拉长单次 run 的等待时间  
  → Mitigation：把 policy 固定在 2 次重试，且只对单个失败 block 生效。

- [Risk] `network` 归类可能覆盖部分瞬时浏览器异常，导致 message 仍不够细  
  → Mitigation：保留原始 `errorMessage`、`httpStatus` 和 `failureType`，先保证分类可见，再决定是否细分。

- [Risk] controller 状态机加入 retry 后，block outcome 与 final run state 更复杂  
  → Mitigation：明确“分类在 client，重试决策在 controller，最终显示在 entry UI”的单向责任边界。

- [Risk] `400 request_invalid` 仍然会持续发生  
  → Mitigation：本次不掩盖它，明确不重试并单独提示，后续如有必要再开 change 修根因。
