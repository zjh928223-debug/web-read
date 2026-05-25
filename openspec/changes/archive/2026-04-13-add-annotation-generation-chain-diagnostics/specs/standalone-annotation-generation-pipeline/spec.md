## ADDED Requirements

### Requirement: Generation pipeline exposes block-level diagnostics for target, response, and merge counts
annotation generation pipeline MUST 在 block 粒度暴露可诊断计数，至少包括每个 block 的 `targetCount`、本次实际请求的 block 标识、provider `returnedCount`、merge 前 item 数量与 merge 后 item 数量。

#### Scenario: Block generation is observable end to end
- **WHEN** controller 针对某个 block 发起 annotation generation request
- **THEN** diagnostics 输出 MUST 记录该 block 的 `targetCount`
- **AND** diagnostics 输出 MUST 记录该 block 的 provider `returnedCount`
- **AND** diagnostics 输出 MUST 记录 merge 前后 generated item 数量变化

### Requirement: Generation pipeline diagnostics carries stable identity samples
annotation generation pipeline MUST 在 diagnostics 中暴露与当前链路一致的稳定 identity 样本，以便验证 diff、planner、merge 与后续消费使用的是同一套 identity 语义。

#### Scenario: Identity samples can be compared across pipeline stages
- **WHEN** 系统为某个 block 规划 targets、生成 annotation、并执行 merge
- **THEN** diagnostics 输出 MUST 至少包含该 block 对应的 `blockId`
- **AND** diagnostics 输出 MUST 提供可用于抽样比对的 `occurrenceKey`、target key 或等价稳定 identity 样本
- **AND** 不同阶段的 diagnostics 输出 MUST 能用这些字段对齐
