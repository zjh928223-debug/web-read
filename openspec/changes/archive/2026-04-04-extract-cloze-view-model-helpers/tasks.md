## 1. 锁定 second safe split 边界

- [x] 1.1 从 `app.js` 中确认本次只迁出 cloze 数据加工 / view-model helper，不包含 `handleClozeCheck()`、DOM 插入、事件绑定和播放器 / 高亮逻辑
- [x] 1.2 明确与 `cloze-utils.js` 的边界，避免重复迁出 `validateClozeData`、`normalizeClozeAnswer`、`escapeHtml`

## 2. 最小实现

- [x] 2.1 新增独立 cloze view-model helper 文件，并沿用当前仓库的 `window.*` helper 模式
- [x] 2.2 从 `app.js` 中迁出第一批 cloze answer state / result status / card 或 section view-model helper，保持它们只依赖显式参数
- [x] 2.3 在 `read-26.html` 和 `app.js` 中做最小接线，保留 `buildClozeQuizMarkup()`、`handleClozeCheck()` 和现有渲染时序

## 3. 验证

- [x] 3.1 验证 `app.js` 语法和页面加载正常
- [x] 3.2 验证 cloze 题目渲染、答案检查、标准答案和 reasoning 展示行为没有明显回归
