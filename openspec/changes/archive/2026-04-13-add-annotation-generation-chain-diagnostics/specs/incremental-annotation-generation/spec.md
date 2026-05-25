## ADDED Requirements

### Requirement: Incremental diff and merge emit diagnostics against the current generated baseline
incremental generation MUST 在 diagnostics 中明确记录当前 document scope 下的 diff 基线、`allTargetsCount`、`generatedTargetsCount`、`missingTargetsCount` 与本次实际进入 planner 的 target 子集。

#### Scenario: Incremental run shows what was considered missing
- **WHEN** 用户点击“生成全文注释”并触发一次增量判断
- **THEN** diagnostics 输出 MUST 记录当前 document scope 的 diff 基线来源
- **AND** diagnostics 输出 MUST 记录 `allTargetsCount`、`generatedTargetsCount` 与 `missingTargetsCount`
- **AND** diagnostics 输出 MUST 记录本次实际送入 planner 的 target 子集或其计数

### Requirement: Incremental merge diagnostics proves whether new items were persisted or skipped
incremental generation MUST 在 merge 和回写阶段记录新结果是被追加、跳过、还是因 identity 冲突未写入，以支持排查“增量后仍缺项”问题。

#### Scenario: Incremental merge reveals duplicate-skip behavior
- **WHEN** 本次增量结果中存在与旧 bundle 同 identity 的 item
- **THEN** diagnostics 输出 MUST 记录该 item 是被追加还是被跳过
- **AND** diagnostics 输出 MUST 能区分“provider 没返回”与“provider 返回了但 merge 没写入”

### Requirement: Incremental request count diagnostics shows whether no-op really avoided provider requests
incremental generation MUST 在 diagnostics 中记录本次是否真正发起了 provider request，以及请求次数是否符合“无缺口不请求、少量缺口尽量少请求”的预期。

#### Scenario: No missing targets produces zero request diagnostics
- **WHEN** 当前 document scope 下 `missingTargets = 0`
- **THEN** diagnostics 输出 MUST 明确记录本次未发 provider request
- **AND** diagnostics 输出 MUST 将该结果与实际补生成区分开
