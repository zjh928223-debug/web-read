# app.js → ES Module 迁移方案

> Historical note: this file is an old migration plan. The current runtime state is documented in `AGENTS.md`, `README.md`, and `PROJECT_MAP.md`. Do not use this file as the source of truth for current load order or file counts.

## 当前架构

```
index.html（按加载顺序）:
  13 IIFE 工具脚本（regular <script>）
  9 store 脚本（regular <script>）
  10 composable 脚本（regular <script>）
  app.js（regular <script>）
  session-init.js（regular <script>）

  <script type="module" src="/src/main.js">
```

**问题**：正则脚本 `app.js` 内的 `let` 变量不是 `window` 属性，其他脚本（session-init.js）无法访问。必须靠 `window.__state` getter/setter 代理中转。

## 目标架构

```
index.html:
  13 IIFE 工具脚本（regular <script>）  ← 不变
  9 store 脚本（regular <script>）       ← 不变
  10 composable 脚本（regular <script>） ← 不变

  <script type="module" src="app.js">
  <script type="module" src="src/composables/session-init.js">
  <script type="module" src="/src/main.js">
```

**核心变化**：`app.js` 和 `session-init.js` 从 regular script 改为 `<script type="module">`。

## 五个挑战及解决方案

### 挑战 1：HTML onclick 需要全局函数

**现状**：HTML 中有 15 处 inline onclick，如：
```html
<button onclick="handleBackwardClick()">上一句</button>
<button class="speed-btn" onclick="changeSpeed(0.85)">0.85x</button>
```

**问题**：模块作用域内的函数声明不是 `window` 属性，`onclick="handleBackwardClick()"` 找不到。

**解决**：在 app.js 末尾添加 `window.xxx` 导出：
```javascript
window.handleBackwardClick = handleBackwardClick;
window.handleForwardClick = handleForwardClick;
window.changeSpeed = changeSpeed;
window.cycleHighlightMode = cycleHighlightMode;
window.toggleChunkMode = toggleChunkMode;
window.openChunkStyleModal = openChunkStyleModal;
window.closeChunkStyleModal = closeChunkStyleModal;
window.openChunkNoteStyleModal = openChunkNoteStyleModal;
window.closeChunkNoteStyleModal = closeChunkNoteStyleModal;
window.toggleChunkFocusMode = toggleChunkFocusMode;
window.toggleChunkShadowManual = toggleChunkShadowManual;
window.updateChunkStyle = updateChunkStyle;
window.updateChunkNoteStyle = updateChunkNoteStyle;
```

**验证**：加载页面后 `typeof window.handleBackwardClick === 'function'`。

### 挑战 2：模块脚本在 DOMContentLoaded 之后执行

**现状**：Regular scripts 在 HTML 解析时同步执行。Module scripts 在 DOMContentLoaded 后执行。

**影响**：app.js 的 `document.getElementById` 在 DOM 就绪后才调用 → 正常工作。但文件输入事件处理器（`addEventListener('change', ...)`）也延迟绑定 → 同样正常。

**实际情况**：module scripts 虽在 DOMContentLoaded 后执行，但 DOM 元素已就绪。`addEventListener` 延迟绑定不影响事件触发（事件在用户交互时才触发）。

**解决**：无需特殊处理。已验证：`setInputFiles` 在 Playwright 测试中正常触发文件加载。

### 挑战 3：session-init.js 与 app.js 的加载顺序

**解决方案 A**：session-init.js 也改为 module，通过 `import` 引入 app.js 的函数。

**解决方案 B**（推荐）：session-init.js 保持 regular script，但改在 app.js module 之后加载（利用 regular scripts 可以出现在 module scripts 之间的事实）。

不对——在 HTML 中，regular `<script>` 标签总是在 DOM 解析时立即执行，无法"放在 module scripts 之间"延迟执行。

**正确方案**：session-init.js 同样改为 `<script type="module">`。作为 module，它在 DOMContentLoaded 后执行。如果 session-init.js 的 `<script>` 标签在 app.js 的 `<script>` 标签之后，它就在 app.js 之后执行。

```html
<script type="module" src="app.js"></script>              ← 先执行
<script type="module" src="src/composables/session-init.js"></script> ← 后执行
<script type="module" src="/src/main.js"></script>        ← 最后执行
```

Module scripts 按 document order 执行。✅

### 挑战 4：50+ `let` 变量跨模块访问

**现状**：app.js 有 50+ 个 `let` 声明，如 `let words = []; let segments = [];`。session-init.js（同为 module）需要访问这些变量。

**问题**：Module 的 `let` 变量不是 `window` 属性，也不导出（除非显式 export）。

**解决方案**：

**Step 1**：在 app.js module 中添加 export：
```javascript
export let words = [];
export let segments = [];
export let wordStarts = [];
```

**Step 2**：session-init.js 通过 import 引用：
```javascript
import { words, segments, wordStarts } from '../app.js';
```

**Step 3**：对于通过 `window.__state` proxy 访问的变量，session-init.js 继续使用 `var st = window.__state`。但 `window.__state.segments` 的 getter 返回 `segments`（app.js 的 `let` 变量）。在 module scope 中，`let segments` 在 getter 闭包内——这没问题，模块变量的生命周期与 getter 一致。

**但是**：`export let words = []` 会创建一个"活绑定"（live binding）。当 `words = newData` 时，导入方自动看到新值。这解决了跨模块变量同步问题。

**Step 4**：对于 session-init.js 中需要写入的变量，使用 `window.__state` 代理（已有 getter/setter）：
```javascript
// 读取：var st = window.__state;  st.segments.length
// 写入：st.segments = newData;
```

**或者更简单**：直接 import，然后通过 import binding 读写：
```javascript
// session-init.js
import { words, segments } from '../app.js';
// 直接赋值：segments = newData;  ← 等价于 app.js 中的赋值
```

**重要**：`export let` 的 live binding 特性意味着 session-init.js 中的 `segments = newData` 会直接更新 app.js 模块中的变量。无需 proxy。

### 挑战 5：chunk-note-layout-core.js, chunk-note-layout-helpers.js 等 IIFE 需要 window 全局

**现状**：这些文件通过 `window.ChunkNoteLayoutHelpers = {...}` 暴露全局。代码中通过 `window.ChunkNoteLayoutHelpers.wrapChunkNoteTextForCanvas()` 调用。

**解决方案**：转为 module 后，继续通过 `window.` 访问（这些 IIFE 文件仍是 regular scripts，在 module 之前加载）。或者改为 import：

```javascript
// app.js module
import { wrapChunkNoteTextForCanvas } from '../composables/chunk-note-layout.js';
```

但这需要 chunk-note-layout.js 改为 ES module（目前它是 IIFE regular script）。

**实际可行方案**：保持 `window.ChunkNoteLayoutHelpers` 的全局访问方式。Module 代码可以正常读写 `window` 属性。

---

## 实施步骤

### Step 1：添加 window 导出（app.js 末尾）

在 app.js 末尾（`setTimeout(()=>{...}, 0)` 之后）添加所有 HTML onclick 所需要的全局函数导出。

**验证**：`typeof window.handleBackwardClick === 'function'`。

### Step 2：修改 index.html

```html
<!-- 改为 module -->
<script type="module" src="app.js"></script>
<script type="module" src="src/composables/session-init.js"></script>
```

### Step 3：session-init.js 添加 import

在 session-init.js 顶部（IIFE 之前）：
```javascript
import { words, segments, wordStarts, chunkItems, clozeItems, ... } from '../app.js';
```

**关键**：session-init.js 当前是 IIFE 格式 `(function() { ... })()`。添加 `import` 后，它变成一个 module。IIFE 内 `var st = window.__state` 的引用保持不变——这些 proxy 在 app.js module 中定义，通过 window 访问。

### Step 4：验证

1. `node --check` 验证语法
2. Playwright 加载页面，确认 0 错误
3. 加载转录，确认 Vue 渲染正常
4. 主题切换、Toast、Cloze 全部正常

---

## 风险项

| 风险 | 等级 | 缓解 |
|------|------|------|
| module `let` 变量跨文件共享 via `import` live binding 行为与 global scope 不同 | 🟡 | 测试变量赋值同步 |
| session-init.js 内的 `window.__state` getter 在 module 上下文中行为不同 | 🟢 | getter 本来就是通过 `window` 访问，不受 module scope 影响 |
| inline onclick 引用的函数导出遗漏 | 🟡 | 完整列出所有 15 个 onclick handler |
| Vite HMR 对 module scripts 的处理与 regular scripts 不同 | 🟢 | 只影响 dev 模式，功能一致 |

---

## 预期结果

- app.js 和 session-init.js 成为 ES module
- session-init.js 通过 `import` 直接访问 app.js 的 `let` 变量（live binding）
- HTML onclick 函数通过 `window.xxx` 导出正常工作
- 未来可以逐步删除 `window.__state` proxy 冗余层
- app.js 剩余 3277 行可以进一步拆分为多个 module

**预计工作量**：2-3 小时（主要是验证和修复）。要现在开始实施吗？
