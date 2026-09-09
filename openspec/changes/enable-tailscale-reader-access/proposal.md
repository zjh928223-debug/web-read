## Why

当前 private-LAN 实现只能解决家中网络访问，不能满足公司或异地 Mac 的实际场景。两台设备已有 Tailscale，本次只增加一个明确的 tailnet 入口，复用现有 Reader、marks 和 URL workflow，不再建设另一套远程平台。

## What Changes

- 推荐 B：先手动运行现有 optimization launcher 和 Tailscale Serve，Read-Web 前门继续监听 127.0.0.1:5184，Serve 在 tailnet 的 HTTPS 5184 私有发布。手动两步启动是合格交付，最多按需加一个薄脚本，不强制开发 adapter。
- 唯一浏览器入口是动态发现的 `https://<本机 MagicDNS 完整名称>:5184`，页面、API、媒体和 workflow 保持同源；IP 用于诊断，不要求裸 IP HTTPS，不修改 RFC1918 resolver。
- 内部 Host（当前报告为 5200，仍允许现有动态端口机制）和 8776 继续仅监听 127.0.0.1，复用服务器侧 service token。
- 用一次异地 Mac 核心旅程验证，记录 direct/relay 与一次 Range 实测；不保证 direct，不建设测速系统。
- 这是旧 change 的独立 transport 扩展，不是 E-201 缺陷修复。旧 change 的业务范围和 21/25 状态保持；共享一次有效实机证据，不重复重处理。
- 在实施时将架构 non-goal 中的 Tailscale transport 改为仅允许本次单用户入口；其他非目标保持。

## Capabilities

### New Capabilities

- `tailnet-reader-access`: 动态 tailnet 入口、失败关闭、同源访问、隔离和一次真实异地验收。

### Modified Capabilities

- `local-application-host`: 增加显式 tailnet 前门例外，保持内部服务 loopback 和既有授权边界。

## Impact

- 以 2–3 小时的一轮集中实现和验收为目标，不承诺必然完成。约一小时报告入口结果和阻塞，接近两小时转入验收，三小时未完成则报告可用部分和剩余项，未经用户同意不延长为大规模工程。
- 默认仅调整必要的前门 public origin 参数/校验及启动参数传递，最多加一个薄脚本和简短使用说明。RuntimeConfig/schema、Node/Python 双端配置、内部 request policy 和浏览器 client 不预先改造，只修真实必用阻塞。
- Tailscale 是用户已安装的外部前置条件；不安装服务，不自动登录，不改 ACL/Firewall，不启动或修改 Moonlight。
- 仅用 `E:\ReadWebData\SubtitleWorkflow-Optimization`；不读取或操作受保护工作树、daily 数据，不改 IndexedDB schema。
- 本次只制定规划；不启动运行时、不提交 Git、不创建执行/审核对话、不勾选 E-201。
