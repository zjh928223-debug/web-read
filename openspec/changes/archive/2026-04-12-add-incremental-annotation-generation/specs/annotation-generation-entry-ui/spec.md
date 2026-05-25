## ADDED Requirements

### Requirement: Entry status distinguishes no-op from actual generation

page-level annotation generation entry/status MUST 能区分“本次没有缺口，因此未发 provider request”和“本次实际执行了补生成”。系统 MUST NOT 把无缺口 no-op 结果混同为普通 complete，也 MUST NOT 把它误显示为 failed。

#### Scenario: No missing targets are shown honestly
- **WHEN** 用户点击“生成全文注释”，且当前 document scope 下没有 missing targets
- **THEN** status/progress area MUST 明确显示本次无需生成、已是最新或等价语义
- **AND** status/progress area MUST 表达本次未发 provider request
- **AND** 该结果 MUST 与普通 complete 状态区分开

### Requirement: Incremental completion communicates supplemented work

当本次 generation 只补生成部分 missing targets 时，page-level entry/status MUST 以最小但明确的方式表达这是一次补生成，而不是重新生成整篇。

#### Scenario: Entry reports incremental completion
- **WHEN** 用户点击“生成全文注释”，系统检测到存在 missing targets，并成功只补生成其中一部分或全部
- **THEN** status/progress area MUST 以页面级文案表达这是一次补生成
- **AND** 文案 SHOULD 能让用户理解本次补生成了若干项，而不是整篇重跑

### Requirement: Current target set defines what counts as missing

entry 触发 incremental generation 时，系统 MUST 只以当前 unified target source 中仍存在的 targets 作为 diff 输入。已经被取消标记、不再属于当前 target 集的内容 MUST NOT 继续被视为 missing target。

#### Scenario: Removed mark no longer participates in missing-target evaluation
- **WHEN** 用户移除了某个 mark，使其不再属于当前 unified target source
- **THEN** 再次点击“生成全文注释”时，该 target MUST NOT 被计入当前 missing targets
- **AND** status/progress area MUST 仅基于当前 target 集的 diff 结果表达本次状态
