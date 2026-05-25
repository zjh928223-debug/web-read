## ADDED Requirements

### Requirement: Generated annotation consumption diagnostics MUST expose bundle, index, and click hit/miss state

generated annotation click consumption 链路 MUST 在当前 scope 下记录 generated bundle itemCount、generated index itemCount、click hit/miss 结果与 bubble consumption 输入，以支持排查“前台显示无内容”到底发生在 bundle、index、resolver 还是 bubble/render。

#### Scenario: Empty click result can be traced past the resolver boundary
- **WHEN** 用户点击一个看起来应有 annotation 的词项，但前台没有显示有效内容
- **THEN** diagnostics MUST 显示当前 scope 下 generated bundle itemCount
- **AND** diagnostics MUST 显示 generated index itemCount、resolver hit/miss 结果与 bubble 输入摘要

### Requirement: Runtime consumption diagnostics MUST identify the active runtime data source

generated annotation consumption 链路 MUST 明确记录前台运行时消费的实际数据源位置，例如 generated bundle、generated index 或其他 runtime source，并记录该链路是否直接依赖 `annotation-full-export.json`。

#### Scenario: Frontend runtime source is visible during empty-content investigation
- **WHEN** 排查者查看一次前台空内容问题的 diagnostics
- **THEN** diagnostics MUST 能指出前台实际消费的是哪一份 runtime data source
- **AND** diagnostics MUST 能指出 `annotation-full-export.json` 是否参与当前 click / bubble consumption 链路
