## Why

当前 annotation generation 的问题已经不再只是单点失败处理，而是单轮 run 的调度语义不符合实际使用需求。

真实运行里已经出现过这样的情况：

- 一次 run 会把整份 plan 按 block 全部扫完，而不是在有限预算内结束
- 同 run 内自动 retry 会放大 request 数量，破坏“单轮最多调用若干次 API”的可预期性
- block 之间没有强约束的 pacing，容易在短时间内集中打出请求
- 用户无法在运行中真正 stop，最多只能等本轮自己结束
- initial run 和 incremental run 都走 generation controller，但当前没有共享、明确、可验证的 scheduling contract

这导致用户体验和系统行为都不稳定：

- 单次点击可能超出用户预期的 request 数
- provider 波动时会把一次 run 扩成一串密集请求
- 用户无法判断系统是在等待下一次请求、已经卡死、还是已经结束
- diagnostics 能记录失败，但还不能清楚表达“这一轮为什么结束”

这次 change 的目标不是继续调 retry，也不是修 provider 本身，而是**重定义 annotation generation 的单轮运行调度模型**：

- 单次 run 有硬 request budget
- request start time 有固定 pacing
- 单次 run 结束后不自动开启下一轮
- initial / incremental 共用同一套 scheduling contract
- 用户可以 stop，且 stop 语义真实可验证

## What Changes

- 新增一份 run scheduling / stop control capability，定义 annotation generation 单轮运行的硬 contract
- planner 保持原有 block 切分职责；controller 或 planning wrapper 负责对本轮可执行 blocks 做硬裁剪
- 单次 run 的 actual request budget 固定为 10，成功和失败都计入预算，单 run 内无自动 retry
- controller 改为按 request start time 调度，相邻两次 request start 至少相隔 5 秒
- 单轮 run 结束即结束；若仍有 missing targets，由用户手工再次触发下一轮
- initial run 和 incremental run 必须复用同一条 scheduling path，而不是复制两套实现
- 新增 stop contract：至少阻止后续 request；若当前结构允许，则支持 abort in-flight request
- entry UI 增加对 running / waiting-next-block / stopped / complete / partial-or-remaining 等状态的诚实表达
- diagnostics records 增加 request budget、request 序号、nextAllowedStartAt、stopRequested、stopHandled、requestAborted、final run reason 等记录
- 明确本次 change 不修改 restore、render、bubble、merge replace/repair、annotation content fields、provider prompt

## Capabilities

### New Capabilities

- `annotation-generation-run-scheduling-control`: 定义单 run 的 request budget、5 秒 pacing、manual follow-up、stop/abort 语义，以及 run final reason contract

### Modified Capabilities

- `standalone-annotation-generation-pipeline`: controller 将从“尽量跑完整份 plan，并可能带自动 retry”改为“在固定 request budget 内按固定 pacing 串行执行，并按 run contract 收口”
- `incremental-annotation-generation`: incremental run 必须与 initial run 共享同一 scheduling contract，包括 10 次预算、5 秒 start 间隔、无自动 retry、无自动 next run
- `annotation-generation-entry-ui`: 入口 UI 必须区分冷却等待、停止、完成、预算耗尽但仍有剩余目标等状态
- `annotation-generation-chain-diagnostics`: diagnostics records 必须表达单轮 request 预算消耗、nextAllowedStartAt、stopRequested / stopHandled、requestAborted 与 final run reason
- `real-annotation-api-client`: 若当前结构允许 abort，则 client 需要暴露或配合 controller 的 abort seam，但不改变 provider prompt 和业务输出语义

## Impact

- 主要影响 `annotation-generation-controller.js`、`annotation-generation-entry-ui.js`、diagnostics records / helper、以及可能的 `annotation-api-client.js` abort seam
- planner 的 block 切分规则本身不重写，但 controller 会对 planner 结果进行本轮硬裁剪
- 本次 change 明确会收回或关闭上一条 change 引入的单 run 自动 retry，使其不再破坏 request budget contract
- 这次不涉及 restore、render、bubble、merge replace/repair、annotation content field、provider prompt 的行为修改
