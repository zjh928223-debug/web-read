# Read-Final

## English (AI Reference)

### Quick Facts

| Item | Value |
|------|-------|
| Type | Zero-framework SPA (no React/Vue/TS) |
| Entry | `read-26.html` |
| Core | `app.js` (~7300 lines) |
| Styles | `styles.css` (~2500 lines, Liquid Glass design system) |
| Runtime | Browser only — IndexedDB + localStorage + OPFS |
| AI Backend | Google Gemini API (`gemini-2.5-flash`) |
| DB | `SeekPlayerDB` v1, single store `files`, keyPath `id` |
| Verify | `npm test` (http-server + Playwright load check) |
| Node deps | `http-server`, `playwright` (dev only) |

### Script Load Order = Dependency Graph

All modules are IIFE-attached to `window`/`global`. Load order **is** the dependency chain — must not be reordered.

```
# read-26.html <script> order:
1.  data-utils.js                       → window.DataUtils
2.  identity-and-storage-keys.js        → window.IdentityStorageKeys
3.  import-export-shared-helpers.js     → window.ImportExportSharedHelpers
4.  sentence-notes-persistence-utils.js → window.SentenceNotesPersistenceUtils
5.  cloze-utils.js                      → window.ClozeUtils
6.  cloze-view-model-helpers.js         → window.ClozeViewModelHelpers
7.  chunk-note-layout-helpers.js        → window.ChunkNoteLayoutHelpers
8.  chunk-note-layout-core.js           → window.ChunkNoteLayoutCore
9.  playback-index-helpers.js           → window.PlaybackIndexHelpers
10. chunk-matching-helpers.js           → window.ChunkMatchingHelpers
11. annotation-bubble.js                → window.AnnotationBubble
12. annotation-target-source.js         → window.AnnotationTargetSource
13. annotation-generation-diagnostics.js          → window.AnnotationGenerationDiagnostics
14. annotation-generation-diagnostics-records.js  → window.AnnotationGenerationDiagnosticsRecords
15. annotation-run-diagnostics.js                 → window.AnnotationRunDiagnostics
16. annotation-generation-diff.js                 → window.AnnotationGenerationDiff
17. annotation-block-planner.js                   → window.AnnotationBlockPlanner
18. annotation-prompt-builder.js                  → window.AnnotationPromptBuilder
19. annotation-api-config.js                      → window.AnnotationApiConfig
20. annotation-api-settings-ui.js                 → window.AnnotationApiSettingsUI
21. annotation-api-client.js                      → window.AnnotationApiClient
22. annotation-generation-progress-store.js       → window.AnnotationGenerationProgressStore
23. annotation-generation-storage.js              → window.AnnotationGenerationStorage
24. annotation-generation-controller.js           → window.AnnotationGenerationController
25. annotation-generated-result-store.js          → window.AnnotationGeneratedResultStore
26. annotation-click-resolver.js                  → window.AnnotationClickResolver
27. annotation-generation-entry-ui.js             → window.AnnotationGenerationEntryUI
28. app.js                                       ← consumes all above via global namespaces
```

### Module-to-Namespace Cross-Reference

| File | Exposes | Key exports (callable from app.js) |
|------|---------|-------------------------------------|
| `data-utils.js` | `DataUtils` | `isPlainObjectRecord`, `isFiniteNum`, `getLooseProp`, `validateTranscriptData`, `validateChunkData`, `validateMarksArray` |
| `identity-and-storage-keys.js` | `IdentityStorageKeys` | `buildAudioKey`, `buildTranscriptKey`, `buildCurrentSentenceDocId`, `getChunkNotesStorageKey`, `getSentenceNotesStorageKey`, `getLegacySentenceNotesStorageKey` |
| `import-export-shared-helpers.js` | `ImportExportSharedHelpers` | `getFirstFileFromEvent`, `getCurrentAudioFilenameBase`, `buildCurrentAudioMetaState`, `markFileLoaded`, `readFileAsText` |
| `sentence-notes-persistence-utils.js` | `SentenceNotesPersistenceUtils` | `ensureLegacySentenceNotesForDoc`, `getCurrentSentenceDocIdForExport` |
| `cloze-utils.js` | `ClozeUtils` | `validateClozeData`, `normalizeClozeAnswer` |
| `cloze-view-model-helpers.js` | `ClozeViewModelHelpers` | `createInitialClozeAnswerState`, `getClozeCardStateViewModel`, `buildClozeCardViewModel` |
| `chunk-note-layout-helpers.js` | `ChunkNoteLayoutHelpers` | Layout math (wrapping, positioning, SVG connector geometry) |
| `chunk-note-layout-core.js` | `ChunkNoteLayoutCore` | `normalizeChunkNoteLayoutResult`, `buildEmptyChunkNoteLayoutResult` |
| `playback-index-helpers.js` | `PlaybackIndexHelpers` | `findChunkIndexByTime`, `bsFindActive`, `getCurrentSegmentIndex`, `getSegmentCheckpoints` |
| `chunk-matching-helpers.js` | `ChunkMatchingHelpers` | `findExactMatchRange`, `tokenizeText`, `cleanText`, `clamp` |
| `annotation-bubble.js` | `AnnotationBubble` | `init`, `show`, `hide`, `toggle`, `isVisible`, `setAnnotation`, `clearAnnotation` |
| `annotation-target-source.js` | `AnnotationTargetSource` | `buildTargetSource(context)` — extracts annotation targets from marks + transcript blocks |
| `annotation-generation-diagnostics.js` | `AnnotationGenerationDiagnostics` | Debug logging & diagnostic data collection |
| `annotation-generation-diagnostics-records.js` | `AnnotationGenerationDiagnosticsRecords` | Structured record store for diagnostics |
| `annotation-run-diagnostics.js` | `AnnotationRunDiagnostics` | Run-level diagnostic aggregation |
| `annotation-generation-diff.js` | `AnnotationGenerationDiff` | Diff helper for incremental annotation updates |
| `annotation-block-planner.js` | `AnnotationBlockPlanner` | `planFromContext(context, options)` — splits doc into LLM-friendly blocks |
| `annotation-prompt-builder.js` | `AnnotationPromptBuilder` | Builds Gemini prompt text from planned blocks |
| `annotation-api-config.js` | `AnnotationApiConfig` | API credential CRUD; also exposes `__ANNOTATION_API_CONFIG__` |
| `annotation-api-settings-ui.js` | `AnnotationApiSettingsUI` | Renders API settings form into `#annotation-api-settings-panel` |
| `annotation-api-client.js` | `AnnotationApiClient` | HTTP client for Gemini; handles 503 retry, timeout, streaming |
| `annotation-generation-progress-store.js` | `AnnotationGenerationProgressStore` | `createProgressStore` — per-block progress tracking |
| `annotation-generation-storage.js` | `AnnotationGenerationStorage` | Dual-backend persistence (localStorage + OPFS directory handle) |
| `annotation-generation-controller.js` | `AnnotationGenerationController` | Main orchestrator: rate limiting, retry, abort, scheduling |
| `annotation-generated-result-store.js` | `AnnotationGeneratedResultStore` | In-memory index: by wordIndex, by markedToken, by boundaryToken |
| `annotation-click-resolver.js` | `AnnotationClickResolver` | Resolves click event → annotation, matching by boundary/word/marked text |
| `annotation-generation-entry-ui.js` | `AnnotationGenerationEntryUI` | Button state machine (21 states: idle, running, complete, failed, etc.) |
| `app.js` | (global functions) | `handleBackwardClick`, `handleForwardClick`, `changeSpeed`, `cycleHighlightMode`, `toggleChunkMode`, `toggleChunkFocusMode`, `openChunkStyleModal`, `closeChunkStyleModal`, `toggleChunkShadowManual`, `updateChunkStyle`, `updateChunkNoteStyle`, `openChunkNoteStyleModal`, `closeChunkNoteStyleModal` |

### Subsystem → File Map

```
Audio playback + sync highlight:
  app.js (audio events, renderTranscript, renderChunkMode)
  playback-index-helpers.js (binary search, segment index)

Chunk mode (AI-split reading view):
  app.js (renderChunkMode, chunk click/word click)
  chunk-note-layout-helpers.js + chunk-note-layout-core.js (SVG note balloons)
  chunk-matching-helpers.js (fuzzy word-to-chunk alignment)
  styles.css (--chunk-* CSS variables)

Cloze quizzes:
  app.js (cloze rendering, answer checking)
  cloze-utils.js (validation)
  cloze-view-model-helpers.js (view model)

Word marking:
  app.js (m key, markedMap, saveToDB('marks'), render)

Annotation pipeline (Gemini):
  annotation-target-source.js → annotation-block-planner.js
    → annotation-prompt-builder.js → annotation-api-client.js
    → annotation-generation-controller.js (orchestrates all)
  annotation-generation-storage.js (save bundles)
  annotation-generation-progress-store.js (per-block state)
  annotation-generated-result-store.js (in-memory query index)
  annotation-generation-diff.js (incremental update)
  annotation-click-resolver.js (click → annotation lookup)
  annotation-bubble.js (floating definition panel)

Annotation UI:
  annotation-generation-entry-ui.js (generate button state machine)
  annotation-api-settings-ui.js (API key/config form)
  annotation-api-config.js (credential CRUD)

Notes system:
  app.js (chunk notes: modal + SVG overlay; sentence notes: sidebar editor)
  sentence-notes-persistence-utils.js (legacy migration, export helpers)

Theme:
  app.js (toggle, custom color panel, CSS variable injection)
  styles.css (:root tokens, .dark-mode overrides, Liquid Glass tokens)
```

### Constraints (DO NOT touch without explicit plan)

1. **`app.js`** — global state machine; all rendering + event wiring lives here. Modifying one area easily breaks unrelated areas.
2. **`annotation-generation-controller.js`** — async state machine with rate limiting (16s interval), retry logic (max 1 retry), abort handling. Hard to debug.
3. **`annotation-api-client.js`** — handles API keys in memory. Security-sensitive. Do not log keys.
4. **IndexedDB schema** — `SeekPlayerDB` v1, store `files`, keyPath `id`. Must not change. All new persistence must use new keys within existing store.
5. **Script load order in `read-26.html`** — see load order table above. Breaking this breaks all module-to-module references.
6. **`package.json`** — no dependency changes unless explicitly requested.
7. **`cankao/`** — reference only, never touch.

### High-risk files (modify only with plan + verify)

| File | Lines | Risk |
|------|-------|------|
| `app.js` | 7287 | Central state, rendering, all DOM event wiring |
| `annotation-generation-controller.js` | 1591 | Async orchestration with rate limit, retry, abort |
| `annotation-api-client.js` | 795 | Gemini HTTP; API key handling |
| `annotation-generation-storage.js` | 269 | Dual-backend persistence (localStorage + OPFS) |
| `styles.css` | 2520 | Cross-cutting glass-morphism design system |
| `annotation-target-source.js` | 411 | Markup parsing used by the entire generation pipeline |
| `annotation-block-planner.js` | 333 | Block size constraints affect LLM output quality |
| `data-utils.js` | 186 | Transcript parsing; failure blocks ALL data loading |

### Verify commands

```bash
npm run preview          # Serve at http://127.0.0.1:4173
npm test                 # Alias for npm run verify:read26
npm run verify:read26    # Start http-server + Playwright load check of read-26.html
```

---

## 中文

### 功能概览

一个零框架的单页面语言学习工具，纯 HTML/CSS/JS 实现，支持：

- **音频播放 + 同步字幕** — 加载音频文件和 JSON 字幕，播放时自动高亮当前词/句
- **AI 切分模式** — 将长文按语义分块展示，支持中英对照、全文注释
- **Cloze 填空练习** — 从字幕生成挖空题，作答后自动判对错
- **单词标记系统** — 按 `m` 键标记生词，标记数据持久化到 IndexedDB
- **Google Gemini 全文注释** — 自动为标记词/生词生成释义、例句、记忆提示等
- **句子笔记本** — 侧边栏记录句子笔记，支持跨文档作用域管理
- **区块备注系统** — 在 AI 切分模式下添加块级备注，SVG 浮层展示
- **Glass-morphism 主题系统** — Liquid Glass 设计风格，支持浅色/深色/自定义配色

### 项目结构（按层级）

```
read-26.html                   ← 入口 HTML，按顺序加载所有脚本

数据与校验层:
  data-utils.js                ← 字幕/切分/标记数据验证与解析
  identity-and-storage-keys.js ← IndexedDB 存储 key 生成

纯工具层（无副作用）:
  cloze-utils.js               ← 填空数据校验、答案标准化
  cloze-view-model-helpers.js  ← 填空卡片视图模型构建
  chunk-matching-helpers.js    ← 模糊文本匹配引擎
  playback-index-helpers.js    ← 二分查找（按时间定位词/句/块）
  chunk-note-layout-helpers.js ← 备注气球排版计算
  chunk-note-layout-core.js    ← 排版结果规范化

持久化层:
  import-export-shared-helpers.js     ← 文件读写、导出下载
  sentence-notes-persistence-utils.js ← 句子笔记生命周期管理

独立 UI 组件:
  annotation-bubble.js                ← 浮动释义气泡（可拖拽/缩放）
  annotation-generation-entry-ui.js   ← 生成按钮状态机（21种状态）
  annotation-api-settings-ui.js       ← API 设置面板表单

注释管线（Gemini AI）:
  annotation-target-source.js               ← 从标记和字幕中提取注释目标
  annotation-block-planner.js                ← 将文档拆分为适合 LLM 的块
  annotation-prompt-builder.js               ← 构建 Gemini 提示词
  annotation-api-config.js                   ← API 凭据增删改查
  annotation-api-client.js                   ← Gemini HTTP 客户端（含重试/超时）
  annotation-generation-controller.js         ← 异步编排器（限速/重试/中止）
  annotation-generation-storage.js            ← 注释数据持久化（localStorage + OPFS）
  annotation-generation-progress-store.js     ← 逐块进度追踪
  annotation-generated-result-store.js       ← 内存索引（按词序/标记/边界查询）
  annotation-generation-diff.js              ← 增量更新差异对比
  annotation-generation-diagnostics.js       ← 调试诊断数据收集
  annotation-generation-diagnostics-records.js ← 结构化诊断记录
  annotation-run-diagnostics.js              ← 运行级诊断聚合
  annotation-click-resolver.js               ← 点击事件 → 注释条目匹配

核心总控:
  app.js         (~7300 行) — 所有业务逻辑：IndexedDB、状态管理、渲染、事件绑定

样式:
  styles.css     (~2500 行) — Liquid Glass 设计系统 + 深色模式 + 切分/备注/笔记本/模态框样式

测试:
  scripts/read26-verify.js      ← 拉取字符串校验
  scripts/read26-load-check.js  ← Playwright 页面加载检查

其他目录:
  cankao/        ← 参考版（旧版，不参与运行）
  output/        ← 日志和 Playwright 产物（gitignore）
```

### 注释管线数据流

```
用户标记词 (m key)
    ↓
markedMap (app.js) → saveToDB('marks')
    ↓
annotation-target-source.js
  提取: 标记词 + 字幕中的 markup 标记 + 句内共现关系
    ↓
annotation-block-planner.js
  拆分: 按 token 数量/目标数量约束，切分为 LLM 可处理的块
  参数: softMinWords=520, softMaxWords=760, softMaxTargets=24
    ↓
annotation-prompt-builder.js
  构建: 将块数据 + 上下文句 + JSON schema 模板组装为 prompt
    ↓
annotation-api-client.js
  发送: POST https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent
  处理: 503 重试、超时、响应流式解析
    ↓
annotation-generation-controller.js
  编排: RUN_REQUEST_BUDGET=6, REQUEST_START_INTERVAL_MS=16000
        MAX_RETRY_ATTEMPTS_PER_BLOCK=1
  状态: idle → running → complete / stopped / failed / incomplete
    ↓
annotation-generation-storage.js
  存储: 本地 annotation.generated.json + annotation.status.json
        (localStorage 备份 + OPFS 目录句柄持久化)
    ↓
annotation-generated-result-store.js
  索引: byWordIndex / byMarkedToken / byBoundaryToken
    ↓
annotation-click-resolver.js
  匹配: 点击位置 → 按 BOUNDARY_EXACT > BOUNDARY_CONTAINS > MARKED_TEXT_EXACT 优先级匹配
    ↓
annotation-bubble.js
  展示: 浮动面板显示 word / type / meaning / memoryHint
```

### 数据存储说明

**IndexedDB**: `SeekPlayerDB` v1, store `files`, keyPath `id`

| 存储内容 | key 示例 | 生成方式 |
|---------|---------|---------|
| 音频 Blob | `audio-{filename}-{size}-{lastModified}` | `IdentityStorageKeys.buildAudioKey()` |
| 字幕 JSON | `transcript-{段数}-{词数}-{首尾时间}-{哈希}` | `IdentityStorageKeys.buildTranscriptKey()` |
| 标记数据 | `marks` | 固定 key |
| 填空数据 | `cloze` | 固定 key |
| AI 切分数据 | `chunks` | 固定 key |
| 区块备注 | `{transcriptKey}--chunk-notes` | `IdentityStorageKeys.getChunkNotesStorageKey()` |
| 句子笔记 | `{transcriptKey}--sentence-notes` | `IdentityStorageKeys.getSentenceNotesStorageKey()` |
| 注释包 | `annotation-full-generated-{scope key}` | 独立 key 模式 |

**localStorage**: API 配置、注释状态、气泡位置偏好、主题设置等。

**OPFS (Origin Private File System)**: 注释生成结果的大文件持久化，通过目录句柄写入。

### 扩展指引

#### 新建一个纯工具模块

```javascript
// my-utils.js
(function (global) {
    'use strict';

    function myHelper(input) {
        return String(input).toLowerCase();
    }

    global.MyUtils = { myHelper };
})(window);
```

将其 `<script>` 标签插入 `read-26.html`，排在它依赖的模块之后、`app.js` 之前。

#### 新建一个 UI 面板

1. 在 `read-26.html` 中添加 DOM 容器（使用 id）
2. 在 `styles.css` 中添加样式规则
3. 新建 JS 模块（IIFE 模式），挂载到 `window`
4. 在 `app.js` 中调用该模块的 `init` 方法，传入 DOM 引用和数据依赖
5. 在 `read-26.html` 中将新 JS 插入正确位置

#### 在注释管线中插入新节点

管线的各个环节通过 `global` 命名空间松散耦合。插入新节点：

1. 确定插入位置（例如在 `prompt-builder` 和 `api-client` 之间）
2. 新建模块，在 `read-26.html` 中按位置插入 `<script>` 标签
3. 在 `annotation-generation-controller.js` 中调用新模块的方法

**注意**：controller 内部直接引用 `BLOCK_PLANNER`、`PROMPT_BUILDER`、`API_CLIENT` 等全局对象，这些引用在第4-11行声明。修改这些常量即可替换管线节点。

#### 修改配色/主题

- 基础颜色变量在 `styles.css` 的 `:root` 块（第1-120行）
- 自定义配色面板在 `app.js` 的 theme 相关函数中
- 所有动态 CSS 变量通过 `document.documentElement.style.setProperty()` 覆写

### 开发者须知

1. **修改 app.js 前** — 必须先制定计划。7287行中，存储、解析、渲染、事件、主题全部混杂在一个文件中，改动一处可能影响完全不相干的功能。

2. **注释管线是异步状态机** — `annotation-generation-controller.js` 处理限速（16s间隔）、重试（最多1次）、中止、部分完成等多种状态。修改前需要理解所有状态转换路径。

3. **不要碰 IndexedDB schema** — `SeekPlayerDB` v1 的结构一旦改变，所有已存储数据将不可用。新增持久化需求应复用现有 `files` store。

4. **不要改 read-26.html 中的 script 加载顺序** — 模块间通过 `window` 全局对象通信，没有模块系统。顺序错误会导致 `undefined is not a function` 且不易排查。

5. **API key 安全** — `annotation-api-client.js` 和 `annotation-api-config.js` 处理 Google Gemini API key，保存在 `localStorage` 中。不要在任何日志或导出中包含 key。

6. **建议的修改顺序（安全→危险）**:
   - 纯工具模块（cloze-*, playback-index, chunk-*-helpers）
   - 独立 UI 组件（bubble, entry-ui, api-settings-ui）
   - Prompt/数据结构（prompt-builder, block-planner, target-source）
   - 存储层（generation-storage, progress-store, result-store）
   - 管线编排（generation-controller, api-client）
   - 样式（styles.css）
   - HTML（read-26.html）
   - **app.js（最后）**

7. **验证** — 任何代码修改后运行 `npm test`，确认页面可正常加载且 Playwright 检查通过。
