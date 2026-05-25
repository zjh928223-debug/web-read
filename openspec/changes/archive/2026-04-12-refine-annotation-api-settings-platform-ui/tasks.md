## 1. 数据语义升级

- [x] 1.1 审查 `annotation-api-config.js` 当前 profile store、`window.__ANNOTATION_API_CONFIG__` 同步 seam 和本地恢复逻辑，确认最小改动点
- [x] 1.2 将 profile store 从 `provider` 主语义升级为 `platform`，并保留旧 `provider` 数据的兼容迁移
- [x] 1.3 为 profile 增加 `useCustomBaseUrl` 或等价语义，并明确默认值与 custom 值的判定规则
- [x] 1.4 将平台默认 `baseUrl` 映射集中收敛到 config helper，不把默认值散落到 UI 代码中

## 2. Settings UI 语义重构

- [x] 2.1 将表单中的 `Provider` 文案改为“平台”，并改成显式平台选择
- [x] 2.2 保持顶部 profile 管理结构不变：当前配置下拉框、新建、删除
- [x] 2.3 将主表单收敛为“配置名称 / 平台 / API Key / Model”
- [x] 2.4 将 `Base URL` 从主表单移到高级设置或折叠区域，并弱化为非主操作项
- [x] 2.5 保持 `API Key` 默认隐藏显示，不在常驻区域明文暴露

## 3. 默认 baseUrl 与 custom 行为

- [x] 3.1 新建 profile 时，按当前平台自动带出默认 `baseUrl`
- [x] 3.2 用户切换平台且尚未使用 custom `baseUrl` 时，自动更新为该平台默认值
- [x] 3.3 用户主动编辑高级设置中的 `Base URL` 时，将当前 profile 视为 custom `baseUrl`
- [x] 3.4 用户将 `Base URL` 改回当前平台默认值时，允许重新回到非 custom 语义

## 4. 运行时兼容与支持范围表达

- [x] 4.1 保持 `window.__ANNOTATION_API_CONFIG__` 现有运行时契约兼容，通过 `platform -> provider` 单点映射输出
- [x] 4.2 如果当前真实可运行平台只有 Gemini，则只让 Gemini profile 进入 ready/configured
- [x] 4.3 对字段完整但平台未真实支持的 profile，保持 `unconfigured` 或等价不可运行语义
- [x] 4.4 不根据 `apiKey`、`model` 或 `baseUrl` 自动猜测平台
- [x] 4.5 不改 `annotation-api-client.js` 主逻辑，只做极薄的枚举或兼容适配（如有必要）

## 5. 迁移、恢复与回归验证

- [x] 5.1 验证旧 localStorage 中的 `provider` 数据能平滑迁移到 `platform`
- [x] 5.2 验证刷新页面后，profiles 列表、当前选中 profile 和当前运行配置都能恢复
- [x] 5.3 验证 UI 中不再出现易混淆的 `provider` 主文案，而是“平台”
- [x] 5.4 验证选择 Gemini 时，默认自动带出 Gemini `baseUrl`
- [x] 5.5 验证 `Base URL` 在主界面不再占主要位置，而是在高级设置中可查看和修改
- [x] 5.6 验证当前 Gemini profile 仍能驱动 real API 生成链路
- [x] 5.7 验证无有效可运行平台配置时，页面继续诚实显示 `unconfigured`
- [x] 5.8 运行 `node --check` 覆盖新增和修改的相关文件
