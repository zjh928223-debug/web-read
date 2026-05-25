## Why

`processChunkData()` 已经完成了第一批纯文本 helper 抽离，但内部仍保留一层更细的纯匹配算法逻辑，例如 exact phrase matching 的局部/全局变体、局部与全局搜索中共用的 clamp/range/scoring/index correction 小算法。这些逻辑仍然混在 `processChunkData()` 控制流内部，导致匹配核心还没有真正形成稳定的独立边界。

## What Changes

- 从 `processChunkData()` 中继续提取第二批纯匹配算法 helper，只覆盖不直接产出 `chunkItems` 的匹配辅助函数
- 统一 exact phrase matching 的 range / fromIndex 变体，使其通过显式参数工作
- 提取局部/全局查找中可参数化的 clamp、range、scoring、index correction 小算法
- 在 `app.js` 中对 `processChunkData()` 做最小接线，保留原入口、原控制流和原调用顺序
- 明确这次不处理 `chunkItems` 组装、fallback 主控制流、segment 时间范围推导，也不触碰 UI、DOM、`renderChunkMode()`、事件、播放器和高亮逻辑

## Capabilities

### New Capabilities
- `chunk-matching-core-boundary`: 约束 `processChunkData()` 内部第二批纯匹配算法 helper 可以独立于 `app.js` 存在，同时保持 `output.json` 兼容语义和现有匹配行为不变

### Modified Capabilities
- 无

## Impact

- 直接影响 [app.js](/E:/小新备份文件/开发项目/lunix/read-final/app.js) 中 `processChunkData()` 的局部算法层
- 预计会新增或扩展 chunk matching 相关 helper 文件，并在 [read-26.html](/E:/小新备份文件/开发项目/lunix/read-final/read-26.html) 中保持最小脚本装配变更
- 间接影响 AI chunk 导入链的匹配算法内部结构，但本次 change 要求 `output.json` 输入兼容语义、匹配顺序和现有用户可见行为保持不变
