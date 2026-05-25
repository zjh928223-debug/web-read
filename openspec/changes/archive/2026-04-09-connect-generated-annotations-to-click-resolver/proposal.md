## Why

当前 reader 已经能通过 `AnnotationGenerationController` 生成并保存 `annotation.generated.json` 语义结果，也已经有独立 `AnnotationBubble` 显示当前点击的释义；但点击单词时的 resolver 仍只查 `vocabMatchMap`，生成结果不会自动进入气泡。

本 change 要补一层 display-agnostic 的 generated annotation click bridge：把同一 audio/document 的 generated results 预加载成内存索引，并在现有点击链路中优先查询；查不到时继续回退到旧 `vocabMatchMap`。

## What Changes

- 新增独立 generated result store / index 模块：从 `annotation.generated.json` 语义 bundle 接收 items，建立内存索引，暴露 load/index/query/clear API。
- 新增独立 annotation click resolver 模块：根据 clicked word span、word index、reader word/context 和 generated index 查询当前 annotation，返回 bubble 可消费的标准字段。
- 在 `app.js` 做极薄 wiring：
  - 同一 audio/document 打开或恢复时尝试加载 generated bundle 并重建索引。
  - 生成流程完成或收到完成状态后刷新 generated index。
  - `resolveAnnotationBubbleForSpan()` 先查询 generated resolver，miss 后保持当前 `vocabMatchMap` fallback。
- 保持 `annotation-bubble.js` 为纯显示 consumer，不加入 storage/read/index/matching 逻辑。
- 保持点击文字跳音频、播放高亮、chunk note、sentence note、cloze、`renderChunkMode()` 等主流程不变。
- 暂不增加手动导入 `annotation.generated.json` UI、API 设置 UI、bubble 样式改动、正文 inline 注释、右侧解释栏或历史列表。

## Capabilities

### New Capabilities

- `generated-annotation-click-resolver`: generated annotation results 的加载、内存索引、点击查询、标准化输出、同页生成后刷新、同 audio/document restore，以及到现有 word-click-to-bubble 链路的优先 resolver 接入。

### Modified Capabilities

## Impact

- 预计新增模块：
  - `annotation-generated-result-store.js`
  - `annotation-click-resolver.js`
- 预计修改 `read-26.html`：在 `app.js` 前加载新增桥接模块。
- 预计最小修改 `app.js`：
  - 添加 generated result restore / refresh 的 wiring。
  - 在 entry controller 完成后刷新 generated result index。
  - 在现有 annotation bubble resolver 中加入 generated-first lookup。
- 预计复用现有 `AnnotationGenerationStorage.loadBundle(scope)` / generated bundle 语义。
- 预计不修改 `annotation-bubble.js`、不改 `annotation-generation-controller.js` 的 orchestration 主逻辑。
