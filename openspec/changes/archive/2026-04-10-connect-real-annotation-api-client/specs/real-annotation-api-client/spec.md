## ADDED Requirements

### Requirement: Annotation generation config MUST be explicit and centrally validated

系统 MUST 通过单一配置入口 `window.__ANNOTATION_API_CONFIG__` 决定 annotation generation API client 的运行模式。系统 MUST 使用独立 config helper 集中读取、默认化与校验该配置，而不是在多个调用点各自直接读取 `window`。

#### Scenario: Missing config is unconfigured
- **WHEN** 页面上不存在 `window.__ANNOTATION_API_CONFIG__`
- **THEN** annotation generation controller MUST 报告 `unconfigured`
- **AND** page-level entry UI MUST 显示未配置状态
- **AND** 系统 MUST NOT 在缺少配置时偷偷回退到 mock

#### Scenario: Explicit mock mode is allowed
- **WHEN** `window.__ANNOTATION_API_CONFIG__.mode` 为 `mock`
- **THEN** annotation API client MUST 走 mock provider 路径
- **AND** 系统 MUST 将该模式视为显式测试模式，而不是未配置的隐式回退

#### Scenario: Real mode requires required fields
- **WHEN** `window.__ANNOTATION_API_CONFIG__.mode` 为 `real`
- **THEN** config helper MUST 校验 `provider`、`apiKey`、`model` 和必需的 provider 请求信息
- **AND** 任一必需字段缺失时 controller MUST 报告 `unconfigured`

### Requirement: Annotation API client MUST support one real provider path without changing downstream contracts

系统 MUST 在 `annotation-api-client.js` 内提供单一真实 provider 请求路径，并继续输出与现有 controller/storage/generated store/click resolver/bubble 兼容的 annotation bundle 结构。

#### Scenario: Real provider request uses prompt payload
- **WHEN** controller 将 `AnnotationPromptBuilder.buildPromptPayload(...)` 的结果传给 annotation API client
- **THEN** API client MUST 基于该 payload 构造真实 provider 请求
- **AND** API client MUST NOT 要求 `app.js`、bubble UI 或 click resolver 参与 provider request 细节

#### Scenario: Real provider response is normalized for downstream consumers
- **WHEN** 真实 provider 返回 annotation 结果
- **THEN** API client MUST 返回包含 `provider`、`source`、`blockId` 和 `items` 的结果对象
- **AND** 每个 item MUST 可被 controller 持久化为 generated annotation item
- **AND** 下游 generated result store 和 click resolver MUST 无需理解 provider 原始响应结构

### Requirement: Annotation API client MUST contain response parsing tolerance and item filtering

系统 MUST 将真实 provider 的响应解析、fenced JSON 容错和非法 item 过滤集中在 `annotation-api-client.js` 中，不得把脏解析扩散到 controller、app、bubble 或 click resolver。

#### Scenario: Fenced JSON is tolerated
- **WHEN** 真实 provider 返回被 code fence 包裹的 JSON 文本
- **THEN** API client MUST 能提取并解析该 JSON
- **AND** controller MUST 继续收到标准化后的 provider result

#### Scenario: Invalid items are filtered before storage
- **WHEN** 真实 provider 返回的某个 item 缺少有效 `markedText` 且缺少合法 `boundary`
- **THEN** API client MUST 在返回给 controller 前丢弃该 item
- **AND** 系统 MUST NOT 依赖 generated result store 或 click resolver 在查询阶段临时修补该 item

#### Scenario: Non-JSON response becomes parse failure
- **WHEN** 真实 provider 返回无法恢复为合法 annotation JSON 的内容
- **THEN** API client MUST 将其标记为解析失败
- **AND** controller MUST 将对应 block 记为非重试失败或等价 fatal failure

### Requirement: Real API integration MUST preserve existing block-level failure semantics

接入真实 provider 后，controller MUST 继续保留 block 级成功、可重试失败、不可重试失败和最终 `partial-failed` 聚合语义，而不是把整篇生成流程改成单次全-or-nothing。

#### Scenario: Retryable block failure does not collapse the whole article
- **WHEN** 某个 block 的真实 provider 请求因超时、429、5xx 或其他暂时性错误失败
- **THEN** controller MUST 将该 block 标记为 `retryable`
- **AND** controller MAY 继续处理后续 block
- **AND** 最终聚合状态 MUST 保持为 `partial-failed` 而不是伪装 `complete`

#### Scenario: Non-retryable block failure remains visible
- **WHEN** 某个 block 因鉴权错误、无效 provider 配置或不可恢复解析失败而失败
- **THEN** controller MUST 将该 block 标记为 `failed` 或等价不可重试状态
- **AND** entry/status UI MUST 继续通过现有状态体系反映该次生成不是成功完成

### Requirement: Generated bundle compatibility and click-to-bubble behavior MUST remain unchanged

真实 provider 接入 MUST NOT 改变现有 generated bundle 的保存/恢复契约，也 MUST NOT 改变 generated result store、click resolver 和 bubble 的主职责与优先级。

#### Scenario: Real generated bundle is still saved and restored
- **WHEN** 真实 provider 成功为某些 block 返回 annotation items
- **THEN** controller MUST 继续通过现有 storage seam 保存 generated/status bundle
- **AND** 后续刷新或重新打开同一 scope 时系统 MUST 能恢复这些 generated items

#### Scenario: Click resolver continues to consume generated results first
- **WHEN** 用户在 generated index 已建立后点击已生成 annotation 的词
- **THEN** 现有 generated click resolver MUST 继续优先消费 generated items
- **AND** bubble MUST 显示真实 annotation 内容
- **AND** legacy `vocabMatchMap` fallback MUST 保持现有语义和优先级
