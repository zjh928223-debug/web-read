## 1. 基线与契约测试

- [x] 1.1 运行并记录 `npm test`、ECDICT module tests、preview/SRS 相关专项验证基线
- [x] 1.2 为 `LocalDictionaryClient` 的成功、unavailable、超时、非法 DTO 编写失败优先测试
- [x] 1.3 为 `DictionaryEnrichmentAdapter` 的 query 去重、有限并发、多候选保留和单项失败隔离编写失败优先测试
- [x] 1.4 增加静态边界测试，禁止 vocabulary、SRS、AI 和 card 模块导入 ECDICT infrastructure

## 2. 本地 HTTP 查询边界

- [x] 2.1 实现可复用的 ECDICT Vite middleware，限制 method、query 长度并返回稳定 JSON DTO
- [x] 2.2 在 `vite.config.js` 中静态加载 plugin 模块；关闭时不注册 endpoint，启用时覆盖 dev 与 preview server，并仅在第一次查询时延迟加载 SQLite service
- [x] 2.3 验证关闭开关时不导入 `node:sqlite` service、不注册 endpoint 且不访问数据库
- [x] 2.4 增加 endpoint 正常、禁用、缺库、损坏、非法 query 和 server close 资源释放测试

## 3. 浏览器 client 与 enrichment adapter

- [x] 3.1 实现带超时和 DTO 校验的 `LocalDictionaryClient`
- [x] 3.2 实现不依赖 vocabulary/SRS 的 `DictionaryEnrichmentAdapter`
- [x] 3.3 保留 direct、normalized 与全部 lemma candidates，并保持短语完整字符串查询
- [x] 3.4 为 endpoint 不可达和部分 query 失败实现 fail-open 返回，不中断 preview scan

## 4. 预习流程接入

- [x] 4.1 在 reader app runtime 中按编译期开关创建 client/adapter，并以依赖注入方式传给 preview controller
- [x] 4.2 在 preview candidates 生成后附加瞬时 `dictionarySuggestion`，不改变候选排序、筛选或原字段
- [x] 4.3 在预习列表增加独立 ECDICT 来源展示，明确 exact 与多候选状态
- [x] 4.4 增加回归守卫，证明 `buildPreviewAnnotationTemplate(...)`、annotation bundle 和 SRS settlement 不包含词典字段

## 5. 验证与文档

- [x] 5.1 使用真实 `ecdict.sqlite` 手工验证 `looked`、`left`、`better`、`can't`、`cant`、`run into` 和无结果短语
- [x] 5.2 运行 adapter、ECDICT、preview、annotation、SRS、Vite、production build 和现有 `npm test`
- [x] 5.3 更新 ECDICT 文档，说明第二阶段开关、本地 endpoint、UI 行为、故障回退和仍未接入的持久化边界
- [x] 5.4 记录实施前后测试结果，并确认没有 IndexedDB schema、词汇数据或复习记录迁移
