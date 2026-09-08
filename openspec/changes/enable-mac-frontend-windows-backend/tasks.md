## 1. 执行协议与迁移基线（严格串行）

本 change 的每个 `E-*` 实现项必须由一个新的 `gpt-5.6-luna`、`reasoning effort=max` 对话执行；对应 `R-*` 必须由另一个新对话只读审核。review 使用本阶段固定 `PHASE_BASE` 与任务 `TASK_HEAD` 比较，只报告会造成启动失败、功能回归、错误数据、双 writer、跨机不可用、媒体失败或无法回滚的 P0-P2 问题，不增加企业级防御要求。review 失败时必须新建 `F-*` 修复对话，并再次执行对应 review。

- [x] 1.1 `E-001` 只读盘点当前 branch、HEAD、未提交文件、现有验证结果和需保留的 WhisperX/语言处理/Preview/SRS 工作，生成所有后续任务使用的迁移基点候选，不修改源码或数据。
- [x] 1.2 `R-001` 独立确认 `E-001` 基点包含所有应保留工作、没有误用旧默认分支、没有读取或修改受保护工作树，并输出 `PASS/FAIL` 与最终 `PHASE_BASE`。
- [x] 1.3 `E-002` 将 production 由 Windows 同源提供 `dist + /api`、Mac remote-dev 使用轻量 Vite proxy、Windows 独占重任务和数据的双模式部署决策写入当前架构说明，明确不采用 Tauri、Mac production server、远程 NativePicker、自研 pairing/TLS 和独立 Git 仓库。
- [x] 1.4 `R-002` 独立审核部署决策是否保持 5184 稳定前门、8776 loopback sidecar、内部 FastAPI 动态端口以及 optimization/daily 隔离，且没有重新引入 production CORS 或签名媒体 URL。
- [x] 1.5 `E-003` 为现有 owner contract 增加最小 `private-lan` transport delta，保持业务 operation、typed envelope、revision、idempotency 和 receipt 语义不变，并明确只有稳定前门可对 LAN 监听。
- [x] 1.6 `R-003` 独立运行 contract checks，确认 8776 未被定义为公共 FastAPI 入口、Mac 不可直连 sidecar、loopback 默认没有改变、contract v1 业务字段没有被无意破坏。
- [x] 1.7 `E-004` 建立跨机自动/手工验收清单和可逐步填充的测试骨架，覆盖 health、owner query、至少一项本地 capability、至少一项外部 capability、polling、audio/video Range、seek、Windows restart 和 Mac reconnect。
- [x] 1.8 `R-004` 独立审核验收清单是否覆盖真实单用户路径，并删除或拒绝 HA、压力实验室、多用户、企业审计、复杂威胁建模等范围外要求。
- [x] 1.9 `G-0` 在 `R-001` 至 `R-004` 全部 PASS 后集成文档与 contract 基线，运行 OpenSpec strict validation，并记录下一阶段唯一 `PHASE_BASE`。

## 2. Windows private-LAN 稳定前门（严格串行）

- [x] 2.1 `E-101` 在 request policy 附近提取可单测的 LAN bind、request Host 和 same-origin 判断函数；默认只接受 loopback，只有显式 `private-lan` 配置才接受指定 LAN 地址，不实现网段扫描、设备指纹、MAC 识别或 rate limit。
- [x] 2.2 `R-101` 独立检查 IPv4、localhost、Host 带端口、缺失配置和非法地址测试，确认普通 optimization 启动仍然只允许 loopback。
- [ ] 2.3 `E-102` 扩展 Windows request policy，使显式 LAN mode 能校验配置的 Host、Origin 和现有 service token，同时保持文件路径、凭据和 owner mutation 在授权前不可达。
- [ ] 2.4 `R-102` 独立运行 request-policy 与 owner API checks，确认 LAN mode 未将 CORS 当认证、错误响应不泄漏绝对路径、loopback 请求行为没有回归。
- [ ] 2.5 `E-103` 扩展 `tools/optimization-stable-front-door.mjs` 的显式 LAN bind/Host/Origin 模式，保持 internal Host target 必须是 loopback、8776 不可作为 target，并透明代理普通 HTTP、Range 和 streaming response。
- [ ] 2.6 `R-103` 独立审核前门 diff 和测试，确认 LAN 只开放稳定前门、内部 target 限制仍在、Host/Origin 重写正确、activation journal 与 previous release 路由没有回归。
- [ ] 2.7 `E-104` 新增 LAN 专用 RuntimeConfig，不修改 `config/runtime.optimization.json`；配置只包含非 secret 的 bind/public URL/profile 信息，并继续使用 `E:\ReadWebData\SubtitleWorkflow-Optimization` 作为开发验证数据根。
- [ ] 2.8 `R-104` 独立审核新配置不含 API key、Cookie、代理凭据和日常真实数据根，且原有 5184/8776 optimization config 原样通过验证。
- [ ] 2.9 `E-105` 新增 LAN 专用 launcher 入口，复用现有 build、immutable release、front door、candidate Host、capability sidecar、health、stop 和 rollback 模块，不复制第二套 launcher 生命周期系统。
- [ ] 2.10 `R-105` 独立检查 launcher 不绕过 Python health、不修改全局 Python、不停止身份不匹配进程、不复用 daily 5174/8766，启动失败时保留上一可用 release。
- [ ] 2.11 `E-106` 增加 Windows 本机的 LAN 模式自动验证，证明 5184 稳定前门可用、内部 Host 和 8776 仍为 loopback、静态页面和关键 API 能经前门访问；测试不得修改日常 reader 或日常数据。
- [ ] 2.12 `R-106` 独立复跑 LAN/loopback 监听、health、production preview 和 launcher focused checks，核对实际监听地址而不是只检查配置文本。
- [ ] 2.13 `G-1` 集成 `E-101` 至 `E-106`，在干净阶段 HEAD 运行 LAN focused checks、现有 optimization launcher checks、production preview 和 owner request-policy checks，全部通过后记录新 `PHASE_BASE`。

## 3. 跨机网络基础（A/B/C/D 四条并行 Lane）

本阶段 `Lane A Owner API`、`Lane B Media`、`Lane C Workflow polling`、`Lane D Mac remote-dev` 可以从同一个 G-1 基点并行；若两个任务需要修改同一热点文件，则必须改为串行。

- [ ] 3.1 `E-201A` 验证并最小调整 owner API client，使 production LAN 页面继续使用相对 `/api/app/owner`，保留 typed response validation、timeout、revision、idempotency、receipt 和 `commit-unknown` 语义，不加入 Windows IP 常量。
- [ ] 3.2 `R-201A` 独立运行 owner API client/contract checks，确认 transport 失败不会被包装成 committed、backend 地址没有进入 browser bundle、现有 loopback 调用仍通过。
- [ ] 3.3 `E-201B` 建立经 LAN 稳定前门的 media Range 自动探针，覆盖 `HEAD`、`bytes=0-0`、`206`、`Content-Range`、`Accept-Ranges`、`ETag`、media identity、`416` 和文件变化后的 rebind。
- [ ] 3.4 `R-201B` 独立复跑 media checks，确认测试和实现都没有把完整媒体放进 JSON、Blob backup 或内存预载，也没有返回 Windows 绝对路径。
- [ ] 3.5 `E-202B` 在用户选定的主要 Mac 浏览器上完成真实 audio/video 播放、多个 seek 位置、素材切换、刷新重绑与 ETag 变化手工验收，记录可复现证据，不顺手修改其他域。
- [ ] 3.6 `R-202B` 独立复核浏览器证据和网络请求，确认 Range 未退化为整文件下载、旧 URL 未在素材切换后继续播放、失败场景能重新绑定。
- [ ] 3.7 `E-201C` 验证并最小调整 workflow polling 的跨机行为，保持 single-flight、visibility-aware、可取消和 stale revision 拒绝；暂时网络失败时保留上一 immutable snapshot，不实现 SSE。
- [ ] 3.8 `R-201C` 独立运行 polling/client checks，确认没有 N+1、重叠轮询、无限紧密重试或把 transport failure 显示成 job failed。
- [ ] 3.9 `E-203D` 增加 Mac remote-dev Vite mode，禁用九组后端 Vite plugin，并将 `/api`、event 和媒体请求代理到配置的 Windows 5184；Windows 地址只存在于未进入 bundle 的 server-side 本地配置。
- [ ] 3.10 `R-203D` 独立检查 remote-dev build/config，确认 Mac 不启动 ECDICT/SQLite/TTS/AI capability、API 地址不进入前端 bundle、Range headers 能穿过 proxy、普通 Windows dev/production build 不受影响。
- [ ] 3.11 `E-204D` 编写 Mac remote-dev 的最小操作说明和 smoke command，覆盖 HMR、owner health、一个 capability 请求、polling 和媒体 seek；不得增加常驻 production Mac server。
- [ ] 3.12 `R-204D` 独立在 Mac 或等价环境执行 smoke 流程，确认关闭 Vite 后 production 仍可直接由 Windows Host 提供。
- [ ] 3.13 `G-2` 分别集成四条 Lane，解决热点文件冲突后在统一阶段 HEAD 重新执行 owner、media、polling、remote-dev、production preview 和 Mac 实机 smoke，并记录下一阶段 `PHASE_BASE`。

## 4. Reader Session 远程只读（严格串行）

- [ ] 4.1 `E-301` 建立 Reader Session remote query adapter，只封装 snapshot、current revision、media identity 和 restore status 查询，复用现有 owner client validation，不写 IndexedDB 或页面状态。
- [ ] 4.2 `R-301` 独立测试正常、not-ready、not-found、unsupported-schema、corrupt 和 timeout 响应，确认 adapter 不吞错、不伪造默认 snapshot。
- [ ] 4.3 `E-302` 将远程 snapshot 注入现有 Reader runtime/Pinia，恢复 `audioMeta`、transcript、chunkData 和 session metadata；保持 Vue 唯一渲染路径，marks 暂时只作为兼容 projection。
- [ ] 4.4 `R-302` 独立审核 transcript、normal/chunk mode、播放绑定、latest-wins generation 和 script order，确认没有创建第二套渲染或把逻辑堆入薄入口。
- [ ] 4.5 `E-303` 增加 remote-mode bootstrap gate：先完成 Host health/contract/query adapter 初始化，再恢复 Reader；Host 不可用时展示可重试状态，禁止静默回退到 Mac canonical writer。
- [ ] 4.6 `R-303` 独立验证 Host 不可用、慢响应、页面刷新和 local compatibility mode，确认 remote mode 没有 IndexedDB canonical write，local mode 仍保持原行为。
- [ ] 4.7 `E-304` 完成 Reader Session 只读跨机用户验收：Windows 现有素材、Mac transcript/chunk/播放/seek/刷新、Windows restart、Mac reconnect，并保存结果。
- [ ] 4.8 `R-304` 独立复核跨机证据、浏览器 console/network 和 Windows 数据，确认本阶段没有提前切换 writer 或修改日常数据。
- [ ] 4.9 `G-3` 集成 Reader Session 只读路径，运行 reader-session、transcript/chunk、media、Vite/production preview 和 Mac smoke checks，全部通过后记录新 `PHASE_BASE`。

## 5. Reader Session 与 marks/activity 写入接管（严格串行为主）

- [ ] 5.1 `E-401` 修改 owner contract、domain inventory 和 tests，明确 `marks-activity` 是 canonical marks 唯一 writer，Reader Session 只返回 `marksRevision` 或只读 projection，Reader Session commit 不接受 marks mutation。
- [ ] 5.2 `R-401` 独立检查六域 registry、payload schema 和现有数据兼容，确认不存在 reader-session 与 marks-activity 双 owner，也没有丢失旧 snapshot 的只读迁移能力。
- [ ] 5.3 `E-402` 实现 Reader Session remote commit adapter，只提交 `audioMeta`、transcript、chunkData 和 readerSession manifest，保留 expected revision、idempotency key、receipt 与 `commit-unknown` recovery。
- [ ] 5.4 `R-402` 独立故障测试 committed、revision conflict、timeout、response 丢失和 receipt query，确认没有依据 HTTP 200 宣告 durability，也没有写 marks。
- [ ] 5.5 `E-403` 将 marks 读取切到 `marks-activity` owner；Reader Session projection 不一致时只提示或刷新，不通过 session commit 回写 marks。
- [ ] 5.6 `R-403` 独立构造 revision 不一致和旧 projection，确认 UI 最终采用 `marks-activity` authoritative result，旧值不能覆盖新 marks。
- [ ] 5.7 `E-404` 将 marks toggle/import/replace 的 remote-mode 保存接入 `marks-commit`，复用 one-in-flight、latest-wins ledger，并提供最小 conflict/retry UI。
- [ ] 5.8 `R-404` 独立验证快速连续编辑、stale revision、重复 idempotency key、刷新和 Windows restart，确认最终结果等于最新用户意图。
- [ ] 5.9 `E-405` 将 remote-mode activity 写入接入 `activity-append`，使用稳定 operation ID 去重，并与 marks revision 分离。
- [ ] 5.10 `R-405` 独立验证相同 operation ID 重试只产生一条 activity、不同事件正常追加、transport timeout 后不重复计数。
- [ ] 5.11 `E-406` 将 browser outbox 缩减为未确认 intent/receipt lookup 辅助；committed 后删除，`commit-unknown` 时保留原 identity，不建设离线同步数据库。
- [ ] 5.12 `R-406` 独立验证 outbox 损坏、页面关闭、重启恢复和 receipt 已提交场景，确认 outbox 永远不能覆盖 Windows authoritative 数据。
- [ ] 5.13 `E-407` 在 optimization profile 为 Reader Session 与 marks/activity 执行 authority checkpoint，阻断 remote mode 旧 browser writer，并保留可验证 rollback adapter。
- [ ] 5.14 `R-407` 独立核对 checkpoint 前后 writer 数量始终为一，失败可撤回 checkpoint，IndexedDB schema 未变化，日常 profile 未被触碰。
- [ ] 5.15 `G-4` 在统一 HEAD 完成 marks 快速编辑、断网重连、Windows restart、receipt recovery、revision conflict、Reader Session 切换和 rollback rehearsal，全部通过后记录新 `PHASE_BASE`。

## 6. Workflow 跨机完整闭环（串行为主）

- [ ] 6.1 `E-501` 收敛 workflow client，使 production 和 remote-dev 都通过相对 `/api` 与 Windows稳定前门访问，页面不再理解内部端口、低层 token、query token 或 Windows 路径。
- [ ] 6.2 `R-501` 独立检查 client diff 和 network tests，确认不存在对 8776/内部 Host 的浏览器直连，既有 typed error 与 local compatibility mode 没有回归。
- [ ] 6.3 `E-502` 验证并修正 Mac 提交 YouTube URL 的 job-start 路径，使 Windows 在短请求内返回稳定 job identity，重复用户 intent 使用既有 idempotency 语义，不等待重任务完成。
- [ ] 6.4 `R-502` 独立检查双击、timeout、重复 idempotency key、API key/Cookie/path redaction 和 job 入队次数。
- [ ] 6.5 `E-503` 逐项验证并修正 job cancel、retry、prioritize 的跨机 client/Host 连接，不重写 workflow state machine。
- [ ] 6.6 `R-503` 独立验证合法 transition、stale revision、重复 mutation、retry 关联和取消中的进程状态，确认网络错误不会显示为命令成功。
- [ ] 6.7 `E-504` 为 Mac remote mode 使用 Windows library query 选择已有素材，返回 opaque job/media identity；隐藏或禁用需要 Windows 桌面交互的 remote NativePicker 入口。
- [ ] 6.8 `R-504` 独立验证 Mac 无需操作 Windows 弹窗即可选择素材，API 不返回完整路径，local Windows 模式的既有 picker 行为未被无意删除。
- [ ] 6.9 `E-505` 完成 Mac 输入 URL、Windows 下载/处理、Mac polling、完成素材打开、播放/seek 和 marks 保存的跨机用户旅程并记录证据。
- [ ] 6.10 `R-505` 独立复核 job、network、media 与持久化证据，确认任务不是只通过 mock、没有遗留临时配置，也没有访问日常数据。
- [ ] 6.11 `G-5` 集成并运行 workflow client/service/owner、polling、media、reader、marks 和 production preview 验证，真实跨机闭环通过后记录新 `PHASE_BASE`。

## 7. Passage Preview 与 Annotation（两条并行 Lane）

`Lane A Passage Preview` 与 `Lane B Annotation` 可以从 G-5 基点并行；涉及 `App.vue` 或共享 bootstrap 的工作必须留到 7.13 集成任务串行处理。

- [ ] 7.1 `E-601A` 建立 Passage Preview remote query adapter，读取 durable data、progress、daily continuation、archive 和 revision；当前卡片、翻译展开、页面索引等 UI 状态继续留在 Mac。
- [ ] 7.2 `R-601A` 独立检查 query payload、revision、not-ready/corrupt 行为和缓存边界，确认 canonical progress 不来自 Mac localStorage。
- [ ] 7.3 `E-602A` 将 rating、progress、transition 和 archive 的 remote-mode mutation 接入 Windows owner，保留最小 CAS、idempotency 和 receipt recovery。
- [ ] 7.4 `R-602A` 独立验证重复 rating、stale revision、页面刷新、Windows restart 和失败重试，确认 preview 与 vocabulary 没有形成隐式跨域 transaction。
- [ ] 7.5 `E-603A` 在 preview authority checkpoint 后关闭 remote mode 的 canonical localStorage writer，保留 UI preference、session cache 和 legacy read/import evidence。
- [ ] 7.6 `R-603A` 独立列举所有 preview localStorage key 并核对分类，确认 canonical key 不再写入且 UI 临时偏好没有被误删。
- [ ] 7.7 `E-601B` 建立 Annotation remote query adapter，读取 bundle、scope、generated/status、corrupt evidence 和 revision，并继续在 Mac 内存中构建当前页面显示索引。
- [ ] 7.8 `R-601B` 独立验证 documentId/audioKey scope、空结果、corrupt、unsupported schema 和 index 重建，确认 query 不触发持久写入。
- [ ] 7.9 `E-602B` 将 lightweight import/export、bundle commit 接入 Windows Annotation owner，保留 revision、receipt 和现有格式兼容。
- [ ] 7.10 `R-602B` 独立验证 import 冲突、重复 operation、刷新和 export round-trip，确认 Mac audio-folder/localStorage 不成为 canonical writer。
- [ ] 7.11 `E-603B` 将 AI backfill result 的 authoritative merge 和 status 持久化留在 Windows，Mac 只启动操作并查询状态/结果。
- [ ] 7.12 `R-603B` 独立验证 backfill 成功、失败、重复结果、Windows restart 与旧 bundle 保留，确认失败任务不能破坏已有 annotation。
- [ ] 7.13 `E-604` 在一个串行集成任务中接入 Preview/Annotation 的共享 bootstrap 与 `App.vue`，解决两条 Lane 的接口冲突，不顺手迁移 Vocabulary/SRS。
- [ ] 7.14 `R-604` 独立运行两条 Lane 的 focused checks 和联合页面 journey，确认 App 初始化顺序稳定、Host 不可用时不触发任何本地 canonical fallback。
- [ ] 7.15 `G-6` 完成 Preview/Annotation authority checkpoint、writer inventory、restart 和 rollback rehearsal，全部 PASS 后记录新 `PHASE_BASE`。

## 8. Vocabulary 与 SRS（基本串行）

- [ ] 8.1 `E-701` 建立 Vocabulary/SRS 选择性 remote query，覆盖 entry、review queue、context evidence 和必要 revision；全量 snapshot 只保留迁移/诊断用途。
- [ ] 8.2 `R-701` 独立检查 query 数量、payload 范围、缓存和 stale response，确认正常页面不下载或上传完整 vocabulary snapshot。
- [ ] 8.3 `E-702` 将 Vocabulary Entry acquisition 接入 Windows owner，保持 lemma、Contextual Meaning、evidence 与 idempotency 关联。
- [ ] 8.4 `R-702` 独立验证重复 acquisition、不同 occurrence、已有 entry 和 conflict，不允许重复 intent 创建多条逻辑记录。
- [ ] 8.5 `E-703` 将 SRS rating 通过 expected revision/CAS 提交 Windows；第一版复用当前 browser scheduler 计算，不把 Python scheduler 重写加入本任务。
- [ ] 8.6 `R-703` 独立验证 stale Review State、快速重复 rating、刷新和 Windows restart，确认新状态与事件一致且没有要求多用户并发系统。
- [ ] 8.7 `E-704` 将 learning event append 接入 Windows owner，使用稳定 operation ID 去重并关联 Vocabulary Entry/Review State。
- [ ] 8.8 `R-704` 独立验证 response 丢失、相同 operation ID 重试和不同事件顺序，确认 activity/event 不重复累计。
- [ ] 8.9 `E-705` 完成 Vocabulary/SRS authority checkpoint，关闭 remote mode 的 IndexedDB canonical writer，保留 view state、短期 cache 和 migration adapter。
- [ ] 8.10 `R-705` 独立执行 writer inventory 和断线测试，确认 Host 不可用时不会静默写回 IndexedDB，local compatibility mode 仍然可用。
- [ ] 8.11 `E-706` 完成素材、标词、Preview、acquisition、SRS review、rating、关闭页面、Windows restart、再次打开的完整学习旅程。
- [ ] 8.12 `R-706` 独立复核六域 revision、record count 和用户可见结果，确认没有只验证 UI 而漏掉 Windows durability。
- [ ] 8.13 `G-7` 集成并运行 Vocabulary/SRS、Preview、Annotation、Reader、marks、workflow 和 production preview 验证，全部通过后记录新 `PHASE_BASE`。

## 9. Browser writer 清理、构建与启动（可有限并行）

- [ ] 9.1 `E-801` 增加 remote production build artifact 检查，证明 `dist` 不含后端 secret、Windows 绝对路径、内部端口或开发机 backend URL，并可由 Windows Host 同源提供。
- [ ] 9.2 `R-801` 独立检查实际 bundle/manifest 和 production preview，确认没有错误要求删除 Windows sidecar 源码或让 Mac production 运行 Vite。
- [ ] 9.3 `E-802` 只读生成 remote-mode writer inventory，逐项标记 Reader Session、marks/activity、Preview、Annotation、Vocabulary/SRS 的 writer 为 authoritative、local-only、migration-only、ephemeral 或意外仍可写。
- [ ] 9.4 `R-802` 独立用静态搜索和运行路径核对 inventory，确认没有遗漏 `App.vue`、`YouTubeWorkflowPanel.vue`、Pinia、runtime facade、localStorage、IndexedDB 或 audio-folder caller。
- [ ] 9.5 `E-803A` 删除或隔离 inventory 中确认无用的 remote Reader Session browser writer，只处理该域并运行 reader/session focused checks。
- [ ] 9.6 `R-803A` 独立确认 local compatibility 与 migration read 仍可用、remote mode 无 canonical write、IndexedDB schema 不变。
- [ ] 9.7 `E-803B` 删除或隔离 inventory 中确认无用的 remote marks/activity browser writer，只处理该域。
- [ ] 9.8 `R-803B` 独立确认 latest-wins intent/receipt recovery 保留，canonical marks/activity 只在 Windows。
- [ ] 9.9 `E-803C` 删除或隔离 inventory 中确认无用的 remote Preview browser writer，只处理该域。
- [ ] 9.10 `R-803C` 独立确认 UI preference 未被误删、canonical preview localStorage 不再写。
- [ ] 9.11 `E-803D` 删除或隔离 inventory 中确认无用的 remote Annotation browser/audio-folder writer，只处理该域。
- [ ] 9.12 `R-803D` 独立确认 lightweight import/export 和 rollback adapter 仍可用，正常 remote path 只写 Windows。
- [ ] 9.13 `E-803E` 删除或隔离 inventory 中确认无用的 remote Vocabulary/SRS IndexedDB writer，只处理该域。
- [ ] 9.14 `R-803E` 独立确认 queue、rating、learning events 和 local compatibility 没有回归。
- [ ] 9.15 `E-804` 完成 Windows LAN 一键启动/停止入口，启动时输出 Mac 应访问 URL，复用 health、identity、previous release 和 rollback，不实现安装器、自动更新 daemon 或企业部署系统。
- [ ] 9.16 `R-804` 独立从停止状态执行启动、复用、升级失败回滚和停止，确认未知进程不被终止、daily reader 不受影响。
- [ ] 9.17 `E-805` 增加当前版本与前一版本的最小前后端兼容检查，旧浏览器 bundle 不兼容时显示刷新提示，不建设长期 compatibility matrix。
- [ ] 9.18 `R-805` 独立验证旧缓存、新 Host、旧 Host、新 bundle 和 unsupported contract，确认不会在不兼容时进行 mutation。
- [ ] 9.19 `G-8` 在统一 release candidate 上运行 `verify:fast`/相关 focused graph、build、production preview、LAN launcher、六域 writer inventory、Mac remote-dev 和完整用户旅程，形成可进入真实数据演练的候选 commit。

## 10. 优化数据演练与日常真实数据接管（严格串行）

- [ ] 10.1 `E-901` 仅针对 `E:\ReadWebData\SubtitleWorkflow-Optimization` 执行 full backup、manifest/checksum 验证和隔离 restore rehearsal，确认大媒体只保留 identity/reference。
- [ ] 10.2 `R-901` 独立核对 backup record counts、checksums、restore 后六域读取和原优化数据未被覆盖，输出 `PASS/FAIL`。
- [ ] 10.3 `E-902` 在取得用户明确授权后，只读盘点日常真实数据的根、job、媒体、Reader Session、marks/activity、Preview、Annotation、Vocabulary/SRS 和可用备份空间，不执行 mutation。
- [ ] 10.4 `R-902` 独立确认盘点过程只读、数据根准确、没有把优化小数据误认为真实数据，也没有启动或修改受保护工作树。
- [ ] 10.5 `E-903` 基于真实数据盘点生成 migration dry-run，列出将迁移记录、版本、checksum、冲突、未知数据、孤立引用、空间需求和 rollback target，不提交 writer checkpoint。
- [ ] 10.6 `R-903` 独立审核 dry-run 的完整性和可回滚性；存在未知语义、更新 revision 或无备份记录时必须 `FAIL`，但不要求企业级灾备。
- [ ] 10.7 `E-904` 仅在 `R-903 PASS` 且用户再次明确批准后，按 dry-run 对真实数据执行 migration，并保留迁移前 backup、legacy source 和逐域 checkpoint。
- [ ] 10.8 `R-904` 独立核对 migration record counts、checksums、未知记录隔离、六域 revision 与旧数据保留，发现差异时停止后续接管。
- [ ] 10.9 `E-905` 使用真实数据完成 Mac 最终用户旅程：library/YouTube、素材打开、播放/seek、marks、Preview、Annotation、Vocabulary/SRS 和刷新恢复。
- [ ] 10.10 `R-905` 独立复核浏览器、Host 和 durable records，确认不是仅 UI 看似成功，且没有 Mac canonical writer。
- [ ] 10.11 `E-906` 执行 Windows 正常重启后的 Host 启动、Mac reconnect、当前素材恢复、job 状态和六域持久化验收。
- [ ] 10.12 `R-906` 独立确认重启没有生成第二 writer、没有使用旧内部 Host、前端与 Host release identity 匹配。
- [ ] 10.13 `E-907` 在保留真实数据 backup 的情况下完成 rollback rehearsal，证明可撤回 LAN/authority 接管、恢复 previous release/entry，并保持迁移前数据可读。
- [ ] 10.14 `R-907` 独立验证 rollback 后旧入口、旧 writer、数据 checksum 和启动流程，确认 rollback 不依赖删除或重建真实数据根。
- [ ] 10.15 `E-908` 仅在 `R-901` 至 `R-907` 全部 PASS 且用户明确批准后更新日常入口，禁止优化版与日常版同时写同一 profile，并保存最终 release、backup 和恢复说明。
- [ ] 10.16 `R-908` 独立执行最终接管审核，确认日常入口指向已验收 release、Mac 使用路径正常、旧版本和 backup 可恢复、受保护树未被越权修改。
- [ ] 10.17 `G-9` 运行最终完整验收并记录最终 commit、release identity、数据 manifest、Mac URL、启动/停止方式、已知非目标和 rollback 步骤；所有任务与 review 完成后方可归档本 change。
