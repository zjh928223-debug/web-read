# local-application-host Specification

## Purpose
TBD - created by archiving change stabilize-and-simplify-read-web. Update Purpose after archive.
## Requirements
### Requirement: 日常版本必须由 production host 提供
系统 SHALL 通过专用 Local App Host 托管 production build 的静态产物和本地能力；日常启动流程 MUST NOT 将 Vite dev server 或 `vite preview` 作为用户版本宿主。

#### Scenario: 启动日常版本
- **WHEN** launcher 启动一个已构建的 release
- **THEN** Local App Host MUST 只从 release manifest 指定的 `dist` 目录提供不可变静态产物
- **THEN** 启动流程 MUST NOT 启动 Vite dev server 或依赖 source module transformation

#### Scenario: production build 不完整
- **WHEN** release manifest、入口文件或其 checksum 缺失或不匹配
- **THEN** host MUST 拒绝进入 ready 状态
- **THEN** launcher MUST 显示可操作的修复或回滚信息而不是打开残缺页面

### Requirement: RuntimeConfig 必须统一解析并验证运行配置
系统 SHALL 由单一 RuntimeConfig owner 按 CLI → environment → user config → validated defaults 的优先级解析 frontend/backend port、data root、release root、dictionary、ffmpeg、yt-dlp、WhisperX、cookie、proxy、model 和其他外部工具配置；业务模块 MUST NOT 内嵌个人绝对路径或独立推断端口。

#### Scenario: 多来源配置覆盖
- **WHEN** 同一配置项同时存在于 CLI、environment、user config 和 default
- **THEN** RuntimeConfig MUST 选择最高优先级的有效值
- **THEN** `/health` 诊断 MUST 报告该值的来源但 MUST 脱敏 secret、token 和 cookie 内容

#### Scenario: 路径或工具无效
- **WHEN** 必需路径不存在、工具不可执行、端口越界或配置类型错误
- **THEN** RuntimeConfig MUST 在启动相关能力前返回结构化 validation error
- **THEN** 系统 MUST NOT 静默回退到开发者机器上的历史绝对路径

#### Scenario: 可选能力不可用
- **WHEN** dictionary、WhisperX 或其他可选工具未配置或探测失败
- **THEN** host MUST 保持不依赖该工具的学习能力可用
- **THEN** readiness 与 UI capability 状态 MUST 明确标记受影响能力及修复提示

### Requirement: 端口与进程实例必须受 launcher 管理
系统 SHALL 为每个运行 profile 分配明确的 frontend/backend port、PID 与 runtime state directory，并在启动前验证端口占用者；隔离测试 profile MUST NOT 停止、复用或修改日用 profile 的 5173/8765 进程。

#### Scenario: 目标端口已由当前 release 占用
- **WHEN** launcher 发现端口上的健康响应、release id 与 runtime profile 均匹配
- **THEN** launcher MUST 复用该实例并聚焦或返回现有 URL
- **THEN** launcher MUST NOT 启动第二组重复进程

#### Scenario: 目标端口被未知进程占用
- **WHEN** 端口占用者不能提供匹配的 health identity
- **THEN** launcher MUST 拒绝覆盖或终止该进程
- **THEN** launcher MUST 报告端口、占用状态和可选择的新端口或手动处理方式

#### Scenario: 子服务启动失败
- **WHEN** host 所管理的必需子服务在 startup deadline 内未 ready 或提前退出
- **THEN** launcher MUST 清理本次启动产生的进程和 runtime files
- **THEN** 既有日用实例和其他 profile MUST 保持不变

### Requirement: 健康检查必须区分进程存活、就绪与能力状态
Local App Host SHALL 提供轻量 health endpoint，至少返回 release id、git SHA、profile、uptime、config compatibility、frontend build、workflow connectivity 和可选能力状态；liveness MUST NOT 因外部 AI、dictionary 或网络服务暂时失败而阻塞。

#### Scenario: host 存活但 workflow 未就绪
- **WHEN** host 可以响应而 workflow service 无法连接
- **THEN** liveness MUST 继续成功
- **THEN** readiness MUST 失败并以 machine-readable reason 标明 workflow dependency

#### Scenario: release 验收读取健康信息
- **WHEN** launcher 或 `verify:release` 请求 health endpoint
- **THEN** 响应 MUST 能证明当前服务对应预期 release、profile 和配置兼容范围
- **THEN** 响应 MUST NOT 暴露原始 token、API key、cookie 或完整个人路径

### Requirement: 高权限本地接口必须使用 loopback token 保护
host 与 workflow service SHALL 只监听明确配置的 loopback address；所有能读取任意本地路径、启动进程、调用 native picker、写文件、修改 job 或使用凭据的 endpoint MUST 同时验证请求 Host、Origin 和短期 loopback token，CORS MUST NOT 被当作认证。

#### Scenario: launcher 建立授权会话
- **WHEN** launcher 启动一个新的 runtime instance
- **THEN** launcher MUST 生成高熵、短期且仅对该 instance 有效的 token
- **THEN** token MUST 通过不进入 URL、日志、页面持久化存储或诊断正文的通道注入客户端

#### Scenario: 未授权页面访问高权限接口
- **WHEN** 请求缺少 token、token 过期、Host 非 loopback 或 Origin 不受信任
- **THEN** 服务 MUST 在执行文件、进程、picker 或凭据操作前拒绝请求
- **THEN** 拒绝记录 MUST 只包含 correlationId 和脱敏原因

#### Scenario: 普通静态资源与健康探测
- **WHEN** 浏览器请求静态资源或 launcher 执行受限 health 探测
- **THEN** host MAY 不要求暴露 loopback token
- **THEN** 这些 endpoint MUST 保持只读且不得返回 secret 或提供高权限副作用

### Requirement: 媒体 endpoint 必须安全支持 HTTP Range
Local App Host SHALL 通过经 RuntimeConfig 限定的数据根或 capability mapping 提供媒体，并支持 `Range`、`Content-Range`、`Accept-Ranges`、稳定 `ETag` 与正确 content type；客户端传入的原始路径 MUST NOT 直接成为任意文件读取能力。

#### Scenario: 浏览器 seek 大媒体
- **WHEN** 浏览器为已授权媒体请求一个有效 byte range
- **THEN** host MUST 返回 `206 Partial Content` 和精确的 range headers
- **THEN** host MUST 只读取并发送请求范围而不是先加载完整文件

#### Scenario: 路径逃逸或失效媒体引用
- **WHEN** 媒体引用解析到允许根之外、符号链接逃逸、文件 identity 不匹配或文件已移除
- **THEN** host MUST 拒绝读取并返回 typed not-found 或 permission error
- **THEN** 响应和日志 MUST NOT 泄露允许根之外的规范化绝对路径

### Requirement: production host 必须支持可验证关闭与恢复
launcher SHALL 通过实例 identity 和健康信息关闭其拥有的进程，并在 graceful shutdown deadline 后才升级终止；启动或升级失败 MUST 能依据 previous release manifest 恢复上一可用 release。

#### Scenario: 正常关闭当前实例
- **WHEN** 用户或迁移脚本请求关闭指定 runtime instance
- **THEN** launcher MUST 仅通知 PID、instance id 和 start identity 均匹配的进程
- **THEN** host MUST 停止接受新副作用、完成或取消在途工作并释放端口

#### Scenario: 新 release 健康检查失败
- **WHEN** 快捷方式切换后的 release 未在 deadline 内通过 readiness 和 startup journey
- **THEN** launcher MUST 恢复 previous manifest 对应的 release target
- **THEN** rollback MUST NOT 覆盖用户数据或停止旧 profile 之外的进程

