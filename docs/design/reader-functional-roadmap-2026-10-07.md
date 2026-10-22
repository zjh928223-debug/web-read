# 阅读器功能整理路线图：原计划与当前位置

原整理日期：2026-10-07。状态同步：2026-10-21。原计划日期：2026-10-03。

本文件是原路线图的阅读版，保留原任务划分与需求编号，方便对照你的备注。具体需求的“明确意图、建议、待决定”仍以原文为准；没有新增施工授权、改写验收或抹除历史失败。

## 我们要做到什么

依据你的43条功能意见，拆成99个具体需求。三个方向是：文字阅读优先、键盘操作优先、学习过程透明。

主要使用路径：

**选择素材 → 阅读文字与听音频 → 标记生词 → AI解释 → 本篇整理入库 → SRS复习。**

独立预习补充另一条路径：**按自己的需要选择预习内容 → 首次接触与学习记录 → 后续复习。**

N编号是把相关备注归到一起的施工专题，一个专题可以分几次施工与验收；不能把编号数量直接当成对话轮数。

## 现在在哪里

**原默认 UI 换肤范围已有完成记录；N3/N4/N5 批准范围已收口，N6/N7 保留原延期。N8-00/01 与 N8-02 均已在各自声明范围内有限收口；N8-02 已完成原定范围独立只读收口，Spec、Standards 两轴均有限 PASS。本次 N8 剩余补验中 A11 在原定真实开发 Host 只读对照范围内有限 PASS并关闭，A9 继续 NOT_RUN，A8/A10 为本次定向范围有限支持，A12 仅支持本轮身份与独立审核范围。Spec 仍部分完成，Standards 仅在已记录范围有限 PASS。完整 N8 仍未完成。** 本次只回填文档，不重跑业务、不改产品、不操作日常版。

“完成”均带预先批准的范围；“已实施”与“验收通过”分开。“延期”是安排，不替代原 FAIL/NOT_RUN/NOT_VERIFIED。

- N1、N2 核心导航/单气泡及同步补丁、N3、N4 简化范围、N5 固定范围已有收口记录。[N5 逐条结果](C:/Users/0/AppData/Local/Temp/reader-n5-completion-20261007/final-results.md)与[独立总审](C:/Users/0/AppData/Local/Temp/reader-n5-completion-20261007/review.md)保留。
- N6 状态为 `N6_NEW_BASELINE_ACCEPTANCE_NOT_CLOSED`：真实 A6 首次接触保存链未通过，A7–A12 未继续；保留成果和停止决定。[最终交接](C:/Users/0/AppData/Local/Temp/reader-n6-final-handoff-20261011-4ac390d2/handoff.md)。
- N7 H1–H6 保留主体改善与受控有限证据；H7 安全移出已有实现、最后 service/UOW 定向 PASS，组件/真实链未闭合；H8 样本边界 LIMITED_PASS；A7/A10 仍 NOT_RUN/NOT_VERIFIED。[H8/H7 交接](C:/Users/0/AppData/Local/Temp/reader-n7-h8-h7-20261016-142000/closing/n7-h8-h7-stop-handoff.md)、[H7 最后交接](C:/Users/0/AppData/Local/Temp/reader-n7-h7-operation-reconcile-20261016-174808/closing/stop-handoff.md)。
- N8-00/01 在原声明范围内有限 PASS（继承），N8-02「请求与历史来源呈现」已完成原定范围独立只读收口，Spec、Standards 两轴均有限 PASS；F01～F05及原 F-01 继承各自范围内已关闭。证据见[本次独立收口报告](C:/Users/0/AppData/Local/Temp/reader-n8-02-closeout-independent-review-20261021-7c2e61b0/review.md)与[证据索引](C:/Users/0/AppData/Local/Temp/reader-n8-02-closeout-independent-review-20261021-7c2e61b0/evidence-index.json)，第一批交接仍见[第一批交接](C:/Users/0/AppData/Local/Temp/reader-n8-stage1-20261019-103443/handoff.md)。本次剩余补验独审见[review.md](C:/Users/0/AppData/Local/Temp/reader-n8-remaining-independent-review-20261021-4b97f0ac/review.md)及[证据索引](C:/Users/0/AppData/Local/Temp/reader-n8-remaining-independent-review-20261021-4b97f0ac/evidence-index.json)：A11 在原定真实开发 Host 只读对照范围内有限 PASS并关闭；A9 继续 NOT_RUN；A8/A10 仅定向有限支持；A12 仅本轮身份与独立审核范围有限支持。完整 A8、A10/A12、完整 N8-03/04 和整版终审不升级。本次不恢复 N6/N7 验收，也不解除第一批旧 harness 的停止。

本次 N8-02 独立审核未补跑业务；来源展示、异步隔离及布局证据包含真实 controller/dialog 受控执行和真实产品 Page/CSS 的受控接口证据。受控 fulfill 不能证明真实 Host、owner、配置保存、AI 或学习持久化；审核文件哈希与 dirty 路径关系也不能外推所有源码、数据或进程绝对未变。本次剩余补验独审同样未补跑业务，采用上一轮真实优化开发 Host/Page 只读执行材料；query POST 不等于写入，也不能据此声称全页没有 POST。

## 已确认 UI 的固定最终收尾清单

本清单仅收尾已有批准要求，不追加全站改版或底层前置工程。[详细执行指令](E:/read-web-next-optimization/docs/design/reader-ui-fixed-closeout-execution-2026-10-19.md)是后续执行模型的范围、文件和完成标准；本次编制不启动产品施工。

| 固定项 | 当前情况 | 唯一剩余与终点 |
| --- | --- | --- |
| UI-1：N8 剩余呈现 | N8-02 已按原定范围独立只读收口，Spec/Standards 均有限 PASS；A11 在原定真实开发 Host 只读对照范围内有限 PASS并关闭；F01～F05及原 F-01继承关闭 | 完整 N8 仍未完成；A9 继续 NOT_RUN，A8/A10 仅定向有限支持，A12 仅本轮身份与独立审核范围有限支持；N8-03/04 及整版终审仍未覆盖，不新增整改工程 |
| UI-2：SRS 两处默认样式覆盖 | 已定位重试按钮字号/内边距/最小高度及两个播放按钮 gap 覆盖；本轮未实测视觉 | 仅修 `E:/read-web-next-optimization/src/features/srs-review/srs-review.css` 的 `.srs-review-save-retry` 与 `.srs-review-play-sequence`，不改行为/评分/持久化 |
| 一次限定验收与停写交接 | N8 剩余补验已执行并完成本轮独立裁决；UI-2 及完整固定 UI 收尾不纳入本次 | A11 仅按真实开发 Host 只读对照范围关闭；A9、完整 A8/A10/A12、N8-03/04 和 UI-2 仍按原边界保留，FAIL/NOT_RUN 不冒称通过 |

原默认换肤、阅读设置、素材简化、本篇整理的既有有限成果保持，不重新施工。N6/N7 已实施与未验项分开，原停止不变；N9 多服务、N10 回收站未完成、N11 素材组织待决定，不作为本清单前置。气泡新外观/自定义主题无最终定稿，Uber 布局重组已否定，原专用控件/正文/播放器/气泡例外保留，不新增必修项。

**没有用户新的明确要求，不增加第三项施工。** 必要验收未过时写“固定清单已实施、验收未完成”并停写，不能靠扩大工程或删除原 FAIL 获得完成。有限收口不等于 99 项功能、全仓或日常推广完成。

## 原路线图全部专题

| 专题 | 对应备注 | 你使用时要得到的改善 | 当前状态与剩余边界 |
| --- | --- | --- | --- |
| N0 核心现象复现与数据流基线 | C11–C14、B9–B12/B14、F3–F4、G6，H4–H6/I4核对 | 查清标记错位、打开反馈、筛选、重复整理和预习限制。 | 诊断分散落实，未统一全量闭合；历史声学错位根因 NOT_VERIFIED。 |
| N1 清退当前本文扫描 | E1–E5 | 移除不用的扫描入口，保留整理、标记和历史数据。 | 按重定范围独立收口；原手工文件 UI NOT_RUN、历史 FAIL 保留。 |
| N2 阅读目标、键盘与气泡 | C1–C14 | 选词、标记目标、导航、键盘与气泡配合。 | C1–C10 核心及同步补丁分别有限收口；不宣称历史听音错位已根治。 |
| N3 阅读入口、设置与模式 | A1–A7、C15–C20、I1–I3/I6 | 设置集中、模式清楚，中文与视频偏好符合习惯。 | 固定十项独立有限收口；完整无媒体阅读及重启未验证。 |
| N4 素材基本流程与恢复反馈 | B1–B12、B14–B21、I4–I5 | 添加/选素材更直接，启动空白，打开结果和修复明确。 | 批准简化范围收口及单个短视频真实补验通过；长视频/批量/故障恢复未据此通过。 |
| N5 本篇学习成果整理 | F1–F11 | 候选、原义/短义、入库、进度恢复和键盘闭环。 | 固定 F1–F11/S1–S20 整体完工，两轴有限 PASS；旧首次空读观察及正常生产评分等边界保留。 |
| N6 独立首次接触预习 | G1–G11 | 来源、资格、组预览、自主进入、恢复、键盘与朗读。 | 已施工，A6 FAIL/BLOCKED、A7–A12 NOT_RUN；停止续修；N+1 等原延期保留。 |
| N7 SRS队列、评分与页面 | H1–H8 | 目标、答案、评分、保存推进及失败恢复清楚可靠。 | 主体已实现；H7 定向服务 PASS、组件未闭；H8 样本边界 LIMITED_PASS；真实 A7/A10 未验。 |
| N8 AI配置与执行来源透明化 | D1/D2/D4/D6 | 看清当前选择、任务用途和结果记录来源。 | N8-00/01 与 N8-02 均在各自声明范围内有限 PASS；A11 在原定真实开发 Host 只读对照范围内有限 PASS并关闭，A9 继续 NOT_RUN，A8/A10 仅定向有限支持，A12 仅本轮身份与独立审核范围有限支持。完整 A8/A10、N8-03/04 和整版终审未升级，完整 N8 仍未完成；证据见[本次剩余补验独审](C:/Users/0/AppData/Local/Temp/reader-n8-remaining-independent-review-20261021-4b97f0ac/review.md)及[索引](C:/Users/0/AppData/Local/Temp/reader-n8-remaining-independent-review-20261021-4b97f0ac/evidence-index.json)。 |
| N9 多AI服务接入 | D3/D5 | 选定服务逐项支持业务并验证失败/重试。 | 未见新服务正式接入完成证据；先选一个服务与一条业务路径。 |
| N10 素材回收站 | B22–B25 | 删除、恢复、永久删除分开，明确关联数据保留。 | 未完成；当前删除记录不是回收站。 |
| N11 素材组织 | B13 | 按需要排序、分组或组织目录，保护引用与回滚。 | 具体需求待决定；现有时间排序/任务尝试分组不等于自定义素材组织。 |

## 原计划的批次顺序

1. **第一批：N0、N1、N2。** 建立故障基线、清退旧扫描、改善阅读核心操作。
2. **第二批：N3、N4、N8。** 阅读设置、素材流程、AI配置透明化。N8原本可以较早安排，不要求按数字等到N7之后。
3. **第三批：N5。** 打通本篇整理、释义与入库。
4. **第四批：N6、N7。** 先共同定义学习记录与复习队列的关系，再分别整理预习与复习。
5. **后续专题：N9、N10、N11。** 多服务、回收站、素材组织按需求成熟度与收益安排；核心学习路径不必等这些扩展全部完成才交付。

当前近期安排：**保留第一批成果；N8-02 已在声明范围内有限 PASS；本次补验已将 A11 在原定真实开发 Host 只读对照范围内登记为有限 PASS并关闭，A9 继续 NOT_RUN，A8/A10 为定向有限支持，A12 仅本轮身份与独立审核范围有限支持；按独审报告保留完整 A8/A10、N8-03/04 及整版终审的原定未覆盖状态。** UI-2、N6/N7 的停止与延期继续按各自既有状态处理，不因本次文档回填自动重开；N9/N10/N11 和新主题不作为本清单前置。不新增整改工程、前置依赖或测试矩阵。

## N6 原目标与当前延期边界

| 层次 | 原备注 | 需要解决的使用问题 |
| --- | --- | --- |
| 为什么给我这些词 | G1–G5 | 来源、选择理由、熟悉词判定、可解释的N+1规则、每组内容预览。 |
| 我能不能自主学习 | G6–G8 | 复习积压可提醒但不完全阻止进入；查看与新建复习记录分开；重开和无候选状态明确。 |
| 每个词如何学习 | G9–G11 | 用法内容明确，键盘前后切换有边界反馈，单词/例句/原文朗读目标一致。 |

以上是原目标，不是完成表。首版 G4 的 N+1/难度建模、G5 的数量调整/换组新规则、G11 新增原文音频入口已明确排除；来源/资格说明等已施工，但真实首次接触链未收口。不能把 SRS 有记录等同已熟悉，不能用 Book 编号充当水平；首次接触、释义揭示和评分分别处理。保持 [N6 最终交接](C:/Users/0/AppData/Local/Temp/reader-n6-final-handoff-20261011-4ac390d2/handoff.md)的停止决定，不把上表重新当作施工授权。

## 延期与未验证清单

- N6：A6 原 FAIL/BLOCKED 与 A7–A12 NOT_RUN 保留；workflow 恢复另案 FAIL、历史逐 ID 缺口 NOT_VERIFIED 不升级。
- N7：H7 原组件挂载 FAIL 保留；最后服务补丁未跑组件/构建/真实 Host，后续独审未完成。H8 仅样本边界有限通过，正式双入口一致性未验；A7/A10 真实评分、持久读回及真关页重开 NOT_RUN/NOT_VERIFIED。后续均需另行明确授权。
- N2 的历史有声错位、N3 完整无媒体阅读、N4 长视频/批量/故障恢复、N5 旧首次空读根因等不因各专题有限收口而自动通过。
- R6/R8/有限 R9 的后续[限定独审已 PASS](C:/Users/0/AppData/Local/Temp/reader-fast-closeout-independent-review-20261004-c1860078/review.md)，原完整生产矩阵和跨轮旅程仍按原 FAIL/NOT_RUN/NOT_VERIFIED 保留。无需根据过期“待审核”段落重做结构线。
- 全仓 Last verified、日常推广状态不变。本次没有重新构建、运行浏览器或验收真实 AI/Owner 链。

## 原文与后续调整分开看

- [原始完整调度路线图](E:/read-web-next-optimization/docs/design/reader-feature-change-scheduling-2026-10-03.md)：顶部为最新导航，其后原调度及阶段记录按日期保留。
- [项目状态](E:/read-web-next-optimization/CURRENT_PROJECT_STATUS.md)：顶部为最新完成/延期/未验证摘要，旧阶段日志不替代最新事实。
- [你的功能意见详细拆解](E:/read-web-next-optimization/docs/design/reader-feature-opinions-breakdown-2026-10-03.md)：43条意见拆出的99项要求，保留明确意图/建议/待决定。
- [N5施工与最终状态](E:/read-web-next-optimization/docs/design/reader-n5-learning-results-plan-2026-10-05.md)。
- [N8 首版施工方案](E:/read-web-next-optimization/docs/design/reader-n8-ai-transparency-plan-2026-10-19.md)：D1/D2/D4/D6、文件范围、步骤及原 A1–A12；顶部补第一批实际状态，不改验收标准。
- [已确认 UI 固定收尾执行指令](E:/read-web-next-optimization/docs/design/reader-ui-fixed-closeout-execution-2026-10-19.md)：只有 UI-1、UI-2 与一次限定验收，供 5.6-luna-max 逐项执行。

已批准的后续调整不回写成原计划：例如N4原本安排时间筛选，后续经用户简化撤除了三个时间按钮、保留内部接口。N4旧owner筛选暂停记录是历史，当前应以N4有限收口及真实单素材补验证据为准。月度学习总览、本地模型等另案内容不自动并入N6。

后续汇报统一沿用：**对应你哪条备注 → 改了什么 → 是否完成 → 尚待什么决定或验收。** 原历史FAIL/NOT_RUN保留，技术结构R编号与功能N编号分别记录。
