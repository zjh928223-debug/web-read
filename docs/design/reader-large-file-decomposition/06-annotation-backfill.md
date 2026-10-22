# R6：分离 AI 解释标注的弹窗、请求模板与运行协调

**当前状态与简化范围以[2026-10-04 有限收尾交接](E:/read-web-next-optimization/docs/design/reader-large-file-decomposition/handoff.md)为准。** 用户要求简化并尽快完成后，R6模板/弹窗/controller及R8三组HTTP路由已施工；针对性检查、156项后端测试、路由/OpenAPI及生成CSS身份、当前Vite加载/播放/交互通过。R9仅完成身份/接线/清单/文档与现有检查的有限自检；R6/R8及本轮R9独立审核NOT_RUN，原完整跨轮生产旅程未补齐。既有architecture与workflow-streaming检查FAIL已在opening副本复现；当前dictionary:test 30项PASS。此前阶段状态段落保留为历史，不代表最新状态。 下文原完整方案及原始状态保留供追溯，不能据其待开工或原验收表误判当前进度。


状态：待R2独立PASS，且第5项确认AI解释标注、保存run与SRS候选相应保留。计划1.5–2.5小时施工/自检，独立复审另计。必读[共同约定](E:/read-web-next-optimization/docs/design/reader-large-file-decomposition/00-common.md)。仅某个SRS候选子流程退休时先在第5项处理，不夹带在抽取中删除。

## 1. 结果与现行消费

annotation-backfill-ai-module.js 1557行，承担配置/历史run/SRS摘要dialog、template覆盖/局部请求构建和run/import协调。拆为dialog表现、请求数据模型与controller协调。createAnnotationBackfillAiController/init入口、当前window兼容controller发布及session轻量导入接口保持。

不更改AI默认模型、配额策略、provider、credential、存储或生成语义；不引入新的在线请求/自动提交。后端操作生命周期由R7单独整理。

## 2. 范围

修改 E:/read-web-next-optimization/src/composables/annotation-backfill-ai-module.js；新增 src/features/annotation-backfill/create-annotation-backfill-dialog.js、annotation-backfill-template.js。将template coverage/scope/target/buildRequest这组同一概念聚合，不把每个helper拆一文件。

dialog带上其scope/classes/选中run呈现/busy/progress/focus/dialogController；请求模板模块只拥有纯数据构造与覆盖分析。model/session credential和current article identity的写入仍由controller掌握或明确局部配置适配，不将secret放view可见调试或persist。

仅允许 src/styles/workflow-ui.css 新准确 @source。同步 scripts/annotation-backfill-ai-module-check.cjs 与相应staging；session/lightweight/generated-index相关检查保持业务断言。已有annotation services/词库事务/storage/后端实现不改。

## 3. 顺序

1. opening保存及消费者表：按钮→controller→client operation→result→轻量import/存储→候选。列runId/model/current imported/selected run以及文章job/audio身份消费。
2. 先提取coverage/requestTemplate函数，保持文本normalize、目标ID排序、截取原句、incremental/all请求payload。用原真实样例作前后数据比较。
3. 搬整个dialog factory与所需view helpers，保留实际有效的函数定义和行为。现源码factory有同名resetProgress/openDialog/setStatus/setStep多次定义；JavaScript后定义生效，不能只取第一次，也不借抽取顺便“修复”一套新的交互。
4. 控制器仍拥有running状态、当前文章身份、run/import与SRS候选应用；dialog通过原数据/操作接口消费，busy时run tab/cancel语义和焦点保持。
5. 保留文章切换后的结果可用性/禁止错误自动导入、选旧run手动导入、model范围增量merge、选中run保存key与候选批次路径。
6. Tailwind新view source/staging加载真实新依赖；不得用空dialog stub把focused行为绕过。
7. 完整controller检查、真实生产入口操作与样式对照，交接停止。

## 4. 固定验收 R6-A1–A7

| 标准 | 必须达到 |
| --- | --- |
| A1 职责 | controller的run/import/文章身份与view/template各有单一所有者，public API/兼容发布保持。 |
| A2 请求 | 原完整/增量coverage、template目标/句范围、model及credential传递相同，不新增输入泄露。 |
| A3 运行 | run/progress/error/失败恢复、busy操作限制及当前文章切换处理保持，不将旧结果导入新文章。 |
| A4 已存run | current/previous/selected呈现、按model/run读取和手动导入保持，import option/target scope相同。 |
| A5 SRS候选 | 已确认保留的生成/已有词排除/add/skip/summary及owner acquisition路径保持，不新增自动落库。 |
| A6 UI/CSS | dialog有效函数语义/焦点与关闭返回保持，新@source产出原框架utilities，layout/列表/按钮自然换行相同。 |
| A7 必要记录 | focused完整原行为和真实入口旅程通过，源码/生产CSS/日志/回滚齐备，原FAIL不改写。 |

## 5. 完整验证

- npm.cmd run verify:annotation-backfill-ai（完整原controller与dialog行为）
- npm.cmd run verify:annotation-lightweight-module
- npm.cmd run verify:session-annotation-lightweight-io
- npm.cmd run verify:session-annotation-generated-index
- npm.cmd run verify:annotation-storage-envelope
- npm.cmd run verify:srs-pending-candidates-transaction（保留候选写入时）
- node scripts/dialog-controller-check.mjs
- 共同门禁。

真实App“AI解释标注”按钮→配置/选model→生成→progress→结果导入→查看旧run/切换选中run；另外挂起生成后切换文章，释放响应检查禁止错文章导入；失败返回及真实重试。保留候选流程时实际add/skip按钮验证。service可合成，组件controller/template不得stub。

production before/after在1280×720与390×844，固定light dialog：初始/忙碌/已有多个run/长摘要/失败/SRS候选代表状态，检查computed、滚动、Tab/focus、关闭返回及生成按钮disabled。不重做所有annotation bubble矩阵。

## 6. 回滚与交接

交接同名有效定义保留说明、template前后payload、controller/dialog seam、run/文章身份与candidate消费、@source/hash、R6-A1–A7。回滚controller和@source本轮增量，不还原退休note/sidebar等。若发现真正产品bug，记录具体P0–P2与影响，不能通过改行为的“架构优化”悄悄扩大本轮。

