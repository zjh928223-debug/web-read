## Context

当前 [buildChunkNoteLayout()](/E:/小新备份文件/开发项目/lunix/read-final/app.js) 里包含三层逻辑：

1. 环境适配层  
   包括 `sanitizeChunkNoteFontSize()`、`getChunkNoteMinReadableFontSize()`、`getChunkNoteLayoutContext()`、`ctx.font = ...` 等。
2. layout 搜索层  
   包括对 `preferredFs -> minFs` 的二分收敛过程。
3. layout result 计算层  
   包括在已知 `text`、`fontSize`、`lineHeight`、`lines`、`padX`、`padY`、`maxTextW`、`maxTextH` 的前提下，产出结构化 layout result。

前两层仍然强依赖 `app.js` 当前环境和调用链，而第三层更适合独立成纯 helper。本次 change 的目标就是只拆第三层，不碰前两层和任何外层应用逻辑。

## Goals / Non-Goals

**Goals:**
- 只提取 `buildChunkNoteLayout()` 中可参数化的 layout result 计算核心
- 保持 `buildChunkNoteLayout()` 作为 `app.js` 中的原入口函数
- 保持现有调用顺序、布局结果语义和用户可见行为不变
- 为后续如果继续拆 chunk note layout 搜索层，先建立一个更小的稳定边界

**Non-Goals:**
- 不修改 `ensureChunkNoteLayout()`
- 不修改 `measureChunkNoteTextBox()`
- 不提取 canvas/context 创建
- 不提取 CSS variable 读取
- 不修改 drag / resize / popover / connector / restore / theme
- 不做任何样式写回或用户可见行为调整

## Decisions

### Decision: 只抽 layout result 组装与判定核心，不抽 font 搜索或环境适配
这次只处理“输入已知，输出 layout object”的逻辑，例如：
- 根据 `lines` 与 `lineHeight` 计算 `totalH`
- 根据 `totalH` 与 `maxTextH` 计算 `fits`
- 根据 `padX/padY/maxTextW/maxTextH` 组装最终 result
- 处理空文本时的默认 result

不抽：
- `ctx.font` 设置
- `wrapChunkNoteTextForCanvas()` 的调用时机
- `preferredFs / minFs` 的推导
- 二分搜索流程

备选方案：
- 整个 `buildChunkNoteLayout()` 直接迁出  
  不选，因为它仍然绑定 canvas/context 和环境 helper。
- 顺手把 `canChunkNoteTextFitMinReadable()` 一起迁出  
  暂不选，因为它只是上层调用入口，保持本地包装更稳妥。

### Decision: 新 helper 返回 plain layout data
新 helper 只返回结构化 layout 数据对象，不接触 note、textEl、canvas 或 DOM。这样最符合“next safe split”的目标。

### Decision: 继续沿用 browser-global helper 模式
与前几个 safe split 保持一致，通过 `window.*` 暴露新 helper，不引入新的模块系统。

## Risks / Trade-offs

- [Risk] 如果 helper 边界划分不准，容易把 font 搜索或 canvas 适配一起迁出去  
  → Mitigation：在 tasks 中明确只迁出 layout result 计算核心，保留 `buildChunkNoteLayout()` 原入口和环境层。

- [Risk] chunk note 的 layout 结果非常敏感，轻微差异就会变成可见回归  
  → Mitigation：要求对相同输入产出等价 result，并实施最小布局冒烟验证。

- [Risk] 这次 change 太小，短期收益有限  
  → Mitigation：这是刻意的 safe split，目标是建立稳定边界，而不是一次性降低大量代码行数。

## Migration Plan

1. 锁定 `buildChunkNoteLayout()` 内部本次仅迁出的 layout result 计算核心  
2. 新增 very small helper 文件，并通过 `window.*` 暴露  
3. 在 `read-26.html` 中最小接线  
4. 在 `app.js` 中保留 `buildChunkNoteLayout()` 原入口，只把内部 result 计算委托给外部 helper  
5. 用语法检查、页面加载检查和最小 chunk note 布局验证确认行为未变

## Open Questions

- 本次是否把空文本默认 result 与普通文本 result 组装同时迁出，当前设计倾向是一起迁出，因为它们都属于 result 计算层。
- 下一步如果继续拆 chunk note layout，是否优先提取 font 搜索层，还是先处理 `measureChunkNoteTextBox()` 的纯尺寸修正核心，留给后续 change 决定。
