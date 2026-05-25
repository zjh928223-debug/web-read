# Safe Split Candidates

本文件列出基于当前真实代码得出的“最安全拆分顺序”。

## 总原则

- 不追求一次把 `app.js` 变成理想架构
- 只追求最小风险、逐步拆分
- 每一步都尽量保证现有行为不变
- 优先拆纯函数、纯 helper、参数清晰的小模块
- 暂时不碰核心渲染、播放心跳和全局交互事件链

## 第一梯队：继续抽纯函数 / 纯辅助

### Candidate 1: playback index helpers

建议抽出函数：
- `findChunkIndexByTime`
- `bsFindActive`
- `getCurrentSegmentIndex`
- `getSegmentCheckpoints`

为什么适合优先拆：
- 逻辑接近纯函数
- 可以通过参数化 `words`、`segments`、`chunkItems`、`wordStarts` 抽离
- 不必先改 DOM 或事件模型

风险：
- 需要明确 `currentAudioTime` 是否总是从参数传入
- 不能顺手改高亮行为

### Candidate 2: chunk text matching helpers

建议抽出函数：
- `clean`
- `tokenize`
- `findExactPhrase`
- `findExactPhraseFromIndex`
- `findMatchIndex`
- `clamp`

当前位置：
- `processChunkData` 内部局部函数

为什么适合优先拆：
- 这些是文本匹配算法，不是 UI 行为
- 抽出后能显著降低 `processChunkData` 的局部复杂度

风险：
- 不能在同一个 change 里顺手重写 chunk 边界逻辑
- 需要保持现有 fallback 策略完全不变

### Candidate 3: chunk note layout helpers

建议抽出函数：
- `measureChunkNoteTextBox`
- `getChunkNoteBaseFontSize`
- `getChunkNoteMinReadableFontSize`
- `sanitizeChunkNoteFontSize`
- `buildChunkNoteLayout`
- `getChunkNoteWrapTokens`
- `splitTokenToFitWidth`
- `wrapChunkNoteTextForCanvas`
- `truncateCanvasLine`

为什么适合优先拆：
- 这部分虽然依赖 DOM / canvas，但职责高度集中
- 基本不碰业务数据流

风险：
- 不能连带拖拽、resize、编辑态一起拆
- 布局 helper 和交互 helper 要严格分离

## 第二梯队：近纯共享模块

### Candidate 4: chunk note persistence adapters

建议范围：
- `buildChunkNotesSnapshot`
- `saveChunkNotesDebounced`
- `loadChunkNotesForCurrentAudio`
- `clearChunkNoteDraft`
- `persistChunkNoteDraft`
- `tryRestoreChunkNoteDraft`

为什么放第二梯队：
- 已经有明确 key helper，可进一步收束持久化边界
- 但它开始读取运行时内容身份和 UI 状态

风险：
- 若和渲染逻辑一起拆，会扩大回归面

### Candidate 5: cloze rendering helpers

建议范围：
- `buildClozeQuizMarkup`
- 可能补一个纯的 cloze card view-model helper

为什么放第二梯队：
- cloze 是较独立子功能
- 已有 `cloze-utils.js` 可作为边界外壳

风险：
- 不要把 chunk mode 底部插入逻辑和事件绑定一起搬走

## 第三梯队：边界收束，但仍避免核心心跳

### Candidate 6: import orchestration helpers

建议范围：
- transcript import handler 的解析、清理旧状态、保存顺序
- chunk import handler 的解析、保存顺序
- marks / chunk notes import-export 小链路

为什么放第三梯队：
- 这里已经不再是纯函数，但可以通过“流程 helper”减少顶层事件处理噪声

风险：
- 事件顺序很敏感
- 容易误伤焦点恢复、旧状态清理和按钮 loaded 状态

### Candidate 7: sentence notebook persistence boundary

建议范围：
- 继续扩展 `sentence-notes-persistence-utils.js`

为什么放第三梯队：
- 它有明确 doc-scope 持久化边界
- 但仍与选中句、草稿、侧栏刷新存在耦合

风险：
- 很容易误碰 note preview 行为

## 最后再碰：高风险核心

### High Risk A: `renderChunkMode()`

危险原因：
- 同时负责渲染、事件、cloze 注入、chunk note 恢复
- 是 AI 切分模式的中心枢纽

### High Risk B: `makeSpan()`

危险原因：
- 既是渲染 helper，又是点击行为入口
- 普通模式和 chunk 模式都依赖它

### High Risk C: 播放高亮心跳

范围：
- `loop`
- `mainUpdateHighlight`
- `followPlaybackTarget`

危险原因：
- 用户感知最强
- 很多先前 bug 都集中在这里

### High Risk D: 全局 keyboard / mouse listeners

危险原因：
- 快捷键和 selection 行为顺序敏感
- modal、chunk note、句注、输入框 guard 共用这层事件网

## 推荐的最安全拆分顺序

1. `processChunkData` 内部纯匹配 helper
2. playback index helpers
3. chunk note layout helpers
4. cloze 渲染辅助
5. chunk note persistence adapters
6. import orchestration helpers
7. sentence notebook persistence boundary 扩展
8. `renderChunkMode()` 局部拆分
9. `makeSpan()` 行为拆分
10. 播放高亮心跳与全局事件层

## 当前阶段不应优先改动的区域

- `renderChunkMode()`
- `makeSpan()`
- `mainUpdateHighlight`
- RAF 播放循环
- 全局 `keydown` / `mousedown` / `contextmenu` 监听
- 句注侧栏可见性与残留 DOM 引用清理

## 可直接作为下一个 change 的候选名

- `extract-playback-index-helpers`
- `extract-chunk-matching-helpers`
- `extract-chunk-note-layout-helpers`
- `extract-cloze-render-helpers`
