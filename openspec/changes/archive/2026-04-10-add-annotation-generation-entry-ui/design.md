## Context

reader 当前已经有多条相互敏感的运行链路：导字幕、导切分、词点击跳音频、播放高亮、标记、句子笔记、chunk note、cloze、annotation bubble。刚新增的 `annotation-bubble.js` 被刻意设计成 current annotation 的 fixed display consumer；它不负责生成 annotation，也不拥有 API / prompt / provider 配置。

现在要补的是上游产品入口：一个页面级“生成全文注释”启动点和状态/进度区域。这个入口需要让用户知道“可以开始 / 尚未配置 / 正在生成 / 完成 / 部分失败 / 可以重试”，但不要在这个 change 中提前塞入 API key 表单、provider/model 配置、真实 request 或 prompt 组装。

## Goals / Non-Goals

**Goals:**

- 新增页面级 `生成全文注释` 按钮，而不是 bubble 内部按钮或正文 inline 控件。
- 新增轻量 progress/status UI，可显示状态、total block count、completed count、failed count 和 current progress。
- API 配置不存在时，明确显示 `未配置`；点击开始不应假装生成成功。
- 建立一个干净的 future integration seam：entry UI 未来调用 standalone `annotation-generation-controller` 或同等 controller，而不是调用 bubble API。
- `app.js` 只承担最小 wiring / adapter；状态渲染尽量放在小型 view/controller 边界中。
- 保持 annotation bubble、正文、播放器、切分模式、笔记、标记行为不变。

**Non-Goals:**

- 不实现真实 API 请求。
- 不实现 API key input、provider form、model picker、prompt editor、完整 settings modal。
- 不组装最终 annotation prompt；最多定义 future prompt/controller 的输入形状。
- 不把 generation 状态渲染到 annotation bubble 里。
- 不新增右侧 explanation panel、正文内 card、inline `[]` boundary、annotation history list。
- 不修改 annotation import / matching / `vocabMatchMap` / `processChunkData()` / `renderChunkMode()` 主逻辑。

## Decisions

### Decision: Entry lives in the transcript header toolbar

页面级入口建议放在 `read-26.html` 的 `.transcript-actions` 内，靠近 `导标记 / 存JSON / 导切分` 这一类文档级动作。

理由：
- 这是全文级批处理动作，不是单词 click action，也不是 bubble action。
- toolbar 已经承载导入/导出/模式切换；新增一个按钮的用户心智成本最低。
- 不改变 transcript / chunk 正文结构，不影响阅读流。

备选方案：
- 放进 annotation bubble 内：放弃。会把“生成 pipeline”误绑定到“当前释义显示器”，后续换展示 UI 会变困难。
- 放右侧 panel：放弃。用户明确不想要右侧 explanation panel。
- 放正文首段上方的大卡片：暂不做。视觉侵入更大，并且可能影响阅读布局。

### Decision: Status/progress area is a tiny page-level view, not the pipeline

新增一个小型状态区，例如：

```text
[生成全文注释]  未配置
进度 0/0 失败 0
需要配置 API 后才能生成
```

状态模型建议先限定为显示层 plain data：

```js
{
  state: 'unconfigured' | 'ready' | 'running' | 'complete' | 'partial-failed' | 'retryable',
  total: 0,
  completed: 0,
  failed: 0,
  message: ''
}
```

这个状态不是 annotation 数据库，不保存每个词的释义，不向 bubble push 内容。

### Decision: Start action goes through future controller seam

按钮 click 的目标形状建议是：

```text
annotation generation entry UI
  -> app.js tiny wiring / document-context adapter
  -> window.AnnotationGenerationController.startFullArticle(context, callbacks)
```

本 change 不要求 controller 真实存在。如果不存在或者报告未配置，entry/status UI 必须进入 `未配置` / `可重试` 的诚实状态。

关键点：未来 controller 是 generation pipeline 的所有者；它以后再负责配置检测、prompt builder、batch queue、request、retry、result persistence、annotation index rebuild。这个 change 只预留接口，不把 pipeline 临时写在 button handler 里。

### Decision: Missing-config is a first-class UI state

本 change 必须允许页面在没有 API 配置时显示明确的 `未配置` 状态，并禁用真实生成尝试或在点击后给出明确 message。

理由：
- 用户已经指出“入口 / prompt / API”还没有接上；UI 不应假装已经有后端。
- 如果本 change 提前做 provider form，会扩大 scope；如果不显示未配置，按钮会像坏掉。

### Decision: Do not update annotation bubble from progress UI

生成入口/status UI 和 annotation bubble 之间不建立直接调用。

未来生成完成后，可以由 controller 写入统一 annotation store，再由当前的 click resolver 消费；bubble 仍只在用户点击 annotated word 时显示当前项。

## Risks / Trade-offs

- [Risk] 只有入口和 placeholder seam，用户点击后不会真的生成释义。
  → Mitigation：UI 文案必须诚实显示 `未配置` / “API 生成 pipeline 尚未配置”，任务中必须验证不出现假进度/假成功。

- [Risk] 在现有 toolbar 中继续加控件会变拥挤。
  → Mitigation：入口保持短按钮 + 可折叠/小型 status；样式集中；不添加大面板。

- [Risk] `app.js` 中临时 button handler 越写越大，最终变成 pipeline。
  → Mitigation：handler 只收集最小 reader context 并调用 future controller adapter；状态渲染放在 page-level generation UI module 或独立小函数里。

- [Risk] 状态名过早和真实 controller 绑定，后续难改。
  → Mitigation：UI state 用小而通用的状态枚举；controller 回调进入 status renderer 前先 normalize。

- [Risk] 缺配置时到底是禁用按钮还是允许点击后提示，产品含义不清。
  → Mitigation：spec 允许显示未配置，并要求点击时不假装执行；实现前可选“按钮可点但只展示缺配置 message”或“按钮 disabled + message”之一。

## Migration Plan

1. 在 toolbar 增加 `生成全文注释` entry 和一个 page-level status/progress mount；不改 transcript / chunk 正文。
2. 新增 entry/status 的 renderer boundary；先能渲染所有状态和计数。
3. 在 `app.js` 加最小 DOM binding 和 reader context adapter。
4. 加一个 future controller lookup / placeholder seam；controller 缺失或配置缺失时走 `unconfigured`。
5. 验证按钮、状态、progress 文案、缺配置点击、页面加载；验证 annotation bubble、词点击跳音频、导切分按钮等既有入口没有被接管。
6. 下一步 change 再做 API 配置模型、prompt builder、controller、真实 batch request 和 result persistence。

## Open Questions

- 页面级按钮最终文案固定为 `生成全文注释`，还是缩短为 `生成注释` 以适配当前拥挤 toolbar？
- 缺配置时第一版是否禁用按钮？还是允许点击并在 status 中显示“未配置，暂不能生成”？
- future controller 的全文 block 应该以 transcript segment、chunk item、sentence 还是固定 token window 为基础？本 change 只显示 count，不在本 change 中决定 batching 算法。
