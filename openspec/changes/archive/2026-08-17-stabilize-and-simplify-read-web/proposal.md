## Why

Read-Web 已经能够支持日常学习，但当前混合运行时、非事务持久化、大媒体整文件搬运、同步后台工作、静默错误和不可复现的本机环境，使“按钮慢或没反应”与数据错配、内存增长、升级失败、换机不可运行等风险同时存在。现在已有与日用版隔离的 `E:\read-web-next`，应在不影响 `E:\read-web`、5173/8765 和真实学习数据的前提下，按可验证、可回退的阶段完成一次系统性稳定化。

## What Changes

- 建立可重复的前端用户旅程、后端 HTTP 基准、Long Task/请求/错误观测和明确的性能预算。
- 建立正式的本地 production host，统一运行配置、端口、工具发现和健康检查，不再把 Vite dev/preview 当作日用宿主。
- 将大媒体改为 URL/Range 流式播放；建立可取消、single-flight、原子提交的 Reader Session 加载流程和唯一媒体资源 owner。
- 建立共享 IndexedDB `SeekPlayerDB/files` 的统一事务层、版本化 row/envelope、损坏隔离、原子 JSON writer、备份恢复和故障注入测试；保持 DB version 1 与现有 object store 不变。
- 修复 Material Workflow 的 N+1 轮询、全量 `jobs.json` 写放大、无界日志、子进程取消、AI 同步长请求、原生 picker 焦点竞态和本地高权限接口保护。
- 统一前端请求取消、错误分类、可见反馈、生命周期 scope、对话框焦点与异步动作防重复；禁止空 `catch` 把失败伪装成“没反应”。
- 让 playback、marks/activity 和 Vue/Pinia 各有唯一状态 owner，逐边界移除 `window.*`、退役 notes no-op 链、巨型参数袋和重复 DOM/state 写入。
- 固定 Node/Python/外部工具版本与安装流程，建立 CI/release gates、许可证和秘密扫描、发布清单、原子迁移与一键回滚；清理死代码、孤儿脚本、生成物、个人路径和漂移文档。
- **BREAKING**：删除公开的全库 `clearDBStore()`、退役 notes compatibility API 和已无调用者的 legacy root artifacts；仅在调用者、数据与回归门槛满足后逐项实施。

## Capabilities

### New Capabilities

- `runtime-performance-governance`: 定义关键学习旅程、观测信号、性能预算和新旧版本差分门槛。
- `local-application-host`: 定义 production host、RuntimeConfig、端口/进程隔离、健康检查和本地接口保护。
- `reliable-reader-session`: 定义媒体流式化、可取消加载、Reader Session 原子切换、播放状态和资源释放。
- `durable-application-data`: 定义统一事务、版本化数据、并发控制、原子文件、损坏恢复与全量备份恢复。
- `workflow-service-reliability`: 定义 Material Workflow 的状态分发、持久化、队列、AI 操作、子进程和 native picker 行为。
- `application-error-lifecycle`: 定义 typed error、用户反馈、request/disposable scope、dialog accessibility 和重复初始化约束。
- `repository-release-governance`: 定义可复现工具链、CI 分层、仓库卫生、供应链清单、release manifest、迁移和回滚。

### Modified Capabilities

- `legacy-runtime-decomposition`: 将现有逐边界迁移契约扩展到真实 Pinia owner、生命周期 disposer、退役 notes/no-op surface 删除和稳定行为测试。

## Impact

- 前端：`index.html`、`src/main.js`、reader/session composables、Pinia stores、YouTube Workflow、Passage Preview、SRS、annotation、IndexedDB/localStorage repositories 与 UI feedback。
- 后端：`tools/subtitle-workflow/youtube_workflow/` 的 API、持久化、队列、子进程、AI、picker、认证和诊断；本地字典/TTS/翻译端点改由 production host 统一托管。
- 工程：`package.json`、Python lock/install、PowerShell launcher、CI、测试脚本、文档、Git ignore/attributes、许可证、release/rollback artifacts。
- 迁移：所有实现只在 `E:\read-web-next` 与 5174/8766 测试；在长时间回归、备份恢复、数据 dry-run 和快捷方式回滚演练通过前，`E:\read-web`、5173/8765、桌面快捷方式和真实数据不得改变。
