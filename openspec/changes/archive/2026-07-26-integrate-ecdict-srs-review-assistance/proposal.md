## Why

文章预习已经能把 ECDICT 作为瞬时辅助信息展示，但复习答案区仍无法按同一稳定 HTTP
契约查询本地词典。需要在不覆盖释义、不持久化结果、不改变评分与调度的前提下，为答案
揭示后的复习卡提供同样的辅助候选。

## What Changes

- 增加共享的可选 browser client 创建 helper，统一处理编译期开关。
- 通过 prop 向 `SrsReviewPage` 注入可选 dictionary client。
- 当前卡片变化时查询完整词头或短语，并在答案揭示后显示瞬时 ECDICT 信息。
- 增加会话内成功结果缓存、请求竞态保护和组件卸载保护。
- 对 disabled、none、unavailable、HTTP 失败保持 fail-open，不影响评分、播放和下一张卡。
- 不写 vocabulary repository、卡片、review log 或 IndexedDB，不调用释义缓存流程。

## Capabilities

### New Capabilities

- `ecdict-srs-review-assistance`: 规定复习答案区的可选 ECDICT 查询、展示、缓存、竞态与零持久化边界。

### Modified Capabilities

无。

## Impact

- 修改 browser client 组装入口、`App.vue`、`srs-review-main.js` 和复习组件。
- 新增一个纯 browser runtime helper、复习 assistance controller、样式和专项测试。
- 不修改 SRS schema、调度、卡片结构、VocabularyRepository 或 review log。
- `ECDICT_ENABLED=false` 仍是默认值。
