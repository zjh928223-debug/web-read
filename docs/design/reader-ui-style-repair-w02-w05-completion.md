# Reader UI 样式维修 W02/W05 完工记录

日期：2026-09-29

本记录只针对 `E:\read-web-next-optimization` 当前优化树，承接 `reader-ui-style-repair-plan.md` 的 W02、W05。F01/F02 的既有维修及独立审核结论保留为 PASS；本轮没有新增产品源码维修，因为完整调查没有发现新的、同时满足原 A01–A10/P0–P2 条件的 S3 缺陷。新增文件只有本记录，临时脚本、构建产物、JSON 和截图均留在系统 Temp。

结论分开表达：

- 维修通过：F01/F02 当前生产构建复测通过，固定 focused checks 通过。
- 调查部分完成：当前入口、主要子视图和 34 个元素组已盘点；5 个 S5 缺口明列，不能把它们写成已验证。
- 全应用视觉统一未宣称完成：S2 原生/专用保留项、S4 统一建议继续保留。

## 1. 隔离、基线与当前源码身份

- 工作目录：`E:\read-web-next-optimization`。
- 当前分支：`codex/read-web-optimization`。
- 当前 HEAD：`153f9464356c9f59020f4f35ede713a807c798d3`。
- 工作树在施工前已经有未提交修改；本轮未 reset、clean、stash、commit 或 promotion，未编辑 `E:\read-web-next`、`E:\read-web`，未使用 worktree、任务或代理。已有 WhisperX/language-processing 及其他脏文件全部保留。
- 浏览器检查使用 Playwright Chromium `145.0.7632.6`、Node `v24.13.1`，新建非持久 context，初始 Cookie 为 0，service worker 禁用，WebSocket 关闭。所有未知、外部和未声明业务请求默认阻断。
- 合成数据只包括转录/chunk、workflow 列表/质量报告、SRS sample 和 passage preview JSON；没有真实 Host、真实 profile、真实素材、API key、下载或持久业务写入。

W05 生产对照使用当前源码构建到新的 Temp 目录，没有覆盖仓库 `dist`：

```text
npm run build -- --mode production --outDir C:\Users\0\AppData\Local\Temp\readweb-ui-w02-w05-20260929-221500\dist --emptyOutDir
```

构建成功，Vite 转换 856 modules。当前源码 manifest 的关键身份如下，完整 asset manifest 保存在 `production-cls.json`：

| 当前源码 | bytes | SHA-256 |
| --- | ---: | --- |
| `index.html` | 10102 | `73b493ffa8337a03b4e072faf1fb7384e928c54fe213675e451939bd73094d86` |
| `srs-review.html` | 304 | `bc0680b6ff23846567c6a830405ccad759d963dd288d3cb773a787f18b52ac06` |
| `styles.css` | 130528 | `5d386bddbe9949b86871ab81e5b8a80dd8c9f3d15f00abc26ee9e917b2b00eff` |
| `src/styles/workflow-ui.css` | 12106 | `94b710f569dc85fa570785da772e59ca117d1f633dce64e68eaeee488e73ed6c` |
| `src/features/learning-ui/learning-ui.css` | 2723 | `9cb87c3887b3f835aea98c62672c6969ea69292caae0573bd35df1b198029f96` |
| `src/features/srs-review/srs-review.css` | 30854 | `1858d80dc076114c326a9dce99d04ab348b67da29a1189c9347011cfd9496683` |
| `src/features/passage-preview/passage-preview.css` | 17201 | `f798ae557cd48f24e4c1dbe43ca84c8fe4bf34004c711d8be2a8208f3c97ebf9` |
| `src/main.js` | 6446 | `4531b74ca4927524d637cd4f759851e3aa12541eba9446163a5cdf78f1c0be5a` |
| `src/srs-review-main.js` | 1657 | `c53f8023c826081f90e6004b11efc75261327d22f2d1e3abed5b0f8af6cfbee7` |

生产产物的关键关联为：`dist/index.html` `64c22652b74530d0df7af3b2faa0178eda1d8a25c659ac1ad9de16df43ec48ad`，`dist/srs-review.html` `170113155c3d91bd4007d46d9edfde21fac6508b5eda6eb1de57d2c9d0f0f40e`，`assets/learning-ui-Bro_USD4.css` `8d6b62637d39d420b11e02fb1878c3fa0db72cc6249b0cbaac7066926e45a0`，`assets/reader-auDsIFgr.css` `cfdea1aae0ca53407327b4ae0b3142d57e127d0039431d05b47a3d3f5c689580`，`assets/SrsReviewPage-Dcm8sjX7.js` `4969f007b6ec3e7d03b1a8a28d25def4ff4ee780e3690b993a6f44ea0b4d3aa8`。

当前两个入口的实际加载身份：

- `index.html` → `src/main.js`；reader 生产页面的实际 CSS link 顺序为 `learning-ui-Bro_USD4.css` 后 `reader-auDsIFgr.css`。外部 Google fonts/CSE 请求被隔离器阻断，不能因此声称控制台零错误。
- `srs-review.html` → `src/srs-review-main.js`；初始 document link 为 `learning-ui-Bro_USD4.css`，SRS 专用 CSS 已在当前源码 manifest 和 `SrsReviewPage-Dcm8sjX7.js` 的异步 asset graph 中核对，初始快照没有单独的 SRS CSS link。

## 2. 当前生产构建 CLS 证据

以下不是历史 PASS 的复述，而是对上面这次当前源码构建的重新测量。每个入口使用新的 Chromium context；reader 使用严格虚拟 origin 和合成运行时，standalone SRS 使用当前 `srs-review.html` 加本地 synthetic sample。所有页面无横向文档溢出，page error 为 0。

| 入口/状态 | viewport | load ms | CLS | body width | 实际样式身份 |
| --- | ---: | ---: | ---: | ---: | --- |
| reader current build desktop | 1280×800 | 1159 | **0.004350** | 1280 | `learning-ui` → `reader` |
| reader current build mobile | 390×844 | 1179 | **0.007579** | 390 | `learning-ui` → `reader` |
| SRS current build desktop | 1280×800 | 1096 | **0** | 1280 | `learning-ui`，SRS async asset graph |

三项均低于既定生产 CLS `< 0.01` 门槛。原始证据：[production-cls.json](C:/Users/0/AppData/Local/Temp/readweb-ui-w02-w05-20260929-221500/production-cls.json)。

## 3. F01/F02 前后证据与复测

### F01：transcript header 目标面板

既有独立审核的基线是 `.transcript-header` 仍有玻璃背景/光斑/inset 装饰；本轮复用其问题定义，不把历史截图冒充当前生产证据。当前生产构建的实际计算值为：实色 `background: rgb(255, 255, 255)`（custom 状态使用本域变量映射）、`backdrop-filter: none`、边框/功能阴影保留、`::before`/`::after` 的 `content: none`。

当前来源和获胜关系：

- `src/composables/glass-effects.js:5-12,78-103,113-153` 把 `.controls,.extra-controls,.transcript-header` 放入 target selector，初始化、重复初始化、MutationObserver 新节点和 dispose 都清除目标玻璃状态；保留消费者仅在 panel selector 中装饰。
- `styles.css:1839-1878` 的 reader card 映射和目标伪元素清理位于共享玻璃规则之后，覆盖旧伪元素声明。
- `npm run verify:glass-effects` 通过，浏览器在 light/dark/custom、动态转录节点和当前 production asset 中均未见目标表面的模糊或装饰残留。

结论：F01 **PASS**。

### F02：controls / extra-controls 目标面板和运行时接线

当前 `.controls`、`.extra-controls` 均为实色 reader card，`backdrop-filter: none`，两个伪元素均为 none；初始化和动态节点不会重新挂上目标 `glass-panel`/pointer 装饰状态。共享 `.glass-panel` 仍服务 helper/style-editor/Toast 等非目标消费者，不能把共享规则存在本身判为缺陷。

`#chunk-style-modal` 虽保留 `glass-panel ui-glass-dynamic` 作为旧 style-editor 消费者，但 `styles.css:2058-2072` 的 ID 规则获胜，实际 `backdrop-filter: none`、两个伪元素 none；这属于保留的 S4 style-editor 表面，不是 F02 三目标面板。

结论：F02 **PASS**。F01/F02 的既有源码改动、独立审核文档和未提交状态均未被本轮回滚或覆盖。

## 4. W02 当前入口与子视图清单

### 4.1 容器级清单

`UI-10` 不是漏测：它在当前 `vite.config.mjs` inputs/import graph 中没有当前入口或 route consumer，因此按当前产品范围排除；相关历史/demo/test 对象没有被冒充成当前界面。

| 容器 | 当前入口/真实路径 | 实际打开状态 | 证据/缺口 | 元素组 |
| --- | --- | --- | --- | --- |
| UI-01 Reader shell | `index.html` / `#vue-root` | opened | light/dark/custom、390px custom、旧工具 disclosure、synthetic transcript/chunk | EG-01–06 |
| UI-02 Theme/custom | `#theme-toggle` → `#theme-custom-panel` | opened | dark/custom 真实按钮路径和变量状态；reset 控件已在 DOM/样式中核对，但未为改变偏好而强制点击 | EG-07–08 |
| UI-03 Old tools/chunk style | `.deprecated-file-entry > summary` → `#btn-chunk-style` | opened | collapsed → 展开旧工具 details → 点击 chunk style 入口 → 打开/关闭 modal → 焦点回到入口；未直接调用 open API | EG-09–10 |
| UI-04 Workflow material center | `.youtube-material-entry` | opened with bounded gap | library、较早筛选、row menu、quality、queue、settings、advanced、add invalid/valid 均打开；ready material 的真实音频身份因严格隔离没有提交/媒体 owner，列为 S5 | EG-11–16 |
| UI-05 Reader media/content | reader transcript/chunk + `__mediaSource` synthetic | opened | translation details、chunk focus、video float minimize/close；audio 控件外观核对但没有真实媒体 bytes | EG-17–20 |
| UI-06 AI annotation/vocabulary | 三个 reader 按钮 | partially-opened | 用现有 `applyCurrentAudioMeta` 注入合成 job identity 后，AI dialog 与 settlement dialog 真实打开/关闭；preview 主 dialog 缺少可用 annotation bundle/vocabulary-owner 前置条件，保留 S5 | EG-21–23 |
| UI-07 Reader learning | `#srs-review-entry-root` | opened | reader SRS overlay empty/owner-blocked、preview settings、synthetic import/reveal/shortcut/next/complete/close、390px preview | EG-24–27 |
| UI-08 Standalone SRS | `srs-review.html` / `#srs-review-app` | opened | synthetic two-card、history、answer reveal、rating、390px after rating | EG-28–31 |
| UI-09 Feedback/owner notices | Toast / load notice / owner status | partially-opened | workflow synthetic error and SRS missing-audio alert visible；async load failure、Toast success/error、owner-not-ready 分支没有安全强制 | EG-32–34 |
| UI-10 Historical/demo/test | 当前 build inputs/import graph | excluded | `personalization-shadow`、`PassagePreviewCheckPage` 没有当前入口/route consumer；排除理由已记录 | — |

### 4.2 48 个实际状态快照

```text
reader-default-light-desktop
reader-dark-desktop
reader-custom-desktop
reader-custom-mobile
reader-deprecated-tools-open
chunk-style-modal-opened
chunk-style-modal-closed
reader-transcript-synthetic-default
reader-transcript-translation-open
reader-transcript-actions
reader-chunk-synthetic
reader-chunk-focus-toggled
workflow-library-empty-or-data
workflow-library-earlier
workflow-library-row-menu
workflow-quality-dialog
workflow-quality-closed
workflow-queue
workflow-settings-collapsed
workflow-settings-advanced
workflow-add-links
workflow-closed
reader-synthetic-current-identity
annotation-dialog-synthetic
annotation-dialog-closed
vocabulary-settlement-dialog-synthetic
vocabulary-settlement-dialog-closed
reader-srs-overlay
reader-srs-overlay-closed
passage-preview-settings
passage-preview-settings-closed
passage-preview-initial
passage-preview-revealed
passage-preview-shortcut-dialog
passage-preview-shortcut-edit-cancelled
passage-preview-shortcut-closed
passage-preview-after-next
passage-preview-mobile-revealed
passage-preview-complete
passage-preview-closed
video-float-open
video-float-closed
srs-standalone-initial-two-card
srs-history-open
srs-history-closed
srs-answer-revealed
srs-after-good-rating
srs-standalone-mobile-after-rating
```

完整浏览器数据、元素/表面计算值和 action 状态：[full-style-audit.json](C:/Users/0/AppData/Local/Temp/readweb-ui-w02-w05-20260929-221500/full-style-audit.json)。最终结果为 48 states、44 actions，其中 41 pass、3 blocked；`blockedRequests=11` 是外部/未知/未声明请求的隔离计数，不是 11 个产品失败。

真实 chunk style 路径特别记录如下：

1. 用真实 `locator.click({ force: true })` 点击 `.deprecated-file-entry > summary`，确认 `details.open=true`。
2. 在展开后的旧工具区域点击 `#btn-chunk-style`，确认 `#chunk-style-modal` visible。
3. 读取实际计算样式：实色 `oklch(1 0 0)`、`1px solid oklch(0.922 0 0)`、18px radius、功能阴影、`filter:none`、`backdropFilter:none`、`::before/after content:none`。
4. 点击关闭，确认 modal hidden 且焦点回到 `#btn-chunk-style`。

没有用 `window.openChunkStyleModal()` 之类的直接调用替代该路径。

## 5. 样式来源、实现模式与元素组逐项分类

### 5.1 判定口径

- M1：Vue 共享/learning 组件，外加 scoped/dedicated feature CSS。
- M2：legacy/native DOM 使用当前 native helper、owner mapping 或共享配方。
- M3：专用 CSS、内联属性、运行时 class/variable；表中会指出专用来源。
- M4：浏览器/OS 原生外观，例如 audio、file、color、details disclosure；M4 是例外来源，不自动等于缺陷。
- S1：当前 DOM、最终计算属性和共享配方符合原目标。
- S2：原方案明确保留的原生/专用外观，逐属性说明保留范围。
- S3：原范围漏改/旧规则覆盖，且有条款、消费者、获胜规则和可复现差异；本轮为 0。
- S4：专用保留或新增统一建议，不倒推为原验收失败。
- S5：前置条件缺失或隔离阻断，列出最小补充方式。

获胜规则的证据原则是“源码消费者/级联位置 + 当前浏览器 computed style/伪元素 + 交互状态”三线对账，不只看类名、36px 或孤立截图。当前共享来源主要是：`src/lib/native-control-styles.js`、`src/lib/native-input-styles.js`、`src/features/learning-ui/learning-ui.css` 的 layer/utilities、`styles.css` global reader rules、`src/styles/workflow-ui.css` workflow tokens、`src/features/srs-review/srs-review.css`、`src/features/passage-preview/passage-preview.css`、各 Vue/compatibility module，以及 `src/main.js` 的 side-effect import 和 helper binding。

### 5.2 34 个元素组完整清单

| ID | 页面/选择器 | M | 样式来源及当前获胜规则 | 状态 | 证据与边界 |
| --- | --- | --- | --- | --- | --- |
| EG-01 | `.controls,.extra-controls,.transcript-header` | M2+M3 | `index.html` + `styles.css` reader card/pseudo suppression + `glass-effects.js` target exclusion | S1 | F01/F02 目标；solid、无 blur、无装饰伪元素，light/dark/custom/dynamic 均核对 |
| EG-02 | `[data-ui-owner="reader"] button` | M2+M3 | `index.html` + learning utility/helper owner mapping + `styles.css` reader h-9 recipe | S1 | 默认按钮 height/padding/gap/radius/font/SVG sizing sampled；不把 workflow 专用按钮反推为同族 |
| EG-03 | `[data-ui-owner="reader"] input` | M2+M3 | `native-control-styles.js`/`native-input-styles.js` + `styles.css` | S1 | text/hotkey/color inputs；file/color 的 OS 部分单列 M4 |
| EG-04 | `.deprecated-file-entry, summary` | M4+M3 | `index.html` native details/file DOM + `styles.css` disclosure rule | S2 | 原生展开语义与 file geometry 保留；实际展开路径通过 |
| EG-05 | `.reading-area,.transcript-line,.word-highlight,.sentence-active` | M1+M3 | `TranscriptContainer.vue` + `styles.css` transcript rules | S1 | synthetic transcript、translation details、active path 打开 |
| EG-06 | `.chunk-mode,.chunk-block,.chunk-en,.chunk-cn` | M1+M3 | `ChunkModeView.vue` + `styles.css` chunk rules | S1 | synthetic chunk、中文显示、focus toggle 打开 |
| EG-07 | `#theme-toggle,#theme-custom-panel,input[type=color]` | M2+M3 | `theme-controls-module.js` + Pinia theme store + `styles.css` custom editor | S2 | 专用 palette editor；light/dark/custom 路径已测，color picker 仍属原生子控件 |
| EG-08 | `[data-theme],[data-theme-mode]` variables | M3 | `src/pinia-stores/theme.js` runtime attrs/vars | S1 | light → dark → custom 变量转换在当前页面可见 |
| EG-09 | `#chunk-style-modal,.modal-backdrop` | M2+M3 | `index.html` + `style-editor.js` + `styles.css` ID rule | S4 | 旧 style-editor consumer；真实 details → entry 路径打开/关闭；不是 F01/F02 目标面板 |
| EG-10 | chunk size/gap/color inputs、shadow toggle | M2+M3 | `index.html` + `style-editor.js` + `styles.css` | S4 | 数字/color/switch 分开核对；原方案未要求把 style editor 全部改成统一 Dialog |
| EG-11 | `.youtube-workflow-panel,.youtube-workflow-backdrop,.youtube-workflow-header` | M1+M3 | `YouTubeWorkflowPanel.vue` + `workflow-ui.css` + `styles.css` | S4 | domain workflow shell 有自己的 backdrop/card/token；无 F01/F02 条款 |
| EG-12 | `.youtube-workflow-nav,.youtube-filter-tabs,.youtube-library-time-filter` | M1+M3 | `YouTubeWorkflowPanel.vue` + `workflow-ui.css` | S4 | tabs/filter active/较早筛选打开；外围 pill 与普通 button 分开判定 |
| EG-13 | `.youtube-workflow-job,.youtube-link-card,.youtube-library-row-menu` | M1+M3 | `YouTubeWorkflowPanel.vue` + `workflow-ui.css` | S4 | synthetic ready/failed/active records、row menu 打开；ready 内容媒体 owner 另列 S5 |
| EG-14 | `.youtube-quality-card` | M1+M3 | `YouTubeWorkflowPanel.vue` + `workflow-ui.css` | S4 | 质量报告打开/关闭，status/issues/footer actions 可见 |
| EG-15 | `.youtube-add-material-form,.youtube-material-link-input,.youtube-api-key-settings` | M1+M3 | `YouTubeWorkflowPanel.vue` + `workflow-ui.css` + shared Input/Textarea | S4 | invalid/valid link、settings fields 打开；合成 mutation 未写真实服务 |
| EG-16 | `.youtube-advanced-settings,.youtube-material-notice` | M1+M3 | `YouTubeWorkflowPanel.vue` + `workflow-ui.css` | S5 | advanced 已打开；completed mutation notice 需要真实/可模拟的完成信号，本轮不强行写服务；ready open media identity 也未冒充成功 |
| EG-17 | `#audio-player,audio[controls]` | M4+M3 | `index.html` + `media-source-module.js` + `styles.css` | S2 | native media geometry/control appearance 保留；没有真实 bytes |
| EG-18 | `.youtube-video-player,.youtube-video-titlebar` | M1+M3 | `VideoPlayerFloat.vue` + `styles.css` | S2 | synthetic video open/minimize/close；媒体内容仍是 data/synthetic |
| EG-19 | `.grok-box,.grok-summary,.grok-content` | M1+M3 | `TranscriptContainer.vue` + `styles.css` | S2 | translation details disclosure geometry 保留；未把 details 强制成通用 card |
| EG-20 | `.annotation-bubble,.sentence-active,.word-highlight` | M1+M3 | `annotation-bubble.js` + playback/transcript modules | S5 | 没有安全的 generated annotation payload，bubble content path 未打开；最小补充是合成保存的 annotation bundle 后复测 |
| EG-21 | `.annotation-backfill-dialog*` | M3 | `annotation-backfill-ai-module.js` + `styles.css`/`learning-ui.css` | S4 | 通过合成 current identity 真实打开/关闭；Gemini/API key/run/import 不调用 |
| EG-22 | `.vocabulary-preview-dialog*` | M3 | `vocabulary-preview-module.js` + `styles.css` + `learning-ui.css` | S5 | settlement variant 已打开/关闭；preview 主 dialog 因 current annotation-bundle/vocabulary-owner 前置条件阻断，focused fake-storage module test 不替代当前生产入口证据 |
| EG-23 | `#annotation-mark-count,#btn-toggle-preview-vocabulary` | M2+M3 | `index.html` + app-handlers/annotation runtime | S1 | status/count 和 toggle entry 在 reader shell 中可见；没有把动态数据缺失判成 CSS 缺陷 |
| EG-24 | `.srs-review-page.is-overlay` | M1+M3 | `SrsReviewPage.vue` + `srs-review.css` | S4 | reader overlay reached empty/owner-blocked state；专用 learning surface 不强制套 reader card |
| EG-25 | `.passage-preview-page,.passage-preview-word-panel,.passage-preview-context` | M1+M3 | `PassagePreviewPage.vue` + `passage-preview.css` | S4 | synthetic import/reveal/next/complete，desktop/mobile content 打开 |
| EG-26 | `.passage-preview-shortcut-dialog,.passage-preview-translation-mode-switch` | M1+M3 | `PassagePreviewPage.vue` + `passage-preview.css` | S4 | shortcut open/edit/Escape/close；translation switch context 核对 |
| EG-27 | `.passage-preview-learning-settings-dialog` | M1+M3 | `PassagePreviewSettingsDialog.vue` + `passage-preview.css` | S4 | settings shell/input/footer 打开；save 不发送 Host |
| EG-28 | `.srs-review-page:not(.is-overlay),.srs-review-word-panel,.srs-review-context` | M1+M3 | `SrsReviewPage.vue` + `srs-review.css` | S2 | standalone synthetic two-card；dedicated learning geometry/auto-height 保留 |
| EG-29 | `.srs-review-history,.srs-review-shortcut-settings` | M1+M3 | `SrsReviewPage.vue` + `srs-review.css` | S4 | history/shortcut surface 打开；未把专用设置重写为 reader controls |
| EG-30 | `.srs-review-reveal,.srs-review-actions,.srs-review-rating` | M1+M3 | `SrsReviewPage.vue` + learning button baseline + `srs-review.css` | S1 | answer reveal、synthetic rating 实际执行；共享 button recipe 生效 |
| EG-31 | `.srs-review-state,.srs-review-completion-counts` | M1+M3 | `SrsReviewPage.vue` + `srs-review.css` | S4 | empty/completion state 属于 dedicated learning surface；未以普通卡片规则覆盖 |
| EG-32 | `.toast-message.glass-panel` | M1+M3 | `ToastMessage.vue` + `glass-effects.js` + `styles.css` | S4 | 非 F01/F02 的 retained glass consumer；本轮没有把它无证据判成原范围缺陷 |
| EG-33 | `.learning-page-load-notice,.learning-page-load-notice-card` | M1+M3 | `LearningPageLoadNotice.vue` + `learning-ui.css` | S5 | 正常 lazy load 太快，failure overlay 未安全强制；最小补充是独立 loader-failure fixture |
| EG-34 | `.vocabulary-owner-not-ready,[data-vocabulary-owner-status]` | M1+M3 | `App.vue` + `learning-ui.css` | S5 | fresh browser 没有 owner integration，owner-not-ready branch 未渲染；最小补充是隔离 owner-status fixture |

元素组状态计数：**S1=8，S2=6，S3=0，S4=15，S5=5**。

## 6. S2、S4、S5 分开交接

### S2：明确保留，不冒充全应用统一

EG-04 原生 details/file、EG-07 theme custom editor、EG-17 audio、EG-18 video float、EG-19 transcript details、EG-28 standalone SRS 是当前有消费者和行为边界的原生/专用外观。保留的是各自必要语义、媒体/布局或 domain geometry，不是对所有 padding/radius/shadow 的无条件豁免。

### S4：新增统一建议，不倒推成原范围失败

- workflow library/queue/settings/quality/add material 维持 domain tokens，但可在后续设计任务中提取统一 Dialog/Tab/Filter/Notice primitives。
- chunk style editor、Toast、reader SRS overlay、standalone SRS、passage preview 的 card/dialog tokens 可以统一命名和 focus/close 规则；不要在没有布局回归证据时抹平 SRS auto-height 或 preview 专用状态。
- AI annotation 和 vocabulary settlement/preview 窗口可共享 learning Dialog 的标题、字段、footer、busy/error 语义；本轮只记录建议，不安装组件、不重排 DOM。
- 原生 audio/file/color/details 控件可考虑只统一外围 label/focus token，保留 OS 行为和选择器。
- 非目标 shared `.glass-panel` 消费者可另开小范围统一任务；它们不属于 F01/F02 三个目标面板。

### S5：明确缺口和最小补充条件

1. `EG-16`：用严格隔离的 completed mutation/notice fixture 或真实批准的 synthetic owner signal，重新打开 material notice；不直接调用真实 workflow service。
2. `EG-20`：准备 synthetic generated annotation bundle/marked target，走当前 annotation index/bubble click path，记录 bubble 外壳和内容。
3. `EG-22`：给当前生产入口提供不写持久数据的 annotation bundle 与 vocabulary owner fixture，重新点击 preview 主入口；focused fake-storage module check 不能替代这一条。
4. `EG-33`：独立阻断 async chunk 的 loader fixture，实际打开 `LearningPageLoadNotice` failure 状态。
5. `EG-34`：隔离地返回 owner-not-ready 状态，实际打开 owner notice；不要把真实桌面快捷方式或 Host 作为本轮默认前置。

此外，workflow ready material 的 `audio-player` identity 在严格隔离环境中没有完成真实 loader/owner 提交；row menu、quality、queue、settings、advanced、add 视图已经实际打开，因此这个缺口没有扩大为整个 workflow 容器失败。

## 7. W05 命令与结果

| 命令/证据 | 结果 | 说明 |
| --- | --- | --- |
| `git diff --check` | PASS | 当前脏工作树无 whitespace error |
| `npm run verify:glass-effects` | PASS | target selector、动态节点、dispose/pseudo 约束通过 |
| `npm run verify:reader-app-runtime` | PASS | reader app runtime composition 通过 |
| `npm run verify:theme-controls-module` | PASS | theme owner/binding 通过 |
| `npm run verify:keyboard-boundary` | PASS | keyboard boundary 通过 |
| `npm run verify:script-order` | PASS | 当前 `index.html` script order 通过 |
| `npm run verify:youtube-workflow-panel` | PASS | workflow panel 静态/owner/style contract 通过 |
| `npm run verify:srs-review-ui-v2` | PASS | SRS UI contract 通过 |
| `npm run verify:passage-preview:unit` | PASS | passage preview unit contract 通过 |
| `npm run verify:passage-preview-shortcuts` | PASS | shortcut/focus contract 通过 |
| `npm run verify:annotation-backfill-ai` | PASS | annotation dialog module contract 通过 |
| `npm run verify:vocabulary-preview-ui` | NOT_VERIFIED | browser 子检验在临时 server `127.0.0.1:45988` 的 `networkidle` 等待处超时（`scripts/vocabulary-preview-ui-check.cjs:97`）；不是当前产品 UI FAIL，不把它写成 PASS |
| `npm run verify:vite` | NOT_RUN | 当前脚本默认启动/连接仓库 Vite/API 路径，无法在本轮不触及服务/数据边界的前提下安全运行；已由当前源码 Temp production build + strict route browser evidence 替代 |
| `npm run verify:production-preview` | NOT_RUN | 同上，默认 production preview/load harness 不是本轮隔离的虚拟 origin；未访问真实服务，未伪称通过 |
| `npm test` | NOT_RUN | 遵守方案“不无差别跑完整 npm test”，本轮采用固定和受影响 focused checks |
| Temp production build | PASS | 新 `dist` 成功生成，未写仓库原 `dist` |
| Temp production CLS | PASS | reader desktop/mobile 与 standalone SRS 均 `<0.01` |

## 8. R08、R09 与 C01–C08 逐项回答

### R08 / R09

| 编号 | 结论 | 依据 |
| --- | --- | --- |
| R08 当前源码加载与身份明确 | **PASS** | 当前 HEAD/源码 manifest 已固定；当前源码以新的 Temp `dist` 构建；`index.html` 与 `srs-review.html` 两入口、实际 CSS/async asset 及 Chromium 145 加载记录均在 `production-cls.json`；三项当前 CLS 为 0.004350/0.007579/0 |
| R09 交付诚实性与隔离 | **PASS** | 新记录同时交付通过项、S2/S4、5 个 S5、NOT_RUN/NOT_VERIFIED 原因和最小补充条件；没有提交、promotion、真实 Host/API/数据写入，也没有覆盖旧交接或编造 preview 主 dialog/ready media PASS |

### C01–C08

| 标准 | 结论 | 可查证依据 |
| --- | --- | --- |
| C01 范围发现 | **PASS** | `index.html`、`srs-review.html`、`src/main.js`、异步 Vue/feature CSS、runtime dynamic DOM、浏览器状态和 CSS consumer 三线对账；UI-01–UI-10 全列出，UI-10 有当前 import/build 排除理由 |
| C02 逐项打开 | **NOT_VERIFIED** | UI-01–UI-05、UI-07–UI-08 的当前子视图有实际打开记录；UI-06 的 preview 主 dialog、UI-09 的 failure/owner 分支、UI-04 ready media/notice 仍按 S5 单列，未用抽样冒充全量 |
| C03 逐元素覆盖 | **PASS** | EG-01–EG-34 覆盖外壳、文字/label、卡片、status/notice、kbd、switch、筛选、媒体、正文、native controls 和专用窗口；同族边界写在每行 |
| C04 来源准确 | **PASS（有界）** | 每个元素组给出 M1–M4、源文件/selector、当前获胜规则和 computed-style/interaction 证据；这是源码级 cascade/source mapping，不声称每个元素都有 DevTools matched-rules 全量导出 |
| C05 例外准确 | **PASS** | S2 逐属性保留、S4 建议、S5 前置条件与 S3 原范围缺陷分开；没有把专用外观或 shared glass consumer 反推为 F01/F02 失败 |
| C06 状态与布局 | **NOT_VERIFIED** | 48 个状态覆盖 light/dark/custom、1280×800/390×844、focus/close/click、translation/chunk/workflow/passage/SRS；但 S5 的 error/loading/owner/preview-main 分支没有安全打开，故不写全量 PASS |
| C07 生产一致性 | **PASS** | 当前 production Temp build 核对两个入口的 CSS/async asset 身份和顺序；reader 实际 `learning-ui → reader`，SRS 初始 `learning-ui` 加 SRS async graph；目标表面 computed style 和 CLS 均来自本次当前构建 |
| C08 证据与保护 | **PASS** | evidence 明确区分当前源码、当前 Temp production、合成、隔离、focused module 与历史复用；0 Cookie、unknown deny、无真实 Host/profile/key/写入，脏工作树和保护树未触碰 |

因此 W02/W05 的诚实交付状态是“维修通过、调查部分完成、保留明确缺口”，而不是“F01/F02 PASS 即全应用完成”。

## 9. 截图与原始证据位置

原始临时目录：`C:\Users\0\AppData\Local\Temp\readweb-ui-w02-w05-20260929-221500`。

- [full-style-audit.json](C:/Users/0/AppData/Local/Temp/readweb-ui-w02-w05-20260929-221500/full-style-audit.json)
- [production-cls.json](C:/Users/0/AppData/Local/Temp/readweb-ui-w02-w05-20260929-221500/production-cls.json)
- [reader-default-light-desktop.png](C:/Users/0/AppData/Local/Temp/readweb-ui-w02-w05-20260929-221500/reader-default-light-desktop.png)
- [reader-custom-mobile.png](C:/Users/0/AppData/Local/Temp/readweb-ui-w02-w05-20260929-221500/reader-custom-mobile.png)
- [reader-transcript-synthetic-default.png](C:/Users/0/AppData/Local/Temp/readweb-ui-w02-w05-20260929-221500/reader-transcript-synthetic-default.png)
- [reader-chunk-synthetic.png](C:/Users/0/AppData/Local/Temp/readweb-ui-w02-w05-20260929-221500/reader-chunk-synthetic.png)
- [passage-preview-mobile-revealed.png](C:/Users/0/AppData/Local/Temp/readweb-ui-w02-w05-20260929-221500/passage-preview-mobile-revealed.png)
- [srs-standalone-initial-two-card.png](C:/Users/0/AppData/Local/Temp/readweb-ui-w02-w05-20260929-221500/srs-standalone-initial-two-card.png)
- [srs-standalone-mobile-after-rating.png](C:/Users/0/AppData/Local/Temp/readweb-ui-w02-w05-20260929-221500/srs-standalone-mobile-after-rating.png)

临时浏览器脚本和产物没有复制进仓库，旧的 `reader-ui-style-repair-execution-handoff.md`、历史复审文档及已有未提交源码均未回写。
