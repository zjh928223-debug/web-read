## Why

当前阅读器已有点击单词跳转音频、词汇/标注匹配以及一些历史侧栏式说明 UI，但这些说明逻辑分散在 `app.js` 和页面流里，不适合继续叠加新的释义展示体验。现在需要新增一个边界清晰的 fixed annotation bubble，让用户在不打断阅读、不改写文章正文、不改变点词跳音频行为的前提下，查看当前点击的已标注词解释。

## What Changes

- 新增一个 standalone annotation bubble module，负责浮窗 DOM、显示/隐藏、拖拽、resize、固定屏幕位置和内容渲染。
- 新增一个最小 integration wiring，让现有 word click flow 在保持音频跳转不变的同时，把“点击到的已标注词”通知给 annotation bubble。
- 新增一个 custom hotkey 入口，用来显示/隐藏 annotation bubble。
- bubble 只显示当前点击的已标注词；新的已标注点击必须替换旧内容，不做历史列表。
- bubble 隐藏时，点击文本必须保持现状，且不得弹出说明 UI。
- 初版内容字段为：`标注内容`、`边界`、`类型`、`意思`、`要记`。
- 不在正文内渲染 `[]` 边界标记，不新增右侧解释栏，不新增文章内说明卡片。

## Capabilities

### New Capabilities
- `standalone-annotation-bubble`: 提供一个可通过热键显示/隐藏、可拖拽、可 resize、fixed-position 的独立 annotation bubble，并在点击已标注词时展示当前词的 annotation 数据。

### Modified Capabilities

## Impact

- 预计新增独立 JS 模块，例如 `annotation-bubble.js`，用于拥有 bubble UI、状态、拖拽/resize 和内容渲染。
- 预计新增独立 CSS 区块或样式文件；若改 `styles.css`，必须保持 annotation bubble 样式集中在命名清晰的独立区块。
- 预计最小修改 `read-26.html`，只负责装配 script 或提供一个轻量挂载点。
- 预计最小修改 `app.js`，只用于 hotkey / click wiring / annotation resolver 接入，不把 bubble 行为散落进渲染、播放、chunk、sentence note 或 chunk note 主流程。
- 不应改变现有点击单词后的 `audioPlayer.currentTime`、`forceUpdateUI(...)`、播放高亮、标记、chunk note 或 sentence note 行为。
