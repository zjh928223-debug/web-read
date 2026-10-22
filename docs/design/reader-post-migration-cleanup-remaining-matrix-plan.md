# 迁移后清理：剩余矩阵补证施工方案

日期：2026-10-02（Asia/Shanghai）。状态：待用户交给执行模型授权执行；本文件制定期间不启动服务、不运行矩阵。

## 1. 本轮目标与既定状态

六项最小清理及其影响范围外观/操作已独立 PASS，CP01–CP06 PASS，候选未确定为 0。本方案只补 CP07–CP10 的原必要缺口，不再清理候选、不重新换肤、不修产品。

最新依据：

- docs/design/reader-post-migration-cleanup-review.md 的固定 CP01–CP10 和最小矩阵。
- docs/design/reader-post-migration-cleanup-six-candidates-handoff.md。
- C:/Users/0/AppData/Local/Temp/readweb-cleanup-six-independent-review-20261002-01a0f7c7/six-candidates-review-report.md。
- 上次有限补证的 missing-matrix.md，以及独立 evidence-review-report.md；继承已经关闭的录键局部焦点、真实 WAV、badge、主题和生命周期证据，不重做它们来替代缺项。

采用一次有限执行、两个关口：A 准备可运行的源码环境与正常合成契约；A 通过后继续 B 剩余矩阵。A 未通过则停止依赖项，不跑一套注定缺证据的大矩阵。结束只交接，独立审核决定原任务是否关闭。

## 2. 文件、数据与启动授权边界

产品、已有测试、配置、依赖、已有证据和产物全部只读，不 build，不提交，不 promotion，不创建聊天/任务/代理/worktree。保护日常/历史树、全部 dirty 和 WhisperX/语言处理工作；不改 DB schema、owner、事件、样式或持久化键。

允许写入仅为：

1. 一个新 Temp 根：readweb-cleanup-remaining-matrix-<日期>-<随机串>，含合成数据、有限浏览器 harness、截图、属性/请求观测、日志与临时缓存。
2. 新交接 docs/design/reader-post-migration-cleanup-remaining-matrix-handoff.md。旧交接只读，用新交接引用结果，不追改历史状态。

**唯一拟授权的启动规则例外：** 用户明确发出“按本方案执行”后，仅为本次隔离源码补证，允许从优化树启动一个 frontend-only Vite，绑定 127.0.0.1:5184、使用当前 vite.config.mjs 和 config/runtime.optimization.json；不经 launch-optimization-preview.ps1。该有限例外覆盖 AGENTS 的启动器要求，仅适用于本方案这一源码前端。

理由：当前 launch-optimization-preview.ps1 在 DevFallback 前创建 runtime/release/log/优化数据目录并处理 activation recovery；fallback 还经 ServiceOnly 后端启动链。验证前端清理不需要这些副作用。本方案不授权默认 production launcher、Host/8776 启动、release 激活、owner migration/promotion、真实业务目录初始化或后台任务恢复。

frontend-only 过程要求：

- READ_WEB_RUNTIME_CONFIG 指向优化配置；VITE_LOCAL_SERVICE_BASE_URL 为 http://127.0.0.1:8776，仅作为被浏览器拦截的契约 origin；8776 不启动。
- 新子进程从 Temp harness 调用现有 Vite createServer，配置 root/configFile 指向优化树，cacheDir 指向本轮 Temp，server host/port/strictPort/open 明确设置。
- 使用已安装版本支持的 configLoader runner，避免向仓库写 bundled config 临时文件；依赖缓存、日志写 Temp。不改真实配置或替换 Vue/Tailwind/运行时插件。
- 先核对插件是否在请求之前写业务数据或自行发真实网络请求；无法满足只读业务边界则停止源码项，不删插件凑成功。
- 浏览器导航前拦截业务请求；放行当前源码加载必须的 HTML、模块、依赖和 HMR；未知请求阻断。外部字体环境与生产双侧一致。
- 有明确身份吻合的现有源码服务可复用，不接管/停止已有实例。私有地址 5184 与 loopback 是否冲突据实际地址核对；不能仅看端口号。
- loopback 5184 真冲突或配置加载失败则停止，不改用 4173/5173/其他源码端口，不 kill 未知 PID。只释放本轮拥有的前端进程。

以上是未来执行授权的明确边界；本次制定方案不视为已启动或已验收源码服务。

## 3. S0：开场、身份与继承清单

1. 读 AGENTS、原 plan/review、最新六项交接和独立报告，记录 HEAD/branch/status、tracked binary diff、tracked/untracked 文件 hash。确认六项已验收文件没有新漂移。
2. before 使用原清理 readweb-post-migration-cleanup-20261001-212901-b1592d93/before-dist；after 使用最新 readweb-cleanup-six-candidates-20261002-01a0fb48/after-dist。不要把第二修复 after-dist 当原清理 before。
3. 直接核对两个 HTML/全部 assets；after index 应为 6E9C35A6A8A94243D658FF2EB48C628624E759C0369C58F83CB8D36DABC1992E，standalone HTML 为 283557907E66B446AD5E0A0D83C25A084E7419987ADA6079FF415E5E075BB88E。
4. 核对 after 构建输入与当前受影响源码 hash；出现漂移则停，不自行新构建。目录全文件列表及 .vite 缓存元数据分别记账。
5. 建 missing-items.md，逐项列原缺口、CP/V 映射、已继承证据、拟执行动作、通过条件。只测原必要缺项，不追加全应用设计/服务/跨机门槛。

## 4. A：环境与合成契约准备

先读当前实际消费链，再准备契约；不能沿用不完整 mock 后靠 force enabled 或 private Vue 状态绕 gate。

| 准备对象 | 源码依据与最小内容 | 准备通过条件 |
| --- | --- | --- |
| A01 源码入口 | 当前 vite.config.mjs、index.html、main.js、srs-review-main.js；按第 2 节启动/复用 | reader 与 standalone 真正加载当前源码，记录 /src/main.js、SRS 入口、样式和动态模块 URL；没有业务请求穿透真实服务 |
| A02 标准素材 | YouTubeWorkflowPanel.vue → youtube-workflow-client.js → youtube-workflow-loader.js；windows-owner-api-client.js / reader-session-consumer / API contract | 最小成功 job/session/file/audio/transcript/chunk/marks 契约走实际素材库“打开”；内容 identity、revision、bytes/hash 使用真实 fixture 字节及当前校验格式；正文/chunk 正常呈现，三个学习/AI入口由产品 gate 自然可用 |
| A03 素材状态 | 现有库/任务/quality/notice 消费字段与载入失败分类 | completed/failed/pending、quality、可控失败 notice 均经产品入口触发；每个动作先确认当前面板是否已自动收起，不能沿用错误 selector 连续关已关闭面板 |
| A04 学习与评分 | App / SRS UI service / useSrsReview / srs-review-flow / standalone in-memory 入口 | 至少两个不同卡片和合法上下文；找到当前实际评分边界与可观察事件/请求计数；能从真实入口揭示、评分和推进，媒体资源可解码 |
| A05 预习与保留窗口 | 产品 file 输入/预习数据恢复；标准素材 gate；词命中/注释/视频接线 | 准备完成/等待池所需合法数据，以及 AI/预习词/整理词/bubble/video 实际消费者所需最小响应；不制造窗口 DOM 或改 owner |

允许在新 context 的现有 localStorage/IndexedDB 恢复链放合成数据，不使用用户 profile；schema 保持 SeekPlayerDB v1/files/id。owner 查询/命令仅由浏览器路由返回当前客户端可消费的合成 envelope，记录 operation/receipt/revision 的必要字段，不向真实 owner 发请求。

不要实现第二套 owner/评分/日志验收平台。优先复用已有正常 fixture、客户端校验和媒体生成工具，仅补实际用到的端点与字段。媒体使用有时长的可解码 WAV；视频可用现有合成夹具或本机工具生成小文件，不下载真实内容。

**评分合同必须先确认：** 当前 SrsReviewPage 传 background:true；延迟保存响应不能自动等同“按钮持续禁用”。先记录实际 transitioning/ratingCommitted、卡片切换与后台保存语义，不强行改成同步评分。可在现有外部契约边界暂缓/释放响应；不得换 service 私有方法、改组件 props、暂停页面线程或直接设 pending 制造等待。

standalone 使用真实 in-memory service，不能假称存在 HTTP 评分请求。通过它的正常数据/事件查询确认一次评分；防重按同一旧卡片 identity 计数，下一张卡的正常评分不算重复。某持续等待态当前入口确不可达时，输出明确源码/实际链依据给独立审核裁决；执行者不能自行把必要 NOT_VERIFIED 改 N/A 或改产品造状态。

准备只做少量真实路径 smoke，不做全主题/全尺寸采样。产出 contract-map.md：请求、合法响应来源、fixture 字节/hash、实际正常路径结果及限制。只有相关 A 项通过才运行其 B 项；不能以 mock 文件存在、静态校验通过作为页面 smoke 成功。

## 5. B：只执行剩余必要矩阵

production before/after 用项目 browser-port-policy 选择安全 Temp 静态端口。相同 Chromium、字体、zoom、DPR 1、输入与稳定时机；1280×800 / 390×844。学习页固定浅色；受主题影响的 reader/素材窗口覆盖 light/dark/custom-light/custom-dark。

| 组 / CP | 本次必须补齐的实际动作 | 通过与证据要求 |
| --- | --- | --- |
| B01 / CP07–09 | 标准素材成功打开；正文↔chunk；当前 chunk 设置效果、输入保存、关闭；受影响 owner 代表交互 | 当前正文/块实际渲染、样式效果生效；before/after computed + 相关 matched 声明/context + rect/文本/SVG/截图；不重复已闭合主壳/主题矩阵替代这些动作 |
| B02 / CP07–08 | 素材 completed/failed/pending；quality/notice；添加/设置；390 滚到末项；正常关闭与焦点 | 原 before-only 7 状态补为两侧配对；四主题覆盖受影响表面，质量窗口/notice 的 Teleport 根单列；28% backdrop 与单列保持；记录自动收起后实际焦点，不关不存在面板 |
| B03 / CP07–08 | reader 有卡 SRS 与 standalone；揭示答案、评分、防重；正常发音/原文播放；关闭 | 固定浅色/自然换行；以当前实际合同观察短暂过渡和保存等待，不发明持续 disabled 要求；同一卡片评分事件/请求只提交一次；合成媒体自然推进；关闭后等待稳定，记录精确 active 节点/可见性/Tab 可达及前后语义 |
| B04 / CP07–08 | 预习完成/等待池，设置代表状态，最终返回 reader | 经 file/合法恢复链和产品动作触发；pool/等待/完成状态可见且可操作，窄屏无裁切；最终焦点精确记录。已关闭录键 Escape/shortcut 局部焦点可继承，避免把它们重做算新补证 |
| B05 / CP07–08 | AI解释、文章预习词、整理生词；实际命中 bubble；产品 video/file 保留区 | 正常素材 gate 通过后实际打开；每种原删改模式至少一个正向消费者、关闭与焦点；视频/音频 loadedmetadata 与自然推进；业务结果为合成，不声称真实 AI/下载/持久化 |
| B06 / CP09 | 当前源码 reader 与 standalone 运行同族代表入口/高风险动作，与最终 production 对应 | 真实源码加载链、状态与最终产物符合；source 输出变换后 body hash 与原文件 hash分别记录，不能要求两者相等；原 before-source 仅是文件基线，不冒充运行成功 |

同族已有身份吻合证据可引用，必须逐条解释继承依据；不同 owner/Teleport/入口不能互相代替。源码无需机械复刻所有 production 截图，但两个入口及缺失高风险动作必须有实际观察，覆盖不足保持 NOT_VERIFIED。

沿用原约 1 CSS px 矩形容差；换行、入口顺序、裁切、遮挡不豁免。采样等待主题/窗口状态稳定与必要 animation frame；真实评分持久化、外部字体/TTS/AI/词典服务不在本方案成功声明内。

焦点双侧相同只证明保持；若仍存在可用性问题，区分原行为与本轮回归，映射既定 CP 或具体 P0–P2，不随意添加“所有关闭必须聚焦某按钮”的新设计要求。

## 6. 响应身份、命令与输出

- response 到达时立即取 body，逐 context drain 后再 close，防止刷新后旧 resource identifier 失效。真实 hash 不匹配与 body 无法读取分开计数，原失败日志不覆盖。
- production 实际响应绑定到对应目录文件 hash；源码记录模块响应 hash、当前文件 hash和 Vite 解析路径，明确 transformed output。清单只核身份，不能从任意日志推断旅程。
- 记录所有业务 route 命中、未知/外部阻断、console/pageerror、CLS；首屏 CLS <0.01，无新增运行错误。不能过滤错误后写全空。
- 不重跑已无漂移的 focused。至少实际 git diff --check；文档-only 修改不触发 build。正式 verify:vite / verify:production-preview 仅在目标与隔离安全成立时运行，否则 NOT_RUN；不得裸跑默认 wrapper 另启服务或覆盖仓库证据。npm test 不自动追加门槛。
- 历史 production health404 FAIL、YouTube 行为 FAIL/归因未知和 NOT_RUN 原样保留；替代矩阵只按自身身份报告，不改成正式命令 PASS。

最小交付：opening/closing 状态与 hash；source-environment.md；contract-map.md；逐缺项 coverage.md；原始 browser JSON/截图/响应绑定；命令状态；新 remaining-matrix-handoff.md。每行指向 A/B 项与 CP，区分实际/继承/未测，不写第二套语义验收器。

新交接必须分别报告“本轮剩余补证交接状态”“原清理状态”“外观/操作状态”。执行者不改独立 CP；全部适用 CP PASS 且必要 FAIL/NOT_VERIFIED=0 后，才由独立审核宣布关闭。未发布、未替换日常版，原标准原位换肤 PASS 保持。

## 7. 停止、保护与回滚

1. A 环境/契约不足：停止依赖 B，保留最小缺口；继续无依赖核对。不用 full matrix 再产生大量相同 NOT_VERIFIED。
2. 上次 M02/M05 已失败两次；仅在新正常契约/正确可见路径准备成功后恢复一次有限矩阵。不得原样复制旧失败动作作第三次盲重试。新同一动作最多两次定位/操作失败即停止该项。
3. 新确认产品 P0–P2 或既定 CP 失败：保存最小复现并停止受影响项，不修产品/断言；需要修复必须由用户另定范围。
4. 身份漂移、并发写入、真实 API 穿透、未知服务/端口、数据目录写入：停止受影响流程，保留证据，不 kill/重启用户服务凑 PASS。
5. 支持脚本约500行以上或超过审核基线两倍，暂停加复杂度并说明原因；不压缩成超长行规避范围警告。
6. finally 恢复本轮环境变量，关闭本轮 context/自有静态与源码服务。Vite 缓存保留在 Temp；不递归删除业务/仓库目录，不 reset/clean。结束核对除新交接外仓库文件全未变。
7. 一次执行后停止，由用户安排独立只读审核。不自动新开修复/补证轮或消息其他聊天。

## 8. 可直接交给执行模型的指令

> 请按 E:/read-web-next-optimization/docs/design/reader-post-migration-cleanup-remaining-matrix-plan.md 执行一次剩余矩阵补证。先读 AGENTS、原 cleanup plan/review、六项交接与最新独立 six-candidates-review-report。六项和 CP01–CP06 已验收，禁止追加清理或改产品。
>
> 本次明确授权该方案第2节的有限例外：仅隔离源码补证可启 frontend-only Vite 于127.0.0.1:5184，当前优化配置，缓存/日志写新Temp；不经会处理Host/数据/release的启动器，不启动8776、不触碰真实业务数据。其余AGENTS保护边界保持。
>
> 先做A环境和正常素材/评分/媒体合成契约准备；通过后仅做B原剩余必要矩阵。所有业务请求导航前拦截，使用真实产品入口与可解码合成媒体，不强设gate/private状态/DOM，不改后台评分语义。A不足则停止依赖项，不盲跑全矩阵。原失败两次动作只有正常契约与正确路径已改变时才恢复有限补证，遵守本方案停止规则。
>
> 产品/测试/配置/旧文档与产物只读，不build/提交/promotion，不创建任务/聊天/代理/worktree。仅新Temp证据和新remaining-matrix-handoff可写。区分源码变换输出与production响应hash，立即采集body；历史FAIL/NOT_RUN不追改。完成后交接实际覆盖与全部未关闭项，停止，等待用户安排独立只读审核，不自行宣布原任务完成。
