## ADDED Requirements

### Requirement: Serve 必须提供唯一的私有 HTTPS 应用入口
系统 SHALL 通过现有 Tailscale Serve 命令将 Windows 的 127.0.0.1:5184 前门发布为 tailnet 内的 HTTPS 5184；手动运行原 launcher 和 Serve MUST被接受为合格启动方式，不要求专用 adapter 或新 RuntimeConfig。浏览器 SHALL 使用本机完整 MagicDNS 名称。页面、API、媒体和 workflow MUST 同源，MUST NOT依赖 Moonlight、家庭 LAN 地址、0.0.0.0、Funnel 或公网代理。

#### Scenario: 异地 Mac 使用
- **WHEN** Mac 已连接同一 tailnet 且原 launcher 和 Serve 均成功启动
- **THEN** 输出的 HTTPS MagicDNS URL MUST 可供 Mac 本机浏览器打开，页面 MUST 有可用的安全上下文和 crypto.subtle
- **THEN** Read-Web 网络请求 MUST NOT直接访问 LAN/loopback/5200/8776 或接收完整 Windows 路径和服务凭据

### Requirement: 地址发现和启动失败必须保持明确边界
启动操作 SHALL 用现有 Tailscale CLI 人工确认本机状态、IP 和 DNS，并将已验证的 public origin 传给必要的前门参数；不要求自动发现框架。代码 MUST NOT硬编码机器 IP；CLI 不可用、HTTPS/权限缺失或冲突 MUST明确报告失败，不得自动安装、登录、修改 ACL/Firewall 或降级到 LAN/公网监听。

#### Scenario: 无有效运行环境
- **WHEN** CLI 超时、未连接、IP/DNS 缺失、Serve 失败或 5184 被其他发布占用
- **THEN** 操作结果 MUST报告错误，不宣告可用、不覆盖其他发布，并仅清理本次启动的资源

#### Scenario: 断网时停止
- **WHEN** 用户停止 launcher 但 Tailscale CLI 或 DNS 发现已不可用
- **THEN** 用户 MUST仍可用原 launcher 停止 Read-Web；操作说明 MUST明确无法撤销的残留 Serve 映射需在 CLI 恢复后清除
- **THEN** 操作 MUST NOT执行全局 Serve reset 或停止 Tailscale

### Requirement: 实施必须遵守集中交付的时间和范围边界
实施 SHALL以 2–3 小时的一轮实现和验收为目标，约一小时报告入口结果和阻塞，接近两小时转入验收。系统 MUST NOT为了专用 launcher、通用配置、自动发现或辅助功能延后首次 Mac 使用；三小时仍未完成 MUST报告实际结果并等待用户决定是否继续，而不是自动扩大工程。

#### Scenario: 必用路径超出本轮工作量
- **WHEN** 发现必须大规模改造或接近时间边界仍未打通核心路径
- **THEN** MUST报告已可用部分、具体阻塞和剩余工作，不伪报 PASS，也不静默继续长时间开发

### Requirement: 必用业务必须在异地浏览器保存和恢复
系统 SHALL 复用 Reader Session、transcript/chunk、Range 媒体、播放/暂停/seek、marks 和 URL workflow。保存成功的数据 MUST可仅从 Windows 恢复；连接失败 MUST显示失败或重试，不得把 Mac 缓存提升为权威。Preview、Annotation、Vocabulary、SRS MUST保持非阻塞。

#### Scenario: 完成一次真实旅程
- **WHEN** 用户在异地 Mac 打开素材、保存 mark、提交短 URL 并等待处理
- **THEN** MUST显示对应 transcript/chunk、播放与 seek、基本 polling 状态及可打开的结果
- **THEN** 刷新、新浏览器及手动重启 launcher 后刷新或重试 MUST恢复已保存 Session 和 marks

### Requirement: 验收必须记录真实路径而不扩大性能工程
验收 SHALL记录一次真实异地 Mac 旅程和有限大媒体 Range 的 206、范围、字节数、耗时及传输时 direct/relay 状态。系统 MUST NOT强制 direct、承诺固定吞吐或要求建设测速/证据平台；review MUST复用有效结果，仅补疑点和证据缺口。

#### Scenario: 公司网络使用 relay
- **WHEN** Tailscale 只能通过 relay 连接
- **THEN** MUST如实记录连接和播放表现，不得仅因 relay 判定应用失败或自动扩大 NAT/网络工程

#### Scenario: 只有 Windows 自动化结果
- **WHEN** 真实 Mac 旅程尚未完成
- **THEN** MUST标注待实机验证，不得勾选旧 E-201 或创建 R-201，也不得把静态 fixture 称为跨机 PASS

### Requirement: Optimization 数据和回退必须隔离
本变更 MUST仅使用 optimization 工作区和 E:\ReadWebData\SubtitleWorkflow-Optimization，不读取或修改受保护工作树及日常真实数据。SeekPlayerDB version 1、files、id MUST保持。回退 SHALL精确停止本应用 Serve 映射后复用已有 LAN/loopback launcher，不引入数据迁移。

#### Scenario: 回退到旧入口
- **WHEN** Serve 发布不可用或用户选择撤销
- **THEN** MUST保留旧配置和 optimization 数据，不得清理其他发布或操作 daily 实例
- **THEN** MUST明确 LAN/loopback 回退不提供异地访问
