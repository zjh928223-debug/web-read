## MODIFIED Requirements

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
