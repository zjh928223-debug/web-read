## ADDED Requirements

### Requirement: Page-level annotation generation entry

系统 MUST 提供一个页面级入口，用来启动“生成全文注释”流程。该入口 MUST 独立于 annotation bubble，不得放进文章正文流、右侧 explanation panel 或 bubble-only UI。

#### Scenario: Show full-article generation button
- **WHEN** reader 页面加载
- **THEN** 系统 MUST 在页面级控制区域显示一个用于全文 annotation generation 的入口
- **AND** 该入口 MUST 使用类似 `生成全文注释` 的明确文案
- **AND** 系统 MUST NOT 向 transcript / chunk 正文中插入按钮、inline `[]` marker、explanation card 或 history list

#### Scenario: Entry is independent from annotation bubble visibility
- **WHEN** annotation bubble 处于 hidden 或 visible 状态
- **THEN** 页面级 generation entry MUST 保持其自己的显示和状态
- **AND** entry 的可见性 MUST NOT 依赖 `AnnotationBubble.isVisible()`

### Requirement: Generation status and progress are visible at page level

系统 MUST 提供一个轻量 status/progress area，用于展示全文注释生成流程的当前状态、总量、完成量、失败量和进度信息。

#### Scenario: Render ready progress state
- **WHEN** annotation generation entry UI 收到 `ready` 状态且 total / completed / failed 计数可用
- **THEN** status/progress area MUST 显示可开始的状态
- **AND** status/progress area MUST 能显示 total block count
- **AND** status/progress area MUST 能显示 completed block count
- **AND** status/progress area MUST 能显示 failed block count

#### Scenario: Render running progress state
- **WHEN** annotation generation 处于 `running` 状态并报告进度
- **THEN** status/progress area MUST 显示生成中状态
- **AND** status/progress area MUST 显示当前 completed / total 进度
- **AND** 页面 MUST NOT 阻断已有音频播放、点击跳转、播放高亮或滚动行为

#### Scenario: Render completion and failure states
- **WHEN** annotation generation entry UI 收到 `complete`、`partial-failed` 或 `retryable` 状态
- **THEN** status/progress area MUST 以页面级状态文案区分完成、部分失败和可重试
- **AND** status/progress area MUST 保留 failed count 的可见表达

### Requirement: Missing API configuration is represented honestly

系统 MUST 在 API / provider / model / key 等真实生成配置尚未存在或不可用时显示明确的 `未配置` 状态。系统 MUST NOT 在缺配置时假装开始、假装进度、假装成功或写入假的 annotation result。

#### Scenario: Initial missing configuration state
- **WHEN** reader 页面尚未连接可用的 annotation generation controller 或 controller 报告缺少 API 配置
- **THEN** status/progress area MUST 显示 `未配置` 或等价明确文案
- **AND** 页面 MUST NOT 显示 API key input、provider form、model picker 或完整 settings editor

#### Scenario: User clicks generation entry while unconfigured
- **WHEN** 用户点击 `生成全文注释` 入口但真实生成配置缺失
- **THEN** 系统 MUST 保持在 `未配置` 或可重试/需配置状态
- **AND** 系统 MUST NOT 调用真实 provider request
- **AND** 系统 MUST NOT 向 annotation bubble、正文、`vocabMatchMap` 或 annotation store 写入假的 annotation 内容

### Requirement: Entry UI exposes a clean future controller seam

系统 MUST 通过清晰的 controller / adapter seam 连接未来 standalone annotation generation pipeline。页面入口和 status renderer MUST NOT 包含 provider-specific request 逻辑、API key 管理逻辑、model selection 逻辑或 prompt construction 主体。

#### Scenario: Future controller exists
- **WHEN** 页面级入口被点击且未来的 annotation generation controller 可用
- **THEN** entry wiring MUST 通过一个集中 adapter / controller seam 请求开始全文生成
- **AND** entry wiring MUST 将 reader context 或 document context 作为 plain data 交给该 seam
- **AND** entry wiring MUST 通过 normalized status update 刷新 status/progress area

#### Scenario: Future controller is not installed yet
- **WHEN** 页面级入口被点击但 standalone annotation generation controller 尚不存在
- **THEN** 系统 MUST 显示缺配置、未接入或可重试的明确状态
- **AND** 系统 MUST NOT 抛出可见运行时错误
- **AND** annotation bubble MUST NOT 被自动打开或用 placeholder 内容刷新

### Requirement: Annotation generation entry does not alter existing reader flows

页面级 annotation generation entry 的接入 MUST 保持既有 reader 行为不变，包括字幕导入、导切分入口、词点击跳音频、播放高亮、标记、sentence note、chunk note、cloze 和 annotation bubble 当前显示行为。

#### Scenario: Normal word click remains audio-oriented
- **WHEN** 用户添加了 annotation generation entry UI 并点击 transcript 中的单词
- **THEN** 系统 MUST 继续执行现有词点击跳音频行为
- **AND** annotation generation entry MUST NOT 接管 word click event
- **AND** annotation generation entry MUST NOT 因普通词点击而启动全文生成

#### Scenario: Existing import and reader controls remain available
- **WHEN** 页面级 annotation generation entry 显示在工具栏中
- **THEN** 既有音频/字幕导入、导切分、标记、释义、播放控制、highlight mode 和 annotation bubble hotkey MUST 继续可用
- **AND** 新入口 MUST NOT 替换或改名这些既有控件
