# 迁移后清理剩余补证施工方案

日期：2026-10-02（Asia/Shanghai）。状态：方案已制定，尚未执行。

## 1. 决策、目标和固定标准

采用“保留原验收标准，拆分剩余补证”。这是停止自动修复迭代后的有限补证工作，不自动开启第三修复轮。

依据：

- 当前 `AGENTS.md`。
- `docs/design/reader-post-migration-cleanup-plan.md` 的 C01–C06、V01–V08。
- `docs/design/reader-post-migration-cleanup-review.md` 的 CP01–CP10。
- 当前 `docs/design/reader-post-migration-cleanup-handoff.md`。
- `docs/architecture/review-loop-and-evidence-validation-lessons.md`。
- 最新独立报告：`C:/Users/0/AppData/Local/Temp/readweb-cleanup-independent-rereview2-20261001-01a0f7c7/rereview2-report.md`。

最近独立结论：清理 NOT_VERIFIED、外观/操作保持 NOT_VERIFIED；CP01/03/04/06 PASS，CP02/05/07/08/09/10 NOT_VERIFIED。素材遮罩和移动布局两项 P2 已关闭，没有当前确认待修 P2。

目标是关闭身份、逐项台账和固定必要矩阵的证据缺口。执行侧只报告补证结果，不能自行改判独立 CP PASS。标准原位换肤既有原范围 PASS、历史 C04/C06、日常版替换和全应用统一保持各自原状态。

## 2. 授权范围与文件职责

| 对象 | 本方案允许的工作 | 限制 |
| --- | --- | --- |
| 本方案 | 作为执行依据 | 执行中不修改既定验收标准 |
| 新 `docs/design/reader-post-migration-cleanup-evidence-completion-handoff.md` | 记录 S1–S3、证据索引、未关闭项、环境和停止点 | 不宣布独立验收或全项目完成 |
| 原 `reader-post-migration-cleanup-handoff.md` | 增加明确日期的身份勘误/补证引用 | 保留原记录、旧声明和历史命令状态；不悄悄替换过去的身份 |
| 新独立 Temp 根 | 开场快照、候选台账、哈希清单、有限浏览器脚本/合成夹具、截图/JSON/日志 | 不写真实业务数据，不修改旧证据目录 |
| `styles.css`、SRS/预习 CSS、theme/style-editor/glass JS | 只读核对消费者、有效声明和生命周期 | 不删变量、合并 CSS、改变生成/清除或重新修复产品 |
| Vue 模板、入口、Button/native 配方、runtime、配置、已有测试脚本 | 只读确认与运行安全的现有检查 | 不改 owner/DOM/事件/入口/断言/依赖/构建配置 |

发现缺失消费者证明不等于获准删除代码；发现真实回归不等于获准修复。登记 CP 或具体 P0–P2、影响和最小后续建议，停止受影响项，交由用户决定。

不创建聊天、任务、代理、worktree；不提交、promotion、归档 OpenSpec 或更新全项目完成状态。只在优化树工作；不编辑/build/启动日常 `E:/read-web-next` 或历史 `E:/read-web`。不改 IndexedDB schema、数据/协议、后端设置、评分计划或持久化键。

本方案默认不 build，不覆盖任何旧 dist。若现有产物无法建立身份，报告该项 NOT_VERIFIED；需要新构建时单列具体缺口交接，不能用新构建掩盖旧身份差异。

## 3. 执行开场（S0）

1. 读上述依据及实际 package.json、拟运行脚本；以当前文件为准，不照搬历史行号。
2. 建立唯一 Temp 根，例如 `readweb-cleanup-evidence-20261002-<随机串>`；保存时间、HEAD、branch、status、全 tracked diff、untracked 清单。原 HEAD 记录为 `153f9464356c9f59020f4f35ede713a807c798d3`，不得假定今天仍相同。
3. 对拟编辑文档保存副本/hash，记录新交接原本不存在。对清理目标源文件保存 hash，并与最新独立 `closing-identity.json`、`opening-diff.patch` 比较；其他 dirty 一并保护。不能用 HEAD diff 当补证本轮 diff。
4. 记录旧证据路径、端口监听地址/PID及可核实进程归属；不要输出 token/API key、真实文章或用户记录。
5. 若出现并发写入/源码漂移，暂停受影响比较，保留差异，不覆盖或恢复别人改动。

下面三个步骤分别有结束条件；顺序执行。S1 的产物身份未建立时，S2 静态核对仍可继续，但不得把 S3 的观察绑定到身份不明的“最终产物”。

## 4. S1：产物身份对齐（CP01、CP09、CP10）

### 已知对象

- 原清理根：`C:/Users/0/AppData/Local/Temp/readweb-post-migration-cleanup-20261001-212901-b1592d93`，其中 `before-dist` 为清理前基线。
- 第一修复根：`C:/Users/0/AppData/Local/Temp/readweb-cleanup-repair-20261001-01a0f7a6`。
- 第二修复根：`C:/Users/0/AppData/Local/Temp/readweb-cleanup-repair2-20261001-01a0f7a6`。
- 最新独立根：`C:/Users/0/AppData/Local/Temp/readweb-cleanup-independent-rereview2-20261001-01a0f7c7`。
- 第二修复交接声明 index SHA-256：`09DDC3B4E4B4880286861F0E0F4E1CA3327FE075CEB19CC834DD1CF05FFDCE67`。
- 最新独立三次实测 index SHA-256：`A4C3EDB3C52E774C7509DF3C7E197F300DAF24765758DF2DFDDD1C73EA27119D`。

### 具体工作

1. 重新读取第二修复 after-dist 的两个 HTML 和实际引用 assets，保存相对路径、大小和 SHA-256 清单。将 `.vite/deps` 等缓存元数据与应用资产分别列出；文件总数不能替代资产身份。
2. 将当前字节/hash与独立 audit.json 的 identities、实际加载 assets 对比；将源码清理目标与第二修复 after-target-hashes.json 和最新独立记录对比。若均匹配，明确哪些独立观察可以沿用。
3. 在上述已知证据根内查已有构建/复制记录及文件副本，确定 09DD… 的依据。禁止全盘搜查、编写日志语义推断器或按随意修改字节“凑”出目标 hash。
4. 若可证明是记录错误，新增“身份勘误”：原声明、当前实测、可核实原因、实际产物位置及继承的独立观察。若原因无法查明，写“原因 NOT_VERIFIED”；可以建立当前 A4C3… 的独立身份，但不能声称恢复了09DD…那份历史产物。
5. browser 前后各核一次两个 HTML 和实际应用资产身份，保存实际响应 URL/hash；出现变化立即停止该产物比较。

### 结束条件

- 选定的现有 before/after 产物路径及字节身份明确，与实际加载响应绑定；相应当前源码的清理目标身份已核对。
- 历史错误已诚实勘误或原因明确保持未知，当前交接不再引用一个未验证的 hash 当作本次实际产物。
- 输出 `artifact-identity.json`、`identity-reconciliation.md`。无法建立当前源码/产物关联时标 NOT_VERIFIED，不虚报 S1 PASS。

## 5. S2：逐候选台账补齐（CP02、CP05）

### 台账口径

只审原 C01–C06 起始候选、原执行/审核已经登记的同类候选。重点补 C01/C03，不扩成所有业务代码审计。已有 C02/C04/C05/C06 结果用证据索引继承，不改写历史统计。

每行字段：ID、分类、原文件/定位、完整 selector 分支或变量/函数名、候选原因、当前静态/动态消费者链、入口或不可达依据、实际处理、保留属性/上下文、必要矩阵、前后证据、检查和状态。

### C01 工作

1. 从原 before-source 和当前根/SRS/预习 CSS提取受本轮删除影响的完整逗号分支，逐项登记；不要以旧规则总数或 owner 按钮数量代替对账。
2. 对应当前模板及 JS生成链，核对 learning/workflow/style-controls owner、条件渲染、Teleport、专用 native switch 和多选择器共享消费者。
3. 删除分支记录无消费者的具体 owner/生成链依据；保留分支记录用途和影响状态。给 badge/file/bubble/video、小按钮、chunk、Toast等保留对象建立正向来源索引。
4. 不恢复宽泛 ownerless 样式，不对已删除选择器制造假节点。原19/44/8等统计只是核对线索，重新核实口径，禁止为匹配旧数字调整台账。

### C03 工作

1. 对原清理删除及有据保留的每个变量名分别登记：CSS root/dark定义、var()读取、JS读取/写入、theme生成、清除列表、独占计算和动态前缀链。
2. 明确列出 `--chunk-annot-default`、`--glass-shadow-sm/md/lg`、`--glass-blur-sm/md/lg`、panel/button/border/highlight、`--pru-reader-bg`；按名字逐项裁决，不能用“glass族仍活跃”覆盖全部成员。
3. 特别核对 lg 两项及 chunk-annot-default：源码定义/生成不自动构成消费证明；没有证明的项写未确定并指出缺失链。即便确认无消费，也只登记待处理候选，本方案不授权删除。
4. 核对五色存储格式、共享计算与有效 custom 清除合同，链接现有实际两亮度/恢复证据；新源码漂移会使旧结果失效时单独列出。
5. 汇总删除、合并、有据保留、未确定的可信计数；注明分支/变量口径及分类重叠。未确定不是零就如实报告，不改名为保留。

### 结束条件

- 输出 `candidate-ledger-complete.md` 或简单JSON；所有原候选有独立条目和对应证据引用。
- “有据保留”均能指向当前消费者或明确的首屏/响应式/兼容合同；未知项单列。
- 全部候选未确定=0才报告 S2 PASS。若发现需要产品改动，输出有限发现并停止该项；不自动开启清理修复。

## 6. S3：补齐固定缺失浏览器证据（CP07–CP09）

### 环境与采样原则

- 复用已有独立 `audit.cjs`、`supplement.cjs` 的合成路线和原固定矩阵，先读脚本；复制到新Temp再作有限补充，不改旧脚本/结果。
- Chromium版本、字体、缩放、deviceScaleFactor、viewport及输入状态双侧一致。1280×800、390×844；reader light/dark/custom-light/custom-dark，学习窗口固定浅色。
- 新context，SW block；导航前安装合成业务契约，未知业务请求阻断并记录。不使用真实profile、后端下载/AI/删除/设置保存或真实评分；浏览器隔离存储只放合成数据。
- 从产品入口进入，用真实点击、输入、焦点、按键、等待及响应延迟触发状态。不能直接设置展示样式、手绘DOM或强设伪类替代真实操作。
- 每种受删改模式/owner/Teleport根选代表控件，继承身份吻合且属性/状态未变的已有证据；不要求所有同族按钮机械重复截图。
- 同环境 before/after computed、相关 matched来源、几何与截图配套；只比较当前清理影响的属性，沿用原约1 CSS px矩形舍入容差，换行/遮挡/顺序变化不豁免。

### 必须补查清单

| 分组 | 原缺口及真实触发方式 | 必须记录的结果 |
| --- | --- | --- |
| M01 / V01 | 工具栏默认、hover、pressed、selected、键盘focus、实际可产生disabled的代表状态；合成文章标记由产品动作变成非零，正文/chunk切换 | 入口顺序/分组、36px标准配方与例外、SVG、padding/gap、换行、badge及保留规则的获胜属性；不能用全局截图替代owner状态 |
| M02 / V04 | 实际素材入口，库/任务/设置/添加；合成failed/completed/pending；由实际完成条目打开quality窗口，由合成契约触发notice | 两宽度且主题影响处覆盖四模式的panel/header/backdrop/log/title/状态色；390实际滚动到末项、关闭和返回焦点；quality的Teleport根与notice单独记录 |
| M03 / V05 | reader内有卡SRS与standalone均从真实入口进入，展开历史、揭示答案、设置录键、播放；合成评分响应暂缓再释放 | 固定浅色、自然换行、等待/禁用，等待期再操作没有重复提交（记录合成请求或现有评分调用计数）；关闭/焦点；不声称真实评分持久化 |
| M04 / V06 | 固定预习JSON由产品file输入导入，实际页/设置/shortcut，录制开始后Escape，中文switch，合成完成/等待池 | 录制取消后的实际文本/存储及focus；Escape后dialog是否保持以before语义为准，再通过正常关闭验证焦点；专用switch/auto-height/padding/gap/窄屏可达 |
| M05 / V07 | 从产品入口打开受根规则删改影响的AI解释、文章预习词、整理生词；实际词命中打开bubble；产品视频/file保留控件 | 对每种删改模式至少一个正向真实消费者，默认/受影响交互属性、关闭与focus；业务结果用合成响应，不要求真实外部服务成功；无当前消费的退役分支不制造假节点 |
| M06 / V02/03/08 | 复用身份相同的主题、chunk输入关闭、Toast/glass生命周期、真实WAV播放跳句、启动CLS证据；在缺少的源码加载路径复核相同代表动作 | 五色/两亮度custom与light/dark返回清除、刷新恢复；当前chunk效果/输入保存；首次/动态/re-init/dispose；可解码媒体自然推进和跳句；CLS<0.01、完整错误/阻断记录 |

受影响分支不存在、当前产品不能安全触发时，记录明确源码依据与 NOT_VERIFIED，不写一个空 fixture PASS。评分/学习数据须走现有正常注入或隔离存储恢复链；不直接制造学习页DOM。

### 源码与生产路径

1. 生产：只服务 S1确认的现有Temp产物，利用项目browser-port-policy选择安全本机临时端口；不占日常端口，不把Vite源码服务当生产。
2. 源码：先核对 `127.0.0.1:5184`/8776的实际监听地址与归属。私有地址5184被占用不自动证明loopback5184不可用；用有限loopback可用性检查确认，不杀未知PID。
3. 有适合的现有优化源码服务则只复用；需启动时只用 `scripts/launch-optimization-preview.ps1 -DevFallback -NoOpen` 和 optimization config/data根。先检查其当前路径是否会重启已有实例、构建或写入业务数据；本补证禁止这些副作用，无法安全满足则保留源码browser NOT_VERIFIED。
4. 不通过默认production launcher发布新release，不启用 owner migration/promotion，不启动日常服务。只释放本轮实际拥有的进程；已有服务保持。
5. before源码服务若不可安全获得，可用原before-source、原before-dist及身份吻合的开场证据作为已知基线；不要把缺少的源码对照伪写成运行成功。来源/覆盖分别列明，独立审核按固定标准判断。

### 结束条件

- 输出有限 `missing-matrix.md`：每个原缺口的before/after源路径、状态、操作、实际响应/属性证据、结论和剩余限制。
- 输出截图/属性/请求计数/错误记录；动作标签、mock契约或静态断言本身不证明旅程成功。
- 缺口齐全且无确认回归，才能报告S3执行侧PASS；任何必要项缺证据保持NOT_VERIFIED，不能由同组其他PASS抵消。

## 7. 命令与证据状态

原12focused独立PASS可在源文件/脚本hash未变化时引用最新独立结果。本方案未改产品/脚本，无必要反复跑同一检查；按本次环境或依赖变化选择需要重跑者。至少实际运行 `git diff --check`，日志写新Temp。

需要重跑时：style-editor-module、glass-effects、theme-controls-module、reader-controls-runtime、reader-app-runtime、script-order、legacy-dom-drain、legacy-deletion、passage-preview-shortcuts，以及影响focused的srs-review-ui-v2、youtube-workflow-panel、vocabulary-preview-ui、annotation-bubble。先读脚本检查访问/写入/启动服务；聚合 `verify:passage-preview` 含live TTS，不裸跑。

正式 `verify:vite`/`verify:production-preview` 只有目标归属、业务隔离和证据输出保护均成立才运行；不得为跑命令改变其断言或启动未知服务。脚本可能写 `.playwright-artifacts`，先保存原证据并在结束后恢复原文件，仅处理本轮拥有的输出；每个删除/恢复目标先验证绝对路径。能否安全运行与独立合成矩阵分别记录。

环境变量采用保存/try-finally恢复，源码正式目标设 `READ_WEB_URL=http://127.0.0.1:5184/`；生产正式目标设S1产物对应URL。不要只设READ_WEB_URL后让wrapper在错误端口/默认dist自动启动；检查当前脚本行为。

历史 `verify:production-preview` FAIL、YouTube行为检查FAIL/清理归因NOT_VERIFIED、`verify:vite`/`npm test` NOT_RUN保留。新实际命令结果另加带日期行，不追改旧记录。完整npm test不设新门槛；本次未运行就写NOT_RUN。替代矩阵不能写成正式命令PASS。

## 8. 输出、独立验收与停止条件

新补证交接须包含：S0开场与结束逐文件diff/hash；S1真实产物身份与勘误；S2全候选索引/计数/未确定；S3逐缺口证据；实际命令与继承结果；全部NOT_VERIFIED；创建/复用服务归属及释放；历史失败与回滚依据。

三个步骤的状态独立报告，再映射CP必要子项。执行侧不得直接把独立CP状态改PASS。仅当独立审核认定全部适用CP PASS、必要FAIL/NOT_VERIFIED和候选未确定均为0，才能宣布原清理完成。

停止规则：

- 本方案只完成一次有限补证，不自行安排下一修复/复审循环。
- 新确认缺陷：映射CP或P0–P2、保存证据，停止受影响项，不自行改产品或测试。
- 证据不足/环境阻挡：报告NOT_VERIFIED和最小缺口，不换端口/强制状态/真实业务调用凑PASS。
- 支持脚本约500行以上或超过其审核基线两倍：暂停增加复杂度，说明已有工具为何不足；不扩成日志真实性验证平台。
- 同一补证动作连续两次失败：停止该动作重试，保存错误和环境，继续无依赖的核对。既有两轮完整审核未通过的停止约束保留，不自动进入第三产品修复轮。
- 用户安排独立只读审核；执行者不创建该聊天/代理、不发送跨聊天消息、不替审核者修改状态。

## 9. 给执行模型的指令

> 请在 E:\read-web-next-optimization 按 docs/design/reader-post-migration-cleanup-evidence-completion-plan.md 完成一次“保留原标准、拆分剩余补证”。先读AGENTS、原cleanup plan/review、当前handoff和最新独立rereview2-report，保护全部开场dirty。
>
> 顺序处理S1现有产物身份、S2原候选逐项台账、S3固定缺失浏览器矩阵，各自记录结束条件和结果。产品代码/已有测试/配置保持只读；只允许新Temp证据、新补证交接以及原handoff的明确勘误/引用。不build，不覆盖旧产物/证据，不提交、不创建任务/聊天/代理/worktree，不promotion，不触碰日常/历史树。
>
> 不把未证明的变量改成有据保留，不用mock/动作标签证明真实旅程，不把替代矩阵改成正式命令PASS。身份未明、必要状态未测或发现新确认缺陷如实登记，停止受影响项，不能自动开启第三修复轮。完成后输出S1–S3、逐CP证据索引、未关闭项及交接，等待用户安排独立只读审核。
