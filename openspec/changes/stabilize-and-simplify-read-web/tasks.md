## 1. 冻结基线与建立安全护栏

- [x] 1.1 记录 `E:\read-web-next` baseline 的 git SHA、5174/8766 配置、工具版本和旧版 5173/8765 健康状态
- [x] 1.2 固定 Node LTS、npm、Python 与 Python dependencies，补齐 yt-dlp、WhisperX、ffmpeg 和 `google.genai` 的安装/探测清单
- [x] 1.3 将 launcher、Python 和 Vite 中的端口、路径、代理、模型与工具解析收口到版本化 RuntimeConfig
- [x] 1.4 建立 `verify:fast`、`verify:full`、`verify:release` 入口并明确每层覆盖范围
- [x] 1.5 建立 clean-room `npm ci`、隔离 Python environment、frontend build 和 backend test 验证
- [x] 1.6 建立 baseline Release Manifest 草案并为每个产物记录 SHA/checksum

## 2. 性能与错误可观测性

- [x] 2.1 新增版本化 performance budgets 配置并从旧版/next 实测值生成初始门槛
- [x] 2.2 建立统一 Playwright fixture，采集 navigation、action latency、Long Task、console/page/unhandled/request/HTTP errors
- [x] 2.3 为冷启动、材料打开、play/pause/seek、连续 word/chunk、Material、Preview 和 SRS 建立固定 journeys
- [x] 2.4 新增 backend HTTP benchmark，覆盖 health、jobs snapshot、history、activity/marks 和缓存命中路由
- [x] 2.5 为 FastAPI 增加 requestId、route/status/duration/bytes 与 Server-Timing 聚合诊断
- [x] 2.6 为失败 journey 保存 trace、截图、JSON，并实现 baseline diff 和 release budget gate

## 3. 正式本地 Production Host

- [x] 3.1 原型比较 FastAPI 单 host 与 Node sidecar，记录启动时间、Range、现有本地 endpoints 和维护成本
- [x] 3.2 实现 Local App Host 托管 `dist`、SPA fallback、健康/版本端点和现有字典/TTS/翻译能力
- [x] 3.3 实现 Host/Origin/短期 token 校验并强制拒绝非 loopback bind
- [x] 3.4 实现 launcher 的端口占用检查、PID ownership、ready timeout、重复实例检测和失败清理
- [x] 3.5 验证独立 production host 不依赖 Vite dev/preview，所有关键 endpoints 和 browser journeys 通过
- [x] 3.6 保留 5174/8766 dev fallback 并完成 host 启停/崩溃/重启压力测试

## 4. 统一应用持久化基础

- [x] 4.1 建立 `ApplicationPersistence`，统一打开 `SeekPlayerDB` v1/files、blocked/versionchange/retry 与 typed key registry
- [x] 4.2 实现以 `tx.oncomplete` 为成功条件的 transaction runner 和故障注入测试
- [x] 4.3 删除/封闭公开 `clearDBStore()`，改为领域 allowlist keys 删除并验证不会清除其他数据
- [x] 4.4 定义 versioned envelope、revision/contentId/checksum、unknown schema rejection 和 corrupt quarantine
- [x] 4.5 迁移当前假 await/request-success writers，并为 Quota、abort、关闭页面和多标签并发补测试
- [x] 4.6 建立 `DurableJsonRepository` 的 temp+fsync+replace+backup+recovery 契约
- [x] 4.7 将 SQLite builder 改为 temp build、integrity check、atomic swap 和 previous backup

## 5. Reader Session 与大媒体流式化

- [x] 5.1 建立 `ReaderSessionLoad` generation token、AbortController、single-flight 和 typed load state
- [x] 5.2 将 manifest/transcript/chunk/marks 改为并行 prepare、校验后单事务 commit
- [x] 5.3 确保导入失败保留旧 session，且 UI load error 不得回写为 workflow job failed
- [x] 5.4 为大媒体建立授权 URL/Range/ETag endpoint，manifest 明确 playable media 与 derived audio
- [x] 5.5 从 loader 移除大 media Blob 下载和 IndexedDB 写入，并验证 300–540MB fixture 首次可播放预算
- [x] 5.6 建立 `MediaResourceOwner`，在 replace/dispose 时可靠释放 Object URL、media src 和相关资源
- [x] 5.7 修复 export/download Object URL 的 finally/延迟 revoke 并加入连续打开材料的 heap 稳定性测试
- [x] 5.8 为中断、快速切换 A/B/A、无 Range、文件失效和恢复旧 session 建立 browser journeys

## 6. Playback 与学习交互热路径

- [x] 6.1 建立 playback 单一 store/controller，禁止 legacy DOM 与 Pinia 对等双写
- [x] 6.2 用事件驱动播放更新替代永久无条件 rAF，暂停和不可见时停止调度
- [x] 6.3 将 active word/chunk 更新限制在必要 DOM 或虚拟窗口，避免整个 transcript 重渲染
- [x] 6.4 将播放器 rejection 映射为 playing/blocked/no-source/error 并提供可见恢复动作
- [x] 6.5 优化 glass effects，移除 whole-body 永久 observer 或限定根节点和批处理范围
- [x] 6.6 验证 1k/10k transcript、连续 100 次 word/chunk/seek 的 p95、Long Task 与 listener 数预算

## 7. Material Workflow 可靠性

- [x] 7.1 新增 batch job snapshot 或 async event channel，替换每秒 per-job N+1 轮询
- [x] 7.2 前端 polling 实现 single-flight、visibility backoff、jitter、AbortController 和 revision guard
- [x] 7.3 将 job snapshot、active state 与 event log 分离，event 改有界 ring buffer
- [x] 7.4 将每行日志全量保存改为阶段 checkpoint 与 100–250ms coalesced persistence
- [x] 7.5 实现 crash recovery 状态机，损坏 jobs/history 必须 quarantine/backup recovery 而非清空覆盖
- [x] 7.6 建立 `ProcessSupervisor`，使用 lock、try/finally、进程树 terminate/kill timeout 和真实终态确认
- [x] 7.7 将 AI/backfill 改为 202 background job，增加 deadline、cancel、retry+jitter 和分资源限流
- [x] 7.8 修复 rate limiter 锁内 sleep 与缓存原子性，隔离空/截断 cache 文件
- [x] 7.9 建立统一 `NativePicker` 的稳定 owner、cancel/error/timeout/kill 与前端 Abort/retry
- [x] 7.10 为 1/10/50 active jobs、上游 timeout/503、取消、重启和 picker 焦点变化建立压力测试

## 8. Marks、Activity、Vocabulary、Preview 与 Annotation 数据

- [x] 8.1 建立 marks/activity ledger，采用 coalesce、monotonic sequence、one-in-flight latest-wins 和 dirty/saved/error
- [x] 8.2 移除 window event 与 MutationObserver 对同一 marks 改动的重复写通道
- [x] 8.3 将 legacy Vocabulary Snapshot writers 迁到统一 Unit of Work 或 revision/CAS，阻止 lost update
- [x] 8.4 对 Vocabulary unknown schema 实施显式拒绝、migration registry 和迁移前 row backup
- [x] 8.5 将 Passage Preview 多 localStorage key 合并为 batchId/revision envelope 或可恢复 transition
- [x] 8.6 移除 acquisition 以 localStorage 为权威索引的 orphan 路径，改为 canonical repository 查询/重建
- [x] 8.7 将 Annotation generated/status 合并为原子 envelope/commit manifest，区分 not-found、corrupt 和 permission
- [x] 8.8 为所有领域建立 multi-tab、Quota、损坏、unknown version、关闭页面与 recovery 测试

## 9. 生命周期、错误反馈与可访问性

- [x] 9.1 建立 `LifecycleScope`，统一注册 listener、timer、rAF、observer、Object URL 和 disposer
- [x] 9.2 让 reader/session/runtime init 返回 disposer，并加入 init-twice/unmount/reinit 不增长测试
- [x] 9.3 建立 `RequestSupervisor` 的 timeout、abort、single-flight、generation/revision 和 correlationId
- [x] 9.4 建立 typed error taxonomy 与 `ErrorPresenter`，统一 notice/status/retry 与脱敏 diagnostics
- [x] 9.5 扫描并移除关键路径空 `catch`/floating promise，只保留有记录的明确 best-effort 策略
- [x] 9.6 统一 dialog 的 aria-modal、focus trap、initial/restore focus、ESC、aria-live/aria-busy 和 pending guard
- [x] 9.7 修复 Passage Preview translation controller 代际捕获，并为快速替换/abort 补回归
- [x] 9.8 建立 offline、timeout、late response、double-click 和 screen-reader 状态 journey

## 10. Legacy Runtime 收敛

- [x] 10.1 生成 `window.*`、`window.__state`、bridge、inline DOM handler 和 root script 的静态/运行时 consumer map
- [x] 10.2 删除 retired notes no-op runtime/deps/session/facades，并将 `applyCurrentAudioMeta` 迁入真实 owner
- [x] 10.3 按 import/controls/interaction/keyboard/app 行为域拆解超宽 reader feature 参数袋
- [x] 10.4 将 session DOM/global 依赖收集器折叠或拆成小而有行为的 adapters
- [ ] 10.5 逐状态域移除 compatibility store/bridge/global owner，每次执行行为和 production startup gate
  - 本轮仅完成 UI compatibility store：`src/stores/ui.js`、`index.html` 加载项和 `main.js` 的 `__uiStore` bridge 已删除；`theme`、`audio`、`marks` stores 与 `__state`/`bridgeToPinia` 仍有生产调用者，任务保持未完成。
- [x] 10.6 删除无调用者 root annotation/chunk-note artifacts、legacy flags 和重复实现
- [ ] 10.7 将 source-shape guards 重命名为 architecture 层，并为已迁移 Interface 增加行为测试

## 11. 仓库、供应链与文档清理

- [x] 11.1 添加 `engines`、`packageManager`、`.node-version`、Python lock 和版本诊断
- [x] 11.2 将 setup 改为 `npm ci` 与锁定 Python 安装，验证全新目录可重复构建
- [x] 11.3 分类 package 外孤儿 scripts 为 release gate、dev tool 或 archive/delete，并移除旧 read26/start 脚本
- [x] 11.4 untrack 生成 dist 与个人 local settings，完善 `.gitignore`、`.env.example`、`.editorconfig` 和 `.gitattributes`
- [x] 11.5 添加 LICENSE、THIRD_PARTY_NOTICES、外部资源/数据来源矩阵、secret scan 和 SBOM/license gate
- [x] 11.6 将 README/PROJECT_MAP/CURRENT/operations 收敛为当前事实，给历史文档增加 archived banner
- [x] 11.7 建立 Windows CI，运行固定工具链、frontend/backend tests、关键 journeys、security/license 和 build
- [ ] 11.8 在每个阶段形成小提交并维护可审计 changelog；准备推送前单独确认远端 branch/upstream

## 12. 备份、迁移与发布验收

- [x] 12.1 实现版本化全应用 backup manifest、逐域 checksum、媒体引用策略和导入 dry-run
- [x] 12.2 实现原子 restore、冲突报告、迁移前自动 rollback backup 和 corrupt quarantine
- [x] 12.3 在隔离 profile 恢复真实数据副本，验证 Reader、Vocabulary、SRS、Preview、Annotation 和 workflow 完整性
- [x] 12.4 执行三次冷启、30 分钟播放、快速材料切换、服务重启、进程取消、Quota/损坏和内存增长测试
- [ ] 12.5 执行旧版与 next 同 fixture 性能/行为差分，确认关键预算改善且无学习功能退化
- [ ] 12.6 生成最终 Release Manifest、artifact checksums、previous manifest 与一键 health-check/rollback
- [ ] 12.7 在不修改原版的 dry-run 中演练快捷方式原子切换与自动回滚
- [ ] 12.8 仅在全部 release gates 通过并获得用户确认后，迁移桌面快捷方式；保留原版和恢复说明

> 12.2 is complete: the real six-domain composition holds a durable
> cross-process application-profile lease across restore and the Local App Host
> lifetime, blocks owner reads/startup during partial commit, and performs
> mandatory pending recovery before the host binds its port. Hard-process-exit,
> journal closure, CAS, rollback/quarantine and reopenable round-trip evidence
> are automated. 12.3 restored a read-only copy of the real browser/workflow
> profile into a temporary isolated root: all six domain counts/checksums and
> Reader/Vocabulary/SRS/Preview/Annotation/workflow journeys passed with zero
> network requests. Media bytes and retired rows remained explicitly excluded;
> media identity metadata remains rebindable. The daily source stayed logically
> unchanged and no source or daily service path was written.
> 12.4 is complete: the isolated built-dist production host passed three cold
> starts (two graceful stops and one crash), at least 1,800,000 ms of playback
> with every sample progressing, repeated media loops, 120 A/B/A material switches,
> zero listener growth and heap growth within the versioned budget, a real owned child
> process cancellation, 50 canceled jobs across service restart, and all 36
> Quota/corruption/recovery cells. All artifacts were written under an isolated
> temporary root; daily ports, source data and external network remained untouched.
