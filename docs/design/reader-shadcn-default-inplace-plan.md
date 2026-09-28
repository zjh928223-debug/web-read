# 阅读器标准样式原位换肤：一次完成施工任务书

日期：2026-09-28。状态：待执行；本文编写不表示产品代码已换肤或验收通过。

## 0. 执行方式与最终交付

用户已确定：使用项目现有 Tailwind + shadcn-vue 标准外观，普通按钮统一标准尺寸，保留入口区域、顺序、分组与操作。**一个执行对话连续完成本文全部施工和自检，然后由另一个只读对话做一次独立审核。** 下文是同一次施工内部的步骤，不是分期交付；不得在主阅读页完成后等待用户确认，也不得仅交付样稿便结束。

本方案替代旧版 S01/S02/S03 的分段确认流程。此前 Uber、Liquid Glass、小尺寸、重新排版样稿不作为本轮要求，历史文件保留。P1/P2 已完成的组件和样式助手直接复用。

最终交付四项：真实产品代码的完整换肤、约定自检、简短执行交接、供用户查看的优化版入口/截图。独立审核使用 [reader-shadcn-default-inplace-review.md](reader-shadcn-default-inplace-review.md)。本任务不自动切换日常版、不迁移真实数据、不创建对话、不派生子任务、不自动提交。

## 1. 不再交给执行模型选择的设计决定

### 1.1 组件与配色

- 保持 `components.json` 的 `new-york`、`neutral`、JavaScript、CSS variables 和 `rw` 前缀；保持现有 Vue 3 技术栈。
- 复用 Button、Input、Textarea、buttonVariants、inputVariants 和两个原生样式助手。不要重新 init、升级依赖、安装整套组件、切换 preset 或调用 React shadcn CLI 改仓库。
- 普通 UI 默认浅色/深色采用 shadcn-vue 官方 neutral 主题变量；采用已有组件配方的圆角、边框、文字、hover、focus、disabled，不另画一套按钮。
- 普通工具栏动作用 `outline`；提交/开始/确认主动作用 `default`；已有合理的 `secondary`/`ghost` 保留；关闭纯图标用 `ghost`。不要把所有按钮变成主按钮。
- 只将原本具有破坏性含义的操作显示为 destructive；保留业务状态色，不用整页灰阶抹掉错误、评分或学习高亮含义。
- 按钮所在控制面板、目标弹窗表面同步使用实色 neutral 背景/边框；去掉这些表面的玻璃模糊、装饰渐变及光斑。保留遮罩、实际定位和功能性阴影。正文及用户自定义阅读色不跟着重置。

官方参考（2026-09-28 已核对）：[主题](https://www.shadcn-vue.com/docs/theming)、[Button](https://www.shadcn-vue.com/docs/components/button)、[Tailwind Preflight](https://tailwindcss.com/docs/preflight)。取主题文档 Default Theme CSS 的 neutral 颜色组，不能把整份全局 CSS/重置样式照搬。

### 1.2 标准尺寸与有限例外

| 对象 | 本轮固定规则 |
| --- | --- |
| 普通文字按钮，包括普通返回/重试/朗读/完成/导航按钮 | `size="default"`，现有配方 `h-9`，16px 根字号下 36px 高 |
| 纯图标按钮，包括关闭、主题图标、纯图标朗读 | `size="icon"`，现有配方 `size-9`，同条件下 36×36px |
| 单行文本、密码、数字、快捷键输入 | 现有 inputVariants 的 `default`，高度 h-9；保留字段类型和数据转换 |
| Textarea | 原有多行高度和 resize 能力，采用同套外观，不能强制 36px |
| SRS 揭示/评分、预习揭示/上一个/下一词 | 普通矩形动作采用标准高度；保留评分色、动态文案、禁用和事件逻辑 |
| 复合快捷键录制卡 | 先尝试标准档；含 kbd 和第二行状态提示且确实不能放进 36px 时，保留现有自动高度，最小高度不低于标准档。记录为复合控件例外，不裁掉文字 |
| 原生 audio/video、color/file/select、原生 switch、拖拽把手、正文内解释/标记、历史卡/候选行的专用展开与行内操作 | 保留原节点和专用几何；必要时只适配表面颜色，不把整行/媒体播放器硬套 Button |

统一高度，不统一按钮宽度。不得将 Button 的 default 配方全局改成 32px，再声称“使用默认”。不得为塞进一行缩字体、转回 sm/xs、压缩所有按钮水平 padding。保留组件已有其他 size 定义供范围外消费者使用，不删除它们。

`T` 等用文字代表样式功能的单字符按钮仍按文字按钮处理；真正只有图形的控件才用 icon。快捷键输入必须看全 ArrowLeft/ArrowRight，不改录键逻辑或 maxlength 迁就宽度。

### 1.3 原位和操作

- 入口仍在原区域、原顺序和原分组；文字、tooltip、快捷键及点击结果保留。
- 上一句与对应快捷键输入、下一句与对应快捷键输入继续相邻；倍速仍为现有数值；不新建导航栏、菜单或底部播放器。
- 标准尺寸允许带来原容器内自然换行、控制区增高和正文起点下移。原位不是锁死每个像素；不承诺所有宽度下一行排完。
- 保留当前桌面/窄屏结构和断点。仅修实际溢出所需的局部 min-width、flex-wrap 或弹窗内容滚动，不改变功能分组。
- 正文行宽、字体、字号、行高、逐句/chunk 排版及高亮含义保持；不得顺手统一全文字体或阅读背景。
- 保留 DOM id、data 标记、事件、ref、aria、type、v-model 修饰符、pending/disabled、dialog controller、持久化字段和调用顺序。
- 不在 reader-runtime.js/session-init.js 加逻辑，不改 index.html 脚本顺序，不改 IndexedDB/Host/评分/预习数据协议。

## 2. 初始工作分组、实际界面盘点与文件地图

**U01–U10 是初始工作分组，不是项目只有 10 个界面，也不是检查数量上限。** 一组可包含多个页面、弹窗或浮层；同一实际界面的入口和内容也可能涉及多个 U 分组。执行前必须按 2.1 盘点实际对象，再按对象逐项打开。不得用“10 组全勾选”代替完整检查。

执行交接保留分组概览，但完成判定以实际界面清单及其适用状态为准，不以“其他类似处理”省略界面。

| 编号 | 必须处理的界面 | 主要文件与注意点 |
| --- | --- | --- |
| U01 | 主阅读页工具栏、主题、跳句、倍速、跟随、高亮、AI/预习/已学完入口 | index.html、src/main.js、styles.css；保持原结构，主入口含原生按钮 |
| U02 | Vue 动态插入的今日复习、待预习、预习设置和素材入口 | src/App.vue、src/components/YouTubeWorkflowPanel.vue；保留 Teleport 目标和组件生命周期 |
| U03 | 素材主面板的输入、列表普通操作、配置按钮 | YouTubeWorkflowPanel.vue、styles.css；所有常规尺寸一起改，布局/任务状态/危险操作语义保持 |
| U04 | 素材质量报告、material notice | 同上；独立 Teleport 根，不能只给主面板定义主题 |
| U05 | 阅读器自定义主题面板、当前可达 AI 样式弹窗 | index.html、src/composables/style-editor.js、styles.css；数字字段保留原生类型，颜色选择器保留 |
| U06 | AI 解释标注窗口的关闭/字段/普通 footer 及内嵌普通 SRS 动作 | src/composables/annotation-backfill-ai-module.js；保留 createElement 与当前控制器 |
| U07 | 文章预习生词、整理本篇生词窗口 | src/composables/vocabulary-preview-module.js；共享样式，两套 footer 都处理，候选行专用操作保留 |
| U08 | 预习页、完成页、数量设置、快捷键弹窗 | src/features/passage-preview/PassagePreviewPage.vue、PassagePreviewSettingsDialog.vue、passage-preview.css；含尚未使用 Button 的普通 button |
| U09 | SRS 普通控件、揭示/评分动作 | src/features/srs-review/SrsReviewPage.vue、srs-review.css；不能只改辅助按钮，漏掉 footer；保留评分状态/重复保护 |
| U10 | 学习页加载失败提示的重试与返回 | src/components/LearningPageLoadNotice.vue；保留 emit、加载/失败语义和遮罩层级 |

共享落点：`src/styles/workflow-ui.css`、`src/features/learning-ui/learning-ui.css`、`src/lib/native-control-styles.js`、`src/lib/native-input-styles.js`、`src/components/ui/button/button-variants.js`、`src/components/ui/input/input-styles.js`。

固定保留：VideoPlayerFloat 的专用控制/拖拽、TranscriptContainer/ChunkModeView 正文、annotation-bubble、PassagePreviewCheckPage、PersonalizationShadowPage、不可达旧样式编辑器、专用词汇候选行。共享改动造成这些区域具体退化则修该退化，不扩建迁移范围。

### 2.1 先建立实际界面与入口清单

这是本次连续施工的第一项工作，不是另一个任务或审批阶段。先在最终交接文件中建立“实际界面清单”，施工过程中更新同一张表，不新增清单管理工具。

1. 从当前 `index.html`、`src/main.js`、`src/App.vue` 的实际加载链出发，核对 UI 组件导入、动态 import/条件渲染、Teleport、按钮/菜单/快捷键事件；继续检查 composables 中 createElement、dialog controller、显隐控制生成的窗口。不能仅按 `.vue` 文件数量计算界面，也不能只统计 URL 路由。
2. 在浏览器沿当前入口逐个打开：页面、弹窗、侧面板、浮层、可切换内容的 tab/折叠区域；记录从主界面到目标的具体路径。需要材料/学习记录的用合成数据；加载失败、pending 等条件界面使用既有模拟分支。
3. 一个可独立打开/关闭或切换到的视觉容器建立一个 `UI-001` 等编号；有明显不同内容/控件的 tab 或折叠区域列子项。多个按钮通往同一窗口记多个入口，不重复计算界面。Button/Input 这种被复用的基础组件不算独立界面。
4. 同一界面的浅深色、hover、焦点、选中、disabled、展开/收起、空态/错误态是状态，不编造成多个页面。每项列出实际适用且与本轮 CSS 有关的状态；不要求所有状态与视口做笛卡尔积，也不枚举外部服务所有错误码。
5. 为每个新发现对象明确分类：`本轮换肤`、`保留但检查共享影响`、`历史不可达/仅参考`。在当前阅读/素材/预习/SRS 等既定产品流程中新发现的普通界面，补入相应 U 分组并纳入本轮，不得因原表未列出就跳过。确实无法归组可加工作分组，不能为凑“10”删对象。
6. 已明列的专用保留区域不因盘点而变成全面重写对象。当前可达的保留界面/浮层也要实际打开一次建立现状，并核对共享 CSS 是否影响；仅受影响的部分需要后测。历史无入口对象查调用链后说明，无需恢复入口、打开隐藏 feature flag 或编造访问 URL。
7. 不属于当前运行应用的 docs/design 独立样稿、组件库示例和测试夹具不是产品界面。它们可作验证工具，但不能混入产品总数。若发现一个全新业务系统或无法按本方案处理的复杂行为边界，记录并完成独立部分，不擅自扩大业务改造。
8. 在修改共享样式前完成入口的源码核对和可达界面的初次打开。无法打开的对象保留在表中，记录前置条件/错误；隔离挂载不能把“正常入口不可达”改写为“已从正常入口打开”。

清单至少包含下列列项，可将长证据放在表后同编号说明：

| 实际界面 ID / 子项 | 名称与类型 | U 分组 / 处理分类 | 入口路径与前置条件 | 源码/DOM 根 | 适用状态 | 打开方式与状态 | CSS 分析/处置及前后证据 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 待执行模型实际编号 | 页面/弹窗/浮层/tab 等 | 换肤/保留/历史不可达 | 主界面 → 按钮 → 目标 | 文件与根选择器 | 实际适用项 | 正常入口/隔离挂载；已打开/受阻/未检查 | 实际填写，不能预填 PASS |

必须区分：`未检查`（尚未做）、`受阻`（尝试后打不开）、`历史不可达`（调用链已退役）、`不适用`（该对象确无此状态）。不能把未检查或受阻简单记成“不适用”，也不能只因缺测试数据就判定历史不可达。

盘点结束记录发现总项数及分类数量，界面项与状态数分开统计；不预设总数。后续浏览器发现新入口时补表并处理，直到已发现的当前入口都有对应记录。该清单是本轮证据范围，不宣称证明了所有理论运行条件。

## 3. 开场准备：只做与本项有关的核对

1. 读取 AGENTS.md、本文及审核任务书。工作目录固定 `E:\read-web-next-optimization`。不要创建 worktree。
2. 记录 `git rev-parse HEAD`、`git status --short`、已有差异清单。保存本项预计修改文件的开场版本供最后比较；当前工作区不干净是已知情况，不为得到 clean 状态清理或提交他人工作。
3. 当前既有改动包括 runtime.optimization.json、package.json、test-inventory.json、Host/SRS 服务与检查文件，以及未跟踪的启动/设计/交接文件。保留这些内容。预计本项不需修改 Host、Python 配置、服务协议或根依赖。
4. 读取 components.json、共享配方/助手、初始 U 分组相关模板、CSS 与 docs/reader-startup.md，并完成 2.1 实际入口盘点。搜索实际调用方，禁止全仓库不分范围替换 sm 或 button。
5. 记录基线浏览器状态：真实产品页面、视口、浅色/深色、普通/chunk 模式、可见控件顺序。使用无私人内容的同一份合成材料，以独立浏览器上下文检查。
6. 主阅读页必须取得实际产品 DOM/截图；其他页面可使用既有隔离挂载和合成/模拟服务。真页面打不开时先记录原因，继续不依赖该问题的施工；最终仍打不开就保留“主阅读页验收阻断”，不能用静态副本冒充完成。

有用的定向搜索（PowerShell 中使用目录加 glob 参数，避免将 *.vue 作为不存在的字面路径）：

```powershell
rg -n 'applyNativeControlStyles|applyNativeInputStyles' src -g '*.js'
rg -n 'size=|<Button|<button|<Input|<input' src/App.vue src/components/YouTubeWorkflowPanel.vue src/features/passage-preview src/features/srs-review -g '*.vue'
rg -n 'reader-footprint|hotkey.*width|speed-button-active|backdrop-filter|data-ui-owner' styles.css src/styles/workflow-ui.css
```

## 4. 连续施工顺序

按 4.0 到 4.7 顺序做完；每节完成后继续下一节，不等待视觉确认、不另建执行对话。自检发现本项问题时就地修复。

### 4.0 逐界面检查旧 CSS，再结合换肤清理

**不把“全站旧 CSS 清零”设为换肤前置。** 本步骤按 2.1 清单分析实际样式来源，随后连续完成换肤和清理；不是额外一轮等待审批的 CSS 重构。已经使用 Tailwind/shadcn-vue 的控件继续复用。初始 U 分组只用于组织工作，不限制实际检查项数；不扩展为整个历史仓库扫描。

#### A. 修改共享样式前采集基线

1. 在第 3 节的真实产品基线中，按实际界面清单逐项打开，包括一组内的不同弹窗、tab/折叠子项和可达保留界面。使用 Chromium DevTools Coverage 或当前浏览器工具支持的等价 CSS 使用记录；启用记录后加载页面，并在记录期间操作。不要仅加载首页，或每个 U 分组任选一个界面就停止。
2. 按 V01–V08 的同一套必要状态采样：普通/chunk、浅色/深色、custom、弹窗打开、预习/SRS 揭示前后、hover、键盘 focus、disabled/pending，以及桌面/390px。每界面只检查适用状态，例如固定浅色学习页无须发明深色模式。pending/错误通过现有模拟夹具触发，不故意破坏真实服务。
3. 一个控件族选择代表元素检查最终计算样式及生效声明；出现差异/冲突的元素单独查。至少查看 height/min-height、width/min-width、padding、font-size、background、border、border-radius、box-shadow、backdrop-filter，以及相关 ::before/::after。记录来源文件、选择器及哪个声明胜出。
4. 区分两个问题：Coverage 回答“本次操作记录中哪些 CSS 被使用”；Styles/Computed 回答“哪个声明最终决定外观”。被划掉的声明可能在其他主题/断点有效，被记录为使用的规则也可能含冗余声明，两者不能互相替代。
5. 共享样式修改前尽量完成全部目标界面的可达基线。打不开的界面标为未采集及具体原因，按本方案既有隔离组件路径继续；不能把后改页面截图伪装成原始基线。
6. 如工具无法采集 Coverage，仍逐界面完成 Styles/Computed 与源码检查，明确写“未采集 Coverage”；不搭建新工具平台，不将缺少百分比作为阻断整个换肤的理由。该情况下不得声称完成了全量未使用 CSS 分析。

#### B. 给相关旧规则分类

| 分类 | 判断依据 | 处理 |
| --- | --- | --- |
| 正在使用且负责布局/正文/专用功能 | 实际元素、主题或动态路径仍消费 | 保留，不能为删行数迁走或删除 |
| 正在使用但将由共享配方替代 | 已确定迁移对象和对应的新配方 | 同步换肤后移除该对象旧装饰；仍有其他消费者时收窄作用域 |
| 重复或相互覆盖 | 查清相同目标、主题、断点和 cascade layer 下的实际胜出声明 | 合并到既定样式所有者；保留有意义的状态/响应式差异 |
| 疑似未使用 | Coverage 未命中或简单搜索无结果，但动态状态/消费者尚不明确 | 本轮保留并注明原因，不标为已证明无用 |
| 可确认已失效 | 消费节点/类的产生路径已删除或已迁移，源码与本轮相关状态检查相互支持 | 删除具体失效规则；保留同一块中其他有效选择器/声明 |

删除候选还要搜索 Vue 模板、JS 动态 class/createElement、主题切换、响应式规则及保留界面的消费者。一个 CSS 选择器列表包含多个对象时逐个判断，不能因其中一个对象迁移就删整块。

**禁止按 Coverage 红色/未使用比例批量删除；禁止直接删除生成的 Tailwind 工具类或 dist 中的 CSS；禁止要求未使用字节归零。** 本项目有按需页面、动态弹窗与主题，单次采样不能证明全产品永久不用。CSS 文件的行数也不作为完成指标。

工具依据：[Chrome DevTools Coverage](https://developer.chrome.com/docs/devtools/coverage/)。记录应注明实际采样状态和限制，不能把工具报告当作完整业务旅程证明。

#### C. 换肤后按同一状态回看

依次执行 4.1–4.6 后，复用 V01–V08 的后测，检查目标控件是否确由新配方生效、旧装饰是否退出、保留功能是否受影响。只重看修改过及共享样式实际影响的区域，不另外复制整套测试矩阵。

在最终交接内附一张简表即可，不增加独立报告系统：

| 界面编号/采样状态 | 代表元素与来源规则 | 分类 | 保留/替换/删除及理由 | 后测结果/证据 |
| --- | --- | --- | --- | --- |
| 示例：UI-编号（归属 U01），浅色桌面 | 实际按钮选择器 → 来源文件与生效尺寸 | 待替换 | 接 default 配方后退出旧紧凑高度 | 实际填写，不预填 PASS |

实际清单中每个换肤项及受共享样式影响的保留项都应有记录，允许同族规则合并引用，但不能借此省略逐个打开。未受影响的保留项记录核对依据；疑似未使用而保留的规则列为观察项，不自动成为下一轮任务。无需为每条 CSS 声明建一行。

### 4.1 先统一主题来源

1. 主主题入口仍为 src/styles/workflow-ui.css。保留现有 Tailwind theme/utilities 分开导入、rw 前缀、@source 和 dark variant。禁止增加全局 Preflight、全局裸 button/input reset 或新的主题框架。
2. 取官方 neutral 的 background/foreground、card、popover、primary、secondary、muted、accent、destructive、border、input、ring 及前景配对。只加入实际需要的变量，不引入 chart/sidebar 等无关变量。
3. 在这一入口定义一组带项目作用域的 UI 主题变量，作为本批共享来源；reader/workflow/style-controls 映射到这组变量。不要在每个页面各抄一份颜色值。
4. 浅色默认路径不能只匹配 `[data-theme="light"]`：当前浅色模式可能移除 data-theme。深色按现有 `[data-theme="dark"]`；不更换为全新 class 切换系统。
5. 自定义主题使用 `[data-theme-mode="custom"]`，会同时带按亮度推导的 data-theme。保留它对 reader 控件的旧颜色映射，优先级高于默认 neutral。保留 theme/themeCustomColors 保存、读取、重置语义，不覆盖用户已有值。
6. learning-ui.css 当前显式设置蓝色 learning palette。将普通背景/按钮/边框等接入同一 neutral 浅色来源；不要只改父级后让子级蓝色重新覆盖。学习页及独立学习弹窗保持现有浅色主题隔离，不能被主壳 dark/custom 污染。
7. 素材主根、质量报告、material notice 及 Teleport 到 body 的学习设置/解释/词汇弹窗逐一检查。将目标表面自己的旧背景/边框换为本域语义变量，保留布局、遮罩和定位。
8. 不全局重写 --pru-*、--glass-* 或 --bg-color 等广泛使用变量来省事；仅改目标表面及本域映射，避免改变保留区域、正文或自定义主题。

### 4.2 调整共享助手和主阅读页

1. 两个原生助手默认 size 当前均为 sm；改成 default 前逐个核对调用方。当前调用主要在 main.js、style-editor.js、annotation-backfill-ai-module.js、vocabulary-preview-module.js；显式 size 仍会覆盖默认，必须同时处理。
2. main.js 普通 reader 按钮改 default；theme-toggle 改 icon；T/按住等文字按钮改 default；快捷键输入采用 default。保留已有 class、id、事件启动次序。
3. App.vue 中三个学习入口由 sm 改 default；保留 Teleport 到 #srs-review-entry-root、click handler 和隐藏 file input。素材入口在 YouTubeWorkflowPanel.vue，也按标准处理。
4. styles.css 的 reader-footprint 是首屏几何占位，当前含 32/24px 高度及固定 42/54/68px 等宽度。按新标准同步高度和 padding，占位不拥有新的颜色。仅移除会挤压标准文字的旧固定宽度；保留合理 min-width 与现有分组。
5. workflow-ui.css 的 `.on`、`.active`、`.speed-button-active` 状态仍由业务控制，样式改为同套语义状态。不得删状态 class 的产生代码。
6. 调整 hotkey 输入的局部宽度，避免 inputVariants 的 w-full 撑满一行，也避免旧窄宽度截断方向键。保持输入与对应按钮相邻。
7. 检查 controls、extra-controls、transcript-header 的旧装饰及伪元素。只去除它们命中目标 UI 的玻璃/渐变，不删除容器 display、间距、断点和正文样式。

### 4.3 素材面板与附属窗口

1. YouTubeWorkflowPanel.vue 中普通 Button 的 sm/xs/lg 改 default，纯图标 icon-sm/icon-lg 改 icon；按内容判断，不机械把图标变成文字尺寸。
2. Input 保持默认单行高度，Textarea 保留多行。保留 trim、IME 输入处理、password 类型、name/autocomplete、disabled/pending 和回调。
3. 覆盖列表普通操作、设置保存/维护、质量报告 footer、notice 的主动作和关闭。保留 list、队列、tab、折叠和分页结构。
4. 窄屏尺寸增大时 footer/动作组可在原容器换行。质量报告/主弹窗保留既有 controller、z-index、滚动和焦点返回，不安装新 Dialog。
5. 不调用真实下载、转写、清理或付费 API 作为样式测试；代表操作用现有模拟服务验证一次事件和 pending 状态。

### 4.4 原生 DOM 窗口与样式编辑器

1. style-editor.js 的当前可达 AI 样式弹窗 helper 默认 xs/sm 改标准档，关闭改 icon。保留原生 number/color、输入解析和 inline display 控制。不可达旧编辑器不主动恢复。
2. annotation-backfill-ai-module.js：关闭 icon，start/cancel/内嵌 SRS 普通动作 default；model/API key 输入继续 text/password 和现有值。保留隐藏区、历史卡、控制器和事件。
3. vocabulary-preview-module.js：预习窗口及结算窗口两个关闭按钮和两套 footer 都处理，输入已有 default 时不重复改。保留展开/朗读/移出/拖拽等专用行控件。
4. 若原生 helper 被重复调用，不能叠加互相冲突的 h-8 与 h-9；优先改原创建位置的一次样式调用，不在打开窗口时再补一组 class。
5. 删除/收窄 styles.css 对这些已迁移普通控件的旧 padding/height/color 覆盖，保留仍有消费者的公共布局。不要大块删除 vocabulary-preview-dialog 规则。

### 4.5 预习、SRS 与加载提示

1. PassagePreviewPage.vue 同时有 Button 和原生 button。覆盖返回、顶部设置、完成页按钮、朗读、揭示与导航，不能只搜索 size="sm"。保留原文字与动态 label。
2. Vue 模板中的普通原生按钮优先复用已经导入的 Button，逐一原样保留 type/class/aria/事件/disabled；含关键 DOM ref 或特殊原生语义的节点保留原生，用已有配方绑定。不要为统一外观重写脚本逻辑。
3. PassagePreviewSettingsDialog 的 v-model.number 保留原生数字输入，使用 inputVariants(default)，不要换成不支持 number modifier 的 Input。输入/Enter 保存/错误提示保留。
4. 预习快捷键弹窗保留录制和 Escape 顺序：录制中 Escape 取消录制，非录制状态按既有控制器关闭。保留真实 DOM 初始焦点与返回目标。复合录键卡按 1.2 的有限例外处理。
5. SrsReviewPage.vue：辅助 Button 标准化；footer 的原生揭示与评分按钮也接标准配方及高度。保留 v-if、review.actions 顺序、tone、is-pending、完整 disabled 条件、handleRating/revealAnswer 和数字/空格快捷键。
6. 评分选中/失败等颜色继续是业务语义；不改变卡片内容、排程、评分服务或 useSrsReview.js。保留 readonly/past/eligibility 状态。
7. srs-review.css/passage-preview.css 旧规则可能为 button 设置较大高度、gradient、padding。只让本批普通动作退出这些覆盖，保留评分状态规则、正文卡片、学习信息与滚动布局。
8. LearningPageLoadNotice.vue 的两个普通动作可复用 Button，保留 retry/close emits 和加载失败条件。若使用 rw 样式，补充唯一 Tailwind 入口的精确 @source；根主题与所属壳保持一致，不能因缺变量变成不可见按钮。

### 4.6 响应式与保留区域检查

- 桌面 1280×720、窄屏 390×844；如用户提供日常视口，再补该视口，不扩建设备矩阵。
- 保留原顺序，允许自然换行；快捷键对与对应按钮相邻；不以绝对定位、缩放整个页面、隐藏文字或横向滚动工具栏强行单行。
- 必要时局部允许 flex-wrap、移除造成溢出的旧固定宽度、给弹窗内容保留纵向滚动。不能取消 pending 禁用或删除说明文字换取空间。
- 检查关闭/保存始终可到达、焦点环不被裁掉、深色可读。多行文字的专用控件保留内容，不硬裁成 36px。
- 共享样式如果实际命中保留区域，抽查对应外观；无影响的媒体拖拽、旧诊断页等不重跑整套流程。

### 4.7 清理、验证、交接一次完成

1. 根据 4.0 的分类，仅删除本轮退出且无其他消费者的声明；不按删除行数或 Coverage 百分比考核，不重写 styles.css 全文件。
2. 搜索实际清单中全部本轮换肤项所涉及文件的剩余 sm/xs/icon-sm/icon-lg、h-8/h-6、旧 fixed height/width，逐项解释是否保留例外。源码出现这些字符串本身不是失败，未纳入范围的控件无需修改。
3. 核对唯一 Tailwind 扫描入口包含实际新增配方调用文件，原生 helper 与 Vue 使用同一配方；不产生第二套主题构建。
4. 执行第 5 节自检；修正本项引入的问题；实际清单所有本轮换肤项及共享影响检查完成后统一交接。逐项核对有没有遗漏入口、受阻或未检查状态；不能以 U01–U10 概览全勾选替代明细。中途进度不写成最终完成。

## 5. 固定自检范围

### 5.1 浏览器检查清单

下表 V01–V08 是检查行为类别，不是仅需打开八个界面。把每个实际界面/子项映射到适用的 V 类，逐项记录打开与后测；同类控件的状态证据可复用，不为每个按钮单独截图。每行提供简短结论与截图/操作说明即可，不需录像、哈希链或自动证据解析器。主阅读页前后用同一材料、视口、主题和模式；截图不得包含 API key、私人词库或用户真实材料。

| 编号 | 操作 | 通过标准 |
| --- | --- | --- |
| V01 | 主阅读页浅色、深色、普通/chunk；1280 桌面和 390 窄屏 | 原区域/顺序/文字保持；标准高度实际生效；换行可接受，无遮挡/截字/非预期水平滚动 |
| V02 | 短合成音频播放/暂停、上一句/下一句、三档倍速、跟随、高亮、中文按住/聚焦 | 控件执行原动作，选中状态可辨；不改倍速值和快捷键语义 |
| V03 | 在独立上下文编辑一个快捷键、取消录制、触发；切换 light/dark/custom 再返回 | 录制/取消/焦点正常；已有 custom 值保留；恢复测试上下文设置，不碰用户配置 |
| V04 | 素材主窗口、质量报告、notice；一个模拟提交/pending、关闭/焦点返回 | 字段可输入、按钮标准尺寸、重复触发被原机制阻止，窄屏 footer 可达；模拟不代表真实下载成功 |
| V05 | AI样式、AI解释、预习生词、结算窗口逐个打开/输入/关闭；AI用假响应 | 各窗口普通控件完整；模型/key 字段语义不变；learning 窗口在主壳 dark 下仍为浅色 |
| V06 | 预习揭示/上一个/下一词、完成页、数量设置、快捷键弹窗 | 合成内容可操作；number 值仍是数字；录制中 Escape 不误关整个弹窗；完成按钮不被遮挡 |
| V07 | SRS 答案揭示、一次点击评分和另一卡数字评分、快速重复触发 | 用合成/模拟依赖确认原防重、pending/disabled 和反馈有效；不声称真实持久化完成 |
| V08 | 学习加载提示的重试/返回；按钮 hover、键盘 focus、disabled | 原 emit 与状态正常；按钮可读，焦点可见，无隐藏的可交互残留 |

U03–U10 的样式和事件可用现有隔离真实组件挂载/模拟服务验收，不因旧 Host 入口问题扩成后台修复。主阅读页必须是实际应用结构，不是 docs/design 静态副本。已有真实保存证据可引用，但需说明不是本轮重新验证。

### 5.2 命令检查

全批代码稳定后运行一轮，局部修改后只复跑受影响项，最后修复如影响产物再补 build。不是每改一个文件就跑全部。

```powershell
npm run build
npm run verify:theme-controls-module
npm run verify:keyboard-boundary
npm run verify:youtube-workflow-panel
npm run verify:annotation-backfill-ai
npm run verify:srs-review-ui-v2
npm run verify:passage-preview:unit
npm run verify:passage-preview-shortcuts
git diff --check
```

浏览器入口：`npm run verify:vite`、`npm run verify:youtube-workflow-panel-behavior`、`npm run verify:vocabulary-preview-ui`，加 V01–V08 实际检查。阅读脚本前置后再运行，特别注意：

- `scripts/youtube-workflow-panel-v3-browser-check.cjs` 默认 URL 是 5173，属于受保护历史端口；必须显式提供已确认的隔离 `READ_WEB_URL`，不得裸跑去连历史实例。
- `scripts/vite-verify.js` 默认 4173，并可能复用已有可达服务；先核对/设置隔离端口及 URL，不能仅凭 HTTP 可达就认为是本次代码。
- `scripts/vocabulary-preview-ui-check.cjs` 无 URL 时会自启隔离 Vite；如显式设置 URL，确认其身份和样式对应当前源码。
- 4193/4194 是仓库既定自动化隔离端口；使用前检查占用和脚本是否会写后端。不要向运行中的真实数据服务执行有写入的测试。
- 普通浏览器新 context 只隔离浏览器存储，不隔离 Host 数据。会触发后端写入的路径须使用已有模拟接口或专用合成数据 profile；不要为了换肤建立迁移/checkpoint 系统。

实际改动 index 加载接线时才加 `verify:script-order`。未改服务协议，不跑 H3–H5、严格评分延迟、全六域/跨机/完整历史清绿。

已知旧断言：vocabulary-preview-ui-check.cjs 匹配 `icon-sm`；annotation-backfill-ai-module-check.cjs 断言 `rw:size-8`。换成标准 icon 后可更新为对应新尺寸，保留打开、焦点、提交及防重等行为断言。尺寸相关旧断言失败不能靠退回小尺寸、删除整个测试、放宽为“有 class 就行”处理。

## 6. 异常处理：按表执行，不自行扩大任务

| 情况 | 要做什么 | 不要做什么 |
| --- | --- | --- |
| size 改了却仍是旧高度 | 在浏览器查看 computed style 命中的具体 selector；处理该条旧规则/调用 | 到文件末尾加大量 !important |
| 默认变大导致换行 | 保持分组和顺序，允许自然换行；修真实溢出 | 缩回 sm、改文案、藏按钮、重排入口 |
| 主壳深色使学习弹窗变黑 | 检查独立根、data-ui-theme 和变量优先级 | 新建主题状态或删掉 dark 支持 |
| 自定义主题不生效 | 保留 custom mode 对应映射并核对继承 | 清 localStorage 或覆盖用户颜色 |
| 组件替换导致 ref/focus 故障 | 保留原生节点复用配方，或查询该弹窗内真实 DOM | 重写公共 dialog controller |
| 旧测试只断言旧尺寸 | 更新尺寸断言并验证相同行为 | 删除行为测试或改变产品去迎合旧外观 |
| 入口有既存 Host 错误 | 记录开场复现；其他区域继续完成；界面可按本方案模拟验证 | 修 Owner/评分协议或恢复 H3–H5 链 |
| 必要主阅读页验收最终仍阻断 | 交接已完成代码和唯一具体阻断，标明未完全验收 | 宣称静态样稿即全应用通过 |
| 修改会触及真实数据、保护树或需新业务设计 | 停止该项依赖操作，交接具体问题；完成其他独立部分 | 猜测迁移、覆盖工作、删除用户记录 |

遵守 AGENTS.md：同任务连续两轮修复/复审失败后停止自动循环并重新评估；辅助脚本超过约 500 行或两倍已审核基线时先说明必要性，不继续膨胀。本任务不要求新建验证平台。

## 7. 环境、完整性和交接格式

- 唯一施工目录 `E:\read-web-next-optimization`，不使用 Git worktree。日常 `E:\read-web-next`、历史 `E:\read-web` 禁止编辑/构建/启动/提交。
- 手动优化预览沿用 `scripts/launch-optimization-preview.ps1`、`config/runtime.optimization.json`、5184/8776 和 `E:\ReadWebData\SubtitleWorkflow-Optimization`。先读现有启动说明核实 Python；不重装环境或改 runtime 配置。
- 已有服务先核对 PID/路径/配置；未知占用不能杀。确需后台启动时隐藏窗口；只停止本任务启动且归属确认的临时进程。
- built Host 可能仍展示旧产物。浏览器验收须明确服务展示本次构建；不要把旧实例截图当成果。不能安全更新时记录入口阻断，继续可独立验证的工作。
- 开场/结束比较既有差异；尤其不要将未提交 Host 修复说成本轮实现。最终 `git diff` 相对 HEAD 含他人工作，交接要列清本轮文件及实际新增差异。
- 一个执行对话串行完成；执行/审核模型不创建任务、不派生代理。用户或调度者另行安排一次新的只读审核，模型设置沿用用户现行约定；本文不变更运行中模型。

在 `docs/design/reader-shadcn-default-inplace-handoff.md` 写一份简短交接（首次执行时创建），格式如下：

1. 起始 HEAD、结束 HEAD（未提交则明确未提交）、本轮文件/改动，既有差异保留结果。
2. 初始 U 分组概览与 2.1 实际界面清单：发现总项数、分类数量、逐项入口/适用状态/打开方式/完成或阻断原因；附 4.0 的 CSS 来源/处置简表，说明 Coverage 是否实际采集和采样限制。不能仅交一张 10 组勾选表。
3. V01–V08 与命令结果：PASS/FAIL/NOT_RUN、截图或日志路径；注明真实产品/隔离组件/模拟服务。
4. 有限例外、标准尺寸导致的换行/正文起点变化、历史问题及本轮新增问题（无则写无）。
5. 当前预览 URL、是否仍运行、服务/合成数据位置；没有运行就给出已有合法启动方式，不编造可访问地址。
6. 最终结论：完整完成 / 已实现但有具体验收阻断。没有做的检查不能写通过。

截图/日志沿用已有可写临时目录，只保存理解结果必需的少量证据，不提交敏感数据。git diff --check 不覆盖未跟踪文件，新增交接要另外核对路径、Markdown 与内容。

## 8. 可直接给执行模型的指令

> 请阅读 AGENTS.md、docs/design/reader-shadcn-default-inplace-plan.md 及其独立审核任务书。在本次对话连续完成实际入口盘点、逐界面 CSS 来源分析、全部约定换肤、清理、自检和交接。U01–U10 只是初始工作分组，不是界面总数或上限；先按 2.1 建立页面/弹窗/浮层/tab 子项清单，结合源码和浏览器逐项打开，记录入口、适用状态、保留项、受阻与未检查项。再按 4.0 采集实际生效规则，之后修改共享样式；Coverage 未命中不是删除依据，不先做全站 CSS 清零。章节是内部步骤，不是分阶段审批，不要只做主阅读页或等待中途视觉确认。使用现有 new-york/neutral 标准外观，普通按钮 default、纯图标 icon，保持原区域、顺序、分组、文字及操作，允许自然换行。按文件地图落实主题隔离、旧尺寸覆盖、原生节点和 Vue 动态入口，补齐既定产品流程中新发现的普通界面；专用保留区只检查共享影响，不扩大业务重写。保留既有差异，最终交付实际产品结果、完整入口明细及自检交接，供另一个只读模型审核。不要升级组件库、重写业务/Host、改真实数据、创建/委派任务、自动提交或切换日常版。障碍按异常表处理，不能仅凭分组打勾或静态样稿声称全部完成。
