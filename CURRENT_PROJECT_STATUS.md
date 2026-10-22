# Read-Web Optimization Current Project Status

## 当前开发版：N8 剩余补验独立裁决后的文档状态（2026-10-21）

独立只读收口与本轮剩余补验已分别裁决：**N8-02「请求与历史来源呈现」已完成原定范围独立只读收口，Spec、Standards 两轴均有限 PASS；本次补验中 A11 在原定真实优化开发 Host、配置及至少一个已有 job/run 的只读 UI 对照范围内有限 PASS并关闭，A9 继续 NOT_RUN，A8/A10 仅对本次实际面板/任务刷新/历史展开/详情/设置及两宽交互得到定向有限支持，A12 仅支持本轮身份与独立审核范围。F01～F05及原 F-01 继承各自范围内已关闭结论。Spec 仍部分完成，Standards 仅在已记录范围有限 PASS，完整 N8 仍未完成。** 本次只回填文档，不改产品、脚本、配置或数据，不补跑业务，不启动浏览器或服务，不操作日常版。本节优先于下方前次同步及历史快照；历史段落保留当时状态，不覆盖当前裁决。

原“Tailwind + shadcn-vue 默认外观、标准尺寸、原位保留布局与操作”的批准范围已有独立 PASS 记录，见[原方案](E:/read-web-next-optimization/docs/design/reader-shadcn-default-inplace-plan.md)及[完成记载](E:/read-web-next-optimization/docs/design/reader-post-migration-cleanup-review.md:9)。不将后续功能页面的欠项改写成整套默认换肤未施工，也不以本次只读核对冒充当前逐屏重验。

| 已确认要求 | 当前状态 | 剩余边界 |
| --- | --- | --- |
| 原默认控件/中性外观/标准尺寸 | 原定范围已完成；共享组件及助手已有默认配方 | 后续 SRS 页面两处局部覆盖单列 UI-2，不重开全站迁移 |
| N3 阅读设置/模式、N4 素材简化/反馈/详情、N5 本篇整理 | 各自批准固定范围已有有限收口 | 原长视频、重启、完整无媒体等未验边界仍保留，不加入本次施工 |
| N6 预习、N7 SRS 主体界面 | 已实施，不是全阶段完整 PASS | N6 A6 FAIL/BLOCKED、A7–A12 NOT_RUN；N7 H7 组件与 A7/A10 真实链等原延期/停止有效 |
| N8 配置与用途 | N8-00/01 在原声明范围内有限 PASS（继承）；第一批 focused/build 与受控设置证据层及旧失败均保留 | 不扩大第一批结论；panel 旧 browser runner、Vite mount 原 FAIL，以及完整 N8 的未覆盖项继续保留 |
| N8 请求与历史来源 | **N8-02 已完成原定范围独立只读收口，Spec/Standards 均有限 PASS**；A11 在原定真实开发 Host 只读对照范围内有限 PASS并关闭；F01～F05及原 F-01继承关闭 | A9 继续 NOT_RUN；A8/A10 仅本次定向范围有限支持，完整 A8/A10 不升级；A12 仅本轮身份与独立审核范围有限支持；完整 N8 仍未完成 |
| SRS 普通按钮默认配方 | 已定位两处局部覆盖，实际视觉未在本轮复测 | `.srs-review-save-retry` 字号/内边距/最小高度、`.srs-review-play-sequence` gap，限 UI-2 修正 |

N8 第一批证据：[handoff](C:/Users/0/AppData/Local/Temp/reader-n8-stage1-20261019-103443/handoff.md)、[原 A1–A12 覆盖表](C:/Users/0/AppData/Local/Temp/reader-n8-stage1-20261019-103443/a1-a12-coverage.md)。只读核对的四个交付文件与其 closing SHA-256 一致；该身份核对不代表构建/浏览器/真实 Host 重验。第一批两次失败后的停止继续有效，不自动开启第三轮旧 harness 修补。

N8-02本次独立收口证据：[review.md](C:/Users/0/AppData/Local/Temp/reader-n8-02-closeout-independent-review-20261021-7c2e61b0/review.md)、[evidence-index.json](C:/Users/0/AppData/Local/Temp/reader-n8-02-closeout-independent-review-20261021-7c2e61b0/evidence-index.json)。审核未补跑业务；来源展示、异步隔离和布局证据包含真实 controller/dialog 受控执行及真实产品 Page/CSS 的受控接口证据，受控 fulfill 不能证明真实 Host、owner、配置保存、AI 或学习持久化。报告中的文件哈希与 dirty 路径关系只支持记录范围，不能外推所有源码、数据或进程绝对未变。

本次 N8 剩余补验独审证据：[review.md](C:/Users/0/AppData/Local/Temp/reader-n8-remaining-independent-review-20261021-4b97f0ac/review.md)、[evidence-index.json](C:/Users/0/AppData/Local/Temp/reader-n8-remaining-independent-review-20261021-4b97f0ac/evidence-index.json)。本次审核未补跑业务，依据上一轮执行材料中的真实优化开发 Host/Page 只读证据及其索引；query POST 仍是读取传输，不称写入，也不声称全页没有 POST。A11 不扩大为全部 run、真实配置保存、AI 调用或学习持久化；A9 未发送保存命令，未执行 B 保存/读回/真关页重开。两宽 A10 的原 `tabStayedInPanel=false` 与首次 ENOENT 保留，原始四次 Tab 记录仅支持本次面板内移动，不扩大为完整快捷键/Tab 循环通过。Spec 仍部分完成，Standards 仅在已记录范围有限 PASS。

**固定终点：两项施工 + 一次限定验收，不增加第三项施工；本次剩余补验独审已停写交接。**

上方 N8-02 及本次 N8 剩余补验独立裁决是当前状态；下方固定终点仍是原 UI 收尾合同，不把 N8-02 或本次 A11/A8/A10/A12 的有限结果扩大为 UI-2、全部固定 UI 收尾或完整 N8 通过。

1. **UI-1：N8 原定剩余呈现。** N8-02 已在声明范围内完成独立只读收口；A11 已在原定真实开发 Host 只读对照范围内有限 PASS并关闭；既有 job/run 来源、历史不重标、缺字段、复用/合并/模拟及现有模型切换事实按报告有限 PASS。A9、完整 A8/A10/A12 及完整 N8 仍是原定未覆盖边界；不加后端字段/存储/路由。
2. **UI-2：修正 SRS 两处精确样式覆盖。** 只改 `E:/read-web-next-optimization/src/features/srs-review/srs-review.css` 两个选择器，恢复共享默认配方，不开放 SRS 行为/评分/持久化。
3. **一次限定验收与停写交接。** N8 沿用原 A1–A12，SRS 只检查 UI-2 固定标准；受控/真实/继承分列，之后交一次按固定范围的独立双轴审核。未通过就如实写已实施/验收未完成，不扩工程追绿。

[可直接交给 5.6-luna-max 的完整执行指令](E:/read-web-next-optimization/docs/design/reader-ui-fixed-closeout-execution-2026-10-19.md)固定了逐步操作、文件白名单、禁止项、验收和停止规则。相对原 N8 的 SRS 保护范围，仅开放 UI-2 两处 CSS；其余 N5/N6/N7 保护不变。

气泡新外观、自定义主题尚无最终视觉定稿；Uber 布局重组已被否定；气泡/正文/播放器/专用候选行是原换肤的保留例外，均不转成新的必修迁移。N9/N10 未完成、N11 待决定仍如实保留，不作为本清单前置。全仓 Last verified、无关 R 状态、日常推广不变；这份清单有限收口不等于所有 99 项功能完成。

## 前次开发版摘要与 N8 准备快照（历史快照：2026-10-19，第一批施工前）

> 本节保留第一批施工前的当时状态；其中 N8-02“未完成/独审未运行”等文字不替代上方 2026-10-21 独立收口裁决。后续裁决见 [N8-02 独立收口报告](C:/Users/0/AppData/Local/Temp/reader-n8-02-closeout-independent-review-20261021-7c2e61b0/review.md)。

本节按原路线图、现存交接、独立报告及当前代表源码同步状态，优先于下方各时点历史记录。用户本轮只授权更新文档和编制 N8 首版施工方案；**产品施工、服务启停、业务补验和日常版操作均未启动。**

### 已完成与已交付

| 对象 | 当前可成立的完成范围 | 证据与边界 |
| --- | --- | --- |
| N1 本文扫描清退 | 预先重定范围独立收口 | [独立报告](C:/Users/0/AppData/Local/Temp/reader-n1-independent-review-20261004/review.md)；原手工文件 UI NOT_RUN、历史 FAIL 保留，不声明全链通过 |
| N2 阅读目标/键盘/气泡 | C1–C10 核心导航和单气泡收口；同步补丁另有有限 PASS | [N2 交接](C:/Users/0/AppData/Local/Temp/reader-n2-core-20261004-16bbc087/handoff.md)、[同步补丁](C:/Users/0/AppData/Local/Temp/reader-sync-fix-20261004-60d5e4ac/main-application/handoff.md)；历史听音错位根因/听感仍 NOT_VERIFIED |
| N3 阅读入口/设置/模式 | 固定十项独立有限收口 | [独立报告](C:/Users/0/AppData/Local/Temp/reader-n3-independent-review-20261005-c9b691ac/review.md)；完整无媒体阅读、重启等未覆盖 |
| N4 素材基本流程 | 用户批准简化范围收口，单个约 19 秒公开视频真实下载/转写/AI/保存/打开播放补验通过 | [有限交接](C:/Users/0/AppData/Local/Temp/reader-n4-remaining-20261005/handoff.md)、[真实单素材审核](C:/Users/0/AppData/Local/Temp/reader-real-chain-20261005-1330/review.md)；三个时间按钮经批准撤除，不是漏施工；长视频/批量/故障恢复未据此通过 |
| N5 本篇学习成果整理 | F1–F11/S1–S20 固定产品范围整体完工，两轴有限 PASS | [总审](C:/Users/0/AppData/Local/Temp/reader-n5-completion-20261007/review.md)、[逐条结果](C:/Users/0/AppData/Local/Temp/reader-n5-completion-20261007/final-results.md)；旧首次空读观察、正常生产评分等未覆盖边界保留 |
| N7 H1–H6 | 队列/目标义/评分说明/保存与恢复/身份及快捷键的主体改善已交付，保留既有受控证据与 LIMITED_PASS | [最后定向修补及受控审核](C:/Users/0/AppData/Local/Temp/reader-n7-repair-20261016-121545/closing/n7-final-repair-handoff.md)；不扩大为真实 Owner 全链通过 |
| N7 H7/H8 后续增量 | H7 已实施安全移出与同操作对账修补，唯一一次定向 service/UOW 检查 PASS；H8 样本入口边界 LIMITED_PASS | [H8/H7 交接](C:/Users/0/AppData/Local/Temp/reader-n7-h8-h7-20261016-142000/closing/n7-h8-h7-stop-handoff.md)、[H7 最后定向交接](C:/Users/0/AppData/Local/Temp/reader-n7-h7-operation-reconcile-20261016-174808/closing/stop-handoff.md)；已有代码不等于组件、真实持久化或全阶段收口 |
| R6/R8/有限 R9 | 用户简化范围已有后续独立 PASS | [限定独审](C:/Users/0/AppData/Local/Temp/reader-fast-closeout-independent-review-20261004-c1860078/review.md)；纠正早期待审核导航，不重写原完整矩阵/跨轮旅程的 FAIL/NOT_RUN/NOT_VERIFIED，不重新启动结构线 |

### 延期、FAIL 与未验证项

“延期”描述后续安排，“FAIL/NOT_RUN/NOT_VERIFIED”描述证据，两者分别保留。

| 项目 | 当前证据状态 | 当前安排 |
| --- | --- | --- |
| N0 全部核心现象 | 未有统一全量闭合结论；历史声学错位等仍 NOT_VERIFIED | 不将各专题有限 PASS 合并为所有故障根治 |
| N6 首次接触真实链 | `N6_NEW_BASELINE_ACCEPTANCE_NOT_CLOSED`；真实 A6 FAIL/BLOCKED，词句可见但无新目标接触/canonical/unit/event；根因未独立确认 | [最终交接](C:/Users/0/AppData/Local/Temp/reader-n6-final-handoff-20261011-4ac390d2/handoff.md)的停止决定有效；不修补、不重跑、不重定范围 |
| N6 后续验收/原延期规则 | A7–A12 NOT_RUN，最终独立双轴未完成；N+1、组操作新规则及原文音频新增入口等首版明确排除 | 保留延期；workflow 恢复原 FAIL_DEFERRED_SEPARATE_CASE、历史 NOT_VERIFIED 不升级 |
| N7 H7 | 原真实 Page 组件挂载超时 FAIL；最后 service/UOW 补丁后组件/构建/浏览器/真实 Host NOT_RUN，后续独审未完成 | 服务层通过不关闭 H7/N7；组件和集成另行授权，不自动重试 |
| N7 H8 | 样本页明确不写正式学习记录；正式双入口一致性未验证 | 保留样本边界有限成果，不宣传两个正式入口等价 |
| N7 A7/A10 | 真实 Host/Owner 评分、持久读回、真关页重开 NOT_RUN/NOT_VERIFIED；隔离包装在启动前 FAIL | [停止交接](C:/Users/0/AppData/Local/Temp/reader-n7-a7a10-20261016-140436/closing/a7-a10-stop-handoff.md)保留；未进入真实评分，不能据此断言评分已坏或已通过；不修包装、不续跑 |
| N8 | 既有配置/历史标签可复用；首版方案已编制，产品/验收均 NOT_RUN | 下一项准备工作；仅按 [N8 首版方案](docs/design/reader-n8-ai-transparency-plan-2026-10-19.md)列定范围，待用户后续明确启动 |
| N9/N10/N11 | N9 新服务、N10 回收站未见完成证据；N11 具体组织方式待决定 | 后续独立专题，不借 N8 提前实施 |
| 全仓与推广 | 真实重启/多设备/声学/完整全仓等原未覆盖项保留 | 全仓 Last verified、日常推广和未涉及的 R 状态不改变 |

当前源码与 2026-10-16 17:48 [H7 closing 清单](C:/Users/0/AppData/Local/Temp/reader-n7-h7-operation-reconcile-20261016-174808/closing/src-source-hashes-after.json)记录的 282 个 `src` 文件哈希相同。该核对只证明这批已记录源码身份延续；本轮没有重跑构建、浏览器、AI、Owner 或业务验收，也不声称当前运行 release 与工作树相同。

历史证据可达性：本次本地链接检查发现，下方原 R1、R2、R7 三份 Temp 报告链接指向的文件当前不存在（`reader-r1-closeout-independent-review-20261003-7c206d4b/review.md`、`reader-r2-independent-review-20261003-b20c8265/review.md`、`reader-r347-independent-review-20261003-f4c052b7/R7-review.md`）。保留原链接和当时状态记载，仅将这三份原件的当前可复核性标为 `NOT_VERIFIED`；不据此撤销历史 PASS、不补造原件，也不启动复验。

以下为保留的历史记录；其中“当前”“待审核”“下一段”等均按当时日期理解。N7 中午的“H7/H8 延期”已由本节补足晚间实现进展；原失败与停止决定不删除、不改写。

### N7 用户授权有限收尾（2026-10-16）

**N7 现阶段按用户“直接收尾”决定结束施工与补验，保留已完成成果，不再继续修补循环。** H1–H6 的定向改善及既有受控证据保留；最后一轮快捷键弹层修补与 A9 受控证据的独立 Spec/Standards 结论为 `LIMITED_PASS`，不扩大为原固定验收全量 PASS。浏览器隔离场景实测代表键为 `1`，`2–4` 仅有共同源码分支核对，未逐键浏览器实测。

A7/A10 真实 Host、Owner 评分与持久读回、真关页重开仍为 `NOT_RUN/NOT_VERIFIED`，转为本次收尾的明确延期项；H7 安全移出及 H8 正式双入口一致性继续延期。隔离补验在启动前路径校验失败，按规则停止；包装的路径前缀、initializer 目录布局及 `$Host` 变量问题保留证据，不再修补或重试。该补验未进入 Owner 初始化、N5 正式链或真实评分。

产品交接：[N7 最后定向修补及受控审核](C:/Users/0/AppData/Local/Temp/reader-n7-repair-20261016-121545/closing/n7-final-repair-handoff.md)；补验停止证据：[A7/A10 停止交接](C:/Users/0/AppData/Local/Temp/reader-n7-a7a10-20261016-140436/closing/a7-a10-stop-handoff.md)。N6 仍为 `N6_NEW_BASELINE_ACCEPTANCE_NOT_CLOSED`。本次仅补记状态与交接，不修改产品、配置或学习数据，不运行验收或操作服务；日常版及旧保护树不操作，全仓 Last verified、R 状态和推广状态不变。后续若再开展延期项，须另行明确授权。

### N5-07 性能分段与当前功能总验有限收口（2026-10-06）

Spec/Standards 独立只读审核均 LIMITED_PASS，固定范围无阻断产品 P0–P2；opening1258 与前05d closing完全一致，审核1259路径零漂移。仅移除本篇候选列表以标注为键的派生缓存，每次打开使用现有批量读取核对当前词库资格，保留有效短义及待保存精简缓存；新增六项直接controller回归。实际优化production对公共测试素材新增long，正常标记→真实AI联合两义→整理只加入该词→保存→真实关页/新开空白→显式重开→桌面/窄屏实际保存数据的只读复习答案通过；旧437词/417语境/128legacy状态/31日志/199canonical状态/1281事件及旧标注、5项精简记录逐值保持，仅long新增1词/语境/单元/初始状态与4未评分事件。重开及空白补验前后完整owner payload/revision1429/17相同。

分段测量完成：当前小样本与声明250项候选构建约7–8ms；实际重开owner请求跨度5.0秒，单词保存14个owner请求跨度34.3秒，主要等待owner请求/提交。未提速，后端精确CPU/磁盘分解未验证，owner性能优化仍后续项。旧status/selection脚本各两轮NOT_PASS及preview-ui网络空闲超时FAIL保留，已停止第三轮；两路源码核对未将夹具错误判为产品回归，也不改写runner通过。其他早期有限证据为继承，非本轮全部重跑。

证据 C:/Users/0/AppData/Local/Temp/reader-n5-07-20261006/review.md。本轮07有限收口不代表全部N5或性能优化完工；06键盘选词/发音/移出间距与视觉密度由用户延期。正常生产评分队列、真实多窗口故障、系统重启、多设备、SDK精确发送/token及全仓未覆盖边界保留。审核后只追加三份既定状态文档；未提交、未清理旧dirty/合法测试数据，不改schema/authority/评分、保护树、全仓Last verified、R或推广。优化服务与结果页留供查看。

### N3 独立收口（2026-10-05）

N3 按预先固定十项验收独立收口，Spec/Standards 两轴有限 PASS，无阻断 P0–P2。报告：C:/Users/0/AppData/Local/Temp/reader-n3-independent-review-20261005-c9b691ac/review.md。当前 1246 个 closing 源码身份无漂移。本次未重跑业务旅程，历史 FAIL/NOT_RUN/NOT_VERIFIED 保留；不更新全仓 Last verified、R 状态或推广。N4 按用户批准顺序另开施工基线。

Last verified: 2026-08-30

### N5-03 两义对比施工与部分验收（2026-10-05）

原解释/精简义默认同时显示，桌面并排、窄屏上下；长原解释可全文展开，缺少/处理中/中断/失败/无结果/过长状态简短区分，合法旧短义保留。既有拒绝结果error现保存并重开读取。发现并修正SRS V2同源context的短义被sense gloss遮盖：仅article-settlement、同word/source/exact sentence/normalized sense且唯一合格短义作只读投影；不改词义身份、schema、调度或记录。

focused、SRS V2九类投影回归、桌面/窄屏释义声明检查、01/02回归、正确source Vite加载/播放/交互及标准优化production构建PASS。真实Gemini一次精简三条声明原解释，三短义保存/关闭重开一致；正常UI只加入测试trunks，后台owner完成，原义保留；真实owner数据经产品card service/answer resolver读出“象鼻”。正常今日复习首卡resolution，无无评分定向入口，**trunks实际正常卡片答案仍NOT_RUN，03未完全验收，04未放行，N5未完成**。独立审阅与执行证据见C:/Users/0/AppData/Local/Temp/reader-n5-03-20261005/。

入库快照中既有34 annotation、433 word、413 context、128 legacy reviewState和31 reviewLog逐值不变；之后正常复习的既有富集更新vowing通用词义缓存字段，原义/身份与评分记录不变，不称最终所有旧词零变化。原健康接口404、生产跑source-only检查、夹具及历史FAIL保留。自动精简/API次数质量05、键盘选词/发音/操作距离06、其余04–07仍待完成。本地模型后续；不更新全仓Last verified、R或推广，不提交/清理旧脏树或写日常/历史树。

本文档描述 `E:\read-web-next-optimization` 的当前事实。`E:\read-web-next` 是受保护的日常 reader，`E:\read-web` 是历史只读参考；两者不得被本工作区读取、构建、启动或写入。

## R3/R4/R7 职责迁移与阶段二共享合入（2026-10-03）

R2 已独立 PASS，按 dispatch 第8节进入 R3/R4/R7 并行职责迁移。R3 列表/轮询与 revision/receipt 分归两个 Panel 范围模块，模板、CSS、App 和 R2 保存/loader 原字节保持。R3 关闭保存专项（2026-10-04）执行及父独立审核 PASS，原固定 R3-A1–A6 已独立 PASS：本次补齐 A5 剩余关闭缺口，其余按无漂移源及原证据继承。此专项产品零修改，保留原 open/endLoad 一行补修；失败定位边界是本机 Temp 入口的全量 browser route 拦截。正式完整 App open/mark/switch/真实关闭后服务确认原 session 的 close，原 operation 正常启动幂等补发及确认后清 outbox 通过。原集中批次 close 确认 FAIL 与本专项 route 诊断 FAIL 保留；原完整 Panel、完整 10 组和 12 外观上下文本专项 NOT_RUN，仅按身份继承，见 [R3 关闭保存专项独立审核](C:/Users/0/AppData/Local/Temp/reader-r3-close-save-independent-review-20261004-d7bcf77b/review.md)。R4 父固定产品验收与 R7 父独立验收已通过，具体范围及保留失败见下文。R5 待重定界，R6/R8/R9 未启动；原 FAIL/NOT_RUN/NOT_VERIFIED 保留。既有 batch-jobs 检查的 data URL 相对导入 FAIL 已留存；阶段二按授权改为真实 client 模块图导入，原请求断言保持，正式 verify:youtube-workflow-batch-jobs 通过。

## 阅读保存生命周期 R2（2026-10-03）

`App.vue` 创建、提供并启动唯一阅读保存范围；`YouTubeWorkflowPanel.vue` 注入同一只读会话接口，只拥有素材 UI、loader 取消登记和可卸载的最近阅读项订阅。Panel 卸载后核心 marks/activity/page-close 保存继续存活，重挂不新建保存会话；根卸载先取消真实 loader，再关闭落盘并释放保存监听。基础保存服务、loader 行为、模板/CSS 和 IndexedDB schema 未改。

R1 已独立 PASS。R2 执行自检及限定收尾后已由父独立复审 PASS，见 [R2 独立报告](C:/Users/0/AppData/Local/Temp/reader-r2-independent-review-20261003-b20c8265/review.md)；两次原失败证据仍保留。fresh 隔离生产构建的原七组恢复、真实根卸载、当前阅读交互和新增生命周期场景通过；11 项 focused 与 session-load-browser 按实现/检查/依赖身份无漂移继承，未重跑。配对 synthetic persisted hide/show 只证明合同覆盖，真实 BFCache、用户 Host/数据与设备未验证；本轮完整 npm test/verify:full、正式 verify:vite/production-preview alias 未运行。文档顶部的历史全仓库 Last verified 与既有历史结果不因此刷新。

## Optimization owner milestone (2026-08-30)

六域 C2 已在临时 optimization profile 中按 `Reader Session → marks-activity → passage-preview →
annotation → vocabulary-srs → workflow` 完成真实 Host cutover journey。每域都经过只读 inventory/dry-run、
持久 freeze、freeze 后 final backup/checksum、唯一 import、verify、per-domain checkpoint、typed smoke 和
Local App Host 重开读取；已打开 browser guard 能在 final backup 前观察 freeze。成功 checkpoint 后旧的
browser canonical writer 由 domain guard 阻断，typed Host API 是 durable mutation path；未有 checkpoint 的
普通 profile 仍保持 pre-cutover/not-ready。

生产入口是显式 optimization-only 的 `runWindowsOwnerProductionCutover`，只使用隔离 profile，不自动迁移
日常数据，不改变外部 shortcut，也不开放非-loopback transport。完整媒体仍只传 identity/reference 与授权
Range URL，`SeekPlayerDB` 仍为 v1/files/id，`reader-runtime.js` 与 `session-init.js` 仍为薄入口。

受控的一次性 wrapper 是 `scripts/windows-owner-production-entry.mjs`，提供显式 `plan`、`inventory`、
`dry-run`、`apply`、`resume`、`rollback` 命令。apply/resume 需要当前 browser guard 在每个 freeze 后提供
evidence；wrapper 目前只做 fixture verification，不读取或迁移日常 profile。

已通过的核心证据包括 `npm run verify:windows-owner-c2`、C1/C2b/C2c 与六域 owner focused gates、
`npm run verify:windows-owner-focused-boundaries`、`npm run build`、`npm run verify:fast`、test inventory
和 OpenSpec strict validation。`npm run verify:full` 在既有 Python dependency-health 阶段因安装环境中同时
存在多个 `networkx` 与 `torchaudio` 版本而停止，未把该阻断后的阶段当作通过。

## 本轮单人工具优化收尾（2026-09-13）

本节只记录 `task-op-1`～`task-op-14` 的局部优化边界，不修改文档顶部的全仓库 `Last verified: 2026-08-30`，也不表示历史 Host、发布、迁移或 full 验证结果已被重新核实。

六个方向的状态如下：

1. 健康检查请求协调：完成。
2. 优化环境默认配置：完成。
3. 大文件职责拆分：本轮既定前端边界已收尾；预习、outbox、保存队列/冲突、播放跟踪和标记恢复已有独立所有者，面板仍保留材料操作与生命周期接线。
4. 长材料渲染：共享高亮索引、句高亮局部更新和普通/chunk 模式切换优化已收尾。
5. 学习页面按需加载：完成；SRS 与 Passage Preview 页面延迟加载，设置弹窗保持静态加载。
6. 旧检查与文档整理：本批入口核对、旧 panel 兼容入口保留和架构文档同步完成。

task-op-12/13 的历史报告显示，10,000 词材料的稳定跨帧切换 p95 为普通→chunk `38.8～42.0ms`、chunk→普通 `52.9～59.2ms`，句高亮约 `13ms` 且长任务为零。上述数字来自隔离 Vite 开发环境的合成材料测量，本批没有复测；稳定跨帧计时与原 mode 计时不可混用。剩余布局成本不在本轮继续拆分，也不作为追加虚拟列表任务的理由。

### 本轮检查入口与归属

| 范围 | 当前入口 | 归属与边界 |
| --- | --- | --- |
| transcript state | `npm run verify:transcript-state` | package.json 正式行为入口 |
| panel V3 | `npm run verify:youtube-workflow-panel`；浏览器为 `npm run verify:youtube-workflow-panel-behavior` | package.json 正式入口；旧 `node scripts/youtube-workflow-panel-check.cjs` 保留并转接 V3 |
| reader marks hydration | `node scripts/reader-marks-hydration-check.mjs` | inventory-only focused behavior 入口 |
| reader playback tracker | `node scripts/reader-playback-tracker-check.mjs` | inventory-only focused behavior 入口 |
| workflow reader marks ledger | `npm run verify:workflow-reader-ledger` | package.json 正式架构/行为入口 |
| learning page lazy load | `node scripts/learning-page-lazy-load-check.cjs` | inventory-only browser 入口；沿用已有 Vite 与 dist preview 前置 |
| vocabulary preview UI | `npm run verify:vocabulary-preview-ui` | package.json 正式 browser/behavior 入口；无 `READ_WEB_URL` 时脚本自启隔离 Vite |
| sentence highlight UI | `node scripts/sentence-highlight-ui-check.mjs` | inventory-only browser 入口；默认自启隔离 Vite |
| playback scale capture/diagnostics | `npm run verify:performance:playback-scale` | package.json 性能入口；sentence/mode 诊断仍由既有环境变量可选开启，本批不再做性能实验 |

panel browser 检查继续使用既有 `READ_WEB_URL`/运行中 Vite 前置；playback-scale 入口默认自启隔离服务。上述入口未重新串成总入口，`docs/architecture/script-inventory.json` 与 `docs/architecture/test-inventory.json` 本批无须改动。

本批不刷新 Host cutover、发布、数据迁移、旧 full 结果或 BFCache 的既有合成覆盖；这些历史边界仍按原文记录处理。

## 1. 产品与运行形态

Read-Web 是本地英语学习应用，前端为 Vite + Vue 3 + Pinia，材料处理服务为 FastAPI。当前可用能力包括：

- 音视频与同步字幕阅读；
- word/sentence/chunk 高亮、seek 和跟随；
- marks、轻量 annotation 导入/导出；
- YouTube/本地材料处理工作流；
- 词汇预习、SRS、个性化只读诊断；
- 可选本地 ECDICT、句库、TTS 与翻译服务。

应用仍是混合架构。Vue/Pinia 和 legacy DOM/window 兼容层并存；稳定化工作按边界逐步移除兼容面，而不是一次性重写。

## 2. 当前入口与加载顺序

浏览器入口是 `index.html`，不是已退役的 `read-26.html`。

```text
index.html
├── glass/app/style/import/keyboard/media/playback/controls/legacy bindings
└── src/main.js
    ├── 创建 Vue 与 Pinia
    ├── 配置显式 runtime store registry 并绑定 state adapter
    ├── 导入 reader/session 薄入口
    └── 挂载 App.vue
```

`reader-runtime.js` 和 `session-init.js` 都是薄入口。功能逻辑应进入 focused module、service、store 或 Vue component，不应重新堆进入口文件。

## 3. 状态与数据所有权

- `src/pinia-stores/` 的 7 个真实 store（audio、transcript、chunk、marks、UI、theme、annotation）是 Pinia 状态所有者；`runtime-registry.js` 只提供显式访问。
- theme/audio/marks/UI 状态由 `src/pinia-stores/` 单独拥有；旧 `src/stores/` 启动兼容层已删除。
- `runtimeState` 和 `bridgeToPinia` 只通过模块导入使用；`window.__state`、`window.__piniaStores` 与 `window.bridgeToPinia` 已删除。
- Cloze store/adapter 与当前 `manualChunkStates` 装配、恢复、快照和回滚字段已退休；原有 `st.manualChunkStates` 历史偏好清理保留。
- 无产品消费者的预习 query-launch helper、translation queue 和 `__clozeState`/`__glassEffects`/`__legacyControlBindings` 发布已退休；当前预习、翻译/预加载、AI chunk、glass 初始化及控件自动绑定保留。
- `ApplicationPersistence` 统一打开 `SeekPlayerDB` v1/files，并以 transaction complete 作为成功条件。
- YouTube Reader Session 已具备 generation/abort/latest-wins 与 committed manifest/revision/contentId 校验；损坏的 committed session fail-closed。
- marks/activity 通过 latest-wins ledger 合并写入。
- 大媒体通过授权 URL、HTTP Range、ETag 播放；Blob/Object URL 必须由显式 owner 释放。

IndexedDB 固定为：

```text
SeekPlayerDB / version 1 / files / keyPath id
```

## 4. 本地后台

`tools/subtitle-workflow/youtube_workflow/service.py` 提供材料任务、历史、媒体 Range、Reader activity/marks、维护和诊断接口。

AI 标注的 operation/线程/pool/model slot、cancel/deadline 与 run 输出由 `annotation_backfill_runtime.py` 单一范围管理；模板 scope/batch/validate/merge/history helpers 在 `annotation_backfill_template.py`。`JobManager` 保留公开 annotation 委托和字典共用 requester，普通任务与 HTTP 契约不变。R7 已由父独立审核 PASS：115 项测试、34 个模板样例对照及真实临时 HTTP 通过，见 [R7 独立报告](C:/Users/0/AppData/Local/Temp/reader-r347-independent-review-20261003-f4c052b7/R7-review.md)；R8 未启动。

当前可靠性边界包括：

- loopback Host/Origin 校验；可选短期 token capability；
- batch job snapshot 与前端 single-flight polling；
- 有界内存 event ring，持久化 snapshot 不保存完整 stdout；
- crash-safe JSON temp/fsync/replace/backup/recovery；
- requestId、Server-Timing 和有界 route metrics；
- NativePicker 的单实例、超时、取消与 typed outcome；
- app lifespan 负责关闭 worker/timer 并完成最终持久化。

Vite 仍承载 9 组本地能力插件。optimization 已有 built-dist 单一 Local App Host；daily-production 入口也只允许以 built-dist Host 作为候选，但它不会把未完成的六域 owner migration 伪装成 authoritative。

## 5. 性能与已确认风险

已确认并正在处理的主要风险：

- 大材料打开链必须保证不下载并复制整份 300–540MB 媒体；
- Reader feature/session assembly 仍有过宽参数袋和较多 global ordering；
- 个别持久化域仍是多文档、无 CAS 或 legacy writer；
- AI/backfill、外部进程取消和资源分阶段队列仍需深化；
- 源码形状 guard 很多，行为与性能门禁仍在逐步补齐；
- R1 已将标记应用、activity、关闭补发及页面监听接线集中到 `use-reader-session-persistence.js`，复用原 outbox、保存队列/冲突、播放跟踪和标记恢复所有者。`YouTubeWorkflowPanel.vue` 保留材料操作、加载器和保存范围的显式启停；执行自检完成，待独立复审（WAIT_REVIEW），R2 尚未施工，保存生命周期仍属于面板。`tools/subtitle-workflow/youtube_workflow/service.py` 仍是独立的后台维护问题，不能被本轮前端整理视为已解决，也不在本批新增任务。

性能预算目前区分 diagnostic baseline 与 enforced gate，不用拍脑袋的数字伪装完成。浏览器 journeys 会采集错误、请求失败、Long Task 与交互时延；后端 benchmark 使用隔离端口和临时数据。

## 6. 验证层级

- `npm run verify:fast`：固定工具链与关键纯行为检查。
- `node scripts/verify-full.mjs`：fast、build、隔离 dev journeys、production preview、完整 Python suite。
- focused `verify:*`：模块迁移与架构边界检查。
- `verify:ui-compatibility-store`：UI Pinia 唯一 owner、retired `__uiStore` 缺失与可见 toast/error 行为检查。
- `openspec validate stabilize-and-simplify-read-web --strict`：规格结构校验。

`npm test` 当前执行 canonical `verify:full`。12.3 已用真实 browser/workflow 数据的只读副本完成六域隔离恢复、重开、checksum 与六条旅程验证；12.4 已完成三次冷启、30 分钟播放、A/B/A 快速切换、服务重启、进程取消、36 格 Quota/损坏恢复和内存增长验收。12.5 已完成旧版与 Next 的同 fixture 三轮差分：两版各 21/21 journeys、零浏览器/网络错误，十项指标中六项改善，总体比率 1.055。12.6 已补齐 current/previous manifest、逐 artifact SHA-256、health 与原子 release-target rollback；12.7 已完成快捷方式隔离回滚演练。真实桌面快捷方式不属于本 worktree 验证范围，daily-production promotion 仍需新的明确确认。

## 7. 隔离与迁移状态

- 优化 workspace：`E:\read-web-next-optimization`；手工 built Host 使用 `5184/8776` 与 `E:\ReadWebData\SubtitleWorkflow-Optimization`。
- Tailnet 入口是本 change 新增的显式例外：手动运行 optimization launcher 后，由 Tailscale Serve 将
  `127.0.0.1:5184` 发布为 tailnet 私有 HTTPS `:5184`；不新增通用 transport mode，不启用 Funnel，
  内部 Host 动态端口与 `8776` 继续 loopback。完整 MagicDNS 名称只在运行时传入前门参数，不提交到代码。
- 当前日常安装/工作区：`E:\read-web-next`，现有 origin 使用 `5174/8766` 与 `E:\ReadWebData\SubtitleWorkflow-Next`；该树和现有 Vite/dev 兼容 launcher 受保护。
- daily-production 候选由本 worktree 的独立 launcher 以 built-dist Host 提供，不能把当前日常 origin 的现有 Vite/dev owner 误写成 built Host。
- 旧日常回退参考：`E:\read-web`，`5173/8765`；不得由本 worktree 构建、启动或写入。
- 自动浏览器验证使用 `4193/4194` 和随机 browser-safe 端口，并排除上述两组日常端口。
- 桌面快捷方式不属于本次实现范围；验证不会读取、改写或删除它。正式切换必须另行获得用户明确确认，并保留旧目标。

此前的 Next 迁移记录仅作为历史上下文；本次 daily-production promotion 不默认重放该切换，也不把快捷方式状态当作本 worktree 的事实。

### daily-production promotion（显式、最小入口）

`scripts/launch-daily-production.ps1` 默认执行只读 `Plan`，固定识别 profile `daily-production`、当前日常 `5174/8766` 和 `SubtitleWorkflow-Next`。`Apply` 必须带 `-ConfirmDailyProductionApply`；它只构建并启动本 worktree 产出的 built-dist Host，要求两个端口空闲，不会自动停止旧进程，也不会接管未知占用者。`Start`、`Stop`、`Rollback` 均使用 PID/start-time/executable/argument、health、release、profile 和 data-root identity；release、目标状态和 rollback state 分开保留。

Host health 的 `ownerMode.authoritativeDomains` 未覆盖 `reader-session`、`marks-activity`、`passage-preview`、`annotation`、`vocabulary-srs`、`workflow` 六域时，promotion 输出 `legacy-browser-owner/pre-cutover`；只有六域全部 checkpoint 后才能显示 `host-api-authoritative`。

## 8. 文档优先级

当前事实按以下顺序判断：

1. 实际代码与可重复测试；
2. 本文档；
3. `PROJECT_MAP.md`；
4. `docs/OPERATIONS.md`；
5. `AGENTS.md`。

标有“历史/Archived”的设计与迁移文档只用于追溯，不是当前操作说明。

## R4阶段1职责迁移状态

媒体与整句翻译已从SrsReviewPage script迁至两个focused composable，保留A续修的退出作废、同卡重开、旧success/catch/finally隔离及缓存语义。四项focused与完整13场景已在隔离Temp/随机loopback执行自检通过，原检查启动FAIL日志保留。父按原 A1–A7 固定产品验收通过，见 [R4 独立复审](C:/Users/0/AppData/Local/Temp/reader-r347-independent-review-20261003-f4c052b7/bounded-closeout-20261003/R4-independent-review.md)。原辅助 18 组比较中 13 PASS、5 个 borderColor 过渡采样 FAIL、aggregate exit1 保留，不表示全部检查全绿；R6 未启动。


N1 本文扫描清退执行记录（2026-10-04）：两个扫描/显示入口及专用生产、显示、词典富集支路已撤除；本文整理、历史来源识别和独立学习入口保留。执行验收未完成：J3 现有手工导入入口不可达，句高亮正式检查失败；独立审核 NOT_RUN，R5 未放行。具体命令、失败与未覆盖项见本轮 Temp handoff.md：C:/Users/0/AppData/Local/Temp/reader-n1-resume-20261004-582b711a/handoff.md。此记录不更新全仓 Last verified 或前轮结论。


N1 补充执行（2026-10-04）：用户授权重定后，句高亮完整检查、匹配 target 的普通 AI/真实轻量合并与旧扫描来源/mark 保护、动画稳定的四组合生产矩阵及 drag/resize/focus、代表 loading/empty/长列表/relearn/error 对照通过。处理中 UI 已观测；补充 producer 完成响应合同错误的原 FAIL 保留，停止追加修补。原手工文件 UI 缺口不伪装为旅程通过，按方案补充范围改用既有 AI 导入链；dictionary 全入口的既有 FAIL 保留并有原 opening 复现。独立审核 NOT_RUN、R5 未放行，见 C:/Users/0/AppData/Local/Temp/reader-n1-supplement-20261004-2c83b798/handoff.md；不更新全仓 Last verified。


### N1 独立收口（2026-10-04）

**N1 独立 PASS，限于方案预先重定后的验收范围，现已收口。** 独立审核未发现阻断收口的 P0–P2 问题，见[独立审核报告](C:/Users/0/AppData/Local/Temp/reader-n1-independent-review-20261004/review.md)。最后 completion 补测已闭合精简完成、进度保存及关闭重开读取；原失败尝试保留。原手工文件 UI 旅程仍为 NOT_RUN，dictionary:test 整入口仍为既有 FAIL，按重定范围保留另案；本审核未重跑业务测试。此前执行/补充段落是各阶段历史记录，不再代表当前 N1 状态。

R5 旧扫描/双入口扫描子范围标为“因功能退休取消”，不是 R5 PASS；R5 保留本文整理职责的方案仍须定稿及明确调度，尚未启动。R5 opening 应以 N1 本次收口后的当前源码及 closing 身份为基线，见 C:/Users/0/AppData/Local/Temp/reader-n1-closeout-20261004-e83a5c18/closing-manifest.json，不以 HEAD 或清退前源码代替。未更改 R9、全仓 Last verified 或推广状态。


### R5 本文整理职责迁移独立收口（2026-10-04）

R5按重定固定A1–A7独立PASS，见[独立报告](C:/Users/0/AppData/Local/Temp/reader-r5-independent-review-20261004-6bfa8721/review.md)。本文整理DOM、候选展示/展开、按钮、拖拽缩放、发音、关闭释放与焦点返回由src/features/vocabulary-preview/create-article-settlement-dialog.js单独拥有；vocabulary-preview-module.js继续负责文章身份、缓存、进度、AI、claim、入库及owner协调。workflow-ui.css仅补准确@source，生产CSS哈希保持。D/M/B前置分别独立PASS；原手工文件旅程NOT_RUN且功能已退役并清退，原dictionary历史FAIL保留。R5当前生产四组合/代表状态/精简保存重开/words-all-skip通过；切文原伪PASS撤回INVALID，当前桌面/移动完成隔离补证有效，opening桌面补测FAIL保留，迟到完成配对仍NOT_VERIFIED。源码及原日志见C:/Users/0/AppData/Local/Temp/reader-r5-settlement-dialog-20261004-01a10648/handoff.md。旧扫描范围因功能退休取消，不改为PASS；不更新全仓Last verified或推广状态。R6/R8/R9尚未施工，后续按R6→R8→R9执行。此前相关段落为历史记录。


### 大文件职责整理有限收尾（2026-10-04）

用户要求简化并尽快完成后，R6模板/弹窗/controller及R8三组HTTP路由已施工；针对性检查、156项后端测试、路由/OpenAPI及生成CSS身份、当前Vite加载/播放/交互通过。R9仅完成身份/接线/清单/文档与现有检查的有限自检；R6/R8及本轮R9独立审核NOT_RUN，原完整跨轮生产旅程未补齐。既有architecture与workflow-streaming检查FAIL已在opening副本复现；当前dictionary:test 30项PASS。此前阶段状态段落保留为历史，不代表最新状态。 详见[2026-10-04 有限收尾交接](E:/read-web-next-optimization/docs/design/reader-large-file-decomposition/handoff.md)。

AI模板与弹窗分别由src/features/annotation-backfill/annotation-backfill-template.js、create-annotation-backfill-dialog.js拥有；annotation-backfill-ai-module.js保留运行/身份/导入协调。youtube_workflow/http下workflow_routes、reader_media_routes、capability_routes及__init__按原顺序集中55个业务端点；service.create_app保留安全/lifespan/metrics/CORS装配，R7及其它service实现保持。源码有限施工已结束，不刷新全仓Last verified，不宣布原R1–R9或全仓独立PASS，功能改造未施工。

### N3新审核与N4本轮有限验收（2026-10-05）

N3新两轴只读审核均有限PASS，未重跑业务。随后N4原五步前端施工及用户重定完成，Spec/Standards独立有限PASS：正常空白启动保留存储与设置；打开与本地字幕标题/反馈对应、失败保留旧内容；单链接默认和可展开批量、原去重/非阻塞元信息、任务重试/取消；移除三个时间按钮，内部查询/轮询/时间数据保留并注明时间来源；详情先说明结果、同级修复/独立关闭、确认显示目标阶段及已知影响，取消不发修改请求。重开只清临时错误提示，保留可重试任务；月度学习总览另案。

源码和生产各17项声明界面旅程、生产加载、focused/loader/publisher、构建、5184及隔离Vite三段PASS。此前FAIL包括旧restore等待、首轮5184挂载超时、runner定位/批量失焦位移诊断仍保留。有限收口仅覆盖源码与声明数据/请求旅程，真实Host/AI、owner/committed真实持久路径、系统重启和全仓NOT_RUN/未验证；不更新全仓Last verified、R状态或推广。证据及最终身份：C:/Users/0/AppData/Local/Temp/reader-n4-remaining-20261005/handoff.md；N3新审核：C:/Users/0/AppData/Local/Temp/reader-n3-fresh-review-20261005-67a5f34d/review.md。未提交，现有脏树保留。

### N4 单素材真实链路补验（2026-10-05）

上述真实Host/AI NOT_RUN为补验前历史。本轮先只读核对N1、N2-A/同步补丁、N3有限收口，再通过实际优化production Host/UI提交Me at the zoo（约19秒，任务802eb5775a5c），真实下载、WhisperX转写、Gemini real切分/翻译、保存、库中打开与播放通过；产物哈希匹配，刷新及关闭页签再新开为空白，素材保留且显式重开正常。Spec/Standards独立证据复核均有限PASS，无阻断P0–P2，未重跑业务。执行/审核时1,253路径零漂移，本轮产品代码保持，仅追加三份状态文档；测试服务/页签已清理，素材和任务保留。证据 C:/Users/0/AppData/Local/Temp/reader-real-chain-20261005-1330/review.md。不是所有owner/committed来源或全部环境验收；原FAIL、系统重启、长视频/批量、故障恢复、声学听辨及全仓缺口保留，不更新全仓Last verified、R状态或推广。

### N5 需求与分段准备（2026-10-05）

用户明确进入N5并要求仔细拆开。已核对F1–F11、现有候选/选择/释义/进度/后台入库/acquisition/owner消费者和R5独立收口，形成[八段方案](E:/read-web-next-optimization/docs/design/reader-n5-learning-results-plan-2026-10-05.md)：00现状基线、01打开状态、02候选选择/跳过、03原义/短义、04入库与恢复、05自动精简、06键盘、07性能/整体验收。数据恢复先于自动AI施工；移出草稿/确认跳过、自动触发/失败继续等推荐规则在对应产品阶段前定稿，不视作文档建议已批准实施。本轮仅源码准备和文档，N5运行基线/产品施工/独立验收均NOT_RUN；未修改产品、运行服务或用户数据。opening对N4最终1,253路径零漂移，证据C:/Users/0/AppData/Local/Temp/reader-n5-planning-20261005。保留旧FAIL/未验及全仓/R/推广状态。

N5用户补充确认（2026-10-05）：八段顺序认可；单项移出可恢复，UI文字状态/独立操作防误点；整篇不加入保留为低频入口，与关闭/单项/主入库区分；点击整理、读取候选及核对缓存后即自动精简，无需再点下一步或手动精简，每项同时对比原解释与AI精简（窄屏可上下），原义保留。方案已将旧“调整后进入释义再触发”建议替换为这一要求，并补精简期间移出/放回及回包不得改本次选择的验收。尚未修改产品；00运行基线、01–07施工与独立验收仍NOT_RUN，下一步00实测后01状态说明。其它未明确的持久语义按具体合同定稿，已确认三点不重复询问。文档身份及原副本见C:/Users/0/AppData/Local/Temp/reader-n5-user-decisions-20261005。

N5调用减少准备（2026-10-05）：用户要求减少API次数且不减弱精度，其他要求认可。源码确认下载加工的Gemini切分/中文翻译各为独立请求，普通标注默认15项分批，整理精简另有单请求/复用机制；不把生命周期固定为3次。方案增加同批标注详细义＋短义、整理直接复用且仅缺失目标补精简的候选路线，保留小批/必要上下文和下载两步，00/05预先固定C1–C4真实质量/次数对比后才采用；单批无缓存无重试全流程理论4→3不是实测结论。只更新三份文档，opening1,254路径零漂移，证据C:/Users/0/AppData/Local/Temp/reader-n5-ai-call-design-20261005。产品/联合provider对比NOT_RUN；不改历史FAIL或全仓/R/推广状态。

### N5-01 打开与状态说明有限收口（2026-10-05）

用户授权进入N5后，先保存当前脏树1254路径opening，并预先固定S1–S3。本轮完成01及其所需打开基线：读取中/失败与空候选分开、失败可重读、加入/跳过历史与本次待处理分开、关闭迟到读取隔离及焦点恢复。按用户最新要求去掉副标题、全零统计及长指导文案，空列表只留一句；非零分类按需展开。修复隐藏状态栏后的footer伸长，保持原列表/操作行和窄屏自然换行。

focused与桌面/窄屏16项声明案例（含操作几何）PASS；标准优化production5184真实库中打开Me at the zoo、加载/空状态/关闭重开PASS，真实vocabulary/SRS owner前后revision1381、1594 keys、records完全一致；正确source Vite加载/播放/交互三段PASS，生产构建PASS。Spec/Standards两路独立只读复核均有限PASS，无阻断P0–P2，未重跑业务，审核时1255路径closing零漂移。证据C:/Users/0/AppData/Local/Temp/reader-n5-01-20261005/review.md。

原焦点/runner时序FAIL、production入口运行source检查失败、并行导航timeout及中间布局回归证据保留；console警告未在本轮诊断，不称全仓无警告。 更广N5-00的真实AI/故障/重启/性能基线及02–07仍NOT_RUN，自动精简/两义/API合并未在01实现，本地模型仍后续需求。下一段按已认可顺序进入02选择与恢复；不更新全仓Last verified、R状态或推广。未提交，旧脏内容保留；优化预览与页签留供用户查看。

### N5-02 选择与跳过有限收口（2026-10-05）

固定S4–S6完成：独立移出/放回按钮、可保存并重开的草稿；移出不固化为skip，words保留短语；保存锁/失败回滚及旧回包隔离；低频“其他操作”中整篇跳过数量确认/取消。24项受控行为、16项01回归、focused和标准生产构建PASS；真实5184测试文章+声明owner解释的移出/重开/放回/取消、桌面/390窄屏及Tab/Enter通过。原1594词汇与31条annotation记录逐值不变，仅测试草稿与3条annotation新增，最终owner词汇1386/annotation13。此处未运行真实AI或实际学习全量入库/全skip/故障恢复；声明检查范围分开记载。Spec/Standards独立有限PASS，无遗留阻断P0–P2，审核1255路径零漂移，未重跑业务。证据C:/Users/0/AppData/Local/Temp/reader-n5-02-20261005/review.md；历史FAIL、未验及全仓/R/推广状态保留。

N5整体未完成，03–07继续按既定顺序。用户新提出键盘选中/切换目标词、键盘发音及发音与移出按钮距离，已登记方案06作为后续交互点，不提前施工；本地模型仍后续需求。


### N5-03 用户批准只读卡片补验后有限收口（2026-10-05）

用户明确接受真实保存数据的隔离只读卡片补验。原产品service/component在桌面1280及窄屏390实际点击显示答案，trunks句中释义为“象鼻”，原解释与真实学习单元身份一致；真实owner全部records前后相同，vocabulary/annotation revision1398/13未变。Spec与Standards独立只读复核均有限PASS，无阻断P0–P2；1256路径opening与前轮closing零漂移，产品零修改，本次仅追加三份状态文档。证据C:/Users/0/AppData/Local/Temp/reader-n5-03-card-supplement-20261005/review.md。

单目标内存ledger及只读session/history为控制依赖，媒体/翻译请求全部发送前拦截；不称正常生产队列或声音通过。原正常队列到trunks仍NOT_RUN，此前S8 PARTIAL、FAIL和未收口记录保持历史原状；按新批准范围补足卡片呈现并有限关闭03，放行既定04入库/幂等/恢复。N5整体未完成，05自动/API、06键盘与UI、07总验未通过；用户要求UI统一后续处理，不在04夹带视觉改造。全仓Last verified、R与推广不变，旧脏改动/真实测试数据保留。


### N5-04 入库、幂等与恢复有限收口（2026-10-05）

03按用户批准的只读卡片范围闭合后，固定S9–S12及1256路径opening实施4产品/2focused增量：学习分块前在原content CAS仓库预留新词身份，失败后重试复用word/unit；进度保存失败明确已入库/待同步，重开以已保存source context清对应claim/草稿；canonical重新学习仅实际created的新单元计数，已毕业同义复用不计，旧词义、词条状态、评分/调度不变。早期拟改变legacy状态的判断已按真正消费者纠正并撤回，未加新字段/schema/authority。UI统一后续处理。

实际优化production Me at the zoo仅单词提交elephants后短语仍待处理，all提交in front of后已加入3；真实owner词434→436/context414→416/revision1398→1403→1408，三目标各唯一graduated单元/语境/完成事件、claim/skip空。官方Stop/start及最终release显式库中重开后已加入3且提交disabled；全部owner records/revision1408/annotation13逐值相同。旧word/context/legacy review/log、196旧canonical reviewStates、1269旧events及旧unit pairs保留。服务/页签留供查看。

focused分块中断、未知已提交响应/replay、known/ignored新单元计数和旧历史保护通过；桌面/窄屏受控controller进度失败/reopen/重复/关闭/切B只回写A及24项选择回归通过；现有owner模拟和隔离真实Python存储冲突/receipt/reload通过，不能冒称生产多窗口或真实故障旅程。标准launcher构建通过。Spec/Standards独立只读有限PASS，审核1256路径零漂移，无阻断P0–P2，未重跑业务；证据C:/Users/0/AppData/Local/Temp/reader-n5-04-20261005/review.md。随后仅三份状态文档追加。

原FAIL保留；两份复制既有605行检查的Temp诊断超过约500警示已暂停扩张并说明复用，原实际运行证据留存，不作第二实现，后续采用小入口。真实生产多窗口/故障、系统重启、多设备、全仓仍未覆盖；N5整体未完成，05自动/API、06键盘/UI、07性能/整体验收按原顺序继续，不更新全仓Last verified、R或推广，不提交/清理旧dirty/合法测试成果。

### N5-05a–c 已施工、审核未通过（2026-10-05）

用户授权执行后，固定1256路径N5-04 closing为opening，仅5产品/1focused增量：打开整理自动精简必要候选、有效结果复用、不自动循环失败、原义可继续、结果待保存时仅重试owner写入、输入变化/关窗换篇回包保护。桌面/窄屏各9个受控复合场景与focused/build通过；故障为声明依赖，不能称真实生产故障。真实优化Host/UI点击整理无需手点精简，Gemini3.1-flash-lite单批无重试返回cool=很棒的、pretty much=基本上；重开provider run与owner payload/revision相同，无新API运行或写入。实际annotation13→14仅向公共测试文章追加2条声明原解释，vocabulary1408→1411仅该文章progress变化，1609个其他词汇记录、旧3个已加入目标/释义保持。实际普通AI标注联合输出未运行，SDK内部调用/用量NOT_VERIFIED。

Spec/Standards首检发现旧claim重试保存计数误报；第一轮已修并补直接测试。复核仍发现同一缓存的重开消费者：另一attempt已保存新释义后，旧pending-save缓存可能遮盖权威新义，owner数据不被重开覆盖。N5-05未收口，S14有残留阻断；按AGENTS连续失败停止规则停止自动修补，已请求用户决定是否继续只修该缓存判断及直接close/reopen替换token补验。证据与具体下一补丁：C:/Users/0/AppData/Local/Temp/reader-n5-05-auto-20261005/remaining-review-fix.md。旧有效legacy记录无历史input key，历史内容改动无法追溯；新进度可选input_key不改变IndexedDB schema，未返回保存缓存只保留本会话，进程重启恢复不保证。

保留所有FAIL/NOT_RUN及既有dirty/测试成果。05d API减少/质量对比未开工，06键盘/UI与07总体未验，不能称N5完成；不更改R、全仓Last verified或推广。只追加本段三份状态文档，产品冻结在第一轮修复，第二轮修复等待用户选择。


### N5-05a–c 用户授权缓存续修后有限收口（2026-10-05）

上段“审核未通过/等待用户选择”为本次续修前历史，原两次 NOT_PASS、停止和 FAIL 保留。用户明确批准保留仍有效的待保存缓存、丢弃已被新结果取代的缓存后，按精确 checkpoint opening（1256 路径零漂移）续修，仅 openSettlement 一处条件增量：原 target/token/input 一致且 owner 仍 pending 才保留临时覆盖；已完成、被替换或输入已变更时显示 owner 当前释义。有用缓存仍支持只重试保存，不重复请求 AI。

直接关闭重开/替换 token 基线 FAIL 保留，修后桌面及窄屏各10个受控复合场景（20）和 focused 通过；标准 launcher 最终生产构建通过。真实最终 release 显式打开 Me at the zoo，已有 cool=很棒的/pretty much=基本上 与原解释并列，关闭重开 ready；全量 owner payload/revision1411/14 及 provider run20261005-213950-9ff5aa 不变，本轮无新增云运行或学习记录写入。受控竞争/故障与真实普通缓存旅程分开，原真实自动精简证据继承，未重跑云请求。

Spec/Standards 独立只读复核均有限 PASS，无剩余阻断 P0–P2，审核1256路径零漂移、未重跑业务；证据 C:/Users/0/AppData/Local/Temp/reader-n5-05-cache-resume-20261005/review.md。随后仅追加三份状态文档，产品身份单独留存。有限关闭05a–c；05d API减少/质量对比未开工，06键盘/UI统一后续、07整体未验，N5整体未完成。legacy 无历史输入身份、未保存缓存进程重启不保证、真实生产多窗口/故障、SDK内部次数/token、系统重启及全仓未覆盖边界保留；不更新全仓 Last verified、R 或推广，不提交/清理旧 dirty 或测试成果。


### N5-05d 联合输出真实对比：未采用，待收缩范围（2026-10-05）

用户继续授权后，固定前缓存续修closing为opening，1256路径零漂移；本轮产品零修改，仅Temp候选/受控检查与真实模型对比。用相同Gemini3.1-flash-lite、目标/语境及分组比较旧详细解释+独立精简与联合输出：普通18目标14+4组、长前缀4目标1+2+1组，合计22目标5组。初版more短义误含扩展后的“风味”、light记忆提示出现无依据因果，NOT_PASS保留；一轮补强后词义/指代及两义解释改善，但长样本bank→the bank仍违反Spec最小边界合同，未修改目标身份/词义，也不夸大为数据损坏。两次HTTP503、Temp前缀夹具FAIL及旧记录保留。

选定完成的同组对照真实HTTP外发10→5、provider token28267→26497、耗时约54→31秒；整个实验共20外发，含3次弃用初版成功与2次503，不把选定子集当全部实验。此对比不是真实阅读器生命周期减半：既有整理精简一次操作可合并全部必要目标，真实应用次数需接入后另测，token/费用不保证下降。没有写学习记录或修改模型/credential/provider配置；新联合C3导入/保存/重开/SRS仍NOT_RUN。

Spec独立预审NOT_PASS（1项固定边界阻断），Standards有限PASS（边界偏差不改变词义/身份，未见阻断P0–P2）；判断分开保留，无业务重跑。证据 C:/Users/0/AppData/Local/Temp/reader-n5-05d-joint-20261005/review.md。经过两个候选质量checkpoint后停止自动补prompt，未将staged代码复制到产品。已具体准备“短上下文有限合并、长/超预算保留原路线”续修范围，见同目录fallback-proposal.md；用户决定前不实施第三轮。随后仅追加三份状态文档，产品1256身份与opening一致。

05a–c先前有限收口保持，05d未实现/未收口，06键盘/UI统一后续、07整体未验；N5整体尚未完成。保留所有FAIL/NOT_PASS/NOT_RUN、脏树及测试成果，不更新全仓Last verified、R或推广，不提交/清理，不动保护树。

### N5-05d 短上下文混合路线施工及源码复核检查点（2026-10-06）

用户接受“短上下文合并两义、长上下文保留原流程”后，已实施有限混合路线：原prompt不变，新prompt与此前实测v2完全一致；完整短上下文按字符预算及14目标上限选联合输出，长/超预算/无上下文仍用原分批和独立精简。补当前新短义来源与旧精简进度的消费者判断，未改UI、键盘、凭据、网络、路由、schema或评分。

实际优化production normal UI新增guys：标记→AI解释→双义导入→整理复用且无追加独立精简→保存后台完成→真实关闭页签、新开空白、显式重开→实际保存数据的只读复习答案，桌面/窄屏通过。模型原/联合同输入均给these guys边界，措辞偏差保留；不保证绝对精度。联合操作首次503后重试成功，原对照首次503也保留；Host SDK精确发送/token未验证。

Spec/Standards独立源码检查均有限PASS，无源码P0–P2，1258路径与source closing一致；**整体PENDING、05d尚未收口**。数据保留补验脚本连续两次断言失败（错误字段、误把合法新复习状态当全store不一致），按AGENTS停止第三轮。旧canonical评分/事件完整逐项核对尚待用户选择独立只读核对或继续脚本，不能称全部数据保留已PASS。实测旧pending选择恢复，原FAIL/NOT_PASS/NOT_RUN全保留。证据 C:/Users/0/AppData/Local/Temp/reader-n5-05d-hybrid-20261005/review.md；续接 handoff.md。

本次仅登记检查点，不放行N5整体、06键盘/UI或07全体验收，不更新全仓Last verified、R或推广；保护树、既有dirty及测试成果保留。

### N5-05d 混合路线独立有限收口（2026-10-06）

用户批准改为独立只读核对后，Spec与Standards均最终有限PASS，无固定H1–H3范围内阻断P0–P2；短上下文联合两义、长/超预算/无完整上下文保留原流程的05d增量现已收口。上段PENDING是本次核对前历史检查点；此前完整长短联合NOT_PASS仍保留，不改成通过。

两路分别直接核对实际保存快照：原436个词、416条语境、128条旧ReviewState、31条旧ReviewLog、198条canonical复习状态、1277条学习事件及原映射、旧acquisition/context evidence、旧标注与5条refinement逐值保持。新增仅属于guys（word/context/unit/初始ReviewState各1，4条未评分学习事件）；旧3个已加入目标保留，guys新增为第4项，cool与pretty much仍待整理且恢复参与本次，claims为0。卡片查看、关闭重开及最新只读owner的完整数据与版本全等（vocabulary1419/annotation15）。未修改或重跑两次失败readback helper，没有新AI/评分/产品写入。

此前真实normal UI解释→双义导入→整理零追加独立精简→保存→真实关页新开→显式重开及实际保存数据的只读复习答案，连同本次独立数据审阅支持固定有限出口；实际完整production复习队列评分仍NOT_RUN。旧/联合模型同输入these guys边界及短义措辞偏差、503重试、SDK精确外发/token NOT_VERIFIED、故障/多窗口/进程与系统重启/全仓未覆盖项保留，不保证精度或固定API次数。

源码审核身份1258路径，opening1256→closing1258仅10项实现/测试增量；两路最终审阅后只更新本文件与两份既定状态文档，产品零漂移。最终证据 C:/Users/0/AppData/Local/Temp/reader-n5-05d-hybrid-20261005/review.md（Spec/Standards独立报告分列，含逐项数据明细）。所有原FAIL/NOT_PASS/NOT_RUN及脏树、合法测试素材/数据保留。不更新全仓Last verified、R或推广，不改保护树、schema/authority/评分。

05a–d的各自有限收口成立，不代表整个N5完工。06键盘/发音/移出间距及视觉密度按用户要求统一后续；07性能及当前稳定源码整体验收尚未完成，本地模型另案。


### N5 同词多义新增计数 P2 精准修复及独立有限收口（2026-10-06）

最新 fresh 独立审核的 Spec NOT_PASS（同一新 bank 两合法义项/语境被报新增2词）是修复前结论；04/07及旧审核“固定范围无P0–P2”的计数总括已被本次发现纠正，旧报告和成功/失败原文保留，不回写为它们已发现或已修。本轮先只读核对当前1259路径与交接逐哈希全等、dirty文本逐字全等，再按固定六项验收仅修计数来源及完成提示单位。

现有词条预留/语境最终事务补充非持久wordCreated/contextAdded，按实际word_id及写入结果统计，不把学习单元created当词条创建。真实产品服务纯内存repository/UOW修前FAIL为新增2/追加0/处理2，修后bank两义为新增1词条/追加1语境/处理2目标；底层仍1词条、2语境、2学习单元，同word_id，两原义/目标完整。单词、不同新词、lookup规范化/语言隔离、existing/known/ignored/明确relearn、重复/毕业复用及三种受控提交故障后重试通过，旧词/评分状态/日志及已提交pair保持，无重复语境/单元/事件。原controller完成函数接缝显示准确单位；这是受控源码证据，双义真实Host/UI仍NOT_RUN。本轮没有实际owner/AI/评分或学习数据操作。

新144行计数检查复用现有接缝；既有acquisition、SRS、preview service、preview acquisition focused及生产build通过。Spec和Standards两个独立模型均有限PASS，无本P2固定范围阻断P0–P2，计数P2现闭合；Spec独立运行纯内存检查，Standards审源/身份/原始日志，均未重跑真实业务。证据 C:/Users/0/AppData/Local/Temp/reader-n5-count-fix-20261006/review.md；含修前FAIL、修后结果、opening/closing、实际增量及本轮回滚hunk。最终1260路径仅3产品/2检查（含1新增）及本次三份状态文档增量，无删除，审核后产品不再修改。

原FAIL/NOT_PASS/NOT_RUN、合法学习数据及dirty保持。owner保存性能未修，N5-06键盘/UI仍延期，旧status/selection两轮NOT_PASS及preview-ui FAIL未重跑/未第三轮；完整联合NOT_PASS、503、SDK/token NOT_VERIFIED及正常生产队列评分、真实多窗口/故障/系统重启/多设备/长素材/全仓未覆盖项保留。本次只闭合计数P2，不宣称全N5完工，不更新全仓Last verified、R或推广，不改repository/UOW/owner/schema/评分/去重/AI/布局或保护树。

### N5-06 键盘与弹窗操作有限收口（2026-10-07）
对应原F6/F8、固定S16/S17：本篇整理新增列表内↑↓、R发音/停止、M移出/放回、E展开、D两义焦点；目标与选择分离，鼠标/键盘同步，重绘/失败/迟到保护；分组间距及可见焦点。共享dialog-controller仅公开既有isTopmost，默认行为不变。受控检查、focused/build/Vite及实际优化production两宽度/技术TTS通过；初审D窄屏可见性P2导致Spec NOT_PASS，第一轮局部scrollIntoView修复后独立Spec/Standards均有限PASS，无阻断P0–P2。原NOT_PASS/观察FAIL保留，声学听辨未验。实际移出/恢复仅本篇progress更新，其他1619词汇records及annotation全等，不删除学习记录。证据 C:/Users/0/AppData/Local/Temp/reader-n5-completion-20261007/06-spec-review.md 与06-standards-review.md，1262路径closing。
首次打开偶见空候选后重读恢复仍为F2/F3未解FAIL观察，最新版本单次正常不证明根治；保存性能、真实双义Host/UI和最终总审尚未完成，全N5未完工。按completion-guide下一段只先定位保存性能，不改旧失败runner；不更新全仓Last verified、R或推广。

### N5 保存性能有限收口（2026-10-07）
对应F11：新测一致真实owner副本五组，中位30.402秒→9.868秒（含新实例物理重读，减少67.542%，最大9.909），固定>=50%且<=10秒代表基准达标。首轮10.568秒NOT_PASS保留。仅Python词汇域完整内容摘要复用重复校验/复制与纯字段名检查优化，每次仍锁/解码真实全文件；CAS、receipt、backup/fsync、原事务/评分/schema不改。17域、receipt15、真实Python冲突/未知响应及count检查PASS；全部15副本旧数据保持且同词双义1词2语境2unit/同id/计数1/1/2。实际App保存cool完成1/0/1并重开留phrase，旧438词418语境/旧评分事件标注保持。实际App Resource14请求跨度11.204秒、观察完成11.679秒，与代表副本分别报告，不宣称所有实际保存<=10秒；详细Network漏匹配空timeline为NOT_PASS，Resource Timing补证单列。Spec/Standards独立有限PASS，无阻断P0–P2，证据 C:/Users/0/AppData/Local/Temp/reader-n5-completion-20261007/perf-spec-review.md、perf-standards-review.md。1262路径与已审身份一致，状态仅追加。
全N5尚未完工；首次空态F2/F3、最终同版本真实双义/AI/只读两卡/总审仍待补验。原FAIL/NOT_PASS/NOT_RUN和dirty/学习数据保持，不改全仓Last verified、R或推广。


### N5 固定产品范围整体完工（2026-10-07）

按用户批准completion-guide顺序完成06→保存性能→最终真实补验→独立总审。Spec/Standards两轴均有限PASS，无固定F1–F11/S1–S20范围阻断P0–P2，N5按固定产品范围整体完工。证据 C:/Users/0/AppData/Local/Temp/reader-n5-completion-20261007/review.md，逐条原备注→实际改善→证据→完成状态见final-results.md；不表示零历史失败、全仓验证或日用推广。

键盘↑↓/R/M/E/D仅当前列表，鼠标目标一致、移出/恢复、原/短义浏览与操作间距完成；当前同一production release两宽度真实技术发音自然播放/停止、焦点可见及重开通过，声学听辨未验。保存固定同规模真实耐久副本五组中位30.402→9.868秒（减少67.542%，最大9.909，含新owner物理读回），固定出口满足；实际App两次14请求/5command全部committed及读回，跨度11.861/12.123秒分别报告，不承诺所有实际App<=10秒。原首轮10.568 NOT_PASS保留。

真实Host/UI同新that's两个不同原义/源句目标同批入库，完成提示新增1词条/追加1语境/处理2目标；物理1词2语境2学习单元同word_id，两合法目标不删除。随后真实普通AI增量与自动缺短义say分别GET ready，已有结果复用；新annotation来源版本与已保存声明语境明确分列，原保存双语境/unit精确保持。原产品service/component只读两实际unit在桌面/窄屏显示各自不同短义，API旁路发送前阻断、评分禁止，正常生产队列评分仍NOT_RUN。真实只单词保留phrase，跳过取消/确认只改本篇progress，真关页新开空白与显式重开读回通过；受控503为readerror/retry，不冒充真实故障。

阶段3旧439词/419语境、全部旧评分/事件/maps、1611其他词汇records、791旧annotation target投影保持。末尾为补技术R新增合法elephants目标，保留待整理1/已加入10/已跳过1；未入库/评分/删目标，最后owner1454/annotation22与只读磁盘一致，其他1644records及799个此前annotation投影精确保持，已保存word/context/unit/score/event不变。最后产品冻结1262路径，第三段无产品增量，总审后仅追加本文件及两份既定状态文档并登记closing。

原06首次空候选后重读恢复的FAIL观察根因未定位，不宣称已修；本轮新pending3/2/1、全处理空态及末尾新增两宽各2次重开均正确，总审按固定样本有限通过。原FAIL/NOT_PASS/NOT_RUN、旧status/selection runner两轮NOT_PASS与preview-ui FAIL不改不重跑；正常队列评分、系统/进程重启、多设备、声学、真实断电/生产竞争故障、SDK发送/token及全仓未验范围保持，不更改全仓Last verified、R或推广。

前性能记录中“Network漏匹配”原因只是当时猜测。最终同次双义请求空数组定位到REPL变量重绑定，原Map保存真实14请求/committed，已恢复同次证据；先前URL后缀假设更正。旧perf kernel已丢失，不能证明同因，其空Network仍NOT_PASS、Resource Timing边界保持。所有原失败文件/审核历史、dirty与合法学习数据保留；回滚只反向已审具体hunk，禁止整文件覆盖或回滚学习数据。
