## ADDED Requirements

### Requirement: Page MUST provide a local Annotation API Settings entry

系统 MUST 提供一个轻量的页面级 Annotation API Settings 入口，用于本地填写和编辑 annotation API 配置。该入口 MUST 位于现有 reader 页面工具栏或等价的轻量位置，MUST NOT 演变为整站 settings center、右侧栏或复杂设置系统。

#### Scenario: Show local settings entry near generation controls
- **WHEN** reader 页面加载完成
- **THEN** 系统 MUST 在页面级工具栏中显示一个 Annotation API Settings 入口
- **AND** 该入口 MUST 与现有 `生成全文注释` 流程相关联
- **AND** 该入口 MUST NOT 替换既有导入、标记、播放、bubble 或 generation entry 控件

### Requirement: Settings UI MUST support local editing of current annotation API fields

系统 MUST 提供一个极简 settings 面板或弹层，用于编辑当前 annotation API 实际使用的本地字段：`mode`、`provider`、`apiKey`、`model`、`baseUrl`。

#### Scenario: Open settings form
- **WHEN** 用户点击 Annotation API Settings 入口
- **THEN** 系统 MUST 打开一个本地 settings 面板或弹层
- **AND** 面板 MUST 提供 `mode`、`provider`、`apiKey`、`model`、`baseUrl` 的编辑能力
- **AND** 该面板 MUST NOT 扩展为 prompt editor、provider marketplace、整站 settings center 或后端代理配置页

#### Scenario: apiKey is not shown as always-visible plaintext
- **WHEN** settings 表单显示 `apiKey` 输入框
- **THEN** `apiKey` MUST 默认以密码样式显示
- **AND** 页面常驻区域 MUST NOT 明文展示 `apiKey`

### Requirement: Local config MUST be persisted and restored from local storage

系统 MUST 将本地 Annotation API 设置持久化到本地存储，并在页面启动时自动恢复。

#### Scenario: Save local config
- **WHEN** 用户在 settings 表单中输入有效配置并点击保存
- **THEN** 系统 MUST 将配置保存到本地持久化存储
- **AND** 本轮实现 SHOULD 优先使用 localStorage

#### Scenario: Restore local config on page load
- **WHEN** 用户刷新页面或重新打开页面
- **THEN** 系统 MUST 从本地持久化存储恢复之前保存的 annotation API 配置
- **AND** 用户 MUST NOT 需要再次去 Console 手动注入 `window.__ANNOTATION_API_CONFIG__`

### Requirement: Effective config MUST sync to the existing annotation config seam

系统 MUST 将本地有效配置同步到现有 `window.__ANNOTATION_API_CONFIG__` seam，而不是引入另一套并行配置入口。

#### Scenario: Save updates current window config immediately
- **WHEN** 用户保存 settings 表单中的完整配置
- **THEN** 系统 MUST 立即更新当前页面的 `window.__ANNOTATION_API_CONFIG__`
- **AND** 当前页面的 annotation generation entry MUST 可以直接使用新配置
- **AND** 用户 MUST NOT 被要求刷新页面

#### Scenario: Restore syncs current window config on startup
- **WHEN** 页面启动时成功恢复本地保存的配置
- **THEN** 系统 MUST 自动将恢复后的配置同步到 `window.__ANNOTATION_API_CONFIG__`

### Requirement: Config validation MUST keep configured/unconfigured semantics honest

系统 MUST 继续维持现有 configured/unconfigured 语义。配置保存、恢复、清空后，现有 generation entry/status MUST 立即诚实反映配置状态。

#### Scenario: Complete config becomes configured
- **WHEN** 用户保存了一份完整且可用的 real config，或切换到显式 `mock` 模式
- **THEN** 现有 generation entry/status MUST 进入 configured/可开始语义

#### Scenario: Cleared or incomplete config becomes unconfigured
- **WHEN** 用户清空配置，或保存了不完整的 real config
- **THEN** 系统 MUST 回到 `unconfigured`
- **AND** 现有 generation entry/status MUST 立即刷新为未配置语义

### Requirement: Local settings UI MUST preserve existing generation and reader responsibilities

本地 settings UI MUST 只负责本地配置输入、保存、恢复与同步，不得接管 generation pipeline 主逻辑或其他 reader 能力。

#### Scenario: Existing generation pipeline remains unchanged
- **WHEN** 本地 settings UI 被接入页面
- **THEN** target source、planner、storage、click resolver、bubble、generation pipeline 主职责 MUST 保持不变
- **AND** annotation API client 的基本输入契约 MUST 保持与现有 seam 兼容

#### Scenario: No backend proxy or fake security is introduced
- **WHEN** 系统实现本地 settings UI
- **THEN** 系统 MUST NOT 引入后端代理
- **AND** 系统 MUST NOT 宣称前端 localStorage 存储是安全 secrets 管理方案
