## 1. 锁定 third safe split 边界

- [x] 1.1 从 `app.js` 中确认本次只迁出 chunk note 的纯布局 / 测量 / 约束计算 helper，不包含 drag、resize、popover、connector、DOM 应用层和恢复逻辑
- [x] 1.2 识别哪些 helper 可以直接迁出，哪些 helper 需要先把 CSS variable、canvas 或 rect 读取留在 `app.js` 适配层

## 2. 最小实现

- [x] 2.1 新增独立 chunk note layout helper 文件，并沿用当前仓库的 `window.*` helper 模式
- [x] 2.2 从 `app.js` 中迁出第一批纯布局 / 测量 / 约束计算 helper，保持它们只依赖显式参数或可注入测量输入
- [x] 2.3 在 `read-26.html` 和 `app.js` 中做最小接线，保留 chunk note 的 DOM、交互和渲染应用层原地不动

## 3. 验证

- [x] 3.1 验证 `app.js` 和新 helper 文件语法、页面加载正常
- [x] 3.2 验证 chunk note 的尺寸计算、边界约束和现有可见行为没有明显回归
