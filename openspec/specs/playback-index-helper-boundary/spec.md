# playback-index-helper-boundary Specification

## Purpose
TBD - created by archiving change extract-playback-index-helpers. Update Purpose after archive.
## Requirements
### Requirement: Playback index helper 必须可独立于 `app.js` 主行为链存在
系统 SHALL 允许 playback index / time mapping helper 作为独立辅助模块存在，只通过显式参数接收 `words`、`segments`、`chunkItems`、`wordStarts` 和 `time` 等运行时数据，不得依赖 DOM 或直接耦合到渲染行为。

#### Scenario: 查找当前词索引
- **WHEN** 上层逻辑需要根据当前时间查找激活词索引
- **THEN** helper 必须只根据显式传入的词起始时间、词列表和当前时间返回结果
- **THEN** helper 不得直接访问 DOM 或事件对象

#### Scenario: 查找当前句索引
- **WHEN** 上层逻辑需要根据当前时间计算所属句子
- **THEN** helper 必须只根据显式传入的 `segments`、`words`、`wordStarts` 和 `time` 返回结果
- **THEN** helper 的默认行为不得依赖 `audioPlayer.currentTime`

### Requirement: 抽离 playback index helper 不得改变现有播放和高亮行为
系统在把 playback index / time mapping helper 从 `app.js` 中抽离时 MUST 保持现有播放、高亮、导航和 seek 行为不变。`app.js` 只允许做最小接线，不得顺带修改上层业务逻辑。

#### Scenario: 保持现有调用顺序
- **WHEN** `app.js` 接入外部 playback index helper
- **THEN** 原有播放高亮链和导航链的调用顺序必须保持不变
- **THEN** 不得在同一 change 中修改 `mainUpdateHighlight`、RAF 循环或事件监听

#### Scenario: 保持现有页面行为
- **WHEN** 页面加载并执行现有阅读器流程
- **THEN** transcript、AI chunk 和播放索引相关行为必须继续可用
- **THEN** 不得因为 helper 抽离导致页面加载报错或核心交互失效

