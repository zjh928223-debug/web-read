# 第 6 项三线调度

日期：2026-10-03。用户已授权新建三个独立施工对话，模型指定 GPT-6.1-sol；推理沿用本会话此前指定的 high。项目本地执行，不建立 worktree。

## 1. 分工与前置条件

- 前端一线：先 R1 → 独立复审 → R2 → 独立复审；之后在功能保留条件满足时 R3 → 独立复审 → R5。它拥有共享文件合入职责。
- 前端二线：R4 → 独立复审 → R6。R2 独立 PASS 前只读准备，不改产品/测试/清单/项目文档。
- 后端线：R7 → 独立复审 → R8。R2 独立 PASS 前只读准备；R7/R8 同改 service.py，不能并行。
- 父对话负责调度与独立只读审核；R9 待所有实际施工轮通过或有明确取消依据后进行。执行自检不是独立 PASS。

本调度不跳过分轮方案中的第 5 项功能保留条件。当前功能取舍仍由用户规划；没有对应保留决定时，相关轮次只读准备并报告 READY_WAIT，不自行猜测保留/退休，也不进行功能删除。核心阅读及保存沿用总方案的保留基线，R1 可以施工。

## 2. 独占文件与共享合入

各线只写本轮方案中对应产品/检查文件。前端一线拥有面板/保存与词汇弹窗范围；前端二线拥有 SRS 与 AI 标注前端范围；后端线拥有 service.py/新后端模块及对应 Python tests。

以下共享文件统一由前端一线合入：src/styles/workflow-ui.css（仅计划允许的 @source）、package.json、docs/architecture/test-inventory.json、script-inventory.json，以及 README/PROJECT_MAP/CURRENT_PROJECT_STATUS 的本轮说明。其他线只在独有 Temp 保存共享增量建议，不能直接改这些文件或运行 --write 清单重生成。

共享建议包含目标路径、当前基线 SHA256、最小增量和理由；合入者在合入时重新读取当前文件，只应用本次 hunks，不能恢复过时整文件。没有新增命令需要时不改 package。共享合入与 final build/验收由父对话安排确定写入窗口，不能在其它线写入过程中拿不稳定源码验收。

## 3. 准备、交接与放行

每条线有自己的 Temp 证据根。只读准备可列消费者/接口/迁移表、输入输出契约、测试隔离与估时；不能进行产品构建、真实业务写入或修改项目文件。准备完成后交接并空闲，不长期轮询、建自动化或发送跨对话消息。

每个施工轮完整自检后写入结束，交接 WAIT_REVIEW，停止该轮及后续写入。独立 PASS 与功能保留依据需要引用本任务的父审核或明确用户消息；不以其它执行者的自检文字作为放行。父审核后再由用户/获授权的调度消息继续下一轮。

R6/R7 开工前以当前 client/service 的请求响应定义固定契约；并行时不得改 path/payload/status/错误/response 字段。发现需要改契约应记录并单独定界。

每线保存原始失败及 NOT_RUN/NOT_VERIFIED，遵守 AGENTS 两次连续失败停止规则。只使用优化工作区与自有随机 loopback/Temp；不启停现有 5184/8776，不碰日常/历史树和真实数据，不提交/推广/安装依赖。

线程身份由父对话创建后补入下节。初始创建并不表示 R1/R2 或其它轮次已完成。

## 4. 对话身份

三个对话均已创建，运行于本地优化项目，模型为 `gpt-6.1-sol`，推理强度为 `high`。

| 对话 | threadId | 分工 |
| --- | --- | --- |
| 第6项 · 前端一线 | `01a1017d-1624-7fc0-a1d8-e1cc567c4b36` | 先 R1、R2；放行后 R3、R5；共享文件统一合入 |
| 第6项 · 前端二线 | `01a1017d-1a5d-79f1-9668-a53b6b1ef376` | R4、R6；当前先只读准备 |
| 第6项 · 后端线 | `01a1017d-2031-7ef2-a95f-185658fea68e` | R7、R8；当前先只读准备 |

父审核对话为 `整体审查`（`01a0fcf5-16f3-76a1-a6ac-a4878660afc3`）。本次派工证据根为 `C:/Users/0/AppData/Local/Temp/reader-f6-dispatch-20261003-8e01f317`，三线交接分别写入其 `frontend-one/handoff.md`、`frontend-two/handoff.md`、`backend/handoff.md`。创建成功仅确认派工，不代表施工或验收完成。

## 5. R1 首次独立复审与限定补修

R1 首次独立复审：A1–A6 PASS，A7 未通过；默认 Python app 数据隔离与既有 SRS test-inventory 元数据尚未闭合。见[独立审核报告](C:/Users/0/AppData/Local/Temp/reader-r1-independent-review-20261003-3e8c971a/review.md)。

用户已授权前端一线按[R1 限定收尾修复方案](E:/read-web-next-optimization/docs/design/reader-large-file-decomposition/01-reader-persistence-closeout-repair.md)处理两个文件。补修结束仍停在 WAIT_REVIEW，R2 尚未放行；另外两条线继续遵守原只读准备条件。

## 6. R1 整轮通过与 R2 启动

上述第5节是首次复审及补修调度的历史记录。补修独立复审已完成：[R1 整轮独立 PASS](C:/Users/0/AppData/Local/Temp/reader-r1-closeout-independent-review-20261003-7c206d4b/review.md)，R1-F1–F4与A7通过，无漂移的A1–A6继承，原FAIL/NOT_RUN/NOT_VERIFIED保持历史状态。

用户已明确指示“R2启动”。前端一线现在获授权执行[R2 应用保存生命周期方案](E:/read-web-next-optimization/docs/design/reader-large-file-decomposition/02-app-lifecycle.md)：以当前R1 closing为opening，移动唯一保存范围到App，面板消费同一注入接口，保留加载取消→关闭flush→释放顺序，并完成固定R2-A1–A6与必要完整检查。

本次只启动R2；完成后停在WAIT_REVIEW，等待父独立复审。前端二线和后端线继续只读准备，R3–R8不因此提前施工或跳过功能保留条件。模型与推理仍为GPT-6.1-sol/high，使用已有本地对话，不创建新对话或工作树。

## 7. R2 限定继续与整轮独立通过

R2原执行两次浏览器失败后停在WAIT_USER_REASSESS。用户明确选择“那就做，别太啰嗦了，直接干完”，父对话据[限定收尾方案](E:/read-web-next-optimization/docs/design/reader-large-file-decomposition/02-app-lifecycle-closeout-repair.md)授权一次限定继续；原两次FAIL及NOT_RUN/NOT_VERIFIED保留。

前端一线完成测试生命周期事件配对、失败trace留存和唯一inventory元数据同步，产品/模板/CSS保持冻结，执行自检后WAIT_REVIEW停止写入。父对话随后独立重跑18项必要命令及全部10组fresh浏览器旅程，R2-A1–A6、限定收尾C1–C4全部通过，见[R2整轮独立PASS](C:/Users/0/AppData/Local/Temp/reader-r2-independent-review-20261003-b20c8265/review.md)。真实BFCache、真实用户数据等范围仍未验证，正式未运行alias不回填。

R1/R2依赖门已关闭，但本次没有启动R3–R8。后续轮仍按保留条件、文件归属及明确调度启动；前端二线/后端线维持准备状态。原R5与已提出的本文扫描清退需求重叠，放行前须重定界，不能把未执行范围标为取消或PASS。后续功能改造另按[任务与依赖安排](E:/read-web-next-optimization/docs/design/reader-feature-change-scheduling-2026-10-03.md)规划，不加入此次R2验收。

## 8. 用户继续：R3、R4、R7 并行施工窗口

用户在R2独立PASS后明确指示“继续”。本节放行三个已有对话各自下一轮：前端一线R3、前端二线R4、后端线R7；模型保持GPT-6.1-sol/high，不新建对话或worktree。

功能保留依据为[功能需求拆解](E:/read-web-next-optimization/docs/design/reader-feature-opinions-breakdown-2026-10-03.md)：B组保留素材/任务操作，E4和F保留AI解释/生成标注及本文整理，G11/H保留SRS媒体/翻译。此次仍仅整理当前职责：不实施新布局、键盘规则、学习算法、多provider、回收站或功能删除。R7建议先做R6并非硬前置；此批R6不动，现client/service HTTP定义冻结，R7可独立施工。

三线开工时各自保存当前opening，不把准备快照覆盖回工作区。父R2独立fresh dist可作为有身份证明的共同保留基线：C:/Users/0/AppData/Local/Temp/reader-r2-independent-review-20261003-b20c8265/dist；其opening/final-manifest及CSS身份在同目录。消费者需要自己的before场景时，使用保存的不可变baseline产物及合成网络夹具；不得在另一线修改产品时把不稳定源码构建当正式before/after验收。

### 三阶段协调

1. 并行完成各自产品/检查的职责迁移与只涉及本人稳定范围的focused自检，保存共享增量建议（当前SHA、最小hunk、理由）于各线Temp。本阶段不改共享CSS/package/inventory/README/PROJECT_MAP/CURRENT_PROJECT_STATUS，不在其它线写入中进行正式全App build/浏览器或全局清单验收。完成后交IMPLEMENTATION_READY并停写，不能自行进下一轮。
2. 父对话取得三线都停写的证据后，指派前端一线唯一合入共享建议。所有产品保持冻结；读当前文件只合对应hunks，不能合旧整文件。无新增正式检查不改package；R3/R4/R7无CSS变更授权。合完共享文件再停写。
3. 在同一稳定源码上由父调度完成各轮原方案完整自检、生产before/after及真实临时HTTP/浏览器旅程；各线只写自己的Temp证据，项目文件仍冻结。必要事实文档增量由前端一线串行合入，补文档门禁/diff/closing身份。各轮实际必要检查齐全后WAIT_REVIEW，父逐轮独立审查，不将另一线自检当本轮PASS。

R3固定A1–A6、R4固定A1–A7与原完整13媒体/翻译场景、R7固定A1–A7保持。R7原service测试中有限阻塞的close条件保持，不因准备提示而新增永久阻塞治理。测试必须先保证默认Python app数据与Node临时运行产物隔离；仅自有Temp/random loopback，不触碰用户试用服务或真实凭据/provider。

三线各自两次连续失败仍按AGENTS停止报告，不由协调阶段绕过。原FAIL/NOT_RUN/NOT_VERIFIED保留。R5继续等待重定界，R6/R8需对应前轮独立PASS及另行调度，R9最后执行；本节不放行新功能改造。

### 阶段二限定合入

父对话已取得三线 IMPLEMENTATION_READY 与 idle 停写证据，七项共享文件仍与开工 SHA 相同。仅前端一线进入共享合入窗口；其余两线继续冻结。另明确允许同一写入者限定修复 `scripts/youtube-workflow-batch-jobs-contract-check.mjs` 的旧 data URL 相对依赖导入：改为现有 src ESM hook 和真实 client 模块图，保留 `const requests` 之后全部原断言；这是原 R3 必要检查的运行入口修复，不修改产品/client/HTTP契约。原导入 FAIL 保留，新正式结果另记。合入后停在 SHARED_MERGE_READY，不自行开始全量浏览器验收。

## 9. 用户批准 R3/R4 限定验收收尾

阶段三 R7 已经父对话独立 PASS，见 [R7 独立报告](C:/Users/0/AppData/Local/Temp/reader-r347-independent-review-20261003-f4c052b7/R7-review.md)。R3/R4 各发生两次验收 runner 失败后均停写；没有整轮 PASS，也没有第三次自动重跑。用户现明确指示“好的，直接开始”，批准按 [R3 限定方案](C:/Users/0/AppData/Local/Temp/reader-r347-independent-review-20261003-f4c052b7/r3-bounded-verification-closeout-plan.md)及 [R4 限定方案](C:/Users/0/AppData/Local/Temp/reader-r347-independent-review-20261003-f4c052b7/r4-bounded-runner-closeout-plan.md)继续一次。

先仅由前端一线修正原正式 browser 检查的严格等价颜色字面分支，并准备自己的 Temp runner；前端二线可同时准备自己的 Temp 首卡/请求断言。产品、CSS、客户端、保存核心与其它正式检查继续冻结。双方准备完成停写后，父对话另行释放同一稳定源码上的完整正式检查及生产前后对照并行窗口。已独立通过且依赖身份相同的检查按准确来源继承。

保留所有原始失败与首轮外层日志缺口，不重写为 PASS；新 attempt 使用独有证据目录。本次任一线验收仍失败立即停止，不自动再次修正。完成后 WAIT_REVIEW，由父独立复审；共享事实文档最终增量仍在全部停写后由前端一线串行合入。R5/R6/R8/R9 与功能改造不在本次放行范围。

## 10. 本次验收结果与停止位置

R3 fresh构建、原完整正式panel-behavior和12个生产前后上下文已实际通过，父也独立完整重跑正式browser exit0。剩余正常材料组合旅程先因Temp PYTHONPATH缺项目包而启动exit91；用户随后明确批准“一行环境修正并补最后旅程”，另建58b5c1cc attempt修正该行。Python隔离启动成功、两个有限任务ready，但页面11375向原产物编译API11196的临时跨域入口被CORS阻断，尚未打开材料/标记/切换/验证关闭。该运行已停止，R3整轮未闭合，见 [R3独立复审](C:/Users/0/AppData/Local/Temp/reader-r347-independent-review-20261003-f4c052b7/bounded-closeout-20261003/R3-independent-review.md)。[同源入口限定补测方案](C:/Users/0/AppData/Local/Temp/reader-r347-independent-review-20261003-f4c052b7/bounded-closeout-20261003/R3-same-origin-material-journey-plan.md)仅是待用户决定的具体建议，未实施。

R4四个实际生产上下文的复习旅程均PASS。辅助computed比较18项中13PASS、5项仅speaker边框过渡颜色采样不同，aggregate exit1原样保留，执行者停止后没有修比较器或重跑。父按原A1–A7审查真实截图、控制状态/布局/其它computed、完全相同的源/生成CSS与原完整13场景，固定产品验收通过；不代表全部自动检查全绿，五个采样点的transition终态没有补测，见 [R4独立复审](C:/Users/0/AppData/Local/Temp/reader-r347-independent-review-20261003-f4c052b7/bounded-closeout-20261003/R4-independent-review.md)。R7独立PASS保持。

全部执行窗口结束后，前端一线唯一同步README/PROJECT_MAP/CURRENT_PROJECT_STATUS当前事实，实际文档门禁与diff通过；closing仅三份文档变化，状态SHARED_FACTS_SYNCED且idle，见 C:/Users/0/AppData/Local/Temp/reader-f6-dispatch-20261003-8e01f317/frontend-one/shared-facts-20261003-af44c617/handoff.md。父补充本调度记录并核最终身份；产品/CSS、R2核心/client/loader、用户试用服务及所有旧FAIL/NOT_RUN/NOT_VERIFIED保持。R5/R6/R8/R9仍未启动，本批不能标完全收口。

## 11. 2026-10-04 用户批准最后材料旅程同源补测

用户明确指示“可以，那就继续同源补测”。父在放行前核对上一轮最终1237文件快照：无变化、无实际新增文件；git仍列出的六个已删除追踪路径不是新增，见 C:/Users/0/AppData/Local/Temp/reader-r3-same-origin-review-20261004-11c79c90/opening-identity.json。因此此前有身份证明的产品产物与已通过结果仍可继承，本节仅追加授权事实。

仅前端一线在新独有Temp执行[同源限定方案](C:/Users/0/AppData/Local/Temp/reader-r347-independent-review-20261003-f4c052b7/bounded-closeout-20261003/R3-same-origin-material-journey-plan.md)：不可变完整App与API同用原自有loopback11196，有限静态入口按原方法/请求头/body透传到真实隔离Host，保留已批准的PYTHONPATH及原材料打开→标记保存权威读回→切换→实际page.close断言。端口占用即停，不接管进程，不改产物、产品、CSS、正式检查或共享文件，不重跑此前通过的矩阵。

本次成功后仍须WAIT_REVIEW并由父独立复审；任一执行失败立即停止，不自行追加修正或重试。默认Python导入前隔离、所有旧FAIL/NOT_RUN/NOT_VERIFIED及现有试用服务保持。R5/R6/R8/R9与功能改造均未放行。此刻只记录启动授权，尚无本次补测结果。

## 12. 同源补测实际结果与独立判断

第11节授权的唯一attempt已执行并exit1，前端一线停止在WAIT_USER_REASSESS。完整App与API同源11196，真实素材库/session/transcript/chunkData成功，音频206，loader committed；父直接核实际截图，材料Hello world及4秒音频已显示。同源入口已解决，失败位置是等待open activity写请求15秒超时，后续mark/switch/page.close验证均NOT_RUN，R3整轮仍未闭合。自有11196/7920入口和Python PID30688已经关闭，原产物及全部旧失败保持，见[本次独立审核](C:/Users/0/AppData/Local/Temp/reader-r3-same-origin-review-20261004-11c79c90/review.md)。

父独立审查当前代码：Panel成功activate后在endLoad之前执行syncReaderActivity('open')，保存入口loading guard在ledger.submit之前跳过该事件。结合实际材料呈现且没有open POST，按原R3-A5判定具体P2打开记录遗漏。该顺序及guard在R2施工前opening已经存在，不归因为R3职责拆分回归；原R1/R2已通过场景保持，但不能用其覆盖本次尚未完成的正常保存组合。父未新增动态guard注入或再跑旅程，不声称mark/close丢失。

[成功打开记录顺序限定补修方案](C:/Users/0/AppData/Local/Temp/reader-r3-same-origin-review-20261004-11c79c90/R3-open-activity-bounded-repair-plan.md)已写好，当前只是待用户决定的建议，没有产品修改授权或施工。R4固定产品验收、原辅助13PASS/5FAIL/aggregate exit1与R7独立PASS保持，R5/R6/R8/R9未启动。

前端一线在单独事实同步窗口仅更新README/PROJECT_MAP/CURRENT_PROJECT_STATUS三个R3状态段落，原文档门禁和diff均PASS，closing1237仅三份文档变化，随后SHARED_FACTS_SYNCED且idle，见 C:/Users/0/AppData/Local/Temp/reader-f6-dispatch-20261003-8e01f317/frontend-one/R3-facts-sync-20261004-aef799a3/handoff.md。父最后补本节并核文档/diff/closing；不改产品、正式检查、package/清单，也不自动进入下一修复轮。

## 13. 用户批准一个有明确终点的集中收尾批次

用户不希望继续逐个修测试、逐轮追加补修；父建议先完整审查open→mark→switch→close、一次列齐阻断点，集中做必要修复及受影响验证，最后独立审核一次；若仍有实质阻断则保留R3未完成并停止，不再持续追加轮次。用户明确回复“可以”，批准此收尾方式。原两次失败停止规则与固定R3-A1–A6仍适用，不扩大功能、外观或后续拆分范围。

前端一线是唯一产品/共享文档写入者，沿用GPT-6.1-sol/high。内部先只读preflight链路与临时producer契约，父同时审查。只有完成阻断清单后才释放集中施工，避免修完open后再逐个发现DOM或关闭方式问题。父新独立证据根为 C:/Users/0/AppData/Local/Temp/reader-r3-final-batch-review-20261004-f947051a。真实用户服务/数据、旧失败及已通过不受影响的检查保持；R4辅助采样不追求全绿，R5/R6/R8/R9不启动。

### 集中施工一次释放

前端一线已交PREFLIGHT_READY/idle，见 C:/Users/0/AppData/Local/Temp/reader-f6-dispatch-20261003-8e01f317/frontend-one/R3-preflight-20261004-274ee480/handoff.md。父独立全链路预审与该清单一致：B1产品必要补修一处，B2真实关闭选项及G1/G2权威验证在新Temp处理，G3仅真实行身份同步，不修改产品。按[集中施工范围](C:/Users/0/AppData/Local/Temp/reader-r3-final-batch-review-20261004-f947051a/batch-plan.md)一次释放前端一线产品补修及完整必要验证；共享事实文档在独立审核前保持冻结。

该释放属于用户第13节已批准的批次，不再次询问逐个实现细节。成功WAIT_REVIEW后父独立审核一次；若仍有必要验证实质阻断，则保留R3未完成并结束本批，不不断追加轮次。当前尚没有本批施工或动态结果。

## 14. 集中批次已结束，R3 保持未完成

第13节集中批次只执行一次。前端一线在正常材料实际关闭后的服务权威确认超时后按约定停止，状态 BATCH_FAILED_STOPPED / idle；父按原 R3-A1–A6 完成一次独立审核，见 [本批独立审核](C:/Users/0/AppData/Local/Temp/reader-r3-final-batch-review-20261004-f947051a/review.md)。本批不追加产品修复、测试修复或业务重跑，后续拆分暂停。

唯一产品增量为 Panel 成功 activate 后、原 open 提交前增加一行 endLoad；原 finally 与取消/失败/过期保护保持。父精确比对该增量、1237文件范围、8份实际 producer 和 fresh 完整 App 的29文件产物哈希通过。改后 fresh 构建、原完整 Panel 源码/浏览器检查及原完整10组恢复/交互/生命周期检查均 exit0；其它未变检查按原身份继承，本批未重跑全部 focused 与 full aliases。

真实正常材料的两次 open POST 与 opened字段服务读回、可见词点击+m及 marks 服务读回、旧材料 switch POST及原session权威读回通过。实际 page.close({runBeforeUnload:true}) 后 close 事件及 isClosed 断言通过，但随后15秒服务 GET 仍为第二材料 lastEvent=open/revision1，close权威确认 FAIL，实际 attempt exit1。正常上下文没有观测到 close POST；原因 NOT_VERIFIED，不将其它恢复场景预期409当作本次原因，也不据此宣称标记丢失或已证实新产品缺陷。A5仍未闭合，R3整轮不是PASS。原日志、失败及所有未运行状态保留。

模板及两份 fresh 生成 CSS 与原产物相同，原12外观上下文本批NOT_RUN、仅按身份继承。自有静态/Python入口已经清理，用户试用5184/8776与真实数据/provider未施工。R4固定产品验收及辅助13PASS/5FAIL/aggregate exit1、R7独立PASS保持；R5待重定界，R6/R8/R9未启动。

执行窗口结束且父审核完成后，只释放前端一线最小同步 README/PROJECT_MAP/CURRENT_PROJECT_STATUS 三个R3当前段落。其文档检查与 git diff --check exit0，closing仅三份事实段落变化，其余1234文件保持，状态 FACTS_SYNCED_BATCH_ENDED / idle，见 C:/Users/0/AppData/Local/Temp/reader-f6-dispatch-20261003-8e01f317/frontend-one/R3-batch-facts-20261004-6ec014a2/handoff.md。父最终追加本节并执行文档/diff/closing结构身份封存；不把文档同步等同于产品验收完成。

## 15. 用户批准新独立执行对话处理 R3 关闭保存

2026-10-04。用户明确授权新建执行对话，使用 GPT-6.1-sol / high，执行 [关闭保存修复方案](E:/read-web-next-optimization/docs/design/reader-large-file-decomposition/03-reader-close-save-repair-plan.md)。第14节旧批次仍已结束，原 FAIL 保留；这是按新方案单独释放的专项，不启动其它拆分或功能改造。

新对话在本项目 local 运行，不用 worktree；是本专项唯一施工者。先保存当前脏工作 opening 与旧证据身份，按方案最多两个固定诊断对照完成定位，然后仅修实际失效边界并做必要验收。预期的失败诊断对照按真实结果记录，不误称验收 PASS；不能自动追加第三次诊断，正式补修后的必要验证实质失败则停。已经通过的 open/mark/switch 与 CSS 身份保持，不降低原 close 服务权威断言。

产品模板/CSS、协议/IndexedDB schema、用户试用服务和真实数据/provider不在授权范围。旧三线已结束施工；新对话不创建/指派其它任务，不发起自动补修轮次。完成后停写 WAIT_REVIEW；无法定位或仍失败则停写并交失败证据。README/PROJECT_MAP/CURRENT_PROJECT_STATUS 在独立审核前冻结，dispatch仍由父维护。

## 16. R3 关闭保存专项已独立 PASS，固定范围收口

新执行对话已完成并停写 WAIT_REVIEW / idle，执行根 C:/Users/0/AppData/Local/Temp/reader-r3-close-save-20261004-6aabe4c7。父按第15节方案及原R3-A1–A6完成一次独立审核，见 [本次独立审核](C:/Users/0/AppData/Local/Temp/reader-r3-close-save-independent-review-20261004-d7bcf77b/review.md)。正常材料打开及A5剩余关闭保存缺口通过，结合原列表/生命周期/变更/其它操作和外观身份对应的证据，R3固定范围独立PASS；不等于R1–R9或全仓全部完成。

两个固定诊断使用相同fresh完整App/fixture/CSP/只读观测，8份实际producer副本完全相同，仅browser route full/none区分。full诊断实际关闭时beforeunload/pagehide、本地outbox落盘和原keepalive调用都存在，但原close到正常App启动补发才达服务，在线FAIL保留；none诊断原close即达服务。父确认本机该Temp入口全量browser route是在线发送失败的定位边界，Chromium内部具体取消机制仍NOT_VERIFIED。仅新Temp入口去除拦截、以相同服务端CSP限制外部网络，专项产品/正式检查/CSS零修改，原open/endLoad补修保留。

正式完整App真实open→mark→switch→page.close通过，服务在恢复启动前已确认原第二材料session的close/revision2。之后正常启动以同job/session/operation幂等补发，HTTP200/idempotent=true、revision仍2/openCount仍1，确认后outbox为空；清理页面产生的另一新session close不作为原关闭证据。父直接查看trace/截图及代理/ASGI收件、服务权威读回，结构/hash检查仅核身份。原失败不覆盖，正式在线断言未降低；没有第三次诊断或额外修复轮。

父独立核对1238项目文件零漂移、opening-source字节、12份旧证据、284份执行证据、29份产物及生成CSS身份通过。原完整Panel/完整10组/12外观等本专项NOT_RUN，仅按无漂移来源继承。执行自有资源已清理，父再探测3889/3894/4216/1898均ECONNREFUSED。用户5184/8776、真实数据/provider、日常树未施工；R4原固定验收及辅助13PASS/5FAIL/aggregate exit1、R7PASS、R5待重定界与R6/R8/R9未启动保持。

父审核通过后，同一执行者仅最小更新README/PROJECT_MAP/CURRENT_PROJECT_STATUS三个R3当前段落及关闭保存方案状态行，文档结构检查和git diff --check exit0，其余1234文件与旧执行根未变化，状态R3_FACTS_SYNCED / idle，见 C:/Users/0/AppData/Local/Temp/reader-r3-close-save-facts-20261004-32a5282f/handoff.md。父追加本节并完成最终文档/diff/closing封存，不刷新历史全仓Last verified，不启动后续功能或拆分。


### R5 本文整理职责迁移独立收口（2026-10-04）

R5按重定固定A1–A7独立PASS，见[独立报告](C:/Users/0/AppData/Local/Temp/reader-r5-independent-review-20261004-6bfa8721/review.md)。本文整理DOM、候选展示/展开、按钮、拖拽缩放、发音、关闭释放与焦点返回由src/features/vocabulary-preview/create-article-settlement-dialog.js单独拥有；vocabulary-preview-module.js继续负责文章身份、缓存、进度、AI、claim、入库及owner协调。workflow-ui.css仅补准确@source，生产CSS哈希保持。D/M/B前置分别独立PASS；原手工文件旅程NOT_RUN且功能已退役并清退，原dictionary历史FAIL保留。R5当前生产四组合/代表状态/精简保存重开/words-all-skip通过；切文原伪PASS撤回INVALID，当前桌面/移动完成隔离补证有效，opening桌面补测FAIL保留，迟到完成配对仍NOT_VERIFIED。源码及原日志见C:/Users/0/AppData/Local/Temp/reader-r5-settlement-dialog-20261004-01a10648/handoff.md。旧扫描范围因功能退休取消，不改为PASS；不更新全仓Last verified或推广状态。R6/R8/R9尚未施工，后续按R6→R8→R9执行。此前相关段落为历史记录。


### 大文件职责整理有限收尾（2026-10-04）

用户要求简化并尽快完成后，R6模板/弹窗/controller及R8三组HTTP路由已施工；针对性检查、156项后端测试、路由/OpenAPI及生成CSS身份、当前Vite加载/播放/交互通过。R9仅完成身份/接线/清单/文档与现有检查的有限自检；R6/R8及本轮R9独立审核NOT_RUN，原完整跨轮生产旅程未补齐。既有architecture与workflow-streaming检查FAIL已在opening副本复现；当前dictionary:test 30项PASS。此前阶段状态段落保留为历史，不代表最新状态。 详见[2026-10-04 有限收尾交接](E:/read-web-next-optimization/docs/design/reader-large-file-decomposition/handoff.md)。

AI模板与弹窗分别由src/features/annotation-backfill/annotation-backfill-template.js、create-annotation-backfill-dialog.js拥有；annotation-backfill-ai-module.js保留运行/身份/导入协调。youtube_workflow/http下workflow_routes、reader_media_routes、capability_routes及__init__按原顺序集中55个业务端点；service.create_app保留安全/lifespan/metrics/CORS装配，R7及其它service实现保持。源码有限施工已结束，不刷新全仓Last verified，不宣布原R1–R9或全仓独立PASS，功能改造未施工。
