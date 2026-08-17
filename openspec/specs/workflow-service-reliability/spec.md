# workflow-service-reliability Specification

## Purpose
TBD - created by archiving change stabilize-and-simplify-read-web. Update Purpose after archive.
## Requirements
### Requirement: Workflow 状态分发必须避免 N+1 与重叠轮询
workflow service SHALL 提供包含 job summary、active revisions、queue 和 service capability 的 batch snapshot 或异步 event stream；客户端 polling fallback MUST single-flight、visibility-aware、可取消，并使用 revision 拒绝陈旧响应。

#### Scenario: 面板同时展示多个 job
- **WHEN** Material Workflow 面板刷新队列和多个 active job
- **THEN** 客户端 MUST 使用一个 batch request 或一个共享 event stream 获取本轮变化
- **THEN** 客户端 MUST NOT 为每个 job 每秒分别发出详情请求

#### Scenario: 上一轮 polling 尚未完成
- **WHEN** polling interval 到达但同一 resource 的请求仍在进行
- **THEN** RequestSupervisor MUST 跳过或合并本轮请求
- **THEN** 同一 resource 的在途 polling request 数 MUST 保持为一

#### Scenario: 页面隐藏或面板卸载
- **WHEN** document 变为 hidden 或 Material Workflow 面板被卸载
- **THEN** 客户端 MUST 暂停高频 polling 或降至配置的 background cadence，并取消不再需要的请求
- **THEN** 恢复可见后 MUST 先获取一个最新 snapshot 再恢复增量更新

#### Scenario: 陈旧 snapshot 晚到
- **WHEN** revision 较小的响应晚于较新的状态到达
- **THEN** 客户端 MUST 丢弃陈旧响应
- **THEN** UI MUST NOT 从 terminal 或较新 stage 回退到旧 stage

### Requirement: Job snapshot 与 event log 必须分离持久化
workflow service SHALL 将当前 job snapshot 与诊断 event log 分离；event MUST 使用有界 ring buffer 或 append/batch storage，snapshot MUST 只在状态、stage、queue、checkpoint 或 debounce 后的 durable field 变化时持久化。

#### Scenario: 子进程产生高频输出
- **WHEN** runner 连续输出多行日志但 job durable state 未变化
- **THEN** service MUST 批量或 append 事件而不是每行重写全部 `jobs.json`
- **THEN** 单个 job 的 event retention MUST 受数量或大小上限约束

#### Scenario: durable 状态变化
- **WHEN** job 进入新 stage、保存 checkpoint、改变 queue position 或完成
- **THEN** service MUST 在 bounded flush deadline 内原子提交最新 snapshot
- **THEN** API 只有在 durable commit 成功后才能将该 revision 宣告为已持久化

#### Scenario: 服务在写入中被终止
- **WHEN** snapshot 或 event batch 写入期间发生进程中断
- **THEN** 重启后 repository MUST 读取完整的新版本或上一完整版本
- **THEN** 临时或损坏文件 MUST 被隔离并产生可见 recovery diagnostic，不能静默返回空 job 集合

### Requirement: Queue 与 job 状态转换必须原子且幂等
workflow service SHALL 为 queued、running、canceling、canceled、failed 和 completed 等状态定义合法 transition，并在锁或 transaction boundary 内同时更新 queue、record revision 和 checkpoint；重复 mutation request MUST 通过 idempotency key 或预期 revision 避免重复副作用。

#### Scenario: 重复提交启动请求
- **WHEN** 客户端因超时以同一 idempotency key 重试创建或 retry 操作
- **THEN** service MUST 返回同一 logical job 或原结果
- **THEN** service MUST NOT 再次入队或启动第二个 runner

#### Scenario: 并发修改同一 job
- **WHEN** cancel、retry 或 move-next 针对同一 expected revision 并发到达
- **THEN** 只有一个合法 transition MAY 提交
- **THEN** 其他请求 MUST 返回 typed conflict 和当前 revision

#### Scenario: 服务重启恢复队列
- **WHEN** service 从 durable snapshot 恢复 queued 或曾经 running 的 job
- **THEN** service MUST 依据明确 recovery policy 重排队或标记 interrupted
- **THEN** service MUST NOT 在没有 lease/identity 验证时假定旧子进程仍正常运行

### Requirement: 子进程必须由 ProcessSupervisor 唯一管理
所有 yt-dlp、WhisperX、ffmpeg、PowerShell picker 和其他外部命令 SHALL 通过 ProcessSupervisor 启动；supervisor MUST 记录 job、stage、PID、start identity、process group、deadline 和取消状态，并通过 `try/finally` 释放句柄。

#### Scenario: job 被取消
- **WHEN** 用户取消正在运行外部命令的 job
- **THEN** supervisor MUST 先向匹配 identity 的 process group 发送 graceful termination
- **THEN** 超过 termination deadline 后 MUST 仅对仍匹配的 process tree 执行强制终止
- **THEN** job MUST 在清理临时资源后进入 canceled 或 cleanup-failed 状态

#### Scenario: 外部命令卡住
- **WHEN** 命令超过其 stage deadline 且没有有效 heartbeat
- **THEN** supervisor MUST 终止匹配的 process tree 并返回 typed timeout error
- **THEN** queue worker MUST 被释放以继续处理后续 job

#### Scenario: service 异常重启
- **WHEN** startup recovery 发现 snapshot 中残留的 PID
- **THEN** supervisor MUST 先验证 PID start identity、command identity 与本实例 lease
- **THEN** 不匹配的进程 MUST NOT 被终止

### Requirement: AI 操作必须作为可取消后台 job 执行
可能超过普通 HTTP deadline 的 AI segmentation、translation 或 enrichment SHALL 创建或关联 background job，并立即返回 `202`、job id、revision 和 status URL；AI attempt MUST 有总 deadline、可取消、有限 retry 与 jitter，并保留 checkpoint。

#### Scenario: 启动 AI 操作
- **WHEN** 客户端提交有效的 AI 请求
- **THEN** API MUST 在短请求预算内返回 `202` 和可查询 job identity
- **THEN** 客户端 MUST 能显示 queued/running/progress 状态而不保持一个无限同步请求

#### Scenario: AI upstream 暂时限流
- **WHEN** upstream 返回可重试的 rate-limit 或 transient error
- **THEN** worker MUST 按有界 retry policy 和 jitter 重新预约 attempt
- **THEN** retry 等待 MUST 可取消且不得占用全局 rate limiter lock

#### Scenario: AI 达到 deadline 或永久失败
- **WHEN** 总 deadline 到达或错误被分类为不可重试
- **THEN** job MUST 进入 typed failed 状态并保存已完成 checkpoint 和 correlationId
- **THEN** UI MUST 提供从安全 checkpoint retry 或取消的操作，不能只显示按钮无响应

### Requirement: Rate limiter 不得在共享锁内等待
AI、TTS 和其他受限资源 SHALL 通过预约或令牌分配实现限流；共享锁 MUST 只保护计数与下一可用时间的计算，MUST NOT 在 sleep、network request 或 subprocess wait 期间持有。

#### Scenario: 多个 job 同时申请配额
- **WHEN** 多个 worker 并发请求同一 provider 的 slot
- **THEN** limiter MUST 在锁内为每个请求分配明确的 reservation 或 rejection
- **THEN** worker MUST 在释放锁后等待自己的预约时间

#### Scenario: 等待配额的 job 被取消
- **WHEN** job 在 reservation 到期前取消
- **THEN** 等待 MUST 立即结束
- **THEN** 取消 MUST NOT 阻塞其他 job 获取或使用配额

### Requirement: NativePicker 必须具有唯一稳定 owner
file picker 与 folder picker SHALL 由单一 NativePicker owner 串行管理，返回 `selected`、`canceled` 或 typed `error`；系统 SHOULD 优先使用受支持的浏览器 picker，否则通过 ProcessSupervisor 运行本地 picker，并 MUST 设置 owner window、timeout 和 cleanup。

#### Scenario: 用户取消 picker
- **WHEN** 用户关闭 picker 或选择取消
- **THEN** API MUST 返回 `canceled` 而不是空成功或 internal error
- **THEN** UI MUST 恢复触发按钮、焦点和上一个有效选择

#### Scenario: 重复点击选择按钮
- **WHEN** 一个 picker 尚未完成时用户再次触发 file 或 folder picker
- **THEN** NativePicker MUST 聚焦既有 picker 或返回 operation-in-progress
- **THEN** 系统 MUST NOT 创建多个相互争夺焦点的 dialog 或 PowerShell 进程

#### Scenario: picker 失去响应
- **WHEN** fallback picker 超过 configured deadline
- **THEN** ProcessSupervisor MUST 终止其匹配的进程并释放 exclusive owner
- **THEN** UI MUST 收到可重试 timeout error 且焦点返回触发元素

### Requirement: Workflow 高权限接口必须继承 Local App Host 授权边界
workflow service SHALL 将 job mutation、任意本地路径 scan/import、native picker、凭据使用和外部进程启动视为高权限操作，并验证 loopback binding、Host、Origin、instance token 与请求参数允许范围。

#### Scenario: 未授权请求启动 workflow
- **WHEN** 非受信 Origin、缺失 token 或错误 runtime instance 的请求调用高权限 endpoint
- **THEN** service MUST 在读取路径、访问凭据或启动进程之前返回 unauthorized
- **THEN** job、queue 和 filesystem MUST 保持不变

#### Scenario: 授权请求包含越界路径
- **WHEN** 已授权请求提交 data root 或已授予 capability 之外的路径
- **THEN** service MUST 返回 typed permission error
- **THEN** error response MUST NOT 回显允许范围之外的完整绝对路径

### Requirement: Workflow 必须提供相关联且有界的诊断
每个 request、job、stage、AI attempt 和外部 process SHALL 共享或链接 correlationId；诊断 MUST 包含 duration、revision、result category 和资源 identity，同时对 token、API key、cookie、prompt 敏感内容和个人路径脱敏，并实施 retention limit。

#### Scenario: 用户报告按钮没有反应
- **WHEN** mutation request 超时、失败或被 conflict 拒绝
- **THEN** UI MUST 显示 correlationId、可重试语义和当前 authoritative status
- **THEN** service diagnostic MUST 能以该 correlationId 关联 HTTP、queue、job、AI 或 process 阶段

#### Scenario: 日志达到保留上限
- **WHEN** event 或 diagnostic storage 达到配置的数量、大小或时间上限
- **THEN** repository MUST 按确定性策略删除或压缩最旧的非关键记录
- **THEN** 当前 job snapshot、terminal summary 和最近失败证据 MUST 保持可用

