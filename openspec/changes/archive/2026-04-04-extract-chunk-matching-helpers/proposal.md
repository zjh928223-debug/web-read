## Why

`processChunkData()` 目前同时承担了输入格式适配、文本标准化、分词、精确匹配、索引纠偏、fallback 组装和 `chunkItems` 输出，导致纯数据处理逻辑与运行时组装逻辑混在一起。当前项目已经完成多轮 safe split，这一块是下一个最适合抽离的纯算法边界，因为它不依赖 DOM，也不应继续和 `app.js` 的 UI/交互链耦合。

## What Changes

- 从 `processChunkData()` 中识别并提取第一批纯数据处理 helper，只覆盖文本标准化、分词、精确匹配和索引纠偏
- 新增 `chunk-matching-helpers.js`，通过 `window.ChunkMatchingHelpers` 暴露 `cleanText()`、`tokenizeText()`、`findExactMatch()`、`adjustIndex()` 等 helper
- 在 `app.js` 中对 `processChunkData()` 做最小接线，保持原有调用顺序、fallback 路径和 `chunkItems` 组装逻辑不变
- 明确这次不处理 UI 渲染、DOM 更新、`renderChunkMode()`、事件绑定、播放/高亮逻辑，也不重写 `processChunkData()` 的整体控制流

## Capabilities

### New Capabilities
- `chunk-matching-helper-boundary`: 约束 `processChunkData()` 中的纯文本处理和匹配算法可以独立于 `app.js` 存在，同时保持现有 chunk 匹配行为不变

### Modified Capabilities
- 无

## Impact

- 直接影响 [app.js](/E:/小新备份文件/开发项目/lunix/read-final/app.js) 中 `processChunkData()` 的内部 helper 边界
- 新增 `chunk-matching-helpers.js` 并更新 [read-26.html](/E:/小新备份文件/开发项目/lunix/read-final/read-26.html) 的脚本装配顺序
- 间接影响 AI chunk 导入路径和 `output.json` 匹配结果，但本次 change 要求外部行为、输入兼容语义和现有渲染链保持不变
