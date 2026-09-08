## Why

Read-Web 需要成为一个由一名用户在两台固定设备上使用的个人工具：Mac 只负责浏览器界面、阅读和操作，Windows 负责提供页面、API、媒体、持久数据和所有重型处理能力。

Windows private-LAN 稳定前门已经完成。剩余工作不再建设通用跨机平台，而是尽快打通一条真实、可日常使用的 Mac → Windows 路径。没有在这条路径上真实出现的问题，不提前设计系统解决。

## What Changes

- 保留已经完成的 LAN 前门、loopback 内部服务、optimization/daily 隔离和现有 owner/API 能力。
- Mac 日常使用时直接打开 Windows 提供的 production 页面；production 不依赖 Mac 上的 Vite、Node、Python 或后台服务。
- 在一个实现任务中验证并修复第一版必用路径：素材、transcript/chunk、播放/seek、marks，以及 Mac 提交 URL、Windows 下载/处理、Mac 查看基本状态并打开结果的 workflow。
- Preview、Annotation、Vocabulary 和 SRS 默认是非阻塞辅助功能：低成本确认现状，已工作则保持；失败则记录并暂缓，除非用户以后明确将某项提升为必用。
- 优先复用现有相对 URL、Windows API 和持久化能力；只有真实跨机阻塞才修改代码。
- Mac 可以保留 UI 偏好和可丢弃缓存，但第一版必用数据的可恢复副本必须在 Windows；Windows 不可用时不得把 Mac 缓存当作新的权威数据源。
- optimization 环境通过一次完整用户旅程后，再由用户明确授权执行真实数据备份和入口切换。
- 将原剩余 113 项缩减为 4 项：一次 optimization 实现、一次独立验收、一次授权后的真实数据切换、一次最终验收。

明确不再建设：网段扫描、MAC/设备指纹、多用户、HA、rate limit、复杂认证、应用内 PKI、复杂 launcher、企业级证据系统、逐域 authority checkpoint、browser outbox、长期兼容矩阵，以及为理论威胁增加的防护。

## Capabilities

### New Capabilities

- `private-lan-reader-host`: Windows 通过已完成的稳定前门向 Mac 提供同源页面、API 和 Range 媒体。
- `windows-authoritative-learning-domains`: Mac 使用现有 Windows API 读取和保存第一版必用数据；辅助学习功能不默认阻塞迁移。
- `cross-machine-release-cutover`: 先用 optimization 数据完成一次真实旅程，再经用户授权进行简单备份、切换和最终验收。

### Modified Capabilities

- `local-application-host`: 保留 loopback 默认行为和已实现的显式 private-LAN 前门。
- `reliable-reader-session`: Mac 能从 Windows 恢复并使用 Reader Session，刷新或手动重启 Windows launcher 后可重新连接。
- `durable-application-data`: Mac 使用模式下，业务数据必须能从 Windows 恢复；不要求新建同步、离线或多 writer 协议。
- `workflow-service-reliability`: Mac 通过 Windows 稳定前门提交 URL，由 Windows 完成现有下载/处理，并在 Mac 查看基本状态和打开结果。

## Impact

- 预计只修改实际跨机旅程暴露出的 frontend client、runtime adapter、Windows Host/API、media 或 launcher seam。
- 不为了任务清单完整性重写已经能工作的模块，也不主动移动源码目录。
- 保留 `config/runtime.optimization.json`、优化端口 `5184/8776` 和 `E:\ReadWebData\SubtitleWorkflow-Optimization`。
- 不改变 `SeekPlayerDB` 名称、version 1、`files` store 或 `id` key path。
- 在用户明确授权前，不读取或写入日常真实数据，不修改、构建或启动受保护的 `E:\read-web-next` 与 `E:\read-web`。
- 所有正式执行和审核任务使用新的项目 local 对话、`gpt-5.6-luna`、`reasoning effort=max`，严格串行且不使用 Git worktree。
