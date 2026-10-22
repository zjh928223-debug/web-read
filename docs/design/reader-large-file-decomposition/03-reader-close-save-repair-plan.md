# R3 关闭保存修复方案

2026-10-04。状态：执行及父独立审核 PASS，见 [R3 关闭保存专项独立审核](C:/Users/0/AppData/Local/Temp/reader-r3-close-save-independent-review-20261004-d7bcf77b/review.md)。本专项产品零修改；原方案与原集中批次 FAIL 边界保留，不放行 R5/R6/R8/R9。

## 目标与已知事实

只解决原 R3-A5 中正常材料 open → mark → switch → 实际 page.close 后的关闭保存确认。打开补修保留；其它拆分、功能删除、布局/CSS、数据模型及 HTTP 契约不在范围。

原 d84691ce 真实 trace 确认 page.close({runBeforeUnload:true}) 和实际 pageClosed；服务 GET 15 秒保持第二材料 lastEvent=open/revision1。原 helper、raw 和 trace.network 没有观测到 close POST。未收集实际关闭处理内部状态或关闭后 outbox，因此根因仍 NOT_VERIFIED。

当前源码已有同步 outbox 落盘、keepalive 尝试及启动补发：use-reader-session-persistence.js 的 handleBeforeUnload / queueReaderKeepalive / replayReaderOutbox，youtube-workflow-client.js 的 keepaliveReaderActivity，reader-outbox-storage.js 的 writeReaderOutboxEntry。本方案复用它们，不另写一套保存机制。

## 一次定位，固定最多两个对照运行

第一优先假设是测试入口的全量 context.route 拦截影响关闭期间请求。原 isolation-preload.cjs 对所有请求调用 route.continue；目前这是明确存在的测试设置，是否导致失败尚未证明。其余假设依次为产品关闭事件/guard跳过，以及已调用发送但 HTTP/服务落盘未完成。

用新独有 Temp、当前 fresh 完整 App、同源自有安全 loopback、有限 Fake 和有效 WAV，沿用默认 Python import 前 memory/Temp/cache/loopback 隔离；不用用户 5184/8776 或真实数据/provider。旧日志、产物和脚本不覆盖。已有真实控件操作与严格关闭后 lastEvent=close 断言保持。

1. 原拦截设置运行一次，加最小只读观测：beforeunload/pagehide 的实际触发、reader outbox 的真实同步写入、原 fetch 的 keepalive 调用及 payload 身份、代理收到请求、服务处理/权威 GET。只观察并原样转发，不伪造生命周期、不写产品状态、不伪发 close。诊断信息不保存 token。
2. 保持同样 fixture、网络限制与观测，仅移除浏览器请求拦截，再运行一次。两次均用相同仅允许本地资源的服务端 CSP 控制外部网络，不能为了关闭补测开放真实 provider。不能保留“只拦外域”的 browser route 后声称已经验证无拦截。实际收件依据服务端接收与权威数据，不单依赖页面关闭后可能不完整的 page.on('request')。

关闭后的本地观测由同源空白观察页读取真实 outbox；它不挂载 App、不启动保存/补发、不注入 reader outbox。若需要补发验证，再明确启动一次正常 App，读取原关闭 session/operation 的服务结果及收据处理；新的 open 不能冒充旧 close。这一恢复步骤属于已有 A5，不用它替代正常在线关闭严格断言。

两个对照完成后必须形成具体定位。仍不能区分的，交付原始信号及未确定边界后停止，不扩大日志工程，不开始猜测性产品修改。必要的内部 guard 诊断须先明确缺少哪一个信号与对应文件，不能自动增加第三次运行。

## 按定位结果实施最小修复

| 定位结果 | 允许修复的对象 | 必须保持 |
| --- | --- | --- |
| 本地 outbox 与原 keepalive 调用存在；移除拦截后服务成功收到 close | 新 Temp 验证入口/网络限制，必要的直接回归测试接线 | 产品保持；不能增加固定等待或降低 lastEvent=close 断言。 |
| 真正关闭事件发生，但产品关闭处理没有生成正确 outbox | 实际确认有误的事件接线、guard 或 close payload 所有者 | 成功激活后结束加载的现有补修，过期/取消/卸载保护，已有单一根保存范围。 |
| outbox 正确且已调用发送，但请求/服务确认失败 | 证据定位到的 client 传输或现有保存/补发边界 | operationId、revision 冲突、鉴权、按 job/session 隔离、确认后才能移除 outbox。 |

产品修改前先把本次已确认触发条件写成真正经过该调用链的失败回归；不写只调用某个浅层 mock 的“通过”测试。仅改具体失效边界，不预先授权重写 client、保存协调器或后端。若需要跨边界、改协议/IndexedDB schema，则停止并另定范围。

## 固定验收与终点

- 原完整 App 真实 open/mark/switch 正常，真实关闭后，服务明确保存同一第二材料、关闭前 session 的 close；保持原有严格在线确认。
- 关闭记录需要补发时，真实 outbox 保留且正常启动后按原 operation/session 补发，不被新打开记录冒充，不丢失、不重复、确认后才清收据。若未发生补发路径，明确报告 NOT_RUN，不用静态或注入状态补证。
- 若改产品，运行确认问题的回归、本轮 fresh 构建和实际组合旅程，以及直接受影响的原 Panel / 完整10组检查。未变 CSS/模板和无关原检查按身份继承，不重复外观矩阵与全仓测试。若只改 Temp 入口，重跑该真实组合及入口直接检查即可，不盲目重跑已通过产品检查。
- 唯一施工者停写后，父按上述固定标准独立审核一次；审核结果对应原 A5 或具体 P0–P2 失败，不新增验收规格。
- 产品修改、本地/远端身份、原日志和失败均留存；不能把“关闭立即保存失败但本地还有记录”改写为本次在线 PASS。仍有必要验证实质失败则结束该专项，不自动启动下一轮补修。

最终只据实际结果更新 R3 状态。诊断计划、源码阅读或文档门禁通过都不等于 R3 验收通过。
