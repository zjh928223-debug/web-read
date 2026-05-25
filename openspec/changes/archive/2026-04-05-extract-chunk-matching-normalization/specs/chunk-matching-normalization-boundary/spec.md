## ADDED Requirements

### Requirement: Chunk matching normalization helpers can be isolated from processChunkData
系统必须允许将 `processChunkData()` 内部的纯匹配结果整理 helper 提取到独立 helper 边界中，并通过显式参数完成 candidate normalization、range/window 参数整理和 index correction 纯计算，而不改变 AI chunk 导入链的外部行为。

#### Scenario: Normalization helpers move out
- **WHEN** `processChunkData()` 中的 candidate normalization、range/window 参数整理或 index correction 纯计算段被提取到 helper 模块
- **THEN** 这些 helper 必须只依赖显式数据输入工作
- **AND** 它们不得直接写 `chunkItems`
- **AND** 它们不得直接读写 DOM、渲染节点或播放状态

#### Scenario: processChunkData keeps control flow ownership
- **WHEN** `processChunkData()` 接入 normalization helper
- **THEN** `processChunkData()` 仍然必须保留 fallback 主控制流、`globalWordCursor` 推进和 `chunkItems` 组装的控制权
- **AND** `renderChunkMode()`、事件绑定和其他 UI 行为不得因这次抽离而发生 requirement 级变化

### Requirement: Matching normalization stays behavior-compatible
系统在抽离 chunk matching normalization helper 后，必须保持当前 `output.json` 兼容语义、匹配顺序和现有 chunk 匹配行为不变。

#### Scenario: Existing output.json semantics stay compatible
- **WHEN** 用户继续导入现有支持的 `output.json`
- **THEN** 系统必须继续接受相同输入形态
- **AND** 不得因为 normalization helper 抽离而要求新的字段、不同索引语义或新的用户操作

#### Scenario: Matching flow remains equivalent
- **WHEN** 系统执行 candidate normalization、range/window 参数整理和 index correction 计算
- **THEN** helper 抽离后的调用顺序必须与原先等价
- **AND** exact match、anchor correction 和 fallback 之间的既有优先级不得被改变
