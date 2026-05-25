## Why

当前 annotation 主链路和 real API 都已经可用，但用户每次刷新页面后仍需要手动在 Console 注入 `window.__ANNOTATION_API_CONFIG__`，本地使用成本过高。现在需要补一个本地便利化的 Annotation API Settings UI，让用户可以在页面里填写、保存、恢复配置，并自动同步到现有 seam，而不把这次工作扩展成后端代理或复杂设置中心。

## What Changes

- 新增一个本地 Annotation API config store/helper，集中处理读取、校验、保存、清空和同步到 `window.__ANNOTATION_API_CONFIG__`
- 在现有页面工具栏中新增一个轻量 Annotation API Settings 入口与极简设置面板/弹层
- 设置表单只覆盖当前真实使用的字段：`mode`、`provider`、`apiKey`、`model`、`baseUrl`
- 页面启动时自动从 localStorage 恢复配置并同步到现有 annotation config seam
- 保存或清空配置后，现有 annotation generation entry/status 立即刷新 `configured/unconfigured` 状态，无需刷新页面
- 保持 generation pipeline、target source、planner、storage、resolver、bubble、API client 主契约不变，只做极薄适配

## Capabilities

### New Capabilities
- `local-annotation-api-settings-ui`: 页面级本地 Annotation API Settings 入口、表单与本地配置持久化能力

### Modified Capabilities
- `annotation-generation-entry-ui`: 现有 generation entry/status 需要从“依赖 Console 注入”升级为“依赖本地设置恢复后的 config seam”

## Impact

- 受影响代码主要会落在 `read-26.html`、`styles.css`、`app.js`、`annotation-api-config.js`
- 可能新增一个独立的本地 config store/helper 和一个轻量 settings UI 模块
- 配置持久化优先使用 localStorage
- 不引入后端代理、不引入加密存储方案、不重构多 provider framework
