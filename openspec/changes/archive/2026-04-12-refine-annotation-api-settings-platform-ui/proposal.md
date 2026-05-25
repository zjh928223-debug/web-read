## Why

当前 Annotation API Settings 已经具备本地 profile 管理、保存恢复和运行时同步能力，但 UI 仍然把核心概念命名为 `provider`，这对用户不直观。用户真正理解的是“平台”，而不是底层 provider 字段；同时 `baseUrl` 仍然作为主表单字段暴露，要求用户自己记住平台默认地址，也增加了误填和理解成本。

现在需要在不改动 annotation generation pipeline 主逻辑、不假装多平台已经接通的前提下，把设置 UI 的语义升级为“平台驱动的配置管理”。这样可以先把平台概念、默认 `baseUrl` 映射和高级设置结构整理清楚，为后续真实扩平台留出清晰边界，同时继续保持当前 Gemini 链路可用。

## What Changes

- 将 settings profile 的核心语义从 `provider` 升级为 `platform`，并提供对旧本地数据的兼容迁移。
- 将表单中的 `Provider` 改为“平台”，由用户显式选择，不再根据 `apiKey`、`model` 或 `baseUrl` 自动猜测平台。
- 新增集中式平台默认 `baseUrl` 映射，切换平台时自动带出默认值。
- 将 `Base URL` 从主表单移出，改为高级设置或折叠区域中的弱化字段。
- 引入 `useCustomBaseUrl` 或等价语义，用于区分“跟随平台默认值”和“用户手动覆盖”。
- 保持现有 profile 管理能力、localStorage 恢复能力和 `window.__ANNOTATION_API_CONFIG__` 同步 seam 不变。
- 保持当前 Gemini real API 链路继续可用；如果运行时只支持 Gemini，则 UI 和状态必须诚实表达支持范围。

## Capabilities

### New Capabilities
- `annotation-api-platform-semantics`: 定义 Annotation API Settings 中平台语义、默认 baseUrl 映射和高级设置行为

### Modified Capabilities
- `local-annotation-api-settings-ui`: 本地设置 UI 从 provider 表单升级为平台语义、多 profile 下的默认值与高级设置行为
- `annotation-generation-entry-ui`: generation entry/status 需要继续基于当前选中且受支持的平台配置，诚实反映 configured/unconfigured 语义

## Impact

- 影响代码：
  - `annotation-api-config.js`
  - `annotation-api-settings-ui.js`
  - `app.js`
  - 相关样式文件
- 影响运行时契约：
  - 继续兼容 `window.__ANNOTATION_API_CONFIG__`
  - 对本地 profile store 增加 `platform`、平台默认 `baseUrl` 和自定义覆盖语义
- 不影响：
  - `annotation-api-client.js` 的真实 Gemini 请求主逻辑
  - generation pipeline、bubble、resolver、planner、target source、storage 主职责
  - 后端代理和多 provider framework
