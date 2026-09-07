## ADDED Requirements

### Requirement: Mac 必须能够独立编辑和热更新前端源码
系统 SHALL 提供 remote-dev Vite mode，使 Mac checkout 能编辑 Vue、Pinia、CSS 和浏览器 runtime 并使用 HMR；该模式 MUST NOT 在 Mac 启动 Windows backend、Python workflow、SQLite、ECDICT 或九组 Node capability plugin。

#### Scenario: Mac 启动 remote-dev
- **WHEN** 开发者在 Mac 使用 remote-dev 配置启动 Vite
- **THEN** Vite MUST 只承担静态资源转换、HMR 和代理
- **THEN** WhisperX、ffmpeg、yt-dlp、SQLite、AI provider 与 capability endpoint MUST 仍由 Windows 提供

### Requirement: remote-dev 必须通过 Vite server proxy 访问 Windows
remote-dev SHALL 将相对 `/api`、event 和媒体请求代理到配置的 Windows 稳定前门；Windows 地址 MUST 只存在于 Mac 本地 server-side 配置，不得通过 `VITE_*` 或前端常量进入 browser bundle。

#### Scenario: 前端业务模块发起 API 请求
- **WHEN** remote-dev 页面使用相对 `/api/app/owner` 或 workflow URL
- **THEN** Vite proxy MUST 将请求转发到 Windows 稳定前门
- **THEN** 业务模块 MUST NOT 需要知道 Windows IP 或内部端口

#### Scenario: Mac 播放代理媒体
- **WHEN** media element 通过相对 URL 请求 Windows 媒体并执行 seek
- **THEN** Vite proxy MUST 保留 Range request 与 response headers
- **THEN** 播放 MUST NOT 回退为完整媒体下载

### Requirement: remote-dev 与 production 必须共享前端行为契约
remote-dev 和 Windows production `dist` SHALL 使用相同的相对 API、owner envelope、media descriptor 和 UI 状态模型；remote-dev 专用 proxy MUST NOT 成为 production 运行依赖。

#### Scenario: 前端修改通过验收后发布
- **WHEN** 同一前端 commit 从 Mac remote-dev 进入 Windows production release
- **THEN** 业务代码 MUST 无需替换 API base URL 或媒体 URL
- **THEN** Windows Host MUST 能直接提供该 `dist`
