# 迁移后清理：正常恢复契约、视频路径与剩余适用性裁决方案

日期：2026-10-02（Asia/Shanghai）。状态：已发布施工方案，尚未执行。

本轮由用户明确重新安排范围。只修正 Temp 准备工具的已知错误、补正常消费者证据并形成裁决材料；产品保持只读，不自动开启第三轮产品修复。

## 1. 起点与交付目标

依据 [原固定审核标准](reader-post-migration-cleanup-review.md)、[上轮施工交接](reader-post-migration-cleanup-contract-readiness-handoff.md)及最新独立报告：

`C:/Users/0/AppData/Local/Temp/readweb-cleanup-contract-independent-review-20261002-721ebd0b/contract-readiness-review-report.md`。

原清理和完整外观/操作保持仍NOT_VERIFIED；CP01–CP06保持PASS，CP07–CP10未关闭。候选未确定0，无新增确认清理P0–P2。本轮不追加清理候选。

继承P1两入口单次准确评分、推进、双宽关闭/Tab及下一卡稳定样式；不重复这些动作凑覆盖。本轮工作包如下：

| 包 | 实施内容 | 原标准映射 |
| --- | --- | --- |
| R1 / P2 | 读取正常loader已生成的bundle，实际扫描出文章候选窗口并关闭 | CP07–CP09 |
| R2 / P3 | 正常latest恢复响应形成真实scope/target/occurrence/span命中，打开bubble | CP03、CP07–CP09 |
| R3 / P4 | 区分VIDEO原生键盘与阅读器统一播放路径，真实播放合成视频 | CP03、CP07–CP09 |
| R4 / P1 | 首卡准备、防重、等待和V2未测项的适用性裁决材料；不重试旧两键动作 | CP08–CP09 |

R1–R3准备成功后，只对这些消费者及已经可正常打开的AI解释/整理词窗口补受影响主题对照；不重跑主壳、素材七状态、chunk/glass生命周期、file预习完成等已闭合矩阵。R4只形成解释与建议，不由执行者改判CP或把未测改成PASS/N/A。

## 2. 文件与运行授权

唯一允许新增的仓库文件：`docs/design/reader-post-migration-cleanup-normal-contract-handoff.md`。所有脚本、夹具、缓存、截图、事件与日志写一个新Temp根 `readweb-cleanup-normal-contract-<日期>-<随机串>`。

产品、测试、配置、依赖、已有文档、旧Temp证据与产物全部只读；不build、不提交、不promotion，不创建聊天/任务/代理/worktree。不改CSS、键盘、标注导入、评分服务、导出接口、DB schema或持久化键；不碰日常/历史树，保留全部dirty及WhisperX/语言处理工作。

隔离浏览器使用新context、SW block、导航前业务路由和WS阻断；未知请求阻断。合成输入只经正常产品请求/恢复链进入新context，SeekPlayerDB v1/files/id保持。不用真实profile/数据/AI/TTS/下载/后台，不直调业务写方法，不强设gate、mark/index、pending或currentTime，不改props/service/事件返回值。

production只读固定Temp产物，静态服务按项目browser-port-policy选择安全端口；所有服务均须有明确自有PID和finally释放。不得停止已有服务。

**源码前端例外：** 用户按本方案安排执行时，仅为本轮源码补证，允许一个127.0.0.1:5184 frontend-only Vite，当前优化root/vite.config.mjs/config/runtime.optimization.json，configLoader runner，cache/log写本轮Temp。沿用上一方案明确的有限launcher例外，不经会处理release/recovery/业务目录和后端的launcher，不启动8776/Host。先核查插件副作用与地址/PID；不能安全只读启动或loopback冲突则停止源码项，不改端口/配置、不移除插件、不接管未知进程。只放行本轮HMR，其余WS阻断。

## 3. S0：冻结身份和读取实际消费者

先读AGENTS、原cleanup plan/review/handoff、six-candidates-handoff、contract-readiness-plan/handoff、最新独立报告和review-loop-and-evidence-validation-lessons。

记录HEAD/branch/status、tracked binary diff、tracked/untracked逐文件SHA-256；核对上轮执行1201原文件及最新独立1202文件基线。开场dirty不是本轮diff，不要求clean tree。

固定产物：

| 项 | 原before | 最终after |
| --- | --- | --- |
| 目录 | C:/Users/0/AppData/Local/Temp/readweb-post-migration-cleanup-20261001-212901-b1592d93/before-dist | C:/Users/0/AppData/Local/Temp/readweb-cleanup-six-candidates-20261002-01a0fb48/after-dist |
| index SHA-256 | F2B3EFDE67C96572CFAF4367F082825F94042BDD269C52FB680A9555D5DB7FF6 | 6E9C35A6A8A94243D658FF2EB48C628624E759C0369C58F83CB8D36DABC1992E |
| SRS HTML SHA-256 | CEC9807FBE94F129D89FB9593A89745FE916CA69125A33C6BEDE0977FD00DB71 | 283557907E66B446AD5E0A0D83C25A084E7419987ADA6079FF415E5E075BB88E |

核对两目录全部资产、after1197构建输入绑定，不以HTML代替全资产，不用repair2-after替before。漂移即停，不build。

复用上轮正常标准素材、12s视频/WAV、词库checksum及路由，仅复制必要文件到新Temp。先静态读取以下实际文件，再写脚本：

- `src/composables/youtube-workflow-loader.js`的restoreAnnotationBackfillResult/loadJobIntoReader，以及当前client请求契约。
- `src/services/annotation/storage.js`、result-store.js、click-resolver.js、target-source.js。
- `src/composables/session-annotation-lightweight-io.js`、import-normalization、bundle-merge、marks、generated-index及annotation-bubble-resolver。
- `src/composables/vocabulary-preview-module.js`的loadCurrentAnnotationBundle/performPreviewScan和当前正文Vue渲染链。
- `src/components/VideoPlayerFloat.vue`、`src/composables/media-source-module.js`、keyboard-module及当前视频偏好入口。

不要再根据历史文件名猜路径或根据隐藏input存在猜绑定。产出contract-map.md，先列现行链和准备假设，再以实际结果收口。

## 4. A：两项准备关口

准备阶段最多两个after-production的1280×800/light新context：A1共用R1/R2正常标注恢复，A2视频路径。每包仍独立判定；一个成功不能掩盖另一个不足。

### A1：现有bundle → 文章扫描 / 标注命中

1. 在导航前返回合法最小latest响应，保持正常session/transcript/chunk/media字节及revision/integrity。当前loader取得payload.result或payload后，要求result.items非空，并经现有importManualLightweightAnnotations以replaceExisting:false导入。只补合法响应字段，不直接调用importer。
2. 针对合成正文一个词准备targetId、markedText、sourceSentence、boundary、meaning和唯一范围。encoded ID当前规则是sourceType-sentenceId-globalStart-globalEnd；`transcript-0-0-0`仅在实际source、句编号和范围一致时适用，不能见字符串可解析就判命中。其occurrenceKey为对应sourceType::sentenceId::g:start-end，必须与正常导入后实际条目吻合。
3. 通过素材库“打开”走loader。其restore会catch失败并返回skipped/unavailable，因此正文加载成功并不等于标注恢复成功。记录latest请求/响应、实际scope、正常bundle.generated/status、导入后的条目和索引可读结果。
4. **删除新Temp工具中“bundle必须不存在”的误假设。** 正常loader已有annotation.bundle.v2是应读取的产物；不得覆盖为人为empty bundle、伪造fallback或只删除guard后跳过内容核对。优先调用现有storage.loadBundle(scope)只读查询；没有可用公开入口则按现行storage schema只读解析，不猜键结构。
5. 若正常bundle或条目缺失，停在第一处具体失败，记录import normalize/merge/index哪段未成立。不得改产品、隐藏错误或从Map/DOM补命中。第二次尝试仅允许纠正一个已证明的Temp响应字段/身份错误，并使用重新计账的准备context；它占用第8节替换预算。

**R1实际动作：** 用现行按钮点击文章“预习生词”。需要至少一个合法候选；已标注词可能被扫描过滤，可使用同篇另一个未标注词，不要求已标注词同时成为候选。保存候选来源、窗口及获胜声明；实际取消、重开、Escape、焦点。只显示/关闭窗口，不提交AI、不填真实API key。file预习页不替代文章窗口。

**R2实际动作：** 通过正常正文/chunk控制切到要观察的Vue表面；隐藏兼容容器不算消费者。记录可见span文本/dataset/globalIndex和bundle条目的范围/occurrence/scope一致，等待现行索引完成，再按当前真实词点击链打开bubble。必须出现所准备的meaning，保存位置/边界及正常关闭。不得再setInputFiles到未绑定的hidden input，不调用show/setAnnotation、私塞markedMap或修改renderer。

允许的只读诊断仅为当前scope、storage.loadBundle、result-store既有getItems/queryByOccurrence等查询和可见DOM；它们不能代替最终正常点击。不得调用会刷新/重建索引或写存储的方法来补齐状态。

关口分别判：R1候选窗口与关闭真实成功；R2真实命中/meaning/关闭成功。任一不足只停止对应下游，原始正常bundle保留。

### A2：统一媒体与原生video分开

1. 复用已经确认可解码的12s MP4，不重新编码或换浏览器。记录实际Range请求的start/end、响应status/content-range/content-type及字节hash；媒体事件按audio/video元素分别记录。
2. 读current media-source-module：初始videoPreferred默认false，activeKind默认audio；不能以“浮窗可见”推出当前统一播放目标是video。通过现有产品视频偏好/正常素材设置确认选择，**只读**getState/getActiveMediaElement核对实际目标；不调用setVideoPreferred/switchTo/loadJobMedia制造状态。
3. 旧失败是焦点在VIDEO时Space后立即time0 play/pause。本轮先把VIDEO原生键盘路径和document统一快捷键分开，记录focus、keydown/keyup target/code/defaultPrevented、实际活动元素及两媒体事件；只安装观测监听，不stopPropagation/preventDefault、猴子补丁或修改播放方法。
4. **首选新路径：** 经真实鼠标点击阅读器非交互空白/正文区域使焦点离开VIDEO，确认不在学习页、输入框或任何按键录制状态，再用产品现有Space统一播放。必须先确认activeKind及活动HTML元素确为video。此路径是正常阅读器操作，不把Space仍落在VIDEO的旧路径再算一次成功尝试。
5. 若统一目标无法通过现有入口自然成为video，停止该路径；可选唯一替代为真实原生播放按钮鼠标点击。先用title/现行操作reveal控件，保存实际video/浮窗rect与截图，据实际控件位置点击，或只读工具支持的原生控件几何；禁止固定“高度减20”猜点、force click、脚本click/dispatch、直接play()或写currentTime。
6. 自然播放后取至少两个相隔500ms的video时间样本，paused=false且时间增大，实际暂停并正常关闭/最小化。另记audio是否被停止，不把audio timeupdate替video。媒体metadata、controls=true、time0的play/playing都不算通过。

最多两个有依据的正常路径尝试；第二次不允许只是重按Space。仍失败就保存具体链/截图/事件，停止R3下游，不自行修快捷键或继续换坐标/编码。

## 5. B：只扩已准备消费者的必要主题对照

只有R1/R2/R3各自A通过才进入其B动作。采用共用reader场景，最多16个production context：before/after × 1280×800/390×844 × light/dark/custom-light/custom-dark。通过当前正常主题入口设置；保持同字体、browser version、zoom、DPR1、输入、前置链与稳定时机。

每个context只做以下适用子项，未准备者明确skipped/NOT_VERIFIED：

| 对象 | 固定操作和证据 |
| --- | --- |
| 文章预习词窗口 | 正常扫描、候选行、取消/Escape、焦点；当前Teleport/owner/文本/控件/rect/computed/matched与截图 |
| bubble | 正常恢复命中、meaning/边界/关闭；不能用badge或节点presence代替 |
| video | 已准备的正常播放/暂停/关闭，真实自然时间；浮窗/标题/原生保留区几何与颜色 |
| 既有AI解释/整理词窗口 | 复用已成功的浅色正常触发契约，只补这些现有表面适用主题的打开/关闭与focus；不生成/精简AI、不执行加入SRS |

不重复主壳/素材七状态/chunk/glass/file完成旅程。标准素材打开只是必要前置，不重新宣称它们本轮全部验收。

前后动作顺序一致，各窗口关闭后再开下一对象，保持正常bundle与scope；不要一侧失败/reload、另一侧跳过后比较焦点。约1px几何舍入可以解释，文字换行、裁切、遮挡、语义或次序变化不能豁免。

生产对照完成后，源码最多两个reader context：1280/light、390/dark，只走A通过的包及上述已有可达窗口。源码产物/模块/样式绑定与生产response hash分开记录；没做custom源码或standalone新矩阵就保留未测，不能冒称两入口全覆盖。源码启动边界按第2节。

## 6. R4：P1剩余项只形成裁决材料

读取现行SrsReviewPage、useSrsReview、srs-review-flow、source selector和已有focused证据，不跑旧卡两键动作，不新建服务/注入延迟/调用flushPendingSaves改变时机。

提交 `p1-applicability.md`，逐项写原CP文字、实际消费路径、已接受证据、缺证据、拟裁决及理由：

1. 原CP要求的禁用/等待对应哪些真实页面过渡；background:true先commit/推进再保存与HTTP持续disabled分开。没有该外部边界就建议按实际语义审核，不能要求实现新的延迟接口。
2. 顺序两个评分键中第二键已是新卡，为什么不证明旧卡双输入；当前真实旧卡保护、未揭示新卡保护和已接受单次计数分别说明。不要把静态guard当完整真实防重旅程，也不要再以两键间隔更短重试。
3. V2路径是否属于清理影响的必要状态及依据；legacy实写不能代替V2。不得自动增加第三套学习平台矩阵，也不得用“事件数组为空”排除现行V2消费者。
4. 首卡音频准备→播放→稳定的时间条件，以及旧采样把不同准备阶段配对的问题；下一卡稳定已接受不能替首卡。提出后续所需最小观测，不在本轮原样重跑评分旅程。

这些是给独立审核的具体裁决申请；执行者不自行删除未关闭项或改变原CP含义。若仍需要真实操作，记录最小缺口，等待审核/用户另定范围。

## 7. CSS、设置与正式命令保持单列

原file标准backdrop-filter与素材文本变量加载次序差异继续继承：已有production前后保持，尚无确认清理新增P2。本轮不改CSS/vendor前缀/入口/Vite，不build，不归一化观测掩盖差异。源码比较出现差异原样记录，归因按当前消费者/获胜声明，不能以dev/prod字符串不同直接判全局FAIL。

剩余代表设置、完整源码必要状态及未做的主题/入口继续列在remaining-items.md。不靠本轮窗口通过抵消它们。

本轮正式focused/build/verify:vite/verify:production-preview/npm test均NOT_RUN；无漂移focused PASS只继承。历史FAIL/NOT_RUN不追改，Temp runner exit0仅表示收口。当前必要项非零时原清理及CP07–CP10仍NOT_VERIFIED。

## 8. 预算、证据与停止

总预算最多22个context：2准备 + 16production主题对照 + 2源码 + 2有依据的准备替换。替换用于A阶段，不能拿去增加B/source矩阵；每包准备最多两次有依据的尝试。准备成功后的既定主题采样不算失败重试；B出现失败就停止该包剩余场景，不在B修改夹具续跑。前置不成立则缩减下游，不要求凑满上限。

每次截图名包含stage/build/entry/viewport/theme/object/state，保证A/B不会同名覆盖。响应到达即采body并在context关闭前drain；业务latest和Range的实际响应单列采集，不能只留夹具文件hash后称响应已核验。缺失如实记NOT_VERIFIED，不补造。

最低交付：opening/closing逐文件与产物manifest、contract-map、bundle/target/span只读观测、fixture身份及正常响应、readiness/bounded-browser原始记录、截图/computed/matched/媒体事件/焦点、p1-applicability、remaining-items、command-status、processes、workspace-changes，以及唯一新交接。

身份漂移、真实请求穿透、超范围写入或需处理未知进程即停止相关工作。单包两次失败停止依赖项，不自动第三次；旧失败必须有本方案规定的具体新准备依据才试。发现映射CP或具体P0–P2，保留证据，不修产品。

单个支持脚本约500行以上或超过复制基线两倍即停止扩写、说明范围，不拆碎/minify绕过；不创建通用owner模拟器或日志旅程判定平台。最终释放自有服务，原文件逐一核对不变，允许仅新交接新增；不reset/clean。

完成有限交接后停止，由独立只读审核决定子项和R4适用性；不保证本轮就关闭原任务，不自动安排下一施工。

## 9. 直接发给执行模型

> 请按 E:/read-web-next-optimization/docs/design/reader-post-migration-cleanup-normal-contract-plan.md 执行一次有限施工。先冻结dirty/固定产物；R1读取正常loader已有bundle并实际扫描，R2只经正常latest恢复到可见Vue词的真实命中，R3先核对活动媒体再用焦点离开VIDEO的正常统一播放路径，必要时仅一次有依据的原生鼠标路径；不再走隐藏未绑定input、覆写empty bundle或重按VIDEO上的Space。各包A通过才执行B，按共用reader场景补相关消费者主题，遵守22context与两次失败上限。R4只出P1适用性裁决材料，不重试旧两键/注入保存等待，不自行判N/A/PASS。只写新Temp和规定新交接；产品/测试/旧文档/产物只读，不build、提交、promotion、创建任务/代理/worktree。源码仅按明确frontend-only例外且准备后运行。保留全部未测、历史FAIL和正式命令NOT_RUN，释放自有服务并核对原文件，交接后停止等待独立审核。
