## Context

前两轮 `chunk-matching-*` safe split 已经把 `processChunkData()` 中最外层的文本清洗、exact phrase matching core、candidate normalization 和基础 scoring/helper 拆出了主文件，但 exact / range match 分支内部仍有一小层“候选整理”逻辑残留在 `processChunkData()` 中。这些逻辑本身不直接决定是否进入 fallback，也不直接写 `chunkItems`，更像是命中判定之前的参数规整、小范围比较和最佳候选选择前的数据准备。

当前约束很明确：

- 不能改 `processChunkData()` 原入口。
- 不能改 `if (exact) / else / fallback` 主骨架。
- 不能改 `globalWordCursor`、`chunkItems.push(...)`、`getSegTimeRange(...)` 或任何 UI/render 逻辑。
- 优先继续扩展现有 `chunk-matching-helpers.js`，避免再造第二个相近 helper 模块。

因此这次设计只针对“候选评分前后的小整理层”，不扩到命中主流程。

## Goals / Non-Goals

**Goals:**
- 继续把 `processChunkData()` 中仍可参数化的纯候选整理小算法迁移到 `chunk-matching-helpers.js`。
- 让这些 helper 只接收 plain data input/output，不读取共享状态、不写 DOM、不写 `chunkItems`。
- 保留 `processChunkData()` 的原控制流、原调用顺序和现有匹配行为。
- 让 exact / range match 分支在代码结构上更清楚：主流程负责“什么时候比较”，helper 负责“怎么整理候选”。

**Non-Goals:**
- 不修改 `chunkItems` 组装。
- 不修改 fallback 主控制流。
- 不修改 segment 时间范围推导。
- 不修改 `globalWordCursor` 推进。
- 不修改真正决定是否命中的主流程分支。
- 不修改 `renderChunkMode()`、DOM、事件、播放器或高亮逻辑。

## Decisions

### Decision: 继续扩展 `chunk-matching-helpers.js`
这次不新建第二个 chunk matching 文件，而是继续扩展现有 [chunk-matching-helpers.js](E:\小新备份文件\开发项目\lunix\read-final\chunk-matching-helpers.js)。

原因：
- 当前新增逻辑与已抽出的 `clamp`、`findExactMatchRange`、`scoreMatchCandidate` 属于同一层级。
- 如果为这一小层再拆一个新文件，会让边界更碎，反而增加装配成本。
- 当前仓库已经接受 “一个 runtime helper 文件承载一组同类纯算法” 的模式。

备选方案：
- 新建 `chunk-match-candidate-selection.js`
  - 放弃原因：这次范围太小，会导致模块粒度过细。

### Decision: 只提取“评分前后的候选整理”，不提取命中分支本身
可迁移对象应限于：

- exact / range match 过程中仍留在 `processChunkData()` 内的纯候选计算小段
- 候选评分前后的参数整理
- 小范围比较
- 最佳候选选择前的纯数据规整

必须留在 `app.js` 的部分包括：

- `if (exact) / else / fallback` 主骨架
- `best` 是否采用
- `best.score === 0` 时是否回退
- `finalStart/finalEnd` 的最终控制权

原因：
- 这些分支一旦迁出，就不再是 “helper”，而会开始接管主流程控制。
- 本次目标是继续缩短主流程中的纯计算噪音，而不是改变流程 ownership。

### Decision: 保留原局部命名或薄包装
接线方式仍采用“顶部 helper 解构 + `processChunkData()` 内局部名/薄包装”的模式。

原因：
- 能让调用顺序和阅读路径保持稳定。
- 能让 diff 保持很小。
- 便于后续继续把更多纯算法向同一 helper 边界迁移。

备选方案：
- 直接把 `processChunkData()` 中的局部代码块整体改写成外部函数调用链
  - 放弃原因：这会让本次 change 的表面积过大。

## Risks / Trade-offs

- [Risk] 候选整理逻辑和命中分支的边界可能不够清楚，稍不注意就会把主流程条件一起带走  
  → Mitigation：只迁出 plain data 整理 helper，所有 `if/else/fallback` 保持在 `processChunkData()` 内。

- [Risk] helper 名称如果过于抽象，后续会让调用点更难读  
  → Mitigation：优先采用与当前代码片段一一对应的命名，例如围绕 candidate/window/selection 语义命名。

- [Risk] 多轮 safe split 后，`chunk-matching-helpers.js` 会逐渐变大  
  → Mitigation：当前先接受“同类 helper 聚合”，等 `processChunkData()` 的纯算法层基本抽完后，再评估是否需要二次分组。

- [Risk] 虽然不改主流程，但候选规整顺序如果被轻微改动，仍可能引起匹配漂移  
  → Mitigation：保持原调用顺序，验证继续使用 transcript + `output.json` 的浏览器冒烟回归。

## Migration Plan

1. 在 `processChunkData()` 中确认这次剩余的候选整理片段，只标记纯数据输入输出段。
2. 把这些片段迁入现有 `chunk-matching-helpers.js`，不增加新的 script 文件。
3. 在 `app.js` 中做最小解构接线，保留原局部函数名或薄包装。
4. 通过 `node --check` 与现有页面加载检查确认无语法和装配回归。
5. 用 transcript + `output.json` 做最小 AI chunk 冒烟，确认匹配与点击跳转行为未漂移。

回滚策略保持最小化：
- 回滚 [chunk-matching-helpers.js](E:\小新备份文件\开发项目\lunix\read-final\chunk-matching-helpers.js)
- 回滚 [app.js](E:\小新备份文件\开发项目\lunix\read-final\app.js)
- 不需要迁移数据或 UI 结构

## Open Questions

- 这轮之后，`processChunkData()` 中剩余的“最佳候选选择”部分是否仍然足够小，可以继续留在主流程，还是会成为下一轮 safe split 的候选。
- 当前 `chunk-matching-helpers.js` 是否已经接近一个自然上限，还是还能继续承载 1-2 轮同层级 helper 扩展。
