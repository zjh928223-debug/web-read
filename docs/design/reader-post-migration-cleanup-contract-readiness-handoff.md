# 迁移后清理：有限契约准备与对照交接

日期：2026-10-02（Asia/Shanghai）。执行依据：[contract-readiness-plan](reader-post-migration-cleanup-contract-readiness-plan.md)。本轮已停止，等待用户安排独立只读审核。

**本轮：P1两个入口准备通过，有限计数/推进/关闭对照有证据；P2–P4准备不足后停止。原清理、完整外观/操作保持及CP07–CP10仍NOT_VERIFIED。** CP01–CP06、六项最小清理及其已验收影响范围继续继承独立PASS；未追加清理或改产品，不自行宣布全部CP通过。

## 身份与保护

已读AGENTS、原cleanup plan/review、cleanup/six-candidates/remaining-matrix交接、remaining-matrix计划、review-loop教训及[最新独立剩余矩阵报告](C:/Users/0/AppData/Local/Temp/readweb-cleanup-remaining-independent-review-20261002-01a0f7c7/remaining-matrix-review-report.md)。已接受的production116组+独立16组、chunk/editor、素材七状态、file预习完成/等待池、匹配前置链返回/Tab保持继续保留；旧不同链Tab差异不重新认定为产品缺陷。

新证据根：[readweb-cleanup-contract-readiness-20261002-6982ec5a](C:/Users/0/AppData/Local/Temp/readweb-cleanup-contract-readiness-20261002-6982ec5a)。[契约图](C:/Users/0/AppData/Local/Temp/readweb-cleanup-contract-readiness-20261002-6982ec5a/contract-map.md)、[完整未关闭项](C:/Users/0/AppData/Local/Temp/readweb-cleanup-contract-readiness-20261002-6982ec5a/remaining-items.md)、[命令状态](C:/Users/0/AppData/Local/Temp/readweb-cleanup-contract-readiness-20261002-6982ec5a/command-status.md)、[进程](C:/Users/0/AppData/Local/Temp/readweb-cleanup-contract-readiness-20261002-6982ec5a/processes.json)。

HEAD 153f9464356c9f59020f4f35ede713a807c798d3，branch codex/read-web-optimization。开场1201个tracked/untracked文件；after构建输入1197逐文件一致。opening/closing identity、status、tracked binary diff、untracked清单及全产物manifest均在新Temp；最终实际变更核对见[workspace-changes.json](C:/Users/0/AppData/Local/Temp/readweb-cleanup-contract-readiness-20261002-6982ec5a/workspace-changes.json)。只有本交接允许新增，其他dirty和WhisperX/语言处理工作保留。

| 固定产物 | 目录 | index.html SHA-256 | srs-review.html SHA-256 |
| --- | --- | --- | --- |
| before | C:/Users/0/AppData/Local/Temp/readweb-post-migration-cleanup-20261001-212901-b1592d93/before-dist | F2B3EFDE67C96572CFAF4367F082825F94042BDD269C52FB680A9555D5DB7FF6 | CEC9807FBE94F129D89FB9593A89745FE916CA69125A33C6BEDE0977FD00DB71 |
| after | C:/Users/0/AppData/Local/Temp/readweb-cleanup-six-candidates-20261002-01a0fb48/after-dist | 6E9C35A6A8A94243D658FF2EB48C628624E759C0369C58F83CB8D36DABC1992E | 283557907E66B446AD5E0A0D83C25A084E7419987ADA6079FF415E5E075BB88E |

两目录各29文件均核对，不以HTML替代资产，不用repair2-after替代before；本轮无build。合成素材及新增正常checksum词库恢复行、轻量标注输入与纯函数候选见[fixture-identity.json](C:/Users/0/AppData/Local/Temp/readweb-cleanup-contract-readiness-20261002-6982ec5a/fixture-identity.json)。纯模块仅Temp复制原字节并使用Temp type:module；首次CommonJS直接加载失败保留，纯数据成功不等于窗口动作通过。

## A关口与实际覆盖

Chromium145.0.7632.6、DPR1、light；新context，SW block，导航前业务路由/WS阻断，同字体/外部阻断。**A5context、B8production、source2context，共15**；没有补满矩阵。A原始数组/状态/错误：[readiness.json](C:/Users/0/AppData/Local/Temp/readweb-cleanup-contract-readiness-20261002-6982ec5a/readiness.json)。

| 包 | A实际结果 | 下游覆盖与未关闭 |
| --- | --- | --- |
| P1 reader | PASS：正常IndexedDB checksum恢复后产品“今日复习”；同一files row日志[]→旧synthetic-word-0一条唯一log、revision1→2，下一卡another。legacy增量1，V2增量0；从未对selector调用getReviewLogs或再次选源 | before/after×1280/390×light四context；另一个current-source1280context。单条旧卡评分、推进、真实返回及两Tab有记录；双输入防重/持续保存等待仍NOT_VERIFIED，不能由legacy替V2 |
| P1 standalone | PASS：一次限定#srs-review-app root vnode的SrsReviewPage.props.service只读定位，验证standalone/legacy类型；同一in-memory JSHandle公开查询[]→旧卡一条唯一log、下一卡another，无HTTP评分 | 同上四production+一个source；真实返回index.html及两Tab有记录。没有新建服务、改props或抓任意父级；无持续HTTP等待边界 |
| P2 | NOT_VERIFIED：合法纯函数候选synthetic/final有记录；loader已经写正常bundle，工具错误guard将它视为不应存在，在扫描点击前停止 | 未做B/source；本轮没有文章窗口/候选/取消/Escape证据。不是扫描产品回归，需先读现行bundle准备契约，不覆盖正常bundle；file页面成功不替代 |
| P3 | NOT_VERIFIED：隐藏file input设置后等不到marked索引；静态核对该change绑定依赖importButton&&importInput，但现行DOM refs没有importButton | 所选路线不是有绑定的正常用户入口；loader latest.result.items虽进入import/save/index链，实际目标/occurrence/span正向闭环仍不足。未点击bubble、未出现meaning/位置/关闭，不做B/source，不补按钮或私塞map |
| P4 | NOT_VERIFIED：合成12sMP4可解码（probably/readyState4/error=null），记录video/浮窗rect；正常最小化→展开→title reveal、Tab至VIDEO/native controls后实际Space | play/playing/timeupdate/pause都time0，两样本相隔612ms仍paused=true；未继续暂停/正常关闭、不做B/source。全局Space/active-media链是待查线索，不宣称新产品缺陷，不换坐标/编码再试 |

P2/P3准备选择失误明确保留，不能包装成产品FAIL或通过准备。五个A context用完即收口；三个不足包各一次当前尝试，没有自动第二/第三轮。

## P1有限对照及限制

[bounded-browser.json](C:/Users/0/AppData/Local/Temp/readweb-cleanup-contract-readiness-20261002-6982ec5a/bounded-browser.json)每侧从本侧基数观测0→1、唯一旧word_id记录、新卡与短暂pending/disabled DOM过渡。reader真实返回后BODY→Tab BODY→Tab theme-toggle；standalone实际导航index.html后BODY→Tab theme-toggle→Tab SUMMARY“过时入口”。两个入口各两宽前后链一致，[四组关闭/focus配对](C:/Users/0/AppData/Local/Temp/readweb-cleanup-contract-readiness-20261002-6982ec5a/production-comparisons.json)无字段差异，不要求不存在的新焦点目标。

**旧卡快速双输入防重仍NOT_VERIFIED。** production观察器处于document capture，晚于产品window capture，记录到两次按键时DOM均已another；不能据此判首键发出前已是新卡。source导航前早期window capture明确第一键synthetic、第二键another（间隔10.9ms/10.3ms），新卡未揭示且无第二评分。不能将“旧卡只一条”冒称两个输入均命中旧卡。没有制造pending/暂停线程/调用评分方法，也未做新卡揭示后的独立正常评分。

background:true先commit/推进后排队保存，standalone内存与reader本地IndexedDB没有现行外部HTTP延迟边界。持续保存等待由独立审核裁决，本轮不判N/A/PASS，也不改后台语义。

production12组、144元素采样保留computed/matched/context/owner/disabled/文本/SVG/rect及PNG。**8个原始差值**均为P1-next两个播放按钮opacity，matched包含transition-all，但采样不足以证明opacity稳定收敛，未归一化或重跑掩盖。其余采样字段一致，不能因此宣布整体视觉PASS。source对最终production6组有10字段差值：4opacity及standalone首卡6个准备/播放状态字段，完整源码状态比较未关闭。原始差值：[source-comparisons.json](C:/Users/0/AppData/Local/Temp/readweb-cleanup-contract-readiness-20261002-6982ec5a/source-comparisons.json)。无before-source动态配对。

工具限制：A P1截图名未包含phase，被本轮B after1280同名截图覆盖；readiness.json的A原始states/数组/事件保留。现有P1 production PNG明确归B、P4-controls归A、source PNG独立，不补造A截图。业务API合成fulfilled，但本轮没有逐条保存其实际响应body/Range headers；不能称所有业务响应hash核验，合成媒体字节及实际decoder/events另有记录。

## 源码环境、响应与收口

经本方案明确frontend-only例外，当前优化root/vite.config.mjs/runtime.optimization.json、configLoader runner、cache/log在新Temp，127.0.0.1:5184自有PID29332。启动前检查地址/PID及当前插件：请求服务懒加载、ECDICT默认disabled；构造中只读凭据查询不打印值。业务API导航前由context返回合成契约，未到达真实handler；仅source HMR放行。没有launcher/Host/release/recovery、8776或真实业务数据启动。source仅A已通过的P1路径，原始[source-browser.json](C:/Users/0/AppData/Local/Temp/readweb-cleanup-contract-readiness-20261002-6982ec5a/source-browser.json)。

响应到达立即采body，关闭context前drain。A生产153条、B生产336条全部body与对应固定产物文件匹配；source786条是Vite变换输出，其中778条有原文件绑定、8条虚拟/查询模块不强造原文件。两种hash语义分开，bodyErrors0、pageErrors0。15context启动CLS均<0.01，最大0.0075789213。console error共42条原样保留，外部fonts/CSE阻断记录与ERR_FAILED相符；不以通用文本无据逐条归因或称console全空。[observation-totals.json](C:/Users/0/AppData/Local/Temp/readweb-cleanup-contract-readiness-20261002-6982ec5a/observation-totals.json)只索引原观察，不推断旅程。

自有源码通过source.stop正常关闭，source-closed.json记录PID29332；A静态服务12980/PID10728、B10461及1842/PID36552均finally释放，进程已结束。开场私有5184/PID12748两地址保留、loopback5184与8776无listener，不停任何已有服务。子进程finally恢复其环境变量；父环境未改。

正式focused/build/npm test/verify:vite/verify:production-preview均本轮NOT_RUN；既有focused PASS仅继承。历史production-preview/YouTube FAIL、六项runner exit1、上轮失败与NOT_RUN不追改；本轮runner exit0只表示收口，不替独立审判。

产品/测试/配置/依赖/旧文档/旧Temp/两产物只读，未提交/promotion，未创建任务/聊天/代理/worktree。只新Temp与本交接可写，无产品回滚需求，不reset/clean。逐文件收口核对以workspace-changes.json为准。

未关闭项逐条在remaining-items.md：P1旧卡防重/V2/持续保存等待/稳定准备状态，P2文章窗口，P3真实bubble，P4自然视频，深/custom保留窗口，剩余代表设置，完整源码必要状态，继承的两处跨路径CSS裁决，全部历史FAIL/NOT_RUN与本轮证据限制。保留最新独立结论中file标准backdrop-filter和素材文本变量加载差异，既有production前后保持，不自行改为一致/新增P2。

后续最小工作是另行安排正常bundle与loader restore命中契约、native/global Space链，以及P1未完成的防重/保存/稳定状态裁决。本轮不自动修复或扩大矩阵；交接后停止，等待独立只读审核。
