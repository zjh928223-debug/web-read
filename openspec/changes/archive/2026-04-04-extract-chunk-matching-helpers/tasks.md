## 1. 边界确认

- [x] 1.1 从 `processChunkData()` 中确认本次只迁出纯数据处理 helper，不包含 `chunkItems` 输出、segment 时间范围推导、fallback 组装或任何 UI/DOM 相关逻辑
- [x] 1.2 明确 `cleanText()`、`tokenizeText()`、`findExactMatch()`、`adjustIndex()` 与现有局部 helper 之间的命名映射和边界，避免扩大范围

## 2. 最小实现

- [x] 2.1 新增 `chunk-matching-helpers.js`，并通过 `window.ChunkMatchingHelpers` 暴露第一批文本处理与匹配 helper
- [x] 2.2 在 `app.js` 中以最小接线方式让 `processChunkData()` 调用新 helper，保留原入口、原控制流和原调用顺序
- [x] 2.3 在 `read-26.html` 中接入新 helper 文件，不改动现有 UI 结构、事件绑定或渲染逻辑

## 3. 最小验证

- [x] 3.1 验证 `app.js`、`chunk-matching-helpers.js` 语法和页面加载正常
- [x] 3.2 验证 transcript + `output.json` 导入后的 chunk 匹配结果、点词跳转链和现有渲染行为没有明显回归
