## MODIFIED Requirements

### Requirement: Queue 与 job 状态转换必须原子且幂等
workflow service SHALL 为 queued、running、canceling、canceled、failed 和 completed 等状态定义合法 transition，并在 Windows owner 授权的锁或 transaction boundary 内同时更新 queue、record revision 和 checkpoint；workflow snapshot、history 和 checkpoint 的最终 canonical records MUST 位于 Windows Host-managed repository。重复 mutation request MUST 通过 idempotency key 或预期 revision 避免重复副作用。只有取得该 repository 的 durable commit receipt 后，workflow API 才能向 browser 宣告新的 authoritative job revision。

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

#### Scenario: browser 收到未确认的 job mutation
- **WHEN** job command 可能已经提交但 HTTP response 在 commit receipt 返回前丢失
- **THEN** workflow API MUST 返回或可查询 `commit-unknown` receipt 状态
- **THEN** browser MUST NOT 直接修改本地 job snapshot 或再次启动 runner 来“补偿”未知结果

### Requirement: Workflow 高权限接口必须继承 Local App Host 授权边界
workflow service SHALL 将 job mutation、任意本地路径 scan/import、native picker、凭据使用、外部进程启动和 workflow durable snapshot/query 视为受 owner 管理的高权限操作，并验证 loopback binding、Host、Origin、instance token、profile capability、expected revision/idempotency key 与请求参数允许范围。workflow service MUST NOT 提供绕过 Local App Host owner registry 的 browser durable writer。

#### Scenario: 未授权请求启动 workflow
- **WHEN** 非受信 Origin、缺失 token 或错误 runtime instance 的请求调用高权限 endpoint
- **THEN** service MUST 在读取路径、访问凭据、读取 durable snapshot 或启动进程之前返回 unauthorized
- **THEN** job、queue、filesystem 和 domain revision MUST 保持不变

#### Scenario: 授权请求包含越界路径
- **WHEN** 已授权请求提交 data root 或已授予 capability 之外的路径
- **THEN** service MUST 返回 typed permission error
- **THEN** error response MUST NOT 回显允许范围之外的完整绝对路径

#### Scenario: browser 试图绕过 owner facade 修改 workflow state
- **WHEN** browser 直接提交 jobs/history/reader-index/config JSON 或调用未注册的 workflow mutation route
- **THEN** host/service MUST 拒绝该操作并记录脱敏的 correlationId
- **THEN** workflow owner MUST 保持当前 revision、queue 和 snapshot 不变
