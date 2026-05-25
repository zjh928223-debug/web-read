## Why

当前阅读器里的 capsule-style chunk note 气泡在 dark/light 主题切换时会持续变大，这破坏了主题切换只影响颜色、不影响布局尺寸的预期。问题已经定位到 `app.js` 中主题切换前的尺寸锁定逻辑，因此需要一个最小且聚焦的修复变更，避免在不改动整体 UI 结构的前提下继续引入布局回归。

## What Changes

- 修正 chunk note 主题切换前的尺寸锁定逻辑，避免把 outer-box 尺寸错误写回 content-box 的 `width` 和 `height`
- 保持 dark/light 主题切换时 chunk note 的位置、宽高和渲染稳定，不再在每次切换后增长
- 保持现有主题 CSS 的颜色、阴影、玻璃效果行为不变
- 保持 `spawnChunkNoteTag()`、chunk note 渲染链和现有存储数据格式兼容，不引入广泛 UI 重构

## Capabilities

### New Capabilities
- `chunk-note-theme-size-stability`: 约束 chunk note 气泡在主题切换过程中的宽高稳定性，以及主题切换只允许影响视觉颜色而不允许影响布局尺寸

### Modified Capabilities
- 无

## Impact

- 受影响代码主要在 `app.js` 的 `lockChunkNoteDimensions()`、主题切换入口以及 chunk note tag 重渲染链
- 受影响样式对象为 `.chunk-note-tag`，但不要求修改现有主题 CSS 颜色 token
- 不涉及 `read-26.html` 结构调整，不涉及播放、高亮、字幕、AI 切分逻辑
