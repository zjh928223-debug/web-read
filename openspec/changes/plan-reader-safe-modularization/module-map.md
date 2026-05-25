# Reader Runtime Module Map

本文件用于记录当前仓库的真实运行结构，作为后续 safe split change 的引用基线。

## 1. 仓库运行入口

### 浏览器运行入口
- `read-26.html`
  - 负责页面骨架、按钮、文件输入、modal 容器、`#transcript-container` 阅读区
  - 通过多个 inline `onclick` 直接调用 `app.js` 中的全局函数
  - 负责按顺序引入：
    - `data-utils.js`
    - `identity-and-storage-keys.js`
    - `import-export-shared-helpers.js`
    - `sentence-notes-persistence-utils.js`
    - `cloze-utils.js`
    - `app.js`

### 本地验证入口
- `package.json`
  - `npm run preview` 使用 `http-server` 启动静态预览
  - `npm run verify:read26` 运行 `scripts/read26-load-check.js`
- `scripts/read26-load-check.js`
  - 用 Playwright 检查 `read-26.html` 能否无报错加载
  - 只验证页面加载与全局符号，不覆盖业务交互回归

## 2. 当前主要模块

### A. 页面骨架与 DOM 锚点
- 文件：`read-26.html`
- 责任：
  - 顶部控制区、音频与字幕导入、AI 切分控制、样式 modal、chunk note 上下文菜单
  - 通过 DOM id 为 `app.js` 提供所有控制入口
- 风险：
  - HTML 中仍保留 inline `onclick`
  - JS 和 HTML 强耦合，函数名和 DOM id 难以独立重构

### B. 全局样式与主题
- 文件：`styles.css`
- 责任：
  - 全局 token
  - transcript、chunk mode、chunk note、cloze、modal、note preview、glass 风格
- 风险：
  - 同时包含业务样式、主题 token、glass token
  - 全局命名空间大，覆盖关系复杂

### C. 存储与错误反馈
- 文件：`app.js`
- 代表函数：
  - `initDB`
  - `saveToDB`
  - `loadFromDB`
  - `deleteFromDB`
  - `clearDBStore`
  - `showToast`
  - `showError`
- 责任：
  - IndexedDB 单仓库存储
  - localStorage 辅助状态
  - 用户错误提示
- 特征：
  - 实现简单，但所有数据域都落在同一个 object store 中

### D. 纯数据校验与格式兼容
- 文件：
  - `data-utils.js`
  - `cloze-utils.js`
- 责任：
  - transcript / chunk / cloze / marks 的校验和宽松解析
  - cloze 答案归一化和 HTML 转义
- 特征：
  - 已经是当前仓库中最稳定、最适合继续拆分的区域

### E. 文档身份与存储 key
- 文件：`identity-and-storage-keys.js`
- 责任：
  - 音频 key、transcript key、sentence note doc id、chunk note draft key
- 特征：
  - 逻辑较纯，但仍通过 `app.js` 传入运行时上下文

### F. 导入导出共享辅助
- 文件：`import-export-shared-helpers.js`
- 责任：
  - 读取文件、取文件名、标记已加载、当前音频元数据辅助
- 特征：
  - 已是 safe split 的一部分成果

### G. transcript / chunk / cloze 数据处理层
- 文件：`app.js`
- 代表函数：
  - `processTranscript`
  - `resetClozeState`
  - `setClozeData`
  - `buildClozeQuizMarkup`
  - `handleClozeCheck`
  - `processChunkData`
  - `rebuildVocabMatching`
- 责任：
  - transcript 标准化进入运行时
  - AI chunk 对齐、fallback 和全局词索引映射
  - cloze 题目状态和底部题目生成
- 风险：
  - `processChunkData` 是核心高风险函数，兼容多种 `output.json` 格式
  - 这里既有纯文本匹配工具，也有核心业务决策

### H. 普通阅读渲染层
- 文件：`app.js`
- 代表函数：
  - `renderTranscript`
  - `renderWordsToContainer`
  - `makeSpan`
- 责任：
  - 普通 transcript 行渲染
  - 单词节点构建
  - 注释、点击跳转、标记态
- 风险：
  - `makeSpan` 混合了 DOM 生成和点击 seek 行为

### I. AI 切分渲染层
- 文件：`app.js`
- 代表函数：
  - `renderChunkMode`
  - `toggleManualChunkState`
  - `handleChunkSelectionContextMenu`
  - `refreshAllChunkNoteVisuals`
- 责任：
  - chunk block 渲染
  - 中文显示/隐藏
  - cloze 注入到底部
  - chunk note 标注恢复
  - chunk 点击与右键选择
- 风险：
  - `renderChunkMode` 责任极重，是最不适合第一批拆分的函数之一

### J. Chunk note 子系统
- 文件：`app.js`
- 范围：
  - 从 `measureChunkNoteTextBox` 到 `renderAllChunkNoteTags`
  - 再到 `openChunkNotePopover` / `upsertChunkNote` / `updateChunkNoteStyle`
- 责任：
  - 文本测量、自动尺寸、布局、tag 渲染、拖拽、resize、编辑、connector、导入导出
- 特征：
  - 内部凝聚力强，已经接近一个完整子系统
  - 但它同时依赖 `chunkItems`、DOM、主题和持久化

### K. Sentence notebook / note preview 子系统
- 文件：
  - `app.js`
  - `sentence-notes-persistence-utils.js`
- 代表函数：
  - `normalizeSentenceNotesScope`
  - `persistSentenceNotesForCurrentDoc`
  - `buildSentenceNoteItemElement`
  - `renderNotePreviewSidebar`
  - `setSelectedSentence`
- 责任：
  - 句注数据标准化、doc-scope 持久化、侧栏渲染、草稿和选中句状态
- 风险：
  - HTML 入口有残留断裂迹象，但运行时链仍在
  - 子系统本身较深，不宜第一批进入

### L. 播放同步、高亮与导航
- 文件：`app.js`
- 代表函数：
  - `bsFindActive`
  - `forceUpdateUI`
  - `getCurrentSegmentIndex`
  - `getSegmentCheckpoints`
  - `smartBackward`
  - `smartForward`
  - `handleBackwardClick`
  - `handleForwardClick`
  - `jumpPrevSentence`
  - `jumpNextSentence`
- 责任：
  - 当前时间映射到词/句/块
  - 高亮刷新
  - 快捷导航
  - 跟随滚动
- 风险：
  - 共享 `words`、`segments`、`chunkItems`、`highlightMode`
  - 与 RAF 心跳强耦合

### M. 全局交互与附加 UI 层
- 文件：`app.js`
- 范围：
  - import handlers
  - document/window listeners
  - theme toggle
  - glass 动效与 MutationObserver
- 风险：
  - 事件时序敏感
  - 很多逻辑没有清晰边界

## 3. 状态中心

当前项目更像一个“单文件状态机”，而不是清晰模块化的应用。核心共享状态包括：

- transcript 相关：
  - `words`
  - `segments`
  - `wordStarts`
- 播放与高亮：
  - `currentWordIndex`
  - `highlightMode`
  - `activeWordHighlightEl`
  - `activeSentenceEl`
  - `activeChunkEl`
  - `playbackUiSignature`
- AI 切分：
  - `isChunkMode`
  - `chunkItems`
  - `hasAiChunkData`
  - `chunkCnVisible`
  - `isChunkShadowOn`
  - `manualChunkStates`
- chunk note：
  - `chunkNoteVisible`
  - `chunkNotesMap`
  - `activeChunkNoteId`
  - `selectedChunkNoteId`
  - `chunkNoteModalEl`
  - `pendingChunkSelectionCtx`
- sentence notebook：
  - `currentDocId`
  - `sentenceNotesMap`
  - `allSentenceNotesByDoc`
  - `selectedSentence`
  - `sentenceNoteDraft`
- 当前内容身份：
  - `currentAudioMeta`
  - `currentAudioKey`

## 4. 当前承担过多职责的文件

### `app.js`
- 同时承担：
  - persistence
  - 解析与数据处理
  - 渲染
  - 事件绑定
  - layout 计算
  - note 子系统
  - 播放与导航
  - 主题和 UI 动效
- 这是当前第一大复杂度源头

### `styles.css`
- 同时承担：
  - 业务样式
  - 主题 token
  - AI 切分样式
  - chunk note 样式
  - note preview 样式
  - glass 风格样式

## 5. 当前明显缠在一起的功能

### `renderChunkMode` 链
- chunk 渲染
- 中文区逻辑
- cloze 注入
- chunk note 恢复
- click / contextmenu 行为

### `makeSpan` 链
- 单词渲染
- 普通模式点击跳转
- AI 切分模式选中句/块
- 词级 metadata 注入

### 播放高亮链
- `loop`
- `bsFindActive`
- `mainUpdateHighlight`
- `followPlaybackTarget`
- `getCurrentSegmentIndex`

### note 系统双轨
- chunk note
- sentence notebook

两者都是完整子系统，但共享页面、共享内容身份、共享某些 selection 和持久化上下文。

## 6. 半删除残留与危险信号

在 `app.js` 中仍存在若干 `getElementById(...)`，但 `read-26.html` 中已无对应元素：

- `toggle-sidebar-btn`
- `notes-file`
- `visual-file`
- `btn-import-sentence-notes`
- `import-sentence-notes-file`
- `btn-export-sentence-notes`
- `toggle-note-preview-btn`
- `note-preview-sidebar`
- `style-controls-container`
- `open-style-editor`

这说明当前代码并不是“干净的现状”，而是“现状 + 残留路径”的叠加体。
