## Why

当前 reader 已有独立 annotation bubble 作为“当前释义显示器”，但还没有清晰的页面级入口告诉用户如何启动“全文注释生成”，也没有一个与未来生成 pipeline 对接的状态/进度位置。

本 change 只建立生成入口和进度/status UI 的产品骨架：让用户能看到“生成全文注释”的动作入口、配置缺失状态、生成状态和重试状态，同时避免把真实 API 请求、provider 设置、prompt 细节或 bubble 展示逻辑混进现有大型 `app.js` 流程。

## What Changes

- 新增页面级 `生成全文注释` entry UI，作为全文 annotation generation 的启动入口。
- 新增最小 progress/status area，用来表示 `未配置`、`可开始`、`生成中`、`已完成`、`部分失败`、`可重试` 等状态。
- 新增一个很薄的 frontend state / renderer 边界，保存 total / completed / failed / current progress 等显示用状态。
- 新增一个明确的 future integration seam：页面入口只调用一个 generation controller / adapter 形状的接口；本 change 不实现真实 API 请求。
- API 配置缺失时显示明确的 `未配置` 状态；不在本 change 中加入 API key input、provider form、model picker 或完整配置编辑器。
- 不把生成入口放进 annotation bubble；bubble 仍只作为后续结果的显示 consumer。
- 不新增 inline article annotation、右侧 explanation panel、正文内 explanation card、history list 或真实 provider/model/request 逻辑。

## Capabilities

### New Capabilities

- `annotation-generation-entry-ui`: 页面级全文注释生成入口、状态/进度展示、缺配置提示、重试状态和未来 generation controller 的前端集成边界。

### Modified Capabilities

## Impact

- 预计最小修改 `read-26.html`：增加一个页面级按钮和轻量 status/progress mount，位置应靠近导入/阅读工具栏，不改变 transcript / chunk 正文结构。
- 预计最小修改 `styles.css`：增加命名清晰、集中放置的 generation entry/status 样式；不复用 `#info-card` 旧侧栏 DOM，不耦合 `.annotation-bubble` 样式。
- 预计最小修改 `app.js`：增加 page-level entry 的 DOM binding、状态渲染和一个未来 controller 的 placeholder/adapter 调用点。
- 可能新增小型 standalone frontend module，例如 `annotation-generation-entry-ui.js` 或 `annotation-generation-status-view.js`；其职责仅限 entry/status UI state，不能放 provider request / API key / prompt 组装。
- 不修改 `annotation-bubble.js` 的职责；本入口不应通过 bubble API 启动生成。
- 不修改现有 word click / audio jump / highlight / `processChunkData()` / `renderChunkMode()` / chunk note / sentence note 主流程。
