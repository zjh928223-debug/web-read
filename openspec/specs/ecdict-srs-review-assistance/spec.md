# ecdict-srs-review-assistance Specification

## Purpose
规定 SRS 复习页如何通过可注入的 browser client 查询并在答案揭示后展示瞬时 ECDICT
辅助信息，包括会话缓存、失败重试、竞态与卸载保护，同时确保结果不覆盖释义、不写入
VocabularyRepository、卡片、review log 或 IndexedDB。
## Requirements
### Requirement: SRS 只能通过可注入 browser client 查询 ECDICT
系统 SHALL 通过本地 HTTP client 向复习页提供 ECDICT 查询，并 MUST NOT 允许 SRS 或 review
模块导入 SQLite、repository 或 Node service。

#### Scenario: 功能关闭
- **WHEN** `ECDICT_ENABLED` 未显式启用
- **THEN** 系统不创建 client、不发 HTTP 请求且复习页行为保持不变

#### Scenario: 两个复习入口启用词典
- **WHEN** ECDICT 已启用并从 overlay 或 standalone 入口打开复习
- **THEN** 入口把可选 dictionary client 以 prop 注入 `SrsReviewPage`

### Requirement: 词典结果只能在答案揭示后显示
系统 SHALL 在当前卡片出现时开始查询，但 MUST 在答案揭示前隐藏全部 ECDICT 内容。

#### Scenario: exact 查询完成
- **WHEN** 当前词 exact 查询在显示答案前完成
- **THEN** 答案揭示前不可见，揭示后在现有释义之后显示词头和 translation 或 definition

#### Scenario: none
- **WHEN** lookup 返回 `matchedBy: none`
- **THEN** 答案揭示后仍不显示词典区域

### Requirement: 候选展示必须保留歧义
复习页 MUST 分别显示 normalized 和 lemma 候选类型与数量，并 SHALL NOT 自动选择唯一释义。

#### Scenario: direct 与其他候选共存
- **WHEN** lookup 同时包含 direct、normalized 或 lemma candidates
- **THEN** 页面保留 direct 并分别显示全部非重复候选及各类型数量

#### Scenario: 完整短语
- **WHEN** 当前词为 `run into`
- **THEN** 系统只查询一次完整字符串且不拆词降级

### Requirement: 查询必须隔离故障与竞态
词典查询 MUST NOT 阻止答案、评分、播放或进入下一张卡，并 MUST 丢弃过期或卸载后的响应。

#### Scenario: endpoint 不可用
- **WHEN** 查询失败或返回 unavailable
- **THEN** 答案揭示后显示弱提示“ECDICT 暂不可用”，不弹 toast 且评分与翻页继续工作

#### Scenario: 快速切卡
- **WHEN** A 卡请求未完成时切换到 B 卡
- **THEN** A 的响应不得更新 B 卡的词典状态

#### Scenario: 组件卸载
- **WHEN** 查询未完成时复习组件卸载
- **THEN** 后续响应不得更新组件状态或产生未处理 rejection

### Requirement: 会话缓存必须保持轻量和可重试
系统 SHALL 在当前复习组件会话内缓存成功的 exact、normalized、lemma 和 none 结果，并 MUST
NOT 缓存网络失败或 unavailable。

#### Scenario: 相同词再次出现
- **WHEN** 同一词在会话内再次出现且先前查询成功
- **THEN** 系统复用缓存且不再次发出 HTTP 请求

#### Scenario: 失败后再次出现
- **WHEN** 同一词先前查询失败或 unavailable
- **THEN** 系统允许再次查询

### Requirement: ECDICT 建议不得持久化或覆盖现有字段
系统 MUST NOT 使用 ECDICT 结果覆盖 `general_meaning`、`meaning`、`simple_meaning`，MUST NOT
调用 `cacheGeneralMeanings(...)` 写入词典内容，且 MUST NOT 写 VocabularyRepository、卡片或
review log。

#### Scenario: 查询成功并评分
- **WHEN** ECDICT 结果已显示且用户执行 Again、Hard、Good 或 Easy
- **THEN** 原 word/context 保持不变，review log 不包含 dictionary suggestion

### Requirement: disabled 和故障必须保持原有复习体验
`ECDICT_ENABLED` MUST 默认为 `false`；disabled、缺库或请求异常 SHALL NOT 改变现有答案、
评分、播放、翻页或应用启动行为。

#### Scenario: endpoint 运行中关闭
- **WHEN** 一次复习会话中本地 endpoint 停止响应
- **THEN** 当前及后续卡片仍可正常揭示、评分和切换
