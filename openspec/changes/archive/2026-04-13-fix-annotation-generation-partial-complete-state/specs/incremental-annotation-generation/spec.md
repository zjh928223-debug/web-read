## ADDED Requirements

### Requirement: Incremental completion MUST stay non-complete while missing targets remain

incremental generation 在一次运行结束后 MUST 基于最终 generated bundle 与当前 target 集重新判断 missing targets。只要 `missingTargetsCount > 0`，system MUST NOT 把这次运行标记为 `complete`，即使本次 block request 没有报错。

#### Scenario: Partial supplement remains incomplete

- **WHEN** incremental generation 请求了若干 missing targets，但运行结束后当前 document scope 里仍存在 missing targets
- **THEN** controller MUST 返回一个明确的非完成结果语义
- **AND** system MUST 保持后续继续补生成的可能性

### Requirement: Incremental diagnostics MUST show whether missing targets remain after the run

incremental generation MUST 在 run 结束时继续暴露 `missingTargetsCount`，而不是只暴露 block completion 结果。这样 diagnostics 才能证明这次运行是否真的把缺口补齐。

#### Scenario: Post-run diff is visible in diagnostics

- **WHEN** 一次 incremental generation run 完成
- **THEN** diagnostics MUST 记录最终 `missingTargetsCount`
- **AND** diagnostics MUST 能让调用方区分“本次已补齐”与“本次仍未补齐”
