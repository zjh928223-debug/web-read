# 迁移后清理：剩余问题一次施工与最终验收方案

日期：2026-10-02。状态：已发布，尚未施工。
目标：施工模型在同一轮完成现有剩余项的诊断、必要修复、源码与生产验证，再一次性交接给独立审核。下列顺序是同一轮内部工作顺序，不需要逐步征求确认、逐步交接或重新安排对话。

## 1. 本轮做什么，以及已经接受什么

原迁移后清理和完整外观/操作保持仍 NOT_VERIFIED，CP01–CP06 已接受，CP07–CP10 未关闭。当前没有新增确认清理 P0–P2，清理候选未确定为0。

本轮将上轮“产品只读、只提交裁决材料”的范围，调整为：**补完实际操作；纠正已知测试准备错误；如果定位到相关产品缺陷，在同一轮做最小修复、相关检查和复测。** 不再只提交“准备不足，下一轮再做”的报告。普通实现选择、夹具修正和下表内的最小修复均在本轮内处理，不重新询问许可。

| 工作项 | 需要完成的结果 | 对应原标准 |
| --- | --- | --- |
| F1 文章预习词窗口 | 正常素材/标注恢复后，真实扫描出候选；取消、重开、Escape、焦点和窄屏显示正常 | CP03、CP07–CP09 |
| F2 标注 bubble | 正常恢复的标注命中实际可见词，显示预定释义，位置/边界/正常关闭保持 | CP03、CP07–CP09 |
| F3 视频 | 解决390 dark after“paused=false但时间0”的未复现；正常统一播放、自然推进、暂停、关闭均成立 | CP07–CP09 |
| F4 学习状态 | 首卡准备/自动播放/自然结束后的同阶段对照；实际过渡禁用和V2正常代表消费者成立 | CP07–CP09 |
| F5 剩余设置 | 预习数量、快捷键设置/录键取消/恢复、中文switch及必要完成/等待状态齐全 | CP07–CP09 |
| F6 源码/生产与收口 | 当前源码和最终Temp生产的必要两入口覆盖齐全，解释已有跨路径CSS差异，输出完整交接 | CP06、CP09–CP10 |

已经接受的C01–C06、六项删除、主壳、素材既测状态、chunk/glass生命周期、file预习既测旅程、legacy单次评分/推进/关闭/Tab、下一卡稳定样式等，按没有相关改动的范围继承。**不为增加样本数量重做全部既有矩阵。** 如果本轮实际修改影响了其中某项，则只补受影响的代表状态。

不新增清理候选，不重新设计页面，不扩大SRS算法、真实外部服务或全应用统一。

## 2. R4裁决已经确定，直接执行

读取最新独立裁决：

C:/Users/0/AppData/Local/Temp/readweb-cleanup-normal-independent-review-20261002-67bfa871/r4-applicability-verdict.md

本轮不得再把以下两项列为独立必过条件：

- HTTP保存全过程禁用所有评分：当前页面采用background:true，先接受/推进再后台保存，这个附加要求不适用。
- 两次真实评分输入必须都命中同一旧卡：这不是唯一合法验法，不再缩短两键间隔反复凑同卡证据。

仍然要确认实际loading/transition/eligibility/媒体等待与禁用一致，正常操作不多评分，V2正常消费者和首卡状态保持。旧记录保持原来的未测口径，不追改成PASS；新的必要清单只列适用条件。

standalone当前 src/srs-review-main.js 直接创建内存legacy service，没有V2 selector。**V2只验实际存在的reader消费者；不向standalone硬塞V2、不新增第三种学习平台。** 两入口的现有共享外观/首卡/设置合同仍按实际消费者覆盖。

## 3. 文件范围与一次施工的权限

唯一实现目录：E:/read-web-next-optimization。保留开场已有dirty和WhisperX/语言处理工作。日常版、历史树不修改，不promotion，不提交，不创建聊天/代理/worktree。SeekPlayerDB的v1/files/id结构不改。

本轮允许：

- 修改新Temp中的fixture、路由、浏览器等待/采样及操作脚本。
- 修改下表相关产品文件中的已确认缺陷，以及它们直接依赖的当前模块。文件表是定位范围，不是遇到相邻真正依赖就必须停下来问的白名单；新增实际修改文件在交接中说明原因。
- 同步被实际修复影响的现有focused/browser检查；确实存在产品回归时增加一个有意义的回归检查。
- 一次收口后构建最终Temp生产产物；后续若因已确认问题又修改了产品，重新生成最终产物并重测受影响项，保持证据与最终字节一致。
- 新增 docs/design/reader-post-migration-cleanup-final-pass-handoff.md。更新原cleanup-handoff末尾的当前状态索引和最新交接链接；保留历史执行记录，不整篇改写历史结论。
- 启动本轮测试用源码前端和Temp静态预览；不涉及正式发布。

| 对象 | 先读/可能修复的文件 |
| --- | --- |
| F1扫描/恢复 | src/composables/vocabulary-preview-module.js；src/composables/youtube-workflow-loader.js；src/services/annotation/storage.js、result-store.js；现行vocabulary preview service及dictionary enrichment适配器 |
| F2真实点击 | src/components/TranscriptContainer.vue、ChunkModeView.vue；src/composables/transcript-interactions.js、chunk-interactions.js、annotation-bubble-resolver.js、annotation-bubble.js；src/services/annotation/target-source.js、click-resolver.js；现行session annotation导入/索引模块 |
| F3媒体 | src/components/VideoPlayerFloat.vue；src/composables/media-source-module.js、keyboard-module.js及实际播放调用链 |
| F4学习 | src/features/srs-review/SrsReviewPage.vue、useSrsReview.js、srs-review-flow.js、srs-review-ui-service.js、srs-review-source-selector.js；src/services/vocabulary当前owner/repository/ledger/attempt接口 |
| F5设置 | src/features/passage-preview/PassagePreviewPage.vue、PassagePreviewSettingsDialog.vue、passage-preview-shortcuts.js；SrsReviewPage现有录键/设置表面 |
| 样式/加载 | styles.css、src/styles/workflow-ui.css、src/features/srs-review/srs-review.css、src/features/passage-preview/passage-preview.css及对应现行样式入口 |
| 检查 | 原cleanup必需focused脚本，以及上述对象已有的focused/browser脚本 |

保持按钮入口、顺序、布局、36px共享配方、固定浅色学习窗口和专用控件语义。不要借修复恢复退役界面，新增业务逻辑到reader-runtime.js/session-init.js，或重做评分/调度算法。

保留最少的运行约束即可：用新的浏览器上下文和合成素材/学习数据，写本轮Temp；只停自己启动的服务。不增加审批表、复杂日志验真器、固定context预算、A/B准备审批或每项单独交接。

## 4. 起点、现有证据和产物

先读：

1. AGENTS.md，原cleanup plan/review。
2. reader-post-migration-cleanup-normal-contract-handoff.md。
3. 最新独立 normal-contract-review-report.md 和 r4-applicability-verdict.md：
   C:/Users/0/AppData/Local/Temp/readweb-cleanup-normal-independent-review-20261002-67bfa871/
4. 六项删除的交接；其他历史交接只按具体未关闭项定位，不重新全量翻查所有轮次。

新Temp根命名 readweb-cleanup-final-pass-<日期>-<随机串>。保存开场git status/diff、HEAD、原dirty记录；对实际拟修改文件保留原字节副本。可以复用已有snapshot工具，不另写一套身份平台。计划发布时已有1204原文件；本方案新增后数量会增加，施工以实际开场列表为准，不硬编码旧数量。

固定比较基线：

| 用途 | 路径 |
| --- | --- |
| 原cleanup before | C:/Users/0/AppData/Local/Temp/readweb-post-migration-cleanup-20261001-212901-b1592d93/before-dist |
| 本轮开场生产/修复前 | C:/Users/0/AppData/Local/Temp/readweb-cleanup-six-candidates-20261002-01a0fb48/after-dist |
| 最新执行夹具/路由参考 | C:/Users/0/AppData/Local/Temp/readweb-cleanup-normal-contract-20261002-2728e7f0 |
| 最新独立事件/媒体原值 | C:/Users/0/AppData/Local/Temp/readweb-cleanup-normal-independent-review-20261002-67bfa871 |
| 本轮最终产物 | 本新Temp/after-dist |

前两目录各29资产，已独立确认。before index SHA-256：
F2B3EFDE67C96572CFAF4367F082825F94042BDD269C52FB680A9555D5DB7FF6。
开场after index：
6E9C35A6A8A94243D658FF2EB48C628624E759C0369C58F83CB8D36DABC1992E。

继承未改资产的manifest，核对实际使用的目录与入口；新最终产物保存自己的完整manifest和本轮源码身份。旧产物/旧Temp不覆盖。新模块数、资产数不强制仍为856/29，报告实际值。

比较时区分“原cleanup before → 最终after”和“本轮开场 → 本轮修复后”。实际缺陷修复带来的行为变化单列原因，不能当成随意换设计；其余外观/操作保持。若before同一路径本来失败，保留真实失败和本轮修复依据，不制造假before节点。

## 5. 先把测试方法修正，在同一轮完成诊断和修复

这部分是前面几轮反复补证的主要原因。不要复制旧脚本后仅去掉失败断言。

### 5.1 导航和等待

- 源码导航用domcontentloaded或load，超时30秒；随后等待data-vue-mounted及所需页面/控件就绪。HMR/轮询页不以networkidle作为业务可用条件。
- 某个异步窗口没有在4秒内出现，不立刻跳过整个包。查看它还在请求、加载、扫描、身份变更还是已经报错；按对应任务状态继续等待，单项一般最多30秒。
- 超时必须记录第一处未成立的业务条件。区分测试等待方法错误、夹具契约错误和产品错误，分别修正。
- 异常时在关闭context前保存已有页面身份、截图、事件和已完成响应。不要再次因setup抛异常而把全部源码证据丢失。
- 每个对象都有独立结果。一个对象失败不阻止其余对象本轮继续完成，不在runner里设置“此对象一次不足后所有后续场景永久跳过”的总开关。

### 5.2 夹具与正常数据源

复用12秒MP4、可解码WAV、正常素材session/revision/integrity、字幕/chunk和合法词库checksum；避免重新编码或重造素材。

逐一核对本轮真正用到的业务请求契约。尤其核对 vocabulary owner/repository、预习扫描、settings和V2数据读取。旧base的业务路由没覆盖到的请求会abort，可能使扫描/选源无法完成；增加其**当前合法响应**，不要一律返回200空对象，也不要把正常数据请求的阻断算产品故障。

当前reader如果用Windows owner integration，就在测试侧提供它实际读取的repository/记录/写回合同；如果实际用本地IndexedDB，则按现行存储封装预置合成记录。两种路径选当前真实消费者，不为了方便替换页面service、关闭V2开关或强行回退legacy。

允许在新context导航前准备合法合成数据库行/响应，包括checksum与revision；这是测试输入。页面启动后经正常loader/selector取得数据。不得直接给组件塞卡、Map、pending、activeKind或currentTime来冒充真实操作。

截图和属性采样按对象的**当前业务阶段**进行。媒体时间、随机id和capture时间戳只用于动作核对，不作为外观前后全等字段。

### 5.3 采样方法

为关键对象保存computed/rect/SVG、文本/owner/disabled、匹配到的相关声明及截图。比较的是获胜样式和用户可见结果，不要求全部CSS文本、URL或对象序列化全等。

采样至少区分加载、播放中、稳定等阶段。截图前后确认卡身份/阶段未变；转场中抓到不同阶段的两侧不能直接判样式回归，也不能把差值抹掉后宣称一致。

约1px舍入、字体抗锯齿可以说明；新增换行、裁切、遮挡、入口/顺序改变必须处理。首屏继续记录CLS和运行错误，不增加新的性能指标。

## 6. F1：文章预习词窗口一次做完

现行 performPreviewScan 的真实顺序是：

loadCurrentAnnotationBundle → buildPreviewScan/vocabularyService → dictionary enrichment（若启用）→ requestId/currentIdentity核对 → previewDialog.open。

操作要求：

1. 通过素材库“打开”导入正常latest响应；只读取得实际scope、bundle、generated/status和当前source identity。已有bundle是正常结果，不覆盖为空。
2. 已标注Synthetic可以用于bubble；扫描候选使用同篇另一个未标注、未进入词库的有效词。先确保素材/词库输入确实能生成候选。
3. 真实点击“预习生词”。若没有窗口，沿上述顺序确定到底卡在哪一步：请求被路由漏掉、词库读取未完成、候选为空、dictionary未返回，还是requestId/identity因正常加载被取消。
4. 测试输入错误就修fixture；确认为正常用户也遇到的产品异常，再修对应模块的最小逻辑。可以在诊断时短暂加观测，完成后去掉临时调试，不留下新的全局调试接口。
5. 正常出现“当前文章预习”及至少一个真实候选后，执行取消、重开、Escape。保存焦点返回、窄屏滚动/关闭可达和固定浅色窗口。
6. 同一context里已有bundle与标注不应被扫描/取消动作意外删空。按正常生成数据的实际语义核对；不要求任何合法业务写入都绝对为0。

不提交AI生成、不要求真实AI成功。此包必须真实打开窗口，纯函数候选和按钮enabled不算完成。

## 7. F2：可见词到bubble一次做完

不要预设导入后一定显示transcript。当前已确认标准素材先显示ChunkModeView。

优先直接验当前可见chunk中的对应词：

- 读取它的data-word-index、globalIndex/句或chunk身份、实际文本。
- 将正常恢复后的条目scope/sourceSentence/occurrence/range与当前可见词的真实resolver规则对齐。导入器生成的manual前缀或canonical id按实际规则理解，不强要求原请求targetId原样保留。
- 如果确实必须看transcript，则通过已有可见切换入口；入口在折叠区时先真实展开summary再点当前控制。不要再对隐藏#toggle-chunk-btn直接点，不用force。
- 若chunk与transcript本来共享global词索引，由现有resolver走正常转换，不因源类型不同临时改Map制造命中。
- 真实点击词，bubble必须显示预定释义；核对可见位置、窗口边界、专用控件及关闭/Escape中实际支持的方式。关闭后记录焦点与正文仍可操作。
- 如果点击尚不满足正常开启条件（例如现行显示释义/高亮模式），通过现有按钮进入相应模式，记录正常操作。

夹具修好仍存在正常消费者命中错误时，修source/occurrence转换或resolver的具体问题；不用恢复退役导入按钮或新增第二套标注链。

## 8. F3：390视频未推进的归因、修复与完整动作

先读取最新独立失败case：390/dark/after，焦点main-app-area，Space已经preventDefault，activeKind=video，VIDEO readyState4/error=null/paused=false，但两样本time0，仅play/playing，无timeupdate。

本轮方法：

1. 正常素材打开并确认实际活动元素是VIDEO；记录video/audio的src、duration、readyState、error和各自事件。
2. 真实点阅读器空白使焦点离开VIDEO和输入/录键区域；走现有统一Space。
3. **先等待自然currentTime>0或实际timeupdate，再取两个相隔至少500ms的样本。** 等待自然启动最长10秒；不在按键后固定600ms就直接判失败，也不以paused=false或playing事件单独判成功。
4. 若10秒仍不推进，检查已发生的重复play/pause、当前活动媒体是否换掉、媒体Range/解码错误、reader加载是否重置src/seek、实际播放Promise和当前媒体初始化时机。使用原值定位，不先归罪CSS。
5. 如果只是旧测试太早取样，本轮用完整自然启动证据解释，产品不改。若有正常加载/播放竞争或快捷键实际冲突，修具体调用链并加相应有意义的回归检查。
6. 在同一轮按正常产品动作完成暂停、再次播放、自然推进、关闭；另核对audio确实暂停。不得用video.play()/写currentTime、浏览器自动播放豁免参数或修改activeKind代替。
7. 如需要区分统一键盘与原生控件，只增加一个有依据的真实原生鼠标对照。按实际可见控件/截图定位，不反复换坐标求成功。原生对照用于归因，不能把统一路径尚坏写成通过。

已有1280/light/custom-light结果继承；至少补390/dark和custom-dark前后正常操作。矩阵中相同video合成字节和相同操作用一套方法。

## 9. F4：首卡、实际等待/防重和V2

### 9.1 两入口首卡状态

reader经“今日复习”进入实际legacy代表；standalone经srs-review.html和合法sample响应进入其现行内存legacy。

导航/打开前安装只读媒体与可见DOM观察。按同一首卡身份分阶段：

- 自然准备：pronunciation/source加载、播放按钮可用/禁用的实际状态；
- 自然自动播放：实际音频时间推进、播放中的按钮/提示；
- 自然结束后稳定：source加载完成，媒体已自然结束/停止，按钮不再处于播放phase或opacity过渡。

准备阶段若很短，可用自然DOM/事件的连续记录说明，代表截图取可观察阶段；不人为加长HTTP/TTS延迟，不要求每个瞬时状态都有完整PNG。

稳定采样不要只等“250ms连续三次”然后又让自动播放晚到。先确认实际媒体与source条件，再连续观察稳定，在同一阶段取属性/截图。旧reader首卡6/2字段差异据此逐项解释或修复，不用下一卡已通过结果代替。

用合成发音/例句媒体，不做真实TTS验收。不重复已通过legacy完整评分计数/推进/Tab旅程。

### 9.2 实际过渡和正常防重复语义

沿用当前background:true。观察真实点击评分时按钮与卡身份的自然过渡，核对接受一次、推进一次，下一未揭示卡正常快速输入不再评分。

已有legacy唯一log和准确计数可继承；只补尚缺的实际transition/disabled观察。可用提前安装的DOM观察记录短暂disabled，不为拍图制造长保存等待。

不再安排“两个输入都必须属于同一旧卡”的实验。不调用flushPendingSaves，不暂停业务使旧卡滞留。新正常快速输入检查不为第二次输入换卡而判整包失败；按真实当前卡语义判断。

### 9.3 一个正常V2代表消费者

reader正常selector在V2有卡时选V2。读取现行srs-review-ui-service、owner/repository、ledger和attempt格式，复用既有合法fixture的schema和现有构造/归一化逻辑制作输入。

准备至少一个可接受的V2卡，及为显示推进/完成所需的最少后继数据。通过产品“今日复习”进入，确认实际选源确为V2，不注入service或关闭flag。

记录以下对应：

- 当前word/learning_unit_id、ledger_item_id及实际资格；
- 正常显示答案、一次评分接受、正常推进或实际完成状态；
- 实际数据源中唯一attempt_id及其对应learning_unit/ledger/action；记录接受前后计数；
- 页面真实loading/transition/eligibility提示和共享播放/评分控件。

若正常fixture触发现行资格不可评分状态，用正常数据条件观察该状态和禁用；不要人为设currentEligible=false。与正常可评分卡各取一个代表即可，不扩为所有重访/所有策略组合。

在本轮合成数据源内验证记录写回即可，不声称真实Host/跨机持久化成功。standalone没有V2消费，不再补假V2矩阵。

## 10. F5：把尚缺设置一起补完

同一轮复用实际学习页面，覆盖剩余代表，不完整重跑file预习：

| 表面 | 固定动作与结果 |
| --- | --- |
| reader“预习设置” | 正常读取当前数量，输入一个合法不同值并保存；重开确认新值；另输入未保存值后取消/Escape，重开确认未误保存。保存期间按实际saving状态观察禁用 |
| 预习页快捷键设置 | 经现有预习入口及真实数据进入；打开设置，录一个合法代表键，保存并验证生效/重开保持；再开始录键后Escape取消，保留原值且不触发正文播放 |
| SRS快捷键设置 | 两入口现行录键表面，至少各一个录键开始/Escape取消；保存/恢复逻辑与已接受同族证据结合，实际变更的代表键验证生效 |
| 预习中文switch | 真实开启/关闭，中文显隐对应；检查font:inherit、原生尺寸与390可达；不将它改成通用button |
| 预习状态 | 合法最小批次正常到达完成/等待池代表状态，关闭/返回正常；用现行合成仓库/句子/翻译请求，不重新测试完整外部取句/AI服务 |

数量上下限从当前组件/常量读取，不硬编码过期范围。设置请求fixture要支持正常读取/保存与重开返回已保存值，不能每次固定返回batchSize20。

原完成/等待状态若已有无漂移独立证据，直接标明继承的具体状态，只补缺的那一个。长文本自然换行、padding/gap、36px配方和固定浅色取代表，不逐按钮重复采样。

## 11. 源码/生产矩阵合并执行，覆盖而不凑数量

先完成上述工具纠正、诊断和必要修复，跑相关focused，再生成最终after-dist。然后用同一组操作函数完成下表；本轮不设22context之类的数量门槛，按表复用场景。

| 对象组 | 最终生产对照 | 当前源码 |
| --- | --- | --- |
| F1文章预习窗口、F2 bubble | 原before/最终after，1280/390 × light/dark/custom-light/custom-dark；相同正常素材和输入 | reader同样两宽四主题，确认真实窗口/meaning/关闭及固定浅色/边界；共享动作复用 |
| F3 video | 重点补390 dark/custom-dark前后；1280既有通过部分未改则继承。若改了共用播放链，补1280 light代表 | reader1280 light、390 dark/custom-dark正常播放/暂停/关闭 |
| AI解释/整理窗口 | 四主题两宽已有32组原始对照可继承；若改共享dialog/CSS，只补受影响主题/状态 | 在上述reader源码场景中顺带真实打开/Escape/focus，不生成AI或加入SRS |
| legacy首卡/实际transition | reader及standalone各1280/390；reader用light/dark代表，学习表面仍固定浅色 | 两入口各两宽，按相同首卡阶段取样 |
| V2正常代表 | 仅reader，1280/390，正常V2选源/接受/唯一attempt/推进及必要资格状态 | 同消费者两宽，不为standalone造V2 |
| F5设置/预习状态 | 两宽代表；预习设置随reader，预习页设置随实际预习页，SRS设置随两入口。相同owner/同族不重复四主题全部评分 | 相同表面/两宽代表，与上述学习context合并 |

source/production两入口不能互相代替；固定浅色学习页不机械新增四主题全套评分。未修改且已有完整证据的同族状态按引用继承。

源码前端使用当前优化root和配置。优先本轮frontend-only Vite 127.0.0.1:5184，HMR正常；业务用合成响应，不启动真实业务链。这沿用之前明确的frontend-only测试例外，不执行会改变release/recovery/日常数据的发布操作。

**为避免端口占用再次导致整项NOT_RUN，本方案允许测试专用frontend-only临时端口例外：** 5184若由其他进程占用且不能确认复用的是当前优化源码，按项目browser-port-policy选空闲测试端口，并将READ_WEB_URL指向它。不改runtime.optimization.json、不改日常/手动运行端口、不停止未知进程。生产静态预览也按该policy选端口。正常手动优化运行继续使用既有5184/8776与launcher。

首次源码启动/导航不成功，修本轮启动方式/等待条件后继续这轮必要状态，不把缺源码矩阵再次只交给下一轮。setup收尾无论成功失败都保存证据和关闭自有上下文。

源码启动可复用上轮Temp的source-server.mjs方式：root明确指当前优化目录，configLoader使用runner，cache/log落本轮Temp；根据本次选择的测试端口设置server.port。不要原样复制固定4秒networkidle的source-runner。生产预览明确指定本轮after-dist，不意外读取仓库旧dist。

### 11.1 两个已有跨路径CSS差异，直接作范围判断

- file按钮：原before/开场after生产都只有webkit前缀效果，源码有标准backdrop-filter；已知Chromium中的生产computed为none、源码blur。
- 素材文字：root与workflow同优先级变量映射在源码/生产加载次序不同，已有两生产侧相同。

分别记录实际获胜来源、当前源码/最终生产值、对本轮修改是否有因果影响和用户可见结果：

1. 若仍是既有差异，原cleanup前后各自保持、没有本轮新增视觉/操作退化，登记为**既有跨路径例外**；无需把开发/生产所有字符串统一，也不继续作为来源未定的必过缺口。
2. 若本轮修改确实引入新的错误/不可读/遮挡或所需功能失效，按具体属性修复，再补该消费者。
3. 不为了审美顺手换颜色、全局加!important或重排所有CSS入口。

“既有例外”需要前后资产/规则与实际可见结果支持，但不新增全CSS审计平台。

## 12. 检查、构建和正式命令

这些工作全部在这一次施工内完成，不等下一次授权才build。

原cleanup必需focused集中执行：

~~~powershell
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
~~~

实际涉及F1–F5的已有检查：

~~~powershell
npm run verify:vocabulary-preview-ui
npm run verify:annotation-bubble
npm run verify:youtube-workflow-panel
npm run verify:srs-review
npm run verify:srs-review-ui-v2
~~~

涉及loader、media或其他直接模块的修复，再加对应已有focused；同一个已通过检查不反复跑，最终有新代码变化才重跑受影响项。verify:passage-preview完整聚合不是强制，本轮用必要unit/shortcut和上述隔离真实页面覆盖；不要求live TTS/AI。不要把静态断言当操作验收，也不要为了检查变绿删除有效正向断言。

最终Temp构建示例：

~~~powershell
$finalPassDist = Join-Path $finalPassEvidenceRoot 'after-dist'
$env:VITE_LOCAL_SERVICE_BASE_URL = 'http://127.0.0.1:8776'
npm run build -- --outDir $finalPassDist
~~~

沿用已确认构建模式，临时环境变量在结束恢复；产物落新Temp。不得覆盖旧产物，不因本轮取名final就认为已验收。

正式verify:vite/verify:production-preview优先绑定本轮源码和最终产物实际运行。读取现行scripts/vite-verify.js、production-preview-load-check.cjs及其实际子脚本；需要合成路由时，最小补测试侧fixture入口/输出目录参数，使它们使用同一组合法输入，并保留原断言。无需启动真实后台去满足合成加载检查。

若正式脚本另有超出本轮的Host health或既有无关失败，如实记录该次FAIL/原因；通过本轮明确矩阵逐项覆盖原cleanup必要语义即可，原review允许正式命令NOT_RUN与有效替代矩阵分开。不得把替代运行改名正式PASS，也不得修改产品health去造绿色结果。

绑定URL的实际运行方式如下；sourceUrl和productionUrl取本轮已启动服务地址，临时READ_WEB_URL在结束恢复原值：

~~~powershell
$env:READ_WEB_URL = $finalPassSourceUrl
npm run verify:vite
$env:READ_WEB_URL = $finalPassProductionUrl
npm run verify:production-preview
~~~

完整npm test不是本轮必需；未跑记录NOT_RUN。历史production health404 FAIL、YouTube行为FAIL/归因未知等保留为历史，不要求重建整个应用的验收系统。当前与本轮改动有关的失败则必须处理或明确作为未完成项。

## 13. 证据和最终交接一次写完

新Temp只需少量可读文件，不做另一套“从日志推断旅程真实发生”的程序：

- opening/closing状态、拟改文件原字节、本轮diff。
- fixture/contract说明，必要原始响应、媒体/DOM事件。
- browser-results.json：入口、build/source、宽度/主题、对象/状态、实际操作结果、属性/几何、截图链接和失败原因。
- coverage.md：每项继承何处证据、本轮新增何处证据、剩余适用项；不要保留已排除的两个R4强条件作阻塞。
- command-status.md、最终after-dist manifest/源码身份、实际进程释放结果。
- fixes.md：仅确实修过的缺陷，按问题→原因→修改→复测→是否cleanup新增分类。

response.body取不到而实际媒体已自然播放，记采集限制；不为每一条Range缺body另开施工。关键素材/源文件至少有身份及实际请求记录；已有成功body和headers能核对就核对。20条旧audio采集缺口不追改，不变成额外日志平台任务。

仓库新增 final-pass-handoff.md，一次包含：

1. 原清理及外观/操作保持是否已满足执行自查；最终独立审核仍待进行。
2. F1–F6逐项结果和CP07–CP10适用缺口是否归零；CP01–CP06继承/受影响复测依据。
3. 本轮实际产品/测试改动及与开场dirty的区分，C01–C06与六项已闭合索引。
4. R4适用性裁决如何落实，两个已有CSS差异如何分类。
5. 当前源码/最终生产两入口覆盖，继承与新增范围、命令实际结果、历史状态和采集限制。
6. 最终产物、截图/原值证据、原字节副本及只回退本轮diff的方法。
7. 服务释放、未提交/未promotion/未修改日常版。

产品修复记录、操作完成、原清理验收、全应用统一和日常发布分别陈述。全部适用必要项确已成立时写“执行侧全部完成，等待一次独立只读终审”；仍有必要项缺证据则明确具体剩余，不用“跑完脚本”代替完成。

## 14. 只保留一个停止原则

每个具体问题可在本轮诊断并作有依据的最小修复与复测；两次连续修复/复测仍失败，停止该问题的自动第三次修复，保留原因，同时把其余独立项做完再统一交接。

不再增加准备审批、逐包用户确认、固定context/命令数量或环境“完全洁净”要求。历史dirty保留，个人工具按实际消费者验收。独立审核不再扩规格，只根据原CP、本方案明确适用条件或具体P0–P2裁决。

## 可直接交给施工模型的指令

请按 E:/read-web-next-optimization/docs/design/reader-post-migration-cleanup-final-pass-plan.md 一次执行到统一交接。完成F1文章扫描窗口、F2真实词bubble、F3 390视频自然播放、F4首卡/真实过渡/V2、F5剩余设置及F6当前源码/最终Temp生产必要两入口矩阵。纠正夹具、等待和入口选择；确认产品缺陷时同轮最小修复、相关focused、最终Temp构建和受影响复测，无需逐包征求确认。R4裁决已生效，不再验HTTP全过程disabled或双输入必须同旧卡；V2只覆盖真实reader消费者。源码不用4秒networkidle，视频先等自然时间推进，媒体/首卡按实际阶段比较。复用已通过证据、不新清理候选、不扩全应用设计/外部服务/日志平台。保留原dirty与历史结果，不提交/promotion、不改日常版、不创建任务/代理/worktree。全部独立项做完后一次写final-pass-handoff；真实未完成项如实列明，两次连续失败不自动第三修复，最后等待一次独立只读终审。
