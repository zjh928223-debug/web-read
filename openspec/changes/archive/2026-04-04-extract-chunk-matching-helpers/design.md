## Context

当前 `processChunkData()` 内部已经存在一组天然的纯算法 helper，例如文本清洗、分词、精确 phrase match、基于锚点的索引纠偏。这些逻辑本身不读写 DOM，不依赖播放状态，也不直接操作渲染节点，但它们目前以内联局部函数的形式和 `chunkItems` 组装、fallback 分支、输入格式分支混在一起。

前几轮 safe split 已经验证了当前项目适合沿用“先抽纯 helper，再保留 `app.js` 原入口和原调用顺序”的路径。本次 change 延续这一策略，只处理 `processChunkData()` 内部最稳定的数据处理层，不扩展到 `renderChunkMode()`、事件链或播放高亮链。

## Goals / Non-Goals

**Goals:**
- 从 `processChunkData()` 中提取第一批纯数据处理 helper
- 让文本标准化、分词、精确匹配和索引纠偏通过显式参数工作
- 保持 `processChunkData()` 原入口、原控制流和现有外部行为不变
- 沿用当前仓库的 `window.*` helper 装配模式，降低接线风险

**Non-Goals:**
- 不重写 `processChunkData()` 的整体流程
- 不迁出 `chunkItems` 输出、fallback 组装、segment 时间范围推导等应用层逻辑
- 不修改 `renderChunkMode()`、事件监听、播放器、高亮、chunk note 或 sentence note 主流程
- 不改变 `output.json` 输入兼容语义，也不引入新的数据格式

## Decisions

### 1. 只抽离纯算法 helper，不抽离输出组装逻辑
这次只覆盖：
- `cleanText()`
- `tokenizeText()`
- `findExactMatch()`
- `adjustIndex()`

原因是这些逻辑已经具备显式输入和可复用输出。相对地，`pushFallbackChunk()`、`getSegTimeRange()` 和 `chunkItems.push(...)` 仍属于 `processChunkData()` 的应用层，不适合在这次一起搬走。

备选方案是把更多局部 helper 一起迁出，例如时间范围推导和 fallback 组装。但那会扩大到“计算 + 应用”的混合层，违背本次 very small safe split 的目标。

### 2. 保留 `processChunkData()` 原入口和原调用顺序
`processChunkData()` 仍然留在 `app.js` 中，输入格式判断、全局 cursor 推进、fallback 顺序和 `chunkItems` 组装继续原地保留。新 helper 只替换内部纯计算局部函数。

这样做的原因是当前 AI chunk 导入逻辑已经存在多条兼容分支，直接重排控制流风险较高。最安全的做法是只替换可参数化的局部算法，不动控制流骨架。

### 3. 使用 `window.ChunkMatchingHelpers` 暴露新 helper
延续项目现有 helper 模式：
- `window.ClozeUtils`
- `window.PlaybackIndexHelpers`
- `window.ChunkNoteLayoutHelpers`

新模块也通过 `window.ChunkMatchingHelpers` 暴露，避免这一步同时引入模块系统改造。

### 4. `findExactMatch()` 和 `adjustIndex()` 允许是“近纯”而不是极度抽象的单一函数
`processChunkData()` 当前同时存在 segment 局部 exact match 和基于起止锚点的索引纠偏。为了保持最小改动，本次允许 helper 接受必要的数组、搜索范围和目标 token 参数，而不强行压成过度抽象的单个万能函数。

这样可以保证：
- helper 仍然是显式参数驱动
- `app.js` 接线最小
- 行为更容易保持一致

## Risks / Trade-offs

- [Risk] `processChunkData()` 里的局部 helper 语义和用户口头命名不完全一一对应 → Mitigation：在 design 和实现中优先保持现有算法边界，再通过包装函数或命名映射满足 `cleanText()` / `tokenizeText()` / `findExactMatch()` / `adjustIndex()` 这组外部接口
- [Risk] 抽离后如果不小心重排 exact match 与 fallback 顺序，可能影响特定 `output.json` 的匹配结果 → Mitigation：明确要求保留原入口、原控制流和原调用顺序，只替换内部纯算法调用点
- [Risk] 这次 change 价值高但范围一旦失控，容易顺手碰到 chunk 输出结构 → Mitigation：任务中明确把 `chunkItems` 组装、fallback 输出、UI/渲染相关逻辑列为禁区
