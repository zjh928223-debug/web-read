# UI 样式缺陷维修施工方案

日期：2026-09-29。状态：方案已制定，产品维修尚未执行。

配套审核：[reader-ui-style-repair-review.md](reader-ui-style-repair-review.md)。
调查方法继续使用 [reader-ui-full-style-audit-plan.md](reader-ui-full-style-audit-plan.md)，不重建另一套调查标准。

## 1. 本次复核结论与依据

用户提供的“全应用 UI 样式检查报告”是一份部分完成的静态调查。报告明确披露没有完成隔离浏览器巡检，这一限制应保留；不能把标题或候选界面表视为全应用检查完成证明。

现场 HEAD 为 `153f9464356c9f59020f4f35ede713a807c798d3`。编写本方案前为 27 个已跟踪修改文件及 2 个未跟踪文档，与报告的 29 条路径一致；路径数量相同不能证明历史文件内容始终未变。本轮不重新认证此前所有 A01–A10，也不把此前有限范围 PASS 扩大为全应用统一。

| 原报告判断 | 独立复核结果 | 可用结论 |
| --- | --- | --- |
| reader 与 standalone SRS 是生产入口 | `vite.config.mjs:96` 的 build input 确认 | 属实；不等于所有运行界面已盘点完 |
| M1/M2/M3/M4 混用 | 共享 Button/Input/Textarea、native 助手与功能 CSS 均有当前消费者 | 属实；共享类名不证明最终外观符合，专用 CSS 也不天然构成缺陷 |
| 转录工具栏仍有玻璃效果，S3 候选 | 当前源码隔离样本及现有 dist 实际 reader 入口均复现半透明表面、光斑和内高光 | 升级为原范围样式缺陷 F01，映射原 A04/A05 |
| 源码有模糊规则，原报告未声称实机生效 | 源码隔离样本为 `blur(20px) saturate(1.5)`；现有 dist 在 Chromium 中为 `none` | 补充这一限定。产物相应规则仅保留 `-webkit-backdrop-filter`，不可把源码声明冒充生产计算值 |
| 其他专用表面可保留或建议统一 | 本轮没有逐项取得消费者、属性与原例外的完整证据 | 只是候选分类；继续调查，不批量改为 S2，也不直接判为 S3 |
| 浏览器隔离失败 | 临时会话记录与报告叙述一致，未留原始网络证据 | 只能确认记录存在，不能独立重放历史失败或证明历史无业务写入；本轮已另建可用隔离环境 |

额外确认 F02：`.controls` 和 `.extra-controls` 虽有实色背景、`backdrop-filter:none` 及 `::before { content:none }`，运行时仍挂上 `glass-panel`，共享 `.glass-panel::after` 继续生成内高光。与 F01 属于同一轮目标面板装饰清理遗漏，一起维修，不拆成反复扩大的任务。

源码定位：`index.html:81` 为 F01 的真实 DOM；`glass-effects.js:5`、`:75` 附近为 panel 选择与初始化装饰，`:90` 附近为动态节点处理；`reader-app-runtime.js:117` 调用初始化。`styles.css:1364` 为共享表面，`:1393` 为共享 after 高光，`:1714` 为 header 的 before 光斑，`:1848` 为 header 表面；`:1549`、`:1697` 附近为另两个面板。行号随施工可能变化，审核按当前选择器重新定位。

原方案第 1.1 节以及第 4.2.7 条明确要求去除 controls、extra-controls、transcript-header 的目标玻璃装饰和伪元素。F01/F02 是这项约定的修复，不是新增全站设计要求；没有据此声称播放或数据功能损坏。

### 本轮独立证据

目录：`C:\Users\0\AppData\Local\Temp\readweb-ui-recheck-20260929-211305`。

- `recheck.cjs` / `recheck.json`：Playwright Chromium 145；全新非持久 context，初始 Cookie 数为 0，service worker 禁用，WebSocket 关闭。虚拟 origin `http://readweb-audit.invalid/` 的请求全部本地 fulfill 或 abort，无 `route.continue`/`route.fetch`，未连接真实业务后端。读取仓库现有 dist，没有构建或修改产物。
- 实际 reader 入口 Vue 挂载成功，无框架错误层及 pageerror。通过真实主题按钮依次进入 dark/custom，等待过渡稳定。1280×800 浅/深与 390×844 深/custom 下取得 F01/F02 证据；两个外部字体/CSE 请求被主动阻止并产生预期资源错误，不能称所有控制台错误为零。
- `production-light-desktop.png`、`production-dark-desktop.png`、`production-dark-mobile.png`、`production-custom-mobile.png`。浅色 header 背景为 `rgba(255,255,255,0.34)`，深色为 `rgba(29,34,46,0.56)`；`::before` 有径向光斑且稳定 opacity 为 1；三个面板的 `::after` 都有 inset 高光。所测页面无横向文档溢出。
- `source-fixture.cjs` / `source-fixture.json`：读取当前 index 静态壳、styles.css、内存编译的 workflow 样式以及真实 glass 模块初始化。浅/深均确认 F01/F02。它没有启动完整 Vue/Pinia，也没有生成完整 utility 候选，只证明面板规则及运行时接入，不能用于共享按钮验收。
- JSON 记录了相应源码或实际加载资产的哈希。现有 dist 与当前源码只核对了本问题，不认证全量产物一致性。源码与产物的滤镜表现差异已保留；本维修应令两者目标面板均无模糊，而不是修构建器来恢复玻璃效果。
- `attempt-1-selector-timeout.json` 保留本轮首次误用 `#app` 导致的观察超时；改用源码真实挂载点 `#vue-root` 后成功。这不是产品 Vue 挂载失败，也不改写历史 4173 挂载超时。
- 这些临时证据可能被系统清理，施工时需取得自己的基线；缺失时重测对应小范围，不编造或重建历史结论。

## 2. 本次任务边界与完成目标

本方案是一轮连续的“补齐调查 → 修复已确认原范围缺陷 → 自检交接”。用户当前要求制定方案，不表示产品修改已经执行。

施工完成需要同时交付：F01/F02 修复；按原全应用检查任务书补齐界面/元素分类；本轮确认的其他 S3 缺陷有修复与复测；S2/S4/S5 剩余清单；审核所需的前后证据。

“维修通过”“调查完成”“全应用视觉统一”是三种结论。允许明确保留项和新增建议继续存在，但必须具体列出；不能只修工具栏就宣称全应用检查结束，也不能为了宣称统一而擅改所有专用控件。

- 只在 `E:\read-web-next-optimization` 工作；保留已有未提交差异，不 reset/clean/stash 覆盖，不自动提交或 promotion，不创建 worktree、对话或代理。
- 不编辑、构建、启动日常树和历史树，不读取真实学习资料、sample JSON、API key 或持久浏览器 profile。
- 优化手工预览遵守 `config/runtime.optimization.json`、5184/8776、优化数据根及优化启动器；不重启用户现有服务。自动隔离校验遵守仓库既有测试端口规则。
- 不改 IndexedDB、Host/API/评分/预习协议、依赖版本、组件 preset、index 脚本顺序；不往 reader-runtime/session-init 薄入口加功能。
- 原设计保持 new-york/neutral/rw、普通按钮 default、图标 icon、单行输入 default；保持事件、焦点、文案、分组、自然换行、正文排版及 custom 色值语义。
- 不批量删除玻璃变量/类，不全局开启 Preflight，不把剩余原生节点全部改写成 Vue，不安装新的 Dialog/Tabs 组件。

## 3. 开工前固定验收条件

施工前阅读配套审核的 R01–R09。验收必须按这些条件及原 C01–C08/A01–A10 的对应条款进行，不能在复审中追加个人审美标准。

已确认 F01/F02 的目标为：三个面板在默认浅/深、custom 路径均退出玻璃装饰；使用本域现有实色背景/边框映射，无装饰渐变、光斑、inset 高光或模糊。可保留现有功能性外阴影、边框形状、布局和定位。

对新增发现，只允许在消费者、实际生效属性、原条款均明确后列为 S3 并维修。S4 留作单独建议，不能为了增加施工量反向宣称旧验收失败。SRS 自动高度例外不自动豁免圆角、padding 等所有属性，但原条款含糊时也不能直接判错。

## 4. 连续施工步骤

### W01：保存基线与建立可靠隔离

1. 记录时间、HEAD、dirty 文件；为预计改动文件保存开场副本到临时目录，用于区分新增维修与原换肤差异。不得用相对 HEAD 的整份 diff 冒充本轮维修 diff。
2. 先证明干净 context、导航前 HTTP 拦截、service worker 禁用和 WebSocket 阻止可用，再打开产品。新标签页不等于独立 profile；不要重试带持久 Cookie 的应用内标签作为安全环境。
3. 静态资源用严格白名单；API、外部请求和未知路径默认拒绝，已知业务端点使用合成响应。拦截失败不得回退直连。SRS sample URL 在请求发生前直接 fulfill 合成词库，不先 fetch 原文件，不修改产品入口来注入夹具。
4. 本轮提供的虚拟 origin 加本地 dist route 是可行的定向方法；需要全功能合成接口时按既有契约补最小响应，不能拿全阻止导致的空页面当完整旅程。
5. 检查环境失败先修临时验证路径，保留失败记录；独立可做的源码分析继续。无法安全打开的对象记 S5，不写 PASS，不临时改产品协议绕过。

### W02：补齐全应用调查及施工清单

完整采用原调查任务书的三线发现、1280×800/390×844、适用主题和状态矩阵。旧 28 项、六张截图及本报告候选表均不是数量上限。

| 必查线索 | 需判定的具体内容 | 当前状态与处置原则 |
| --- | --- | --- |
| 三处 reader 控制面板 | 背景/边框、两个伪元素、运行时装饰、指针事件、主题切换 | F01/F02 已确认，保存基线后维修 |
| SRS 录键卡 | `srs-review.css:368` 的 auto/min-height、5×8 padding、999px 圆角与 Button 配方关系；录制/Escape/换行 | 静态覆盖存在，逐属性判定 S2/S3/S4，不能只看最小高 36px |
| 素材时间筛选 | `styles.css:4521` 的圆角 important、筛选按钮与外围容器是否分别符合原范围 | 不能将外围 pill 与普通按钮尺寸混为一项 |
| AI 解释与两套词汇窗口 | 普通字段/footer 及外壳，与记录行/标签/步骤/状态卡分开核对 | 普通目标按原标准；专用内容按条款分类 |
| 预习数量设置与录键 | 外壳、标题、分隔、kbd、录制卡、中文模式 switch；深 reader 下固定浅色 | 检查所有目标属性，不用“复合控件”豁免整个窗口 |
| 切分样式 | 外壳/数字字段/按钮与 color/switch 分开；重开/动态插入后装饰是否回来 | 保留原生行为，不能只在打开前观察隐藏节点 |
| 其余现有入口 | 素材四视图及附属层、reader 正文/媒体/气泡、预习/SRS 两入口、Toast/加载/错误等 | 按原完整地图逐项打开，历史/测试对象有排除依据 |

为所有发现建立同一张记录表：入口/容器/子视图、元素/状态、M1–M4、S1–S5、最终属性、获胜规则、原条款、改动与复测。不要再生成通用调查平台。查到与已确认问题无依赖的其他对象时继续，不每页请求一次确认。

### W03：维修 F01/F02，覆盖静态与动态路径

主要预计文件：`src/composables/glass-effects.js`、`styles.css`、`scripts/glass-effects-check.cjs`。已有 token 映射足够时不要改 `workflow-ui.css`；其他文件仅随证实的 S3 清单增加。

1. 在 glass 模块中让 `.controls`、`.extra-controls`、`.transcript-header` 退出面板玻璃装饰。优先收窄既有 panelSelector/目标判断，保持其余保留消费者和生命周期。不要只过滤按钮 owner，因为问题在父容器。
2. 同时检查首次初始化、MutationObserver 新节点/子节点、再次初始化和 dispose。目标面板不再获得 glass class、glassBound 与 pointer 动态变量接线；保留对象仍可正常装饰和释放。
3. `.transcript-header` 改用现有 reader 的实色 card/border 映射，关闭两个前缀的 backdrop-filter，移除其装饰性 inset 阴影。保留 display/flex-wrap/gap/padding/定位/层级及功能外阴影。custom 使用已有本域映射，不强制覆盖为默认白色。
4. 清理三个目标表面的 `::before/::after` 产生路径，含直接选择器和共享 glass class 来源。仅退出 JS class 不足以消除 `.transcript-header::before`；仅设 filter none 也不足以消除光斑/内高光。优先修所有者规则，避免层层叠加 important。
5. 对组合选择器拆分消费者，保留 helper/toast/媒体/气泡等非本项目标。对尚不明确的消费者继续保留并记录。
6. 更新现有 glass-effects 行为检查：目前它把 `.controls` 当作必须绑定三种指针事件的 panel，该期望需要改为允许保留的真实 panel；另断言三个目标面板无装饰。不能只删除原断言或把所有 panel 都改成零事件。
7. 补充初始及动态插入目标、重复 init/dispose 的直接回归断言，保留既有 observer/dispose 测试。CSS 结果在浏览器检查，避免用源码字符串扫描代替 computed style。

### W04：按证据维修其他 S3

对 W02 确认的原范围缺陷做最小属性/规则修正，复用现有组件或助手；不重排界面。每项绑定原条款、维修文件、受影响状态与直接复测。共享规则有多个消费者时全部列出并覆盖影响面。

S2 保留并说明逐属性例外；S4 输出具体建议/成本与行为边界，不自动施工；S5 说明尝试路径和最小补充条件。不要将上述任何一类伪装为 S1。

### W05：自检、生产对照与交接

固定自检：`git diff --check`，`npm run verify:glass-effects`、`npm run verify:reader-app-runtime`、`npm run verify:theme-controls-module`、`npm run verify:keyboard-boundary`、`npm run verify:script-order`。

执行施工时允许运行当前优化树 `npm run build`；构建后按实际入口及其 CSS/异步块核对，禁止直接修改 dist 修视觉。使用 `npm run verify:vite` 和 `npm run verify:production-preview` 的当前仓库流程完成加载/交互门禁，先阅读入口脚本确认网络及写入范围安全，明确服务身份、端口与输出位置，备份将被覆盖的既有证据。若某命令不能在隔离前提下安全运行，记录 NOT_RUN 和替代定向证据，不能擅自访问真实服务或称该命令已通过。

按实际改动追加 focused checks：素材对应 `verify:youtube-workflow-panel`/`verify:youtube-workflow-panel-behavior`；SRS 对应 `verify:srs-review-ui-v2`；预习对应 `verify:passage-preview:unit`/`verify:passage-preview-shortcuts`；AI/词汇对应 `verify:annotation-backfill-ai`/`verify:vocabulary-preview-ui`。不要无差别跑完整 npm test；测试失败应区分本轮回归、既有失败和隔离阻断。

定向浏览器最低要求：

- 三个面板默认浅/深、custom，桌面/窄屏；稳定态与指针移动均不再有光斑/内高光/模糊。关闭重开相关界面，动态接线不复发。
- 普通按钮保留 default 的 height/padding/gap/字体/圆角；图标自动 16px 及显式大小例外不回退。原层顺序和首绘 footprint 不被改坏。
- 跳句、倍速、跟随、高亮、快捷键、chunk、主题、相关弹窗关闭/焦点用合成数据验证实际事件；未改表面不重复全业务旅程。
- 新生产 CSS 复核所有本轮修复模式及受影响的 reader/learning/teleport 上下文。standalone SRS 通过合成 sample 请求到达实际页面，不能用孤立 Button 为整个入口背书。
- 维持原生产加载 CLS < 0.01 的既定门槛与报告身份，缺失时记未验证；不要将本轮定向截图冒充新的完整加载报告。

交接可写一份本轮专用文档，包含：开场基线/本轮差异；F01/F02 与新增 S3 前后对照；完整调查表与 C01–C08；S2/S4/S5；命令、浏览器/资产身份、模拟边界、截图位置。临时脚本/截图放系统 Temp，历史报告不静默覆盖，既有交接不回写为新的结论。

## 5. 完成与停止规则

- F01/F02 及本轮确认 S3 无未解释残留，直接回归检查通过；完整调查满足原 C01–C08 才能称调查完成。必要浏览器或生产证据缺失则交付部分完成和最小缺口。
- 单个缺陷修复成功不结束整份已发现清单；没有证据的对象不凭猜测修改。
- 同一任务连续两次修复/复审失败后停止自动循环，向用户说明是否简化、拆分或继续，不自行开启第三轮。
- 支持脚本超过约 500 行或超过审核基线两倍时先说明复杂度和边界；不增加语义日志解析器来“证明”真实旅程。
- 本方案不批准日常替换、真实数据迁移、真实 AI/下载或自动提交。

## 6. 可交给执行模型的指令

> 请先读 AGENTS.md、reader-ui-style-repair-plan.md 与配套 repair-review.md，在优化工作区连续执行本方案。先验证干净浏览器和默认拒绝的请求隔离，补齐原全应用样式调查；修复已确认的三个 reader 面板玻璃装饰残留，以及调查中有原条款和实际证据的其他 S3。S2/S4/S5 分开列出，不把新增审美建议自动施工。覆盖静态 CSS、运行时初始/动态装饰、两个伪元素与原控件/布局行为；运行直接相关检查，构建后核对两个入口及受影响样式。保留所有开场差异，不改保护树或真实数据，不委派、不用 worktree、不提交、不 promotion。交付真实前后证据、完整调查分类与审核表，明确维修通过与调查完成的区别。遇到阻断继续独立可做的工作，证据不足如实标注，不伪造全应用 PASS。
