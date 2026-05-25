## Context

当前 annotation 相关主链路已经存在并且职责基本分离：

```text
entry UI
  -> app.js startAnnotationGenerationFromEntry()
  -> AnnotationGenerationController.startFullArticle(context, callbacks)
  -> AnnotationBlockPlanner
  -> AnnotationPromptBuilder
  -> AnnotationApiClient
  -> AnnotationGenerationStorage
  -> generated index refresh
  -> click resolver
  -> bubble.setAnnotation()
```

但当前 `AnnotationApiClient` 的现实语义仍然是 mock：

- `getProviderName()` 默认返回 `mock`
- `generateAnnotations()` 在没有外部 provider 注入时直接返回 `generateMockAnnotations(...)`
- `AnnotationGenerationController.getConfigState()` 直接返回 `configured`
- entry UI 虽然已有 `unconfigured/running/complete/partial-failed/retryable` 状态，但实际上还没有被真实配置状态驱动

同时，仓库内没有可直接复用的前端 Gemini/fetch provider 先例，也没有统一的 annotation API 配置入口。意味着这次最稳妥的方式不是继续扩散 UI，而是在现有 seam 之间补上最小真实 provider 边界。

## Goals / Non-Goals

**Goals:**

- 让 `window.__ANNOTATION_API_CONFIG__` 成为本轮唯一配置来源，并通过单独 helper 统一读取与校验。
- 让 `annotation-api-client.js` 同时支持显式 `mock` 模式和单一真实 provider 模式。
- 让 controller 的 `getConfigState()` 真实反映 `configured/unconfigured`，不再默认伪装 ready。
- 保持 `annotation-prompt-builder.js` 的输入输出契约不变，只把其产物交给真实 client。
- 让真实 client 的返回继续兼容现有 generated bundle、storage、generated result store、click resolver 和 bubble 消费路径。
- 保留 block 级成功/失败/partial-failed 语义，避免真实 API 接入后把整篇流程变成一次性全-or-nothing。
- 在 `app.js` 中只做薄接线，不把 provider 请求、解析、错误分流扩散进去。

**Non-Goals:**

- 不新增 API Key 输入 UI、provider 选择 UI、model picker、settings page。
- 不引入多 provider framework、插件式 provider 注册系统或“大一统 annotation platform”。
- 不改 `annotation-bubble.js` 的 UI、热键、拖拽、缩放。
- 不重写 `annotation-generated-result-store.js` 或 `annotation-click-resolver.js` 的主职责；最多允许为了真实数据兼容做极薄字段对齐。
- 不改 block planner 的 `** **` 目标提取规则，不做自动选词。
- 不把目录 handle 接线作为本轮主目标；storage 继续允许走现有 fallback。
- 不新增手动导入 `annotation.generated.json`。

## Decisions

### Decision: 单一配置入口为 `window.__ANNOTATION_API_CONFIG__`

本轮不做设置 UI，也不在多个模块里各自读 `window`。新增极薄 `annotation-api-config.js`，统一暴露类似：

```js
window.AnnotationApiConfig = {
  getRawConfig(),
  getMode(),
  getConfigState(),
  getValidatedConfig()
}
```

建议配置契约：

```js
window.__ANNOTATION_API_CONFIG__ = {
  mode: 'mock' | 'real',
  provider: 'gemini',
  apiKey: '...',
  model: 'gemini-2.5-flash',
  baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
  extraHeaders: {
    'X-Trace-Id': '...'
  }
}
```

约束：

- 无 config：`unconfigured`
- `mode=real` 但缺少必需字段：`unconfigured`
- `mode=mock`：显式 mock，可视为 configured
- 不允许“没配置时偷偷回退 mock”

之所以新增 helper 而不是让 `controller/app/api-client` 各自读取 `window.__ANNOTATION_API_CONFIG__`，是为了把配置解释、默认值和错误语义集中在一个地方，降低未来接设置页时的改动面。

### Decision: 单一真实 provider 先采用 Gemini REST 语义

仓库里没有现成 provider 模式，本轮只接一条真实 provider 链路，避免虚假抽象。建议固定支持：

- `provider: 'gemini'`
- `POST {baseUrl}/models/{model}:generateContent?key={apiKey}`

请求体最小化：

- 把 `promptPayload.prompt` 作为主文本输入
- 明确要求模型返回 JSON array / object，字段只允许 `markedText/boundary/type/meaning/memoryHint`

不做的事：

- 不支持 provider 下拉
- 不支持多 provider 适配层
- 不引入通用 SDK 包

如果未来需要第二个 provider，再基于已经收敛好的 config helper 和 client seam 扩展；本轮先把“真实能跑通”放在“框架优雅”之前。

### Decision: `annotation-prompt-builder.js` 主契约不改

当前 prompt builder 已经输出：

- `blockId`
- `targets`
- `mainText`
- `mainPlainText`
- `contextBefore`
- `contextAfter`
- `prompt`

本轮不重写 prompt builder 主逻辑，只允许在 api client 内消费这些字段。这样能保持 planner / builder / client 的边界清晰：

```text
planner 负责 block/targets
builder 负责 prompt payload
client 负责 request/parse/normalize
controller 负责 orchestration
```

### Decision: 响应容错和脏数据过滤全部收敛在 `annotation-api-client.js`

真实模型返回会有这些典型问题：

- 被 ```json fenced block 包住
- 在 JSON 前后夹带说明文字
- 返回 object 但 `items` 不完整
- 部分 item 缺字段

这些问题不能扩散到 controller、app、bubble、resolver。api client 需要在本层完成：

1. 从模型文本中提取最可能的 JSON 块
2. 支持 object 或 array 两种顶层结构
3. 统一转成：
   - `provider`
   - `source`
   - `blockId`
   - `items`
4. 对每个 item 做标准化和过滤

过滤原则：

- 缺少有效 `markedText` 且缺少有效 `boundary` 的项直接丢弃
- 非字符串字段在 client 边界做字符串化或裁剪
- 不把脏字段留给下游 query 阶段修补

### Decision: 错误分为 `unconfigured / retryable / failed(parse-or-fatal)`，但继续复用现有 UI 状态体系

不新造第四套状态系统。内部错误语义可以更细，但落到现有状态体系时保持简单：

- `unconfigured`
  - 发生在启动前校验
  - entry UI 显示 `unconfigured`
  - 不进入 block loop
- `retryable`
  - 网络抖动、超时、429、5xx、暂时性 provider 错误
  - block 状态记为 `retryable`
  - 最终聚合状态通常为 `partial-failed`
- `failed`
  - 明确的 4xx 配置/鉴权错误、不可恢复解析失败、provider 返回契约不合法
  - block 状态记为 `failed`
  - 最终聚合状态通常为 `partial-failed`

entry UI 仍然复用已有的：

- `unconfigured`
- `running`
- `complete`
- `partial-failed`
- `retryable`

也就是说，UI 层不理解所有错误子类型，只显示对用户有意义的聚合状态；详细原因留在 controller message 和 block status 中。

### Decision: generated bundle 输出形状保持兼容，不改点击主链路

真实 client 最终仍要产出 controller 能吃、storage 能存、store/resolver 能查的 item：

```json
{
  "id": "block-001-target-1",
  "targetId": "block-001-target-1",
  "blockId": "block-001",
  "markedText": "vast",
  "boundary": "vast desert",
  "type": "collocation",
  "meaning": "一望无际的沙漠",
  "memoryHint": "看懂即可",
  "provider": "gemini",
  "source": "real"
}
```

这样可以保持：

- `annotation-generation-storage.js` 无需理解 provider 细节
- `annotation-generated-result-store.js` 继续只做索引
- `annotation-click-resolver.js` 继续只做命中与排序
- `annotation-bubble.js` 继续只消费标准字段

### Decision: `app.js` 只做极薄接线

`app.js` 继续保留三类职责：

- 读取 controller 配置状态并更新 entry UI
- 点击入口时传入当前 document context
- 生成完成后刷新 generated index

`app.js` 不增加：

- provider request 逻辑
- JSON 解析
- item 过滤
- storage 读写分流
- click 时直接读 storage

## Risks / Trade-offs

- [Risk] 真实 provider 的返回不稳定，容易把脏数据漏到下游 → Mitigation：把 fenced JSON 提取、顶层结构兼容、字段标准化和非法项过滤全部收敛到 `annotation-api-client.js`
- [Risk] 只支持单一 provider 看起来不够“优雅” → Mitigation：当前目标是最小真链路，不是 provider 平台；先把单 provider 跑通，再基于 seam 扩展
- [Risk] `mode=real` 但配置错误可能导致整篇连续失败 → Mitigation：启动前先做 config 校验；运行中把 4xx/parse failure 标成非重试错误，把 429/5xx/timeout 标成 retryable
- [Risk] storage 仍走 fallback 时，用户会误以为已写入音频文件夹 → Mitigation：不改 storage 主目标，但在 controller/status message 中保留 `storageMode`
- [Risk] 真实现网请求可能暴露 prompt/响应解析问题 → Mitigation：不改 prompt builder 主逻辑，只在 client 层新增最小 parse 容错，减少变量

## Migration Plan

1. 新增 `annotation-api-config.js` 并在 `read-26.html` 中于 `annotation-api-client.js` 前加载。
2. 将 `annotation-api-client.js` 改为显式 `mock` 与 `real` 双路径。
3. 让 `annotation-generation-controller.js` 的 `getConfigState()` 真实读取 config helper。
4. 保持 `app.js` 入口与 generated refresh / restore / click resolver 主流程不变，仅接入真实状态语义。
5. 先用 `window.__ANNOTATION_API_CONFIG__ = { mode: 'mock', ... }` 回归 mock 全链路。
6. 再用开发者手动注入的 real config 跑通真实请求、保存、restore、点击 bubble 显示。
7. 若真实路径不稳定，可把 `mode` 切回 `mock` 作为回滚点，无需撤销 bubble/store/resolver/storage 现有链路。

## Open Questions

- 真实 provider 返回的 prompt token 限制是否需要在本轮做更严格的 request size guard；如果当前 block planner 的 hard cap 已足够，可以暂不额外增加。
- `baseUrl` 是否允许缺省到 Gemini 默认地址；当前设计倾向允许默认值，但仍要求 `provider/apiKey/model` 明确存在。
- 是否需要在 controller message 中显式区分 `failed` 与 `retryable` 的文案；本轮至少会在 block status 中区分。
