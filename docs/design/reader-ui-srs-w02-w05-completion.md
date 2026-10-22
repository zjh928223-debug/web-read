# SRS 定点维修与 W02/W05 调查补充交接

日期：2026-09-30（Asia/Shanghai）

本交接只记录本轮拆分范围的事实。它不回写或替代既有维修方案、审核方案、执行交接和上一轮未通过记录。

## 1. 结论先行

- 维修验收：FAIL。F01/F02 和 SRS 产品修复本身成立：唯一确认的本轮 S3/P2 原范围遗漏是 SRS 录键控件局部覆盖 `padding: 5px 8px` 和 `border-radius: 999px`，已只删除这两个覆盖；但交接记录仍有 R09 失败项，不能将维修验收写成 PASS。standalone SRS、reader 内 SRS、1280×800、390×844、深色 reader 下固定浅色学习页、录制/Escape/焦点均有新证据。
- 调查：部分完成。已完成当前入口发现、原 28 项对账、9 个当前容器分组、36 个当前内容子视图、35 个元素组及逐项样式来源/分类；仍有明确 S5 和状态矩阵缺口，不能写“全应用调查完成”。原 35 条编号子视图记录遗漏了已实际取得的 owner-not-ready 记录，本轮补为 `SV-36`。
- 全应用统一：尚有保留或建议。S2 专用/原生外观和 S4 新建议仍保留；没有扩大产品改造，也没有把 S2/S4 批量统一。

本轮没有提交、promotion、任务、代理或 worktree；没有修改协议、schema、依赖、全局 Button 配方、主题体系或产品入口；没有访问真实 Host、profile、API key、sample 或学习资料。

## 2. 开场基线与本轮差异

开场副本目录：

```text
C:\Users\0\AppData\Local\Temp\readweb-ui-srs-w02-w05-20260930-001
```

开场身份：

| 项目 | 值 |
| --- | --- |
| workspace | `E:\read-web-next-optimization` |
| HEAD | `153f9464356c9f59020f4f35ede713a807c798d3` |
| branch | `codex/read-web-optimization` |
| 开场 tracked dirty | 27 个，已在 `opening-baseline.md` 固化 |
| 开场 untracked docs | 6 个，已保留 |
| 本轮允许产品文件 | `src/features/srs-review/srs-review.css`、`SrsReviewPage.vue`、直接相关既有 SRS 检查文件 |

开场允许文件哈希：

| 文件 | bytes | 开场 SHA-256 |
| --- | ---: | --- |
| `src/features/srs-review/srs-review.css` | 30854 | `1858d80dc076114c326a9dce99d04ab348b67da29a1189c9347011cfd9496683` |
| `src/features/srs-review/SrsReviewPage.vue` | 48783 | `5374ccf195bc85b15432b8c3361dbc1e9e9ef84dbdc1aff92e425240895e3a91` |
| `scripts/srs-review-ui-v2-check.cjs` | 34384 | `d6c37c4b38127c24f140f51425bb03d046c25cd5c2a44324467af1b7d5c49e80` |
| `scripts/srs-review-check.cjs` | 73564 | `66af6a39c05c1b6948f740b8911b263b6e9a4c6dd3a6d814f94406307b6e522c` |

本轮产品差异只有 `srs-review.css` 中以下两项删除；`SrsReviewPage.vue` 和既有检查文件未被本轮改动：

```diff
 .srs-review-shortcut-control[data-ui-owner="learning"] {
   min-width: max-content;
   height: auto;
   min-height: 36px;
-  padding: 5px 8px;
   border-color: var(--learning-border);
-  border-radius: 999px;
   color: var(--learning-accent-foreground);
   background: var(--learning-background);
 }
```

开场副本、当前源码/生产资产哈希和构建边界见：

```text
C:\Users\0\AppData\Local\Temp\readweb-ui-srs-w02-w05-20260930-001\opening-baseline.md
C:\Users\0\AppData\Local\Temp\readweb-ui-srs-w02-w05-20260930-001\production-identity-8776.json
```

## 3. SRS 维修前后证据

### 3.1 维修前

使用新建 Playwright Chromium context，导航前 `serviceWorkers: block`，WebSocket close，静态资源白名单，standalone sample 由合成响应提供，未知/外部请求阻断，未使用用户 profile。

证据：

```text
pre-repair/standalone-shortcuts-before.json
pre-repair/standalone-shortcuts-open-before.png
pre-repair/standalone-shortcuts-word-recording-before.png
pre-repair/standalone-shortcuts-sentence-recording-before.png
pre-repair/standalone-shortcuts-word-escape-before.png
pre-repair/standalone-shortcuts-sentence-escape-before.png
```

两个 standalone 录键控件在默认态均复现：

```text
height: 36px; min-height: 36px
padding: 5px 8px
gap: 8px
border-radius: 999px
```

录制操作也实际发生：按钮从 `kbd + 点击修改` 变为 `录制中…/等待按键`，按 Escape 后恢复原快捷键和 `点击修改`。匹配规则记录包含局部 learning 规则以及共享 Button 规则，未把高度 36px 单独当成通过。

### 3.2 维修后 standalone SRS

证据：

```text
post-standalone-desktop/standalone-shortcuts-before.json
post-standalone-mobile/standalone-shortcuts-before.json
post-standalone-desktop/standalone-shortcuts-open-before.png
post-standalone-mobile/standalone-shortcuts-open-before.png
```

两个按钮在 1280×800 和 390×844 的默认态均为：

```text
height: 36px; min-height: 36px
padding: 8px 16px
gap: 8px
border-radius: 6px
font: 14px/20px, weight 500
```

局部选择器现在只保留 `min-width: max-content`、`height: auto`、`min-height: 36px`、learning border/color/background；共享默认 Button 配方获胜 `rw:h-9 rw:px-4 rw:py-2` 和 `rw:rounded-md`。没有复制默认 padding/radius，没有 `!important`。

两个按钮均完成默认 → 录制 → Escape；`kbd` 分别为 R/S，辅助文字和等待状态均记录。录制按钮的自动高度例外仅用于复合录键卡，不再豁免 padding/radius。

### 3.3 维修后 reader 内 SRS

证据：

```text
reader-srs/reader-srs-1280x800.json
reader-srs/reader-srs-390x844.json
reader-srs/reader-srs-1280x800.png
reader-srs/reader-srs-390x844.png
```

路径是当前 reader 入口的真实“今日复习”按钮 → SRS overlay → 历史/快捷键浮层；词库使用浏览器内合成 acquisition service，未读取真实数据。

| 检查 | 结果 |
| --- | --- |
| reader source mount | `[data-vue-mounted]` 成功，source modules 224 |
| reader 深色 | root `data-theme=dark` |
| 学习页隔离 | `.srs-review-page[data-ui-theme="light"]`，固定浅色仍成立 |
| 两个录键按钮 | 8px 16px、6px、36px/min36px、gap 8px |
| 录制/Escape | 实际进入 `is-editing`，Escape 后恢复 |
| 键盘焦点 | Tab 到录键，focus-visible `boxShadow/outline` 有值 |
| 溢出 | 1280 下 `scrollWidth=1280`；390 下 `scrollWidth=390` |

## 4. 源码入口与生产入口分开验证

### 4.1 当前源码 Vite 入口

本轮自有隔离 Vite server 使用 5185，仅用于 Temp 检查，不连接或重启用户已有服务；环境关闭 ECDICT，后端边界为合成 `127.0.0.1:8776`。实际请求证明包括：

```text
http://127.0.0.1:5185/src/main.js
http://127.0.0.1:5185/src/App.vue
http://127.0.0.1:5185/src/features/srs-review/srs-review.css
http://127.0.0.1:5185/src/styles/workflow-ui.css
```

证据：

```text
source-entry/source-entry.json
source-entry/source-entry-reader.png
source-entry/source-entry-correction.json
```

结果：挂载 PASS；source main/Vue/CSS 请求 PASS；213 个 `/src/` 资源；合成 transcript、倍速/跟随/高亮控件、chunk mode、旧工具 `details` 展开后点击 `#btn-chunk-style`、关闭及焦点恢复均 PASS；page errors 0。播放与跳句没有取得有效操作证据：脚本只给 audio 设置 8 字节 RIFF 头的 data URL、设置 `currentTime` 并调用 `forceUpdateUI`，没有调用 `audio.play()`，也没有执行跳句动作；这些项目改为 NOT_VERIFIED。F01/F02 代表面板的 `backdropFilter`、`filter` 和 before/after 均为无装饰状态。

正式 `npm run verify:vite` 本轮没有运行，记录为 `NOT_RUN`。源码入口的替代覆盖和正式命令差异如下：

| 正式检查职责 | 本轮替代检查 | 未覆盖差异 |
| --- | --- | --- |
| 当前源码加载 | 真实 Vite 5185 页面，实际 `/src/main.js`、Vue、CSS 请求 | 未运行脚本内置的 5173/4173 流程；端口/启动器不同 |
| 播放/跳句行为 | 只设置合成 audio data URL、`currentTime`、`forceUpdateUI`；倍速/跟随/高亮控件另有点击结果 | 未调用 `audio.play()`，未执行跳句；8 字节 RIFF 头不是可播放 WAV，播放/跳句保持 NOT_VERIFIED |
| reader 交互 | 实际 transcript/chunk、details→chunk modal、关闭焦点恢复 | workflow/SRS 的完整生产路径另由生产审计和 reader-SRS 脚本覆盖 |

### 4.2 新生产入口

生产构建使用新的 Temp outDir，且显式注入优化后端边界：

```text
VITE_LOCAL_SERVICE_BASE_URL=http://127.0.0.1:8776 npm run build -- --outDir C:\Users\0\AppData\Local\Temp\readweb-ui-srs-w02-w05-20260930-001\production-dist-8776
```

构建退出码 0，Vite 8.2.1，856 modules transformed。旧的未注入 8776 产物保留在 `production-dist` 及 `production-audit`，只作夹具诊断，不作为最终证据；最终证据使用 `production-dist-8776` 和 `production-audit-8776`。

生产审计使用新 context、SW block、WS close、静态产物白名单、合成 workflow/transcript/chunk/SRS/passage 响应和未知/外部阻断。结果：

```text
production-audit-8776/full-style-audit.json
production-audit-8776/audit-reconciliation.json
production-audit-8776/*.png
```

共 48 个浏览器快照、44 个动作结果。workflow 的素材库/行菜单/质量报告/队列/设置/高级/添加、reader transcript/chunk、chunk 真实入口、passage、VideoPlayerFloat、reader SRS、standalone SRS 均有生产快照。13 个阻断项为预期隔离或受阻路径，具体见第 8 节。

## 5. 原 28 项对账与当前统计

### 5.1 三个独立统计

| 统计 | 数量 | 口径 |
| --- | ---: | --- |
| 当前产品容器分组 | 9 | UI-01–UI-09；不是完整界面总数 |
| 历史/演示/测试排除组 | 1 | UI-X；有入口/import 依据后排除 |
| 当前入口对象 | 27 | UI-001–UI-027；UI-028 排除 |
| 不同内容子视图 | 36 | `SV-01`–`SV-36`；`SV-36` 为实际取得的 owner-not-ready 提示；主题、视口、开关/关闭只作为状态，不重复计数 |
| 元素组 | 35 | 原 34 组拆开旧 EG-29，形成 EG-29a/EG-29b |
| 浏览器观察快照 | 48 | 观察证据数量，不当作界面或子视图数量 |

完整机器可读清单和分类：

```text
production-audit-8776/audit-reconciliation.json
```

### 5.2 原 28 项映射

| 旧编号 | 当前对象/子视图 | 结果与证据 |
| --- | --- | --- |
| UI-001 | UI-01/SV-01 reader toolbar | 已映射；reader-default/source-entry |
| UI-002 | UI-01/SV-02 normal transcript | 已映射；reader-transcript/source-entry |
| UI-003 | UI-01/SV-03 AI chunk | 已映射；reader-chunk/source-entry |
| UI-004 | UI-02/SV-04 custom theme | 已映射；desktop/mobile custom |
| UI-005 | UI-03/SV-05 details/file-media | 已映射；真实 summary 展开 |
| UI-006 | UI-03/SV-06 chunk-style modal | 已映射；真实 details→入口→关闭/焦点 |
| UI-007 | UI-04/SV-07–SV-11 workflow panel/tab | 已映射；library/queue/settings/add |
| UI-008 | UI-04/SV-12 row more menu | 已映射；row-menu |
| UI-009 | UI-04/SV-13 quality report | 已映射；quality dialog |
| UI-010 | UI-09/SV-14 material notice | 已映射；loader failure 后真实 notice |
| UI-011 | UI-07/SV-15–SV-17 passage | 已映射；initial/reveal/complete |
| UI-012 | UI-07/SV-18 passage settings | 已映射；settings dialog |
| UI-013 | UI-07/SV-19 passage shortcuts | 已映射；record/Escape/close |
| UI-014 | UI-07/SV-20 preparing overlay | 已列；当前 async 准备完成太快，S5 |
| UI-015 | UI-07/SV-21 waiting threshold | 已列；当前入口未提供可安全触发的阈值契约，S5 |
| UI-016 | UI-07/SV-22 reader SRS overlay | 已映射；reader SRS 1280/390 |
| UI-017 | UI-08/SV-23 history/shortcut | 已映射；standalone/reader |
| UI-018 | UI-08/SV-24–SV-25 standalone SRS | 已映射；front/reveal/rating |
| UI-019 | UI-09/SV-26 learning load notice | 已映射；真实 lazy asset failure/retry/return |
| UI-020 | UI-06/SV-27 vocab preview main | 已列但受阻；bundle/owner 前置条件缺失，S5 |
| UI-021 | UI-06/SV-28 settlement | 已映射；settlement dialog |
| UI-022 | UI-06/SV-29 AI explanation | 已映射；current identity dialog |
| UI-023 | UI-05/SV-30 annotation bubble | 已列但生成 bundle/mark click 未到达，S5 |
| UI-024 | UI-05/SV-31–SV-32 VideoPlayerFloat | 已映射；open/minimize/close |
| UI-025 | UI-09/SV-33 Toast | 真实 `#app-toast` 直渲染已证实；业务触发未证实，S5 |
| UI-026 | UI-09/SV-34 native confirm | 当前产品旅程未调用，S5 |
| UI-027 | UI-09/SV-35 native alert | 当前产品旅程未调用，S5 |
| UI-028 | UI-X/X-01 old `#style-editor-modal` | 排除：当前 Vite 入口/import graph 无消费；不计当前分母 |

## 6. 当前容器、子视图与元素清单

### 6.1 当前容器/子视图覆盖

| 容器 | 子视图 | 已取得状态 | 保留缺口 |
| --- | --- | --- | --- |
| UI-01 Reader shell/content | SV-01 toolbar；SV-02 transcript；SV-03 chunk | light/dark/custom desktop、custom mobile、合成 transcript/chunk | chunk mobile/theme 单独矩阵未补 |
| UI-02 Theme/custom | SV-04 custom editor | dark/custom desktop、custom mobile | custom panel dark+narrow 未单独打开 |
| UI-03 Details/chunk style | SV-05 details；SV-06 modal | details→入口、打开/关闭/焦点恢复 | modal narrow/theme 未补 |
| UI-04 Workflow | SV-07 library；SV-08 queue；SV-09 settings；SV-10 advanced；SV-11 add；SV-12 row menu；SV-13 quality | synthetic ready/failed/active、desktop light | narrow/dark/custom 未验证；ready-media open loader 仍受阻 |
| UI-05 Media/annotation | SV-30 bubble；SV-31 expanded video；SV-32 minimized video | transcript/chunk/video desktop | generated annotation bubble、video narrow/theme 未验证 |
| UI-06 AI/vocabulary | SV-27 preview；SV-28 settlement；SV-29 AI explanation | settlement/AI desktop light | preview main bundle/owner 前置条件仍缺；narrow/theme 未验证 |
| UI-07 Passage/reader learning | SV-15 initial；SV-16 reveal/nav；SV-17 complete；SV-18 settings；SV-19 shortcut；SV-20 preparing；SV-21 waiting；SV-22 reader SRS | passage desktop/narrow light；reader SRS desktop/narrow + dark reader fixed-light | preparing/waiting 未达；多数 dedicated state 未逐一 dark/custom |
| UI-08 Standalone SRS | SV-23 history；SV-24 front；SV-25 reveal/rating | standalone desktop/narrow；shortcut two buttons pre/post | standalone fixed-light；custom 不适用；reader 内完整 SRS 证据另列 |
| UI-09 Feedback/owner | SV-14 material notice；SV-26 load notice；SV-33 Toast；SV-34 confirm；SV-35 alert；SV-36 owner-not-ready | material/load/Toast render/owner-not-ready | Toast business trigger、native confirm/alert、窄屏/主题组合未验证 |

### 6.2 逐项元素、实际属性、获胜来源与 S 分类

以下表的“属性”是代表性关键属性，不把文件名或 36px 当作唯一依据；完整机器表同时保存同一字段。`S5` 是未验证/受阻，不是历史不可达。

| 元素组 | 入口/selector；实际属性 | 获胜文件/selector/layer/变量 | 分类 | 证据/边界 |
| --- | --- | --- | --- | --- |
| EG-01 | `.controls,.extra-controls,.transcript-header`；solid background，backdrop none，before/after none | `styles.css:1867-1875`；reader surface selectors | S1 | F01/F02 生产/source computed；布局阴影保留 |
| EG-02 | reader Button；36px、8px 16px、gap 8px、radius 6px、14/20 | `button-variants.js:4,20`；utilities layer | S1 | source/production control snapshots |
| EG-03 | reader native input；type/颜色/文件语义保留，owner token 继承 | native-control/input styles + reader vars | S1 | native helper 与 reader shell |
| EG-04 | `.deprecated-file-entry > summary`；details open/close，native file geometry | `styles.css:1655-1685` | S2 | 原生 disclosure/file 控件明确保留 |
| EG-05 | transcript lines/words；active/highlight、translation details | `TranscriptContainer.vue` + `styles.css:2252,2311` | S1 | synthetic transcript/translation click |
| EG-06 | `.chunk-block`；chunk text/focus state | `ChunkModeView.vue` + `styles.css:2327-2350` | S1 | synthetic chunk + focus toggle；窄屏缺口另记 |
| EG-07 | theme toggle/custom color inputs；theme variables change | theme-controls + `pinia-stores/theme.js` | S2 | specialized theme editor retained |
| EG-08 | root `data-theme/data-theme-mode`；light/dark/custom token values | `workflow-ui.css:37-111` + theme store | S1 | real transitions observed |
| EG-09 | `#chunk-style-modal`；340px desktop、radius 18、padding 18/20/20 | `styles.css:2036-2070` | S4 | old style-control surface; no automatic F01/F02 defect |
| EG-10 | numeric/color/shadow controls；style-editor-specific geometry | index/style-editor + styles.css | S4 | desktop opened; narrow/theme S5 |
| EG-11 | workflow panel/backdrop/header；semantic workflow palette | `YouTubeWorkflowPanel.vue` + workflow-ui + `styles.css:638` | S4 | specialized workflow shell; no auto repair |
| EG-12 | workflow nav/filter tabs；selected/earlier state | workflow component + workflow-ui | S4 | library/queue/settings filters; mobile/dark S5 |
| EG-13 | job rows/link cards/more menu；ready/failed/active text/actions | `YouTubeWorkflowPanel.vue:205,326,362` | S4 | synthetic records/menu; ready-media open remains S5 |
| EG-14 | quality card/list/footer; issue, 12 chunks/48 words | `styles.css:1012,4718` | S4 | actual quality dialog open/close |
| EG-15 | add textarea min-height 76; settings/API fields | component:114-170 + workflow-ui | S4 | invalid/valid link cards; no mobile/theme |
| EG-16 | `.youtube-material-notice`；message/action/close actual node | component:574-588 + `styles.css:379` | S1 + coverage S5 | actual reader loader failure; only desktop light |
| EG-17 | `#audio-player` native controls；synthetic data URL, no real bytes | index + media-source module | S2 | native media exception; ready media not proven |
| EG-18 | `.youtube-video-player`；expanded/minimized/close titlebar | `VideoPlayerFloat.vue` + `styles.css:1175` | S2 | synthetic video only; mobile/theme S5 |
| EG-19 | `.grok-box/.grok-summary`；border/radius/padding/arrow open | component + `styles.css:2311-2317` | S2 | transcript translation details |
| EG-20 | `.annotation-bubble` target/meaning rows; requires marked target and generated store | resolver + annotation click resolver | S5 | generated bundle/mark click not reached |
| EG-21 | `.annotation-backfill-dialog`；header/form/status/footer | module + `styles.css:3300-3605` | S4 | desktop current-identity dialog; narrow/theme S5 |
| EG-22 | `.vocabulary-preview-dialog` main/settlement; settlement opens, main blocked | module + `styles.css:3605-4049` | S5 for main; S4 for surface suggestion | exact bundle/owner prerequisite gap; no product workaround |
| EG-23 | mark count/preview toggle; identity-dependent availability | index + annotation runtime | S1 | reader shell/current identity evidence |
| EG-24 | reader SRS overlay; dedicated geometry, fixed light in dark reader | `srs-review.css:25,46` + learning-ui | S4 | reader SRS 1280/390 direct evidence；原条款明确固定浅色和控件基线，但未明确保留 overlay 的整套专用 surface geometry |
| EG-25 | passage page/card/context; learning owner fixed-light | PassagePreviewPage + passage-preview.css | S4 | desktop/narrow light；原条款未明确保留整套 passage surface geometry |
| EG-26 | passage shortcut record/Escape/translation mode | passage-preview.css:42-64 + component | S4 | actual record/Escape/close；行为保留不等于原条款明确豁免整套 shortcut surface |
| EG-27 | passage settings inputs/footer | settings component + passage CSS | S4 | desktop light only；原条款未明确把 settings shell 作为专用几何例外 |
| EG-28 | standalone SRS page/card/context | SrsReviewPage + srs-review.css:15-46 | S2 | standalone desktop/narrow fixed-light |
| EG-29a | history/fixed shortcut summary；summary padding 9/10、radius 8 | srs-review.css:300-344,397-431 | S2 | retained history geometry |
| EG-29b | `.srs-review-shortcut-control[data-ui-owner="learning"]`；36/min36、8px 16px、gap 8、radius 6、kbd/small | Button `button-variants.js:4,20` wins padding/radius；local `srs-review.css:368-374` wins min-width/height/min-height/color | S1; historical S3/P2 fixed | pre/post JSON；record/Escape/focus；this is the repaired omission |
| EG-30 | reveal/rating buttons; shared default where applicable, actual reveal/rating transition | SrsReviewPage + learning-ui/Button | S1 | standalone synthetic rating |
| EG-31 | empty/completion state/counts | SrsReviewPage + srs-review.css | S4 | dedicated learning content；原条款未明确保留 completion/empty state 的整套 surface geometry；mobile/state coverage partial |
| EG-32 | real `#app-toast`；rgba background, radius 0, padding 0, shadow, backdrop none | ToastMessage + `styles.css:1364-1401` | S5 | direct render PASS only; business-trigger path NOT_VERIFIED |
| EG-33 | `.learning-page-load-notice`；failed copy, retry and return buttons | LearningPageLoadNotice scoped style + learning-ui | S1 + coverage S5 | actual lazy asset failure/retry/return; desktop only |
| EG-34 | `.vocabulary-owner-not-ready`；role/status/text/data attr | App.vue:3 + learning-ui | S1 + coverage S5 | actual cutover-shaped owner fixture; narrow/theme not checked |

### 6.3 S 分类汇总

当前 35 个元素组的主分类为：S1 12、S2 7、S4 13、S5 3、当前 S3 0。S2 明确归入 EG-04、EG-07、EG-17、EG-18、EG-19、EG-28、EG-29a；EG-24–EG-27 与 EG-31 属于原条款未明确要求的专用 surface/状态，统一归为 S4。`EG-29b` 保留历史记录 `S3/P2 → S1`，不能据此把本轮原范围遗漏写成不存在；它已经有前后复测。

S4 是新增统一建议或原方案未明确要求的专用外观，主要集中 workflow、style-editor、AI/词汇 dialog；S2 是原方案明确保留的 learning/原生/正文专用几何；S5 是未验证/受阻。没有把 Toast 因为非 F01/F02 消费者直接归为 S4。

## 7. 新发现与未扩大维修项

本轮没有新的、同时满足“原范围条款 + 当前消费者 + 可复现获胜规则”的待修 S3；确认的 S3 只有 EG-29b，已按最小范围维修。以下项目只交付分类和最小补充条件：

| 项目 | 分类 | 证据/缺口 | 最小后续条件 | 本轮动作 |
| --- | --- | --- | --- | --- |
| workflow/AI/learning/chunk 等窄屏与主题矩阵 | S5 coverage | 当前 production 主要为浅色 desktop；reader SRS/passage 有窄屏补充 | 每个适用容器用合成数据在 390×844、dark/custom 重开并记录 computed/winner | 不修改产品 |
| vocab preview 主窗口 | S5 | 点击入口后需要当前 `audio/job/doc scope`、可读 generated bundle、owner/repository 读契约；settlement sibling 可打开不等于主窗口已验证 | 用 `getWindowsOwnerVocabularySrsIntegration()` 真实契约、bundle 与 vocabulary service response 重走入口 | 不伪造 DOM、不修改前置条件 |
| annotation bubble | S5 | resolver 需要 marked target + current scope generated index；本轮未直接注入不被产品读取的 flag | 从当前 transcript/marks/import 契约构造 target 与 generated bundle，再点击实际 word span | 不修改产品 |
| Toast 业务路径 | S5 | `#app-toast` 真实渲染已证实；没有把业务错误/完成旅程冒充成功 | 从 workflow/preview/SRS 实际业务动作取得 `showToast/showError` 的可见节点 | 不把 direct API 结果当业务 PASS |
| learning load notice | S1 observed / S5 coverage | 真 lazy asset abort 已得到 loading/failed/retry/return；只有 desktop | 390×844 及适用主题重走同一失败动作 | 不修改产品 |
| owner-not-ready | S1 observed / S5 coverage | cutover-shaped owner contract 导致 App 自身渲染 status；没有只设孤立 flag | 390×844/reader dark 下重走并核对恢复 timer/ready transition | 不修改产品 |
| ready media | S5 | workflow library/quality/queue 可打开；ready job 的完整 reader-session/media loader 仍被 synthetic contract 阻断，真实 media 明确未读 | 补齐 loader 所需 session、transcript、chunk、marks、media identity 的合成 response，并检查真实入口 | 不读取真实媒体 |
| native confirm/alert | S5 | 当前安全旅程未调用 | 用现有业务动作触发真实浏览器 dialog，记录 message/close，不直接调用测试替代 | 不改产品 |

chunk 样式弹窗严格沿用真实路径：先展开旧工具 `details`，再点击 `#btn-chunk-style`；独立审核已经验证打开、关闭和焦点恢复，本轮保留该证据，不为此路径修改产品。

## 8. 请求隔离、失败记录与证据边界

隔离脚本位于 Temp，未进入仓库。所有浏览器 context 新建且非持久；SW block；WebSocket close；静态资源白名单；合成业务响应；未知/外部请求默认 abort。生产审计的预期阻断包括 Google fonts/CSE、YouTube oembed、外部 dictionary/TTS，以及当前合成边界之外的请求；这些不作为产品真实网络成功证据。

保留的失败/阻塞记录：

- `production-audit/full-style-audit.json`：第一次重用旧产物审计时，夹具沿用默认 8765；该结果不作为最终生产证据，仅说明夹具边界错误。
- `production-audit-8776/full-style-audit.json`：显式 8776 构建后的最终审计；ready media loader 和 vocab preview main 仍阻塞，annotation bubble/preparing/waiting/native dialog 保留 S5。
- 生产审计中一次 `YouTube workflow service returned 503` page error 来自合成失败/隔离响应；没有把它当成无异常产品 PASS。
- `production-supplemental/supplemental-paths.json`：Toast direct render、learning load notice、owner-not-ready 的独立结果，pageErrors 0。

真实数据保护边界：没有打开用户 profile，没有使用真实 Host/API key/sample/学习资料，没有写 daily reader 数据根；合成 repository/owner/srs 数据只存在浏览器内存或 Temp context。

## 9. CLS 与生产身份

本轮最终 CLS 使用 `production-dist-8776`，不是上一轮 Temp dist；浏览器 Chromium `145.0.7632.6`，新 context，布局稳定窗口沿用既定脚本，记录原始 layout-shift entry 与资源身份。

证据：

```text
C:\Users\0\AppData\Local\Temp\readweb-ui-srs-w02-w05-20260930-001\production-cls-8776\production-cls.json
```

| 入口/视口 | CLS | 结论 |
| --- | ---: | --- |
| reader 1280×800 | 0.003293 | `<0.01` |
| reader 390×844 | 0.007579 | `<0.01` |
| standalone SRS 1280×800 | 0 | `<0.01` |

CLS 文件包含每个 raw layout-shift 的 `value/startTime/sources`、loaded CSS URL、页面尺寸和资源清单；`production-identity-8776.json` 保存源码/产物的 bytes/SHA-256。旧 CLS 只作为历史比较，不用于本轮最终通过。

## 10. 检查命令

固定命令均在本轮产品差异和新生产构建后运行，写入位置如下：

| 命令 | 结果 | 日志 |
| --- | --- | --- |
| `git diff --check` | PASS | `fixed-checks/git-diff-check.log` |
| `npm run verify:glass-effects` | PASS | `fixed-checks/verify-glass-effects.log` |
| `npm run verify:reader-app-runtime` | PASS | `fixed-checks/verify-reader-app-runtime.log` |
| `npm run verify:theme-controls-module` | PASS | `fixed-checks/verify-theme-controls-module.log` |
| `npm run verify:keyboard-boundary` | PASS | `fixed-checks/verify-keyboard-boundary.log` |
| `npm run verify:script-order` | PASS | `fixed-checks/verify-script-order.log` |
| `npm run verify:srs-review-ui-v2` | PASS | `fixed-checks/verify-srs-review-ui-v2.log` |
| `npm run verify:vite` | NOT_RUN | 已由 source-entry-gate 替代，差异见 4.1 |
| `npm test` | NOT_RUN | 按范围未无差别运行完整测试 |

新生产构建日志：

```text
C:\Users\0\AppData\Local\Temp\readweb-ui-srs-w02-w05-20260930-001\production-build-8776.log
```

Temp 支持脚本均保持在约 500 行以下；全审计复用既有 448 行脚本并只用短 wrapper 替换新产物/端口/输出目录，没有增长为语义日志验证器。

## 11. R01–R09 正式状态

| 标准 | 状态 | 依据与范围 |
| --- | --- | --- |
| R01 隔离与工作保护 | PASS | 新 context、SW/WS/未知请求隔离、合成数据、开场 dirty/真实数据保护均有脚本和基线 |
| R02 F01 表面修复 | PASS | source/production 的 transcript-header 与目标 reader surfaces computed/伪元素核对；现有 F01 保留 |
| R03 F02 伪元素修复 | PASS | controls/extra-controls 的 before/after 无绘制，glass-effects 检查 PASS；无误删非目标消费者证据 |
| R04 运行时生命周期 | PASS | 既有 glass-effects 行为检查 PASS；本轮未改生命周期，F01/F02 动态证据保留 |
| R05 其他修复与例外 | PASS | SRS 录键历史 S3/P2 已修为 S1；S2/S4/S5 分开，未扩大维修 |
| R06 控件与主题 | PASS | SRS 两入口、普通配方的 padding/gap/font/radius、深色 reader 固定浅色、390/1280 均有证据 |
| R07 操作与布局 | PASS | chunk details→入口、录键/Escape/焦点、reader SRS、source transcript/chunk、390 溢出均验证；ready media 作为独立 S5 保留 |
| R08 验证和生产一致性 | PASS | 正式 verify:vite 明确 NOT_RUN，但实际源码 Vite source-entry、8776 新生产构建、两入口、异步 CSS、CLS/资产身份均有替代证据 |
| R09 交付和范围诚实 | FAIL | 原交接曾把未执行的播放/跳句写成 PASS，且存在 S2/S4 归属与 owner-not-ready 子视图映射错误；本次已在交接和机器清单中记录纠正，但该交付失败需由后续独立审核确认，不转化为产品源码缺陷 |

R 状态是维修交付判定，不把调查仍有 S5 偷换成全应用统一 PASS。

## 12. C01–C08 正式状态

| 标准 | 状态 | 依据与剩余限制 |
| --- | --- | --- |
| C01 范围发现 | PASS | `index.html`/`srs-review.html`/source imports、实际浏览器入口和 CSS consumers 对账；28 项全部映射，UI-028 有依据排除 |
| C02 逐项打开 | NOT_VERIFIED | 36 子视图已清单化且多数有快照，但 preparing/waiting/vocab preview main/annotation bubble/native dialogs 等受阻或未调用，已保留 S5 |
| C03 逐元素覆盖 | PASS | 35 元素组覆盖 shell、标题/label、提示、kbd、input、switch/tab、媒体/正文、状态和 native 保留项；同族边界在机器表中列出 |
| C04 来源准确 | NOT_VERIFIED | 已为 35 组补实际代表属性、获胜文件/selector/layer/变量；但并非每个受阻/窄屏状态都有完整 DevTools matched-rule 记录，不能冒充完全闭合 |
| C05 例外准确 | FAIL | 上一版交接的 S2/S4 逐项归属与机器清单不一致；本版已统一 EG-24–EG-27、EG-31 为 S4，并将 owner-not-ready 纳入 SV-36，但该记录缺陷按本次审核结论保留 FAIL，等待独立复核确认 |
| C06 状态与布局 | NOT_VERIFIED | SRS/passage/reader 关键状态和 desktop/mobile 已补；workflow/chunk/AI/词汇/部分 learning 仍缺适用窄屏/主题矩阵 |
| C07 生产一致性 | PASS | source Vite 与 new 8776 production 两套加载链、CSS 资产、异步 learning CSS、F01/F02/SRS代表上下文和 CLS 均有身份明确记录 |
| C08 证据与保护 | PASS | synthetic/isolated/history evidence 分开；未写真实数据/Host；失败和旧产物边界明确 |

因此 C02/C04/C06 不以“48 个快照”“有文件名”或“source/production build 成功”替代正式 PASS。

## 13. 独立审核交接

本次交接纠正只改记录，不改产品源码，不重新构建、不重跑全部门禁、不重新测量 CLS：

1. 源码入口检查将播放/跳句从 PASS 改为 NOT_VERIFIED；保留源码 `/src/main.js` 加载、transcript/chunk、倍速/跟随/高亮控件、chunk 真实入口及关闭焦点证据。原因是原脚本只设置不可播放的 8 字节 RIFF data URL、`currentTime` 和 `forceUpdateUI`，没有 `audio.play()` 或跳句操作。解释性修正见 `source-entry/source-entry-correction.json`，未伪造新的动作结果。
2. 元素分类以 `audit-reconciliation.json` 的既定定义统一：S2=7、S4=13；EG-24–EG-27、EG-31 按原条款未明确保留整套专用 surface/状态归入 S4，S2 仅保留明确的原生/专用几何项。产品不因此扩大维修。
3. 将实际已取得但遗漏编号的 owner-not-ready 记录补为 `SV-36`，当前统计同步为 9 个容器分组、36 个内容子视图、35 个元素组；其窄屏/主题覆盖仍是 S5。

独立审核应将上述纠正与 Temp 最终证据一起复核；在 R09/C05 记录失败被重新审核前，不宣称本轮整体完成。

独立审核应读取本交接及 Temp 最终证据，重点复核：

1. `EG-29b` 当前获胜 padding/radius 和历史 S3/P2 修复边界；
2. source-entry 是否真的加载当前 `/src/main.js`，而非只读 `dist`；
3. `production-dist-8776` 的 asset identity、两入口 CSS 顺序和 CLS raw entries；
4. `audit-reconciliation.json` 的 28 映射、9/36/35 统计和 35 个元素组；
5. Toast direct render 与 business-path S5 的区分，以及 material/preview/bubble/load/owner 的受阻条件；
6. R01–R09、C01–C08 是否仍应按上述正式状态解释。

执行模型在本交接后停止，不自行创建独立审核任务，也不进入第三轮维修循环。
