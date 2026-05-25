## 1. 锁定 next safe split 边界

- [x] 1.1 从 `buildChunkNoteLayout()` 中确认本次只迁出 layout result 计算核心，不包含 canvas/context、CSS variable、font 搜索层或任何 DOM 相关逻辑
- [x] 1.2 识别哪些 result 组装逻辑可以直接迁出，哪些环境适配逻辑必须继续留在 `app.js`

## 2. 最小实现

- [x] 2.1 新增独立 chunk note layout core helper 文件，并沿用当前仓库的 `window.*` helper 模式
- [x] 2.2 从 `buildChunkNoteLayout()` 中迁出第一批 layout result 计算核心，保持它们只依赖显式参数并返回结构化 layout 数据
- [x] 2.3 在 `read-26.html` 和 `app.js` 中做最小接线，保留 `buildChunkNoteLayout()` 原入口和现有调用顺序

## 3. 验证

- [x] 3.1 验证 `app.js` 和新 helper 文件语法、页面加载正常
- [x] 3.2 验证 chunk note layout 结果与现有可见行为没有明显回归
