# 第 6 项大文件职责整理：总施工方案

**当前状态与简化范围以[2026-10-04 有限收尾交接](E:/read-web-next-optimization/docs/design/reader-large-file-decomposition/handoff.md)为准。** 用户要求简化并尽快完成后，R6模板/弹窗/controller及R8三组HTTP路由已施工；针对性检查、156项后端测试、路由/OpenAPI及生成CSS身份、当前Vite加载/播放/交互通过。R9仅完成身份/接线/清单/文档与现有检查的有限自检；R6/R8及本轮R9独立审核NOT_RUN，原完整跨轮生产旅程未补齐。既有architecture与workflow-streaming检查FAIL已在opening副本复现；当前dictionary:test 30项PASS。此前阶段状态段落保留为历史，不代表最新状态。 下文原完整方案及原始状态保留供追溯，不能据其待开工或原验收表误判当前进度。


日期：2026-10-03；当前状态更新于2026-10-04：R1/R2/R3/R7已独立PASS，R4固定产品验收通过（辅助检查原FAIL保留）；R5范围重定草案，R6/R8/R9未启动。用户已确认单独清退本文扫描后再做R5，N1清退已独立PASS（限重定范围），R5未施工。最新审核以dispatch及独立结论为准。本文件是总索引；执行时必须同时阅读共同约定和该轮方案。新模块/测试路径是拟建目标，不能当作已经存在。

第 6 项沿用父对话最后的六项清单：“按保留职责整理大文件”。ABC 已完成第 1–4 项；第 5 项是用户正在规划的功能撤除。大文件整理不属于ABC遗留欠项，不重新扩大ABC验收。

R5前置已有[本文扫描清退有限施工方案N1](E:/read-web-next-optimization/docs/design/reader-article-scan-retirement-plan-2026-10-04.md)：单独退休完整扫描支路、保护共享根及历史读取，固定N1-A1–A7；N1已独立PASS并收口；R5仍为重定范围草案，未施工或派工。

## 1. 为什么分成 8 轮施工 + 1 轮合并验收

最先解决保存职责：先机械集中，再转移生命周期归属，将“代码搬走”和“脱离面板仍能保存”分两轮验证。随后分别整理素材、SRS、本文词汇、AI解释标注。后端先集中AI运行范围，再集中HTTP注册，最后核验共存与跨模块路径。

不要求所有文件小于某个行数；完整的单一职责可以仍较长。当前 backup/migration/durable owner/词汇事务和已拆focused服务不自动列入本次；也不重做Tailwind/shadcn-vue换肤、API/data/schema、框架升级或遗留全局大迁移。

## 2. 逐轮安排

| 轮次 | 本轮施工内容 | 开工条件 | 施工与完整自检粗估 |
| --- | --- | --- | --- |
| [R1 阅读保存接线](E:/read-web-next-optimization/docs/design/reader-large-file-decomposition/01-reader-persistence.md) | 把面板内marks/activity/outbox与tracker/coordinator/hydration接线集中；原面板生命周期保持。 | 可以现在做。 | 1–2小时 |
| [R2 应用级保存生命周期](E:/read-web-next-optimization/docs/design/reader-large-file-decomposition/02-app-lifecycle.md) | App持有唯一保存范围；面板卸载后保存仍工作，root卸载cancel→flush→dispose。 | R1独立PASS；核心阅读/保存保留。 | 1–2小时 |
| [R3 素材列表与变更](E:/read-web-next-optimization/docs/design/reader-large-file-decomposition/03-material-workflow.md) | 列表分页/轮询一个所有者，revision/receipt/single-flight变更一个所有者，面板保留展示/打开。 | R2 PASS；第5项确认素材相关功能保留。 | 2–3小时 |
| [R4 SRS媒体与翻译](E:/read-web-next-optimization/docs/design/reader-large-file-decomposition/04-srs-media.md) | media与translation单一状态/生命周期所有者，保留A修复及原13个回归场景。 | R2 PASS；SRS及对应功能保留。 | 2–3小时 |
| [R5 本文整理弹窗草案](E:/read-web-next-optimization/docs/design/reader-large-file-decomposition/05-article-settlement-scope-draft.md) | 仅保留settlement动态view与文章controller分离；拖拽/发音/焦点清理归view，现有业务保持。 | R2已PASS；先单独N1清退扫描并独立通过，再定稿和放行R5。 | 重定后另估；不含N1 |
| [R6 AI标注前端](E:/read-web-next-optimization/docs/design/reader-large-file-decomposition/06-annotation-backfill.md) | 配置/历史run/SRS摘要dialog、请求模板、运行导入controller分工。 | R2 PASS；AI标注及对应子功能保留。 | 1.5–2.5小时 |
| [R7 AI标注后端](E:/read-web-next-optimization/docs/design/reader-large-file-decomposition/07-backend-annotation.md) | JobManager中的操作threads/pool/model slots/deadline/cancel及run输出集中到runtime。 | 第5项保留；相关前端契约已固定。 | 2–4小时 |
| [R8 HTTP注册与装配](E:/read-web-next-optimization/docs/design/reader-large-file-decomposition/08-http-composition.md) | service具体endpoint注册分类，保留create_app安全/lifespan装配与原Host/Node/domain分派。 | R7 PASS或明确取消；API保留表确定。 | 1.5–3小时 |
| [R9 合并验收](E:/read-web-next-optimization/docs/design/reader-large-file-decomposition/09-integrated-acceptance.md) | hash/所有者/清单/真实跨轮旅程/受影响生产CSS与文档核对，无新产品改动。 | 全部实际施工轮独立PASS，取消范围有明确依据。 | 1–2小时 |

独立复审、失败排查与环境等待另计。全部范围保留时，施工/合并自检约13.5–24小时，独立复审合计粗估另4–8小时；这是净工作量，不保证墙钟时间，也不是要求一次连续完成。第5项决定撤掉某范围后，相应拆分取消而不是白做一遍。

## 3. 当前实测基线与有据保留

本次只读核对得到：
- YouTubeWorkflowPanel.vue：2689行；已有tracker/coordinator/hydration/outbox独立模块，本次补接线与归属。
- SrsReviewPage.vue：1426行；已有flow/policy/source/pronunciation服务，本次拆script的媒体和翻译，template不动。
- vocabulary-preview-module.js：1634行；动态dialog与controller混合，需要保护scan single-flight、claim和动态CSS来源。
- annotation-backfill-ai-module.js：1557行；view、template和run/import协调混合。
- service.py：4302行；JobManager内有独立AI操作运行范围，create_app含具体endpoint注册。
- production_host_prototype.py：2188行；已有路径分派/owner/transport架构，本计划保持其核心实现，R8只验证它继续正确消费workflow与Node。

行数是定位提示，不是删除/拆分标准。日后源码变化，执行模型按函数/消费者重新确认opening，不拿这些数字卡验收。

## 4. 执行依赖与可并行部分

按 R1→R2 顺序先做，每轮独立PASS才放行下一依赖。R3–R6可以在各自保留条件满足后独立准备和分开施工，但不会因为文件看起来不同就自动启用多个写入者；用户另行授权并行时，明确产品文件归属，workflow-ui.css/package/inventory/docs由一个写入者串行合并。

R7→R8同改service.py，应串行。R9最后执行。当前只编写方案，没有派发新对话/代理或自动建立工作区。

第5项未结束时可以先完成R1/R2；其它轮次等它们各自所需的保留决定，而不必等待全清单所有细节。核心未决定时不能将计划当成已批准功能删除。

## 5. 共同约定与交付标准

[共同执行、隔离、验收、回滚及停止约定](E:/read-web-next-optimization/docs/design/reader-large-file-decomposition/00-common.md)适用于所有轮。每轮文件分别给出：真实消费者、允许/保护文件、按顺序施工、固定验收、完整必要检查、独立审查/交接/回滚。不能只依据总表施工。

两个容易漏的事项：
1. R1集中代码不等于保存脱离UI；必须完成R2实际面板卸载仍保存的验收，未来才能安全撤素材UI。
2. Tailwind采用source(none)。R5/R6搬动态class要准确补@source并验证生产CSS；模块源码/开发页PASS不等于生产皮肤PASS。

每轮只有“执行自检完成，待独立复审”与随后独立判定；R9汇总实际已收口/取消/待决定范围。第5项仍有待决定时，只宣布已执行子范围完成，不提前宣布完整第6项PASS。完整npm test、自然音频、用户运行Host、跨机、daily推广均不由本计划自动纳入。

旧单轮方案 [reader-large-file-retained-responsibilities-plan.md](E:/read-web-next-optimization/docs/design/reader-large-file-retained-responsibilities-plan.md) 保留为前一版背景；本索引与R1–R9取代其执行细节。



N1 本文扫描清退执行记录（2026-10-04）：两个扫描/显示入口及专用生产、显示、词典富集支路已撤除；本文整理、历史来源识别和独立学习入口保留。执行验收未完成：J3 现有手工导入入口不可达，句高亮正式检查失败；独立审核 NOT_RUN，R5 未放行。具体命令、失败与未覆盖项见本轮 Temp handoff.md：C:/Users/0/AppData/Local/Temp/reader-n1-resume-20261004-582b711a/handoff.md。此记录不更新全仓 Last verified 或前轮结论。


N1 补充执行（2026-10-04）：用户授权重定后，句高亮完整检查、匹配 target 的普通 AI/真实轻量合并与旧扫描来源/mark 保护、动画稳定的四组合生产矩阵及 drag/resize/focus、代表 loading/empty/长列表/relearn/error 对照通过。处理中 UI 已观测；补充 producer 完成响应合同错误的原 FAIL 保留，停止追加修补。原手工文件 UI 缺口不伪装为旅程通过，按方案补充范围改用既有 AI 导入链；dictionary 全入口的既有 FAIL 保留并有原 opening 复现。独立审核 NOT_RUN、R5 未放行，见 C:/Users/0/AppData/Local/Temp/reader-n1-supplement-20261004-2c83b798/handoff.md；不更新全仓 Last verified。


### N1 独立收口（2026-10-04）

**N1 独立 PASS，限于方案预先重定后的验收范围，现已收口。** 独立审核未发现阻断收口的 P0–P2 问题，见[独立审核报告](C:/Users/0/AppData/Local/Temp/reader-n1-independent-review-20261004/review.md)。最后 completion 补测已闭合精简完成、进度保存及关闭重开读取；原失败尝试保留。原手工文件 UI 旅程仍为 NOT_RUN，dictionary:test 整入口仍为既有 FAIL，按重定范围保留另案；本审核未重跑业务测试。此前执行/补充段落是各阶段历史记录，不再代表当前 N1 状态。

R5 旧扫描/双入口扫描子范围标为“因功能退休取消”，不是 R5 PASS；R5 保留本文整理职责的方案仍须定稿及明确调度，尚未启动。R5 opening 应以 N1 本次收口后的当前源码及 closing 身份为基线，见 C:/Users/0/AppData/Local/Temp/reader-n1-closeout-20261004-e83a5c18/closing-manifest.json，不以 HEAD 或清退前源码代替。未更改 R9、全仓 Last verified 或推广状态。


### R5 本文整理职责迁移独立收口（2026-10-04）

R5按重定固定A1–A7独立PASS，见[独立报告](C:/Users/0/AppData/Local/Temp/reader-r5-independent-review-20261004-6bfa8721/review.md)。本文整理DOM、候选展示/展开、按钮、拖拽缩放、发音、关闭释放与焦点返回由src/features/vocabulary-preview/create-article-settlement-dialog.js单独拥有；vocabulary-preview-module.js继续负责文章身份、缓存、进度、AI、claim、入库及owner协调。workflow-ui.css仅补准确@source，生产CSS哈希保持。D/M/B前置分别独立PASS；原手工文件旅程NOT_RUN且功能已退役并清退，原dictionary历史FAIL保留。R5当前生产四组合/代表状态/精简保存重开/words-all-skip通过；切文原伪PASS撤回INVALID，当前桌面/移动完成隔离补证有效，opening桌面补测FAIL保留，迟到完成配对仍NOT_VERIFIED。源码及原日志见C:/Users/0/AppData/Local/Temp/reader-r5-settlement-dialog-20261004-01a10648/handoff.md。旧扫描范围因功能退休取消，不改为PASS；不更新全仓Last verified或推广状态。R6/R8/R9尚未施工，后续按R6→R8→R9执行。此前相关段落为历史记录。
