# R8：收拢 HTTP 路由注册，保留 Host 与域安全装配

**当前状态与简化范围以[2026-10-04 有限收尾交接](E:/read-web-next-optimization/docs/design/reader-large-file-decomposition/handoff.md)为准。** 用户要求简化并尽快完成后，R6模板/弹窗/controller及R8三组HTTP路由已施工；针对性检查、156项后端测试、路由/OpenAPI及生成CSS身份、当前Vite加载/播放/交互通过。R9仅完成身份/接线/清单/文档与现有检查的有限自检；R6/R8及本轮R9独立审核NOT_RUN，原完整跨轮生产旅程未补齐。既有architecture与workflow-streaming检查FAIL已在opening副本复现；当前dictionary:test 30项PASS。此前阶段状态段落保留为历史，不代表最新状态。 下文原完整方案及原始状态保留供追溯，不能据其待开工或原验收表误判当前进度。


状态：待R7独立PASS（若AI标注轮因退休取消，待其取消依据和当前service基线确认）、第5项相应API保留清单确定。施工/自检估计1.5–3小时，独立复审另计。必读[共同约定](E:/read-web-next-optimization/docs/design/reader-large-file-decomposition/00-common.md)。

## 1. 目标与明确保留

service.create_app 当前承担lifespan、request metrics、安全/CORS中间件及所有HTTP endpoint注册。将具体路由注册集中到少量业务router文件；create_app保留manager/policy/lifespan/中间件装配与稳定公开入口。

production_host_prototype.py虽然2188行，但PathPreservingAsgiDispatch中的owner guard/freeze/promotion/transport是敏感既有装配，本计划不按长度重写它。其create_workflow_app消费和Node capability分派保持字节，作为本轮必须验的调用者。不会更换FastAPI、移动Node能力服务或改owner schema。

## 2. 范围

产品修改 E:/read-web-next-optimization/tools/subtitle-workflow/youtube_workflow/service.py 的create_app路由注册；新增同目录 http/workflow_routes.py、http/reader_media_routes.py、http/capability_routes.py 与必要 __init__.py。

workflow router：job/history/config/credential/import/maintenance/annotation等已保留endpoints；reader/media router：marks/activity/session/files/media/recent等保留endpoints；capability router：**直接workflow app**现有dictionary/Edge-TTS兼容端点。如果第5项已删某API，按删除后的当前基线登记，不复活。

不得改JobManager/R7 runtime实现、production_host_prototype.py、windows_owner_request_policy、owner registry/handlers、media path/Range实现、launcher/runtime config。helper真正属于已有service层的保持原所有者，注册模块通过明确依赖消费，避免反向import造成循环；不使用mixin或运行时替换类。

测试允许 test_service_app.py/test_production_host_prototype.py 增加前后route/OpenAPI契约比较或修正显式import归属；原安全/媒体/生命周期断言保留。inventory/PROJECT_MAP仅注册文件归属和真实消费。

## 3. 步骤

1. opening时记录完整route表：method/path/name/statusCode/response media、endpoint参数/default/body/query及实际OpenAPI schemas。包括HEAD/Range和同名path多method。
2. 保留create_app公开签名、manager默认注入/close、loopback bind检查、policy/token/origin/profile解析、metrics/lifespan/CORS与安装顺序。
3. 分组机械迁移endpoint函数，明确manager/policy依赖。保持Request注入、类型注解、可选body/default/status code/header、HTTPException与Response/StreamingResponse。
4. 按原相对顺序注册，尤其固定paths与/api/jobs/{job_id}匹配次序，防动态参数吞固定入口。不能为了三组router排序改变实际路由优先级。
5. 比较before/after route/OpenAPI，解释module relocation造成的非业务标识差异，不能笼统忽略operationId/schema变动；客户端可观察契约保持。
6. 完整service/prodHost/security/media/owner调用验证与真实HTTP smoke。原Node→capability proxy边界由既有real-HTTP测试检验，不对API重新分配owner。
7. 交接停止，R9汇总最终范围。

## 4. 固定验收 R8-A1–A7

| 标准 | 必须达到 |
| --- | --- |
| A1 装配 | service公开create_app保留，真正路由只有一个注册来源，无循环import/重复endpoint。 |
| A2 HTTP契约 | method/path/order/body/query/default/响应/错误/OpenAPI客户端可见契约相同，已退休API不复活。 |
| A3 安全 | loopback/token/origin/freeze/drain、public health例外和CORS保持，越权路径仍拒绝。 |
| A4 媒体 | HEAD/Range/ETag/206/416、身份/只读授权路径、禁止用户自传path保持，不把文件全量读入内存。 |
| A5 请求观察 | route-template metrics/headers与redaction保持，不新增记录输入/secret，不跳过middleware。 |
| A6 Host/owner | prodHost相同分派到workflow/Node/owner服务，健康/静态SPA与所有关键域调用正常。 |
| A7 证据 | 完整必要tests与真实HTTP链通过，opening路由契约/最终源码/日志/回滚齐备。 |

## 5. 必要验证

配置Python入口，所有test数据/缓存注入Temp：
- node scripts/run-python-command.mjs --config config/runtime.optimization.json --cwd tools/subtitle-workflow -- -m unittest tests.test_service_app tests.test_production_host_prototype tests.test_windows_owner_request_policy
- 同一入口完整 tests.test_workflow_owner tests.test_reader_session_owner tests.test_marks_activity_owner tests.test_annotation_owner；注册范围如未影响的词库/preview owner通过现行Hosttyped smoke和无漂移身份继承，不为数量重跑其它数据库suite。
- npm.cmd run verify:youtube-workflow-client
- npm.cmd run verify:youtube-workflow-streaming
- npm.cmd run verify:windows-owner-api-client
- 共同门禁与Python语法。

在自有random loopback production-styleHost，真实请求 health/static SPA→认证JSON→job/session/marks/activity→Range HEAD/GET→annotation operation（保留时）及能力代理。401/403/404/416、missing token/untrusted host/origin拒绝由完整原checks覆盖，不只Happy Path。existing ProductionHost tests含真实Node capability跨HTTP边界时完整执行，先检查其子进程/data/dist都隔离，不连接用户服务。

不需要本轮真实在线TTS/Gemini、真实Windows credential或用户tailnet。完整真实跨机/自然媒体仍NOT_RUN。

## 6. 回滚与交接

交接route/OpenAPI before/after、router→manager/owner/Node调用表、原中间件顺序证明、HTTP/Range实际证据、R8-A1–A7。回滚只恢复create_app/route增量，保留R7运行范围和R1–R6成果；路由表静态同样不替代HTTP实际旅程。

如需为了抽router修改Host权限/owner promotion/数据契约，停止该扩展，不把深层owner重写纳入本轮。

