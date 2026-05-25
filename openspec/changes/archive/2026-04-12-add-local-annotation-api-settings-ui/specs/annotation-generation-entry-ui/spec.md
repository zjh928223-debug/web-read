## MODIFIED Requirements

### Requirement: Missing API configuration is represented honestly

系统 MUST 在 API / provider / model / key 等真实生成配置尚未存在或不可用时显示明确的 `未配置` 状态。系统 MUST NOT 在缺配置时假装开始、假装进度、假装成功或写入假的 annotation result。系统 MUST 支持从本地 settings UI 恢复配置后自动进入可用状态，而不再要求用户每次刷新后手动去 Console 注入 `window.__ANNOTATION_API_CONFIG__`。

#### Scenario: Initial missing configuration state
- **WHEN** reader 页面尚未连接可用的 annotation generation controller，或 controller 报告缺少 API 配置
- **THEN** status/progress area MUST 显示 `未配置` 或等价明确文案
- **AND** 页面 MUST NOT 显示复杂的 API settings center
- **AND** 页面 MAY 提供一个轻量本地 Annotation API Settings 入口用于填写和恢复配置

#### Scenario: User clicks generation entry while unconfigured
- **WHEN** 用户点击 `生成全文注释` 入口但真实生成配置缺失
- **THEN** 系统 MUST 保持在 `未配置` 或可重试/需配置状态
- **AND** 系统 MUST NOT 调用真实 provider request
- **AND** 系统 MUST NOT 向 annotation bubble、正文、`vocabMatchMap` 或 annotation store 写入假的 annotation 内容

#### Scenario: Saved local config updates entry state without page refresh
- **WHEN** 用户通过本地 Annotation API Settings UI 保存了一份完整可用配置
- **THEN** 现有 generation entry/status MUST 立即刷新为 configured/可开始语义
- **AND** 用户 MUST NOT 需要刷新页面

#### Scenario: Restored local config removes need for Console injection
- **WHEN** 页面启动时成功从本地存储恢复之前保存的 annotation API 配置
- **THEN** generation entry/status MUST 自动使用恢复后的配置语义
- **AND** 用户 MUST NOT 再需要手动去 Console 注入 `window.__ANNOTATION_API_CONFIG__`
