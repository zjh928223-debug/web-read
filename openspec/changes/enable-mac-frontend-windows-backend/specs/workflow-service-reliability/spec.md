## ADDED Requirements

### Requirement: Mac remote mode 不得依赖 Windows NativePicker
Mac remote mode SHALL 使用 YouTube URL 和 Windows library query 选择输入；第一版 MUST NOT通过网络请求触发需要用户在 Windows 桌面交互的 NativePicker。

#### Scenario: Mac 用户选择已有 Windows 素材
- **WHEN** Mac 用户打开素材选择界面
- **THEN** UI MUST查询 Windows library 并使用 opaque job/media identity 选择素材
- **THEN** API MUST NOT返回完整 Windows 路径或要求用户操作 Windows picker

### Requirement: Mac 第一版必须使用现有 polling 完成 workflow 状态更新
Mac remote mode SHALL 复用 single-flight、visibility-aware polling 获取 job、queue 和 progress；本变更 MUST NOT以实现 SSE 作为跨机可用的前置条件。

#### Scenario: Mac 查看运行中的 job
- **WHEN** Windows 正在执行下载、WhisperX 或翻译任务
- **THEN** Mac MUST通过现有 batch/polling seam 获取状态并拒绝 stale revision
- **THEN** 暂时网络失败 MUST保留上一份 immutable snapshot 并提供重试

## MODIFIED Requirements

### Requirement: Workflow 高权限接口必须继承 Local App Host 授权边界
workflow service SHALL 将 job mutation、本地路径 scan/import、native picker、凭据使用和外部进程启动视为高权限操作。loopback 模式 MUST验证 loopback binding、Host、Origin、instance token 与请求参数允许范围；`private-lan` 模式 MUST只允许请求经 Windows 稳定前门进入，内部 workflow service MUST保持 loopback 且不得直接接受 Mac 连接。

#### Scenario: 未授权请求启动 workflow
- **WHEN** 非受信 Host/Origin、缺失 token 或错误 runtime instance 的请求调用高权限 endpoint
- **THEN** 稳定前门或 workflow service MUST在读取路径、访问凭据或启动进程之前返回 unauthorized
- **THEN** job、queue 和 filesystem MUST保持不变

#### Scenario: LAN 请求绕过稳定前门
- **WHEN** Mac 尝试直接访问内部 FastAPI Host 或 capability sidecar
- **THEN** 内部服务 MUST因 loopback binding 而不可达
- **THEN** 请求 MUST NOT执行 workflow、文件或凭据操作

#### Scenario: 授权请求包含越界路径
- **WHEN** 已授权请求提交 data root 或已授予 capability 之外的路径
- **THEN** service MUST返回 typed permission error
- **THEN** error response MUST NOT回显允许范围之外的完整绝对路径
