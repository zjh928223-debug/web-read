## Why

当前 annotation bubble 的正文结构仍然是 `边界 / 意思 / 类型 / 要记` 四整行，信息层级偏松，`类型` 单独占行会稀释 `boundary` 的主视觉，也让整体纵向空间浪费。现在需要在不改 generation pipeline、resolver 契约和 bubble 行为控制的前提下，把 bubble 内容布局压缩成更紧凑、更稳定的三块结构。

## What Changes

- 将 bubble 主内容从四行整块调整为三块：`边界`、`意思`、`要记`
- 取消独立的 `类型` 整行，把 type 以小号灰色 abbreviation 标签放到 `boundary` 英文内容右侧
- 为 type 增加最小、稳定、可扩展的 abbreviation mapping，并为未知值提供安全 fallback
- 调整 bubble 内容区域的 DOM 组织和 CSS，使三块之间用细灰色分隔线隔开，且整体纵向间距缩短
- 保持 bubble 的数据来源、annotation schema、拖拽、缩放、显隐、hotkey、滚动能力不变

## Capabilities

### New Capabilities
- `<none>`: 无

### Modified Capabilities
- `standalone-annotation-bubble`: 调整 bubble 的 annotation 内容展示结构与紧凑布局要求

## Impact

- 受影响代码主要是 `annotation-bubble.js` 和 `styles.css`
- 可能新增一个极薄的 type abbreviation helper，但仅限 bubble 显示层内部消费
- 不影响 generated annotation storage、click resolver 返回结构、entry UI、generation pipeline、API client
