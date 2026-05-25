# local-annotation-api-settings-ui Specification

## Purpose
TBD - created by archiving change add-local-annotation-api-settings-ui. Update Purpose after archive.
## Requirements
### Requirement: Page MUST provide a local Annotation API Settings entry

系统 MUST 提供一个轻量的页面级 Annotation API Settings 入口，用于本地填写和编辑 annotation API 配置。该入口 MUST 位于现有 reader 页面工具栏或等价的轻量位置，MUST NOT 演变为整站 settings center、右侧栏或复杂设置系统。

#### Scenario: Show local settings entry near generation controls
- **WHEN** reader 页面加载完成
- **THEN** 系统 MUST 在页面级工具栏中显示一个 Annotation API Settings 入口
- **AND** 该入口 MUST 与现有 `生成全文注释` 流程相关联
- **AND** 该入口 MUST NOT 替换既有导入、标记、播放、bubble 或 generation entry 控件

### Requirement: Settings UI MUST support local editing of current annotation API fields
系统 MUST 提供一个极简 settings 面板或弹层，用于编辑当前 annotation API 实际使用的本地 profile 字段。主表单 MUST 以“配置名称”“平台”“API Key”“Model”为主；`Base URL` MUST 被弱化到高级设置区域，不再作为主操作字段常驻暴露。

#### Scenario: Open settings form
- **WHEN** 用户点击 Annotation API Settings 入口
- **THEN** 系统 MUST 打开一个本地 settings 面板或弹层
- **AND** 面板 MUST 提供“配置名称”“平台”“API Key”“Model”的编辑能力
- **AND** 面板 MUST 提供一个高级设置区域用于查看或编辑 `Base URL`
- **AND** 表单 MUST NOT 再以 `Provider` 作为面向用户的主文案
- **AND** 该面板 MUST NOT 扩展为 prompt editor、provider marketplace、整站 settings center 或后端代理配置页

#### Scenario: apiKey is not shown as always-visible plaintext
- **WHEN** settings 表单显示 `API Key` 输入框
- **THEN** `API Key` MUST 默认以密码样式显示
- **AND** 页面常驻区域 MUST NOT 明文展示 `API Key`

### Requirement: Local config MUST be persisted and restored from local storage
系统 MUST 将本地 Annotation API settings profile 持久化到本地存储，并在页面启动时自动恢复。已有旧数据中的 `provider` 字段 MUST 能平滑迁移到新的 `platform` 语义，不得导致已保存 profile 丢失。

#### Scenario: Save local config
- **WHEN** 用户在 settings 表单中输入 profile 并点击保存
- **THEN** 系统 MUST 将 profile store 保存到本地持久化存储
- **AND** 本轮实现 MUST 优先使用 localStorage

#### Scenario: Restore local config on page load
- **WHEN** 用户刷新页面或重新打开页面
- **THEN** 系统 MUST 从本地持久化存储恢复之前保存的 profile 列表和当前选中项
- **AND** 用户 MUST NOT 需要再次去 Console 手动注入 `window.__ANNOTATION_API_CONFIG__`

#### Scenario: Migrate old provider-based profile data
- **WHEN** 本地存储中存在旧格式 profile，使用 `provider` 而不是 `platform`
- **THEN** 系统 MUST 在恢复时将其迁移为 `platform`
- **AND** 迁移后原有 profile 名称、API Key、Model 和 Base URL MUST 继续可用

### Requirement: Effective config MUST sync to the existing annotation config seam
系统 MUST 将当前选中且可运行的本地 profile 同步到现有 `window.__ANNOTATION_API_CONFIG__` seam，而不是引入另一套并行配置入口。profile store 可以升级为 `platform` 语义，但运行时同步 MUST 继续兼容现有 `provider` 字段契约。

#### Scenario: Save updates current window config immediately
- **WHEN** 用户保存当前 profile 且该 profile 对当前支持的平台是完整可运行的
- **THEN** 系统 MUST 立即更新当前页面的 `window.__ANNOTATION_API_CONFIG__`
- **AND** 当前页面的 annotation generation entry MUST 可以直接使用新配置
- **AND** 用户 MUST NOT 被要求刷新页面

#### Scenario: Restore syncs current window config on startup
- **WHEN** 页面启动时成功恢复本地保存的当前 profile
- **THEN** 系统 MUST 自动将恢复后的运行配置同步到 `window.__ANNOTATION_API_CONFIG__`
- **AND** 如果当前 profile 对应平台不可运行或字段不完整
- **THEN** 系统 MUST NOT 同步出伪造的可运行配置

### Requirement: Config validation MUST keep configured/unconfigured semantics honest
系统 MUST 继续维持现有 configured/unconfigured 语义。只有当前选中 profile 对应的平台真实受支持，且必需字段完整时，系统才可进入 configured/ready；否则 MUST 回到 `unconfigured` 或等价的非可运行状态。

#### Scenario: Complete supported platform config becomes configured
- **WHEN** 用户保存或选中了一份字段完整、且平台真实受支持的 profile
- **THEN** 现有 generation entry/status MUST 进入 configured/可开始语义

#### Scenario: Incomplete or unsupported profile becomes unconfigured
- **WHEN** 用户保存或选中了一份字段不完整的 profile
- **OR WHEN** 用户保存或选中了一份平台尚未被当前运行时支持的 profile
- **THEN** 系统 MUST 回到 `unconfigured`
- **AND** 现有 generation entry/status MUST 立即刷新为未配置或不可运行语义

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

