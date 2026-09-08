## MODIFIED Requirements

### Requirement: Mac 必须能够从 Windows 恢复一致的 Reader Session
Mac remote 使用路径 SHALL 从 Windows 获取当前素材所需的 media identity、transcript、chunk 和 session metadata，并通过现有 Reader runtime/Pinia/Vue 渲染路径显示。实现 SHOULD 复用现有 owner 和校验语义，不得为了跨机目标创建第二套渲染系统或新的通用同步协议。

#### Scenario: Mac 打开 Windows 已有素材
- **WHEN** Windows 返回同一素材的一致 session 数据和媒体标识
- **THEN** Mac MUST 显示对应 transcript/chunk 并可播放、暂停和 seek
- **THEN** 页面 MUST NOT需要 Windows 绝对路径或直接连接内部 Host/sidecar

#### Scenario: 候选素材数据无效
- **WHEN** transcript、chunk 或 media identity 无法组成可用 Reader Session
- **THEN** 页面 MUST 保留当前可用会话或显示明确失败状态
- **THEN** 页面 MUST NOT展示半新半旧的素材状态

#### Scenario: 刷新或手动重启 Windows 后台
- **WHEN** 用户停止 Read-Web 后台、手动重新运行 launcher，并在 Mac 刷新页面或点击重试
- **THEN** Mac MUST 能重新连接并从 Windows 恢复最近保存的 Reader Session
- **THEN** 恢复 MUST NOT依赖只存在于 Mac 的业务数据

### Requirement: 第一版恢复不得扩大为系统启动工程
本变更 MUST NOT要求 Windows 开机自启、无感自动重连、后台任务断点续作、launcher daemon 或系统服务安装。

#### Scenario: Windows 后台暂时停止
- **WHEN** Mac 在后台停止期间无法访问 Reader Session
- **THEN** 页面 MAY 要求用户手动刷新或重试
- **THEN** 验收 MUST NOT要求后台自动随操作系统启动或恢复进行中的重任务
