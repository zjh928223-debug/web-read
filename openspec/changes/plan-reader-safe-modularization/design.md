## Context

当前仓库是一个以浏览器端单页阅读器为核心的项目。实际运行入口是 `read-26.html`，样式集中在 `styles.css`，运行时行为几乎全部集中在 `app.js`。现有依赖非常少，`package.json` 主要提供本地预览与 Playwright 验证；因此项目的复杂度不是来自框架或后端，而是来自 `app.js` 内部过于集中的职责。

基于当前代码扫描，可以把实际运行结构概括为：

- `read-26.html`
  - 页面入口与 DOM 锚点
  - 顶部控制栏、文件输入、AI 切分入口、样式 modal 骨架
  - 通过多个 inline `onclick` 与 `app.js` 全局函数强耦合
- `styles.css`
  - 全局主题 token
  - transcript / chunk mode / chunk note / modal / note preview 样式
  - 既包含旧业务样式，也包含较新的 glass 风格样式
- `app.js`
  - IndexedDB / localStorage
  - transcript / chunk / cloze 导入与处理
  - 普通阅读模式渲染
  - AI 切分模式渲染
  - chunk note 系统
  - sentence notebook / note preview 系统
  - 播放同步、高亮、导航
  - 快捷键和全局交互
  - 主题和附加 UI 动效
- 已抽出的 helper
  - `data-utils.js`
  - `identity-and-storage-keys.js`
  - `import-export-shared-helpers.js`
  - `sentence-notes-persistence-utils.js`
  - `cloze-utils.js`

当前最大的结构特征不是“模块太多”，而是“几乎所有核心业务都还在 `app.js` 中，以共享全局状态的方式互相连接”。例如 `words`、`segments`、`chunkItems`、`chunkNotesMap`、`sentenceNotesMap`、`isChunkMode`、`highlightMode`、`currentAudioKey` 等运行状态都集中声明，并被渲染、存储、交互和播放逻辑直接读写。

同时，代码中仍保留一些已不在 `read-26.html` 中出现的 DOM 引用，例如 `toggle-sidebar-btn`、`notes-file`、`visual-file`、句注导入导出、note preview 侧栏相关元素。这说明项目处于“功能半移除但逻辑未完全退场”的状态，进一步提高了重构风险。

## Goals / Non-Goals

**Goals:**
- 建立一份基于真实文件和真实函数的运行结构地图，而不是停留在抽象层
- 识别当前最自然的模块边界、耦合最重的位置和最适合优先拆出的纯函数/辅助层
- 制定一个从低风险到高风险的 safe split 顺序，为后续 change 提供实施路线
- 明确哪些区域当前不应优先改动，以避免破坏播放、高亮、AI 切分和笔记系统

**Non-Goals:**
- 不在本 change 中直接改写 `app.js` 结构
- 不追求理想化的新架构设计
- 不重写主题系统、播放器、高亮系统或任意用户可见行为
- 不把“清理历史残留”与“安全拆分”混成同一个 change

## Decisions

### Decision: 以“运行时职责”而不是“页面区块”来识别模块边界
当前项目虽然是一个页面，但运行时职责实际上可以分成若干自然区域：

1. 存储与错误反馈
   - `initDB` / `saveToDB` / `loadFromDB` / `deleteFromDB`
   - `showToast` / `showError`
2. transcript / chunk / cloze 数据处理
   - `processTranscript`
   - `processChunkData`
   - `buildClozeQuizMarkup` / `handleClozeCheck`
3. 普通阅读渲染与 AI 切分渲染
   - `renderTranscript`
   - `renderChunkMode`
   - `renderWordsToContainer`
   - `makeSpan`
4. chunk note 子系统
   - 从 `measureChunkNoteTextBox` 到 `renderAllChunkNoteTags`
5. sentence notebook / note preview 子系统
   - 从 `normalizeSentenceNoteItem` 到 `renderNotePreviewSidebar`
6. 播放同步与导航
   - `bsFindActive`
   - `mainUpdateHighlight`
   - `getCurrentSegmentIndex`
   - `handleBackwardClick` / `handleForwardClick`
7. 全局事件与 UI 附加层
   - import handlers
   - keyboard listeners
   - theme toggle
   - glass effect wiring

相比按“按钮区域”或“UI 模块外观”来切，按运行时职责更接近真实耦合关系。

### Decision: safe split 第一阶段只动纯工具与纯辅助层
基于现状，最安全的拆分对象不是渲染层，也不是状态层，而是已经在代码中表现出纯函数形态、依赖明确、可通过参数化抽离的辅助逻辑。优先顺序为：

1. 纯校验/解析/文本处理函数
2. 纯 key derivation / persistence helper
3. 纯或近纯的 playback index helper
4. chunk note 布局与测量辅助
5. cloze / export / import 小型辅助

这样做的理由：
- 这些函数的副作用少
- 对 UI 行为影响窄
- 更适合先建立模块边界和引用模式

备选方案：
- 直接拆 `renderChunkMode()` 或 `mainUpdateHighlight()`
  - 风险高，因为会碰到用户最敏感的行为链
- 直接引入中心化 state store
  - 理论上更整洁，但当前项目没有稳定边界，先做会导致大面积连锁改动

### Decision: 把 `app.js` 视为“状态机外壳”，不要第一步去拆它的核心心跳
当前 `app.js` 最难动的不是函数数量，而是共享状态 + 事件顺序。例如：
- `renderChunkMode()` 同时负责 chunk 渲染、中文区、点击逻辑、cloze 注入、chunk note 恢复
- `makeSpan()` 同时承担渲染与点击 seek 行为
- `mainUpdateHighlight()` 与 RAF 播放循环、高亮模式、自动滚动直接耦合

因此在 safe split 路线中，应把这些保留在后半段，先让外围纯工具、存储辅助、布局辅助脱离主文件。

### Decision: 把“半删除残留”视为重构风险，而不是优先清理目标
当前存在一批 DOM 引用仍留在 `app.js`，但 HTML 中已无对应节点。这些残留说明：
- 某些逻辑可能已不再暴露到 UI
- 但内部仍可能被别的状态流程使用

因此本阶段不把它们列为“先删再说”，而是作为风险提示记录下来。真正清理时应该单独开 change，避免与模块拆分混合。

## Risks / Trade-offs

- [Risk] 过早拆渲染层会触发播放、高亮、点击 seek、笔记选择等连锁回归
  → Mitigation：前几步只拆纯工具、校验、存储辅助和布局辅助

- [Risk] `app.js` 中的共享全局状态过多，抽函数时容易隐式依赖遗漏
  → Mitigation：每次拆分都先限定在“参数可显式传入”的小函数集合，不跨事件时序边界

- [Risk] 当前 HTML 与 JS 通过 inline `onclick` 和大量 `getElementById` 强耦合，未来模块化时会暴露更多历史残留
  → Mitigation：先记录并分类耦合点，暂不在本 change 中改事件绑定模型

- [Risk] 句注系统与 chunk note 系统都属于“次级子系统”，但一个仍保留较深持久化链，一个仍保留较深布局链，贸然处理会让路线失焦
  → Mitigation：safe split 第一阶段只提炼两者的纯辅助层，不动交互主链

## Migration Plan

建议把后续拆分实施分成四层：

1. 继续抽纯函数
   - 文本匹配、时间索引、导入校验、导出帮助函数
2. 抽近纯辅助
   - chunk note 布局计算
   - cloze 渲染 view-model
3. 收束边界
   - import orchestration
   - persistence adapters
4. 最后才碰高风险核心
   - `renderChunkMode()`
   - `makeSpan()`
   - `mainUpdateHighlight()`
   - 全局 keyboard / mouse listeners

这个计划不要求一次完成。每一层都可以单独开 change，并通过现有 `verify:read26` 与最小浏览器回归验证保底。

## Open Questions

- 是否要为 `app.js` 维护一份持续更新的“runtime map”文档，作为每次拆分 change 的前置上下文
- 后续第一批拆分是否继续沿用 `window.*` helper 挂载模式，还是逐步转向更显式的模块接口
- 对于已不在 HTML 中出现的残留 DOM 引用，后续是先归类为 dead path，还是先保守保留直到有更明确证据
