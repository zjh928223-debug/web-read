# R9：合并验收、职责地图与本轮收口

**当前状态与简化范围以[2026-10-04 有限收尾交接](E:/read-web-next-optimization/docs/design/reader-large-file-decomposition/handoff.md)为准。** 用户要求简化并尽快完成后，R6模板/弹窗/controller及R8三组HTTP路由已施工；针对性检查、156项后端测试、路由/OpenAPI及生成CSS身份、当前Vite加载/播放/交互通过。R9仅完成身份/接线/清单/文档与现有检查的有限自检；R6/R8及本轮R9独立审核NOT_RUN，原完整跨轮生产旅程未补齐。既有architecture与workflow-streaming检查FAIL已在opening副本复现；当前dictionary:test 30项PASS。此前阶段状态段落保留为历史，不代表最新状态。 下文原完整方案及原始状态保留供追溯，不能据其待开工或原验收表误判当前进度。


状态：所有实际施工轮独立PASS、取消子范围有第5项依据后执行。无新产品施工，预计1–2小时验收/整理，独立复审另计。必读[共同约定](E:/read-web-next-optimization/docs/design/reader-large-file-decomposition/00-common.md)及所有实际已执行轮closing/review。

## 1. 目标与输入

确认分轮结果在同一个当前源码中共存、无漂移，真实受影响旅程可贯通，责任地图准确。第6项以选定保留职责整理完成为结论，不声称所有大文件都短了或全项目零问题。

本轮输入：R1前总基线身份/Temp生产产物；各轮opening/final/patch/原日志/自检与独立结论；第5项功能保留/退休表及实际已删除证明；最终源码。只取消有明确证据的子范围，不能把未测改成“功能没用所以不测”。

## 2. 范围

默认不改产品/检查脚本/依赖/配置。允许对应更新 E:/read-web-next-optimization/PROJECT_MAP.md、README.md、CURRENT_PROJECT_STATUS.md 的本轮职责/状态，及 docs/design/reader-large-file-decomposition/handoff.md；清单仅修正已发现的本轮身份登记错误，不改原状态。

报告、raw测试、产物保存Temp。如发现新增P0–P2问题，记范围和受影响轮次，退回该轮方案修复，再做独立复审；R9不顺手修UI或重新拆模块。两次失败停止规则按实际同任务计，不以换成R9补证规避。

## 3. 顺序

1. 比对全部实际已收口文件current hash，检查取消范围已不存在或不再被调用；不是盲看git diff HEAD的总行数。
2. 核对模块/生命周期所有者：App保存范围、面板UI与library/mutation、SRS media/translation、vocabulary dialog/controller、annotation template/dialog/controller、backend运行范围/router。
3. 核对跨轮消费与残留：没有重复保存实例、listener/timer/lock/map、无失效import/@source/库存记录；没有重新发布退役store/global，不改变薄入口/schema/owner。
4. fresh最终Temp生产构建和self-owned测试Host。执行下表跨模块代表旅程，不把各轮所有矩阵整套再跑；前轮证据与无漂移范围按身份继承。
5. 对第5项明确退休的功能记录期望差异；对仍保留的UI拿总基线或该轮before做同入口/同数据/视口的生产CSS与computed对照。不能把功能删减的真实变化伪装成零差异。
6. 核对正式清单/文档、必要scope状态，生成合并交接。待独立读审给R9固定标准 verdict后宣布第6项限定收口。

## 4. 必要跨轮旅程

| 旅程 | 实际验证 |
| --- | --- |
| 阅读保存 | 标准素材open→mark edit→播放progress→切另一素材→page close→重开outbox恢复；带同一job/session/operation身份。 |
| UI与保存分离 | App存活时真正卸载素材面板→继续mark/progress/close保存；重挂不重复实例/监听。 |
| SRS（保留时） | App真实“今日复习”入口→答案/翻译→词/原句→close/reopen→正常评分推进；旧代特殊13场景无漂移时继承R4完整证据。 |
| 本文词汇（保留时） | preview scan/explanation与settlement refine/remove/relearn/apply/skip/close，各至少一次真实入口；特殊scan/claim分支继承R5。 |
| AI标注（保留时） | frontend配置/run→HTTPstart/poll→import→annotation/候选读回；R6/R7各自错误/cancel/model边界按无漂移继承。 |
| Host/媒介 | 最终Host的health/static/认证JSON/媒体Range和相关owner/capability链，原安全完整测试无漂移继承R8。 |

自然播放不是本轮新验收目标：progress可使用合成媒体，须标注边界；不以play调用证明真实发声。Host受控测试不等于用户的5184/8776服务更新。

## 5. 固定验收 R9-A1–A6

| 标准 | 必须达到 |
| --- | --- |
| A1 范围闭合 | 实际施工轮全部独立PASS；每项取消有第5项依据，必要项没有未关闭FAIL/NOT_RUN/NOT_VERIFIED。 |
| A2 身份共存 | 各最终源码/current相符，跨轮增量互不覆盖；整体dirty仍保留，清单无本轮断链。 |
| A3 接线正确 | 上述跨轮旅程全部完成，App唯一保存范围、前后端module接口与资源清理保持。 |
| A4 外观保持 | 实际搬动态UI的保留入口生产utilities/computed/几何/focus通过，期望功能删除差异明确，不升级全应用视觉PASS。 |
| A5 文档可用 | 每项保留职责能在PROJECT_MAP找到owner/consumer/生命周期；没有失效引用或过时同名职责事实。 |
| A6 证据与回滚 | 总基线→各轮→final串联，原失败保留，自有服务关闭，回滚影响和文件顺序明确，不做数据/日常promotion。 |

## 6. 必要命令与继承

完整执行最终 git diff --check、verify:test-inventory、verify:script-inventory、verify:current-documentation、fresh最终Vite build（outDir/cache/产物在Temp，实际命令记录）。另外运行 node scripts/read-web-load-check.cjs 和 node scripts/read-web-interactions-check.cjs，READ_WEB_URL 指向本轮自有最终Host，READ_WEB_ARTIFACTS_DIR 指向Temp，使用明确的现行合成fixture；真实HTTP保存链仍由上表的受控Host旅程验证。实际命令/fixture身份保留，构建或普通reader交互成功不替代上面保存与前后端journey。

不默认启动 npm test/verify:full：它包含Python环境/在线等独立范围；明确保留NOT_RUN。无新漂移且有独立PASS的各轮完整focused/分支矩阵不重复，为跨轮新接线选择必要代表用例。若当前hash漂移影响某项，则只重跑其必要完整原入口及独立确认，不静默继承失效证据。

## 7. 交接与最终措辞

交接表逐轮列“施工/自检/独立/取消条件/最终文件身份”，原历史FAIL和有限证据分列。第6项最终措辞：“已确认保留的职责按R1–R8实际范围整理，R9合并独立验收PASS”；保留的长但单一职责文件列名和原因。

用户第5项仍有未决定内容时，只能报告第6项当前已执行子范围PASS，不能宣布完整第6项已收口，也不能把待决定轮次写为取消。本轮不重启试用服务，不宣称daily可promotion。

