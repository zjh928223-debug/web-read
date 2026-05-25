## Context

当前 bubble 内容由 `annotation-bubble.js` 的 `render()` 直接通过多次 `createField(...)` 顺序追加到 `.annotation-bubble__body`，每个字段都是同一层级的 `.annotation-bubble__field`。现状的问题不在数据来源，而在展示层：

- `boundary` 是主信息，但右侧没有次级元数据容器
- `type` 被渲染成与 `meaning`、`memoryHint` 同权重的独立整行
- `.annotation-bubble__field`、`.annotation-bubble__label`、`.annotation-bubble__value` 的间距偏大
- 当前 CSS 没有块间分隔线，也没有专门承载 type badge 的样式

同时，这次改动边界很严格：

- 不改 `annotation schema`
- 不改 `click resolver` 返回契约
- 不改 bubble 的 drag / resize / visibility / hotkey
- 不改 generation pipeline、entry UI、API client

## Goals / Non-Goals

**Goals:**

- 让 bubble 主体从四行变成三块：`boundary`、`meaning`、`memoryHint`
- 把 `type` 收进 `boundary` 这一块右侧，显示成小号、灰色、弱化标签
- 建立稳定的 type abbreviation mapping，并对未知类型做安全 fallback
- 在不影响滚动、关闭按钮、拖拽缩放的前提下，让正文布局更紧凑，并加入细灰分隔线
- 保持 bubble 对现有 annotation 数据结构的兼容

**Non-Goals:**

- 不改 generated annotation 的持久化结构
- 不改 `resolveClick(...)` 或 `normalizeAnnotationBubbleHit(...)` 的返回字段
- 不新增按钮、交互或新的展示字段
- 不改 bubble 的 frame、header、close button、resize handle、hotkey
- 不改 generation pipeline、entry UI、target source、API client

## Decisions

### Decision: type abbreviation mapping 放在 bubble 显示层

type 只是视觉标签，不是存储协议的一部分。这次最合适的放置层是 `annotation-bubble.js` 内部的极薄格式化函数，而不是放进 resolver、store 或 generation side。

原因：

- 不改上游契约，避免把“显示需求”扩散成“数据需求”
- 允许 bubble 在内部自由调整显示文案，而不影响 persisted item
- 未知 type 也可以在 UI 层安全 fallback，不污染业务链路

建议映射：

- `word` -> `W`
- `noun` -> `N`
- `verb` -> `V`
- `adjective` -> `Adj`
- `adverb` -> `Adv`
- `phrase` -> `Phrase`
- `phrasal-verb` / `phrasal verb` -> `Ph-v`
- `collocation` -> `Phrase`
- `expression` -> `Phrase`

未知值处理：

- 先转小写、去多余空格
- 若能识别复合词，优先给稳定缩写
- 否则取原值的小写安全简写；若为空则不显示标签

### Decision: DOM 改成“三块内容 + boundary 内联元信息”

保留 `annotation-bubble__field` 作为块级单元，但 `boundary` 这一块内部改成：

- label
- 一行 `content row`
  - 左侧 boundary text
  - 右侧 type badge

`meaning` 和 `memoryHint` 仍保持 label + value 结构。

原因：

- 这是最小 DOM 改动，不需要重写整个 bubble body
- 可以只在 boundary block 内部引入 badge 容器
- 与现有滚动容器 `.annotation-bubble__body` 完全兼容

### Decision: 分隔线和紧凑间距只放在内容块 CSS

分隔线和间距调整应只落在 `.annotation-bubble__field` 及其子元素，不碰 `.annotation-bubble`、`.annotation-bubble__header`、`.annotation-bubble__resize`。

原因：

- 这样不会影响拖拽热区、关闭按钮、resize handle
- 滚动区域仍由 `.annotation-bubble__body` 控制
- 修改点清晰，可回滚

实现方向：

- `.annotation-bubble__field` 用更小的上下 padding
- 非首块增加 `border-top`
- 缩小 `label` 和 `value` 之间的 margin
- `boundary` block 增加 `display:flex` 的 value row

### Decision: 不改变 bubble 对内部 annotation 数据的兼容性

`markedText` 继续保留在 `normalizeAnnotation(...)` 结果里，但不参与主内容渲染。

原因：

- 避免影响调试、日志和后续兼容逻辑
- 只把这次需求严格限定在展示层

## Risks / Trade-offs

- [Risk] 现有 `annotation-bubble.js` 文件里有编码混乱痕迹，局部修改容易把乱码带进新文本。  
  Mitigation：在实施时优先统一这一个文件里的展示文案和新结构，避免只对乱码片段做脆弱补丁。

- [Risk] type 值来源并不完全统一，未来可能出现更多值。  
  Mitigation：abbreviation mapping 采用“显式映射 + 小写安全 fallback”，不因未知值抛错。

- [Risk] 间距缩短后，长文本可能显得拥挤。  
  Mitigation：只把当前垂直间距压到约一半，保留 `line-height` 和 `overflow:auto`，避免过度压缩。

- [Risk] 分隔线可能与现有 header border 视觉叠加。  
  Mitigation：分隔线仅用于 body 内部字段块之间，颜色使用浅灰混合，不增强容器边框。

## Migration Plan

1. 先确认 `annotation-bubble.js` 里当前 render DOM 结构和字段来源。
2. 在 bubble 内部增加 type abbreviation helper，并改写 boundary block 渲染。
3. 调整 `styles.css` 中 `.annotation-bubble__body`、`.annotation-bubble__field` 及新增 badge/row selector。
4. 验证 bubble 长文本滚动、关闭、拖拽、缩放、hotkey 不受影响。
5. 若布局表现不理想，可回滚到旧的四行 render 结构；回滚范围只涉及 bubble 展示文件。

## Open Questions

- `collocation` 最终是统一收敛到 `Phrase`，还是显示成 `Coll` 更利于区分？当前建议先统一成更稳的 `Phrase`，减少标签种类。
- 若后续出现更细的 grammar tag，是否还保持 badge 仅单枚显示？本次先不扩展多标签布局。
