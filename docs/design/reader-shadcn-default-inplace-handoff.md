# 阅读器标准样式原位换肤：施工交接

日期：2026-09-29。状态：收到独立审核意见后，已修复确认的玻璃表面问题、快捷键主题色、被遮住的重复队列提示、按钮基础样式回归及生产按钮层级问题，并补查遗漏入口与模拟窗口；独立复核尚未重跑，因此不代表审核通过或日常版已替换。

## 1. 基点、改动与保护范围

- 起始与结束 HEAD：`153f9464356c9f59020f4f35ede713a807c798d3`；本轮未提交、未提交 commit。开场 `git status --short` 干净，没有既有差异要覆盖。
- 当前 27 个已跟踪修改文件：
  `index.html`、`scripts/annotation-backfill-ai-module-check.cjs`、`scripts/glass-effects-check.cjs`、`scripts/passage-preview-browser-check.cjs`、`scripts/vocabulary-preview-ui-check.cjs`、`scripts/youtube-workflow-panel-v3-browser-check.cjs`、`scripts/youtube-workflow-panel-v3-check.cjs`、`src/App.vue`、`src/components/LearningPageLoadNotice.vue`、`src/components/YouTubeWorkflowPanel.vue`、`src/components/ui/button/button-variants.js`、`src/composables/annotation-backfill-ai-module.js`、`src/composables/glass-effects.js`、`src/composables/style-editor.js`、`src/composables/vocabulary-preview-module.js`、`src/features/learning-ui/learning-ui.css`、`src/features/passage-preview/PassagePreviewPage.vue`、`src/features/passage-preview/PassagePreviewSettingsDialog.vue`、`src/features/passage-preview/passage-preview.css`、`src/features/passage-preview/use-passage-preview.js`、`src/features/srs-review/SrsReviewPage.vue`、`src/features/srs-review/srs-review.css`、`src/lib/native-control-styles.js`、`src/lib/native-input-styles.js`、`src/main.js`、`src/styles/workflow-ui.css`、`styles.css`。另新增本交接文件。起始 HEAD 与当前 HEAD 均为 `153f9464356c9f59020f4f35ede713a807c798d3`；无提交。
- 普通文字按钮统一使用组件 `default` 配方；纯图标使用 `icon`；单行原生文本/密码/数字/快捷键输入使用 `default` 输入配方。常规目标高 36px，纯图标 36×36px。复合快捷键录制卡保留 40px 自适应高度以容纳第二行状态文字。
- 目标工具面板和弹窗改用隔离的 neutral 实色表面，移除目标面的玻璃模糊/渐变/光斑，保留遮罩、定位和功能阴影。默认浅深主题共用 shadcn-vue neutral 变量；学习窗口固定浅色；用户自定义阅读色、评分/状态色、正文字体/行宽/行高与阅读高亮保留。通过局部换行和 min-width 调整避免窄屏裁切；箭头快捷键字段加宽到 116px。
- 前后截图核对发现既有桌面遮挡：固定主题按钮原来盖住第一个“过时入口”折叠项。本轮在 641px 以上的 `.controls` 顶部增加 46px 内边距，保持入口顺序并露出完整文字；后测按钮矩形为 x=20–56/y=10–46，折叠项 y=57–94。390px 布局没有改。
- 保留 Tailwind 唯一扫描入口、现有 Button/Input 配方和两个原生样式助手；没有启用全局 Preflight。普通控制区域可能自然换行、增高并令正文起点下移；没有锁住原像素高度。
- 未改 `config/runtime.optimization.json`、Host/服务协议、IndexedDB schema、真实用户数据、脚本顺序、日常树或历史树。四个脚本文件仅把旧尺寸断言更新为新标准尺寸，保留行为断言。

## 2. 实际界面与入口清单

初始 U01–U10 仅作归类。按实际可独立查看/切换的容器盘点 28 项：17 项换肤、10 项保留但检查共享影响、1 项历史不可达。浏览器原生 confirm 与 alert 分列为两个视觉容器。另打开的 `personalization-shadow.html?demo=1` 是独立演示页，不属于产品；`PassagePreviewCheckPage.vue` 是测试夹具，也不计入产品总数。

CSS 简写：**R**=`index.html` / `src/main.js` / `styles.css` / `src/styles/workflow-ui.css` / 两个 `src/lib/native-*-styles.js` 助手；**W**=`src/components/YouTubeWorkflowPanel.vue` / `src/styles/workflow-ui.css` / `styles.css`；**P**=`PassagePreviewPage.vue` / `PassagePreviewSettingsDialog.vue` / `passage-preview.css` / `learning-ui.css` / `workflow-ui.css` / `styles.css`；**S**=`SrsReviewPage.vue` / `srs-review.css` / `learning-ui.css` / `workflow-ui.css` / `styles.css`；**L**=`learning-ui.css` / `workflow-ui.css` / `styles.css`。每一项的规则来源和命中声明见 `output/playwright/reader-shadcn-survey-before.json` 与 `reader-shadcn-survey-after.json`；保留项没有因此改写业务 UI。

| ID | 对象 / 分类 / U组 | 主入口、适用状态 | 基线 → 后测 | CSS 来源与处理 |
| --- | --- | --- | --- | --- |
| UI-001 | 主阅读器工具栏；换肤；U01 | `/`；浅/深/custom，1280×800、390×844；后测另含 1280×720；`vocabulary-owner-not-ready` 条件状态 | 前后均打开；后测标准按钮/输入尺寸生效，窄屏无页面横向溢出，桌面折叠项不再被主题按钮遮挡；owner warning 在隔离 not-ready 状态可见；深色主题切换稳定后，`m` / `ArrowLeft` / `ArrowRight` 使用 reader 所属 `--foreground` / 不透明 `--background` token，实测对比度约 18.96:1 | R；neutral 控件、默认尺寸；`styles.css` 桌面卡片顶部给固定主题按钮让位并显式设置快捷键输入主题色 |
| UI-002 | 普通 transcript 内容区；保留；补充组 | `/` → 导入合成 WAV/transcript；内容/高亮状态 | 前后均打开，同一合成句子 | Vue transcript 专用组件/CSS；未换肤，只核对共享影响 |
| UI-003 | AI chunk 内容区；保留；补充组 | `/` → 素材处理 → 素材库 → 合成素材 → 打开 → AI切分 | 前后均打开；后测通过标准素材路径加载 1 个合成 chunk | Vue chunk 专用组件/CSS；正文布局、高亮语义保留 |
| UI-004 | 自定义主题浮层；换肤；U01/U05 | `/` → 主题按钮；custom 编辑/取消、浅深切换 | 前后均打开；后测自定义色保留，测试设置恢复 | `index.html` / `styles.css` / `workflow-ui.css`；仅应用 neutral 共有外观 |
| UI-005 | 文件/媒体折叠入口；保留；U01/补充组 | `/` → `#main-app-area .deprecated-file-entry`；展开/收起 | 前测被固定主题按钮部分遮挡；后测完整显示，桌面 y=57、文字无裁切；原生 file/media 检查 | `index.html` / `styles.css`；原生 file/media 与专用几何保留 |
| UI-006 | 当前 chunk 样式弹窗 `#chunk-style-modal`；换肤；U05 | `/` → `#btn-chunk-style`；数字/颜色控件 | 前后均打开 | `index.html` / `style-editor.js` / `styles.css` / `workflow-ui.css`；普通按钮尺寸更新，原生颜色/数字语义保留 |
| UI-007 | 素材处理主面板及内容 tab；换肤；U02/U03 | `#youtube-reader-controls-root` → 素材处理；添加、队列、素材库、时间筛选、设置、高级设置；重复素材提示及 `attemptCount > 1` 的“查看以往尝试”条件折叠 | 前后均打开这些子视图；合成素材由模拟 API 提供；审核指出的队列历史折叠已展开，看到一条此前失败尝试及原因；重复提示未触发（素材唯一），相关过滤/去重行为由 browser check 覆盖 | W；中性面板和统一按钮尺寸，状态/分组不变 |
| UI-008 | 素材库行“更多操作”菜单；换肤；U03 | 素材处理 → 素材库 → 合成行 → 更多操作 | 前后均打开；确认分支在后测触发并关闭 | W；行菜单作为独立浮层检查 |
| UI-009 | 素材质量报告弹窗；换肤；U04 | 素材处理 → 合成行 → 查看处理详情 | 前后均打开 | W + `styles.css`；独立弹层主题和 footer 按钮尺寸 |
| UI-010 | 素材打开失败 notice；换肤；U04 | 素材处理 → 合成失败条目 → 打开 | 前后均打开；使用专用模拟失败响应 | W + `styles.css`；提示状态色/内容保留 |
| UI-011 | 首次接触预习页、卡片揭示/导航/完成态；换肤；U08 | `#srs-review-entry-root` → 合成预习包；后测两词 | 前测单词卡可揭示/完成；后测揭示、下一词、上一词、回到下一词、完成均打开；前测单卡不具备上一词/下一词路径 | P；原生 button 换标准尺寸；不改卡片协议 |
| UI-012 | 首次接触“预习设置”弹窗；换肤；U08 | 阅读器 → 预习设置 | 前后均打开；后测输入 `4`，`type=number`、`valueAsNumber=4`，点取消丢弃 | P；number 原生类型和转换保留 |
| UI-013 | 首次接触快捷键设置弹窗；换肤；U08 | 预习页 → 快捷键；普通关闭和录制中 Escape | 前后均打开；后测 Escape 取消录键且弹窗仍打开，未改快捷键 | P；录制复合按钮保留 40px 自适应高度 |
| UI-014 | 预习准备中 overlay；保留并查共享影响；U08 | 预习包导入 → 模拟 850ms 词句翻译等待 | 基线未采集；后测打开，记录准备文案/尺寸 | `App.vue` / `passage-preview.css`；无按钮换肤目标，遮罩和定位保留 |
| UI-015 | 预习等待池阈值提醒；保留并查共享影响；U08 | `/` → 用合成完成态数据打开真实“待预习”入口；检查 `PassagePreviewPage` 完成页；App 不再挂载被覆盖的重复节点 | 后测 390×844 可达完成页明确显示完整等待池提示，范围内且 hit-test 落在提示段落；浏览器断言全局 `.passage-preview-queue-notice` 数量为 0；reader shell 为 dark、学习页仍为 light，提示文字实际颜色 `rgb(123, 135, 153)`、字号 16px、页面背景 `oklch(1 0 0)`。可见 live region 由完成页维护，删除仅重复的 App 节点，不改学习页状态和队列逻辑 | `PassagePreviewPage.vue` / `passage-preview.css` (`.passage-preview-complete p`)；删除 `App.vue` 重复节点、`use-passage-preview.js` 的无用返回属性及 App 解构，不增加 notice CSS |
| UI-016 | 今日复习 SRS 空态 overlay；换肤；U02/U09 | `#srs-review-entry-root` → 今日复习 | 前后均打开空态 | S；按钮尺寸更新，空态语义保留 |
| UI-017 | SRS 历史/快捷键浮层；换肤；U09 | 今日复习 → 快捷键/历史按钮 | 前后均打开 | S；使用独立浮层根的学习主题变量 |
| UI-018 | standalone SRS 卡片/揭示/完成页；换肤；U09 | `/srs-review.html`；后测由路由拦截提供两张纯内存合成卡 | 前测打开空态；后测打开，第一卡点击 Good、第二卡按 `4` 得 Easy，反馈共 2 张 | S；揭示/评分高度统一，评分色、禁用与防重复逻辑保留 |
| UI-019 | 学习页加载失败提示；换肤；U10 | 今日复习 → 模拟异步组件导入失败 → 重试/返回 | 前后均打开；后测重试仍失败（夹具保持失败），按钮/返回入口可见 | `LearningPageLoadNotice.vue` + L；重试继续失败是刻意夹具，不是换肤回归 |
| UI-020 | 文章“预习生词”窗口；换肤；U07 | 标准合成素材打开后 → `#btn-preview-vocabulary` | 文件导入路径前后均受阻（缺标准 article identity）；前测标准素材也因 fixture 不完整受阻；后测标准素材入口打开 | `vocabulary-preview-module.js` + L；原生 model/password 输入助手、标准 footer 尺寸 |
| UI-021 | “整理本篇生词”窗口；换肤；U07 | 标准合成素材打开后 → `#btn-settle-article-vocabulary` | 同 UI-020；后测从正常素材流程打开 | `vocabulary-preview-module.js` + L；两个窗口共用样式分别检查 |
| UI-022 | AI 解释标注窗口；换肤；U06 | 标准合成素材打开后 → `#btn-annotation-backfill-ai` | 同 UI-020；后测打开并用 Escape 关闭 | `annotation-backfill-ai-module.js` + L；文本/密码字段类型保留，无真实 AI 请求 |
| UI-023 | annotation bubble；保留并查共享影响；补充组 | reader runtime → `AnnotationBubble` API → 合成 annotation | 前后均打开 | `annotation-bubble.js` / bubble 专用 CSS；无换肤变更 |
| UI-024 | VideoPlayerFloat 展开/最小化；保留并查共享影响；补充组 | reader media source → 合成视频状态 → 最小化 | 前后均打开两种状态 | `VideoPlayerFloat.vue` 局部样式；播放器/拖拽控件保留 |
| UI-025 | Toast 浮层；保留并查共享影响；补充组 | reader runtime → `window.showToast` 合成提示 | 前后均打开 | `ToastMessage.vue` / `styles.css`；状态色保留 |
| UI-026 | 浏览器原生确认框；保留；U03/U09/补充组 | 素材行重新处理/删除、SRS 移除误收录，以及清 API key/旧目录/失败任务确认分支 | 基线未检查；后测已触发可达确认并立即 dismiss，未执行破坏动作；清 API key/旧目录/失败任务分支前置状态未建立，标记未检查 | 浏览器/OS 原生窗口，无应用 CSS |
| UI-027 | 浏览器原生提示框；保留；U08 | 待预习入口在队列已清空时 | 基线未检查；后测打开 empty-queue alert 并 dismiss | 浏览器/OS 原生窗口，无应用 CSS |
| UI-028 | 旧 `#style-editor-modal` 样式编辑器；历史不可达；U05 | 静态调用链核对 `#open-style-editor` / `#style-editor-modal` | 不打开：仅残留条件 JS hook，无可用触发按钮/markup；当前可达 UI 是 UI-006 | `style-editor.js` 与 `glass-effects.js` 旧选择器；没有恢复历史入口或伪造访问路径 |

前后盘点行数分别为 44（37 opened / 7 blocked）和 52（48 opened / 3 blocked / 1 not applicable）；它们是状态观察记录，不是界面总数。原记录唯一的 not applicable 是 `passage-preview-entry`：唯一合成预习项已完成，因而没有待预习项目可打开；这与 UI-015 队列提醒条件分支不同。审核后 follow-up 不覆盖原始计数，新增检查 UI-007 历史尝试折叠、UI-001 owner warning、深色快捷键实际可读性和 UI-015 的可达完成态。UI-015 的完成页文字在 390×844 可见并通过 hit-test；后续移除了被覆盖的 App 重复节点，并在浏览器检查中断言其不存在。后测三个 blocked 仍是原错误路径尝试；依赖素材的窗口之后均从标准素材库入口真实打开。不能把路径受阻写成产品窗口不可达。

执行侧源码对照：`index.html`/`src/main.js` 提供 reader shell 和静态 controls；`App.vue` 的两个 Teleport 根包含学习入口、SRS/预习页、数量设置、load notice、preparing 与条件 queue notice；YouTube 有主面板、quality 与 material notice Teleport；VideoPlayerFloat Teleport 到 body；JS 动态创建根仅见 annotation bubble、annotation backfill、vocabulary preview/settlement；原生确认/提示调用位于 YouTube、预习流程及 SRS。上述均对应 UI-001 至 UI-028；旧 style-editor 钩子经静态调用链判为历史不可达。此为执行侧交叉核对，不代替独立审核员从入口重新找漏项。

其他明确状态：UI-015 的实际完成页提醒可见，重复全局 live-region 节点已删除。历史样式窗口历史不可达；prepared overlay 的前测未采集；UI-026 未播种的 credential/旧记录确认分支未检查。V05 follow-up 使用假的 API key 和延迟模拟客户端完成 UI pending/关闭/焦点流程，没有向真实 AI 服务发送请求。没有证据的基线项保持“未检查”，不标为通过。

U映射：U01=UI-001/004/005；U02=UI-001/007/016；U03=UI-007/008/026；U04=UI-009/010；U05=UI-004/006/028；U06=UI-022；U07=UI-020/021；U08=UI-011–015/027；U09=UI-016–018/026；U10=UI-019；补充保留组=UI-002/003/023–027。

## 3. V01–V08 结果及证据

浏览器盘点在 `http://127.0.0.1:5184/` 实际产品结构上进行，使用全新隔离 Chromium context、合成数据和 API route interception。准备 overlay 加入 850ms 合成翻译延迟。SRS 独立页只使用两张内存合成卡，私有 `srs-review.sample.local.json` 未读取、未引用。API 请求清单共 66 条，`forbidden=0`；它们被模拟路由处理，不是 8776 的真实服务验证。

| 项 | 结果 | 证据与边界 |
| --- | --- | --- |
| V01 | PASS（注明入口差异） | 前后主页同为 1280×800 与 390×844；后测另有 1280×720。合成文本相同；前测主要由文件导入，后测额外由标准素材库路径验证 chunk。浅/深/custom、普通/chunk 均打开；窄屏文档无横向溢出；固定主题按钮不再遮挡桌面折叠项。图片见下列 screenshot 路径。 |
| V02 | PASS（合成音频） | `playback=true`；上一句/下一句可点；速率仍为 0.85/1/1.25；跟随、高亮变化；chunk 含 1 段，聚焦文案“聚焦→全局”和按住模式切换有效。 |
| V03 | PASS（隔离 context） | 快捷键保存、取消录制并触发后恢复原键；主题恢复初始 light；custom colors 保留。没有碰用户 browser profile。 |
| V04 | PASS（模拟服务范围） | 素材主窗口、tab、高级设置、row menu、quality、failure notice 打开；行为浏览器检查用显式 `READ_WEB_URL=http://127.0.0.1:5184/`，输入修剪、重复触发/关闭和焦点机制断言保留。没有真实下载/删除。 |
| V05 | PASS（隔离模拟 UI 流程） | chunk style 和两套 vocabulary 窗已打开；annotation AI 模块在真实应用页中由合成 trigger 打开，填入合成 model/假 key，模拟请求 pending 时核对字段禁用，收到合成结果后导入 1 条，再关闭并核对焦点返回。还核对 vocabulary preview、settlement 在 dark 主壳下保持 light。无真实 API key 或 AI 服务调用；证据与截图见 `reader-shadcn-review-follow-up.json`。 |
| V06 | PASS（合成包） | 两卡揭示、下一词/上一词、完成页；settings `type=number` 且 `valueAsNumber=4`，取消后不保存；快捷键录制中 Escape 取消修改且 dialog 仍打开。 |
| V07 | PASS（只证明 UI 行为） | 内存合成 SRS 卡揭示，首卡点 Good、第二卡数字 `4` 为 Easy，进度反馈共 2 张。没有声称真实持久化。 |
| V08 | PASS（代表状态） | 学习加载失败提示、重试/返回入口、按钮 hover/focus/disabled 由本轮 browser check 和组件检查覆盖；失败夹具继续失败是有意状态。 |

截图在 `output/playwright/`：`reader-before-light-desktop.png`、`reader-before-light-mobile.png`、`reader-after-light-desktop.png`、`reader-after-light-desktop-720.png`、`reader-after-light-mobile.png`、`reader-after-chunk-mode.png`、`reader-after-synthetic-content.png`、`reader-after-theme-custom.png`、`reader-after-style-modal.png`、`reader-after-youtube-library.png`、`reader-after-youtube-quality.png`、`reader-after-youtube-material-notice.png`、`reader-after-passage-preview.png`、`reader-after-passage-preview-preparing.png`、`reader-after-passage-preview-complete.png`、`reader-after-vocabulary-preview-dialog-standard-material.png`、`reader-after-vocabulary-settlement-dialog-standard-material.png`、`reader-after-annotation-backfill-dialog-standard-material.png`、`reader-after-annotation-bubble.png`、`reader-after-video-player.png`、`reader-after-srs-standalone.png`、`reader-after-srs-revealed.png`、`reader-after-srs-complete.png`、`reader-after-learning-load-notice.png`、`reader-after-toast.png`，本轮复查图为 `reader-glass-control-groups-light.png`、`reader-glass-control-groups-dark.png`、`reader-review-hotkeys-dark-stable.png`、`reader-review-v05-chunk-style-dark.png`、`reader-review-v05-ai-dialog-dark.png`、`reader-review-v05-vocabulary-preview-dark.png`、`reader-review-v05-settlement-dark.png`、`reader-review-owner-warning-synthetic.png`、`reader-review-queue-notice-synthetic-dark-mobile.png`、`reader-review-queue-notice-reachable-mobile.png`。深色输入计算明细见 `reader-review-hotkeys-dark-stable.json`；完整 follow-up 见 `reader-shadcn-review-follow-up.json`。

CSS Coverage 在基线及后测交互中均实际开启：基线 572/572 条规则使用；最终后测 644/644 条使用。后测来源分组为 `styles.css` 318 条及 CDP 未解析 source URL 的 `regular` 326 条。它只证明本次浏览过的状态命中了规则；不是删除 CSS 的依据。后测 console 有 3 条资源错误字符串：2 条 `ERR_FAILED` 合成资源请求，1 条 503 合成失败路径；不能称此调查无资源错误。

## 4. 命令结果与异常

- PASS：`npm run build`；`npm run verify:theme-controls-module`；`npm run verify:keyboard-boundary`；`npm run verify:youtube-workflow-panel`；`npm run verify:annotation-backfill-ai`；`npm run verify:srs-review-ui-v2`；`npm run verify:passage-preview:unit`；`npm run verify:passage-preview-shortcuts`；`npm run verify:youtube-workflow-panel-behavior`；`npm run verify:vocabulary-preview-ui`；`npm run verify:glass-effects`；`scripts/passage-preview-browser-check.cjs`（PowerShell 中将 `READ_WEB_URL` 设为 `http://127.0.0.1:5184/` 后运行；全浏览器检查通过，包含 UI-015 完成页提醒的可见性、hit-test 及重复节点不存在）；`output/playwright/reader-dark-hotkey-contrast-check.cjs`（稳定深色后快捷键前景、实色背景和对比度检查）；`git diff --check`。
- 历史失败记录（2026-09-29 修复前）：`READ_WEB_URL=http://127.0.0.1:5184/ npm run verify:vite` 报告 `/api/app/health` 404 两次，CLS `0.016023859863909185`。这两个结果保留为当时真实观测，不改称通过；后续追查区分了路由拓扑错误和本轮新增的 CLS。
- A09 后续施工及复测：CLS 主位移来自 reader Button 工具类延后加入时改变静态按钮 padding/border，导致 transcript 控件行折叠；同时 workflow neutral token 需要在全局样式首次绘制时已可用。`index.html` 现在首屏加载 `workflow-ui.css`，`src/main.js` 不再重复延迟导入；`workflow-ui.css` 的 reader base 规则预留与 default Button 配方相同的 36px 盒子、8×16px padding、8px gap、14px/20px 中字重和 1px 边框，实用类补齐后不再改变几何。
  - PASS：最终 `npm run build`。
  - PASS：`npm run verify:vite` 对当前源码、已启动的本地 Vite 4174 执行；load、playback、interactions 三项均通过。load CLS `0.002926`，Vue mount 成功，console/page/request/response errors 均为 0。报告：`output/playwright/reader-shadcn-a09-vite-verify-load-report.json`、`reader-shadcn-a09-vite-playback-report.json`、`reader-shadcn-a09-vite-interactions-report.json`。
  - PASS：`npm run verify:production-preview`，当前构建预览 load check 通过，CLS `0.002255`，无 console/page/request/response errors。报告：`output/playwright/reader-shadcn-a09-production-preview-load-report.json`。
  - 冷启动诊断：全新 Vite 4174 页面的 `load` 用时 17.291s，Vue mount 在 `load` 后 1.229s 完成；CLS `0.002570871612172068`，无浏览器错误。详情：`output/playwright/reader-shadcn-a09-cold-vite-diagnostic.json`。默认新启 4173 的检查曾出现 15s Vue mount wait timeout；其稳定复现原因未定位，没有把该次失败改称通过。完整官方检查随后在当前源码 Vite 4174 上通过。
  - 健康路径原因：5184 当前承载的是 Vite DevFallback，不是生产稳定前门；浏览器对相对 `/api/app/health` 收到 404。`src/main.js` 仅在 `VITE_LOCAL_SERVICE_BASE_URL` 非空时启用该 owner probe；该路径由 `tools/subtitle-workflow/youtube_workflow/production_host_prototype.py` 注册。8776 是 subtitle-workflow 服务，它的实际健康路径 `/api/health` 为 HTTP 200（`service=subtitle-workflow`）；`/api/app/health` 在该服务返回 404 符合路由边界。健康路由观察：`output/playwright/reader-shadcn-a09-health-routing.json`。生产 Host 的 owner health 路由本次未实际启动/访问，未声称 Host 持久化或生产 owner health 已通过。
- 本轮最终 A09 结论：当前源码 Vite 4174 集成套件、build、production preview 与 CLS 门槛均 PASS；旧 404 已定位为探测目标与运行拓扑不匹配。默认全新 4173 检查有一次 Vue 挂载超时，原因未定位；生产 Host owner-health live check 单独保持 NOT_RUN。
- 未运行 `npm test`；方案要求的 focused checks 和浏览器入口已运行。没有把未运行项写作 PASS。
- 本次优化预览由 `scripts/launch-optimization-preview.ps1 -DevFallback -NoOpen` 启动，`http://127.0.0.1:5184/` 返回 HTTP 200；调查期间前端页面使用模拟 API，不是真实 Host 环境。8776 的 `/api/health` 返回 HTTP 200，`/api/app/health` 是生产 Host 路径，不由该服务提供。
- 临时 survey helper 位于 ignored 的 `output/playwright/reader-shadcn-survey.cjs`，532 行（调查前约 489 行）；超过方案约 500 行范围提示。新增仅为指定视口、双卡导航/快捷键和控件观察；属于一次性取证脚本，不进入产品提交。本轮不再扩展。
- 收到的独立审核确认 A04/A05 的主阅读器玻璃装饰残留、A01 队列历史子项遗漏和 N/A 分类错误，以及 V05/A09 待验证。此后修复 A04/A05：目标 `.control-group` / `.hotkey-box` 已从运行时玻璃 selector 移除，浅/深色实测为 neutral 实色、无 backdrop blur、box shadow 或伪元素光斑；现将快捷键输入前景/底色明确接到 reader 主题 token，深色稳定态 `m`、`ArrowLeft`、`ArrowRight` 均超过 4.5:1，截图和 computed-style 报告复核。`verify:glass-effects` 覆盖运行时不再绑定玻璃类。A01 follow-up 已展开“查看以往尝试”、通过 not-ready stub 打开 owner warning，并用真实“待预习”入口到达完成态；等待池提示可见并通过 hit-test，重复 App 节点随后删除，浏览器检查断言其不存在。入口和用户可见提醒均补查；没有把历史不可达/条件分支未触发写成通过。按 `docs/design/reader-shadcn-default-inplace-review.md` 仍需独立复核入口与 A02–A10；执行侧 follow-up 不替代审核。
- 最新独立复核指出按钮基础规则被 `:not(button):not([role="button"])` 一并排除，导致 outline/ghost 退回 UA 外观。已在 `src/styles/workflow-ui.css` 增加低优先级按钮共有重置，恢复 `appearance: none`、`box-sizing: border-box`、零 margin/padding、solid 边框基础、透明背景和 owner 主题前景色；reader 36px 首绘几何规则紧随其后，utility recipe 仍负责变体外观。基于当前 production CSS，按 `buttonVariants` 源码复刻 base/outline/ghost/default/icon 类组合及真实 owner 属性构造隔离按钮，并在浅/深主题测量 reader、workflow、style-controls 三组：均为 `appearance:none`、`border-box`、非 UA outset 边框；workflow outline 为 1px solid，workflow ghost 为透明背景、0px solid，深色前景不再是黑色。实际 `#btn-prev-sentence` 浅/深均为 36px 高。
  - PASS：按钮主题浏览器检查，Playwright Chromium headless，production preview `http://127.0.0.1:4181/`、1280×820；浅/深截图保存在当前运行机 Temp，不作为仓库文件。合成 ghost 点击事件触发一次，console/page errors 为 0。
  - PASS：修复后 `npm run build`。
  - PASS：修复后 `npm run verify:production-preview`；CLS `0.00225243537808642`，Vue mount 成功，console/page/request/response errors 均为 0，低于 `0.01` 门槛。官方加载报告：`.playwright-artifacts/read-web-load-report.json`。
- 最新审核指出生产入口先建立 Tailwind layers、后建立 `reader-footprint`，使其覆盖 `utilities` 的标准 padding/gap。现于最早生产样式块 `src/features/learning-ui/learning-ui.css`，以及 `styles.css`、`src/styles/workflow-ui.css` 开头声明完整顺序 `reader-footprint, properties, theme, base, components, utilities`；删除 `styles.css` 中原有的晚置顺序声明，保留 footprint 尺寸预留。生产入口先加载的 `learning-ui` CSSOM 现先建立 `reader-footprint`，再建立 theme/base/components/utilities；reader footprint 因此低于配方 utility。
  - 为满足同一复核要求的 icon 尺寸检查，修正 `button-variants.js` 的 SVG `class*="size-"` 属性选择器转义；原样式曾生成不匹配的 selector。当前生产 CSS 默认配方自动图标为 16×16px，显式 `rw:size-[19px]` 仍为 19×19px。
  - PASS：当前 production preview 浏览器测量（Playwright Chromium headless，1280×820，浅/深）：实际“上一句”和“导标记”均为 76×36px、padding 8×16px、gap 8px；“T”和“按住” gap 均为 8px；合成标准按钮宽 76px。console/page errors 为 0。检查截图保存在运行机 Temp。
  - PASS：最新 `npm run build` 和 `npm run verify:production-preview`；CLS `0.00249635898919753`，低于 `0.01`，Vue mount 成功，console/page/request/response errors 均为 0。`.playwright-artifacts/read-web-load-report.json`。
  - PASS：`git diff --check`。

## 5. 有限例外与结束结论

- 保留原生 audio/video、color/file/select、native switch、拖拽把手、正文/annotation bubble、候选行专用按钮、SRS 状态/评分颜色和复合快捷键录制卡；其中预习快捷键录制卡实测高度 40px，文字完整。旧 size 断言只调整为目标配方的新尺寸，行为检查未删除。
- **结论：本轮已按审核意见修复生产按钮层级问题并完成定向前端复测，整体验收仍待独立复核。** A02/A05 的标准按钮尺寸、图标尺寸和 footprint 顺序，A04 的玻璃清理与深色快捷键，A01 补查入口与 UI-015 可见性、V05 隔离模拟 UI 流程均按上文记录。A09 当前源码 Vite 4174 集成和生产预览 CLS 通过；默认全新 4173 检查的 Vue 挂载超时尚未归因，生产 Host owner-health live check 未执行。独立 A01–A10 复核尚未重跑。日常版切换、真实 AI 请求、真实 Host 持久化和自动提交均未发生。
