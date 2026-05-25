# chunk-note-layout-helper-boundary Specification

## Purpose
TBD - created by archiving change extract-chunk-note-layout-helpers. Update Purpose after archive.
## Requirements
### Requirement: Chunk note layout helpers can be extracted without behavior change
系统 MUST 允许将 chunk note 的布局 / 测量 / 约束计算 helper 从 `app.js` 中提取到独立模块，只要这些 helper 不接管 DOM 读写、事件处理、恢复逻辑、主题切换联动或视觉样式调整。

#### Scenario: Extract only layout computation helpers
- **WHEN** 实施 `extract-chunk-note-layout-helpers`
- **THEN** 被迁出的逻辑 MUST 仅处理尺寸计算、位置约束、布局修正值推导、文本包装或其他可参数化的计算逻辑
- **THEN** drag、resize、popover、connector、元素创建与更新、恢复逻辑和主题切换联动 MUST 继续留在 `app.js`

### Requirement: Chunk note visual and interaction contract remains unchanged
在提取 chunk note layout helper 之后，系统 MUST 保持现有 chunk note 的尺寸结果、位置约束语义和用户可见行为不变。

#### Scenario: Layout result stays compatible
- **WHEN** chunk note 根据相同输入参数计算宽高、布局或边界约束结果
- **THEN** 提取后的 helper MUST 产出与提取前等价的尺寸、位置或布局修正结果

#### Scenario: Visible chunk note behavior stays compatible
- **WHEN** 页面加载并执行现有 chunk note 渲染与交互流程
- **THEN** 用户可见的 note 尺寸、位置、布局与交互行为 MUST 保持兼容
- **THEN** 不得因为 helper 抽离导致 chunk note 无法渲染、无法约束在边界内或出现明显位置回归

