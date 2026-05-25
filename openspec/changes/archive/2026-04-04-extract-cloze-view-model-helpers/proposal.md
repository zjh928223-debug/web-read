## Why

`split-cloze-utils` 已经把 cloze 的基础校验与字符串工具从 `app.js` 抽出，但 `app.js` 里仍然混着 cloze answer state 初始化、结果文案分支、card 级结构组装和 section 级 view-model 拼装。现在继续做第二个 very small safe split，可以在不碰 DOM 渲染、事件监听、播放器和高亮逻辑的前提下，进一步缩小 `app.js` 中 cloze 逻辑块的体积与职责。

## What Changes

- 从 `app.js` 中提取第二批 cloze 相关纯函数或近纯函数，范围限制在 cloze 数据加工、answer state 初始化、结果状态推导、card / section view-model 组装。
- 保持 `buildClozeQuizMarkup`、`handleClozeCheck`、DOM 插入、事件绑定与渲染时机仍留在 `app.js`。
- 继续沿用当前仓库的 `window.*` helper 模式，让 `app.js` 只做最小接线。
- 不修改 cloze JSON 结构、不修改题目展示文案含义、不修改答题行为。

## Capabilities

### New Capabilities
- `cloze-view-model-helper-boundary`: 约束 cloze 的 view-model / 数据加工 helper 可以独立成模块，同时保持现有 cloze 展示和答题行为不变。

### Modified Capabilities
- None.

## Impact

- 主要影响 [app.js](/E:/小新备份文件/开发项目/lunix/read-final/app.js) 中的 cloze 数据准备逻辑。
- 会新增一个 very small helper 模块文件，并在 [read-26.html](/E:/小新备份文件/开发项目/lunix/read-final/read-26.html) 中做最小脚本接线。
- 不涉及播放器、高亮、chunk 渲染、事件监听、DOM 结构和持久化协议变更。
