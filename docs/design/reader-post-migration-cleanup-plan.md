# Tailwind + shadcn-vue 迁移后清理施工方案

日期：2026-10-01（Asia/Shanghai）。状态：方案已制定，清理尚未实施。

审核依据：[独立只读审核方案](reader-post-migration-cleanup-review.md)。

## 1. 目标与准确状态

标准框架原位换肤原定范围已经全部完工，独立验收 PASS。本轮不重新开启旧验收，
也不设计新按钮或主题。本轮目标是清理该迁移留下的旧实现、不可达界面分支、无消费变量
和重复覆盖，让当前外观的来源更清楚，同时保持当前外观、布局和操作。

一次执行完成本文约定范围，内部按步骤验证；随后交由独立只读审核者审核。
执行者不自动新建聊天、不委派代理、不提交、不 promotion。

“代码清理完成”“标准原位换肤已验收”“全应用外观统一”“日常版替换”是独立状态。
历史 C04/C06 NOT_VERIFIED 和旧命令 NOT_RUN 保留，不用本轮结果追改历史结论。

## 2. 硬边界

- 唯一实施目录 `E:\read-web-next-optimization`，先读当前 AGENTS.md。
- 不使用 worktree；保留开场全部 dirty 文件、未跟踪文档与 WhisperX/语言处理工作。
- 不编辑、构建、启动或提交日常树 `E:\read-web-next` 与历史树 `E:\read-web`。
- 手工优化预览使用 `config/runtime.optimization.json`、5184/8776、优化数据根。
- 不改 IndexedDB schema、Host 协议、业务服务、评分/学习计划、持久化键名或数据迁移。
- 不改组件 preset、依赖版本、package-lock、按钮配方、文字/图标标准尺寸。
- 不移动、增减或隐藏当前入口，不改文案、id/ref/事件、快捷键、焦点及弹窗控制语义。
- 不改 `index.html` 的脚本/样式入口顺序，不改 Vite 构建入口和薄 runtime/session 入口。
- 本轮在现有 CSS 文件内收口；不拆分/重排整份根 CSS，不新增一套主题或覆盖层。
- 不把专用布局、正文、状态色、原生媒体/颜色控件全部转换为 Tailwind。
- 不以文件行数、!important 数量或 owner 排除条件必须清零作为完成门槛。

## 3. 固定施工对象与文件职责

| 文件 | 可做的工作 | 必须保留 |
| --- | --- | --- |
| `styles.css` | 删除失去消费者的分支/变量；局部合并覆盖；更新过时注释 | 正文与 chunk、标记状态、布局/响应式、保留浮层、首屏几何、CSS layer 顺序 |
| `src/features/srs-review/srs-review.css` | 清理已迁移按钮的旧样式及其独占变量 | 学习页布局、专用复合控件几何、评分语义、原生音频、响应式 |
| `src/features/passage-preview/passage-preview.css` | 同上，逐条核对旧按钮分支 | 中文模式 switch、录键外壳/自动高度/换行、学习页布局与可达性 |
| `src/composables/style-editor.js` | 删除不可达旧编辑器生成/绑定链及独占函数 | 当前 chunk 样式弹窗、共享样式助手、输入保存、关闭/焦点/dispose、仍使用的 facade |
| `src/composables/glass-effects.js` | 从保留面板集合中移除无节点的旧面板选择器 | chunk 弹窗与 Toast 消费者、迁移 owner 排除、首次/动态/重初始化/dispose |
| `src/pinia-stores/theme.js` | 删除无消费变量的生成/清除项和独占计算 | light/dark/custom 行为、五色存储格式、正文色、切换/恢复/重置 |
| `scripts/style-editor-module-check.cjs` | 移除要求不可达编辑器存在的断言，改查当前弹窗合同 | 当前控件绑定、薄入口边界与真实保留行为的检查 |
| `scripts/glass-effects-check.cjs` | 退役夹具替换为当前消费者 | 动态、重初始化、释放、迁移面板不装饰的正反向断言 |

相关现有 focused/browser 脚本可因明确退役合同做最小调整，须登记原断言、替代断言和原因。
不得为让检查通过删除失败分支、降低布局/CLS/可达性门槛或修改产品行为。

`workflow-ui.css`、`learning-ui.css`、Button/Input 配方、native 助手、`main.js`、
Vue 模板、`index.html`、`srs-review-main.js` 默认只读，用于核对消费者与加载链。
若清理必须修改这些文件的行为/结构，停止该项并说明边界；继续其他独立项，不自行扩围。

`personalization-shadow.css` 及独立 shadow 页面不是当前 reader/SRS 构建入口，本轮不清理。
`cankao`、历史树、归档 OpenSpec/历史证据和 dist 文件不作为当前活跃源码修改对象。

## 4. 开场基线：必须在第一次产品修改前完成

1. 记录时间、HEAD、branch、`git status --short`、初始 diff。不能以 HEAD 代替 dirty 内容身份。
2. 创建唯一 Temp 目录 `readweb-post-migration-cleanup-<时间>-<随机串>`。
   保存拟修改文件的开场逐文件副本、相对路径与 SHA-256；记录原本不存在的文件。
   本輪新增的方案文档也属于开场已有文件，不回滚或覆盖。
3. 读取本方案、审核方案、原 inplace-plan/review 和最新交接；旧 PASS 只作基线背景。
4. 核对健康优化预览的工作区和源码身份；若需启动，仅用项目启动器 `-DevFallback`。
   不杀历史 PID，不接管未知进程，不重启用户服务凑证据。
5. 在隔离浏览器以合成业务数据采集第 8 节基线，记录真实入口、当前样式获胜来源。
6. 按同一构建环境生成 Temp 中的 `before-dist`，捕获两个生产入口的加载链及关键状态。
   不覆盖仓库 dist，也不把旧 dist 当开场当前源码产物。
7. 记录现有必需检查的基线。已存在的失败须与本轮回归分开，但不能掩盖本轮必要项缺证据。

回滚只能使用开场副本恢复本轮实际改过的文件；不运行 reset/clean，不恢复到 HEAD，
不覆盖期间出现的外部修改。发现并发写入时暂停受影响项，保留双方差异。

## 5. 清理台账与删除条件

在 Temp 保存简单 Markdown/JSON 台账，按“选择器分支、属性或函数”登记，不按整文件判垃圾。

每行字段：ID、原文件/定位、候选原因、静态引用/动态生成链、真实入口或不可达依据、
处理（删除/合并/保留/未确定）、保留属性、受影响矩阵、前后证据、检查、最终状态。

分类规则：

- 删除：当前两个入口的 DOM/模板和 JS 生成链没有消费者，且不存在动态组合/条件状态消费。
- 合并：相同上下文中的最终有效声明已知；保留全部仍有效属性和相对层叠关系。
- 保留：有明确消费者、专用布局/状态语义，或为首屏/隔离/兼容提供必要功能；写具体理由。
- 未确定：证据不足，保持代码不动，记录缺口。不能把“没查到”改写成“明确保留”。

`rg` 无命中、一次 Coverage、关闭态截图、当前 viewport 未触发均不能独自证明死代码。
扫描至少覆盖 index/SRS 入口、所有 `src` JS/Vue/HTML/CSS、JS 拼接 class/变量名、
动态 DOM、Teleport、条件渲染和测试中的引用。测试夹具/历史文档不是产品消费者。
CSS 多选择器规则按逗号分支核对，不能删除其中仍有消费者的其他分支。
变量检查同时覆盖 var()、getPropertyValue、setProperty、CSS 字符串/前缀组合及内联样式。

## 6. 具体施工顺序

### C01：盘点迁移保护分支

起始观测（只作发现线索，执行时重查）：根 CSS 约 4740 行；根/SRS/预习 CSS
分别有 23/37/8 条含 owner 排除条件的规则。这些数量不是必删数量。

逐条对账 `:not([data-ui-owner=...])` 与当前模板/生成链，尤其：

- 根 CSS 的 `.youtube-reader-controls .small-btn` 旧 toolbar 规则；当前素材入口为
  `Button`、`data-ui-owner="workflow"`，确认没有其他该分支消费者后删除该旧分支及过时注释。
- SRS 的 back、history-toggle、speaker、play-sequence、remove-word、retry、actions，
  以及 playback-shortcut-setting、context-gate、translation unavailable、audio-notice。
  当前 SRS 模板的 18 个 Button 均有 learning owner；逐条件/嵌套上下文确认，不凭总数批删。
- 预习的 shortcut-open、shortcut-dialog 按钮、header/footer 按钮旧分支。
  中文展示模式 switch 是专用原生控件；不能因未带 owner 就判迁移遗漏或删除其样式。
- 旧 close-modal/style-input-num/style-btn-toggle 分支在删除旧编辑器后再次对账。

根全局旧按钮/玻璃规则仍可能服务 mark-count-badge、annotation bubble、video、file 控件。
不得删除整个 `.small-btn`/button 规则；必要时缩小到已确认保留的现有消费者，
但不改 specificity、获胜状态和视觉。不能贸然删全局 `!important`。

删除受保护旧分支时，保留同类不带排除条件的布局规则，以及 learning owner 的几何例外。
不得重新加入已修掉的 passage shortcut padding/gap 局部覆盖。

### C02：关闭退役界面的 CSS 与 JS 链

1. 确认 `helper-panel`、`style-editor-modal`、`open-style-editor`、`style-controls-container`
   在当前产品中无节点创建/可达入口；查 JS/模板，不仅查 index.html。
2. 根 CSS 删除 helper-panel 专属布局/伪元素/响应式分支与 sidebar-open 专属链；
   共享规则只移除退役选择器。例如 `#style-editor-modal, #chunk-style-modal` 保留后者完整声明。
3. 从 glass 面板 selector 集合移除 helper-panel 和旧 style-editor-modal，保留 chunk-style-modal/app-toast。
   不删除整个 glass 模块、全局 facade 或动态生命周期，不改变 observer 的 root。
4. style-editor.js 移除仅由旧 open-style-editor 点击触发的生成链：
   `initStyleEditor`、`createStyleControlSection`、`applyStyle`、旧入口绑定，
   以及经核实仅被该链消费的 `styleSettings`、`defaultStyles`、`safeParseLocalJSON`。
5. 注意：当前 `initStyleEditor()` 仅从旧按钮绑定调用，默认值表也在该不可达链里。
   删除前再次核对调用；若发现现存消费者，保留必要初始化，不能擅自新增启动恢复行为。
6. 不删除 localStorage 中历史 visualStyles，不迁移/重置用户设置；不删除仍被正文、
   visual vocab 或 theme 使用的 `--v-*` 变量。JS 独占表与 CSS 仍消费的变量分开判断。
7. 保留 `openChunkStyleModal/closeChunkStyleModal/updateChunkStyle`、controller、共享助手、
   更新阴影按钮文案、chunk 设置存储、dispose、`window.__styleEditor` 及当前 public facades。

### C03：清理无消费变量

起始必查候选：`--liquid-bg`、`--liquid-border`、`--liquid-specular`、`--liquid-shadow`、
`--liquid-filter`、`--pru-app-bg`、`--pru-app-wash`。

按台账消费证明删除其 root/dark 声明；对应 theme.js 的生成返回项、清除列表同步收口。
删除配色计算中仅服务这些项的局部变量，不能误删共享 mixHex/hexToRgba 等函数。

清理 C01 后再查 `--srs-glass-*`，只在全部消费者已经退役时删除。
对其他变量做同样的限定扫描；含 `glass`/`pru` 名称不自动判无用。
`--pru-reader-bg` 仍有素材表面消费者；`--glass-*` 仍有 Toast/弹窗/原生控件消费者。

五色自定义存储格式/默认值、light/dark/custom 切换属性和 inline var 清理语义保持。
自定义切换回浅/深后，不得遗留任何仍消费的 custom override。
不得顺便清除 retired notes 的全部变量/API，此任务不承担另一轮架构迁移。

### C04：盘点其他旧选择器并收口

根 CSS 静态未找到完整 class 字符串的起始候选：

```text
youtube-import-item, learning-model-entry, youtube-workflow-row,
youtube-workflow-summary, youtube-workflow-health, youtube-workflow-service-checking,
youtube-import-panel, youtube-workflow-recent, youtube-history-panel,
youtube-folder-choice, youtube-link-index, youtube-link-status,
youtube-import-path, youtube-import-list, youtube-secondary-actions,
youtube-recent-search, youtube-workflow-check, youtube-workflow-recent-job,
youtube-history-filters, youtube-workflow-history-job, youtube-job-position,
youtube-job-opened-state, youtube-video-preference, youtube-switch-modal-backdrop,
youtube-switch-modal, glass-surface, sidebar-open, has-visual-data,
youtube-workflow-panel-footer, youtube-reader-video-priority,
youtube-reader-video-priority-check, youtube-setting-chips, youtube-mode-options,
youtube-workflow-settings-strip, youtube-history-detail, youtube-danger-actions,
youtube-workflow-mode-check
```

这些仅是候选，可能存在前缀拼接；逐项完成台账，不能批量字符串替换删除。
扫描当前 active 样式再补同类候选，不要求遍历项目所有非 UI 业务代码。
对有消费者的分支明确保留；无消费者的删除全部适用状态/媒体查询分支与独占声明。

### C05：合并同一上下文的历史覆盖

优先 `.youtube-job-log`/`-title`、`.youtube-job-opened-state`、warning hint，
以及素材 panel/backdrop/header 的旧基础规则与尾部 cascade lock。

执行方法：

1. 展开该对象全部 matched rules，记录 root/owner、主题、media、layer、specificity、
   伪类/属性状态、源码顺序，以及最终有效属性并集。
2. 优先在原本最终获胜的位置合并，移除前段被覆盖且不服务其他上下文的属性；
   保留前段独有的有效属性，不把整块早期规则默认删掉。
3. 同一 specificity 的规则也可能靠中间另一条规则改变最终效果；合并必须核对前后邻接规则。
4. shorthand/longhand、inherit/custom vars、fallback 与 prefixed 属性分别核对。
   不跨 media/state/layer 合并，不以相同 selector 字符串判断重复。
5. 处理完成后，用准确的现行职责注释替代“压过 legacy”的过渡注释；
   若某个兼容覆盖仍必需，保留并解释具体消费者/属性，不能只改注释伪装收口。
6. SRS/预习多 viewport 重复 selector 大多是响应式；不得以重复统计批量合并。

首屏 reader-footprint、workflow base、运行时 utilities 是不同阶段的合同，
允许必要的几何重复。本轮不删首屏预留，不重新设计低层 reset 或 CSS layer。

### C06：同步现有检查

style-editor-module-check：移除要求旧双 modal selector、旧动态生成器和 inline margin 存在的断言；
改查旧入口/生成链已退役、chunk modal 仍隐藏且 fixed、现有 id/owner、共享助手与入口接线保持。
safeParseLocalJSON 若仅属于被删除链，不再强制要求该函数存在。
删除已无消费者的旧按钮 CSS 后，不再断言其排除 selector 必须存在。

glass-effects-check：原 helper-panel 初始夹具改为 chunk-style-modal，
原 style-editor-modal 动态夹具改为 app-toast。保留迁移面板不装饰、初始/动态保留面板
有指针效果、重初始化无重复、dispose 释放 observer/RAF/listener 的断言。

若其他测试固定了退役 selector，应最小改为现行消费者合同；不得把所有源码断言
换成“文件存在”，也不得新建庞大通用 CSS/日志验收平台。
仅为删除行为边界或具体回归补有意义的测试，不给每条 CSS 写镜像断言。

## 7. 验证命令与安全执行

先检查当前 package.json 和每个脚本；以下为本方案制定时的真实命令名。

必需 focused：

```powershell
npm run verify:style-editor-module
npm run verify:glass-effects
npm run verify:theme-controls-module
npm run verify:reader-controls-runtime
npm run verify:reader-app-runtime
npm run verify:script-order
npm run verify:legacy-dom-drain
npm run verify:legacy-deletion
npm run verify:passage-preview-shortcuts
git diff --check
```

按实际影响补：`verify:srs-review-ui-v2`、`verify:youtube-workflow-panel`、
`verify:vocabulary-preview-ui`、`verify:annotation-bubble`。
先检查是否启动服务/访问真实 API；仅在安全合成上下文执行 browser 脚本。
既有 `verify:passage-preview` 含 live TTS 子检查，不因 CSS 清理裸跑整个聚合任务；
可运行其 unit/shortcut 子检查，并单独运行隔离的 browser 子检查。

源码正式加载/交互检查优先实际运行 `verify:vite`，明确绑定已经确认的源码预览：

```powershell
$env:READ_WEB_URL = 'http://127.0.0.1:5184/'
npm run verify:vite
```

此示例须置于 env 保存/try-finally 恢复流程，不永久污染后续 build/test。
该脚本加载/playback/interactions 并写 `.playwright-artifacts`，运行前备份已有证据，
运行后复制到本轮 Temp。不得覆写旧证据后声称它们从未存在。
若缺业务请求隔离，先作最小测试隔离调整；不能安全运行则如实 NOT_RUN，
用隔离浏览器逐项覆盖第 8 节必要行为，不能把替代矩阵写成正式命令 PASS。

生产构建示例，路径由本轮专用 Temp 目录生成并确认：

```powershell
$cleanupDist = Join-Path $cleanupEvidenceRoot 'after-dist'
$env:VITE_LOCAL_SERVICE_BASE_URL = 'http://127.0.0.1:8776'
npm run build -- --outDir $cleanupDist
```

before/after 使用同一 env 与构建模式；保存并恢复被修改的环境变量。
不加 `--emptyOutDir` 清空未经检查的目录。通过本地现有 Vite CLI 的
`preview --outDir <专用产物目录> --host 127.0.0.1 --port <空闲测试端口> --strictPort`
预览 Temp 产物；进程隐藏，仅释放本轮实际创建的进程。
生产测试端口遵循项目 browser-port-policy，不用日常 5174/8766，不占用正在使用的 5184。

`verify:production-preview` 支持 READ_WEB_URL，可指向已确认的 after-dist 预览，
但它只证明加载检查；另外完成 reader/SRS 的第 8 节生产矩阵。
若未运行正式命令，报告为 NOT_RUN 并说明独立生产矩阵覆盖，不能冒称命令通过。
完整 npm test 不设为本轮强制门槛；未运行则记录 NOT_RUN，局部失败只修本轮造成者。

## 8. 固定前后浏览器矩阵

环境：新 context、导航前拦截业务、serviceWorkers block、合成文章/学习卡/可解码 WAV；
静态源码/产物请求可放行，业务 API 按合成契约返回，未知请求阻止并记录。
不使用用户 profile、不实际下载/AI/评分持久化/删除/保存后端设置，不改真实用户数据。
不能用手绘 DOM、只有 class、静态 Coverage 或强制 forceUpdateUI 代替真实入口。

主题：reader light/dark/custom-light/custom-dark；custom 用五色样本，
核对 `data-theme-mode="custom"`，data-theme 按背景亮度为 light/dark。
学习窗口始终固定浅色；两个 custom 亮度至少覆盖共享 reader/workflow 映射和切换清除。
视口：1280×800、390×844；固定浏览器版本、deviceScaleFactor、缩放和字体条件。

| 编号 | 必须检查的真实对象/状态 | 观察值 |
| --- | --- | --- |
| V01 | reader 工具栏、素材/学习入口、倍速/跟随/高亮/chunk 选中、标记计数零/非零 | 顺序/分组、尺寸/换行、默认/hover/pressed/selected/focus/disabled、颜色/阴影/SVG |
| V02 | 主题按钮进入 custom、五色修改、重置、切回 light/dark、隔离上下文刷新恢复 | 存储格式、有效变量、无残留 override、正文与高亮语义不变 |
| V03 | 打开 chunk 样式窗口、数字/颜色输入、开关、关闭/Escape、重复打开 | 输入/保存效果、背景关闭、返回焦点、专用原生颜色控件保留 |
| V04 | 素材添加/任务/库/设置的受影响分支；默认/失败/完成/pending；质量窗口/notice | panel/header/log/状态色/按钮、窄屏滚动可达；操作合成且不落真实后端 |
| V05 | SRS 两入口：reader 内打开与 srs-review.html；历史展开、答案揭示、播放/录键、评分按钮 | 共享配方与专用几何、固定浅色、等待/禁用、关闭/焦点、防重复语义 |
| V06 | 预习页及设置、shortcut 设置/录键取消、中文 switch、完成/等待池状态 | auto-height/换行、padding/gap 不回退、switch、390px 可达、无重复遮挡 |
| V07 | AI解释、文章预习词、整理生词弹窗的受影响共享分支；Toast、bubble、视频/file 保留控件 | 真实表面/关闭/焦点，保留样式消费者未被误删；不要求外部业务完整成功 |
| V08 | reader 真实播放/暂停/前后句、正文/chunk 切换；启动加载与首屏布局 | 自然媒体时间推进/跳句结果、无新增 JS/CSS 错误；启动 CLS < 0.01 |

前后记录影响属性：display/position、padding/gap、height/min-height/width、font/line-height、
radius/border、background/color、shadow/filter、伪元素绘制、SVG width/height、几何与滚动可达。
computed 值比较在同一环境/稳定状态进行；截图用于审查，不能只用截图证明获胜规则。
矩形允许测量舍入约 1 CSS px；换行、裁切、顺序变化和肉眼可见差异不能以容差豁免。
颜色/配方/状态外观不得有设计性变化；像素抗锯齿差异需解释，不用全屏像素全等作门槛。

矩阵按同族规则选代表属性采样，但不同 owner/Teleport 根/生产入口必须覆盖。
无匹配规则的退役选择器不要求制造假节点验证；保留消费者必须有正向证据。
本轮影响到的状态不能因“没数据/夹具难”排除；无法安全验证记 NOT_VERIFIED，不能整体 PASS。

## 9. 完成门槛、交付与停止规则

完成必须满足审核 CP01–CP10 全部适用项 PASS；本轮必需项 FAIL=0、NOT_VERIFIED=0；
起始候选及本轮新增同类候选均完成删除/合并/有据保留，未确定项为 0。
不要求消灭全部专用 CSS，也不把无依据的保留说明视为闭合。

交付新增 `docs/design/reader-post-migration-cleanup-handoff.md`，包括：

- 开场身份/副本、最终本轮 diff、修改文件、清理前后统计（只作说明）、台账路径。
- 每项删除依据、合并位置、保留例外；所有必要矩阵当前源码/产物证据位置。
- 命令的真实 PASS/FAIL/NOT_RUN，旧失败/NOT_VERIFIED、外部服务限制分别说明。
- 新产物实际加载资产、两个入口、主题/视口/状态覆盖、首屏 CLS 与错误记录。
- 未关闭问题、最小复测、按开场副本回滚方法；不给日常版替换授权。

不自动提交、归档 OpenSpec、更新全项目“全部完成”状态或安排下一轮聊天。

同一任务两次连续修复/复审失败后停止自动迭代，向用户重评简化/拆分/继续；
不得静默第三轮。新证据支持的具体 P0–P2 可登记，审美建议不能新增为阻断规格。
支持脚本超过约 500 行或超过其审核基线两倍时暂停扩展并解释复杂度；
复用已有工具，不写第二套“推断真实浏览器行为”的日志解析器。

## 10. 可直接交给执行模型的指令

> 请在 E:\read-web-next-optimization 按 docs/design/reader-post-migration-cleanup-plan.md
> 和配套 review.md 完成一次迁移后清理。先读 AGENTS.md，保护开场 dirty 和 WhisperX 工作，
> 建立逐文件副本/删除台账及当前外观基线。按 C01–C06 收口迁移旧按钮分支、退役界面链、
> 无消费变量、其他旧选择器与重复覆盖，并最小更新过时测试。保留当前布局、入口、配方、
> 主题/学习隔离、专用控件、首屏几何、glass 正向消费者和薄入口。完成 focused、源码矩阵、
> Temp 生产构建及两入口验证；准确记录正式命令与替代证据。一次完成本文约定范围，
> 不把候选批量当垃圾，不扩成主题设计/全 Vue 化/文件大拆分。不新建任务或代理、不提交、
> 不 promotion。无法证实的项保留并如实交接，不能宣称全部完成。最后输出清理交接，
> 等待独立只读审核，执行自查不冒充独立 PASS。
