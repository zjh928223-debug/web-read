# 迁移后清理 F1–F6 最终施工交接

日期：2026-10-02（Asia/Shanghai）。执行依据：[一次施工方案](E:/read-web-next-optimization/docs/design/reader-post-migration-cleanup-final-pass-plan.md)。

**执行侧全部完成，等待一次独立只读终审。** F1–F6及CP07–CP10适用剩余项的执行自查缺口为0，原清理与当前外观/操作保持已满足本轮执行自查；这不是独立审核PASS。CP01–CP06继承最新独立已接受结论并核对本轮无相关漂移。停止施工，独立最终结论由用户安排的只读审核给出。

本轮证据根：`C:/Users/0/AppData/Local/Temp/readweb-cleanup-final-pass-20261002-45739c67`。下列链接均指本轮新Temp，旧交接/旧Temp/旧产物未覆盖。

## 1. 实际修复与开场dirty

开场HEAD `153f9464356c9f59020f4f35ede713a807c798d3`，branch `codex/read-web-optimization`；[opening身份](C:/Users/0/AppData/Local/Temp/readweb-cleanup-final-pass-20261002-45739c67/opening-identity.json)有1205个tracked/untracked路径项，status、HEAD binary diff、untracked清单同时冻结。没有要求clean tree，没有提交、worktree、聊天/代理、promotion，也没有修改、构建或启动日常/历史树。

唯一产品修复：[vocabulary-preview-module.js:1216](E:/read-web-next-optimization/src/composables/vocabulary-preview-module.js:1216)在创建扫描requestId前先刷新正常loader发布的当前identity。原顺序在首次扫描建立token后才刷新身份，令自己的请求被取消；原cleanup before与开场production同样存在。新增四行含注释，保留正常bundle/词库/dictionary调用、取消校验和同身份inFlight复用，不增加调试接口。

测试仅五文件：

- [vocabulary-preview-ui-check.cjs](E:/read-web-next-optimization/scripts/vocabulary-preview-ui-check.cjs:124)：正常身份先变、未预刷新，实际扫描非空候选并开dialog；原双击一次lookup/同Promise/disabled断言保留。增加有意义的首次扫描回归覆盖。
- [srs-review-check.cjs](E:/read-web-next-optimization/scripts/srs-review-check.cjs:201)：过时ghost/sm、28px旧皮肤、icon-lg/旧rgba/11px断言改为当前default/icon、36px共享配方、14px/currentColor及自然换行的正向断言，保留行为断言和退役皮肤反向检查。开场FAIL日志与修后PASS分别保留。
- [read-web-load-check.cjs](E:/read-web-next-optimization/scripts/read-web-load-check.cjs:6)、[read-web-playback-check.cjs](E:/read-web-next-optimization/scripts/read-web-playback-check.cjs:6)、[read-web-interactions-check.cjs](E:/read-web-next-optimization/scripts/read-web-interactions-check.cjs:6)：最小可选fixture/Temp输出参数，默认行为和原断言不变，使正式命令绑定本轮正常源码/最终产物。

产品F2–F5、CSS、主题、媒体链、SRS算法、IndexedDB schema和入口顺序未改。原WhisperX/语言处理dirty保留。本轮差异按开场字节生成，不能用整个HEAD diff代替：[fixes.md](C:/Users/0/AppData/Local/Temp/readweb-cleanup-final-pass-20261002-45739c67/fixes.md)、[六文件身份](C:/Users/0/AppData/Local/Temp/readweb-cleanup-final-pass-20261002-45739c67/this-run-modifications.json)、[仅本轮产品/测试patch](C:/Users/0/AppData/Local/Temp/readweb-cleanup-final-pass-20261002-45739c67/this-run-product-tests.patch)。

## 2. F1–F6结果

原始入口、业务请求、属性/几何/SVG、matched规则、媒体/DOM事件、关闭/焦点和截图索引集中于 [browser-results.json](C:/Users/0/AppData/Local/Temp/readweb-cleanup-final-pass-20261002-45739c67/browser-results.json)，与browser-results-final.json字节相同。48个有效合并场景、137项动作全部成立；数量saving另补4场景，CSS专项另补8场景。原main和旧custom输入样本、诊断失败另存，不冒充最终有效场景；不按数量替代对象验收。

| 工作项 | 执行自查结果及实际边界 |
| --- | --- |
| F1 | before/最终after/当前source，1280/390×light/dark/custom-light/custom-dark：经素材库“打开”和正常latest恢复非空bundle，真实扫描出未标注Final候选；取消、重开、Escape正常，焦点回预习生词按钮，generated未删空。修后after/source首次点击成功。before/opening首次取消原值保留，真实第二次正常点击仅取其可达窗口作外观对照，不造假before节点。390窗口x15、width360、height722、关闭可达，保持固定浅色。 |
| F2 | 上述24场景实际点击当前可见ChunkModeView Synthetic；global词0、scope、sourceSentence、transcript occurrence/range0–0对应正常恢复条目，显示指定合成释义，正常隐藏释义关闭；390 bubble x12/width368在视口内，正文/后续入口仍可操作。没有隐藏transcript/input路径、force、私塞Map或直接show。 |
| F3 | 原before/最终after 390 dark/custom-dark及source1280 light、390 dark/custom-dark：实际活动元素VIDEO、12秒、error=null；真实点main-app-area DIV离开VIDEO，统一Space先等自然time>0，再取650ms两样本；暂停、再次播放550ms自然推进、关闭，audio暂停。本轮7场景均有timeupdate，无原生鼠标替代、无写currentTime/play/activeKind或autoplay豁免。本次未复现旧time0；旧独立失败与其原因未定原样保留，不断言CSS导致或追改旧FAIL。 |
| F4 | before/after/source×reader legacy、standalone legacy、实际reader V2×两宽，共18学习场景：同一synthetic首卡自然准备DOM、自动播放、1秒自然ended/source加载完后450ms稳定采样；playing/stable阶段全部对应playing/ended。实际评分自然transition disabled、synthetic→another一次，下一未揭示卡按3不额外接受/推进。reader legacy本地唯一log；standalone现行内存唯一log/计数继承，补其可见过渡。V2正常selector实际选源，receipt0→1/event1、learning_unit/ledger/attempt对应、cursor1、schedule更新；after/source两宽正常未来重访资格等待，四评分禁用、按3无DB写回。 |
| F5 | reader两宽数量20→1保存/重开保持，输入2取消不误保存；另4场景捕获真实保存中input/取消/保存disabled，无注入等待。两入口SRS录键Escape不播放、Q保存实际播放/重开保持、恢复R。正常预习页Q保存使用、录键Escape保原值且不播放、中文switch开/关显隐、恢复Space/正常关闭；最小批次完成1词、等待池1词和返回可达。 |
| F6 | 当前source与最终production各16必要场景，两入口各两宽；source reader四主题两宽顺带真实AI解释/整理开窗、Escape和焦点。合法fixture绑定正式verify:vite、verify:production-preview实际exit0；相关focused、最终Temp build和资产/源码身份核对完成。没有用standalone造V2或用某入口抵另一入口。 |

视频例：final390/dark `0.010030→0.625719s`，重播`1.152000→1.652273s`；final390/custom-dark `0.012596→0.626453s`，source390/dark `0.016767→0.639922s`。动作均自然，完整原值见 [evidence-summary.json](C:/Users/0/AppData/Local/Temp/readweb-cleanup-final-pass-20261002-45739c67/evidence-summary.json) 与原media/inputs记录。原辅助path标签写BODY，实际focus/事件为DIV，按真实原值说明。

代表图：[390 custom-dark真实bubble](C:/Users/0/AppData/Local/Temp/readweb-cleanup-final-pass-20261002-45739c67/fivecolor-final-reader-after-reader-390-custom-dark-R2-bubble.png)、[reader首卡自然结束稳定](C:/Users/0/AppData/Local/Temp/readweb-cleanup-final-pass-20261002-45739c67/matrix-legacy-after-reader-390-dark-F4-stable.png)、[standalone源码首卡稳定](C:/Users/0/AppData/Local/Temp/readweb-cleanup-final-pass-20261002-45739c67/matrix-legacy-source-standalone-390-light-F4-stable.png)、[预习快捷键与中文switch](C:/Users/0/AppData/Local/Temp/readweb-cleanup-final-pass-20261002-45739c67/matrix-legacy-after-reader-390-dark-F5-preview-shortcuts.png)、[完成与等待池](C:/Users/0/AppData/Local/Temp/readweb-cleanup-final-pass-20261002-45739c67/matrix-legacy-after-reader-390-dark-F5-preview-complete.png)。完整阶段/继承映射见 [coverage.md](C:/Users/0/AppData/Local/Temp/readweb-cleanup-final-pass-20261002-45739c67/coverage.md)。

## 3. R4、同阶段比较和CSS例外

落实最新 [独立R4裁决](C:/Users/0/AppData/Local/Temp/readweb-cleanup-normal-independent-review-20261002-67bfa871/r4-applicability-verdict.md)：HTTP全过程禁用全部评分、两次真实输入必须同一旧卡均退出附加硬门槛；background:true不改。实际loading/transition/eligibility/媒体等待、正常防重、首卡和V2已补，未用flush/延迟/改service制造保存等待。standalone直接创建内存legacy、无V2 selector，V2只测真实reader消费者。

[comparisons.json](C:/Users/0/AppData/Local/Temp/readweb-cleanup-final-pass-20261002-45739c67/comparisons.json)：56个before→finalproduction同阶段状态配对差值0；58个source→final配对保留30条原始差值。约1px几何舍入阈值、媒体时间/随机id/捕获时间只用于动作；没有抹掉业务阶段差异。F4-preparing PNG已进入playing，准备证据来自自然DOM连续记录；首卡稳定均自然ended且source完成，当前同阶段首卡样式配对无差值，旧6/2差值不追改。

按方案11.1登记既有跨路径例外，而非本轮新增失败：

- file：原before/opening/final production相关规则只有webkit前缀，Chromium标准computed none；source标准blur(8px) saturate(1.15)。同族bubble/video本轮实际也记录22条标准滤镜差值，原before已存在对应前缀声明，生产前后保持，逐项列出。
- 素材文字：source styles.css→workflow-ui.css，工作流--pru-shell-text映射到rw-ui-foreground；production learning-ui→reader CSS，映射到text-main。before/opening/final light均rgb(28,30,33)、dark均rgb(224,224,224)，source分别oklch(0.145 0 0)/oklch(0.985 0 0)。两侧各自可读，无本轮新增颜色/遮挡/入口退化。
- 其余8条为6个无背景图透明background shorthand `0px 0px`/`0% 0%`等效序列化，和2条真实资格倒计时约分钟随执行时间减少。状态/禁用/几何按实际阶段成立，不强等时间。

最终CSS两资产与opening逐字节相同。没有全局!important、重排样式或审美重设；五色custom旧夹具只改背景留下黑字的不足已通过正常原生颜色控件纠正、补测12场景，旧样本另存，产品主题不改。证据：[css-exceptions.md](C:/Users/0/AppData/Local/Temp/readweb-cleanup-final-pass-20261002-45739c67/css-exceptions.md)、[三代资产相关声明](C:/Users/0/AppData/Local/Temp/readweb-cleanup-final-pass-20261002-45739c67/css-asset-evidence.json)、[实际变量与可见file](C:/Users/0/AppData/Local/Temp/readweb-cleanup-final-pass-20261002-45739c67/cascade-results-final.json)。

## 4. 台账、检查、产物和限制

CP01–CP06继承 [最新独立报告](C:/Users/0/AppData/Local/Temp/readweb-cleanup-normal-independent-review-20261002-67bfa871/normal-contract-review-report.md:65) 已接受的无漂移范围；C01–C06各候选去向按其第76–87行与 [六项交接](E:/read-web-next-optimization/docs/design/reader-post-migration-cleanup-six-candidates-handoff.md:18) 保持：原C01=110（删除61/合并11/保留38），C02退役11链，C03=36（删24/保留12），C04=37、C05=6覆盖、C06=6脚本索引；另六项为1 selector+5变量，删除6/保留0/未确定0，与原索引重叠，不重新相加或改历史总数。本轮不新增清理候选；当前chunk/glass/有效custom及专用消费者继承与focused复核。

主壳/素材既测状态、chunk/glass生命周期、file预习旅程、legacy完整计数/Tab/关闭/下一卡，以及AI解释/整理32组production对照按方案继承。实际受影响的scan首次动作已在source/final两宽四主题重测；本轮补完整source窗口消费者和两入口学习首卡/设置，不能把继承说成全部重跑。

必需9项focused及相关vocabulary-preview-ui、annotation-bubble、youtube-workflow-panel、srs-review-ui-v2均exit0；srs-review过时断言初次exit1，同步后实际exit0；git diff --check为0。正式verify:vite实际0（source load/playback/interactions报告ok=true）；verify:production-preview实际0（final load报告ok=true），没有称生产load命令做了全部行为。详见 [command-status.md](C:/Users/0/AppData/Local/Temp/readweb-cleanup-final-pass-20261002-45739c67/command-status.md) 和 [formal命令绑定](C:/Users/0/AppData/Local/Temp/readweb-cleanup-final-pass-20261002-45739c67/formal-commands.json)。

最终仅一次 `npm run build -- --outDir 本轮Temp/after-dist`，exit0、856 modules、29文件，SQLite/outDir warning保留。[build.log](C:/Users/0/AppData/Local/Temp/readweb-cleanup-final-pass-20261002-45739c67/build.log)、[完整manifest](C:/Users/0/AppData/Local/Temp/readweb-cleanup-final-pass-20261002-45739c67/after-dist-manifest.json)、[build输入身份](C:/Users/0/AppData/Local/Temp/readweb-cleanup-final-pass-20261002-45739c67/build-input-identity.json)、[源码绑定](C:/Users/0/AppData/Local/Temp/readweb-cleanup-final-pass-20261002-45739c67/final-source-binding.json)：1205输入路径与收口前源码字节相同；其后仅规定交接文档修改，不影响产物。

| 产物 | 原before | opening production | 本轮final production |
| --- | --- | --- | --- |
| index.html SHA-256 | F2B3EFDE67C96572CFAF4367F082825F94042BDD269C52FB680A9555D5DB7FF6 | 6E9C35A6A8A94243D658FF2EB48C628624E759C0369C58F83CB8D36DABC1992E | 37EB586408CB644572BAB1919BC177FCADD4AB563A3AF1B5E5C5C6D217696FBB |
| srs-review.html SHA-256 | CEC9807FBE94F129D89FB9593A89745FE916CA69125A33C6BEDE0977FD00DB71 | 283557907E66B446AD5E0A0D83C25A084E7419987ADA6079FF415E5E075BB88E | 283557907E66B446AD5E0A0D83C25A084E7419987ADA6079FF415E5E075BB88E |

实际HTTP production响应含body/file hash matches，source转换响应含当前原文件hash/转换body hash；关键素材/latest和成功MP4 Range有原body/headers/fixtureMatches。全新context内合法IndexedDB或sample正常消费者，SeekPlayerDB仍v1/files/id，不注入卡/service/Map/pending/currentTime；当前fixture选择正常本地owner路径，不称真实Windows Host成功。详见 [fixture-contract.md](C:/Users/0/AppData/Local/Temp/readweb-cleanup-final-pass-20261002-45739c67/fixture-contract.md)。

最终有效main及补测场景最大启动CLS `0.0075789213<0.01`，main pageErrors=0。外部fonts/CSE阻断ERR_FAILED、初始空generated-index警告保留，未称console全空。main的66条response.body采集失败记录原样保留；关键响应/自然播放与采集缺口分开，不要求每条Range补body或写验真平台，旧20条audio缺口不追改。

历史状态完整保留：production health404 FAIL、YouTube行为FAIL/归因未知、六候选runner exit1、旧CommonJS/4s networkidle源码失败、A图覆盖/旧API body限制、09DD产物身份原因NOT_VERIFIED及各旧轮正式NOT_RUN。本轮新formal PASS只指合法合成fixture边界，不能追改历史或证明真实health。npm test/verify:full、YouTube behavior命令本轮NOT_RUN；live TTS/WhisperX/AI、真实Host/跨机持久化、全应用统一、原范围之外历史C04/C06及日常替换仍未测/独立状态。

## 5. 释放、回滚和停止点

source为frontend-only当前优化root、当前vite.config、configLoader runner、Temp缓存，loopback5184；正常HMR，未启动8776真实后端。所有本轮静态预览/browser完成后关闭；source.close完成后按确切node命令身份释放残余进程。核对无自有进程或监听，原tailscaled PID12748的私有5184监听保留；没有停未知服务。证据：[释放前](C:/Users/0/AppData/Local/Temp/readweb-cleanup-final-pass-20261002-45739c67/processes-before-release.json)、[释放后](C:/Users/0/AppData/Local/Temp/readweb-cleanup-final-pass-20261002-45739c67/processes-after-release.json)、各runner closed及source-closed.json。

收口只新增此交接和给旧cleanup-handoff末尾追加当前索引，旧正文逐字节前缀保持。最终 [workspace-changes.json](C:/Users/0/AppData/Local/Temp/readweb-cleanup-final-pass-20261002-45739c67/workspace-changes.json) 核对6产品/测试文件+旧索引文档7处变更、1新交接、其余1198开场路径项不变、无移除、HEAD/branch和旧两套29资产不变；最终manifest收尾与build后字节相同。

六文件原字节在本轮opening-source对应相对路径，旧cleanup-handoff原字节另有同目录副本。本轮product/tests patch反向 `git apply --reverse --check` 已通过，仅核对未执行。若以后明确安排回退，只按该patch和原副本逐文件人工对照/回退本轮增量，并保留后续工作；不要git reset/restore/clean整棵dirty树。最终包括文档的增量patch及closing状态也落同Temp。

本轮产品修复完成、必要操作证据完成、原清理执行自查完成；最终独立验收、全应用统一及日常发布各自分开。没有连续两次同问题修复/复测失败后开启自动第三修复。交接至此，停止运行和修改，等待一次独立只读终审，不自行创建审核任务/代理。
