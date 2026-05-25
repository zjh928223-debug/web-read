## ADDED Requirements

### Requirement: Chunk match candidate selection helpers can be isolated from processChunkData
系统必须允许把 `processChunkData()` 内 exact / range match 过程中仍残留的纯候选整理 helper 提取到独立 helper 边界中，并通过显式参数完成候选参数整理、小范围比较和最佳候选选择前的数据规整，而不改变 AI chunk 导入链的外部行为。

#### Scenario: Candidate selection helpers move out
- **WHEN** `processChunkData()` 中的纯候选整理小算法被提取到 helper 模块
- **THEN** 这些 helper 必须只依赖显式的 plain data input/output
- **AND** 它们不得直接写入 `chunkItems`
- **AND** 它们不得直接接管 fallback 主控制流、segment 时间范围推导或 `globalWordCursor` 推进

#### Scenario: processChunkData keeps ownership of control flow
- **WHEN** `processChunkData()` 接入这批 candidate selection helper
- **THEN** `processChunkData()` 仍然必须保留 `if (exact) / else / fallback` 主骨架和原调用顺序
- **AND** 最终是否采用候选、是否回退到 fallback 的控制权必须继续留在 `processChunkData()` 内

### Requirement: Candidate selection extraction remains behavior-compatible
系统在抽离 chunk match candidate selection helper 后，必须保持当前 `output.json` 兼容语义、匹配顺序和现有 chunk 匹配行为不变。

#### Scenario: Existing output.json semantics stay compatible
- **WHEN** 用户继续导入现有支持的 `output.json`
- **THEN** 系统必须继续接受相同输入格式
- **AND** 不得因为 helper 抽离而要求新的字段、不同的索引语义或新的用户操作

#### Scenario: Matching behavior remains equivalent
- **WHEN** 系统执行 exact / range match 相关的候选参数整理、小范围比较和评分前后数据规整
- **THEN** helper 抽离后的调用结果必须与原先等价
- **AND** 现有 AI chunk 渲染、点词跳转和其他 UI 行为不得出现 requirement 级变化
