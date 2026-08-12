## Context

Read-Web 当前同时包含 Vue/Pinia、legacy DOM、`window.*` compatibility facades、Vite 本地插件、FastAPI workflow service、IndexedDB、localStorage、JSON 文件和 SQLite。日常版本由 `E:\read-web` 的 Vite dev server 与 8765 后端运行；本变更只在 `E:\read-web-next`、5174/8766 和隔离测试数据中实施。

审计已确认慢响应并非单一服务数量问题，而是关键路径的整文件搬运、重复渲染、N+1 轮询和写放大；同时存在 Reader Session 撕裂写入、lost update、全库误清空入口、Object URL/监听泄漏、异步竞态、静默错误、子进程治理不足、无认证高权限 localhost API、工具链漂移和不可执行回滚。代码约 58k 行，存在 2k 行级前后端巨型模块、57 个直接 global compatibility 文件和大量 source-shape checks，因此必须沿稳定边界渐进迁移。

## Goals / Non-Goals

**Goals:**

- 让点击、播放、切换材料和本地 API 的响应有可测预算，失败在 100ms 内得到可见反馈。
- 让 Reader Session、Vocabulary、Preview、Annotation 与 workflow durable state 在中断、并发和损坏下保持完整或可恢复。
- 让大媒体流式播放，避免整份 Blob 下载、IndexedDB 复制与 Object URL 泄漏。
- 为 playback、marks/activity、请求、进程和 runtime config 建立单一 owner 与小而深的 Interface。
- 提供可复现安装、production host、分层 CI、release manifest、备份、迁移 rehearsal 和一键 rollback。
- 最终移除已退役 notes 链和不再需要的 global/legacy surfaces，同时保持每个阶段可独立回退。

**Non-Goals:**

- 不在本变更中重做视觉品牌或增加新的学习功能。
- 不把个人本地应用改造成公网多租户 SaaS。
- 不改变 `SeekPlayerDB` version 1、`files` object store 或用户数据语义；若未来必须升级，另建明确 migration change。
- 不在验收前修改 `E:\read-web`、5173/8765、桌面快捷方式或真实学习数据。
- 不用一次性 Vue rewrite 替代渐进式边界迁移。

## Decisions

### 1. 采用阶段门控的 Strangler Migration

每个领域先建立行为测试和新 owner，再把一个调用边界迁入，最后删除 compatibility facade。每个提交只处理一个高风险行为域并记录验证结果。

替代方案是重写前端或后端；它会同时改变行为、数据和运行方式，难以与当前可用版本差分验证，因此不采用。

### 2. 先测量再优化，并把性能作为产品契约

建立 Playwright journey harness、browser Long Task/request/error collection、FastAPI request metrics 和固定 fixture。初始预算由隔离机基线生成，先阻止退化，再逐步收紧至 click/keypress 可见反馈 P95 100ms、关键本地 GET P95 100ms、大媒体首次可播放 1s 级目标。

source-shape checks 保留为 `verify:architecture:*`，但不再代表用户行为或性能通过；`verify:behavior:*`、`verify:performance:*` 和 `verify:release` 分层执行。

### 3. production host 统一静态产物和本地能力

建立 Local App Host 托管 `dist`、Range media 与现有字典/TTS/翻译等本地 endpoints；Vite 只负责开发与构建。RuntimeConfig 按 CLI → environment → user config → validated defaults 解析路径、端口、工具、代理和模型，并输出脱敏诊断。

host 强制 loopback，启动时生成短期 token；高权限 workflow endpoints 同时验证 Host、Origin 和 token。CORS 只作为浏览器策略，不充当认证。

### 4. ReaderSessionLoad 使用 prepare/commit，两类资源分治

小型 manifest/transcript/chunk/marks 并行 prepare、校验 contentId/revision 后，以单个 IndexedDB readwrite transaction 原子 commit；大媒体只保留 validated URL/handle，由浏览器通过 HTTP Range 播放，不进入 Blob/IndexedDB。

每次 load 持有 generation id 与 AbortController；新加载取消旧加载，旧响应不能提交。失败保持原 session，不得将本地 load error 写回 workflow job status。

MediaResourceOwner 唯一拥有 current Object URL 或 remote URL，在 replace/dispose 时按 pause → remove src → load → revoke 清理。

### 5. ApplicationPersistence 是共享 `files` store 的唯一深 Module

保持 DB v1/files，通过 typed key registry、versioned envelope、sessionRevision/contentId/checksum 与 transaction runner 隐藏 request/transaction 细节。成功只在 `tx.oncomplete` 后返回；禁止领域获得 `objectStore.clear()`。

legacy Vocabulary writers 迁到现有 learning Unit of Work 或 revision/CAS；Preview 与 Annotation 从多键/双文件合成 envelope 或 commit manifest。unknown schema 必须拒绝并保留原值，不能 normalize 后覆盖。

文件侧建立 `DurableJsonRepository`：唯一 temp、flush、`fsync`、`os.replace`、上一版 backup、checksum 与 corrupt quarantine。SQLite 采用 temp build、integrity check、atomic swap。

备份在 row registry 稳定后实现，包含版本 manifest、checksums、dry-run、冲突报告与可回滚 restore；大媒体默认只备份引用和元数据。

### 6. 生命周期、请求与错误采用结构化 owner

`LifecycleScope` 收集 DOM listeners、rAF、timer、observer 和 disposers；所有 init 返回 dispose，重复 init 必须幂等。`RequestSupervisor` 提供 timeout、abort、single-flight、generation/revision guard、backoff 和 correlationId。

错误按 validation、not-found、conflict、permission、network、timeout、upstream、corrupt、internal 分类；`ErrorPresenter` 将用户可处理错误转换为可重试 notice/status，诊断记录 operation/correlationId。空 catch 只允许有明确 best-effort 注释并记录结果。

### 7. workflow 按状态、事件与资源拆分

job snapshot 与 event log 分离：event 使用有界 ring buffer 与批量/append 写；状态只在阶段/检查点变化或 debounce 后持久化。前端优先 batch snapshot 或真正 async event stream，轮询必须 single-flight、visibility-aware 并拒绝陈旧 revision。

ProcessSupervisor 使用锁与 `try/finally` 管理进程句柄、Windows process group/job object、terminate/kill timeout。AI 变为 202 background job，具备 deadline、取消、retry+jitter；限流锁只分配预约，不在锁内 sleep。

NativePicker 统一 file/folder，使用稳定专属 owner、进程 timeout/kill 和 canceled/error 结果；能使用浏览器 API 时优先浏览器 API。

### 8. 状态所有权按 playback → marks/activity → compatibility 顺序收敛

playback hot path 由单一 store/controller 管理，active index 更新只触及前一/当前元素或虚拟窗口，DOM 与 Pinia 不重复写。marks/activity 通过 one-in-flight latest-wins ledger 合并提交并暴露 dirty/saved/error。

随后删除 retired notes no-op chain，缩小 reader/session 参数袋，将 `window.__state`、bridge 和 DOM facade 按消费者为零逐一移除。现有 `legacy-runtime-decomposition` 的阶段验证约束继续生效。

### 9. 发布以不可变 manifest 和原子快捷方式切换为界

固定 Node LTS、npm、Python 与 Python package lock，外部 yt-dlp/WhisperX/ffmpeg 使用已验证路径或版本探测。CI 分 fast/full/release，release 产物带 git SHA、前后端版本、schema、依赖锁 hash、artifact checksums 和配置兼容范围。

迁移前从真实环境只读导出并在隔离目录恢复；连续学习旅程、长播放、服务重启、损坏注入和性能差分通过后，才原子更新快捷方式。保留 previous manifest 和旧快捷方式目标，一键 health check 失败即回滚。

## Risks / Trade-offs

- [改动范围大，阶段间存在依赖] → 用 OpenSpec task gate、小提交、每阶段差分 journey 和禁止跨两个高风险域的提交控制。
- [统一持久化可能暴露旧数据异常] → unknown/corrupt 数据只读隔离，先备份再迁移，提供 dry-run 与恢复报告。
- [Range streaming 依赖 host 和源文件稳定] → host 校验 path/contentId、支持 Range/ETag，并在文件失效时给出重新绑定流程。
- [localhost token 增加启动复杂度] → launcher 自动生成和注入，UI 不展示原始 token，诊断仅显示 hash/状态。
- [行为测试会使初期 CI 变慢] → fast smoke 每提交运行，full/release 在阶段完成和迁移前运行。
- [删除 compatibility 会破坏隐藏调用者] → 运行时调用计数、静态 consumer map、production journey 全部为零后才删除。
- [个人项目不需要企业级基础设施] → 只保留能直接降低数据丢失、卡顿和换机失败风险的轻量本地实现，不引入远程平台依赖。

## Migration Plan

1. 冻结 `E:\read-web-next` baseline，固定工具链，建立 release manifest 草案、性能/错误/故障注入基线。
2. 建 RuntimeConfig、Local App Host 与 loopback token，保持现有 5174/8766 dev 路径可回退。
3. 建 ApplicationPersistence transaction runner，先移除 `clearDBStore()`，修所有假 await，再迁 Reader Session 原子 commit。
4. 实施 Range media、MediaResourceOwner、ReaderSessionLoad generation/abort，并验证 300–540MB fixture 首次可播放。
5. 优化 playback renderer 和唯一 state owner，再实施 marks/activity ledger。
6. 重构 workflow snapshot/event persistence、polling、ProcessSupervisor、AI job 和 NativePicker。
7. 迁移 Vocabulary/Preview/Annotation durable state，完成 atomic JSON/SQLite 与全量 backup/restore。
8. 建 LifecycleScope/ErrorPresenter，清理空 catch、永久 listener/timer/observer，并完善 dialog accessibility。
9. 删除 retired notes/global/dead artifacts，整理 scripts/docs/ignore/license/CI，执行 clean-room build。
10. 在隔离数据做 restore rehearsal、30 分钟播放、服务重启、并发/Quota/损坏测试和旧版差分；通过后才请求用户确认迁移快捷方式。

回滚策略：每阶段保留上一提交与旧行为开关；数据写入前生成备份，schema/envelope 变更提供逆向 reader；production host 保留 previous release；快捷方式切换失败时恢复旧 target，原版服务和数据始终未被原地升级。

## Open Questions

- Local App Host 最终使用 FastAPI 统一托管全部 endpoints，还是保留 Node sidecar 并由 launcher 管理双进程；Phase 1 benchmark 后按启动时间、Range 支持和维护成本决定。
- 大媒体 URL 使用受 token 保护的 host path 还是一次性 capability URL；安全与浏览器 seek 行为通过原型确认。
- 多标签页并发是明确支持还是检测后阻止第二个 writer；先实现 revision conflict，之后依据真实使用决定 UI 策略。
- 远端 GitHub 是否作为迁移前 off-machine backup，由用户在准备推送时最终确认；本地 tag 与压缩备份不依赖此决定。
