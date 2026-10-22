# 迁移后清理：剩余矩阵补证交接

日期：2026-10-02（Asia/Shanghai）。执行方案：reader-post-migration-cleanup-remaining-matrix-plan.md。仅一次有限补证，已经停止，等待用户安排独立只读审核。

**本轮剩余补证交接状态：部分覆盖，含未关闭项；原迁移后清理：NOT_VERIFIED；完整外观/操作保持：NOT_VERIFIED。** 六项最小清理及其影响范围外观/操作、CP01–CP06 仍继承最新独立 PASS。执行者不改判 CP07–CP10，不宣布原任务完成。

## 依据、范围与身份

先读 AGENTS、原 cleanup plan/review、六项交接及[最新独立六项报告](C:/Users/0/AppData/Local/Temp/readweb-cleanup-six-independent-review-20261002-01a0f7c7/six-candidates-review-report.md)。本轮没有追加候选或清理，没有产品、测试、配置、依赖或旧文档修改。

证据根：[readweb-cleanup-remaining-matrix-20261002-01a0fb48](C:/Users/0/AppData/Local/Temp/readweb-cleanup-remaining-matrix-20261002-01a0fb48)。逐项[A/B coverage](C:/Users/0/AppData/Local/Temp/readweb-cleanup-remaining-matrix-20261002-01a0fb48/coverage.md)、[契约记录](C:/Users/0/AppData/Local/Temp/readweb-cleanup-remaining-matrix-20261002-01a0fb48/contract-map.md)、[源码环境](C:/Users/0/AppData/Local/Temp/readweb-cleanup-remaining-matrix-20261002-01a0fb48/source-environment.md)、[命令状态](C:/Users/0/AppData/Local/Temp/readweb-cleanup-remaining-matrix-20261002-01a0fb48/command-status.md)。

HEAD 153f9464356c9f59020f4f35ede713a807c798d3，branch codex/read-web-optimization。opening/closing identity、status、tracked binary diff、untracked清单及hash保留在证据根。原六项构建输入1197文件全部吻合，无新漂移。开场1199个tracked/untracked文件；结束仅允许新增本交接，实际收口结果见 workspace-changes.json。原 dirty、WhisperX/语言处理工作保持。

本轮没有 build；直接使用原清理 before 和最终六项 after，不能将 repair2-after 当原 before。

| 产物 | 目录 | index.html SHA-256 | srs-review.html SHA-256 |
| --- | --- | --- | --- |
| before | C:/Users/0/AppData/Local/Temp/readweb-post-migration-cleanup-20261001-212901-b1592d93/before-dist | F2B3EFDE67C96572CFAF4367F082825F94042BDD269C52FB680A9555D5DB7FF6 | CEC9807FBE94F129D89FB9593A89745FE916CA69125A33C6BEDE0977FD00DB71 |
| after | C:/Users/0/AppData/Local/Temp/readweb-cleanup-six-candidates-20261002-01a0fb48/after-dist | 6E9C35A6A8A94243D658FF2EB48C628624E759C0369C58F83CB8D36DABC1992E | 283557907E66B446AD5E0A0D83C25A084E7419987ADA6079FF415E5E075BB88E |

两目录全文件/资产/缓存元数据分别记 opening-artifacts.json / closing-artifacts.json；不能用HTML hash代替全部资产核对。

## A 环境和正常合成契约

按用户明确例外，frontend-only Vite从新Temp脚本直接调用现有createServer，当前优化config/root，configLoader runner，cache/log仅Temp，127.0.0.1:5184，PID16612。没有调用处理Host/数据/release的launcher，没有启动8776、owner migration、真实业务后台或数据恢复。插件请求前副作用先核查，实际业务API导航前拦截，未知请求阻断；SW block、新context、只允许source HMR。

A第一次遗漏正常静态JSON import及Range CORS暴露，失败保留；用当前消费链补齐正常响应/静态allowlist后第二次source两入口实际加载。合成成功job/session/file/media/transcript/chunk/marks通过现有loader字节和revision校验，产品素材库真实“打开”后3句/3chunk、12s WAV、三个学习/AI gate自然可用，没有强设gate/DOM/private状态。

A素材状态通过真实queue、library、quality、notice、设置/添加界面触发；成功打开后面板自动收起，后续正常关闭先重开，未再次关消失面板。媒体仅本机合成：1s发音WAV、12s原文WAV、ffmpeg生成12s H264/AAC MP4，fixture字节身份见 fixture-identity.json。

A04两卡与单次评分推进/历史显示真实发生，standalone是真正in-memory service，reader是正常合成IndexedDB恢复。当前 SrsReviewPage background:true；useSrsReview先commit/推进后排队保存，flow以transitioning/ratingCommitted保护旧卡，不能将延迟后台保存假称持续disabled，也不存在standalone HTTP评分请求。

**执行偏差：A04没有先完成可观察计数查询准备，却进入B评分计数尝试。** B通过组件关联仅调用公开getReviewLogs的查询没有取到数组；reader所传服务可能是source selector，不能拿方法静态存在当正常数据可达，standalone也未取到数组。两类动作各失败两次即停止，未改props/service/private flow或重跑，完整防重及关闭链不计通过。contract-map.md已用新增收口段明确更正准备设想，首轮原始记录不覆盖。

A05实际AI解释、整理生词窗口及file五词预习完成/等待池出现；文章预习扫描两次无窗口，bubble准备不足未出现，视频两个native操作未实现自然时间推进，停止依赖项。它们保持NOT_VERIFIED，不能由空节点、文件存在或metadata替代。

## B 实际观察与未关闭项

Chromium145.0.7632.6，DPR1；production双侧1280×800/390×844，reader/素材四主题，学习固定浅色。同字体/外部阻断/zoom环境。B共22context（20production、2source），[原始browser JSON](C:/Users/0/AppData/Local/Temp/readweb-cleanup-remaining-matrix-20261002-01a0fb48/b-matrix.json)、PNG及matched CSS声明/context完整保留。

production **116组采样配对差异0**，比较computed CSS、owner/disabled、文本、SVG和rect（约1 CSS px）。这只支持所采样属性/几何，before-only SRS动作没有算配对，不宣称所有必要操作PASS。

| 项 / CP | 实际覆盖 | 未关闭 |
| --- | --- | --- |
| B01 / CP07–09 | 标准素材、正文/chunk切换、editor数字23px/颜色/阴影/保存/Escape、focus/hold代表交互；双宽四主题48配对 | 仅方案代表owner交互，不扩大为全应用覆盖 |
| B02 / CP07–08 | library/末项/quality/queue/settings/add/notice，completed/failed/pending，双宽四主题56配对；quality独立Teleport、390末项、自动收起与正常关闭/focus/Tab记录 | console错误未过滤；notice回BODY是实测原语义，不要求新设计焦点目标 |
| B03 / CP07–08 | before双宽两入口播放、揭示、评分尝试；词/原文playing及自然timeupdate保留；A有after/source单评分推进 | 两类计数各失败2次后停止；after/source B03未做。缺旧卡准确计数、过渡/等待、防重完整配对、关闭及稳定focus/Tab；持续保存等待当前无可延迟外部边界，仍NOT_VERIFIED，交审核裁决 |
| B04 / CP07–08 | file五词、数量设置/取消、完成/等待池5词、返回；两侧浅色双宽6配对，source同链 | 返回后BODY；下一Tab before到theme-toggle，after仍BODY，两宽相同。before曾走失败B03评分/reload，after因止停未走，前置链不同，差异原因未定；精确返回/Tab合同未关闭。数量取消不冒称全部代表设置 |
| B05 / CP07–08 | AI解释/整理打开关闭、返回触发按钮；浅色双宽两窗口及video/file保留区6配对 | 缺文章预习词、bubble正向、视频自然推进；两个窗口只浅色，其他受主题表面未覆盖；metadata/几何不算播放 |
| B06 / CP09 | 当前源码两入口；reader390/light有chunk/素材/预习/AI/整理正常动作；模块与变换响应记录 | 源码19同名状态中13存在原始CSS差异；包括background简写格式、color及backdrop-filter实值。矩形/文本/SVG未记差异，但不能宣告源码/production一致。SRS高风险动作未补，standalone B仅入口 |

B04焦点原始节点对照见[focus-observations.json](C:/Users/0/AppData/Local/Temp/readweb-cleanup-remaining-matrix-20261002-01a0fb48/focus-observations.json)。B06差异见[source-comparisons.json](C:/Users/0/AppData/Local/Temp/readweb-cleanup-remaining-matrix-20261002-01a0fb48/source-comparisons.json)及[source-difference-properties.json](C:/Users/0/AppData/Local/Temp/readweb-cleanup-remaining-matrix-20261002-01a0fb48/source-difference-properties.json)：例如文件按钮production backdrop-filter=none、source=blur(8px) saturate(1.15)；素材文字production rgb(28,30,33)、source oklch(0.145 0 0)。未归一化隐藏，未修产品/断言或另起构建，交审核按既定CP裁决；不自行豁免或认定新增P0–P2。

## 响应、错误与继承

response到达立即取body，每context drain后close。B production474条全部与对应目录文件匹配；source319条变换输出，315条有原文件绑定、4条为无原文件虚拟/查询模块。两类hash分开记录，bodyErrors0，production真实hash mismatch0；A两轮数据另列，不混入B数量。[observation-totals.json](C:/Users/0/AppData/Local/Temp/readweb-cleanup-remaining-matrix-20261002-01a0fb48/observation-totals.json)仅索引记录，不从日志推断旅程。

B22个context首屏CLS均<0.01，最大0.007578922；pageerror0，console43条ERR_FAILED保留，business/blocked记录完整。阻断包含外部字体/CSE及未知ai-preview-sentences；通用console文本无URL，不能无据逐条归因或写成全空。没有真实API穿透；没有真实AI/词典/TTS/下载或持久化成功声明。

继承原有限补证已关闭的真实WAV/跳句、badge、录键Escape/shortcut局部focus、主题和glass初始/动态/re-init/dispose；引用 reader-post-migration-cleanup-evidence-completion-handoff.md 及其原始/独立报告，只保留原范围。不同owner/Teleport/入口不互代；badge不替bubble、录键focus不替最终返回、旧WAV不替新SRS或video链。六项独立5个focused PASS也仅继承，无漂移不重跑。

## 命令、保护与停止

实际git diff --check记录见 diff-check.log / diff-check-exit.txt。B runner exit0仅表示结束，内部15条NOT_VERIFIED保留，不记矩阵总PASS；A原失败也保留。focused本轮NOT_RUN；build、verify:vite、verify:production-preview、npm test本轮NOT_RUN，不裸跑默认wrapper。历史production health404 FAIL、YouTube行为FAIL/归因未知、六项执行runner exit1及历史NOT_RUN均不追改。

本轮源码PID16612已通过source.stop正常关闭并finally恢复环境变量；source-closed.json可核对。B两个自有静态服务finally释放，私有5184 PID12748保持，8776未启动。没有提交/promotion、创建任务/聊天/代理/worktree，没有修改日常/历史树或真实业务数据。新Temp缓存保留，不reset/clean。

收口验据：workspace-changes.json应为changed/removed为空、只added本交接，HEAD/branch/两产物不变；opening与closing文件逐一hash核对，tracked binary diff保留。没有产品回滚需求；未关闭问题若需修复由用户另定范围，不能用整个HEAD覆盖dirty。

本轮停止点：A不足子项及B03两次失败停止；B04焦点差异、B06源码CSS差异与未测主题/评分/窗口仍未关闭。CP07–CP10保持原独立NOT_VERIFIED，CP10必要FAIL/NOT_VERIFIED=0条件不满足。交接后等待独立只读审核，不自动修复、重跑或宣布关闭。
