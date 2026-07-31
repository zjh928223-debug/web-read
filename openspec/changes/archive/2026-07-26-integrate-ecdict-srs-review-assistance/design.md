## Context

ECDICT 的 SQLite repository 与 Node service 已封装在 Vite 本地 endpoint 后面。文章预习只消费
browser client/adapter/formatter。复习页面同时存在 overlay 和 standalone 两个入口，并已有答案
揭示、评分、播放、释义 hydration 与并行发音改动。

## Goals / Non-Goals

**Goals:**

- 复习卡切换时以完整 `word.word` 发起一次本地查询。
- 答案揭示前隐藏结果，揭示后在现有释义之后展示。
- 相同词的成功结果在一次组件会话中复用。
- 隔离 endpoint 故障、过期响应和卸载后的异步回调。
- 复用现有 DTO client 与 formatter。

**Non-Goals:**

- 不修改或缓存 `general_meaning`、`meaning`、`simple_meaning`。
- 不持久化 ECDICT DTO，不写 repository、card 或 review log。
- 不拆分短语，不自动消歧，不增加 IndexedDB 或后台重试。
- 不重新设计复习页面。

## Decisions

### 1. 只注入 browser client

`App.vue` 与 `srs-review-main.js` 通过共享 helper 创建可选 client，并以 prop 注入页面。SRS 模块
不得导入 repository、SQLite connection 或 Node service。

### 2. 独立的瞬时 assistance controller

纯 browser controller 持有当前 query、lookup result、unavailable、request id、alive 状态和
会话 `Map`。组件只负责把 controller snapshot 映射到 Vue reactive state。这样可独立测试缓存、
竞态和卸载行为，不侵入评分流程。

### 3. 先查询、后揭示

卡片变化后立即查询以降低答案区等待，但 UI 仍由既有 `answerRevealed` 控制。成功的 exact、
normalized、lemma 和 none 可缓存；失败与 unavailable 不缓存，以便后续重试。

### 4. 复用 formatter

`formatDictionarySuggestion(...)` 增加可选的来源前缀控制。预习保持当前默认输出，复习页使用
独立标题并渲染 formatter 生成的候选文本，不实现第二套 DTO 解析。

## Risks / Trade-offs

- [卡片快速切换导致串卡] → 递增 request id 丢弃旧响应。
- [本地 endpoint 中途关闭] → 转为弱提示且不缓存，评分与翻页不等待查询。
- [重复查询] → 仅缓存成功 DTO；相同词复用 pending promise 或结果。
- [与现有 SRS UI 并行改动冲突] → 只在 props、watch、答案区和局部 CSS 增量编辑。

## Migration Plan

无数据迁移。关闭开关或移除注入即可回滚，现有卡片和复习记录不需要清理。
