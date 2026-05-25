## ADDED Requirements

### Requirement: Generated annotation results are indexed per current reader document

系统 MUST 提供 generated annotation result 的独立内存 store/index。该 store MUST 能从 `annotation.generated.json` 语义 bundle 接收 items，并按当前 audio/document scope 建立点击查询所需的内存索引。

#### Scenario: Index generated bundle for current scope
- **WHEN** 系统加载同一 audio/document scope 的 generated annotation bundle
- **THEN** generated result store MUST 标准化并索引 bundle 中的 annotation items
- **AND** store MUST 记录该 index 对应的 audioKey / documentId 或等价 scope

#### Scenario: Clear index on scope change
- **WHEN** 当前 reader 的 audioKey、documentId 或等价 document identity 发生变化
- **THEN** generated result store MUST 清空旧 scope 的 index 或用新 scope 的 bundle 替换 index
- **AND** 系统 MUST NOT 在新文档的点击气泡中显示旧文档的 generated annotation

### Requirement: Generated annotations restore before user clicks

系统 MUST 在点击查询之前把已有 generated annotations 恢复到内存索引中。重新打开同一 audio/document 后，如果 storage seam 能加载已有 generated bundle，用户 MUST 能通过现有点击链路查询到这些 generated annotations。

#### Scenario: Restore after transcript or session load
- **WHEN** reader 已建立当前 audio/document identity 且 transcript/chunk words 可用于点击
- **THEN** app integration MUST 尝试通过 annotation generation storage seam 加载当前 scope 的 generated bundle
- **AND** 如果 bundle 包含 generated items，系统 MUST 在用户点击前把它们 index 到 generated result store

#### Scenario: No generated bundle exists
- **WHEN** 当前 scope 没有已有 generated bundle 或 bundle 中没有 items
- **THEN** generated result store MUST 保持空 index
- **AND** 既有 word click、audio seek 和 legacy `vocabMatchMap` fallback MUST 继续按原行为工作

### Requirement: Same-page generation refreshes the click index

系统 MUST 在同页生成结果可用后刷新 generated result index，使刚生成的 annotations 不需要刷新页面即可被点击气泡路径消费。

#### Scenario: Refresh after full generation completes
- **WHEN** `AnnotationGenerationController.startFullArticle(context, callbacks)` 完成并且 storage seam 已保存 generated bundle
- **THEN** app integration MUST 触发当前 scope 的 generated result index refresh
- **AND** 用户随后点击已生成的标注词时 MUST 能通过 generated click resolver 得到 annotation，除非该词无法可靠匹配

#### Scenario: Do not couple controller to bubble
- **WHEN** generation controller 完成 block 或全文
- **THEN** controller MUST NOT 直接调用 `AnnotationBubble.setAnnotation()`
- **AND** controller MUST NOT 直接读写 annotation bubble DOM
- **AND** 点击查询 MUST 通过独立 store/index 和 click resolver 完成

### Requirement: Click resolver uses memory index and never reads storage in click path

系统 MUST 提供独立 click resolver，在用户点击 word span 时从内存 index 查询 generated annotation。该 click path MUST NOT 直接读取文件、localStorage、IndexedDB、directory handle 或 annotation generation storage。

#### Scenario: Resolve generated annotation on annotated click
- **WHEN** annotation bubble 处于 visible 状态，并且用户点击一个可被 generated result index 可靠匹配的 word span
- **THEN** app integration MUST 调用 generated click resolver 或等价接口
- **AND** resolver MUST 从内存 index 返回标准 annotation object
- **AND** bubble MUST 通过既有 `AnnotationBubble.setAnnotation(annotation)` 显示该 annotation

#### Scenario: Click path does not load storage
- **WHEN** 用户点击 transcript 或 chunk 中的 word span
- **THEN** generated click resolver MUST NOT 调用 `AnnotationGenerationStorage.loadBundle(...)`
- **AND** generated click resolver MUST NOT 直接调用 `localStorage.getItem(...)`、IndexedDB、file handle read 或网络请求

### Requirement: Generated annotations normalize to bubble-consumable shape

generated click resolver MUST 返回 annotation bubble 可直接消费的标准字段。字段标准化 MUST 在 resolver/store 层完成，而不是写进 `annotation-bubble.js`。

#### Scenario: Resolver returns display-ready annotation
- **WHEN** resolver 命中一个 generated annotation item
- **THEN** resolver MUST 返回包含 `markedText`、`boundary`、`type`、`meaning`、`memoryHint` 的 object
- **AND** 返回对象 MAY 包含 provider/source/id/debug metadata
- **AND** `annotation-bubble.js` MUST NOT 需要知道该 annotation 来自 generated JSON、mock provider、真实 API 或 legacy vocab

### Requirement: Generated resolver has priority and legacy vocab remains fallback

`resolveAnnotationBubbleForSpan(span)` 或等价 app integration MUST 先尝试 generated click resolver。generated resolver 未命中时，系统 MUST 继续执行既有 `vocabMatchMap` fallback。

#### Scenario: Generated hit wins
- **WHEN** clicked word 同时能被 generated result index 和 legacy `vocabMatchMap` 命中
- **THEN** app integration MUST 优先返回 generated resolver 的 annotation
- **AND** bubble MUST 显示 generated annotation 的 normalized 内容

#### Scenario: Generated miss falls back to vocabMatchMap
- **WHEN** clicked word 没有 generated resolver 命中，但存在既有 `vocabMatchMap` match
- **THEN** app integration MUST 继续使用现有 `vocabMatchMap` 数据
- **AND** bubble MUST 继续能显示 legacy normalized annotation

### Requirement: Reader click behavior remains unchanged

接入 generated annotation click resolver MUST NOT 改变 reader 中普通点击单词跳音频、播放高亮、句子/块选择、bubble 显示开关、chunk note、sentence note、cloze 或 `renderChunkMode()` 行为。

#### Scenario: Bubble hidden keeps current click behavior
- **WHEN** annotation bubble 处于 hidden 状态，并且用户点击 transcript 或 chunk 中的 word span
- **THEN** 当前 audio seek / `forceUpdateUI(...)` / playback highlight 行为 MUST 保持不变
- **AND** 系统 MUST NOT 因 generated annotation 命中而自动打开 bubble

#### Scenario: Normal text click keeps audio jump
- **WHEN** annotation bubble 处于 visible 状态，并且用户点击普通未生成 annotation 的 word span
- **THEN** 当前 audio seek / `forceUpdateUI(...)` / playback highlight 行为 MUST 保持不变
- **AND** bubble MUST NOT 被强制清空、隐藏或刷新为无关内容
