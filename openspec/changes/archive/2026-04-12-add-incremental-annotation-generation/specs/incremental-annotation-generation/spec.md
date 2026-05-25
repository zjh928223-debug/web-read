## ADDED Requirements

### Requirement: Incremental target diff uses stable target identity

系统 MUST 在当前 document scope 下，对 unified target source 与已生成 annotation 集做差集计算。差集计算 MUST 以稳定 target identity 为主键，MUST NOT 只按 `markedText`、`boundary` 或其他纯文本字段判断 target 是否已经生成。

#### Scenario: Repeated word occurrences stay distinguishable during diff
- **WHEN** 同一个单词在同一文档中出现多次，且每个 occurrence 都有各自的 unified target identity
- **THEN** 系统 MUST 按各自的稳定 target identity 分别判断是否已生成
- **AND** 系统 MUST NOT 因为文本相同就把不同 occurrence 误判为同一个已生成 target

#### Scenario: Diff reads latest generated state from current document scope
- **WHEN** 系统准备执行 annotation generation
- **THEN** 系统 MUST 读取当前 document scope 下最新的 generated bundle 作为差集计算基线
- **AND** 差集结果 MUST 至少包含 `allTargetsCount`、`generatedTargetsCount` 和 `missingTargets`

### Requirement: No missing targets produces a no-request no-op result

当当前 document scope 下的所有 targets 都已有 generated annotation 时，系统 MUST 返回一个与普通 complete 可区分的 no-op 结果，并 MUST NOT 发起任何 provider request。

#### Scenario: Re-click generation after everything is already generated
- **WHEN** 用户再次点击“生成全文注释”，且当前 targets 与 generated bundle 比对后 `missingTargets = 0`
- **THEN** 系统 MUST 不调用 provider request
- **AND** 系统 MUST 返回 `up-to-date`、`no-missing-targets` 或等价的 no-op 终态
- **AND** 该终态 MUST 与普通 complete 区分开

### Requirement: Only missing targets enter generation planning and requests

当存在缺口时，系统 MUST 只让 missing targets 进入 generation planning 和 provider request。系统 MUST NOT 因为实现简单而把整篇 targets 再次整量送入 planner 或 provider。

#### Scenario: Newly added marks trigger only incremental generation
- **WHEN** 用户在首次生成后又新增少量 marks，并再次点击生成
- **THEN** 系统 MUST 只把这些新增且尚未生成的 missing targets 送入 planner
- **AND** 已有 generated annotation 的 targets MUST NOT 再次进入 provider request

### Requirement: Request count stays minimal under existing block caps

系统 MUST 在不违反现有 block cap 规则的前提下，尽量减少 provider request 次数。少量 missing targets SHOULD 尽量收敛成最少 blocks；缺口较大时，再按现有 caps 拆分。

#### Scenario: Few missing targets fit into one request
- **WHEN** 当前 missing targets 数量较少，且在现有 block cap 下可归入一个 block
- **THEN** 系统 MUST 只发起一次 provider request

#### Scenario: Many missing targets split by existing caps
- **WHEN** 当前 missing targets 数量超过现有单 block cap
- **THEN** 系统 MUST 按现有 caps 拆分为最少必要 block 数
- **AND** 系统 MUST NOT 回退为整篇重跑

### Requirement: Incremental merge supplements existing bundle without silent replacement

增量生成回写 MUST 以补缺为默认目标。系统 MUST 将新生成 items 合并进现有 generated bundle，同时保持旧 items 不丢失；若同一 target identity 已存在旧 item，系统 MUST NOT 默认重复插入或静默覆盖。

#### Scenario: Incremental run preserves old items and adds new ones
- **WHEN** 系统完成一次仅针对 missing targets 的增量生成
- **THEN** 回写后的 generated bundle MUST 同时保留旧 items 和本次新增 items
- **AND** 新增 items MUST 能被 restore、index 和 click consumption 继续正常使用

#### Scenario: Existing target identity is not duplicated
- **WHEN** 本次增量结果中出现一个 target identity 已经在旧 bundle 中存在
- **THEN** 系统 MUST NOT 默认插入重复 item
- **AND** 系统 MUST NOT 默认以新结果覆盖旧结果
