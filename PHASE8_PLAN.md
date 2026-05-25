# Phase 8: Composables Split Plan

## 目标

将 app.js 剩余 6930 行拆分成 8 个 composable 文件。拆分后 app.js 预计减至 ~3000 行（仅剩状态声明 + DOM 绑定 + 组装调用）。

## 约束

- 所有函数体内部逻辑一字不改
- app.js 的状态变量（words, segments, markedMap 等）继续留在 app.js
- composable 通过依赖注入接收状态参数
- 每个 composable 是 IIFE，挂 `window.__composable_xxx`
- 加载顺序：composable scripts 在 stores 之后、app.js 之前

## 8 个 Composable

### C1. glass-effects.js（风险：🟢 低，~115行）

**提取行号**：7172-7284（`initLiquidGlassUIInteractions` IIFE）

**依赖**：仅 `document`、`window` 原生 API，无 app.js 状态依赖

**拆分方式**：直接搬走整个 IIFE，在 app.js 用一行调用 `window.__glassEffects.init()`

**app.js 减少**：~115 行

---

### C2. keyboard.js（风险：🟢 低，~150行）

**提取行号**：
- 6679-6735（全局 keydown handler）
- 6727-6739（keyup handler）
- 7083-7085（Escape handler）
- 6542-6560（快捷键输入绑定）
- 6533-6540（高亮颜色输入绑定）

**依赖**：
- `isInputLikeTarget`（工具函数，已在 app.js）
- `markKey, notesKey, annotationBubbleKey, chunkCnKey, chunkShadowKey, chunkNoteKey, backwardKey, forwardKey`（字符串变量）
- `markedMap, currentWordIndex, words, isChunkMode, chunkCNHoldMode, chunkNoteVisible`（状态）
- `toggleMarkCurrent, toggleCurrentNote, toggleAnnotationBubble`等函数

**拆分方式**：
```javascript
// composable 接收配置对象
window.__keyboard = {
  init(config) {
    // config = { markKey, currentWordIndex, ... }
    // 复制所有 handler 逻辑
  }
}
```

**app.js 减少**：~150 行

---

### C3. import-handlers.js（风险：🟡 中，~200行）

**提取行号**：4767-4969（import handlers）+ 4413-4633（部分与 import 重叠）

**依赖**：大量 app.js 变量和函数
- `audioFileInput, transcriptFileInput, chunkFileInput, clozeFileInput`
- `processTranscript, setClozeData, processChunkData`
- `saveToDB, loadFromDB, showToast, showError`
- `lblAudio, lblTranscript`（DOM label 元素）

**拆分方式**：
```javascript
window.__importHandlers = {
  bindAudioImport(audioInput, saveToDB, processFn, ...) { ... },
  bindTranscriptImport(input, saveToDB, processFn, ...) { ... },
  bindChunkImport(input, processFn, ...) { ... },
  bindClozeImport(input, setDataFn, ...) { ... },
  bindMarksImport(input, btn, markedMap, ...) { ... },
}
```

**app.js 减少**：~200 行

---

### C4. export-handlers.js（风险：🟡 中，~80行）

**提取行号**：6790-6830（导出 JSON/TXT/Marks） + chunk note 导出（6660-6698）

**拆分方式**：
```javascript
window.__exportHandlers = {
  bindMarksExport(btn, markedMap) { ... },
  bindTranscriptExport(btn, segments, markedMap) { ... },
  bindChunkNotesExport(btn, ...) { ... },
}
```

**app.js 减少**：~80 行

---

### C5. chunk-note-layout.js（风险：🟢 低，~175行）

**提取行号**：101-274（chunk-note data/layout utilities）

**依赖**：大部分是纯函数，少数依赖 app.js 变量（chunkNotesMap, words）

**拆分方式**：直接搬函数体，暴露到 `window.__chunkNoteLayout`

**app.js 减少**：~175 行

---

### C6. playback-navigation.js（风险：🟡 中，~350行）

**提取行号**：6173-6523（播放导航 + smartBackward/smartForward + nextSentence）

**依赖**：
- `segments, words, wordStarts, currentWordIndex, wordTimes`
- `highlightMode, isChunkMode, chunkItems, isAiChunkNavMode`
- `bsFindActive, getCurrentSegmentIndex, getSegmentCheckpoints`
- `audioPlayer` DOM 元素

**拆分方式**：所有函数搬走，app.js 留 thin wrapper

**app.js 减少**：~350 行

---

### C7. rendering.js（风险：🔴 高，~510行）

**提取行号**：4950-5459（renderTranscript + renderChunkMode + renderChunkBlock 等）

**依赖**：几乎所有 app.js 状态变量

**拆分方式**：
```javascript
window.__rendering = {
  renderTranscript(state) { /* state = { segments, words, wordStarts, markedMap, ... } */ },
  renderChunkMode(state) { ... },
  renderWordsToContainer(words, container) { ... },
}
```

**风险点**：渲染函数修改 DOM 并设置 app.js 的 local 变量（如 `lastActiveSegIndex`）。这些变量状态必须通过 state 对象追踪。

**app.js 减少**：~510 行

---

### C8. session.js（风险：🔴 高，~2100行）

**提取行号**：2264-4362（startup restore/init flow — 整个 `initDB().then(...)` 块）

**依赖**：几乎所有 app.js 函数和变量

**拆分方式**：
```javascript
window.__session = {
  init(config) {
    // config = { initDB, saveToDB, loadFromDB, processTranscript, renderTranscript, ... }
    // 搬走整个 startup flow
  }
}
```

**app.js 减少**：~2100 行

**注意**：这是最大的一刀。拆完后 app.js 只剩状态声明 + DOM 绑定 + 组装调用（~1500 行）。

---

## 执行顺序（1 → 8）

| # | Composable | 风险 | 减少行数 |
|---|-----------|------|---------|
| 1 | glass-effects | 🟢 | ~115 |
| 2 | chunk-note-layout | 🟢 | ~175 |
| 3 | keyboard | 🟢 | ~150 |
| 4 | export-handlers | 🟡 | ~80 |
| 5 | import-handlers | 🟡 | ~200 |
| 6 | playback-navigation | 🟡 | ~350 |
| 7 | rendering | 🔴 | ~510 |
| 8 | session | 🔴 | ~2100 |

## 最终 app.js 结构（约 1500 行）

```
// === Read-order map ===
// Phase 8 — composables loaded before app.js (all ~8 scripts)

// === State declarations === (~60行)
let words = [], segments = [], wordStarts = [], ...
let currentWordIndex, highlightMode, autoFollow, ...
const markedMap = new Map()
let isChunkMode, chunkItems, ...

// === DOM bindings === (~80行)
const audioPlayer = document.getElementById('audio-player');
const transcriptContainer = document.getElementById('transcript-container');
...

// === Assembly: call composables with state === (~200行)
window.__glassEffects.init()
window.__keyboard.init({ markKey, currentWordIndex, ... })
window.__importHandlers.bindAll({ audioInput, transcriptInput, ... })
window.__exportHandlers.bindAll({ exportBtn, markedMap, ... })
window.__playback.init({ segments, words, ... })
window.__rendering.init({ ... })

// === Startup === (~1000行)
// Simplified init flow that calls composable functions
initDB().then(() => {
  window.__session.restore({ ... })
  ...
})
```

## 验证策略

- 每个 composable 提取后：`npm run dev` + Playwright load check
- 全程零回归保障：旧路径 `__USE_VUE_RENDERING = false` 不改变
- 每个 composable 单独 git commit
- 出问题立刻 `git checkout` 回退
