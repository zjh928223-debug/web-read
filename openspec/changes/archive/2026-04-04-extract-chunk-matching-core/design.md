## Context

上一轮 `extract-chunk-matching-helpers` 已经把 `cleanText()`、`tokenizeText()`、`findExactMatch()`、`adjustIndex()` 这一层抽离出来，但 `processChunkData()` 中仍然保留一层更靠近匹配核心的纯算法组合逻辑。例如：

- exact phrase matching 的局部 / 全局变体仍由 `processChunkData()` 通过多个局部包装来驱动
- `clamp` 与搜索 range 常量仍留在 `app.js`
- 局部/全局查找中的 candidate scoring 与 index correction 仍然分散在控制流内部

这些逻辑不直接读写 DOM，也不应承担 `chunkItems` 输出责任，因此是下一步 very small safe split 的自然目标。当前项目已经验证“保留 `app.js` 原入口和原调用顺序，只抽离纯算法 helper”是稳定路径，本次延续这一策略。

## Goals / Non-Goals

**Goals:**
- 从 `processChunkData()` 中提取第二批纯匹配算法 helper
- 统一 exact phrase matching 的 range / fromIndex 变体，让它们通过显式参数工作
- 收束 clamp、range、scoring、index correction 等小算法，降低 `processChunkData()` 内部局部逻辑密度
- 保持 `processChunkData()` 原入口、原控制流、原调用顺序和现有外部行为不变

**Non-Goals:**
- 不迁出 `chunkItems` 组装
- 不迁出 fallback 主控制流
- 不迁出 `getSegTimeRange()` 或任何 segment 时间范围推导
- 不修改 `renderChunkMode()`、事件绑定、播放器、高亮、chunk note 或 sentence note 主流程
- 不改变 `output.json` 输入兼容语义，也不引入新的匹配策略

## Decisions

### 1. 这次只抽“匹配核心”，不抽“输出应用层”
本次 change 只覆盖：
- exact phrase matching 的局部 / 全局变体统一
- 可参数化的 `clamp`
- 搜索 range 常量或 range helper
- candidate scoring
- index correction 小算法

原因是这些逻辑都可以通过纯数据输入和输出表达。相对地，`chunkItems.push(...)`、fallback 分支和 segment 时间范围推导仍然属于应用层或控制流层，不适合在这次一起搬走。

### 2. 保留 `processChunkData()` 的控制流骨架
`processChunkData()` 继续保留：
- 输入格式分支
- `useGlobalWordIndexMode`
- `globalWordCursor` 推进
- exact match / anchor correction / fallback 的顺序
- `chunkItems` 组装

新 helper 只替换局部纯算法步骤，不改变这些步骤之间的顺序。这样做可以最大程度降低回归风险。

### 3. 第二批 helper 优先复用现有 `chunk-matching-helpers.js`
如果实现时发现新增逻辑仍属于同一类纯匹配算法 helper，则优先扩展 `chunk-matching-helpers.js`，而不是再创建新的 helper 文件。

理由：
- 第一批 helper 已经在该文件中建立了 `window.ChunkMatchingHelpers` 边界
- 这次只是继续细化同一模块内部的纯算法层
- 再新建文件会增加装配复杂度，但不会显著提升边界清晰度

备选方案是新增一个 `chunk-matching-core.js`。只有在实现中确认新增 helper 明显属于不同层级、同文件会造成语义混乱时，才考虑这么做。

### 4. 允许通过小型包装保持旧调用点稳定
如果 `processChunkData()` 当前局部算法存在多个近似变体，本次可以通过：
- 新 helper 接受更多显式参数
- `app.js` 内保留小型包装或映射函数

来保证旧调用点最小变更，而不是强行在 `app.js` 内完全重排算法步骤。

## Risks / Trade-offs

- [Risk] 第二批 helper 过度扩展后，会不小心把控制流层也一起带走 → Mitigation：明确只迁出纯算法步骤，不迁出 `chunkItems` 输出、fallback 和时间范围推导
- [Risk] exact match 变体统一时，如果改变 fromIndex 或 range 的默认语义，可能导致匹配顺序漂移 → Mitigation：要求保留原调用顺序，只把默认值和参数显式化，不改算法优先级
- [Risk] clamp / scoring / range helper 虽然小，但分散在控制流里，抽离时容易“顺手重排” → Mitigation：任务中明确要求 `app.js` 只做最小接线，保留原入口和原控制流

## Migration Plan

建议实施顺序：

1. 先盘点 `processChunkData()` 中剩余的纯匹配核心步骤
2. 确定哪些逻辑扩展到 `chunk-matching-helpers.js`，哪些仍留在 `app.js` 作为薄包装
3. 以最小接线方式替换调用点
4. 跑语法检查、页面加载检查和一条 `transcript + output.json` 的最小浏览器回归

回滚策略应保持很小：
- helper 文件
- `app.js`
- `read-26.html`（如果需要装配变更）

## Open Questions

- 第二批 helper 是否足以继续留在 `chunk-matching-helpers.js`，还是会把文件语义拉得过宽
- exact phrase matching 的局部 / 全局统一接口在实现时是否需要一个单独的参数对象，以避免位置参数过多
- 当前搜索 range 常量更适合保留为导出的常量，还是通过小 helper 动态生成
