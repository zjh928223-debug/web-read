# 迁移后清理：剩余契约准备与有限对照施工方案

日期：2026-10-02（Asia/Shanghai）。状态：方案已制定，尚未执行。

本方案由用户重新限定下一步范围：先查清四类未通过动作的正常触发和观测契约，再对准备成功的对象做有限对照。不是自动开启第三轮产品修复，也不是原样重跑剩余完整矩阵。

## 1. 起点、目标与完成边界

依据原 [cleanup plan](reader-post-migration-cleanup-plan.md)、[固定 CP01–CP10](reader-post-migration-cleanup-review.md)、[剩余矩阵交接](reader-post-migration-cleanup-remaining-matrix-handoff.md)，以及最新独立报告：

`C:/Users/0/AppData/Local/Temp/readweb-cleanup-remaining-independent-review-20261002-01a0f7c7/remaining-matrix-review-report.md`。

当前原迁移后清理与完整外观/操作保持均为 **NOT_VERIFIED**；CP01–CP06 继承 PASS，CP07–CP10 尚未关闭。六项候选已经闭合，未确定为0；本轮不追加候选。

已接受的 production116组及独立16组属性/几何证据、chunk操作、素材七状态、预习完成/等待池和匹配前置链的返回/Tab保持继续保留。不得将原先不同前置链的 Tab 差异再次当作已确认产品缺陷。

本轮只处理：

| 工作包 | 准备目标 | 原标准映射 |
| --- | --- | --- |
| P1 | reader/standalone 两入口准确的旧卡评分计数、过渡语义和正常关闭链 | CP07–CP09，原 B03 |
| P2 | 当前文章预习词窗口通过正常扫描出现；与 file 预习页区分 | CP07–CP09，原 B05 |
| P3 | 一个真实标注命中经现行消费者显示 bubble | CP03、CP07–CP09，原 B05 |
| P4 | 合成视频经实际原生控件播放/暂停、自然时间推进及正常关闭 | CP03、CP07–CP09，原 B05 |

本轮完成条件是准备结论和有限对照交接完整；不是全部 CP PASS。深色/custom 窗口矩阵、剩余代表设置、完整源码两入口矩阵及跨路径 CSS 裁决保持明确未关闭，不能被本轮浅色结果抵消。后续扩大矩阵只能由用户另行安排。

## 2. 可写文件、运行与保护边界

允许新增：

1. 一个新 Temp 根 `readweb-cleanup-contract-readiness-<日期>-<随机串>`：脚本、合成数据、观测、截图、缓存、日志。
2. 一个新交接 `docs/design/reader-post-migration-cleanup-contract-readiness-handoff.md`。

产品、测试、配置、依赖、旧文档、旧 Temp 证据及 before/after 产物全部只读。不得改 CSS/组件/评分服务/事件/导出接口，不 build，不提交，不 promotion，不创建任务、聊天、代理或 worktree。不碰日常/历史树和真实业务数据，保留全部 dirty、WhisperX/语言处理工作。

新浏览器 context，SW block，导航前安装业务路由及 WebSocket 阻断。合成数据只能进入新 context 的正常恢复链或正常产品请求；SeekPlayerDB v1/files/id 不变。不注入虚假窗口 DOM，不强设 gate、pending、owner、currentTime，不换服务、改 props、拦改函数返回值或打补丁。

production 通过本轮拥有的 Temp 静态服务读取已验收产物，端口遵循项目 browser-port-policy。不得启动真实8776、Host、下载、AI、TTS、词典后台或恢复任务。所有业务请求返回合成契约，未知请求阻断并登记；不以网络通了证明产品动作通过。

**源码前端的有限启动例外：** 用户明确安排“按本方案执行”后，本轮可沿用 previous remaining-matrix-plan 第2节已经明确的 frontend-only 方式，仅启动一个127.0.0.1:5184 Vite、当前优化 root/vite.config.mjs/config/runtime.optimization.json，configLoader runner，cacheDir/log 写本轮 Temp，不经 launcher、不启动后端。此处明确覆盖 AGENTS 的启动器规则，仅为隔离源码补证；默认 launcher 会处理 release/recovery/数据目录和后端，不适用于此只读范围。

启动前检查插件副作用和地址/PID归属。不能安全只读启动、loopback实际冲突或身份不明则停止源码项；不得换源码端口、停已有服务或移除插件。只允许本轮前端 HMR，其余 WebSocket 阻断。子进程环境单独设置并正常释放；未来运行不是本次写方案已经获得的验证结果。

## 3. S0：开场与待办冻结

先读 AGENTS、原 plan/review、cleanup-handoff、six-candidates-handoff、remaining-matrix-plan/handoff、上述最新独立报告及 review-loop-and-evidence-validation-lessons。

1. 记录 HEAD、branch、status、tracked binary diff、tracked/untracked路径和逐文件 SHA-256。区分开场 dirty 与本轮唯一新交接；不要求 clean tree，不以 HEAD 相同代替字节核对。
2. before 固定为 `C:/Users/0/AppData/Local/Temp/readweb-post-migration-cleanup-20261001-212901-b1592d93/before-dist`；after 固定为 `C:/Users/0/AppData/Local/Temp/readweb-cleanup-six-candidates-20261002-01a0fb48/after-dist`。不得用 repair2-after 替代原 before。
3. before index SHA-256 为 `F2B3EFDE67C96572CFAF4367F082825F94042BDD269C52FB680A9555D5DB7FF6`；after 为 `6E9C35A6A8A94243D658FF2EB48C628624E759C0369C58F83CB8D36DABC1992E`。
4. before SRS HTML 为 `CEC9807FBE94F129D89FB9593A89745FE916CA69125A33C6BEDE0977FD00DB71`；after 为 `283557907E66B446AD5E0A0D83C25A084E7419987ADA6079FF415E5E075BB88E`。核对全部资产及 after 构建输入绑定；漂移即停，不新 build。
5. 读取旧 Temp 的 fixture.cjs、browser-base.cjs、a-preview.cjs、a-media-bubble.cjs、a-video.cjs 和实际失败记录。只复制必要部分到新 Temp；旧失败不得覆盖。
6. 建 `contract-map.md`：每包只列“失败点、实际消费链、与旧尝试不同的准备、正常操作、可观察量、关口结论”。计数、空数组、窗口 presence 等必须注明身份和含义，不能只有方法名。

## 4. A关口：先查契约，后做正常入口 smoke

先静态梳理四包，再逐包执行。每包先在当前 after production 的1280×800/light新context准备；最多5个准备context（P1两个入口，其余各一个）。准备尚未成功，禁止进入该包对照；独立包可以继续。

已达到两次失败的旧动作不能直接再试。必须先提供具体的新准备依据，例如取到正确服务的真实空数组、补齐当前 bundle读取响应、确认标注身份一致、确认实际视频控件位置与可解码资源。仅更换脚本文件名、增加 timeout 或换 selector 不构成依据。

### P1：评分观测必须落在实际服务与旧卡身份上

源码入口：`src/srs-review-main.js`、`src/features/srs-review/srs-review-source-selector.js`、`srs-review-ui-service.js`、`useSrsReview.js`、`SrsReviewPage.vue`，以及 vocabulary-repository/learning-events/session-ledger。

已核实的实现区别必须写入契约图：

- standalone 从本地 sample 建 in-memory vocabulary repository/service，走 legacy；没有 HTTP 评分保存请求，也不能用新建服务实例查询原实例评分。
- reader 传入的对象可能是 source selector；它提供 `resolveReviewSource`，不能直接拿它调用 `getReviewLogs`。实际选中 legacy 或 V2 必须有当前运行数据和选源依据。
- legacy 查询 `getReviewLogs`；V2 使用 `getReviewEvents`，事件类型 `review_attempt_recorded`，并绑定 session/item/attempt 或 learning-unit 身份。两者不能混称。
- 当前页面评分传 `background:true`；先 commit/推进再排队保存。不能把后台保存等待当作旧卡按钮持续 disabled，不能延迟一个不存在的 HTTP 请求制造等待。

观测只允许以下有限路线：

1. reader：读取该新context真实使用的 IndexedDB 记录或合成 owner 正常查询响应，使用现有 schema/解码逻辑，明确旧卡 word/item 与事件标识。必须证明读取的是产品评分写入的同一数据源，不是 fixture 初值或另一个 repository。
2. standalone：优先现有公开查询/诊断边界。如果只能通过 Vue 实例读取服务，允许一次有界、只读定位到确切 `SrsReviewPage` 的 `props.service`，验证类型后仅调用其公开 `getReviewLogs`。记录定位和返回数组；不得改 props/ref/computed/flow，不抓任意父级对象，也不把 selector 当服务。此观测是本轮明确的只读检查例外，不是产品新接口。
3. 不调用 reader selector 再选源以获取查询句柄：探测可能激活 pending preview 并改变会话。不得 monkeypatch 查询/保存、重挂载组件或新增生产诊断接口。

在评分前取到数组及基数 N，单次正常评分后取到同一旧卡 N+1，保存唯一记录标识和新卡标识；没有这个闭环就判 NOT_VERIFIED并停该入口。页面按日“几个单词”是聚合历史，不能证明 attempt 防重。

准备成功后才做快速双输入：针对旧卡转换期间发送两次实际评分输入，记录两次输入时刻、旧/新卡身份与自然过渡；旧卡只增加一条，下一卡正常评分另计。不强设 pending、不暂停线程、不调用评分方法代替按键。若第二输入实际落到下一卡，不能误报旧卡重复，也不能冒称覆盖了旧卡防重；保留该限制。

通过实际返回/关闭入口退出，待过渡稳定，记录焦点与两次真实 Tab；standalone若没有 reader shell，按其真实关闭行为记录，不凭空要求跳到不存在的按钮。前后必须相同前置链，不混用某侧失败后 reload。

持续保存等待如果没有现有可延迟边界，只记录源码与运行语义及不可达理由，交独立审核裁决；执行者不得自行改为 N/A/PASS，也不制造持续 disabled。

### P2：文章扫描窗口与 file 预习分开

链路：reader-dom-refs/reader-app-runtime → vocabulary-preview-module 的 `scanPreview/performPreviewScan` → `loadCurrentAnnotationBundle/buildPreviewScan` → previewDialog.open。

当前 `#btn-preview-vocabulary` 确实绑定文章扫描；`.vocabulary-preview-dialog` 是当前文章窗口，`.passage-preview-page` 是不同的 file/学习页面，后者成功不能替代前者。

1. 使用已成功的标准素材 loader，确认 jobId/audioKey 正常得到、按钮自然可用。
2. 列清扫描实际读取的 annotation generation scope、storage/bundle、词库及可选字典。先补正常请求的合法合成响应和对应文章身份，不为扫描捏造 AI 请求；未知请求仍阻断。
3. 在 Temp 单独验证 fixture 能由现有纯数据函数读懂，仅证明输入准备，不算产品窗口通过。保存一个候选的词、位置和来源。
4. 实际点“预习生词”，观察扫描结束、合法候选列表与窗口；失败时保存产品 error/Toast和请求，不只等 selector 超时。不得调用 controller.open/scanPreview 代替入口点击。
5. 正常取消/关闭与 Escape、焦点返回；不点真实 AI 生成，不改 API key。空列表可证明窗口触发，但不能替代所需候选行/专用样式正向证据。

关口：有候选的当前文章窗口自然出现，可关闭，且输入/响应身份吻合。

### P3：bubble 必须准备真实命中

链路：session annotation import/restore 与 generated index → transcript interaction → annotation-bubble-resolver → annotation-bubble API。阅读 resolver 当前 `markedMap/vocabMatchMap` 与 generated scope/target/occurrence 规则。

选择一种当前支持的正常标注导入/恢复路径，使用真实合成正文中的一个词。标注 text/wordIndex/targetId/occurrenceKey 与当前文章 scope 一致，至少有 meaning；不能只加视觉 mark 或硬点固定 `#word-0`。

先通过正常 loader/import 使该词实际被渲染、标注索引就绪；只读观察真实 span 的 dataset/text和标注源身份。再按当前实际单击/快捷键链打开 bubble，不盲用旧脚本的 `b`。不得直接调用 setAnnotation/show 或向 map 私塞命中。

关口：bubble 可见并显示该词的实际 meaning；位置/边界可观察，能正常关闭。badge成功、空 bubble 节点、resolver单测或静态CSS不能替代。

### P4：视频改为观测真正原生控件

链路：正常素材 video resource → VideoPlayerFloat.vue → 原生 video。现行 pointerdown 会启动拖拽并 reveal 控件；`isNativeControlsArea` 按浮窗底部56px判断。因此此前“video元素高度减20”的坐标并不必然落在浮窗原生控制区域，不能原样重试。

1. 读取旧 MP4身份、Range响应和 decoder/media错误；同时记录当前浏览器 `canPlayType` 与真实 metadata/readyState。若MP4解码不支持，可仅在新 Temp用现有本机工具生成受当前浏览器支持的小合成视频；不下载媒体、不改浏览器 flags/产品播放逻辑。
2. 视频通过标准素材打开；记录 video与浮窗各自rect、控件可见状态和截图。用产品现行动作显示 native controls；确认它没有被最小化/裁切/覆盖。
3. 优先真实 Tab/键盘操作可达的原生播放控件；否则据实际截图定位原生播放按钮并正常鼠标点击，记录点击点相对两个rect的位置。禁止固定猜坐标、force click、直接 `.play()` 或设 currentTime。
4. 记录原生 play/playing/timeupdate/pause/error事件和两个相隔至少500ms的自然 currentTime；确认未写 currentTime，time增大且 paused=false，再实际暂停验证。
5. 使用产品视频关闭/最小化控件，观察正常变化。不得用只读查询 metadata/geometry 冒称播放成功。

关口：正常控件导致自然时间推进，暂停/关闭实际可达。若仍两次失败，停止P4，不继续换浏览器/编码/坐标开第三条自动链。

## 5. B：准备成功后只做有限对照

只有具体工作包、具体入口的A关口PASS才进入B。P1两入口各自独立，某入口不足不阻止其他已准备入口，但必须列缺口。不能以其他三包PASS掩盖它。

最多5条旅程：reader评分、standalone评分、文章扫描窗口、bubble、video；每条仅 before/after × 1280×800/390×844 × light，最多20个production对照context。学习页继续固定浅色，不把 reader主题注入学习页。

输入、字体阻断、browser版本、DPR1、zoom、动作前置链及稳定等待一致。沿用原 V01–V08，只采当前相关owner、窗口/Teleport、文本/SVG/rect及实际获胜声明，保存截图。存在文字换行、裁切、遮挡、入口/焦点差异须保留，不用1px容差豁免语义变化。

两侧执行相同正常动作，评分计数各自从本侧基数计算；不以总数巧合证明防重。不复制某侧评分后的snapshot到另一侧，不把准备context直接接成长矩阵。

源码补证仅限A已通过的正常路径：reader、standalone各最多一个1280/light context，合计最多2个。对应产物映射、实际模块/样式响应、公开观测边界分别记录；某包生产已准备而源码不可达，则该源码子项NOT_VERIFIED。源码观测不冒称 before-source动态配对，也不要求所有dev/prod CSS字符串相同。

范围上限：5准备context + 20production对照context + 2源码context。不到上限不必补满；失去关口则减少下游。不得为了把数字凑齐再跑已关闭主壳/素材/主题/glass矩阵。

## 6. CSS差异与未关闭项另列

已确认的两处跨路径差异按最新独立报告原样继承：production file按钮标准 backdrop-filter缺失；素材文本变量有不同加载次序的获胜映射。前后production在已有采样中保持，尚无清理新增P2，不能混称源码/生产一致。

本轮不改 vendor前缀、styles.css映射、workflow-ui.css、Vite入口或产物。不新build覆盖差异，不改观测值“归一化”消除差异。若需要产品/构建修复，下一任务另定文件、baseline、验收与回滚范围，本轮只提供具体交接。

本轮结束 remaining-items.md 必须继续逐项包含：未通过契约；未完成防重/保存语义裁决；深/custom保留窗口；剩余设置；完整源码必要状态；跨路径CSS裁决；历史FAIL与NOT_RUN。不能把所有剩余项压成一句“少量补证”。

## 7. 证据、命令和停止规则

原始观测直接记录，不搭建推断浏览器旅程的日志验收平台。最低交付：

- opening/closing workspace及全部产物manifest、status/diff、构建输入绑定。
- contract-map.md：四包真实消费链、旧失败、新准备、关口及运行可观测量。
- fixture-identity.json：复用/新增的内容、字段来源、字节/hash与媒体格式。
- readiness.json、bounded-browser.json：按入口/阶段列PASS/FAIL/NOT_VERIFIED；未做动作注明原因。
- 相关截图、事件/响应/阻断/pageerror/console/启动CLS；响应body在context关闭前采集，采集失败如实记录，不能补造hash。
- remaining-items.md、command-status.md、processes.json和workspace-changes.json。
- 唯一新交接：实际完成/未测、偏差、保护、证据链接及后续最小工作。

不要求“所有console必须为空”；保留实际错误并给出有证据的归因。启动CLS沿用既定<0.01，不升级成全应用性能平台。

不跑 build/npm test/默认 verify:vite/verify:production-preview wrapper。focused无产品/测试漂移则继承对应既有PASS，本轮记NOT_RUN；不得把Temp浏览器runner成功称为正式命令PASS。历史 production-preview FAIL、其他历史失败和NOT_RUN不追改。

停止规则：

1. 产物/源码输入身份漂移、真实请求穿透、超范围写入、未知进程需要处理：立即停止相关工作并交接。
2. 单包相同动作本次最多两次；第二次必须有可说明的正常契约修正，不能只加timeout。两次失败停止依赖项；不得自动新开修复/复审轮。
3. 新证据不足以解释旧停止点，则只交契约缺口，不执行旧失败动作第三次。独立包可完成已授权工作。
4. 确认产品缺陷映射 CP或具体P0–P2，保留证据，不自行修复。准备工具失败与产品回归分开。
5. 单个支持脚本约500行以上或超过复制基线两倍即停止扩写并说明范围，不靠拆碎/minify绕过。不添加通用owner模拟器或语义日志解析器。
6. 全部已授权有限项结束即收口；释放自有服务，逐文件核对原文件未变，只有允许的新交接新增。无需产品回滚，不能reset/clean覆盖dirty。

执行交接只能判具体准备/对照子项。原清理、完整外观/操作保持和 CP07–CP10仍交独立只读审核；必要NOT_VERIFIED未清零不能宣布原任务完成。

## 8. 可直接发给执行模型

> 请按 E:/read-web-next-optimization/docs/design/reader-post-migration-cleanup-contract-readiness-plan.md 执行一次有限契约准备与对照。先读规定文件和最新独立报告，冻结产物/开场dirty。只准备P1评分准确观测、P2文章扫描窗口、P3真实bubble命中、P4视频原生自然播放；逐包A关口通过后才做该包B对照，不先跑完整矩阵。standalone内存service与reader source selector/V2/legacy分开，不能再对selector盲查getReviewLogs。仅允许本方案规定的Temp、新交接及明确的frontend-only源码启动例外；产品/测试/旧文档/产物只读，不build、不提交、不promotion、不创建任务/代理/worktree。旧失败必须有新准备依据才做有界尝试，两次失败停依赖项，不自动第三轮，不修产品。保留正式命令NOT_RUN、历史FAIL与所有未关闭项。结束释放自有服务，核对原文件，交接后停止，等待独立只读审核。
