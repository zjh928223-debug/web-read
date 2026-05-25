## Why

`plan-reader-safe-modularization` 已经明确把 playback index / time mapping helper 列为第一批最适合安全拆分的候选对象。当前这些函数仍留在 `app.js` 中，和播放高亮主链处于同一区段；若不先把这批纯函数或近纯函数抽出，后续继续拆 `app.js` 时很难建立稳定、低风险的边界。

## What Changes

- 从 `app.js` 中提取第一批最安全的 playback index / time mapping helper 到独立模块
- 候选范围限定为不依赖 DOM、只依赖显式传入数据的函数，例如：
  - `findChunkIndexByTime`
  - `bsFindActive`
  - `getCurrentSegmentIndex`
  - `getSegmentCheckpoints`
- 保持 `app.js` 外部行为、播放逻辑、高亮逻辑和事件顺序完全不变
- `app.js` 只做最小接线，继续保留调用顺序和上层业务流程

## Capabilities

### New Capabilities
- `playback-index-helper-boundary`: 约束 playback index / time mapping helper 可以独立成模块，并保持对上层播放与高亮行为的兼容

### Modified Capabilities
- 无

## Impact

- 直接影响 `app.js` 中播放索引相关函数的组织方式
- 会新增一个 very small helper 模块文件，供 `read-26.html` 和 `app.js` 接线使用
- 不涉及 `renderChunkMode`、`makeSpan`、事件监听、RAF 循环、chunk note 或 sentence note 主流程
