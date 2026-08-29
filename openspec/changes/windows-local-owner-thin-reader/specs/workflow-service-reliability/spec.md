## MODIFIED Requirements

### Requirement: Queue 与 job 状态转换必须在 owner boundary 内原子且幂等

workflow service SHALL 为 queued、running、canceling、canceled、failed 和 completed 等状态定义合法 transition，并在 Windows owner 授权的 repository boundary 内同时更新 job snapshot、状态 revision 和必要 checkpoint。workflow snapshot/history/event 的最终 canonical record MUST 位于 Host-managed repository。重复 mutation MUST 使用 idempotency key 或 expected revision 避免重复副作用；只有取得 durable commit receipt 后，workflow API 才能向 browser 宣告新的 authoritative revision。

#### Scenario: 重复提交启动或 retry

- **WHEN** 客户端因超时以同一 idempotency key 重试创建、启动或 retry 操作
- **THEN** service MUST 返回同一 logical job 或原 receipt
- **THEN** service MUST NOT 再次入队或启动第二个 runner

#### Scenario: expected revision 已过期

- **WHEN** cancel、retry 或 move-next 使用旧 expected revision
- **THEN** service MUST 返回 typed conflict 和当前 revision
- **THEN** job snapshot、queue 和已提交状态 MUST 保持不变

#### Scenario: workflow service 重启

- **WHEN** service 从 durable snapshot 恢复 queued 或 interrupted job
- **THEN** service MUST 按明确的本地 recovery policy 重排队或标记 interrupted
- **THEN** browser MUST 通过 owner query/receipt 读取结果，不得直接修改本地 canonical copy

### Requirement: Workflow 高权限接口必须继承 Local App Host loopback boundary

workflow service SHALL 将 job mutation、受限本地路径 scan/import、native picker、凭据使用、外部进程启动和 workflow query 视为 owner 管理的操作，并验证 loopback binding、Host、Origin、instance token、profile capability、expected revision/idempotency key 与参数允许范围。workflow service MUST NOT 提供绕过 owner registry 的 browser durable writer；完整媒体仍只允许 identity/reference metadata。

#### Scenario: 未授权或越界请求

- **WHEN** 非受信 Origin、缺失 token、错误 runtime instance 或越界 path/capability 的请求调用高权限 endpoint
- **THEN** service MUST 在读取路径、访问凭据、读取 durable snapshot 或启动进程之前返回 typed unauthorized/permission result
- **THEN** job、queue、filesystem 和 domain revision MUST 保持不变，错误不得回显完整受保护路径

#### Scenario: browser 绕过 owner facade

- **WHEN** browser 直接提交 jobs/history/reader-index/config JSON 或调用未注册 mutation route
- **THEN** host/service MUST 拒绝该操作
- **THEN** workflow owner MUST 保持当前 revision、queue 和 snapshot 不变
