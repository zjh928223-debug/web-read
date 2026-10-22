# Reader 迁移后清理执行交接（审核问题修复轮）

> 状态：第一修复轮独立复审确认素材覆盖仍有两处 CP06/CP07 P2 回归：遮罩被透明覆盖、390px 移动布局被桌面两列覆盖。第二修复轮已做最小修复并完成 focused、专用 Temp 构建和 1280/390 真实 Playwright 自查；本文件仍不宣称 CP01–CP10 PASS，不宣称日常版替换或全应用外观统一，等待另行安排独立只读复审。

## 0. 2026-10-01 第二修复轮（基于独立复审）

- 依据：`C:\Users\0\AppData\Local\Temp\readweb-cleanup-independent-rereview-20261001-01a0f7c7\rereview-report.md` 的 CP06/CP07 两项确认 P2。
- 第二修复轮证据根：`C:\Users\0\AppData\Local\Temp\readweb-cleanup-repair2-20261001-01a0f7a6`；开场副本在 `before-source/`，逐项台账为 `repair2-candidate-ledger.md`，当前浏览器结果在 `repair-browser-check.json`，目标文件哈希在 `after-target-hashes.json`。
- 最小修改：删除 `styles.css` 中 `.youtube-workflow-backdrop { background: transparent; }` 的后置覆盖；把素材两列 `132px minmax(0, 1fr)` 限定在 `@media (min-width: 761px)`，让既有 `max-width: 760px` 单列规则继续获胜。
- 第二修复轮 after-dist：31 个文件；`index.html` SHA-256=`09DDC3B4E4B4880286861F0E0F4E1CA3327FE075CEB19CC834DD1CF05FFDCE67`。
- 自查实测：1280×800 遮罩为 `rgba(0, 0, 0, 0.28)`、布局为 `132px 634px`；390×844 布局为单列 `390px`，导航和内容宽度均为 `390px`，导航按钮宽度 `122px`。本结果只作为执行侧证据，不能替代独立复审。

## 0.1 2026-10-01 第一修复轮

- 依据：`C:\Users\0\AppData\Local\Temp\readweb-cleanup-independent-review-20261001-01a0f7c7\review-report.md` 的 CP02/CP03/CP05/CP06 确认发现。
- 第一修复轮证据根：`C:\Users\0\AppData\Local\Temp\readweb-cleanup-repair-20261001-01a0f7a6`；逐候选/逐属性台账：`repair-candidate-ledger.md`。
- 第一修复轮 after-dist 身份：29 个文件；`index.html` SHA-256=`BA0994C419FE8A5D4D312FD3AFC7E9D3EBA4E126CF6FC3AC6602E6BD8F0471E6`。
- 处理范围严格限于：删除无消费者的 `learning-model-entry` 与 `has-visual-data` 规则；恢复预习 native translation switch 的 `font: inherit`；恢复 `--chunk-annot-default` 清除列表项；合并素材 backdrop/panel/header 基础规则并把必要的移动端最终属性合并到现有 max-width media；同步一个仍断言已退出 native shortcut CSS 的过时 focused 检查。
- 未改日常版/历史版、业务服务、数据/协议、入口顺序、IndexedDB schema；没有任务、代理、worktree、提交或 promotion。

## 1. 本轮边界

- 唯一实施目录：`E:\read-web-next-optimization`。
- 保护 `E:\read-web-next` 日常版和 `E:\read-web` 历史版；本轮没有编辑、构建、启动、提交或 promotion。
- 没有创建任务、聊天、代理或 worktree；没有提交。
- 没有改 IndexedDB schema、服务/API、业务数据、外部键、依赖/锁文件、入口顺序或日常数据。
- 保留开场全部 dirty、未跟踪文档以及已有 WhisperX/语言处理工作。

## 2. 基线、证据和脏树保护

- 开始时间：`2026-10-01 21:29:02 +08:00`。
- 开场 HEAD：`153f9464356c9f59020f4f35ede713a807c798d3`。
- 分支：`codex/read-web-optimization`。
- 开场状态快照：`C:\Users\0\AppData\Local\Temp\readweb-post-migration-cleanup-20261001-212901-b1592d93\before-status.txt`。
- 开场全量 diff：`before-diff.patch`；开场未跟踪清单：`before-untracked.txt`。
- 8 个主要清理文件的开场副本/哈希：`before-source/`、`before-target-hashes.json`。
- 本轮主要文件的 after 哈希：`after-target-hashes.json`；开场副本到当前内容的逐文件差异：`after-target-diff.patch`。
- after 生产产物：`after-dist/`，共 29 个文件，`index.html` SHA-256 为 `3809C792C1422020CA21B17D80DC7A5A35A5A87F7C7DB52F93E35980BB24FA2A`。
- 前后构建分别为 `before-dist/` 和 `after-dist/`，均使用 `VITE_LOCAL_SERVICE_BASE_URL=http://127.0.0.1:8776`，未使用日常端口/数据。

开场已 dirty 且与本轮清理有重叠的文件是 `styles.css`、SRS/预习 CSS、`style-editor.js`、`glass-effects.js`、`scripts/glass-effects-check.cjs` 和 `scripts/youtube-workflow-panel-v3-check.cjs`；本轮是在其开场内容上做定向清理，不能把 HEAD diff 误当成本轮独占 diff。`src/pinia-stores/theme.js`、`scripts/style-editor-module-check.cjs` 和本交接文档是本轮新增/改动的清理侧文件。其他开场 dirty/未跟踪项均保留，详见快照。

## 3. C01–C06 执行结果

上一轮逐项台账在 Temp 的 `candidate-ledger-final.md`；本修复轮逐候选/逐属性台账在 `C:\Users\0\AppData\Local\Temp\readweb-cleanup-repair-20261001-01a0f7a6\repair-candidate-ledger.md`，结论如下：

- C01：删除已无消费者的 SRS、预习、旧 YouTube reader、旧 editor owner-exclusion 分支；保留原生中文 translation switch、badge/bubble/video/file/small-button 等仍有消费者的通用规则。
- C02：删除 `helper-panel`、`sidebar-open`、`style-editor-modal`、`open-style-editor`、旧生成器/绑定链和仅由其消费的变量；保留 chunk style modal 的打开/关闭/更新、controller、输入/阴影开关、存储、facade、焦点和 dispose。
- C03：删除无消费的 `--liquid-*`、`--pru-app-*`、`--srs-glass-*`、旧 glass base/card 变量及 theme 生成/清除项；保留当前 glass panel/button、Toast/chunk、`--pru-reader-bg`、五色 custom theme 存储和切换/清理语义。本修复轮将仍生成的 `--chunk-annot-default` 补回清除列表，闭合生成/清除配对。
- C04：删除无当前 source/template consumer 的旧 YouTube class 分支和 `.glass-surface`；本修复轮进一步删除未发现产出的 `learning-model-entry` 与 `has-visual-data`（含 hover/dark/highlight 分支），保留由两个 Vue renderer 当前生成的 `preview-vocabulary-word`。
- C05：同一上下文的 job log/title 等重复覆盖和素材 backdrop/panel/header 基础规则已收口；第一修复轮遗漏的透明 backdrop 后置覆盖和移动端两列覆盖已在第二修复轮删除/限于 desktop media；未跨 media/state/layer 合并，也未删除首屏 footprint 或当前 workflow/运行时 utilities。
- C06：更新 style-editor/glass focused 检查以验证退役链退出和当前 chunk/Toast 生命周期；theme/passage shortcut/YouTube focused 检查增加变量配对、native switch 字体、透明覆盖拒绝、断点布局合同和合并基础规则断言，未降低当前 workflow 合同。

产品目标文件的修复后静态扫描结果：`learning-model-entry`、`has-visual-data` 及其旧状态分支均 `NO_MATCH`；候选旧变量、旧 YouTube selector、SRS ownerless 分支和预习退役分支维持上一轮 `NO_MATCH`。正向扫描仍找到 chunk modal、app Toast、`.glass-panel`、visual-vocab、`preview-vocabulary-word`、`--pru-reader-bg`、native translation switch、annotation bubble、video/file/badge/generic small-button 消费者。上一轮原始扫描在 `after-scans.txt`，修复轮逐候选/逐属性台账在 Temp `repair-candidate-ledger.md`。

## 4. 验证裁决

### PASS

- `npm run verify:style-editor-module`
- `npm run verify:glass-effects`
- `npm run verify:theme-controls-module`
- `npm run verify:reader-controls-runtime`
- `npm run verify:reader-app-runtime`
- `npm run verify:script-order`
- `npm run verify:legacy-dom-drain`
- `npm run verify:legacy-deletion`
- `npm run verify:passage-preview-shortcuts`
- `npm run verify:passage-preview`：focused、shortcut、Aria fallback、UI-015 browser 全部 PASS。
- `npm run verify:srs-review-ui-v2`
- `npm run verify:youtube-workflow-panel`
- `npm run verify:vocabulary-preview-ui`
- `npm run verify:annotation-bubble`
- `git diff --check`
- `VITE_LOCAL_SERVICE_BASE_URL=http://127.0.0.1:8776 npm run build -- --outDir <Temp>\after-dist`：856 modules transformed，after-dist 生成成功。
- `node scripts/passage-preview-browser-check.cjs`：`First-contact vocabulary preview browser verification passed.`
- 修复轮构建：`VITE_LOCAL_SERVICE_BASE_URL=http://127.0.0.1:8776 npm run build -- --outDir C:\Users\0\AppData\Local\Temp\readweb-cleanup-repair-20261001-01a0f7a6\after-dist --emptyOutDir`，856 modules transformed，PASS。
- 修复轮定向浏览器：`repair-browser-check.cjs` 在 `http://127.0.0.1:4182/` 的 reader 1280×800 custom→light、reader 390×844 material、预习 390×844 native switch 均 PASS；结果与截图在修复轮 Temp 的 `repair-browser-check.json`、`reader-material-desktop.png`、`reader-material-mobile.png`、`passage-native-switch-mobile.png`。
- 第二修复轮构建：保存/恢复 `VITE_LOCAL_SERVICE_BASE_URL=http://127.0.0.1:8776` 后运行 `npm run build -- --outDir C:\Users\0\AppData\Local\Temp\readweb-cleanup-repair2-20261001-01a0f7a6\after-dist --emptyOutDir`，856 modules transformed，PASS；after-dist 身份见第二修复轮段落。
- 第二修复轮定向浏览器：`repair-browser-check.cjs` 在 `http://127.0.0.1:4183/` 的 reader 1280×800 custom→light、reader 390×844 material、预习 390×844 native switch 均 PASS；结果与截图在 `C:\Users\0\AppData\Local\Temp\readweb-cleanup-repair2-20261001-01a0f7a6\repair-browser-check.json` 及同目录 PNG 文件。

focused 日志在 Temp 的 `post-focused-verify-*.log`；YouTube/vocabulary 的成功重跑日志分别为 `post-focused-verify-youtube-workflow-panel-rerun.log` 和 `post-focused-verify-vocabulary-preview-ui-rerun.log`。

### 上一轮合成浏览器矩阵 PASS（不是正式后端验收）

临时预览由 after-dist 在 `http://127.0.0.1:4181/` 提供，使用 project Playwright fallback；浏览器插件不可用。矩阵脚本在 Temp 的 `browser-matrix.cjs`，配置 `serviceWorkers: 'block'`、合成 `/api/**` 响应和合成 SRS sample 路由，不访问真实后端/下载/AI/评分/持久化数据。

共 6 个场景且 `errors: []`：

- reader：1280×800 light/dark；390×844 custom/light。Vue root 挂载、退役节点为 0，并实际点击 `.youtube-material-entry`，workflow panel 可见。
- standalone SRS：1280×800 light/dark。SRS page 真实挂载、退役节点为 0、每个场景有 8 个 `data-ui-owner="learning"` 按钮。
- 当前 controls/transcript header/chunk modal 的 computed 几何和显示状态已记录；截图与 JSON 在 Temp 的 `matrix-*.png`、`browser-matrix.json`。

该矩阵覆盖当前 after 资产的入口/挂载/退役节点和代表性 material 入口，不等同于完整 V01–V08，也没有证明真实后端、真实媒体时间推进、TTS/AI、评分持久化或用户设置持久化成功。

### FAIL / NOT_RUN / 未验证

- `npm run verify:production-preview`：FAIL。after-dist 主文档 HTTP 200、Vue/transcript/chunk 已挂载，CLS 总计约 `0.002498`，但 4181 没有后端，`/api/app/health` 返回 404 两次；报告为仓库 `.playwright-artifacts/read-web-load-report.json`。这不是把临时 API mock 矩阵冒充正式生产 PASS 的依据。
- `npm run verify:youtube-workflow-panel-behavior`：FAIL。真实进入 queue attempt history 且看到 prior attempt 后，在既有 destructive focus color 断言失败；实际值为 `color-mix(in oklab, oklch(57.7% .245 27.325) 20%, transparent)`，旧断言只接受原始 `oklch(...)`/十六进制。相关 `button-variants.js`、workflow 组件/样式在开场已 dirty，本轮未改这些产品文件；未能证明该失败由本轮清理引入，故保留 FAIL/NOT_VERIFIED，不削弱断言。日志为 `browser-youtube-workflow.log`。
- `verify:vite`：NOT_RUN。项目要求的 `127.0.0.1:5184` 被开场已存在的 `tailscaled.exe` PID `12552` 占用（监听私有地址），未杀进程、未抢端口、未使用日常 `5174/8766`。
- `npm test`：NOT_RUN。施工方案明确不是本轮强制门槛；focused、after-dist 和合成矩阵已执行。
- 完整真实后端/API、真实媒体播放/跳句、全 V01–V08 的前后截图/属性对照、chunk 输入/ESC/焦点的生产链、SRS reader 内嵌入口、外部 TTS/WhisperX/AI/真实评分持久化仍待后续独立审核或专门环境验证。

## 5. 进程和回滚

- 上一轮创建的临时 preview 4181、第一修复轮 4182、第二修复轮 4183 均已在复测后停止，没有留下本轮服务。
- 5184 的 `tailscaled.exe` 未触碰；8776 后端未启动。
- 没有 `git reset`、`git checkout`、`git clean`、删除用户文件或覆盖开场 dirty。
- 若需要回看/恢复本轮清理前的主要文件，使用 Temp 的 `before-source/` 和 `before-target-hashes.json` 做人工逐文件对照；不要对当前 dirty 树直接执行宽泛 `git restore`。本轮没有提交，回滚必须由用户明确安排。

## 6. 交接结论

第二修复轮已处理独立复审确认的两处 CP06/CP07 P2，并完成对应 focused、Temp build 和 1280/390 定向浏览器自查；CP02/CP05/CP08/CP09 的 NOT_VERIFIED、正式生产加载/YouTube 行为限制以及 CP10 门槛均原样保留，不能改称迁移后清理或当前外观操作保持已完成。标准原位换肤的既有验收、全应用统一、日常版替换是独立状态。本交接完成后等待用户安排独立只读复审；执行侧不把自己的检查升级为独立 PASS。本轮是首个修复/复审失败后的第二修复轮；若本轮复审再次失败，按方案停止自动开启第三轮并交由用户决定是否简化、拆分或继续。

## 7. 2026-10-02 有限补证身份勘误与引用

本节为新增记录；上文旧声明和历史命令状态保留。依照 [剩余补证施工方案](reader-post-migration-cleanup-evidence-completion-plan.md) 执行一次有限补证，详见 [补证交接](reader-post-migration-cleanup-evidence-completion-handoff.md)。本轮未改产品、测试或配置，未build，不自行改判独立CP。

上文第二修复轮 `index.html` 声明 SHA-256 `09DDC3B4E4B4880286861F0E0F4E1CA3327FE075CEB19CC834DD1CF05FFDCE67` 不对应本次实际读取的产物。当前 `C:/Users/0/AppData/Local/Temp/readweb-cleanup-repair2-20261001-01a0f7a6/after-dist/index.html` 实测为 `A4C3EDB3C52E774C7509DF3C7E197F300DAF24765758DF2DFDDD1C73EA27119D`；`srs-review.html` 为 `283557907E66B446AD5E0A0D83C25A084E7419987ADA6079FF415E5E075BB88E`。两个HTML、27个应用assets与最新独立记录吻合，另2个缓存元数据分开登记；浏览器前后字节未变，实际响应hash均匹配。当前清理源码目标hash及全tracked diff亦与最新独立审查吻合，因此仅继承绑定A4C3…资产目录的有限观察。

在施工方案指定的四个证据根内查现有构建/复制记录及index副本，未找到09DD…副本或可核实原因，差异原因 **NOT_VERIFIED**。不断言是笔误、篡改或恢复了历史09DD…产物，也不以新构建覆盖差异。

证据根：`C:/Users/0/AppData/Local/Temp/readweb-cleanup-evidence-20261002-01a0fb48`；`artifact-identity.json`、`artifact-identity-closing.json`、`identity-reconciliation.md`、`response-identity-binding.json`。新逐候选台账记录6项未确定；固定必要矩阵仍有NOT_VERIFIED，正式verify:vite/verify:production-preview/npm test本次NOT_RUN。清理与外观/操作保持未关闭，等待用户另行安排独立只读审核；标准原位换肤原范围PASS、历史C04/C06、日常替换和全应用统一状态不追改。

## 8. 2026-10-02 当前状态索引

按 [F1–F6一次施工方案](E:/read-web-next-optimization/docs/design/reader-post-migration-cleanup-final-pass-plan.md) 完成正常扫描、可见词bubble、390视频自然播放、同阶段首卡/过渡/V2、剩余设置，以及当前源码/最终Temp生产两入口验证。唯一产品修复为首次扫描身份刷新误取消；相关focused、最终Temp build、正式verify:vite/verify:production-preview实际通过。**执行侧全部完成，等待一次独立只读终审**，不自行宣告独立CP PASS。

最新统一交接：[final-pass-handoff](E:/read-web-next-optimization/docs/design/reader-post-migration-cleanup-final-pass-handoff.md)。证据根：`C:/Users/0/AppData/Local/Temp/readweb-cleanup-final-pass-20261002-45739c67`。C01–C06及六项独立闭合索引、历史FAIL/NOT_VERIFIED/NOT_RUN和上文原记录保持；npm test仍NOT_RUN，全应用统一/历史C04/C06/日常promotion独立。自有服务已释放，无提交/日常替换，交接后停止施工。
