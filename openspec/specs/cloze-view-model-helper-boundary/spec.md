# cloze-view-model-helper-boundary Specification

## Purpose
TBD - created by archiving change extract-cloze-view-model-helpers. Update Purpose after archive.
## Requirements
### Requirement: Cloze view-model helpers can be extracted without behavior change
系统 MUST 允许将 cloze 相关的数据加工与 view-model helper 从 `app.js` 中提取到独立模块，只要这些 helper 不接管 DOM 渲染、事件监听、播放器逻辑或高亮逻辑。

#### Scenario: Extract only cloze data/view-model helpers
- **WHEN** 实施 `extract-cloze-view-model-helpers`
- **THEN** 被迁出的函数 MUST 仅处理 cloze 数据加工、文本标准化复用、answer state 初始化、状态推导或 card / section view-model 组装
- **THEN** `buildClozeQuizMarkup()` 和 `handleClozeCheck()` 的外层行为 MUST 继续由 `app.js` 持有

### Requirement: Cloze rendering contract remains unchanged
在提取 cloze view-model helper 之后，系统 MUST 保持现有 cloze UI 的展示结构、答题判定和结果文案含义不变。

#### Scenario: Cloze card rendering stays compatible
- **WHEN** 页面在 AI 切分模式下渲染 cloze 题目
- **THEN** 题目卡片数量、状态 class 语义、题干、答案输入值、标准答案和 reasoning 的展示含义 MUST 与提取前一致
- **THEN** `output.cloze.json` 的输入 schema MUST 保持不变

#### Scenario: Cloze answer checking flow stays compatible
- **WHEN** 用户输入答案并触发检查
- **THEN** 系统 MUST 继续使用现有答案归一化规则比较用户输入与 `targetWord`
- **THEN** 检查后仍 MUST 按现有时序重渲染 cloze 区并恢复输入焦点

