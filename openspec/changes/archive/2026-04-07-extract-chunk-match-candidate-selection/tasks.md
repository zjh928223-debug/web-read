## 1. 边界确认

- [x] 1.1 从 `processChunkData()` 中确认本次只迁出纯匹配候选整理 helper，不包含 `chunkItems` 组装、fallback 主控制流、segment 时间范围推导或 `globalWordCursor` 推进
- [x] 1.2 识别 exact / range match 过程中仍留在 `processChunkData()` 内的纯候选计算小段，并确认哪些逻辑适合继续扩展到现有 `chunk-matching-helpers.js`

## 2. 最小实现

- [x] 2.1 在不扩大模块边界的前提下，把候选评分前后的参数整理、小范围比较和最佳候选选择前的数据规整 helper 迁入现有 `chunk-matching-helpers.js`
- [x] 2.2 在 `app.js` 中以最小接线方式让 `processChunkData()` 使用新 helper，保留原入口、原控制流、原调用顺序以及局部命名或薄包装
- [x] 2.3 保持 `read-26.html` 脚本装配不变，除非确有必要才调整 helper 暴露或装配顺序

## 3. 最小验证

- [x] 3.1 验证 `app.js` 和 `chunk-matching-helpers.js` 语法、页面加载与 helper 装配正常
- [x] 3.2 验证 transcript + `output.json` 导入后的 AI chunk 匹配结果、点词跳转链和现有渲染行为没有明显回归
