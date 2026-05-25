## Context

当前 reader 的主行为仍集中在 `app.js`。点击单词的既有链路已经很敏感：`makeSpan(...)` / `transcriptContainer` click 会设置 `audioPlayer.currentTime`、调用 `forceUpdateUI(...)`，并在 chunk mode 下关联句子/块选择。这个链路不能为了 annotation bubble 被重写。

代码里也存在旧的解释/视觉辅助方向，例如 `globalVocab`、`vocabMatchMap`、`updateVisualHelper(target)`、`#info-card`、`#show-word`、`#show-meaning`。但它们偏向侧栏/视觉助手，而且当前 HTML 不一定完整暴露这套 UI。新功能只把“点击词时可以拿到的 annotation result”视为输入数据，不复活旧侧栏 UI。

本 change 需要新增的是一个 fixed-position annotation bubble：它像一个小的浮动解释监视器，通过热键显示/隐藏；可拖拽、可 resize；位置固定在 viewport 上，不跟随正文滚动；点击已标注词时替换为当前词解释；点击普通词时保持当前内容不变。

## Goals / Non-Goals

**Goals:**
- 建立独立的 annotation bubble module，而不是继续往 `app.js` 内塞 UI、拖拽、resize、模板渲染。
- 保持已有点击文本跳音频行为完全不变。
- bubble 可通过自定义热键显示/隐藏。
- bubble 可拖拽、可 resize，并保持用户拖动后的 fixed viewport 位置。
- bubble 只显示当前 annotation；新点击替换旧内容，不追加历史。
- bubble visible 但还没有 annotation 时，显示“点击一个已标注单词查看释义”一类空状态。
- 给未来字段、样式、pin/save、hotkey 策略升级预留模块边界。

**Non-Goals:**
- 不在正文中渲染 `[]` 边界或其它 inline 标记。
- 不新增右侧解释 panel。
- 不新增文章内嵌解释卡片。
- 不做 annotation 历史列表或堆叠日志。
- 不改 AI annotation / vocab 生成流水线。
- 不大改 `makeSpan(...)`、`renderTranscript()`、`renderChunkMode()`、播放/高亮循环或全局事件主链。
- 不把 bubble 和 chunk note、sentence note、旧 `#info-card` 侧栏深度绑定。

## Decisions

### Decision: 新增 standalone module，暴露小 API
新增模块建议命名为 `annotation-bubble.js`，并通过 `window.AnnotationBubble` 暴露少量 API。

初版 API 建议：

- `init(options)`
- `toggle(forceState)`
- `show()`
- `hide()`
- `setAnnotation(annotation)`
- `clearAnnotation()`
- `isVisible()`

模块自己拥有：

- bubble DOM 创建或挂载
- empty state
- field rendering
- visible state
- current annotation state
- drag state
- resize state
- viewport clamp
- position / width / height persistence

备选方案：
- 直接在 `app.js` 写 `openAnnotationBubble()` / `renderAnnotationBubble()`
  - 放弃原因：这会重复当前旧项目的问题，让 UI/状态/交互继续混进主运行时。

### Decision: app.js 只做 resolver + notification wiring
`app.js` 集成层只做两件事：

1. 当用户点击 word span 并完成原有 audio jump 后，尝试解析这个 word 是否有 annotation。
2. 如果 bubble 当前 visible 且解析到 annotation，则调用 `window.AnnotationBubble.setAnnotation(annotation)`。

建议把 resolver 写成很小的适配层，例如：

- 输入：`wordIndex`、`wordMeta`、被点击的 `span`
- 输出：标准化 annotation object 或 `null`

初版标准化 object 建议字段：

- `markedText`
- `boundary`
- `type`
- `meaning`
- `memoryHint`

这些字段先从现有 annotation / vocab match 结果做映射。找不到 annotation 时返回 `null`。

关键约束：

- 普通未标注词点击不得清空或刷新 bubble。
- bubble hidden 时，click wiring 必须快速返回，不做 UI 更新。
- 原 audio jump 必须先保持原样执行；annotation update 是附加通知，不是点击行为的替代。

### Decision: UI 复用视觉语言，不复用旧侧栏 DOM
可以复用现有 glass / bubble / chunk note 的视觉 token、边框、阴影、圆角和 fixed-layer 思路，但不复用 `#info-card`、`#placeholder`、`#show-*` 那套旧侧栏 DOM。

原因：
- 用户明确不要右侧解释 panel。
- 旧 visual helper 牵连 Google CSE / scene list / info-card，超出本 change。
- 新 bubble 要固定在用户拖动的屏幕位置，行为上更像独立 floating monitor。

### Decision: 热键只切 visible，不接管内容流
新增一个独立 hotkey，例如后续实现中可以默认用未占用键并允许配置；本 change 不要求抢占已有 `n/m/c/s/x/Arrow*` 语义。

热键行为：

- 从 hidden -> visible：显示 bubble；若没有 current annotation，显示空状态。
- 从 visible -> hidden：隐藏 bubble；保留 current annotation 和用户调整的位置尺寸。
- hidden 时点击词：完全保持当前阅读器行为，不主动弹出 bubble。

### Decision: Bubble is current-item view, not collection
module 内只保留 `currentAnnotation`，不保留 click history。

原因：
- 用户明确说每次已标注点击替换内容。
- 历史列表会引入滚动、删除、选中、持久化和性能问题，不属于 first implementation。

## Event Flow

```text
用户按 bubbleHotkey
  -> app.js thin hotkey wiring
  -> AnnotationBubble.toggle()
  -> bubble fixed layer show/hide

用户点击词
  -> 现有 word click handler
  -> audioPlayer.currentTime = targetTime
  -> forceUpdateUI(targetTime)
  -> thin annotation wiring
     -> if !AnnotationBubble.isVisible(): stop
     -> resolve annotation for clicked word
     -> if annotation exists: AnnotationBubble.setAnnotation(annotation)
     -> if annotation missing: keep current bubble content
```

## Risks / Trade-offs

- [Risk] 在现有 word click handler 内插入代码可能误伤 audio seek  
  → Mitigation：只在原 seek / `forceUpdateUI(...)` 之后追加一个小通知调用；不重排既有语句，不阻止事件，不改变 targetTime。

- [Risk] annotation 数据来源当前不够单一，可能来自 `vocabMatchMap`、notes import、未来 AI annotation 或 marks  
  → Mitigation：bubble module 不知道数据来源；`app.js` 适配层负责把现有命中结果标准化成 annotation object。

- [Risk] 与 chunk note modal / popover 的 drag/resize 行为互相影响  
  → Mitigation：annotation bubble 使用自己的 DOM class、自己的 pointer/mouse listeners、自己的 z-index 层级；不复用 chunk note 的运行时状态。

- [Risk] hotkey 与现有快捷键冲突  
  → Mitigation：实施前确认默认键；将 hotkey wiring 保持集中，避免散落到多个 keydown 分支。

- [Risk] fixed bubble 可能被拖出 viewport  
  → Mitigation：drag / resize 结束及窗口 resize 时由 module 自己 clamp 到 viewport 内。

## Migration Plan

1. 新增 standalone `annotation-bubble.js`，先完成 DOM、empty state、field rendering、visible state、drag、resize 和 fixed position。
2. 新增集中样式区块，命名限定为 annotation bubble 前缀，避免污染 transcript / chunk / notes 样式。
3. 在 `read-26.html` 中于 `app.js` 前加载模块，或提供一个空挂载点；不改正文结构。
4. 在 `app.js` 中添加极小 hotkey / click notification wiring。
5. 添加 annotation resolver adapter：只消费已有点击词可拿到的 annotation result；没有 result 时返回 `null`。
6. 验证 normal transcript word click 和 AI chunk word click 的 audio jump 不变。
7. 验证 bubble visible / hidden、annotated / non-annotated click、drag / resize、scroll 之后 fixed position。

## Open Questions

- 默认 bubble hotkey 用哪个键，才能不与当前 `m/n/c/s/x/ArrowLeft/ArrowRight` 冲突？
- 当前最权威的“annotated word result”是 `vocabMatchMap` 的 `data`，还是另有后续 annotation 数据文件？
- `标注内容 / 边界 / 类型 / 意思 / 要记` 与现有 annotation object 的字段映射是否已稳定，还是第一版需要在 adapter 中容忍多种字段名？
