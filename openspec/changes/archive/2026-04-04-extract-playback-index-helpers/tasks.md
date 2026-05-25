## 1. 提取 helper 边界

- [x] 1.1 从 `app.js` 中确认第一批要抽离的 playback index / time mapping helper，仅限 `findChunkIndexByTime`、`bsFindActive`、`getCurrentSegmentIndex`、`getSegmentCheckpoints`
- [x] 1.2 将这批 helper 设计为只依赖显式参数的数据函数，不依赖 DOM，不读取 `audioPlayer.currentTime`

## 2. 最小实现

- [x] 2.1 新增独立 helper 文件并暴露 playback index helper，保持当前仓库的 `window.*` helper 模式
- [x] 2.2 在 `read-26.html` 和 `app.js` 中做最小接线，保持上层播放、高亮、导航调用顺序不变

## 3. 验证

- [x] 3.1 验证 `app.js` 语法和页面加载正常
- [x] 3.2 验证抽离后现有 playback index / time mapping 相关行为没有明显回归
