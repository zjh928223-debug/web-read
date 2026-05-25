## ADDED Requirements

### Requirement: Diagnostics events MUST be grouped by run and attempt

annotation generation chain diagnostics MUST 为每次全文生成和补生成建立 `runId`，并在 provider request 级别记录 attempt 序号。所有关键 diagnostics 事件 MUST 能按 `runId + scopeKey + blockId + attempt` 对齐，支持复盘一次 run 中的重复失败。

#### Scenario: Repeated API failures remain attributable to the same run
- **WHEN** 同一篇文章在一次生成过程中连续出现多次 API 失败
- **THEN** diagnostics 输出 MUST 为这些失败事件记录同一个 `runId`
- **AND** 每次 request 事件 MUST 记录独立的 attempt 序号

### Requirement: Diagnostics records MUST survive page reload for later comparison

annotation generation chain diagnostics MUST 不仅输出 console 事件，还 MUST 将本次 run 的关键诊断摘要写入持久化记录，便于刷新前后对比同一篇文章的问题演变。

#### Scenario: Reloaded page can compare before and after states
- **WHEN** 用户在一次失败较多的 generation run 后刷新页面
- **THEN** diagnostics 记录 MUST 仍可用于查看刷新前最后一次 run 的 request / merge / save / load / index 关键信息
- **AND** 排查者 MUST 能对比刷新前后的同一 `scopeKey`
