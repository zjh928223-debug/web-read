## ADDED Requirements

### Requirement: Tailscale Serve 发布必须保持内部 loopback 授权边界
作为现有本机授权策略的显式发布扩展，系统 SHALL仅在显式启动参数指定当前 Serve HTTPS public origin 时接受该外部 origin；不要求新 RuntimeConfig 或 adapter 模块。Read-Web 前门、内部 Host 和 capability sidecar MUST仍只监听 127.0.0.1。前门 MUST验证精确 public Host/Origin 并重写内部请求，内部服务 MUST继续验证现有 service token；不得放宽为任意 tailnet 域名或信任任意转发头。原 loopback/private-LAN 行为 MUST保持。

#### Scenario: 合法 Serve 请求
- **WHEN** Serve 将请求代理到本机前门且 public Host/Origin 符合配置
- **THEN** 前门 MUST通过既有同源代理和内部 token 通道访问 Host、API 和 Range 媒体
- **THEN** token MUST留在 Windows，内部 Host（包括当前 5200）与 8776 MUST不能从 Mac 直接连接

#### Scenario: 外部请求不匹配
- **WHEN** 请求带未知 Host、不匹配 Origin 或伪造任意 Forwarded authority
- **THEN** 前门 MUST拒绝请求，不泄漏内部路径、端口和凭据

#### Scenario: 普通媒体请求没有 Origin
- **WHEN** 合法入口下浏览器发送无 Origin 的普通导航或媒体 GET
- **THEN** 系统 MUST沿用现有合法读取规则，不因浏览器正常省略该 header 破坏播放
