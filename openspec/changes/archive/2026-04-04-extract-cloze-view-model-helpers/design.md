## Context

当前 cloze 链路已经有一层基础 helper 边界：[cloze-utils.js](/E:/小新备份文件/开发项目/lunix/read-final/cloze-utils.js) 负责 `validateClozeData`、`normalizeClozeAnswer`、`escapeHtml`。但 [app.js](/E:/小新备份文件/开发项目/lunix/read-final/app.js) 中的 `setClozeData()` 与 `buildClozeQuizMarkup()` 仍混合了三类职责：

1. cloze answer state 的默认结构初始化  
2. card 状态、结果提示、meta 文案的条件分支  
3. section / card 级 view-model 组装

这部分逻辑不直接依赖 DOM 节点，也不直接属于播放器或高亮链，因此适合承接 `split-cloze-utils` 之后的第二个 very small safe split。

## Goals / Non-Goals

**Goals:**
- 仅提取 cloze / 数据加工 / view-model 相关的纯函数或近纯函数
- 让 `app.js` 继续保留 `buildClozeQuizMarkup()` 和 `handleClozeCheck()` 的外层行为与调用顺序
- 保持 cloze 显示文案、答题判定、render 时机和 DOM 结构完全不变
- 让后续如果继续拆 cloze 渲染时，有一个稳定的“数据准备层”边界

**Non-Goals:**
- 不提取 `handleClozeCheck()`
- 不提取 `buildClozeQuizMarkup()` 的 DOM / HTML 拼接壳层
- 不改 cloze 事件监听
- 不改播放器、高亮、chunk mode 渲染或任何其它模块

## Decisions

### Decision: 只抽 data/view-model helper，不抽最终 HTML 渲染壳
这次 change 的核心是 second safe split，因此不会把 `buildClozeQuizMarkup()` 整个函数搬走，而是只把它内部可参数化的数据逻辑提取出来，例如：
- 默认 `clozeAnswerState` 初始化 helper
- card 状态 class 计算 helper
- 结果文案 view-model helper
- card / quiz section view-model 组装 helper

这样可以把条件分支和数据准备搬出 `app.js`，同时避免碰 HTML 模板外壳和 DOM 插入点。

备选方案：
- 直接把 `buildClozeQuizMarkup()` 整个迁出  
  不选，因为它已经包含具体 HTML 输出，改动面比“只抽数据准备层”更大。
- 顺手把 `handleClozeCheck()` 也迁出  
  不选，因为它依赖 `transcriptContainer`、focus 恢复和 `renderChunkMode()`，已经越过 safe split 边界。

### Decision: 新 helper 继续沿用 browser-global 模式
为了保持与 `cloze-utils.js`、`playback-index-helpers.js` 一致，这次仍通过 `window.*` 暴露新 helper，而不引入新的模块系统或打包方式。

### Decision: `app.js` 保留原有外层函数与时序
`setClozeData()` 与 `buildClozeQuizMarkup()` 继续留在 `app.js`，只把内部的数据构建委托给外部 helper。这样可以最大程度保证：
- cloze 导入后按钮状态不变
- cloze 底部插入位置不变
- 检查答案后重渲染与 focus 恢复不变

## Risks / Trade-offs

- [Risk] cloze view-model helper 与现有 `cloze-utils.js` 的边界可能重叠  
  → Mitigation：明确本次只处理 answer state、status/result/meta、card/section 数据组装，不重复抽校验和基础字符串工具。

- [Risk] 如果 helper 命名过大，会变相把渲染层也迁出去  
  → Mitigation：要求 helper 输出 plain data 或局部结构，不直接接管 DOM 节点与事件。

- [Risk] cloze 当前 UI 文案已进入用户感知层，任何轻微改动都可能算回归  
  → Mitigation：把“文案和状态含义不变”写入 spec 和 tasks，并在实现后做最小页面加载与行为回归验证。

## Migration Plan

1. 识别并锁定本次迁出的 cloze data/view-model helper 名单  
2. 新增 very small helper 文件，并通过 `window.*` 暴露  
3. 在 `read-26.html` 中最小接线  
4. 在 `app.js` 中把相关数据加工改为调用外部 helper，但保留原外层函数和行为顺序  
5. 用现有页面检查和最小 cloze 交互验证确认行为未变

## Open Questions

- 本次是否只抽“plain view-model”，还是允许 helper 直接返回局部 HTML 片段？当前设计倾向前者，以保持风险最低。
- 下一步如果继续拆 cloze，是否应优先提取最终 markup builder，还是先补 cloze state helper 的单元验证入口，留给后续 change 决定。
