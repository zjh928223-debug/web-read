## 1. 现状审查与边界锁定

- [x] 1.1 审查 `annotation-generation-entry-ui.js`、`annotation-generation-controller.js`、`annotation-prompt-builder.js`、`annotation-api-client.js` 的当前输入输出契约，并记录本次保持不变的接口边界
- [x] 1.2 确认 entry UI 现有状态枚举已覆盖 `unconfigured`、`running`、`complete`、`partial-failed`、`retryable`，并明确哪些状态继续复用、哪些只补真实语义
- [x] 1.3 确认 controller 当前 block 级成功/失败/skip 处理方式，保证真实 API 接入后不破坏 `partial-failed` 语义
- [x] 1.4 确认 generated bundle 当前落盘结构与 click resolver 消费契约，锁定“真实返回必须继续兼容 storage/store/resolver/bubble”
- [x] 1.5 明确本 change 的非目标：不做设置页、不做 provider 下拉、不做目录 handle 接线、不做手动导入 generated JSON、不重构点击链路

## 2. 配置与状态接线

- [x] 2.1 新增极薄 `annotation-api-config.js`，集中读取 `window.__ANNOTATION_API_CONFIG__`
- [x] 2.2 在 config helper 中定义并校验 `mode/provider/apiKey/model/baseUrl/extraHeaders` 的最小配置契约
- [x] 2.3 实现配置语义：`mode=mock` 走显式 mock，`mode=real` 且配置完整才视为 configured，无 config 或缺字段则为 `unconfigured`
- [x] 2.4 更新 `read-26.html` 的脚本加载顺序，确保 config helper 在 `annotation-api-client.js` 前可用
- [x] 2.5 更新 `annotation-generation-controller.js` 的 `getConfigState()` / `isConfigured()`，让其基于 config helper 返回真实配置状态
- [x] 2.6 更新 entry 启动语义，使未配置时诚实显示 `unconfigured`，而不是继续默认 ready 或隐式 mock

## 3. 真实 annotation API client 边界

- [x] 3.1 在 `annotation-api-client.js` 中保留 mock path，并把 mock 改为仅在显式 `mode=mock` 时启用
- [x] 3.2 在 `annotation-api-client.js` 中新增单一真实 provider path；如仓库无可复用先例，则在本文件内局部实现最小 fetch 边界
- [x] 3.3 采用单一 provider 契约并写清请求构造方式、headers、baseUrl/model/apiKey 的使用规则
- [x] 3.4 保持 `promptPayload` 输入契约不变；真实 path 只消费当前 prompt builder 已输出的 payload，不重写 prompt builder 主逻辑
- [x] 3.5 在 API client 内实现响应文本提取、fenced JSON 容错、object/array 顶层兼容与最小解析恢复
- [x] 3.6 在 API client 内把 provider 返回标准化为 controller 现有可消费的 `provider/source/blockId/items` 结构
- [x] 3.7 在 API client 内对 annotation items 做容错标准化与过滤：缺少有效 `markedText` 且缺少合法 `boundary` 的项不得继续下传
- [x] 3.8 保持生成结果字段兼容现有 generated bundle、generated result store、click resolver 和 bubble 消费形状

## 4. 错误语义与 controller 保持兼容

- [x] 4.1 在 API client / helper 边界明确区分 `unconfigured`、`retryable`、`failed(parse-or-fatal)` 三类错误语义
- [x] 4.2 将网络超时、429、5xx 和其他暂时性 provider 错误归入 retryable，并确保 controller 将对应 block 标为 `retryable`
- [x] 4.3 将鉴权错误、明确 4xx 配置错误、不可恢复 parse failure 归入非重试失败，并确保 controller 不把这类 block 标成 `retryable`
- [x] 4.4 保持 controller 的 block 级失败处理与最终聚合结果兼容现有状态体系；有失败时继续落到 `partial-failed`
- [x] 4.5 保持 `annotation-generation-entry-ui.js` 继续只消费现有状态，不新增第四套状态系统

## 5. 最小 app 接线

- [x] 5.1 在 `app.js` 中仅保留薄接线：读取 controller 配置状态、启动 `startFullArticle(context, callbacks)`、完成后刷新 generated index
- [x] 5.2 保持 generated refresh / restore 主流程不变，不把点击时读 storage 的逻辑引回 click path
- [x] 5.3 不修改 `annotation-generated-result-store.js` 和 `annotation-click-resolver.js` 的主职责；如真实返回字段需要对齐，只做极薄兼容
- [x] 5.4 保持 `resolveAnnotationBubbleForSpan()` 的生成结果优先、legacy `vocabMatchMap` fallback 次之的现有顺序不变
- [x] 5.5 保持 bubble UI、热键、拖拽缩放、点击音频跳转与其他 reader 主流程不变

## 6. 验证

- [x] 6.1 运行 `node --check` 验证 `annotation-api-config.js`、`annotation-api-client.js`、`annotation-generation-controller.js`、`annotation-generation-entry-ui.js`、`app.js`
- [x] 6.2 验证显式 mock 模式仍可跑通现有整条链路，不破坏 storage fallback、generated index、click bubble 显示
- [x] 6.3 验证无 config 或 `mode=real` 但缺少必需字段时，entry/controller 进入 `unconfigured`，不再默认伪装 ready
- [x] 6.4 验证 real config 存在时，点击“生成全文注释”能够发出真实请求并产出兼容的 annotation bundle
- [x] 6.5 验证真实生成结果继续能被 storage 保存，并在刷新后 restore
- [x] 6.6 验证按 `b` 打开 bubble 后，点击已生成 target，generated resolver 能命中并显示真实 annotation
- [x] 6.7 验证 real provider 返回 fenced JSON、带说明文字的 JSON 或部分脏 item 时，API client 做最小容错且不污染下游
- [x] 6.8 验证 block 级失败不会把整篇直接打崩；存在失败时最终仍保持 `partial-failed` 语义
- [x] 6.9 验证本次实现未顺手引入设置页、provider 下拉、目录 handle 接线、manual import、ID 级点击映射或 generation pipeline 大重构
