# Reader UI 样式维修执行交接

日期：2026-09-29

## 1. 执行边界

本次按 `reader-ui-style-repair-plan.md` 执行，落地范围限定为 F01/F02：

- `.controls`
- `.extra-controls`
- `.transcript-header`

执行开始时仓库 HEAD 为 `153f9464356c9f59020f4f35ede713a807c798d3`，工作区已经存在未提交修改。本次保留了这些既有修改，没有回滚、覆盖或提交它们；维修相关实现集中在 `src/composables/glass-effects.js`、`styles.css` 和 `scripts/glass-effects-check.cjs`。未修改受保护树、IndexedDB schema、依赖、端口、协议或脚本加载顺序，也没有创建 worktree、任务或提交。

维修前文件基线副本保存在：

`C:\Users\0\AppData\Local\Temp\readweb-ui-repair-20260929-212716`

## 2. 已完成施工

### 运行时玻璃装饰边界

`glass-effects.js` 现在把三个目标表面从玻璃面板装饰选择器中排除，并在初始化和动态节点处理时清理残留的 `glass-panel`、`ui-glass-dynamic`、`data-glass-bound` 及鼠标位置变量。其他明确的玻璃面板消费者仍保留原有绑定和清理生命周期。

### 目标表面样式

`transcript-header` 使用主题卡片背景和边框，关闭 backdrop filter；三个目标表面统一显式关闭 `::before`/`::after` 装饰伪元素、背景和装饰阴影。原有布局、圆角、间距以及必要的功能阴影保持不变。

### 回归检查

`glass-effects-check.cjs` 增加了目标表面的静态断言、初始化清理、动态插入、重复初始化和 dispose 生命周期断言，同时保留原有运行时装配契约检查。

## 3. 验证结果

以下命令已通过：

- `npm run verify:glass-effects`
- `npm run verify:reader-app-runtime`
- `npm run verify:theme-controls-module`
- `npm run verify:keyboard-boundary`
- `npm run verify:script-order`
- `npm run verify:srs-review-ui-v2`
- `npm run verify:passage-preview:unit`
- `npm run verify:passage-preview-shortcuts`
- `npm run verify:youtube-workflow-panel`
- `npm run verify:annotation-backfill-ai`
- `npm run build`
- `git diff --check`

生产构建后的隔离浏览器证据也已通过：

- `C:\Users\0\AppData\Local\Temp\readweb-ui-repair-20260929-212716\post-build-existing-page\recheck.json`
- `C:\Users\0\AppData\Local\Temp\readweb-ui-repair-20260929-212716\post-build-pointer\recheck.json`

证据覆盖 light/dark/custom/mobile 和强制 pointer 状态。三个目标表面均无玻璃 class、无伪元素内容、无装饰阴影、无 filter；未产生 cookie 或页面级错误。外部字体、CSE、Host API 和字典请求被隔离脚本按预期阻断。

合成数据交互还验证了：播放速率变为 `1.25`、下一句仍可用、跟随和高亮按钮可切换、Escape 后 hotkey 输入不保持焦点。SRS 合成页面覆盖了答题揭示、历史面板和移动视口。

## 4. 当前调查覆盖

这次维修不是全应用样式审计，下面是实际覆盖边界：

| 区域 | 状态 | 说明 |
| --- | --- | --- |
| Reader 控制区、额外控制区、transcript header | 已验证 | F01/F02 主验收目标，含主题和 pointer 状态 |
| 主题设置、custom 颜色状态 | 已验证 | 未见横向溢出，目标 surface 保持 solid |
| deprecated entry/details | 已验证 | 仅验证入口展开状态 |
| 合成 transcript/chunk 与基础交互 | 已验证 | 不依赖真实 Host 数据 |
| SRS review、history、answer reveal、mobile | 已验证 | 使用合成 review snapshot，不读取真实 sample |
| `#chunk-style-modal` 实际打开路径 | 未验证 | DOM 存在但当前调查未能打开；仍是保留的玻璃消费者 |
| YouTube workflow、quality/material notice | 未完成 | focused check 通过，但未完成全路径视觉调查 |
| Passage preview、设置及快捷键对话框 | 未完成 | focused unit/shortcut check 通过，视觉路径未完成 |
| AI annotation、vocabulary dialogs、loading/error/toast/video/bubble | 未完成 | 本轮没有合成业务数据或打开这些路径 |

完整调查结果和截图位于：

- `C:\Users\0\AppData\Local\Temp\readweb-ui-repair-20260929-212716\survey\survey.json`
- `C:\Users\0\AppData\Local\Temp\readweb-ui-repair-20260929-212716\survey\reader-survey.png`
- `C:\Users\0\AppData\Local\Temp\readweb-ui-repair-20260929-212716\survey\srs-survey.png`

这些是隔离环境下的部分调查证据，不能替代完整 C01-C08 全应用调查。

## 5. 未通过或未运行项

`npm run verify:vocabulary-preview-ui` 的静态断言已通过，但其临时浏览器子检查在 `page.goto(..., waitUntil: 'networkidle')` 等待超时；这是该 harness 对外部请求的网络空闲假设，不是本次 F01/F02 断言失败。本项记为 `NOT_VERIFIED`，未修改该既有检查脚本。

`npm run verify:vite` 和 `npm run verify:production-preview` 未运行。它们当前会连接已有本地服务，并且默认没有本次隔离证据所需的 deny-by-default 路由；按维修方案避免把真实 Host 状态混入本次验收。

## 6. 交付判定

- F01/F02 目标维修：`PASS`。
- 定向运行时、构建和隔离浏览器证据：`PASS`。
- 全应用 C01-C08 调查、完整真实 Host 旅程和 CLS 门禁：本轮未完成，因此整体审计状态为 `NOT_VERIFIED`，不宣称全应用样式已经全部收口。
- 既有 specialized surface、原生控件几何和其他保留 glass consumer 未因本次 F01/F02 维修被批量删除；后续若要继续，应按独立调查结果逐项归类后再施工。
