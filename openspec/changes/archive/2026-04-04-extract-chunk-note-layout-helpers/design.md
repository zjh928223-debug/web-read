## Context

当前 chunk note 子系统在 [app.js](/E:/小新备份文件/开发项目/lunix/read-final/app.js) 开头附近已经形成一整段 data/layout utilities，但其中仍然混杂了两类内容：

1. 适合独立成 helper 的布局/测量/约束计算逻辑  
   例如文本框宽高测量、font size 约束、行包装、截断、布局有效性判断、边界位置修正。
2. 明显不适合现在迁出的高风险逻辑  
   例如 `ensureChunkNoteLayout()`、`scheduleChunkNoteLayoutRefresh()`、`spawnChunkNoteTag()`、drag / resize / popover / connector / restore 流程。

这次 change 的目标不是整理整个 chunk note 子系统，而是只为后续更深的 chunk note 重构建立一个稳定的“layout computation boundary”。

## Goals / Non-Goals

**Goals:**
- 只提取 chunk note 的纯布局 / 测量 / 约束计算 helper
- 让这些 helper 尽量只依赖显式参数和可注入的测量输入
- 保持 `app.js` 现有外层调用顺序、DOM 结构和交互时序不变
- 为后续 chunk note 子系统继续拆分建立一个低风险边界

**Non-Goals:**
- 不拆 drag 事件
- 不拆 resize 事件
- 不拆 popover
- 不拆 connector
- 不拆元素创建、挂载、更新
- 不拆 chunk note 恢复逻辑
- 不拆主题切换联动
- 不做视觉样式调整

## Decisions

### Decision: 只抽“计算层”，不抽“应用层”
这次只迁出尺寸计算、位置约束、布局修正和文本包装相关 helper，不迁出真正把结果写回 note 或写回 DOM 的流程函数。

备选方案：
- 直接抽 `ensureChunkNoteLayout()`  
  不选，因为它已经开始读 `sourceRect`、读 tag rect、写 note 坐标，属于应用层。
- 顺手抽 `spawnChunkNoteTag()` 或 `renderAllChunkNoteTags()`  
  不选，因为这会立即碰 DOM 创建、connector、hover 和交互链。

### Decision: 优先处理“输入明确、输出稳定”的 helper
优先候选包括：
- `sanitizeChunkNoteFontSize`
- `getChunkNoteWrapTokens`
- `splitTokenToFitWidth`
- `wrapChunkNoteTextForCanvas`
- `truncateCanvasLine`
- `buildChunkNoteLayout`
- 可参数化后的尺寸/边界修正 helper

如果某个函数必须直接读取 `document.documentElement` 的 CSS variable 或创建 canvas 才能工作，则本次设计倾向于把“读取环境值”和“纯计算”拆开，只抽后者。

### Decision: 继续沿用 browser-global helper 模式
为了保持与 `cloze-utils.js`、`playback-index-helpers.js`、`cloze-view-model-helpers.js` 一致，这次仍通过 `window.*` 暴露新 helper，而不引入新的模块系统。

### Decision: `app.js` 只保留薄适配层
`app.js` 可以继续保留从 CSS variable / canvas / rect 中收集输入的逻辑，但具体布局计算会委托给外部 helper。这样可以最大程度降低对 chunk note 现有行为的影响。

## Risks / Trade-offs

- [Risk] 部分“看起来像纯 helper”的函数其实隐式依赖 canvas 或 CSS variable  
  → Mitigation：把环境读取留在 `app.js`，只迁出真正的纯计算函数；必要时把依赖项显式参数化。

- [Risk] chunk note 对布局结果非常敏感，任何轻微偏差都会表现为位置或尺寸回归  
  → Mitigation：这次只做 first layout split，不改默认参数、不改外层应用逻辑，并要求最小视觉/行为验证。

- [Risk] 如果把边界划得太大，会误伤 connector、hover、restore 或 theme toggle  
  → Mitigation：把“不在范围内”的子系统明确写入 proposal/spec/tasks，并在实施时禁止顺手扩展。

## Migration Plan

1. 锁定本次只迁出的 chunk note 布局/测量/约束计算 helper 名单  
2. 新增 very small helper 文件，并通过 `window.*` 暴露  
3. 在 `read-26.html` 中最小接线  
4. 在 `app.js` 中把对应计算逻辑改为调用外部 helper，但保留 DOM 和交互应用层  
5. 用现有语法检查、页面加载检查和最小 chunk note 布局回归验证确认行为未变

## Open Questions

- 这次是否包含 `measureChunkNoteTextBox()` 这类仍会读取 CSS 变量的函数，还是只先抽它内部更纯的部分，留到 apply 阶段根据实际依赖再收紧。
- `buildChunkNoteLayout()` 是否应整体迁出，还是先拆成“纯布局计算核心 + app.js 适配层”，留给实施时根据实际复杂度决定。
