## Context

当前 Annotation API Settings 已经具备这些基础能力：

- 本地 profile 列表与当前选中 profile 的 localStorage 持久化
- 页面启动时恢复 profile store，并同步到 `window.__ANNOTATION_API_CONFIG__`
- settings popover 中对当前 profile 的新建、删除、保存和切换
- 现有运行时 `annotation-api-client.js` 继续通过 `AnnotationApiConfig.read()` / `window.__ANNOTATION_API_CONFIG__` 获取真实 Gemini 配置

当前主要问题不在存储或运行时接线，而在设置 UI 和数据语义本身：

- 表单仍暴露 `provider`，而用户心智更接近“平台”
- `baseUrl` 作为主表单字段暴露，要求用户记忆平台默认地址
- profile store 还没有“默认平台地址”与“手动覆盖地址”的区分
- 如果未来出现更多平台，当前 UI 会误导用户把“字段存在”理解为“平台已可用”

这次 change 只修 settings 语义和表单结构，不扩展真实 API 调用平台，不改 generation pipeline 主逻辑。

## Goals / Non-Goals

**Goals:**

- 将 profile 数据语义从 `provider` 升级为 `platform`
- 对旧 localStorage 数据做兼容迁移，不破坏已有 profile 恢复
- 引入集中式平台默认 `baseUrl` 映射
- 将 `Base URL` 从主表单弱化为高级设置字段
- 当用户未自定义 `baseUrl` 时，切换平台自动回填该平台默认值
- 当用户明确编辑 `baseUrl` 时，保留 custom 语义
- 保持当前 Gemini 运行时链路继续可用
- 在 UI 和运行时层面诚实表达“当前只有 Gemini 真正可调用”

**Non-Goals:**

- 不接第二家真实 API client
- 不根据 `apiKey`、`model` 或 `baseUrl` 自动猜测平台
- 不把 `annotation-api-client.js` 重构成复杂多 provider framework
- 不改 generation pipeline、bubble、resolver、planner、target source、storage 主职责
- 不新增后端代理、导入导出配置文件、项目目录配置落盘或复杂 settings center

## Decisions

### 1. Profile store 以 `platform` 取代 `provider`，并做兼容迁移

profile store 升级为以 `platform` 作为主字段，至少包含：

- `id`
- `name`
- `platform`
- `apiKey`
- `model`
- `baseUrl`
- `useCustomBaseUrl`

迁移策略：

- 旧数据中如果存在 `provider` 且没有 `platform`，则自动迁移为 `platform`
- 旧数据中已有 `baseUrl` 时，默认视为 custom 输入，除非它与当前平台默认值一致
- 迁移在 `annotation-api-config.js` 中集中完成，不散落到 UI

选择这个方案，是因为数据语义升级必须先在 store 完成，否则 UI、恢复逻辑和运行时同步会继续用旧词汇混杂。

备选方案是仅在 UI 文案上把 `Provider` 改成“平台”，底层仍保留 `provider`。这个方案改动表面更小，但会让 store、UI、运行时 seam 三层长期术语不一致，后续更难维护，因此不采用。

### 2. 平台默认 `baseUrl` 映射集中维护在 config helper

平台默认值映射放在 `annotation-api-config.js` 的集中 helper 中，例如：

- `gemini` -> `https://generativelanguage.googleapis.com/v1beta`

UI 只消费 helper 暴露的默认值和支持范围，不自己写死平台默认地址。

这样做的原因：

- 避免同一默认 URL 在 UI、store、runtime normalization 多处重复
- 未来如果平台枚举扩展，只需要在集中 helper 改一处
- UI 可以更容易判断“当前平台是否受支持”“当前 baseUrl 是否仍跟随默认值”

### 3. `Base URL` 弱化到高级设置，并通过 `useCustomBaseUrl` 区分默认值与手动覆盖

主表单保留：

- 配置名称
- 平台
- API Key
- Model

高级设置区域保留：

- Base URL

行为规则：

- 如果 `useCustomBaseUrl = false`，则 `baseUrl` 由当前 `platform` 的默认值驱动
- 切换 `platform` 时，自动回填该平台默认 `baseUrl`
- 只有当用户主动展开高级设置并编辑 `baseUrl` 时，才把 `useCustomBaseUrl` 设为 `true`
- 如果用户把 `baseUrl` 改回当前平台默认值，则允许重新回到非 custom 语义

选择这个方案，是为了减少用户平时需要接触的字段数量，同时保留少量手动 override 能力。

备选方案是直接隐藏 `baseUrl`，完全不允许改。这会让默认场景更简单，但会切断已有自定义网关/镜像 URL 的使用场景，因此不采用。

### 4. 运行时 seam 继续兼容 `window.__ANNOTATION_API_CONFIG__`

虽然 profile store 升级为 `platform` 语义，但当前运行时 seam 继续输出现有结构：

- `mode`
- `provider`
- `apiKey`
- `model`
- `baseUrl`

其中：

- `provider` 由 `platform` 映射得到
- 当前若只支持 `gemini`，则只有 `platform = gemini` 会产生可运行的 `provider = gemini`

这样做的原因是这次 change 明确不重写 `annotation-api-client.js` 主契约，也不引入新的运行时配置入口。

### 5. UI 和运行时对支持范围必须诚实表达

这次 UI 语义可以为未来平台扩展留口子，但当前如果真实 API client 只支持 Gemini，则：

- UI 中 Gemini 是唯一 enabled 可保存并可运行的平台
- 其他平台不应以“可直接调用”的正常可选项出现
- configured/ready 的判断必须基于“当前选中 profile 完整且平台受支持”
- 若 profile 字段完整但平台尚未受支持，页面仍应回到 `unconfigured` 或等价的非可运行语义

这样可以避免“平台 UI 出现了”就被用户理解成“多平台已经打通”。

## Risks / Trade-offs

- [旧 profile 迁移不完整] → 在 `annotation-api-config.js` 中集中处理 `provider -> platform`、`baseUrl` 默认值和 `useCustomBaseUrl` 推断，并保留旧字段兼容读取
- [UI 弱化 `Base URL` 后用户找不到入口] → 使用轻量高级设置折叠区，并在折叠标题中明确这是“高级设置”
- [未来平台枚举提前暴露造成误导] → 当前 UI 默认只暴露已支持的平台；若出现 future 枚举，也必须 disabled 或不显示
- [运行时 seam 仍叫 `provider` 造成术语双轨] → 明确 store/UI 用 `platform`，运行时输出阶段做单点映射，避免双轨扩散到更多模块
