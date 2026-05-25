## ADDED Requirements

### Requirement: Incremental generation reuses the same occurrence-aware identity across diff, planning, and merge

系统 MUST 在 incremental generation 路径中复用与 unified target source、generated result store、click resolver 相同的稳定 occurrence-aware identity。diff、planner、controller merge 和 generated refresh MUST 使用同一套 identity 语义，而不是各自定义不同的匹配规则。

#### Scenario: Incremental helper and generated store agree on target identity
- **WHEN** 系统计算 missing targets 并准备生成
- **THEN** diff helper、planner、controller merge 和 generated result store MUST 以同一稳定 target identity 识别 target
- **AND** 系统 MUST NOT 在不同层分别发明不同的重复词匹配规则

### Requirement: Planner can operate on a target subset instead of whole-article targets

现有 planner MUST 能在保留 block 规则和 cap 规则的前提下，只围绕指定的 target 子集进行规划。对于 incremental generation，这个 target 子集 MUST 是 missing targets，而不是当前上下文中的全量 targets。

#### Scenario: Planner builds blocks only for missing targets
- **WHEN** controller 传入一个仅包含 missing targets 的 generation context 或等价过滤条件
- **THEN** planner MUST 只为这些 missing targets 建立 blocks
- **AND** planner MUST NOT 将已生成 targets 混入本次 block planning

### Requirement: Restore and immediate re-run use merged generated state consistently

系统 MUST 让 restore 后的 generated state 与刚完成 merge/refresh 后的 generated state 使用同一套增量判断语义。一次增量生成刚完成并完成 merge/refresh 后，重复点击生成 MUST NOT 继续把刚生成的 targets 误判为 missing。

#### Scenario: Immediate re-run after incremental completion is up to date
- **WHEN** 系统刚完成一次增量生成，并已将新增 items 合并入 generated bundle 且刷新 generated index
- **THEN** 用户立刻再次点击生成时，diff MUST 识别这些 targets 已经存在
- **AND** 系统 MUST 进入无缺口 no-op 结果，而不是再次请求 provider
