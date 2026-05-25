## Context

当前真实 annotation API 已经通过 `annotation-api-client.js` 接到 Gemini REST `generateContent`，并且配置入口已经被收敛到 `window.__ANNOTATION_API_CONFIG__` 这个 seam。现状问题不是“API client 不支持真实请求”，而是“配置没有页面内的本地入口”：

- `annotation-api-client.js` 通过 `AnnotationApiConfig.read(...)` 或 fallback 读取 `window.__ANNOTATION_API_CONFIG__`
- `app.js` 通过 controller 的 `getConfigState()` / `isConfigured()` 决定 entry/status 是 `configured` 还是 `unconfigured`
- 页面工具栏里已有 `生成全文注释` 和状态区，但没有 settings 入口
- 刷新页面后，用户仍需去 Console 手动注入配置

这次 change 的定位是本地便利化设置 UI，而不是正式安全方案，因此只解决“本地填写、保存、恢复、同步现有 seam”这条最小闭环。

## Goals / Non-Goals

**Goals:**

- 提供一个轻量的 Annotation API Settings 页面入口
- 提供极简设置面板/弹层，仅编辑 `mode`、`provider`、`apiKey`、`model`、`baseUrl`
- 新增集中式本地 config store/helper，统一读写 localStorage 并同步到 `window.__ANNOTATION_API_CONFIG__`
- 页面启动时自动恢复本地配置，刷新后不再依赖 Console 注入
- 保存成功后当前页面 generation entry/status 立即反映 `configured`，清空或配置不完整时回到 `unconfigured`
- 保持现有 generation pipeline 和 real API client 基本契约不变

**Non-Goals:**

- 不做后端代理
- 不做加密存储或假安全包装
- 不做多 provider framework 重构
- 不做整站 settings center
- 不改 bubble UI、target source、planner、storage、click resolver、generation pipeline 主逻辑
- 不新增 prompt editor、history list、right-side panel、inline annotation 等无关能力

## Decisions

### Decision: 配置读写集中到单一 helper/store

最适合承担 localStorage 读写、配置校验、默认值填充和 `window.__ANNOTATION_API_CONFIG__` 同步职责的层，是一个单独的 `annotation-api-config-store.js` 或等价 helper 模块，而不是把这些逻辑散落到：

- `app.js`
- settings UI 组件
- `annotation-api-client.js`
- entry/status UI

原因：

- 保持单一事实来源
- 避免多个模块各自实现 localStorage key 和字段校验
- 让 UI 层只负责展示和表单交互
- 让 API client 继续只依赖现有 seam，不直接知道 localStorage

建议 helper 职责：

- `loadStoredConfig()`
- `saveConfig(input)`
- `clearConfig()`
- `getEffectiveConfig()`
- `syncWindowConfig()`
- `getConfigState()`

### Decision: 入口放在现有 `.transcript-actions` 工具栏

最小、最不打乱现有布局的位置，是把 settings 入口放在 `生成全文注释` 按钮和现有 `annotation-generation-status` 邻近区域。

原因：

- 用户心智上与 generation entry 直接相关
- 不需要引入右侧栏或大面板
- 能以最少 DOM 改动融入现有工具栏

形态建议：

- 一个小按钮，如 `API设置`
- 点击后打开小面板或轻量弹层
- 面板仅服务 annotation API，不泛化为全局设置中心

### Decision: provider 保持最小化，不扩展成多 provider 平台

这轮 UI 中 `provider` 可以是固定 `gemini`、只读展示，或极简单选，但不得扩展为 provider marketplace 或复杂插件架构。

原因：

- 当前真实链路只用到 Gemini
- 用户目标是减少 Console 注入，不是做 provider 管理系统

### Decision: apiKey 仅在设置输入框中编辑，默认使用密码样式

`apiKey` 不应出现在页面常驻区域。最小实现应满足：

- 面板中用 password input 编辑
- 可以提供极简显示/隐藏切换，但不是必须
- 关闭面板后不在工具栏上展示明文

这满足“本地便利化”与“不要假装安全”之间的边界。

### Decision: configured/unconfigured 继续复用现有语义

不新增第五套状态系统，而是让设置 UI 保存/清空后直接触发已有 configured/unconfigured 语义刷新。

原因：

- `app.js` 与 `annotation-generation-entry-ui.js` 已经有这套状态心智
- 用户最关心的是保存后“立刻能用”，不是新状态名

因此这轮需要一个极薄刷新点：

- 页面初始化恢复 config 后调用现有 status sync
- 保存后立即重新同步
- 清空后立即重新同步

### Decision: 页面启动恢复是最小接线点

最小可控的恢复时机是在页面启动时：

1. 读取 localStorage
2. 校验并标准化
3. 同步到 `window.__ANNOTATION_API_CONFIG__`
4. 再让 generation entry/status 初始化或刷新

这样刷新页面后，用户不需要再次手动注入。

## Risks / Trade-offs

- [Risk] localStorage 中会保留前端可见配置，包括 apiKey。  
  Mitigation：明确把本 change 定位为本地便利化方案，不宣称安全；UI 上避免常驻明文展示。

- [Risk] 如果配置校验逻辑同时存在于多个模块，会出现状态不同步。  
  Mitigation：把读写/校验/同步集中到单一 helper/store。

- [Risk] 如果把入口塞进不合适的位置，会挤乱现有工具栏。  
  Mitigation：复用 `.transcript-actions` 附近的现有按钮群样式，做一个轻量入口，不新增大块常驻面板。

- [Risk] 保存后如果没有触发 entry/status 刷新，用户仍会误以为需要刷新页面。  
  Mitigation：保存、清空、恢复三个时机都显式触发现有 status sync。

- [Risk] 若 provider 字段未来扩展，当前 UI 可能需要重构。  
  Mitigation：当前只做最小字段模型，并在 helper/store 中保留稳定字段结构。

## Migration Plan

1. 审查当前 `annotation-api-client.js`、`annotation-api-config.js`、`app.js`、`read-26.html` 的 seam 和初始化顺序。
2. 新增独立本地 config store/helper，集中处理 localStorage 和 `window.__ANNOTATION_API_CONFIG__` 同步。
3. 在页面工具栏新增轻量 settings 入口和极简设置面板。
4. 接入保存、清空、恢复逻辑，并在这些时机刷新 generation entry/status。
5. 验证 real/mock/unconfigured 三条路径。

回滚策略：

- 只需回滚 settings UI 入口与本地 config store/helper 相关修改
- `annotation-api-client.js` 的 seam 仍保持原有 `window.__ANNOTATION_API_CONFIG__` 能力
- 即使回滚，仍可继续用 Console 注入作为旧工作流

## Open Questions

- `provider` 在本轮是只读文本还是极简 select？当前建议优先用极简 select 或固定值显示，保持未来可扩展但不增加复杂度。
- 是否提供“显示/隐藏 apiKey”小切换？当前建议可选，但不是必须项；若实现，必须保持默认隐藏。
