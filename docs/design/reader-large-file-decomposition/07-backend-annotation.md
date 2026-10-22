# R7：从 JobManager 分离 AI 标注操作运行范围

状态：待R2独立PASS，第5项确认后端AI解释标注/对应run读取保留；R6保留前端时建议先完成R6，但本轮不能改变其HTTP契约。施工/完整自检估计2–4小时，独立复审另计。必读[共同约定](E:/read-web-next-optimization/docs/design/reader-large-file-decomposition/00-common.md)。

## 1. 本轮结果与取舍

service.py 当前4302行。JobManager同时管理普通素材队列和annotation backfill operation自己的线程、executor、锁、每model slot、deadline/cancel、batch/retry与run文件。本轮将后者集中为完整运行范围，JobManager继续普通素材队列、history/config及公开兼容入口。

不按路由名字把Node的dictionary/TTS能力搬进Python。当前production Host把能力路由委托Node，service.py中的同名实现也可能是直接workflow app的兼容路径；它们不因“同名”被误删，不扩大到词典/发音重写。

## 2. 精确范围

产品修改 E:/read-web-next-optimization/tools/subtitle-workflow/youtube_workflow/service.py 中annotation helpers、JobManager annotation装配/相关方法和close接线；新增同目录 annotation_backfill_runtime.py 与 annotation_backfill_template.py。

迁移 run_annotation_backfill/start/_run operation/get/cancel/public operation、model slot/operations/threads/executor的完整所有权，及parse/validate/scope/split/merge/history这组请求结果构造。需要读取manifest/outputDir/config/credential或workflow写入guard时用少量明确操作，不把整个JobManager传成万能上下文；普通jobs/pending/worker_thread/lock/store仍由JobManager持有。

public JobManager方法与create_app参数保留。已有外部消费者/测试访问annotation字段时须先列明：必要兼容getter指向同一runtime状态，不拷贝或维护两份。默认requester/jitter或函数存在直接import消费者时保留显式兼容导出，迁移调用者后再退，不用from *扩散。

检查：tools/subtitle-workflow/tests/test_service_app.py 对应真实模块归属最小调整，原行为assert保持；可增 tests/test_annotation_backfill_runtime.py 一个有限直接runtime检查覆盖构造/close泄漏。生产Host/owner/credentials/core/process_supervisor/durable格式不改；scripts/inventory与架构说明仅对应登记。

## 3. 顺序

1. 保存opening，列所有直接import/字段/方法访问，当前注入requester/jitter/credential及writer freeze/manifest验证时机。
2. 先搬template parse/scope/batch/validate/merge：文本/目标ID、错误分类和保存文件名/JSON保持，对同一原样例前后比对。
3. 新runtime创建同一ops/threads/lock/executor/slots，接入原run实现的config/output目录/credential/requester；保持max_workers、每model独占slot和不同model隔离。
4. 搬queued→running→ready/failed/canceled、deadline与cancel控制；provider未结束时slot释放必须仍在future完成callback，不能提早释放制造并发。
5. 搬run持久化/template/prompt/latest/history/result读取与merge；保持写入guard/校验先于副作用，失败仍保留原诊断材料，不改变目录/文件格式或canonical owner。
6. JobManager公开入口委托runtime；close在原生命周期顺序释放该范围，不改普通素材job flush/join。blocked provider场景继续可cancel/deadline，不引入无限join。
7. 完整service API测试及真实临时HTTP backfill操作，再做必要frontend smoke；交接停止，R8只能等本轮独立PASS。

## 4. 固定验收 R7-A1–A7

| 标准 | 必须达到 |
| --- | --- |
| A1 状态所有权 | 操作锁/pool/slots/maps只一份，JobManager普通素材队列不受影响，无循环import/动态setattr拼装。 |
| A2 API | start仍202，operationId/jobId/statusUrl/cancelUrl/response/error及get/cancel/404行为与原契约相同。 |
| A3 并发取消 | 同model限制、不同model隔离、cancel/deadline在provider阻塞时可完成；slot不提早释放，close不遗留新增线程。 |
| A4 数据输出 | batch/目标完整性/retry/jitter/merge/template/prompt/history/latest格式与路径相同；失败材料保留，无自动迁移。 |
| A5 安全 | workflow freeze/manifest/input验证/credential隔离与脱敏保持，无外网真实provider、真实系统credential/data副作用。 |
| A6 普通工作流 | JobManager启动、queue/cancel/retry、coalesced persistence/close、现有工具preflight行为不变。 |
| A7 完整检查 | full service tests、有限真实HTTP旅程、源码/日志/线程清理/回滚身份齐备，原未跑项不升级PASS。 |

## 5. 必要验证

通过现有配置Python入口，Temp数据/cache/pycache及注入假provider/credential：
- node scripts/run-python-command.mjs --config config/runtime.optimization.json --cwd tools/subtitle-workflow -- -m unittest tests.test_service_app
- 同一入口运行 tests.test_annotation_backfill_runtime（新增该文件时）及 tests.test_workflow_owner、tests.test_annotation_owner、tests.test_production_host_prototype。
- npm.cmd run verify:annotation-backfill-ai（R6也保留时，完整controller接口冒烟）
- npm.cmd run verify:youtube-workflow-client
- 共同diff/inventory/documentation及Python语法解析（不在源目录生成pycache）。

full ServiceAppTests已有202/background/cancel/deadline/model隔离、incremental/batch/失败材料和普通job恢复等行为，不只选3个成功用例。独立新测试测公开runtime行为，不mirror私有字段实现。

在随机loopback测试HTTPHost、fakeprovider/freshTemp标准素材上完整 start→poll→success/importable result；另hang→cancel与deadline，以及同model排队/不同model并行。真实HTTP不能只TestClient/直接方法充当网络证据；反过来HTTP成功也不证明真实Gemini/WhisperX。未知外网阻断，service only自有Temp，关自有Host与thread resources。

若测试环境阻断，原FAIL/NOT_RUN保留，不能靠换掉provider约束或去掉取消场景把本轮收口。

## 6. 回滚与交接

交接thread/pool/slot/guard/close所有权图，public兼容消费者与期限、旧/新输出结构、全部日志/R7-A1–A7。回滚本轮service与新增runtime增量，不回滚R6/UI或改数据目录；已有新格式数据即违反范围，不能通过补迁移掩盖。连续失败/明显超出运行范围按共同停止规则。

