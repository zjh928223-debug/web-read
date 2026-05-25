## Why

`processChunkData()` 在完成前两轮 chunk matching safe split 之后，仍然保留一层更细的纯结果整理逻辑，例如 candidate normalization、range/window 参数整理和 index correction 的纯计算段。这些逻辑不直接写 `chunkItems`，但仍散落在主控制流内部，导致匹配结果整理边界还不够清晰。

## What Changes

- 从 `processChunkData()` 中继续提取下一批纯匹配结果整理 helper，只覆盖不直接写 `chunkItems` 的 candidate normalization、小型 range/window/candidate 参数整理和 index correction 纯计算段
- 优先继续扩展现有 `chunk-matching-helpers.js`，不新增第二个 chunk matching 模块，除非实现中证明现有边界已明显失衡
- 在 `app.js` 中做最小接线，保留 `processChunkData()` 原入口、原控制流和原调用顺序
- 明确这次不处理 `chunkItems` 组装、fallback 主控制流、segment 时间范围推导、`globalWordCursor` 推进和 UI/DOM/播放链

## Capabilities

### New Capabilities
- `chunk-matching-normalization-boundary`: 约束 `processChunkData()` 中的纯匹配结果整理 helper 可以独立于 `app.js` 存在，同时保持 `output.json` 兼容语义和现有匹配行为不变

### Modified Capabilities
- 无

## Impact

- 直接影响 [app.js](/E:/小新备份文件/开发项目/lunix/read-final/app.js) 中 `processChunkData()` 的候选结果整理层
- 预计优先修改 [chunk-matching-helpers.js](/E:/小新备份文件/开发项目/lunix/read-final/chunk-matching-helpers.js)，并只在必要时调整 [read-26.html](/E:/小新备份文件/开发项目/lunix/read-final/read-26.html) 的脚本装配
- 间接影响 AI chunk 导入链内部算法结构，但本次 change 要求 `output.json` 输入兼容语义、匹配顺序和现有用户可见行为保持不变
