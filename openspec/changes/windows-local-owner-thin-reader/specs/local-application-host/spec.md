## MODIFIED Requirements

### Requirement: Local App Host 必须提供轻量 owner readiness

Local App Host SHALL 提供轻量 health/capability response，至少能区分 liveness、profile、六域 owner registration、Host-managed repository、current revision 和 recovery/readiness 状态。外部 AI、dictionary、网络或 workflow 可选依赖暂时不可用时，不得阻塞 liveness；受影响的 durable mutation 在 owner/repository/recovery 不可用时 MUST 返回 not-ready 或 manual-recovery。

#### Scenario: host 存活但某项可选依赖不可用

- **WHEN** host 可以响应而可选 workflow/AI/dictionary dependency 无法连接
- **THEN** liveness MUST 继续成功
- **THEN** 只有确实依赖该项的操作标记为 unavailable 或 not-ready

#### Scenario: owner registry 或 repository 不完整

- **WHEN** 受影响 domain 缺少唯一 owner、repository、revision evidence 或未完成 recovery
- **THEN** health/capability MUST 标记该 domain not-ready
- **THEN** host MUST 保留现有数据，并 MUST NOT 接受该 domain 的 durable mutation 或让 browser fallback writer 接管

### Requirement: 高权限本地接口必须使用 loopback authorization

Host 与 workflow service SHALL 只监听明确配置的 Windows loopback address。能读取本地文件、启动进程、修改 job 或执行 durable domain command/query 的 endpoint MUST 校验请求 Host、Origin、短期 instance token、profile capability，以及适用的 expected revision/idempotency key。CORS MUST NOT 被当作 authentication；token MUST NOT 放入 URL、browser durable storage、日志或普通 diagnostics。

#### Scenario: 未授权请求到达 mutation endpoint

- **WHEN** 请求缺少 token、Host/Origin 不可信、capability 不匹配或 revision/idempotency 条件缺失
- **THEN** service MUST 在读取路径、凭据、durable record 或启动进程之前拒绝 request
- **THEN** domain revision、job state 和 filesystem state MUST 保持不变，diagnostic 只保留脱敏 correlationId/原因

#### Scenario: 普通静态资源或健康探测

- **WHEN** 浏览器请求静态资源或受限 health probe
- **THEN** host MAY 不要求 durable mutation token
- **THEN** endpoint MUST 保持只读且不得返回 secret 或提供高权限副作用

### Requirement: 媒体 endpoint 必须安全支持 HTTP Range

Local App Host SHALL 通过 RuntimeConfig 限定的数据根或 capability mapping 提供媒体，并支持 `Range`、`Content-Range`、`Accept-Ranges`、稳定 `ETag` 和正确 content type。客户端原始路径 MUST NOT 直接成为文件读取能力；browser、backup 和 migration 只保存 media identity/reference metadata。

#### Scenario: 浏览器 seek 已授权媒体

- **WHEN** 浏览器为有效 capability 请求一个 byte range
- **THEN** host MUST 返回 `206 Partial Content` 和精确的 range headers
- **THEN** host MUST 只读取并发送请求范围，不先加载完整文件

#### Scenario: 路径逃逸或失效媒体引用

- **WHEN** 媒体解析到允许 root 之外、identity 不匹配或文件已移除
- **THEN** host MUST 拒绝读取并返回 typed not-found/permission/rebind result
- **THEN** response 和日志 MUST NOT 泄露受保护的完整路径
