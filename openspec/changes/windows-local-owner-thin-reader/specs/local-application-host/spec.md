## MODIFIED Requirements

### Requirement: 健康检查必须区分进程存活、就绪与能力状态
Local App Host SHALL 提供轻量 health endpoint，至少返回 release id、git SHA、profile、uptime、config compatibility、frontend build、workflow connectivity、六个 durable domain owner 的 registry/revision/recovery 状态、Host-managed repository readiness 和可选能力状态；liveness MUST NOT 因外部 AI、dictionary 或网络服务暂时失败而阻塞，但 durable owner registry、Host-managed repository、profile lease、pending recovery 或 API contract 不完整时 readiness MUST 失败。

#### Scenario: host 存活但 workflow 未就绪
- **WHEN** host 可以响应而 workflow service 无法连接
- **THEN** liveness MUST 继续成功
- **THEN** readiness MUST 失败并以 machine-readable reason 标明 workflow dependency

#### Scenario: release 验收读取健康信息
- **WHEN** launcher 或 `verify:release` 请求 health endpoint
- **THEN** 响应 MUST 能证明当前服务对应预期 release、profile、六域 owner registry 和配置兼容范围
- **THEN** 响应 MUST NOT 暴露原始 token、API key、cookie 或完整个人路径

#### Scenario: 六域 owner 或恢复状态不完整
- **WHEN** 任一 durable domain 缺少唯一 owner、Host-managed repository、revision evidence、backup adapter 或 pending journal 尚未恢复
- **THEN** liveness MAY 继续响应
- **THEN** readiness MUST 失败，且 host MUST NOT 接受新的 durable mutation 或让 browser fallback writer 接管

### Requirement: 高权限本地接口必须使用 loopback token 保护
host 与 workflow service SHALL 只监听明确配置的 loopback address；所有能读取任意本地路径、启动进程、调用 native picker、写文件、修改 job、使用凭据或执行六个 durable domain command/query 的 endpoint MUST 同时验证请求 Host、Origin 和短期 loopback token，CORS MUST NOT 被当作认证。Domain API 还 MUST 验证 profile capability、expected revision 或 idempotency key（适用时）。

#### Scenario: launcher 建立授权会话
- **WHEN** launcher 启动一个新的 runtime instance
- **THEN** launcher MUST 生成高熵、短期且仅对该 instance 有效的 token
- **THEN** token MUST 通过不进入 URL、日志、页面持久化存储或诊断正文的通道注入客户端

#### Scenario: 未授权页面访问高权限接口
- **WHEN** 请求缺少 token、token 过期、Host 非 loopback 或 Origin 不受信任
- **THEN** 服务 MUST 在执行文件、进程、picker、凭据或 domain mutation 操作前拒绝请求
- **THEN** 拒绝记录 MUST 只包含 correlationId 和脱敏原因

#### Scenario: 普通静态资源与健康探测
- **WHEN** 浏览器请求静态资源或 launcher 执行受限 health 探测
- **THEN** host MAY 不要求暴露 loopback token
- **THEN** 这些 endpoint MUST 保持只读且不得返回 secret 或提供高权限副作用

#### Scenario: 已授权请求缺少 owner revision 条件
- **WHEN** browser 对可变 domain 提交没有 expected revision 或 idempotency key 的 command
- **THEN** host MUST 在进入 repository 前拒绝该 command
- **THEN** canonical domain state、revision 和 workflow state MUST 保持不变

### Requirement: 媒体 endpoint 必须安全支持 HTTP Range
Local App Host SHALL 通过经 RuntimeConfig 限定的数据根或 capability mapping 提供媒体，并支持 `Range`、`Content-Range`、`Accept-Ranges`、稳定 `ETag` 与正确 content type；客户端传入的原始路径 MUST NOT 直接成为任意文件读取能力。媒体 API MUST 只发出请求范围，browser durable state、backup 和 migration MUST 只保存 media identity/reference metadata。

#### Scenario: 浏览器 seek 大媒体
- **WHEN** 浏览器为已授权媒体请求一个有效 byte range
- **THEN** host MUST 返回 `206 Partial Content` 和精确的 range headers
- **THEN** host MUST 只读取并发送请求范围而不是先加载完整文件

#### Scenario: 路径逃逸或失效媒体引用
- **WHEN** 媒体引用解析到允许根之外、符号链接逃逸、文件 identity 不匹配或文件已移除
- **THEN** host MUST 拒绝读取并返回 typed not-found 或 permission error
- **THEN** 响应和日志 MUST NOT 泄露允许根之外的规范化绝对路径

#### Scenario: API client 请求完整媒体内容
- **WHEN** browser adapter、backup adapter 或 migration helper 试图读取完整媒体 Blob/ArrayBuffer而不是 Range
- **THEN** host MUST 拒绝该操作或只返回 capability/reference metadata
- **THEN** Reader Session 和备份 manifest MUST 保持可重绑定的 media identity 而不包含完整媒体副本
