## Context

ECDICT 第一阶段的 `LocalDictionaryService` 运行在 Node.js，并通过 `node:sqlite` 只读访问独立数据库；现有 Read-Web 阅读器和文章预习流程运行在浏览器，不能直接打开 SQLite。当前预习链路由 `vocabulary-preview-module.js` 调用 `buildPreviewScan(...)` 生成瞬时候选，之后用户可以请求 AI 解释，再从已解释内容手动整理到 SRS。

第二阶段的第一条接入边界选择预习候选生成之后。这里能向用户展示词典建议，同时位于 AI prompt、annotation 保存、SRS candidate、vocabulary repository 和 scheduler 之前，最容易证明零覆盖和零迁移。

## Goals / Non-Goals

**Goals:**

- 让启用本地 ECDICT 的开发/本地运行环境能够在预习列表中看到词典候选。
- 保持 `DictionaryEnrichmentAdapter → LocalDictionaryService` 的单向依赖。
- 保留 exact、normalized 和多 lemma 候选，不在 adapter 中猜测唯一释义。
- 对禁用、缺库、损坏、HTTP 和单项查询失败进行故障隔离。
- 通过测试证明词典数据不进入 AI payload、annotation bundle、SRS 或用户数据库。

**Non-Goals:**

- 不用 ECDICT 替换或补写 `meaning`、`simple_meaning`、`context`、`memoryHint`。
- 不改变 preview token 识别、SRS eligibility、调度、卡片或复习展示。
- 不缓存或持久化词典结果，不迁移旧数据。
- 不实现短语拆分、AI 补全或 normalized/lemma 自动消歧。
- 不在本变更中提供远程生产词典服务。

## Decisions

### 1. 通过本地 HTTP endpoint 跨越浏览器/Node 边界

`vite.config.js` 静态加载 Vite plugin 模块；plugin 在 `ECDICT_ENABLED=true` 时注册只读
`GET /api/dev/dictionary/ecdict?q=...`。开关关闭时不注册 endpoint、不访问数据库；启用后
SQLite service 只在第一次查询时通过稳定的绝对 module URL 延迟加载，并在 server close
时关闭连接。

替代方案是把 SQLite 或大型词典打包到浏览器；这会增加下载、内存、IndexedDB 和迁移复杂度，并破坏独立数据库边界，因此不采用。

### 2. 浏览器 client 与 enrichment adapter 分离

`LocalDictionaryClient` 只负责 HTTP、超时和 DTO 校验。`DictionaryEnrichmentAdapter` 接收候选数组与 client，按规范化 query 去重并以有限并发查询，返回候选副本；它不导入 vocabulary、SRS、AI 或 card service。

替代方案是在 `preview-scan.js` 内直接 `fetch`；这会把传输细节写入领域扫描逻辑，降低可测试性并形成反向依赖，因此不采用。

### 3. 仅附加瞬时 `dictionarySuggestion`

adapter 在候选副本上增加：

```js
{
  dictionarySuggestion: {
    available,
    errorCode,
    query,
    normalizedQuery,
    matchedBy,
    directMatch,
    normalizedCandidates,
    lemmaCandidates
  }
}
```

字段只存在于当前 `latestPreviewScan` 内存对象。`buildPreviewAnnotationTemplate(...)` 继续显式挑选原有字段，因此不会进入 AI 请求；SRS settlement 仍只读取 annotation generated items，因此不会持久化该字段。

替代方案是把 translation 复制到 `meaning` 或 `simple_meaning`；这会覆盖现有语义来源并改变卡片内容，因此不采用。

### 4. UI 明确标注来源和歧义

预习列表在词条下方显示“ECDICT”来源行。exact 可以显示 direct translation/definition；normalized 或 lemma 返回多个结果时显示候选词头列表和数量，不自动选择。不可用或无结果默认不增加错误噪音；可通过扫描 summary/测试诊断状态。

### 5. 功能开关在服务端和客户端双重生效

Vite config 仅把 `ECDICT_ENABLED === "true"` 编译为浏览器布尔常量。客户端关闭时不创建 client、不调用 adapter；服务端关闭时不注册 endpoint。生产 build 默认关闭，因此现有行为不变。

### 6. 查询限额和失败粒度

endpoint 拒绝超长 query，client 使用短超时，adapter 对相同 query 去重并限制并发。单项失败转换为该候选的 unavailable suggestion，不使整次预习扫描失败。短语仍把完整字符串原样发送，不拆词降级。

## Risks / Trade-offs

- [Vite middleware 只适用于本地开发/preview host] → 明确把本变更限定为本地 ECDICT 接入；未来生产部署必须实现相同 HTTP contract，不能让浏览器直接访问 SQLite。
- [候选较多时增加查询延迟] → query 去重、有限并发、超时和现有 preview 上限共同控制成本。
- [normalized/lemma 结果容易被误认为确定释义] → UI 明确显示候选，不写入 `meaning`，不自动消歧。
- [编译期开关和运行环境不一致] → endpoint 与 client 双重开关；任何不一致都按 unavailable 处理并保持预习可用。
- [`node:sqlite` 仍为实验性 API] → 继续封装在第一阶段 infrastructure 后面，浏览器和 vocabulary 代码只依赖 DTO/HTTP contract。

## Migration Plan

1. 先增加 client、adapter、middleware 和隔离测试，默认关闭。
2. 在预习 controller 中注入 adapter，并增加瞬时展示。
3. 运行 ECDICT、preview、annotation、SRS、build 和 Vite 全部相关验证。
4. 本地设置 `ECDICT_ENABLED=true` 与 `ECDICT_DATABASE_PATH` 做人工验证。
5. 回滚时移除 adapter 注入和 Vite plugin 即可；没有 schema、用户数据或缓存需要迁移/清理。

## Open Questions

本次保守接入没有阻塞问题。是否让用户手动选择某个词典候选并用于 AI 或 SRS，必须作为后续独立变更评审，不能由本 adapter 自动决定。
