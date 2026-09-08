## 1. 已完成：执行协议与迁移基线

以下任务已经完成并保留为历史基线，不因本次缩减范围而修改完成状态或重做。

- [x] 1.1 `E-001` 只读盘点当前 branch、HEAD、未提交文件、现有验证结果和需保留的 WhisperX/语言处理/Preview/SRS 工作，生成所有后续任务使用的迁移基点候选，不修改源码或数据。
- [x] 1.2 `R-001` 独立确认 `E-001` 基点包含所有应保留工作、没有误用旧默认分支、没有读取或修改受保护工作树，并输出 `PASS/FAIL` 与最终 `PHASE_BASE`。
- [x] 1.3 `E-002` 将 production 由 Windows 同源提供 `dist + /api`、Mac remote-dev 使用轻量 Vite proxy、Windows 独占重任务和数据的双模式部署决策写入当前架构说明，明确不采用 Tauri、Mac production server、远程 NativePicker、自研 pairing/TLS 和独立 Git 仓库。
- [x] 1.4 `R-002` 独立审核部署决策是否保持 5184 稳定前门、8776 loopback sidecar、内部 FastAPI 动态端口以及 optimization/daily 隔离，且没有重新引入 production CORS 或签名媒体 URL。
- [x] 1.5 `E-003` 为现有 owner contract 增加最小 `private-lan` transport delta，保持业务 operation、typed envelope、revision、idempotency 和 receipt 语义不变，并明确只有稳定前门可对 LAN 监听。
- [x] 1.6 `R-003` 独立运行 contract checks，确认 8776 未被定义为公共 FastAPI 入口、Mac 不可直连 sidecar、loopback 默认没有改变、contract v1 业务字段没有被无意破坏。
- [x] 1.7 `E-004` 建立跨机自动/手工验收清单和可逐步填充的测试骨架，覆盖 health、owner query、至少一项本地 capability、至少一项外部 capability、polling、audio/video Range、seek、Windows restart 和 Mac reconnect。
- [x] 1.8 `R-004` 独立审核验收清单是否覆盖真实单用户路径，并删除或拒绝 HA、压力实验室、多用户、企业审计、复杂威胁建模等范围外要求。
- [x] 1.9 `G-0` 在 `R-001` 至 `R-004` 全部 PASS 后集成文档与 contract 基线，运行 OpenSpec strict validation，并记录下一阶段唯一 `PHASE_BASE`。

## 2. 已完成：Windows private-LAN 稳定前门

以下任务已经完成并保留为 LAN 基础，不重构或重复验收；只有后续真实用户路径证明存在回归时才修改。

- [x] 2.1 `E-101` 在 request policy 附近提取可单测的 LAN bind、request Host 和 same-origin 判断函数；默认只接受 loopback，只有显式 `private-lan` 配置才接受指定 LAN 地址，不实现网段扫描、设备指纹、MAC 识别或 rate limit。
- [x] 2.2 `R-101` 独立检查 IPv4、localhost、Host 带端口、缺失配置和非法地址测试，确认普通 optimization 启动仍然只允许 loopback。
- [x] 2.3 `E-102` 扩展 Windows request policy，使显式 LAN mode 能校验配置的 Host、Origin 和现有 service token，同时保持文件路径、凭据和 owner mutation 在授权前不可达。
- [x] 2.4 `R-102` 独立运行 request-policy 与 owner API checks，确认 LAN mode 未将 CORS 当认证、错误响应不泄漏绝对路径、loopback 请求行为没有回归。
- [x] 2.5 `E-103` 扩展 `tools/optimization-stable-front-door.mjs` 的显式 LAN bind/Host/Origin 模式，保持 internal Host target 必须是 loopback、8776 不可作为 target，并透明代理普通 HTTP、Range 和 streaming response。
- [x] 2.6 `R-103` 独立审核前门 diff 和测试，确认 LAN 只开放稳定前门、内部 target 限制仍在、Host/Origin 重写正确、activation journal 与 previous release 路由没有回归。
- [x] 2.7 `E-104` 新增 LAN 专用 RuntimeConfig，不修改 `config/runtime.optimization.json`；配置只包含非 secret 的 bind/public URL/profile 信息，并继续使用 `E:\ReadWebData\SubtitleWorkflow-Optimization` 作为开发验证数据根。
- [x] 2.8 `R-104` 独立审核新配置不含 API key、Cookie、代理凭据和日常真实数据根，且原有 5184/8776 optimization config 原样通过验证。
- [x] 2.9 `E-105` 新增 LAN 专用 launcher 入口，复用现有 build、immutable release、front door、candidate Host、capability sidecar、health、stop 和 rollback 模块，不复制第二套 launcher 生命周期系统。
- [x] 2.10 `R-105` 独立检查 launcher 不绕过 Python health、不修改全局 Python、不停止身份不匹配进程、不复用 daily 5174/8766，启动失败时保留上一可用 release。
- [x] 2.11 `E-106` 增加 Windows 本机的 LAN 模式自动验证，证明 5184 稳定前门可用、内部 Host 和 8776 仍为 loopback、静态页面和关键 API 能经前门访问；测试不得修改日常 reader 或日常数据。
- [x] 2.12 `R-106` 独立复跑 LAN/loopback 监听、health、production preview 和 launcher focused checks，核对实际监听地址而不是只检查配置文本。

## 3. Optimization 上完成个人跨机使用路径

本阶段只使用 `E:\read-web-next-optimization`、private-LAN optimization 配置、`5184/8776` 和 `E:\ReadWebData\SubtitleWorkflow-Optimization`。不得读取或修改日常真实数据，也不得操作受保护工作树。

- [ ] 3.1 `E-201` 使用一个新的项目 local `gpt-5.6-luna`、`reasoning effort=max` 对话，从当前 clean HEAD 持续实现并验证第一版必用路径：Windows LAN launcher 输出 Mac URL；Mac 浏览器打开 production 页面；页面/API/媒体不直连内部端口或依赖 Windows 绝对路径；Windows 素材可打开；transcript/chunk、播放、暂停和 seek 可用；marks 保存后可从 Windows 恢复；Mac 可提交 URL，由 Windows 完成现有下载/处理，Mac 可查看基本状态并打开结果；刷新、清除 Mac 可丢弃缓存或使用新浏览器后仍可恢复必用数据；停止后台、手动重新运行 launcher 后，Mac 刷新或重试即可恢复。Preview、Annotation、Vocabulary 和 SRS 仅做低成本现状确认：已工作则保持，失败则记录为非阻塞项，不在本任务中扩张，除非用户执行前明确提升优先级。优先复用现有 owner/API，只修改真实失败的 seam；不得增加扫描、设备指纹、多用户、HA、rate limit、复杂认证、browser outbox、逐域 checkpoint、兼容矩阵、SSE、远程 NativePicker、workflow 管理后台或企业级证据系统。运行与实际 diff 相关的 focused checks、build、production preview 和 LAN smoke；不要求开机自启、无感自动重连、后台任务断点续作或 launcher 服务安装。提交实现并报告 TASK_HEAD、实机结果、真实通过项、非阻塞辅助功能问题和任何需要用户配合的步骤。
- [ ] 3.2 `R-201` 使用另一个新的项目 local `gpt-5.6-luna`、`reasoning effort=max` 对话，对 `E-201` 做一次独立只读审核。审核以 `E-201` 的实机结果、代码 diff 和测试结果为主要证据，只复跑低成本检查、可疑路径或证据缺口，不无理由重复下载、转录、AI 处理等耗时操作。只报告实际 P0-P2：启动或连接失败、Reader/媒体/seek 不可用、marks 或必用数据不能从 Windows 恢复、workflow 主路径失败、手动重启 launcher 后无法恢复、optimization/daily 串写、secret/完整路径/内部端口泄漏，或本次 diff 引入的明确回归。Preview、Annotation、Vocabulary、SRS 的已记录问题默认不阻塞；不得因网段扫描、设备识别、多用户竞争、HA、rate limit、企业认证、压力测试、理论威胁或证据系统完善度判定失败。PASS 后由调度对话更新本项；FAIL 时最多允许一次新的 `F-201` 范围修复和一次 fresh re-review，第二次仍失败则停止并请用户决定。

## 4. 经用户授权后切换日常真实数据

本阶段必须等待第 3 阶段 PASS，并在执行前取得用户对读取和写入日常真实数据的明确授权。授权前不得创建或启动 `E-301`。

- [ ] 4.1 `E-301` 使用新的项目 local `gpt-5.6-luna`、`reasoning effort=max` 对话，在用户明确授权后先只读确认第一版必用数据实际位于 Windows 数据根、Windows 浏览器 IndexedDB/localStorage 还是其他现有位置；暂停旧入口写入，确认备份位置并创建普通可恢复备份。必要时只复用项目已有导出/导入能力，不建设迁移平台。随后让已通过 optimization 验收的 Windows 入口使用真实数据，重点确认旧素材和 marks 可见、产生一次新保存，并在停止后台、手动重新运行 launcher 后由 Mac 刷新或重试恢复。复用 `E/R-201` 已验证的代码和实机结果，不重复无关的下载、转录、AI 处理或辅助功能旅程。不得修改、构建或启动受保护工作树，不建设逐域 checksum 证据包或企业级 rollback rehearsal；遇到未知格式或不兼容时停止并报告，不猜测迁移。失败时保留原数据、备份和旧配置，不执行破坏性清理。
- [ ] 4.2 `R-301` 使用另一个新的项目 local `gpt-5.6-luna`、`reasoning effort=max` 对话做最终只读审核，以 `E-301` 的数据位置确认、备份、切换和实机结果为主要证据，只复跑可疑项或证据缺口。确认日常入口可由 Mac 使用、旧素材可见、marks 或一次必用保存成功、实际数据仍在 Windows、手动重启 launcher 后可恢复、optimization 与 daily 未双写、备份和旧配置仍存在；不得无理由重复 optimization 已通过的下载、转录或完整 workflow。只报告真实 P0-P2，不追加企业级要求。PASS 后即可记录最终启动方式、已知非目标并归档 change；FAIL 时停止，不自动扩大迁移或回滚工程。

## 5. 调度规则

- 所有剩余任务严格串行，一次只允许一个可能写入主工作区的任务。
- 每个 `E-*` 与 `R-*` 使用全新对话；`R-*` 严格只读，不修改文件、任务状态或提交。
- 所有任务使用项目 `local` 环境、`gpt-5.6-luna`、`reasoning effort=max`；永久禁止 Git worktree。
- 不预创建后续任务。当前项 PASS 且工作区 clean 后，才创建下一项。
- local 创建失败时只检查一次任务列表；没有正式 `threadId` 就停止报告，不复用 queued/failed task。
