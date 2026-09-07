## ADDED Requirements

### Requirement: private-lan 必须是显式且独立的运行模式
系统 SHALL 保留 loopback 为默认 transport，并只在独立 RuntimeConfig 和 launcher 明确启用时允许稳定前门监听配置的 Windows LAN 地址；现有 optimization profile、`5184/8776` 隔离和优化数据根 MUST 保持不变。

#### Scenario: 普通优化启动
- **WHEN** 用户使用现有 optimization launcher 且未启用 `private-lan`
- **THEN** 稳定前门、内部 Host 和 capability sidecar MUST 继续只监听 loopback
- **THEN** 现有本机 URL、端口和数据根 MUST 保持不变

#### Scenario: 显式启动 LAN 模式
- **WHEN** 用户使用 LAN 专用配置启动 `private-lan`
- **THEN** 只有稳定前门 MUST 监听配置的 LAN 地址
- **THEN** 内部 FastAPI candidate Host 与 `8776` capability sidecar MUST 继续只监听 loopback

### Requirement: Windows 稳定前门必须提供同源应用入口
LAN 模式下，Windows 稳定前门 SHALL 通过同一 origin 提供 production `dist`、owner API、workflow API、capability API、event endpoint 与媒体；Mac production 页面 MUST NOT 依赖独立 backend base URL 或 production CORS。

#### Scenario: Mac 打开 production 页面
- **WHEN** Mac 浏览器访问 Windows 稳定前门 URL
- **THEN** 页面静态资源和 `/api` 请求 MUST 使用同一 origin
- **THEN** 页面 MUST 能执行 health、owner query、workflow polling 和媒体请求

### Requirement: LAN 模式必须保持最小个人工具授权边界
系统 SHALL 继续验证配置的 Host、Origin 和 service token，并 SHALL 在访问文件、凭据、进程或 owner mutation 前拒绝不匹配请求；本变更 MUST NOT 引入 pairing、refresh token、企业身份系统或自研证书平台。

#### Scenario: 请求目标不是配置的 LAN Host
- **WHEN** 请求 Host 或 Origin 与当前 LAN 配置不匹配
- **THEN** 稳定前门 MUST 在代理到内部服务前拒绝请求
- **THEN** Windows 数据、路径、凭据和进程状态 MUST 保持不变

### Requirement: LAN 前门必须透明保持现有协议语义
稳定前门 SHALL 透明代理 request/response body、typed error、receipt、Range headers 和 streaming response，不得依据代理层 HTTP 成功改变 owner commit 语义。

#### Scenario: owner command 返回 commit-unknown
- **WHEN** 内部 owner 返回 `commit-unknown` 与 receipt lookup handle
- **THEN** LAN 前门 MUST 原样保留该结果
- **THEN** Mac 客户端 MUST NOT 将代理请求成功解释为 committed

#### Scenario: Mac 请求媒体区间
- **WHEN** Mac 通过稳定前门发送合法 Range 请求
- **THEN** 前门 MUST 保留 `206`、`Content-Range`、`Accept-Ranges`、`ETag` 和 media identity headers
- **THEN** 前门 MUST NOT先读取完整媒体
