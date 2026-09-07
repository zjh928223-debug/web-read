# 跨机单用户验收清单（E-004）

> 这是验收编排和证据记录骨架，不是跨机实测报告。当前文件不表示 Windows/Mac
> 实机、正式数据迁移、authority cutover 或 rollback rehearsal 已完成。没有在
> 指定 Windows 与 Mac 环境中实际执行并保存证据的项目，必须保持 NOT_RUN 或
> BLOCKED，不得从源码检查、占位 fixture 或模拟响应推导 PASS。

## 1. 范围、拓扑和运行模式

本清单针对一名用户、一台 Windows 和一台 Mac 的优化 profile。每次验收都必须
使用：

- config/runtime.optimization.json；
- 稳定前门 5184；
- capability sidecar 8776，以及内部 FastAPI candidate Host 的动态端口；
- E:\ReadWebData\SubtitleWorkflow-Optimization；
- 与日常 reader 的 5174/8766、日常数据根和受保护工作树完全隔离。

Windows 是重任务、凭据、媒体和持久数据 owner。内部 FastAPI candidate Host 与
8776 Node capability sidecar 只监听 loopback；Mac 只能经稳定前门访问，不能直连
内部服务。

验收必须分别注明下面的客户端路径：

| 路径 | Mac 侧行为 | Windows 侧边界 | 不可声称 |
| --- | --- | --- | --- |
| production | 浏览器直接打开 Windows 稳定前门；页面、/api、event 和媒体同源 | 稳定前门提供已校验的 dist 与 API；不依赖 Mac Vite | 不能把 remote-dev proxy 当 production 依赖 |
| remote-dev | Mac 运行轻量 Vite/HMR；业务请求继续使用相对 URL | Vite server-side proxy 只转发 /api、event 和媒体到 5184 | Mac 不启动 Python、SQLite、ECDICT、TTS、AI 或九组 Node capability plugin |

Windows LAN 地址只允许存在于 Windows 本地或 Mac remote-dev 的 server-side 配置；
不得进入 VITE_*、浏览器常量、dist 或截图中的不必要正文。production 不使用
CORS 作为认证，不使用签名媒体 URL。

## 2. 状态和证据规则

| 状态 | 允许的含义 | 最低证据要求 |
| --- | --- | --- |
| PASS | 已在指定环境实际完成操作，且所有预期 HTTP、contract、owner、媒体条件都满足 | 至少一个可定位的实际 HTTP/网络/owner/媒体或浏览器证据引用；不能只有占位文字 |
| FAIL | 已执行，但预期条件未满足 | 保存失败响应、日志或截图，并填写失败分类和复现信息 |
| BLOCKED | 需要的 Windows/Mac 环境、能力、授权或前置条件不存在，因而不能安全执行 | 写明 blocker、未执行的边界和下一次重试条件 |
| NOT_RUN | 有意没有执行，或当前只在准备验收骨架 | 不得填写为 PASS；证据引用可以为空 |

证据 manifest 使用 cross-machine-acceptance-evidence.v1.schema.json。提交到
仓库的模板 cross-machine-acceptance-evidence.template.json 固定为全部
NOT_RUN，它不是实测结果。真实执行时复制模板到隔离证据目录后再逐项填写，
不要覆盖模板。

建议的记录根和文件布局如下；这些目录由实际验收人员按 run id 创建，本任务不
创建也不写入真实数据：

    artifacts/cross-machine-acceptance/<run-id>/
    ├── evidence.json
    ├── 01-health/
    │   ├── http.json
    │   ├── windows-owner.log
    │   └── browser-network.png
    ├── 02-owner-query/
    ├── 03-local-capability/
    ├── 04-external-capability/
    ├── 05-workflow-polling/
    ├── 06-media-range/
    ├── 07-media-seek-switch/
    ├── 08-windows-restart/
    ├── 09-mac-reconnect/
    └── screenshots/

HTTP 记录至少保留方法、相对路径、状态码和相关响应头；contract 记录
contractVersion、domain、operation、outcome、commitStatus、revision 和
typed error；owner 记录 profile/release/instance identity、authoritative revision、
expected revision、idempotency key 的脱敏标识、receipt 或 receipt lookup 结果；
媒体记录 media identity、kind、Range、206、Content-Range、Accept-Ranges、
ETag 和 body 未被完整预载的证据。Token、Cookie、API key、Windows 绝对路径、
完整媒体 bytes 和无关个人数据不得进入 manifest、日志或截图。

## 3. 执行前检查

每个 run 先记录 run id、日期、操作人、客户端模式和 release/contract identity，
再确认：

1. Windows 明确启用 private-lan（或明确记录当前 loopback 对照 run），稳定前门
   监听预期地址；普通 optimization 启动仍保持 loopback 默认。
2. 5184 是唯一对 Mac 开放的入口，8776 和内部动态 Host 从 Mac 不可直接访问。
3. production 页面使用 Windows 同源 dist；remote-dev 只运行 Mac Vite/HMR
   proxy，且 Windows 地址不在 browser bundle。
4. health/owner/capability 响应的 contractVersion 为
   windows-thin-reader-api.v1，业务 operation registry 未被替换。
5. 当前 run 未读取、写入或切换到日常真实数据、E:\read-web-next 或
   E:\read-web；失败时只在优化 profile 重试或恢复上一可用 release。

## 4. 真实单用户路径清单

### 4.1 Windows 稳定前门 health

- 前置条件：Windows owner、稳定前门和所有需要的只读 health 依赖已启动；使用
  优化 profile，能从 Mac 访问配置的稳定前门。
- 请求/操作：从 Mac production 浏览器和（若验收 remote-dev）Mac Vite 页面分别
  请求相对 /api/health；记录实际 Host/origin 标签，不把 token 放入 URL。
- 预期 HTTP/contract 证据：成功 health 响应的 schema 为
  read-web-local-app-health.v1，包含 liveness、application/durable owner
  readiness、六域状态、profile lease、pending recovery、receipt summary、
  schema compatibility、Range media 和 dependency 摘要；不泄露 secret 或完整路径。
- 预期 owner/媒体证据：记录 profile、release、instance identity、owner revision/
  readiness 和 sidecar/internal Host 的 loopback 证明；媒体项只记录
  media=not-applicable。
- 失败分类：transport、authorization、contract、environment、
  owner-durability。HTTP 可达但 readiness 为 not-ready 不得标成健康 PASS。
- 重试/回滚：先保存原始脱敏响应并重试一次；若 release/owner 未 ready，保留上一
  可用 release，不写数据、不改变 authority。
- 证据位置：01-health/http.json、01-health/windows-owner.log、
  01-health/browser-network.png。

### 4.2 owner query

- 前置条件：4.1 health 已通过，选择一个已注册的只读 domain operation，准备
  requestId、correlationId 和可关联的本地记录标签。
- 请求/操作：经稳定前门调用 /api/app/owner 的 typed query envelope；记录实际
  domain/operation，不直接访问动态 Host 或 8776。
- 预期 HTTP/contract 证据：response 保持
  windows-thin-reader-api.v1，具有 domain、operation、outcome、
  commitStatus、revision、receipt、payload 和 typed error 边界；query 不把
  完整媒体、绝对路径或 secret 放入 JSON。
- 预期 owner/媒体证据：记录 authoritative revision、profile/release identity、
  query result checksum/摘要以及 receipt 为空或明确的 read-only 语义；媒体只保留
  identity/reference metadata。
- 失败分类：transport、authorization、contract、owner-durability、
  environment。
- 重试/回滚：保持相同 correlation 标签重新查询；若出现 stale/unknown，只重读
  authoritative state，不创建 command、不写 IndexedDB、不改变 owner。
- 证据位置：02-owner-query/http.json、02-owner-query/owner-query.json、
  02-owner-query/browser-console.png。

### 4.3 至少一项本地 capability

- 前置条件：选择 operation registry 中由 Windows 本地数据/服务提供且不会启动
  长任务的 capability，例如 profile.capability-query 或
  reader-session.query；准备优化 profile 的已知小型 fixture。
- 请求/操作：经 /api/app/owner 发出 capability-query 或对应只读 query；
  在记录中写明实际 capability 名称、domain、operation 和返回 revision。
- 预期 HTTP/contract 证据：capability 响应符合
  read-web-local-capabilities.v1，声明 capability、依赖、owner readiness 和
  bounded payload；请求/响应仍为 typed envelope，不把本地路径或 credential
  值传给 Mac。
- 预期 owner/媒体证据：记录本地 capability 的 owner/release identity、revision、
  commitStatus 为只读语义和无 mutation receipt；媒体为不适用或只记录引用。
- 失败分类：transport、authorization、contract、owner-durability、
  environment。
- 重试/回滚：只读 capability 可重新 query；若本地依赖缺失，标记 BLOCKED 并
  保留环境日志，不安装全局依赖、不切换数据根、不启动 sidecar 直连。
- 证据位置：03-local-capability/http.json、03-local-capability/capability.json、
  03-local-capability/windows-owner.log。

### 4.4 至少一项外部 capability

- 前置条件：Windows owner 已配置获批准的外部依赖/工具，使用明确的测试输入或
  用户批准的短任务；Mac 只有稳定前门，不能直连 provider、Python 或 Node sidecar。
- 请求/操作：通过稳定前门提交一个已注册的 external workflow capability（例如
  workflow 的 job-start），保存 request/correlation/idempotency 的脱敏关联，
  随后转入 polling；不把外部响应或凭据当作 owner receipt。
- 预期 HTTP/contract 证据：短请求返回稳定 job identity 和 typed outcome；command
  保持 expectedRevision/idempotencyKey 规则，owner receipt、commit status 和
  外部依赖状态分开记录；transport 200 不等于 durability success。
- 预期 owner/媒体证据：记录 owner authoritative revision、receipt/receipt lookup、
  job identity 和外部 capability 的实际执行结果；媒体只记录后续 opaque identity，
  不记录完整 bytes 或 Windows 路径。
- 失败分类：dependency、transport、authorization、contract、
  owner-durability。
- 重试/回滚：timeout 或 commit-unknown 使用原 idempotency key/receipt lookup；
  不用新 key 重复启动外部任务。外部依赖不可用时标记 BLOCKED/FAIL，不伪造
  job 完成，不清理 owner journal。
- 证据位置：04-external-capability/http.json、04-external-capability/owner.json、
  04-external-capability/external-dependency.log。

### 4.5 workflow polling

- 前置条件：4.4 已产生可查询的 job identity，或已有经 owner 验证的优化 job；
  浏览器标签可见性、重试窗口和 polling interval 已记录。
- 请求/操作：经相对 /api 的 workflow query/polling 读取 job、queue 和 progress；
  记录连续 snapshot 的 revision，切换一次页面可见/不可见状态并观察 single-flight、
  可取消和 stale revision 处理。
- 预期 HTTP/contract 证据：polling 只保留 immutable snapshot；重复请求不产生
  N+1 或重叠 mutation；stale revision 被拒绝，暂时 transport failure 不被显示成
  job failed。
- 预期 owner/媒体证据：每个 snapshot 的 job identity、owner revision、状态转换和
  receipt/command 关联可回溯；媒体仍只通过 identity/reference。
- 失败分类：transport、contract、owner-durability、dependency、
  environment。
- 重试/回滚：保留上一份 snapshot，按 visibility-aware policy 重试；不得紧密无限
  重试、改变 job state 或用新 operation identity 重放 command。
- 证据位置：05-workflow-polling/poll-sequence.json、
  05-workflow-polling/browser-network.png、05-workflow-polling/windows-owner.log。

### 4.6 audio Range 与 video Range

- 前置条件：已有两个可播放的 opaque media identity（一个 audio、一个 video）和
  owner 返回的同源相对 authorized URL；媒体文件属于优化 profile。
- 请求/操作：对 audio 和 video 各执行 HEAD，再执行 GET with
  Range: bytes=0-0；从 production 和 remote-dev（若本 run 覆盖）分别记录浏览器
  network 与前门响应。
- 预期 HTTP/contract 证据：两类媒体都保留 206、精确 Content-Range、
  Accept-Ranges: bytes、匹配 ETag 和 media identity header；HEAD 与 descriptor
  的 size/contentType/etag 一致；不接受整文件 200 body 作为 seek 结果。
- 预期 owner/媒体证据：记录 mediaId、kind、size、contentType、etag、revision 和
  authorized relative URL；证明 proxy/front door 未先读取完整媒体，且无 signed URL、
  Blob/ArrayBuffer 或 Windows 绝对路径。
- 失败分类：media-range、transport、contract、authorization、
  environment。
- 重试/回滚：保存 headers 后重新绑定同一 identity；若 ETag/identity 变化，释放旧
  resource 并重新 query descriptor，不继续播放旧 URL，不修改持久数据。
- 证据位置：06-media-range/audio-headers.json、
  06-media-range/video-headers.json、06-media-range/browser-network.png、
  06-media-range/windows-front-door.log。

### 4.7 多个 seek 位置与媒体切换

- 前置条件：4.6 的 audio/video Range 已有基线；浏览器可以播放两个媒体并记录
  current media identity。
- 请求/操作：在 audio 和 video 上分别执行开头、中段、末尾附近至少三个 seek；
  之后切换媒体、刷新绑定，再执行一次 seek。记录每次 Range 的位置、响应和当前
  media identity。
- 预期 HTTP/contract 证据：每个 seek 产生与位置相符的 Range 请求和 bounded response；
  headers 保留 206/Content-Range/ETag；切换后不再使用旧 URL，ETag/identity
  变化触发 rebind；没有完整媒体预载。
- 预期 owner/媒体证据：每次切换的 media identity、descriptor revision、ETag 和
  browser network 时间线可关联；owner 只返回引用/metadata，不把 bytes 放进 JSON。
- 失败分类：media-range、transport、contract、restart-reconnect、
  environment。
- 重试/回滚：先停止旧 media element 并释放资源，再按新 identity query/rebind；
  失败时回到最后一个已验证 identity，不回滚 owner 数据，不改用 Blob backup。
- 证据位置：07-media-seek-switch/seek-sequence.json、
  07-media-seek-switch/browser-network.png、07-media-seek-switch/browser-console.log。

### 4.8 Windows restart 后状态与入口可恢复

- 前置条件：至少一项 query/capability、一个可查询 job 或当前 media 已通过；保存
  restart 前的 release/instance identity、owner revision、job/media identity 和
  未确认 receipt lookup。
- 请求/操作：按后续 Windows launcher 的受控 stop/start/restart 流程重启 owner；
  等待稳定前门 health，再让 Mac production 页面刷新或让 remote-dev proxy 重连，
  查询原 job/session/media 状态。当前 E-004 不执行该真实重启，只规定证据格式。
- 预期 HTTP/contract 证据：restart 后入口仍为 5184，contract v1 和 profile identity
  一致；未确认 command 通过原 idempotency key/receipt lookup 恢复，不因 HTTP 传输
  成功误报 durability。
- 预期 owner/媒体证据：owner revision、receipt、job 状态和 media descriptor 可恢复；
  没有第二 writer、第二 instance 或错误的内部 Host；Range 可在重新绑定后继续。
- 失败分类：restart-reconnect、owner-durability、transport、contract、
  environment。
- 重试/回滚：保留 pending journal 和 restart 前证据；先查询 receipt/authoritative
  revision，再决定 retry。新 release 未 ready 时恢复上一 release/入口，不删除或重建
  数据根。
- 证据位置：08-windows-restart/before.json、08-windows-restart/after.json、
  08-windows-restart/windows-launcher.log、08-windows-restart/browser-network.png。

### 4.9 Mac reconnect

- 前置条件：已在 production 或 remote-dev 中完成一次健康 query；准备可控的短暂
  网络/Host 中断，且没有 pending mutation 会被自动重放。
- 请求/操作：断开并恢复 Mac 到 Windows 稳定前门的连接；production 重新加载同源
  页面，remote-dev 仅恢复 Vite proxy；重新执行 health、owner query、polling 和一
  次 media descriptor/seek query。
- 预期 HTTP/contract 证据：恢复后仍使用相对 /api、event 和 media URL；contract v1、
  owner revision 和 media identity 可重新读取；未确认 mutation 使用原
  idempotency/receipt lookup，不被新 identity 重放。
- 预期 owner/媒体证据：Mac 只保留当前 view state、可丢弃 cache 和未确认 intent；
  Windows owner 的 authoritative state、receipt、job/media identity 不变；Range
  与 ETag 重新验证通过。
- 失败分类：restart-reconnect、transport、owner-durability、media-range、
  environment。
- 重试/回滚：保留当前内存 intent 和上一份 immutable snapshot，按 retry policy 重连；
  Host 不可用时显示可重试状态，禁止静默写入 IndexedDB/localStorage 或启动 Mac
  canonical writer。无法恢复时保留上一可用 release。
- 证据位置：09-mac-reconnect/connection-sequence.json、
  09-mac-reconnect/browser-network.png、09-mac-reconnect/browser-console.log、
  09-mac-reconnect/windows-owner.log。

## 5. 结果汇总与范围边界

每个 run 的 evidence.json 必须逐项列出九个 journey id、状态、失败分类、
重试/回滚动作和 evidence refs。汇总只能反映 manifest 中真实记录的状态；不得把
本地 focused check、source-shape check 或 placeholder fixture 汇总成跨机 PASS。

本清单明确不包含公网部署、HA、压力/性能实验室、多用户并发、企业审计、复杂威胁
建模、pairing/PKI、自研 TLS、正式数据迁移、authority cutover 或桌面入口接管。
这些不是本验收骨架的隐含前置条件；若实际 run 依赖其中之一，应标记
BLOCKED，而不是扩张本任务范围。
