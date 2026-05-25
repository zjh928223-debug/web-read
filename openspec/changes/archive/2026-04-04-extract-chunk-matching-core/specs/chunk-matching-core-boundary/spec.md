## ADDED Requirements

### Requirement: Chunk matching core helpers can be isolated from processChunkData
系统必须允许将 `processChunkData()` 内部第二批纯匹配算法 helper 提取到独立 helper 边界中，并通过显式参数完成 exact phrase matching、range、clamp、scoring 与 index correction 的计算，而不改变 AI chunk 导入链的外部行为。

#### Scenario: Matching core helpers move out
- **WHEN** exact phrase matching 的 range / fromIndex 变体统一到独立 helper
- **THEN** 这些 helper 必须只依赖显式数据输入工作
- **AND** 它们不得直接产出 `chunkItems`
- **AND** 它们不得直接读写 DOM、渲染节点或播放状态

#### Scenario: processChunkData keeps ownership of control flow
- **WHEN** `processChunkData()` 接入第二批匹配 core helper
- **THEN** `processChunkData()` 仍然必须保留输入格式分支、fallback 主控制流、cursor 推进和 `chunkItems` 组装的控制权
- **AND** `renderChunkMode()`、事件绑定和其他 UI 行为不得因这次抽离而发生 requirement 级变化

### Requirement: Matching semantics remain stable after core extraction
系统在抽离第二批匹配 core helper 后，必须保持当前 `output.json` 兼容语义、exact match 顺序、anchor correction 顺序和现有 chunk 匹配行为不变。

#### Scenario: Existing output.json semantics stay compatible
- **WHEN** 用户继续导入现有支持的 `output.json`
- **THEN** 系统必须继续接受相同输入形态
- **AND** 不得因为第二批 helper 抽离而要求新的字段、不同索引语义或新的用户操作

#### Scenario: Matching order remains equivalent
- **WHEN** 系统执行 exact phrase matching、局部/全局查找、range 约束、candidate scoring 和 index correction
- **THEN** helper 抽离后的调用顺序必须与原先等价
- **AND** exact match、anchor correction 和 fallback 之间的既有优先级不得被改变
