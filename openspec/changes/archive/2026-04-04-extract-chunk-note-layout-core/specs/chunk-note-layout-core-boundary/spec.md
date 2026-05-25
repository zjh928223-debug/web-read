## ADDED Requirements

### Requirement: Chunk note layout result core can be extracted without behavior change
系统 MUST 允许将 `buildChunkNoteLayout()` 内部的 layout result 计算核心从 `app.js` 中提取到独立模块，只要该核心只处理纯计算或近纯计算逻辑，并继续由 `app.js` 保留外层入口与调用顺序。

#### Scenario: Extract only layout result core
- **WHEN** 实施 `extract-chunk-note-layout-core`
- **THEN** 被迁出的逻辑 MUST 仅根据已给定的文本、fontSize、lineHeight、padding、maxTextW、maxTextH、lines 等输入计算结构化 layout 数据
- **THEN** `buildChunkNoteLayout()` 的原入口函数 MUST 继续留在 `app.js`

### Requirement: Chunk note layout environment and behavior remain unchanged
在提取 `buildChunkNoteLayout()` 的 layout result 计算核心之后，系统 MUST 保持现有环境依赖层、布局语义和用户可见行为不变。

#### Scenario: Environment-dependent logic stays in app.js
- **WHEN** `buildChunkNoteLayout()` 接入外部 layout core helper
- **THEN** `ensureChunkNoteLayout()`、`measureChunkNoteTextBox()`、canvas/context 创建、CSS variable 读取和任何 DOM 读写 MUST 继续留在 `app.js`

#### Scenario: Layout result stays compatible
- **WHEN** chunk note 使用相同输入执行 layout 计算
- **THEN** 提取后的实现 MUST 产出与提取前等价的 layout result 数据
- **THEN** 不得因为 helper 抽离导致任何明显的 chunk note 可见行为回归
