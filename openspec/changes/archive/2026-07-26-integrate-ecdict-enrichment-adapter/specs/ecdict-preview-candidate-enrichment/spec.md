## ADDED Requirements

### Requirement: 词典 enrichment 必须通过独立适配器
系统 SHALL 通过 `DictionaryEnrichmentAdapter` 调用 `LocalDictionaryClient`，并 SHALL NOT 允许 preview、vocabulary、SRS、AI 或 card 模块直接查询 ECDICT SQLite 表。

#### Scenario: 预习候选请求词典建议
- **WHEN** ECDICT 已启用且文章预习生成候选
- **THEN** 系统通过 adapter 和稳定 lookup DTO 查询每个去重后的完整候选字符串

#### Scenario: SRS 服务保持无 ECDICT 依赖
- **WHEN** 系统加载 vocabulary service、SRS scheduler 或 review page
- **THEN** 这些模块不导入 ECDICT repository、SQLite connection 或本地 dictionary service

### Requirement: 功能开关默认关闭且阻止初始化
系统 MUST 默认使用 `ECDICT_ENABLED=false`，并在关闭时不创建浏览器 client、不注册查询 endpoint、不初始化 ECDICT service 且不访问词典数据库。

#### Scenario: 默认启动
- **WHEN** 应用启动且没有显式设置 `ECDICT_ENABLED=true`
- **THEN** 阅读器和预习流程维持接入前行为且没有 ECDICT 数据库访问

#### Scenario: 显式启用
- **WHEN** 本地运行环境设置 `ECDICT_ENABLED=true`
- **THEN** Vite host 注册本地查询 endpoint 且预习 controller 可以创建 enrichment adapter

### Requirement: 本地 HTTP endpoint 必须保持只读与故障隔离
本地 endpoint SHALL 只接受有长度上限的 `GET` query，SHALL 使用第一阶段 `LocalDictionaryService`，并 MUST 将禁用、缺库、损坏或查询失败转换为结构化不可用响应。

#### Scenario: 正常查询
- **WHEN** client 请求 `/api/dev/dictionary/ecdict?q=looked` 且数据库可用
- **THEN** endpoint 返回包含 `available`、`matchedBy`、direct、normalized 和 lemma 候选的 lookup DTO

#### Scenario: 数据库不可用
- **WHEN** 数据库缺失、损坏或查询抛出异常
- **THEN** endpoint 返回明确 `errorCode` 且 Vite host 和阅读器继续运行

#### Scenario: 非法 query
- **WHEN** query 超过限制或请求方法不受支持
- **THEN** endpoint 返回客户端错误且不执行数据库查询

### Requirement: enrichment 必须保留匹配歧义
adapter MUST 保留 direct match、全部 normalized 冲突和全部 lemma 候选，并 SHALL NOT 自动选择或合并唯一释义。

#### Scenario: direct 与 lemma 同时存在
- **WHEN** 候选为 `left`、`saw`、`found` 或 `better`
- **THEN** enrichment 保留原词 direct match 和所有可用 lemma candidates

#### Scenario: normalized 冲突
- **WHEN** normalized key 同时对应 `can't` 和 `cant`
- **THEN** enrichment 返回两个候选且不静默合并

#### Scenario: 短语无命中
- **WHEN** 完整短语没有 ECDICT 词条
- **THEN** enrichment 返回 `none` 且不拆词、不调用 AI、不伪造词条

### Requirement: 词典建议只能作为瞬时预习元数据
系统 SHALL 把 lookup DTO 附加到内存中的 `dictionarySuggestion`，并 MUST NOT 写入 annotation bundle、AI prompt、vocabulary repository、SRS record、card 或用户数据库。

#### Scenario: 构建 AI annotation template
- **WHEN** 带有 `dictionarySuggestion` 的预习候选进入 `buildPreviewAnnotationTemplate(...)`
- **THEN** 输出 payload 不包含词典字段、translation、definition 或候选 DTO

#### Scenario: 整理到 SRS
- **WHEN** 用户之后从已生成 annotation 整理 SRS 候选
- **THEN** 系统只使用现有 annotation 字段且不读取或持久化 `dictionarySuggestion`

#### Scenario: 已有词汇与卡片
- **WHEN** enrichment 查询成功或失败
- **THEN** 已有 `meaning`、`simple_meaning`、`context`、`memoryHint`、卡片和复习记录保持不变

### Requirement: 预习 UI 必须区分词典建议与现有解释
预习候选列表 SHALL 以独立的 ECDICT 来源区域显示可用建议，并 MUST 在多候选时表达歧义而不是把候选显示为确定 meaning。

#### Scenario: exact 建议
- **WHEN** lookup 包含 direct match
- **THEN** UI 显示 ECDICT 来源、词头和可用 translation 或 definition

#### Scenario: 多候选建议
- **WHEN** lookup 通过 normalized 或 lemma 返回多个候选
- **THEN** UI 显示候选词头和数量且不覆盖候选原有展示字段

#### Scenario: 不可用或无结果
- **WHEN** ECDICT unavailable 或 `matchedBy` 为 `none`
- **THEN** 预习候选仍正常显示且用户仍可继续现有 AI 解释流程

### Requirement: enrichment 失败不得中断预习
adapter MUST 对 query 去重、限制并发并把单项 HTTP/解析/超时失败隔离到对应 suggestion。

#### Scenario: 单项查询失败
- **WHEN** 一组候选中的一个 lookup 请求失败
- **THEN** 其他候选继续 enrichment 且整次 `buildPreviewScan(...)` 成功返回

#### Scenario: endpoint 整体不可达
- **WHEN** 本地 endpoint 不存在或超时
- **THEN** 系统返回未 enrichment 的可用预习候选并保持现有操作可继续
