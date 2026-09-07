## MODIFIED Requirements

### Requirement: 高权限本地接口必须使用受限 Host 与 token 保护
host 与 workflow service SHALL 默认只监听明确配置的 loopback address；当独立 RuntimeConfig 显式启用 `private-lan` 时，只有稳定前门 MAY 监听配置的 Windows LAN address，内部 FastAPI candidate Host 与 capability sidecar MUST 保持 loopback。所有能读取本地路径、启动进程、写文件、修改 job 或使用凭据的 endpoint MUST 验证请求 Host、Origin 和 service token，CORS MUST NOT 被当作认证。

#### Scenario: launcher 建立本机授权会话
- **WHEN** launcher 启动一个新的 loopback runtime instance
- **THEN** launcher MUST 生成高熵且仅对该 instance 有效的 token
- **THEN** token MUST 通过不进入 URL、日志、前端 bundle 或诊断正文的通道提供给 Host

#### Scenario: 启动 private-lan 稳定前门
- **WHEN** LAN 专用配置显式启用 `private-lan`
- **THEN** 稳定前门 MUST 只监听配置的 LAN address，并验证配置的 Host、Origin 和 token
- **THEN** 内部 Host、`8776` capability sidecar、数据路径和凭据 MUST NOT直接暴露给 Mac

#### Scenario: 未授权页面访问高权限接口
- **WHEN** 请求缺少有效 token、Host 不匹配或 Origin 不受信任
- **THEN** 服务 MUST 在执行文件、进程、picker、owner mutation 或凭据操作前拒绝请求
- **THEN** 拒绝响应 MUST 不包含 secret 或完整个人路径

#### Scenario: 普通静态资源与健康探测
- **WHEN** 浏览器请求静态资源或 launcher 执行受限 health 探测
- **THEN** host MAY 不要求浏览器显式提供 token
- **THEN** 这些 endpoint MUST 保持只读且不得提供高权限副作用
