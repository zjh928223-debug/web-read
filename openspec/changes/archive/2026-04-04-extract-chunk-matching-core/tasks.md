## 1. 边界确认

- [x] 1.1 从 `processChunkData()` 中确认本次只迁出第二批纯匹配算法 helper，不包含 `chunkItems` 组装、fallback 主控制流或 segment 时间范围推导
- [x] 1.2 明确 exact phrase matching 变体、clamp、range、scoring、index correction 中哪些逻辑适合扩展到现有 `chunk-matching-helpers.js`

## 2. 最小实现

- [x] 2.1 在不扩大模块边界的前提下，提取第二批纯匹配算法 helper，并保持它们只依赖显式数据输入和输出
- [x] 2.2 在 `app.js` 中以最小接线方式让 `processChunkData()` 使用新 helper，保留原入口、原控制流和原调用顺序
- [x] 2.3 仅在确有需要时更新 `read-26.html` 的 helper 装配；如复用现有文件，则保持脚本装配不变

## 3. 最小验证

- [x] 3.1 验证 `app.js` 和相关 chunk matching helper 文件语法、页面加载正常
- [x] 3.2 验证 transcript + `output.json` 导入后的 chunk 匹配结果、点词跳转链和现有渲染行为没有明显回归
