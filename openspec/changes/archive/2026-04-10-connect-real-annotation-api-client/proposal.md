## Why

当前 annotation 主链路已经打通：页面入口可以启动 controller，controller 会经过 block planner、prompt builder、api client、storage、generated index，再进入点击 bubble 显示链路。但 `annotation-api-client.js` 仍然默认产出 mock 数据，导致这条链路只验证了结构，没有真正接上模型能力。

这次 change 要把真实 provider 接到现有最小闭环上，同时保持边界稳定：不扩散设置 UI，不重写点击链路，不把生成逻辑重新塞回 `app.js`。目标是让现有“生成全文注释”入口在真实配置存在时能真正生成、保存、恢复并被点击释义消费；在未配置时诚实显示 `unconfigured`，不再伪装 ready。

## What Changes

- 新增单一 annotation API 配置入口 `window.__ANNOTATION_API_CONFIG__`，并通过独立 config helper 统一读取、校验和解释 `mode/provider/apiKey/model/baseUrl/extraHeaders`。
- 将 `annotation-api-client.js` 从“默认 mock”改为“双路径”：
  - `mode=mock` 时显式走 mock provider
  - `mode=real` 且配置有效时走单一真实 provider 请求
  - 无配置或缺少必需配置时返回 `unconfigured`
- 在 `annotation-api-client.js` 内实现最小真实 provider 请求边界、响应解析、fenced JSON / 非纯 JSON 容错、annotation item 标准化与脏数据过滤。
- 让 `annotation-generation-controller.js` 与 `annotation-generation-entry-ui.js` 继续复用现有状态体系表达 `unconfigured`、`running`、`complete`、`partial-failed`、`retryable`，并保留 block 级 `retryable/failed` 语义。
- 在 `app.js` 中仅做最小接线：读取 controller 配置状态、保留现有生成入口与 generated refresh / restore / click resolver 路径，不新增设置页、不改点击链路。
- 保留 mock 模式，但 mock 只作为显式测试模式，不再在缺少真实配置时偷偷回退。

## Capabilities

### New Capabilities

- `real-annotation-api-client`: 为现有 annotation generation pipeline 提供真实 provider 请求边界、统一配置读取、错误语义和向下游 generated bundle 的兼容输出。

### Modified Capabilities

- `generated-annotation-click-resolver`: generated annotation 的上游数据来源从 mock-only 扩展为 real-or-mock，但点击 resolver 的 fallback 优先级、bubble 字段语义和显示消费契约保持不变。

## Impact

- 主要影响文件：
  - `annotation-api-client.js`
  - `annotation-generation-controller.js`
  - `annotation-generation-entry-ui.js`
  - `app.js`
  - `read-26.html`
- 预计新增一个极薄配置读取模块，例如 `annotation-api-config.js`。
- 真实 provider 返回的数据必须继续兼容现有 `annotation-generation-storage.js`、`annotation-generated-result-store.js`、`annotation-click-resolver.js` 和 `annotation-bubble.js` 消费形状。
- 本 change 不引入设置表单、provider 下拉、多 provider 框架、目录 handle 接线或手动导入 `annotation.generated.json`。
