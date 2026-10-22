# N8 AI 配置与执行来源透明化：首版施工方案

## 最新状态与固定收尾入口（2026-10-21）

N8-00/01 在原声明范围内有限 PASS（继承），见[第一批交接](C:/Users/0/AppData/Local/Temp/reader-n8-stage1-20261019-103443/handoff.md)及[覆盖表](C:/Users/0/AppData/Local/Temp/reader-n8-stage1-20261019-103443/a1-a12-coverage.md)。N8-02「请求与历史来源呈现」已完成原定范围独立只读收口，Spec、Standards 两轴均有限 PASS；F01～F05及原 F-01 继承各自范围内已关闭。证据见[本次独立收口报告](C:/Users/0/AppData/Local/Temp/reader-n8-02-closeout-independent-review-20261021-7c2e61b0/review.md)与[证据索引](C:/Users/0/AppData/Local/Temp/reader-n8-02-closeout-independent-review-20261021-7c2e61b0/evidence-index.json)。本次剩余补验独审见[review.md](C:/Users/0/AppData/Local/Temp/reader-n8-remaining-independent-review-20261021-4b97f0ac/review.md)及[证据索引](C:/Users/0/AppData/Local/Temp/reader-n8-remaining-independent-review-20261021-4b97f0ac/evidence-index.json)：A11 在原定真实开发 Host 只读对照范围内有限 PASS并关闭；A9 继续 NOT_RUN；A8/A10 仅定向有限支持；A12 仅本轮身份与独立审核范围有限支持。第一批旧 panel browser/Vite mount FAIL、Temp harness 两次失败停止及其它历史例外继续保留；完整 A8、A10/A12、N8-03/04 和完整 N8 仍未完成。

用户已确认将当前 UI 剩余冻结为：**UI-1 完成 N8 原定剩余呈现；UI-2 修 SRS 两处精确默认样式覆盖；一次限定验收后停写交接。** [详细执行指令](E:/read-web-next-optimization/docs/design/reader-ui-fixed-closeout-execution-2026-10-19.md)补充操作细节和唯一 SRS CSS 例外，原 N8 A1–A12 不增不减；其它 N5/N6/N7 保护、原停止与延期不变。

本次仅回填文档，不启动施工、服务或业务验收，不操作日常版。下方关于“尚未启动”、原 N8-00→04 执行顺序和编制时 NOT_RUN 的文字保留为 2026-10-19 方案快照；当前 N8-02 状态以本节独立收口报告和索引为准。完整 N8 仍不得由本次 N8-02 有限 PASS 代替。

本次 N8 剩余补验独审未补跑业务，采用上一轮执行材料中的真实优化开发 Host/Page 只读证据及其索引；A11 只关闭“已确认开发实例＋配置及至少一个已有 job/run 的 UI 对照”范围，不扩大为全部 run、真实配置保存、AI 调用或学习持久化。A9 未发送配置保存命令，未执行 B 保存、读回或真关页重开；A8/A10 仅登记实际面板、刷新、历史、详情、设置和两宽交互支持，query POST 不称写入，也不称全页无 POST。原 `tabStayedInPanel=false`、首次 ENOENT 和所有历史 FAIL/PARTIAL/NOT_RUN/NOT_VERIFIED 均保留。Spec 仍部分完成，Standards 仅在已记录范围有限 PASS；完整 N8 仍未完成。

以下保留原方案与固定验收。**初编时记录**：2026-10-19 方案已编制，彼时产品施工与验收尚未启动；原授权只更新路线图/项目状态并给出方案。本段“尚未启动”只描述编制时点，不覆盖上方第一批实际进展或 2026-10-21 N8-02 独立收口。

本次独立审核未补跑业务；来源展示、异步隔离及布局证据包含真实 controller/dialog 受控执行和真实产品 Page/CSS 的受控接口证据。受控 fulfill 不能证明真实 Host、owner、配置保存、AI 或学习持久化；审核文件哈希和 dirty 路径关系不能外推所有源码、数据或进程绝对未变。

## 1. 首版目标与原需求

正常打开设置或查看任务结果时，能回答：这项工作由什么能力负责、当前选择是什么、本次请求了什么、结果记录说明了什么。配置改动不会给旧结果换上新模型标签。

| 原需求 | 首版交付 | 明确不纳入本轮 |
| --- | --- | --- |
| D1 当前模型可见 | 区分页面当前选择、后端默认、本次请求快照、结果记录；没有证据时显示未知 | 不把请求模型等同服务商实际执行/网关最终路由模型 |
| D2 用途清楚 | 设置页直接说明转写、素材切分、素材翻译、解释、短义精简分别走哪条现有路径；句子即时翻译注明另有路径 | 不强制共用一个模型，不引入新任务路由或独立模型配置系统 |
| D4 简单配置优先 | 素材模型和现有保存动作前置到普通设置；Base URL/代理/路径等仍按需展开；解释弹窗保留自己的现有选择入口 | 不改设置生效时机、默认值、凭据保存或自动换模型规则，不新增服务选择器 |
| D6 历史可追溯 | 用当前选中 job/run 的既有字段展示请求/结果来源，缺字段、缓存、合并结果分别说明 | 不回填旧结果，不迁移/新增历史元数据，不声称一份合并结果的每个词条都来自最新 run |

N9 的多 provider、统一连接配置与适配另案。N6/N7 的学习资格、评分、恢复和补验不进入 N8；N5 精简/入库语义和性能成果保持。

## 2. 已核对的 owner、消费者与可用字段

下表来自当前源码只读核对；行号仅作导航，执行 opening 时再核对身份，不以 HEAD 替代脏工作树。

| 路径/owner | 现有事实与可用来源 | 首版处理 |
| --- | --- | --- |
| [YouTubeWorkflowPanel.vue](E:/read-web-next-optimization/src/components/YouTubeWorkflowPanel.vue:438) | 素材模型目前在高级设置；页面 model 来自 `youtubeWorkflow.model`/既有默认，之后可被 GET config 覆盖；新任务 payload 显式发送页面 model | 显示“本页新素材任务的当前选择”；普通层前置原控件/保存入口，不复制两个输入，不冒称已保存到后端 |
| [配置 client](E:/read-web-next-optimization/src/composables/youtube-workflow-client.js:494) / 后端 get_config | 现有 GET/保存支持 owner 与旧 HTTP 路径；model/baseUrl 等既有字段没有逐任务配置集 | 原 client/保存合同不改；后端默认只由成功读取/保存响应说明，加载失败保留未知提示 |
| [core.py](E:/read-web-next-optimization/tools/subtitle-workflow/youtube_workflow/core.py:327) | `safe_manifest_request()` 保存 request.model/geminiMode；素材切分与翻译均使用 request.model；历史 item 可带 request。转写是独立 WhisperX 命令，配置 API 只公开工具路径，未提供已运行模型证明 | 历史 request.model 标为“任务请求模型”；WhisperX 用“本地转写，具体模型由后端决定/当前接口未提供”说明，不拿路径或源码默认值当实际运行证明 |
| [解释 controller](E:/read-web-next-optimization/src/composables/annotation-backfill-ai-module.js:150) | `annotationBackfillAi.model`/弹窗选择与素材页面分开；特定多项请求保留已有推荐模型切换；当前请求使用切换后的 runContext.model | 保留两套选择关系；文案区分原选择与最终提交值；仅在已有切换分支发生时说明原因，不修改触发规则和模型名 |
| [解释历史 dialog](E:/read-web-next-optimization/src/features/annotation-backfill/create-annotation-backfill-dialog.js:367) / [runtime metadata](E:/read-web-next-optimization/tools/subtitle-workflow/youtube_workflow/annotation_backfill_runtime.py:235) | 历史有 model/runId/generatedAt；服务端 metadata.model 是本次提交 requester 的模型，另有 purpose/mergeWithLatest。未提供网关实际路由或逐 item 来源证明 | 标为“本次运行记录模型”；每条按自己的 run 展示。合并 latest 不标成全部词条同一来源；未知与结果缺失单列，不改原结果选择/复用/导入逻辑 |
| [短义精简调用](E:/read-web-next-optimization/src/composables/vocabulary-preview-module.js:454) | `purpose=srs_meaning_refinement`，当前 payload 不指定 model；后端用已保存 config.model 或原默认。单次请求/claim/缓存是 N5 已收口行为 | 用途表说明“使用后端默认”；不把解释弹窗的本地选择冒充短义模型。缺少关联 run 的历史短义来源显示未记录，不改 N5 controller/progress |
| [句子即时翻译](E:/read-web-next-optimization/src/services/vocabulary/sentence-translation-service.mjs:18) | 独立服务有自己的模型与缓存；现有响应无法给出所有缓存行的逐条来源，顶层 model 不足以证明缓存条目的生成模型 | 与素材翻译分开说明；首版不改该服务或 N6/SRS 页面，不根据当前配置重标缓存来源 |

本轮依赖的 R6/R8/有限 R9 已有[用户简化范围独立 PASS](C:/Users/0/AppData/Local/Temp/reader-fast-closeout-independent-review-20261004-c1860078/review.md)，R7/R4 的既有职责边界保留。无需为 N8 重开整条结构线；原完整生产旅程、真实模型路由等未验边界不升级。

可独立推进的是现有字段展示、用途说明和受控 UI 验证，不依赖 N6/N7 收口或新 provider。A9 真实配置保存依赖既有入口能提供可证明隔离的配置副本，当前仍 NOT_RUN；A11 的版本/实例、配置及已有 job/run 只读对照已按本次独审限定范围有限 PASS并关闭，不扩大为保存、全部 run、AI 或学习持久化。依赖不满足则对应项 NOT_RUN，独立工作与阻断分列，不借 N8 修初始化/迁移/启动包装，也不能用受控结果宣布整版验收完成。

## 3. 呈现合同

1. **当前选择与已保存分开。** 素材页当前 model 会用于本页新任务；尚未成功保存后台配置时，不写“后端已生效”。读取失败、本地默认或草稿必须有准确来源说明，不能把 fallback 当成功 GET；后台配置未读成功时，不允许用未初始化的高级字段覆盖未知配置。沿用现有选择持久化键与保存合同，不擅自改成另一套保存策略。
2. **请求与结果分开。** job.request.model 只证明该任务请求；匹配 runId 的 metadata.model 只证明该次运行记录。无服务商响应证明时，实际执行/路由模型显示“当前记录未提供”，不写“已确认实际模型”。
3. **历史与当前分开。** 配置从 A 改为 B 后，旧 job/run 继续显示 A；缺 model 的旧记录保持“未记录”，不得回退到 B。当前材料变化或慢响应迟到时，只展示仍匹配当前 jobId/runId 的信息。
4. **复用、混合与模式明确。** 不为补标签重新生成解释或精简；复用保留既有来源，无法关联则说明未知。mergeWithLatest 的 run 标签只描述这轮操作；不能为整个合并结果或已保存 context/short 统一赋来源。mock/off 显示开发模拟/未调用远程模型，不冒充真实生成。
5. **入口简洁。** 素材设置普通层呈现任务用途摘要、现有模型输入、凭据状态和保存动作；高级层保留网关/代理/工具路径/维护。任务详情/历史只补短标签与按需详情，不扩成日志仪表盘或新设置中心。
6. **打开即只读。** 读取摘要与历史不触发 config-commit、解释、翻译、精简或重试；利用当前已有加载结果，不新增轮询。凭据只展示已保存/未配置/未知，不回显 API key，不把含凭据 URL 写入摘要、日志或截图。`credentialStatus.provider` 是凭据保存实现，不能当 AI 服务商；Base URL/代理信息也不能证明最终执行模型。

纯展示 helper 如需归一化，输出任务名称、展示文本、证据层级和缺失原因即可；它不选模型、不解析任意日志推断真实执行、不实现 provider 路由或新的配置 owner。

## 4. 施工文件范围与保护范围

以下只在后续用户明确启动施工后生效；不是本轮实际改动列表。

| 允许产品文件 | 允许增量 |
| --- | --- |
| `src/components/YouTubeWorkflowPanel.vue` | 移动现有模型/保存入口，补用途摘要、配置来源状态与当前任务标签；保留列表/打开/修复/变更队列合同 |
| `src/features/annotation-backfill/create-annotation-backfill-dialog.js` | 当前选择/本次记录/历史缺失及合并边界标签；不改触发生成、导入或复用规则 |
| `src/composables/annotation-backfill-ai-module.js` | 仅把已有 runContext/response/history 传给展示层，补既有自动切换的说明；保留目标身份、取消、缓存、批量和导入逻辑 |
| `src/services/ai/ai-provenance-presentation.js`（必要时新增） | 无副作用的来源展示归一化，不能成为第二套配置或执行 owner |
| `src/styles/workflow-ui.css`（确有必要时） | 只补新摘要的自然换行/局部布局；不改全局控件或既有生产样式合同 |

允许的检查增量：新增 `scripts/ai-provenance-presentation-check.cjs`；按实际入口补 `scripts/youtube-workflow-panel-v3-check.cjs`、`scripts/youtube-workflow-panel-v3-browser-check.cjs`、`scripts/annotation-backfill-ai-module-check.cjs` 的必要场景。保留旧断言及原失败，不以放宽断言追绿。无需为了增加 npm alias 修改 package/lock；新检查直接用 node 执行。

只读保护：`youtube-workflow-client.js`、workflow mutation/reader-session 生命周期、后端 core/service/runtime/HTTP、模型调用/路由/缓存、所有 owner/repository/UOW、N5 controller/progress、N6/N7/SRS、IndexedDB schema、薄 runtime/session 入口、运行配置、凭据及启动脚本。若呈现必须增加后端字段/存储或越过上述 allowlist，停下单列二期，不自动扩文件。

文档更新限本方案、两份路线图和 `CURRENT_PROJECT_STATUS.md` 的结果与证据索引；不自动重写其它状态文件或全仓清单。保留已有 WhisperX/语言处理及其它 dirty 增量，不 reset/restore/clean，不提交/推广。

## 5. 执行顺序

1. **N8-00 opening 与来源表。** 保存当前允许文件原件、完整 dirty 状态及相关源码 hash。逐字段确认当前选择/后台默认/request/run/history 的来源；核对 N5/N6/N7 产品不变。只读确认开发服务路径/数据根/进程所有权，不能仅按端口/profileId 操作进程。
2. **N8-01 配置与用途。** 在现有素材设置前置原模型/保存入口，给五项任务及独立句子翻译提供简短说明，保留高级字段与解释弹窗独立选择。先验证开关/读取无副作用及未保存状态，再做来源标签。
3. **N8-02 请求与历史。** 为当前 job/run 增补已有字段展示；覆盖换配置、迟到响应、缺字段、mock/off、复用和合并场景。自动换模型只呈现现有事实，不换算法或选择策略。
4. **N8-03 固定验证。** 先定向展示/旧入口回归，再构建和浏览器验收；真实 Host 只读链、受控 fixture、隔离配置保存分别登记，不互相冒充。保护和版本不明时停止依赖步骤，不修启动包装。
5. **N8-04 停写与审核。** 固定当前源码、原始命令和 A1–A12 结果后停产品写入，交独立 Spec/Standards 按本范围审核；两轴支持才能声明首版有限完成。本轮编制方案不启动审核代理或发新任务。

单写入者串行推进；不并行修改 Panel、dialog、共享样式或配置 owner。N6/N7 延期清单继续保留，不能用其补验来完成 N8。

## 6. 预先固定验收 A1–A12

编制本方案时所有执行项均为 NOT_RUN；当前第一批状态见顶部及原覆盖表。下列 A1–A12 标准保持不变，不改写 N6/N7 的同名 A 项。

| N8 项 | 必须观察到的结果 | 证据层与判定限制 |
| --- | --- | --- |
| A1 普通入口 | 不展开高级设置即可看到素材当前模型、保存动作与五项用途；原高级字段、凭据、维护入口保留 | 真实产品 DOM/CSS，1280×900 与 390×844 |
| A2 配置状态 | 已读后台值、本地当前选择、未保存、加载失败和保存失败不混称成功；控件只有一个有效 owner；配置未读成功时不能用空的高级字段覆盖未知配置 | 受控配置成功/失败矩阵；原保存字段/合同保持，后台失败不伪报已生效 |
| A3 任务关系 | 素材切分/翻译、解释弹窗选择、短义后端默认、WhisperX 和句子即时翻译分别说明；不因同名 Gemini 推断共用配置 | 当前调用链与实际摘要对照；不新增路由/配置字段 |
| A4 本次请求 | 原选择 A、现有规则切至 B 的受控场景，最终请求与说明均为 B；未切换场景保持 A；不改变原切换条件 | 使用真实 controller 与捕获请求的 fixture；不称已在线调用 B |
| A5 历史不重标 | 保存配置 B 后，旧 job/run A 及另一个 run C 各保留原标签；换 job/run 与迟到响应不串结果 | 真实 Page/dialog fixture 及既有只读历史；不得回写记录 |
| A6 缺字段诚实 | 无 model、无匹配 run、只有 request、只有运行 metadata、无最终路由证明分别准确显示；不能从当前设置或任意日志补猜 | 定向数据组合；未知是合法呈现结果，不是虚构模型 |
| A7 复用/合并/模拟 | cache reuse 不发生成请求，合并 latest 不给所有条目标最新模型，mock/off 不冒充真实生成；独立翻译缓存不按顶层 model 重标 | 调用次数、原始输入和产品 UI；不新实现缓存/合并算法 |
| A8 只读与凭据 | 打开/刷新摘要、切历史只做既有读请求，不提交配置/AI/学习命令；标签无 API key 或敏感 URL；现有取消/失败/重试入口不受影响 | 记录 request 类型/计数，fixture 凭据不使用真实 secret |
| A9 配置保存/重开 | 通过原 client 与保存入口在可证明隔离的开发配置副本中保存 B、读回 B、真关页新开仍 B；失败时不显示成功；旧任务标签仍 A | 真实配置链与受控错误分列。不能证明隔离则 NOT_RUN 并停止该项，不写原优化配置或日常数据 |
| A10 布局/键盘 | 两宽无横向溢出/遮挡；Tab、输入、展开收起、弹窗关闭及焦点返回正确；阅读快捷键隔离保持 | 使用真实产品入口/CSS，不能只看 helper 输出或截图夹具 |
| A11 真实只读来源 | 在版本/实例已确认的开发 Host 读取配置及至少一个已有 job/run，UI 值与原始响应匹配；无字段按未知显示 | 不为本验收新建任务、调用付费 AI 或触碰 N6/SRS 学习链。存在既有在线记录不等于本轮新跑 AI；原 origin/浏览器配置不清理 |
| A12 身份与独审 | opening→closing 仅允许增量；N5/N6/N7、数据/配置保护明确，原失败和 NOT_RUN 保留，独立 Spec/Standards 按固定范围裁决 | 校验只查结构/存在/hash/显式状态；不造日志推理器，不将 fixture 升级真实旅程 |

## 7. 检查与隔离

将来按影响运行：新 `node scripts/ai-provenance-presentation-check.cjs`、`npm run verify:youtube-workflow-panel`、`npm run verify:annotation-backfill-ai`、`npm run verify:youtube-workflow-panel-behavior`、`npm run verify:keyboard-boundary`、`npm run build`、`npm run verify:vite`。Node 加载真实 browser ESM 时沿用可解析相对依赖的既有 staging 方式；不复制产品模型选择算法。当前编制方案未运行上述检查。

真实开发入口使用 `config/runtime.optimization.json` 和既有 `scripts/launch-optimization-preview.ps1`，开发前端/能力端口为 5184/8776；启动前还须确认内部 Host、数据根与实例身份。A11 本次已按限定范围完成只读 Host/已有记录对照；配置保存只允许可证明隔离的开发配置副本/测试数据，原优化配置和学习数据仅只读。隔离入口若不可用，保留 A9 NOT_RUN 和原因，不临时创造迁移/owner 初始化/新包装修复任务。

日常 `E:/ReadWebDaily/N5-20261007`、`E:/ReadWebData/SubtitleWorkflow-Daily-N5`、5194/5195/8786 及旧保护树 `E:/read-web-next`、历史树 `E:/read-web` 均不操作；不得按 profileId 批量停服务。本轮不要求声学听辨、全仓 npm test、新 provider 在线调用或系统重启，未运行仍如实列出。

## 8. 停止、回滚与完成出口

- 遇到必须改后端/schema/元数据持久化、触发未知学习写入、来源无法关联却被写成确定、隔离/版本不明或具体 P0–P2 数据风险，保留材料并停对应步骤；不修 N6/N7、旧 runner 或部署包装来补本专题。
- 必需项失败保留原 FAIL 与原始 stdout/stderr/退出码。修补仅限明确授权和 allowlist；同任务两次连续修复/复审失败后停止自动迭代，不进入第三轮。支持脚本接近 500 行或超过已审基线两倍时先评估范围，不将展示工程变成第二套执行系统。
- 回滚仅在核对后续漂移后反向本轮具体 hunk；不整文件覆盖原 dirty，不回滚/删除合法学习数据。隔离配置副本单独保留或按后续明确清理范围处理，不用恢复整个数据根回滚 UI。
- A1–A12 按声明运行层完成、两轴均支持时，只声明 **N8 首版呈现范围有限完成**。若必需项未过，写 **已实施/验收未完成**，列具体 FAIL/NOT_RUN；不以“未知模型”占位掩盖已经存在但尚未正确呈现的字段。
- 实际服务商/网关最终路由、缺失的逐条历史来源、新元数据存储和多服务配置继续明示 NOT_VERIFIED/延期，不宣称 N9 完成，不刷新全仓 Last verified 或日常推广。

## 9. 未来执行交接

> 当前状态覆盖（2026-10-21）：N8-02 已在声明范围内完成独立只读收口，本次剩余补验独审已将 A11 在原定真实开发 Host/已有 job/run 只读对照范围内有限 PASS并关闭，不重做 N8-00/01/02。仅在用户另行明确启动剩余 N8 工作时，才按原 A1–A12 未覆盖项推进；A9 的真实隔离配置保存/读回/真关页重开、完整 A8、A10/A12、N8-03/04 和整版终审仍按原状态保留。不得把受控证据升级为真实 Host/owner/AI/学习持久化证明；不新建 AI 任务、不调用日常、不修隔离包装、不增加验收要求。本次只做文档回填，不执行本段。

> 仅在用户后续明确启动 N8 剩余工作后执行：先保存当前脏树 opening 和允许文件原件，核对本方案的来源表；不重做已关闭的 N8-00/01/02 或本次已关闭限定范围的 A11。仅按原 A1–A12 未覆盖项推进：A9 的隔离配置保存/读回/真关页重开、完整 A8/A10/A12、N8-03/04 和整版终审。后端/owner/schema/N5/N6/N7/模型调用逻辑不改；缺字段、混合/缓存和未证明实际路由如实说明。原优化数据只读、配置保存只在证明隔离的副本中进行；不新建 AI 任务、不调用日常、不修隔离包装。保存原 FAIL/NOT_RUN，产品停写后交独立双轴；当前这轮只做文档回填，不执行本段。
