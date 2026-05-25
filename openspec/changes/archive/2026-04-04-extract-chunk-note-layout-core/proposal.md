## Why

`extract-chunk-note-layout-helpers` 已经把 chunk note 的第一组纯文本包装 helper 从 `app.js` 中抽出，但 [buildChunkNoteLayout()](/E:/小新备份文件/开发项目/lunix/read-final/app.js) 里仍然混着环境读取、canvas 使用、font size 搜索和 layout result 组装。现在继续做下一个 very small safe split，可以只把其中可参数化的 layout result 计算核心抽出来，为后续 chunk note 子系统继续拆分建立更干净的边界。

## What Changes

- 从 `buildChunkNoteLayout()` 中提取第一批可参数化的 layout result 计算核心到独立 helper 模块。
- 迁出范围仅限根据已给定的文本、fontSize、lineHeight、padding、maxTextW、maxTextH、lines 等输入，计算结构化 layout result 的纯计算或近纯计算逻辑。
- 保持 `buildChunkNoteLayout()` 作为 `app.js` 内的原入口函数，继续保留其外层调用顺序和环境适配职责。
- 不修改 `ensureChunkNoteLayout()`、`measureChunkNoteTextBox()`、DOM、canvas/context 创建、CSS variable 读取、交互链或任何用户可见行为。

## Capabilities

### New Capabilities
- `chunk-note-layout-core-boundary`: 约束 `buildChunkNoteLayout()` 内部的 layout result 计算核心可以独立成模块，同时保持 chunk note 的现有布局结果与可见行为不变。

### Modified Capabilities
- None.

## Impact

- 主要影响 [app.js](/E:/小新备份文件/开发项目/lunix/read-final/app.js) 中的 `buildChunkNoteLayout()` 内部组织方式。
- 会新增一个 very small helper 模块文件，并在 [read-26.html](/E:/小新备份文件/开发项目/lunix/read-final/read-26.html) 中做最小脚本接线。
- 不涉及 `ensureChunkNoteLayout()`、`measureChunkNoteTextBox()`、drag / resize / popover / connector / restore / theme，也不涉及任何可见样式变更。
