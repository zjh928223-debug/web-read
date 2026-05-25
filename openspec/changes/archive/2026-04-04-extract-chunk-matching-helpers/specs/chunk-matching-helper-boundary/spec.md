## ADDED Requirements

### Requirement: Chunk matching helpers can be isolated from processChunkData
系统必须允许将 `processChunkData()` 内部的纯文本处理与匹配算法提取到独立 helper 模块中，并通过显式参数完成计算，而不改变 AI chunk 导入链的外部行为。

#### Scenario: Pure text helpers are moved out
- **WHEN** `cleanText()`、`tokenizeText()`、`findExactMatch()`、`adjustIndex()` 被迁移到独立 helper 文件
- **THEN** 这些 helper 必须只依赖显式输入参数工作
- **AND** 它们不得直接读写 DOM、渲染节点或播放状态

#### Scenario: processChunkData keeps control flow ownership
- **WHEN** `processChunkData()` 接入独立 helper
- **THEN** `processChunkData()` 仍然必须保留输入格式分支、fallback 顺序、cursor 推进和 `chunkItems` 组装的控制权
- **AND** `renderChunkMode()`、事件绑定和其他 UI 行为不得因这次抽离而发生 requirement 级变化

### Requirement: Chunk matching behavior remains compatible
系统在抽离 chunk matching helper 后，必须保持当前 `output.json` 兼容语义和现有 chunk 匹配结果语义不变。

#### Scenario: Existing output.json inputs remain accepted
- **WHEN** 用户继续导入现有支持的 `output.json` 数据
- **THEN** 系统必须继续接受相同输入形态
- **AND** 不得因为 helper 抽离而要求新的字段、不同索引语义或新的 UI 操作

#### Scenario: Matching order stays stable
- **WHEN** 系统执行文本标准化、分词、精确匹配和索引纠偏
- **THEN** helper 抽离后的调用顺序必须与原先等价
- **AND** exact match、anchor correction 和 fallback 之间的既有优先级不得被改变
