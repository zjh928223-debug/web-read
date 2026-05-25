## ADDED Requirements

### Requirement: Diagnostics record MUST persist run-level evidence per document scope

系统 MUST 为 annotation generation 的排查记录提供一份可持久化的 diagnostics record。该记录 MUST 按当前 `audioKey`、`documentId`、`scopeKey` 组织，并为每次全文生成或补生成分配稳定的 `runId`，使刷新后仍能查看同一篇文章的历史 run 证据。

#### Scenario: Refresh still shows prior diagnostics runs
- **WHEN** 用户对同一篇文章执行了一次或多次全文生成或补生成，并随后刷新页面
- **THEN** 系统 MUST 仍能按当前文章 `scopeKey` 读取到先前保存的 diagnostics run 记录
- **AND** 每条 run 记录 MUST 能区分本次 run 的 `runId`

### Requirement: Diagnostics MUST record runtime data-source evidence for empty-content investigation

系统 MUST 为“UI 显示已生成但前台内容为空”的问题记录 runtime data-source 证据，而不是只记录某个导出文件是否存在。记录 MUST 明确区分 provider output、generated bundle、generated index、click resolver 与 bubble/render consumption 各层的 item 数量或命中结果。

#### Scenario: Empty-content chain can be attributed by layer
- **WHEN** 前台点击注释项时看起来没有内容
- **THEN** diagnostics record MUST 能显示当前 scope 下 provider / bundle / index / click / bubble 各层的关键计数或命中结果
- **AND** diagnostics record MUST 支持区分“bundle 里没有内容”和“bundle 有内容但前台没消费到”

### Requirement: Diagnostics MUST record the role of annotation-full-export.json explicitly

系统 MUST 明确记录 `annotation-full-export.json` 在当前实现中的角色。diagnostics record MUST 标明当前前台运行时是否直接依赖该文件、该文件是否存在、以及它与前台空内容现象之间是否存在直接依赖关系。

#### Scenario: Export file relationship is observable instead of guessed
- **WHEN** 排查者查看某次前台空内容 run 的 diagnostics
- **THEN** diagnostics record MUST 能指出当前前台显示 annotation 内容时实际读取的运行时数据源
- **AND** diagnostics record MUST 能指出 `annotation-full-export.json` 是否只是导出文件、还是当前运行时实际依赖的数据源
