## Why

`plan-reader-safe-modularization` 已经把 chunk note layout helpers 列为第三个适合优先拆分的 very small 候选。当前 [app.js](/E:/小新备份文件/开发项目/lunix/read-final/app.js) 中的 chunk note 子系统把文本测量、宽高推导、位置约束、布局修正和事件/DOM 更新混在一起；如果不先抽出纯布局/测量/约束计算 helper，后续继续拆 chunk note 时很难维持低风险边界。

## What Changes

- 从 `app.js` 的 chunk note 子系统中提取第一批纯布局 / 测量 / 约束计算 helper 到独立模块。
- 迁出范围仅限可参数化的尺寸计算、位置约束、布局修正值推导和其他纯计算或近纯计算逻辑。
- 保持 `app.js` 的 drag、resize、popover、connector、元素创建/挂载/更新、恢复逻辑和主题联动全部留在原地。
- `app.js` 只做最小接线，保证用户可见行为和视觉结果不变。

## Capabilities

### New Capabilities
- `chunk-note-layout-helper-boundary`: 约束 chunk note 的布局/测量/约束计算 helper 可以独立成模块，同时保持现有 chunk note 行为与视觉结果不变。

### Modified Capabilities
- None.

## Impact

- 主要影响 [app.js](/E:/小新备份文件/开发项目/lunix/read-final/app.js) 中 chunk note data/layout utilities 这一段。
- 会新增一个 very small helper 模块文件，并在 [read-26.html](/E:/小新备份文件/开发项目/lunix/read-final/read-26.html) 中做最小脚本接线。
- 不涉及 chunk note 的交互事件、DOM 写入、恢复链路、主题切换联动和任何用户可见行为变更。
