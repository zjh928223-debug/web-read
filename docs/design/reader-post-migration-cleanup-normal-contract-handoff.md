# 正常恢复契约有限施工交接

2026-10-02（Asia/Shanghai）。依据[normal-contract方案](reader-post-migration-cleanup-normal-contract-plan.md)及用户限定范围，已完成一次有限执行并停止，等待独立只读审核。

**原迁移后清理、完整外观/操作保持及CP07–CP10仍NOT_VERIFIED。** 本轮R3统一视频路径准备通过并补完有限生产主题对照；R1/R2正常bundle/索引已取得，但规定窗口/真实词点击未闭合，停止对应下游。R4仅提交适用性裁决申请。源码首个context工具导航超时，源码消费者未验证。执行者不自行改判CP，不宣布原任务完成。

## 身份与保护

新证据根：[readweb-cleanup-normal-contract-20261002-2728e7f0](C:/Users/0/AppData/Local/Temp/readweb-cleanup-normal-contract-20261002-2728e7f0)。已读AGENTS、原cleanup plan/review/handoff、six-candidates交接、contract-readiness计划/交接、review-loop教训，以及最新独立readweb-cleanup-contract-independent-review-20261002-721ebd0b/contract-readiness-review-report.md。固定CP原义及既定停止规则保持，不追加清理候选。

HEAD `153f9464356c9f59020f4f35ede713a807c798d3`，branch `codex/read-web-optimization`。开场1203个tracked/untracked文件；原执行1201和独立1202的全部原文件hash均无变化，tracked binary diff字节相同；差额仅已有contract-readiness交接和本轮plan。after1197构建输入绑定一致。开场已有dirty不是本轮diff，WhisperX/语言处理工作保留。

两份固定目录各29资产逐文件核对，与原执行/独立opening manifest完全一致，不只核HTML、不用repair2-after替before、不build。

| 固定产物 | 目录 | index SHA-256 | SRS HTML SHA-256 |
| --- | --- | --- | --- |
| 原before | C:/Users/0/AppData/Local/Temp/readweb-post-migration-cleanup-20261001-212901-b1592d93/before-dist | F2B3EFDE67C96572CFAF4367F082825F94042BDD269C52FB680A9555D5DB7FF6 | CEC9807FBE94F129D89FB9593A89745FE916CA69125A33C6BEDE0977FD00DB71 |
| 最终after | C:/Users/0/AppData/Local/Temp/readweb-cleanup-six-candidates-20261002-01a0fb48/after-dist | 6E9C35A6A8A94243D658FF2EB48C628624E759C0369C58F83CB8D36DABC1992E | 283557907E66B446AD5E0A0D83C25A084E7419987ADA6079FF415E5E075BB88E |

证据：opening/closing-identity.json、status、binary diff、untracked、opening/closing-artifacts.json、baseline-comparison.json、build-input-comparison.json、workspace-changes.json。唯一仓库新增为本交接，原1203文件须按结束逐文件核对保持不变。没有产品/测试/配置/依赖/旧文档/旧Temp/产物写入，没有提交/promotion/任务/聊天/代理/worktree，没有日常或历史树操作，不reset/clean。

复制必要12s MP4/WAV、字幕/chunk字节和词库checksum至新Temp，复用正常session/revision/integrity。只在新Temp latest响应条目补合法sourceSentence、boundary及预定meaning；素材原字节及恢复身份保持。词库checksum只核身份，本轮没有SRS恢复/评分。详见[fixture-identity.json](C:/Users/0/AppData/Local/Temp/readweb-cleanup-normal-contract-20261002-2728e7f0/fixture-identity.json)。

## A关口与停止

Browser plugin not available，按本方案授权使用项目已有Playwright/Chromium145.0.7632.6；DPR1、新context、SW block、导航前业务合成响应与WS阻断，未知/外部请求阻断。没有真实profile、后端数据、AI/TTS调用、下载或注入状态。

总计 **19context：2准备 + 16production + 1未完成源码，0准备替换**，低于22；没有把未用预算挪去扩矩阵。R1/R2各一次不足后停，没有无依据二次尝试；R3一次统一路径通过，无原生鼠标替代、无VIDEO Space重试。

| 包 | 实际证据与结果 | 下游 |
| --- | --- | --- |
| R1/P2 | 正常素材“打开”经latest导入，读取storage.loadBundle得到loaded/revision1，generated/status非空；scope为youtube-workflow::synthetic-library-0/default-document。真实点自然enabled的“预习生词”，本scope有storage.load_bundle日志，但4秒窗口等待内未出现候选窗口。未取得候选/取消/重开/Escape/focus | A NOT_VERIFIED；B/source全部skipped。已删除旧“bundle必须不存在”误假设，没有覆盖empty bundle。没有证明具体normalize/merge/index产品故障，不自行产品FAIL；没有已证明Temp响应字段错误可支持准备替换 |
| R2/P3 | 正常bundle的manual-transcript-0-0-0条目、Synthetic/sourceSentence、meaning、transcript::0::g:0-0/range0–0及相同scope的getItems/queryByOccurrence已成立。工具选择transcript表面时试点折叠“过时入口”中的隐藏#toggle-chunk-btn，未完成可见span核对或真实词点击 | A NOT_VERIFIED；当前可见为chunk Vue，工具表面选择不足不能称bubble产品FAIL。没有强制点击、setInputFiles、私塞Map/DOM、刷新index或直接show。bubble meaning/边界/正常关闭未测，B/source停 |
| R3/P4 | 正常素材面板挂载同步视频偏好，getState.activeKind=video且getActiveMediaElement是实际video。可解码12s媒体。真实阅读区域padding鼠标使焦点到main-app-area DIV、离开VIDEO；Space统一播放，两样本约650ms相隔从0.615988→1.262446s且paused=false；audio time0/paused=true。正常Space暂停、产品关闭 | A具体动作PASS；允许B。独立audio/video事件、capture/bubble keydown/keyup target/code/defaultPrevented、focus、media rect和实际Range响应已保存。无需原生替代，不追改历史time0 FAIL |

原始[readiness.json](C:/Users/0/AppData/Local/Temp/readweb-cleanup-normal-contract-20261002-2728e7f0/readiness.json)、[bundle-target-span.json](C:/Users/0/AppData/Local/Temp/readweb-cleanup-normal-contract-20261002-2728e7f0/bundle-target-span.json)、A1失败PNG、A2视频PNG均保留。R1停止位置明确为等待真实候选窗口超时，不能把纯函数候选当本次扫描完成；R2目标条目可读不等于真实命中。新截图名含stage/build/reader/width/theme/object/state，没有A/B同名覆盖。

## B生产有限对照

共用reader：before/after×1280×800/390×844×light/dark/custom-light/custom-dark，共16context。通过正常theme-toggle和color输入设主题，两侧相同前置、字节、字体阻断、browser/DPR、动作次序及350ms属性/截图等待；窗口关闭后再开下一个，没有reload单侧换前置链。

只做A通过的视频，以及既有浅色契约已可达的AI解释/整理本篇生词窗口。每context真实视频播放→两自然时间样本→暂停→关闭；其后AI解释窗口正常打开/Escape/焦点，整理窗口正常打开/Escape/焦点。未生成/精简AI、未填真实API key、未加入SRS。R1/R2明确skipped，不用其他窗口抵消。

8环境×3窗口=24组computed/owner/文本/dataset/rect/SVG/滚动尺寸配对，加8组正常关闭/focus配对，共32组，**已采样原始字段差异0**。matched CSS含href、media/layer上下文及匹配声明，供独立审核判获胜来源；没有以日志解析器判旅程。[production-comparisons.json](C:/Users/0/AppData/Local/Temp/readweb-cleanup-normal-contract-20261002-2728e7f0/production-comparisons.json)与[bounded-browser.json](C:/Users/0/AppData/Local/Temp/readweb-cleanup-normal-contract-20261002-2728e7f0/bounded-browser.json)保留每侧原值和动作。

目视读取390px custom-dark前后video、dark AI、custom-dark整理PNG，未见前后新增裁切/遮挡差异；只对应所读图及这些表面。视频浮窗/标题/video/正常按钮rect、controlsVisible=true及样式保存；截图里原生控件可能自动隐藏，没有浏览器内部shadow控件几何/像素，不能声称整个原生控制UI完整覆盖。没有扩大主壳、素材七状态、chunk/glass、file完成旅程或standalone矩阵。

## 源码和响应限制

启动前核对当前Vite插件副作用、runtime优化配置和地址/PID。默认ECDICT未启用；请求服务懒加载，构造期凭据只读不打印值。按明确例外仅一个127.0.0.1:5184 frontend-only Vite，优化root/vite.config.mjs、configLoader runner、cache/log在新Temp，自有PID15252；没有launcher/release/recovery/Host/8776启动，业务请求均在浏览器route，只有本轮source HMR放行。

**源码未完成。** 第一个1280/light context在setup page.goto(networkidle)默认4000ms处超时，source-runner exit1；还未进入标准素材及R3/窗口动作。setup异常前response记录未返回/未drain落盘，没有源码截图、page identity或模块/样式实际body绑定，不用source-ready/plugin名单冒称源码消费者PASS。390/dark未启动，没有重启服务延长等待。该工具等待限制不证明source产品不可达，完整源码及自定义源码/standalone新矩阵继续未测。见[source-browser.json](C:/Users/0/AppData/Local/Temp/readweb-cleanup-normal-contract-20261002-2728e7f0/source-browser.json)、source-browser.log/source-server日志。

生产响应到达即采body，context关闭前drain，实际body文件与headers/request headers单列。A+B成功取得781条：静态414全部与实际固定产物字节匹配，合成业务367，成功媒体Range36条hash均匹配其start/end对应字节，实际latest body单独保存。另20次audio response.body报“No data found for resource with given identifier”，未取得body及完整headers闭环；它们是采集缺口而非确认hash不一致，不能称全部Range已核验，不补造。详见[business-responses.json](C:/Users/0/AppData/Local/Temp/readweb-cleanup-normal-contract-20261002-2728e7f0/business-responses.json)、[observation-totals.json](C:/Users/0/AppData/Local/Temp/readweb-cleanup-normal-contract-20261002-2728e7f0/observation-totals.json)。源码变换输出证据没有完成，保持单列。

18个完成production context pageErrors0，最大startup CLS0.0075789213，均<0.01。console保留外部fonts/CSE阻断ERR_FAILED及正常导入前空generated-index warning，不宣称console全空、真实外部服务成功或源码无错误。

## R4与未关闭项

[p1-applicability.md](C:/Users/0/AppData/Local/Temp/readweb-cleanup-normal-contract-20261002-2728e7f0/p1-applicability.md)逐项包含原CP文字、当前路径/行号、已接受证据、缺口、拟裁决与理由：

1. background:true先commit/推进再保存与真实loading/transition/eligibility/media等待分开；所用legacy本地/内存没有HTTP持续等待边界，建议按实际语义审核，不造延迟接口，不自行N/A。
2. 第二评分键已经新卡，不能证明旧卡双输入；旧卡guard、未揭示新卡guard、准确单次计数分别说明，focused/static不替真实防重。
3. 当前selector默认启用V2，存在实际共享控件与ledger/attempt消费者，legacy实写/空事件数组不能排除V2；建议审核必要代表状态，不自动加第三平台矩阵。
4. 首卡准备→自动播放→自然结束→稳定是不同时间条件；下一卡已接受稳定不能替首卡，旧不同阶段差值继续保留，提出最小同步观测而本轮不评分重跑。

执行者没有判PASS/N/A、删除未关闭项或修改原CP含义。[remaining-items.md](C:/Users/0/AppData/Local/Temp/readweb-cleanup-normal-contract-20261002-2728e7f0/remaining-items.md)继续逐列：R1/R2及深/custom窗口未测、P1真实防重/过渡等待/V2/首卡稳定、剩余代表设置、完整源码必要状态、自定义源码/standalone、跨路径CSS裁决、历史FAIL与全部正式NOT_RUN、此次源工具/响应采集限制。

原file标准backdrop-filter和素材文本变量加载次序差异继续继承，既有production前后保持、尚无新增确认清理P2；本轮没改CSS/前缀/Vite或build，也没有源码新证据把跨路径差异改为一致。CP01–CP06、六项闭合、116组旧production/独立16组及P1已接受计数/推进/关闭/下一卡稳定按其原范围继承，不能升级全应用统一、历史C04/C06或日常替换。

## 命令、进程和结束

正式focused/build/verify:vite/verify:production-preview/npm test均本轮NOT_RUN；无漂移focused PASS仅继承。历史production health404 FAIL、YouTube行为FAIL/归因未知、六项runner exit1、原CommonJS失败、A图覆盖/旧API未采body等限制不追改。本轮A/B runner exit0只表示有限收口，source-runner exit1保留。[command-status.md](C:/Users/0/AppData/Local/Temp/readweb-cleanup-normal-contract-20261002-2728e7f0/command-status.md)。

A静态端口4105/PID25272、B端口见processes-B.json/PID5524均finally关闭，进程已结束。source通过source.stop/server.close记录关闭listener，但Node仍存活；核对PID15252确为本轮绝对source-server.mjs后仅停止此自有进程，原始source-process-release.json保存。开场私有5184/PID12748保留，结束loopback5184和8776无listener，未处理未知进程。[processes.json](C:/Users/0/AppData/Local/Temp/readweb-cleanup-normal-contract-20261002-2728e7f0/processes.json)、process-check.json和closing-listeners.json供核对。

支持脚本最大172行（复制browser-base原168行），没有超过约500或复制基线两倍，没有拆分/minify绕过或构造通用owner/日志旅程判定平台。snapshot复制工具的handoffExisted元字段仍指旧contract-readiness交接，此误指已单列；opening.files与verify-opening明确本新交接开场不存在，收口以逐文件列表为准，不借元字段判变更。

产品只读，无产品回滚需要；原文件hash、tracked binary diff及固定资产作为保护核对依据，不reset/clean覆盖dirty。本交接后停止；只等待独立只读审核决定子项、R4适用性和后续最小范围，不创建审核任务或代理，不自动下一施工。
