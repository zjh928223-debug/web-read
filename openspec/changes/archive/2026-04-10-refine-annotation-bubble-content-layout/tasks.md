## 1. 现状确认

- [x] 1.1 确认 `annotation-bubble.js` 中 annotation 内容渲染入口仍集中在 `render()` 与 `createField(...)` 一带，不改 bubble 的 drag / resize / toggle / hotkey 逻辑。
- [x] 1.2 确认当前四行 `边界 / 意思 / 类型 / 要记` 的 DOM 组织方式，以及最小可修改的结构边界。
- [x] 1.3 确认 `type` 的来源与现有可能取值，覆盖 generated path 与 legacy bubble hit 的兼容值。

## 2. 类型简写与渲染结构

- [x] 2.1 在 bubble 显示层内新增极薄的 type abbreviation mapping / formatting helper，不把映射逻辑扩散到 resolver、store 或 generation side。
- [x] 2.2 将 bubble 主体从四个独立字段块改为三个主块：`boundary`、`meaning`、`memoryHint`。
- [x] 2.3 把 `type` 改为 `boundary` 块右侧的小号灰色 abbreviation badge。
- [x] 2.4 保留 `markedText` 在内部 annotation 数据结构中，但不再作为可见内容渲染。
- [x] 2.5 为未知 `type` 提供安全 fallback，不因未知值抛错或破坏渲染。

## 3. 样式与紧凑布局

- [x] 3.1 在 `styles.css` 中新增或调整 bubble 内容块样式，使三块之间有细灰色实线分隔。
- [x] 3.2 将 bubble 内容块的上下间距、label 与 value 间距压缩到当前的大约一半，保持整体更紧凑。
- [x] 3.3 为 boundary value + type badge 提供稳定的行内布局，确保主信息左侧优先、badge 右侧弱化。
- [x] 3.4 保持 `.annotation-bubble__body` 的滚动能力、header、close button、resize handle、圆角和整体 frame 样式不受影响。

## 4. 验证

- [x] 4.1 运行 `node --check`，覆盖 `annotation-bubble.js` 以及如有必要改动的相关文件。
- [x] 4.2 实测验证 bubble 不再出现独立的 `类型` 整行。
- [x] 4.3 实测验证边界右侧能显示灰色小号 type abbreviation badge。
- [x] 4.4 实测验证 `边界 / 意思 / 要记` 三块之间有细灰线，且整体纵向更紧凑。
- [x] 4.5 实测验证长文本时 bubble body 滚动仍正常。
- [x] 4.6 实测验证关闭按钮、拖拽、缩放、显隐和 hotkey 行为不受影响。
