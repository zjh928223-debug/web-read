# annotation-generation-entry-ui Specification

## Purpose
TBD - created by archiving change add-annotation-generation-entry-ui. Update Purpose after archive.
## Requirements
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
系统 MUST 在 API / platform / model / key 等真实生成配置尚未存在、字段不完整、或当前选中平台尚未被运行时支持时显示明确的 `未配置` 状态。系统 MUST NOT 因为 settings UI 出现了“平台”字段，就把未接通的平台误显示为可运行。

#### Scenario: Initial missing configuration state
- **WHEN** reader 页面尚未连接可用的 annotation generation controller，或 controller 报告缺少 API 配置
- **THEN** status/progress area MUST 显示 `未配置` 或等价明确文案
- **AND** 页面 MUST NOT 显示复杂的 API settings center
- **AND** 页面 MAY 提供一个轻量本地 Annotation API Settings 入口用于填写和恢复配置

#### Scenario: User clicks generation entry while unconfigured
- **WHEN** 用户点击 `生成全文注释` 入口，但当前选中 profile 字段不完整或平台尚未被真实支持
- **THEN** 系统 MUST 保持在 `未配置` 或等价不可运行状态
- **AND** 系统 MUST NOT 调用真实 provider request
- **AND** 系统 MUST NOT 向 annotation bubble、正文、`vocabMatchMap` 或 annotation store 写入假的 annotation 内容

#### Scenario: Saved local config updates entry state without page refresh
- **WHEN** 用户通过本地 Annotation API Settings UI 保存了一份字段完整、且平台真实受支持的当前 profile
- **THEN** 现有 generation entry/status MUST 立即刷新为 configured/可开始语义
- **AND** 用户 MUST NOT 需要刷新页面

#### Scenario: Unsupported platform does not become ready
- **WHEN** 用户选中了一个字段完整但尚未被当前运行时支持的平台 profile
- **THEN** generation entry/status MUST NOT 进入 ready/configured
- **AND** 页面 MUST 继续显示未配置或不可运行语义

#### Scenario: Restored local config removes need for Console injection
- **WHEN** 页面启动时成功从本地存储恢复之前保存的可运行 profile
- **THEN** generation entry/status MUST 自动使用恢复后的配置语义
- **AND** 用户 MUST NOT 再需要手动去 Console 注入 `window.__ANNOTATION_API_CONFIG__`

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

### Requirement: Entry status distinguishes no-op from actual generation

page-level annotation generation entry/status MUST 能区分“本次没有缺口，因此未发 provider request”和“本次实际执行了补生成”。系统 MUST NOT 把无缺口 no-op 结果混同为普通 complete，也 MUST NOT 把它误显示为 failed。

#### Scenario: No missing targets are shown honestly
- **WHEN** 用户点击“生成全文注释”，且当前 document scope 下没有 missing targets
- **THEN** status/progress area MUST 明确显示本次无需生成、已是最新或等价语义
- **AND** status/progress area MUST 表达本次未发 provider request
- **AND** 该结果 MUST 与普通 complete 状态区分开

### Requirement: Incremental completion communicates supplemented work

当本次 generation 只补生成部分 missing targets 时，page-level entry/status MUST 以最小但明确的方式表达这是一次补生成，而不是重新生成整篇。

#### Scenario: Entry reports incremental completion
- **WHEN** 用户点击“生成全文注释”，系统检测到存在 missing targets，并成功只补生成其中一部分或全部
- **THEN** status/progress area MUST 以页面级文案表达这是一次补生成
- **AND** 文案 SHOULD 能让用户理解本次补生成了若干项，而不是整篇重跑

### Requirement: Current target set defines what counts as missing

entry 触发 incremental generation 时，系统 MUST 只以当前 unified target source 中仍存在的 targets 作为 diff 输入。已经被取消标记、不再属于当前 target 集的内容 MUST NOT 继续被视为 missing target。

#### Scenario: Removed mark no longer participates in missing-target evaluation
- **WHEN** 用户移除了某个 mark，使其不再属于当前 unified target source
- **THEN** 再次点击“生成全文注释”时，该 target MUST NOT 被计入当前 missing targets
- **AND** status/progress area MUST 仅基于当前 target 集的 diff 结果表达本次状态

### Requirement: Restore diagnostics records which generated data was read back
页面初始化与 annotation restore 流程 MUST 在 diagnostics 中记录其实际读取了哪些 generated/status 存储 key，以及读取后内存中的 generated item 数量和当前 scope。

#### Scenario: Refresh restore reveals generated readback
- **WHEN** 用户刷新页面、重新打开文章，或 reader 初始化时执行 annotation restore
- **THEN** diagnostics 输出 MUST 记录本次 restore 读取的 generated key 和 status key
- **AND** diagnostics 输出 MUST 记录读取后的 generated item 数量
- **AND** diagnostics 输出 MUST 记录恢复时使用的 `audioKey`、`documentId` 与 `scopeKey`

### Requirement: Entry and render diagnostics reveal scope mismatches and final visible counts
entry/status refresh、generated index refresh 与最终页面消费 MUST 在 diagnostics 中暴露 scope 一致性与最终可消费 annotation 数量，以支持判断数据是“没读回来”还是“读回来了但没显示出来”。

#### Scenario: Generated index refresh exposes current scope and item count
- **WHEN** 页面执行 generated annotation index refresh
- **THEN** diagnostics 输出 MUST 记录当前 refresh 使用的 `scopeKey`
- **AND** diagnostics 输出 MUST 记录 indexed generated item 数量
- **AND** diagnostics 输出 MUST 能看出 refresh 结果是否因 scope stale 被丢弃

#### Scenario: Final page consumption exposes render-side availability
- **WHEN** 页面最终进入可交互状态，或用户点击需要消费 generated annotation 的词项
- **THEN** diagnostics 输出 MUST 记录当前页面可消费的 generated annotation 数量或等价计数
- **AND** diagnostics 输出 MUST 能辅助判断 render/click 层是否因为 scope 或索引状态而未显示已有数据

### Requirement: Startup restore MUST keep transcript inputs available before annotation restore runs
annotation generation entry 所依赖的页面 restore 流程在正常启动时 MUST 保留 transcript、marks 与其它 reader 输入，直到 `restoreSession()` 完成读取。system MUST NOT 在默认 startup 路径里先清空这些输入，再进入 annotation restore。

#### Scenario: Refresh no longer falls back to empty reader state before restore

- **WHEN** 用户刷新页面或重新打开同一篇文章
- **THEN** 页面在 annotation restore 之前 MUST 仍然能够读取之前保存的 transcript 与 reader 输入
- **AND** 页面 MUST NOT 因启动时提前清空 reader 内容而退化成 `words = 0` 或直接回到空白 reader 状态

### Requirement: Restore diagnostics MUST show aligned scope for save and restore
entry UI 相关的 diagnostics 在本 change 修复后 MUST 继续暴露 save scope、restore scope 与 generated index refresh 的关键证据，便于验证同一篇文章在刷新前后的 scope 是否一致。

#### Scenario: Diagnostics confirm save scope equals restore scope

- **WHEN** 用户在当前会话里生成 annotation，随后刷新页面并触发 restore
- **THEN** diagnostics MUST 能显示保存 generated bundle 的 scope 与恢复 generated bundle 的 scope 一致
- **AND** diagnostics MUST 能显示 generated bundle 已按该 scope 被重新 load 与 index

### Requirement: Entry UI MUST not present incomplete generation as complete

page-level annotation generation entry MUST 忠实反映 controller 返回的 target completeness 语义。若 controller 判定本次运行后仍有 missing targets，entry UI MUST NOT 继续显示 `complete` 或等价完成语义。

#### Scenario: Entry shows non-complete state when targets remain missing

- **WHEN** controller 返回的 result 表示本次运行后仍存在 missing targets
- **THEN** entry UI MUST 使用对应的非完成状态与消息
- **AND** entry UI MUST NOT 将其显示成“已完成全文生成”

### Requirement: Entry result messaging MUST distinguish true completion from still-missing outcomes

entry UI 的 result message MUST 区分“全部 target 已生成完成”与“本次运行没有报错但仍有 target 未补齐”这两种不同结果。

#### Scenario: Result message stays honest after partial provider output

- **WHEN** provider request 成功返回，但最终 generated bundle 仍未覆盖所有 requested targets
- **THEN** entry UI MUST 显示仍需继续补生成的语义
- **AND** entry UI MUST NOT 复用真正 `complete` 的文案

