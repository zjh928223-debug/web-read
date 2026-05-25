## Why

`processChunkData()` 已经完成了前几轮最安全的文本清洗、exact match core 和 normalization helper 抽离，但 exact / range match 分支内部仍残留一批“候选整理”小算法，继续把这些纯数据处理逻辑留在主流程里，会让后续阅读和验证越来越困难。现在适合再做一轮 very small safe split，把评分前后的候选整理层继续从 `app.js` 中剥离出来，同时不触碰 `chunkItems` 组装、fallback 骨架和匹配主流程分支。

## What Changes

- 继续从 `processChunkData()` 中提取下一批纯匹配候选整理 helper，只处理 plain data input/output。
- 优先扩展现有 `chunk-matching-helpers.js`，不新增第二个 chunk matching 模块。
- 把 exact / range match 过程中仍留在 `processChunkData()` 内的候选参数整理、小范围比较、评分前后数据规整逻辑迁出为独立 helper。
- 保留 `processChunkData()` 原入口、原控制流、原调用顺序，以及 `output.json` 兼容语义和现有匹配行为不变。

## Capabilities

### New Capabilities
- `chunk-match-candidate-selection-boundary`: 约束 `processChunkData()` 内纯匹配候选整理 helper 可以独立于 `app.js` 存在，同时不得接管命中判定主流程、fallback 或 `chunkItems` 组装。

### Modified Capabilities

## Impact

- 主要影响 [app.js](E:\小新备份文件\开发项目\lunix\read-final\app.js) 中 `processChunkData()` 的候选整理局部逻辑。
- 主要复用并扩展 [chunk-matching-helpers.js](E:\小新备份文件\开发项目\lunix\read-final\chunk-matching-helpers.js)。
- 不应影响 [read-26.html](E:\小新备份文件\开发项目\lunix\read-final\read-26.html) 的 UI 结构、事件绑定或脚本装配。
- 不应改变 AI chunk 导入后的匹配顺序、`chunkItems` 输出语义、播放/高亮/渲染链。
