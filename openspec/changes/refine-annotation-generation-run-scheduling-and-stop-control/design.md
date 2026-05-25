## Context

当前 annotation generation 已经具备：

- initial run / incremental run 共用 `AnnotationGenerationController.startFullArticle(...)`
- planner 能按 target / sentence / word cap 正常切 block
- incremental run 会先 diff missing targets，再把 missing targets 喂给 planner
- diagnostics / records 已经能记录 run、block、request 级的一部分事实

但这些能力当前仍服务于旧 contract：

- 一轮 run 默认尝试扫完整份 plan
- 同 run 内可能做 block 级自动 retry
- request 之间没有固定 pacing contract
- stop seam 不完整

这次 change 需要把 contract 改成：

```text
single run
-> plan blocks normally
-> take first 10 executable blocks only
-> execute serially
-> each actual request consumes 1 budget
-> next request start >= previous request start + 5000ms
-> no automatic retry
-> user may stop
-> run ends with explicit final reason
```

## Goals / Non-Goals

**Goals**

- 为 initial / incremental run 定义同一套 scheduling contract
- 把 `10` 定义为单 run 的 actual request hard budget
- 把 `5s` 定义为 request start time interval，而不是 request end 后等待
- stop 至少阻止后续 request；若可行则 abort 当前 in-flight request
- UI 能表达 waiting / stopped / partial-or-remaining / complete
- diagnostics 能复盘 run 是因 complete、budget exhausted、stopped 还是 failed 结束

**Non-Goals**

- 不改 planner 的 block 切分算法本身
- 不改 restore / render / bubble / merge replace/repair
- 不改 annotation 内容字段空不空
- 不改 provider prompt
- 不引入自动 next run

## Decisions

### 1. Request budget 落在 controller 调度层，不落在 planner

planner 继续只负责“如何切 block”，不负责“这一轮最多跑多少 block”。

controller 在拿到 plan 后执行：

- 过滤出当前可执行 blocks
- 只取前 `10` 个作为本轮 block schedule

原因：

- 这样不污染 block 切分算法
- initial / incremental 都能共用同一个 run-level cap
- “10 次预算”是运行 contract，不是文本切分规则

### 2. `10` 是 actual request budget，不是 block 数的近似值

本次 contract 明确：

- 每次真正发出的 request 都消耗 1 次预算
- 成功、503、400、network、abort 都算已消耗
- 尚未发出的后续 block 不计入预算

结果：

- 单 run 内自动 retry 必须关闭
- 一个 block 只能对应 0 或 1 次实际 request
- 若 in-flight request 被 abort，也算消耗过 1 次预算

### 3. 相邻 request start time 至少相隔 5 秒

调度公式固定为：

- `nextAllowedStartAt = previousRequestStartAt + 5000ms`

controller 在发起下一次 request 之前：

- 如果当前时间未达到 `nextAllowedStartAt`，进入 waiting-next-block 状态
- 到时后再发起下一次 request

这比“请求结束后再等 5 秒”更稳定，因为 request duration 波动不会改变 pacing contract。

### 4. 单 run 内无自动 retry

上一条 change 引入的 block 内 automatic retry 会破坏：

- 单 run 最多 10 次 request
- 用户对单轮预算的预期
- diagnostics 对“这一轮到底发了多少次请求”的可读性

因此这次 change 要求：

- 单 run automatic retry 默认关闭
- 同 run 的多次 request 只能来自不同 block 的顺序执行
- 下一轮补调用必须由用户手工触发

### 5. Stop contract 分为最低保证和理想实现

最低保证：

- `stopRequested` 后不得再发任何新的后续 request

理想实现：

- 若当前 request 所在链路支持 abort，则 controller 对当前 in-flight request 发出 abort

为了避免 UI 假象：

- 如果 abort 成功，run 进入 stopped，并记录 requestAborted
- 如果 abort 无法立即生效，则 UI 必须表达“停止已请求，等待当前请求结束”，而不是伪装成完全停止

### 6. Final run reason 必须显式化

run 收口时不能只有笼统 state，还必须表达 final reason，例如：

- `complete`
- `budget_exhausted`
- `stopped`
- `failed`

若 budget 用尽但仍有 missing targets：

- 不得标成 `failed`
- 应进入 non-failed 的 `partial / remaining / budget-exhausted` 一类语义

### 7. Initial / incremental 必须共用同一 scheduler path

这次 change 不允许：

- initial run 一套调度逻辑
- incremental run 再复制另一套

正确方式是：

- initial / incremental 先得到各自的 planner inputs
- 然后统一进入同一 controller scheduling path
- 共享 cap / pacing / stop / final reason 逻辑

## Risks / Trade-offs

- [Risk] 5 秒 pacing 会显著拉长单轮总耗时
  - Mitigation: 这是显式 contract，目标是可控和可停，不是极限吞吐

- [Risk] 关闭 automatic retry 后，短时 provider 波动时单轮成功率会下降
  - Mitigation: 用户明确要把失败留到下一次手工 run；本次 prioritise predictable scheduling over hidden retry

- [Risk] 如果 stop 只能阻止后续 block，当前 in-flight request 仍会跑完
  - Mitigation: 把 stop 语义分层表达清楚；若 abort 不可行，UI 和 diagnostics 必须诚实表述

- [Risk] 如果 cap 只在 UI 做，不在 controller 做，后台仍会超发
  - Mitigation: 明确 cap 属于 controller contract，不能只做前端展示

- [Risk] 若 initial / incremental 共用 scheduler 做得不彻底，后续会再次分叉
  - Mitigation: proposal / spec / tasks 都要求同一 scheduling path，避免双实现
