## Why

ECDICT 第一阶段已经提供独立、只读且可故障隔离的本地查询服务，但浏览器中的文章预习候选尚无法安全消费这些结果。现在需要通过显式适配器和可关闭的本地 HTTP 边界，把词典候选作为非破坏性的辅助信息引入预习流程，同时证明现有 AI、SRS 和用户数据路径保持不变。

## What Changes

- 新增浏览器可调用的 `LocalDictionaryClient` 与 `DictionaryEnrichmentAdapter`，只依赖稳定的词典查询 DTO，不允许直接查询 SQLite。
- 新增默认关闭的本地 ECDICT HTTP endpoint，由 Vite 开发/预览服务器托管；关闭或不可用时不打开数据库，并返回结构化不可用结果。
- 在文章预习扫描候选生成后执行可选 enrichment，把结果附加为瞬时 `dictionarySuggestion`。
- 在预习候选列表中单独展示 exact、normalized 和 lemma 候选信息，不替换现有 `meaning`、`simple_meaning`、`context` 或 `memoryHint`。
- 不把词典候选传入 AI prompt，不自动加入 SRS，不修改 vocabulary schema、IndexedDB schema、卡片结构、调度或复习记录。
- 为启用、禁用、缺库、损坏库、请求失败、多候选和短语无命中提供自动测试与回归守卫。

## Capabilities

### New Capabilities

- `ecdict-preview-candidate-enrichment`: 规定浏览器预习候选通过可选适配器获取和展示 ECDICT 建议、HTTP 故障隔离、功能开关与零持久化边界。

### Modified Capabilities

无。

## Impact

- 新增独立的浏览器 dictionary client、enrichment adapter、Vite middleware 和测试。
- 仅修改文章预习扫描的组装调用点与预习候选展示，不修改 annotation API payload、SRS service、scheduler、repository 或数据模型。
- 运行时依赖现有 Node.js `node:sqlite` ECDICT 模块；不新增第三方依赖。
- `ECDICT_ENABLED=false` 仍为默认值，默认启动、构建和用户行为与接入前一致。
