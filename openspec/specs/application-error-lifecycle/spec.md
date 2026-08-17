# application-error-lifecycle Specification

## Purpose
TBD - created by archiving change stabilize-and-simplify-read-web. Update Purpose after archive.
## Requirements
### Requirement: 统一的 typed error 契约
系统 MUST 将跨 Module seam 传播的失败表示为稳定的 typed error，并至少包含 `code`、`category`、`message`、`retryable`、`operationId` 和安全的 `details`。`category` MUST 能区分 validation、configuration、network、timeout、canceled、conflict、storage、external-tool、permission 与 internal；未知异常 MUST 在 seam 处转换为 `internal`，不得把原始堆栈、credential、cookie、代理认证信息或本机敏感路径暴露给 UI。

#### Scenario: 未知异常被安全归一化
- **WHEN** 底层 Adapter 抛出不符合 typed error 契约的异常
- **THEN** 调用 seam MUST 返回 category 为 `internal` 的 typed error、保留可关联的 `operationId`，并在用户可见内容中移除敏感字段

#### Scenario: 可重试错误保留机器可判定语义
- **WHEN** 外部请求因暂时性网络故障或超时失败
- **THEN** typed error MUST 使用稳定的 `code` 与正确的 `retryable` 值，使 UI 无需解析错误文案即可决定是否显示重试动作

### Requirement: 异步动作必须提供及时且一致的用户反馈
所有可能超过 100ms 的用户触发异步动作 MUST 在 100ms 内显示 pending、queued 或 processing 状态，并在成功、失败、取消或超时后进入明确的终态。系统 MUST 禁止空 `catch`、仅写 console 或返回空值来把失败伪装成“无结果”或“按钮没反应”。

#### Scenario: 慢操作立即显示进行中状态
- **WHEN** 用户启动素材导入、AI 处理、翻译、保存或 Reader Session 加载且操作在 100ms 内未完成
- **THEN** 触发控件或关联状态区域 MUST 在 100ms 内显示可感知的进行中反馈，并说明当前动作

#### Scenario: 失败不会被伪装成空结果
- **WHEN** 后端、存储或外部工具返回失败
- **THEN** UI MUST 展示对应 typed error 的可理解摘要和可执行下一步，且不得把失败渲染成空列表、成功 toast 或静默无变化

#### Scenario: 取消与失败使用不同终态
- **WHEN** 用户主动取消仍在运行的操作
- **THEN** UI MUST 显示 canceled 终态且不得显示 failure toast、自动重试或提交部分结果

### Requirement: Request Scope 统一拥有取消、超时与陈旧结果抑制
每个路由、面板、Reader Session 或长时用户动作 MUST 创建有唯一 owner 的 Request Scope。该 scope MUST 统一拥有 `AbortSignal`、超时策略、single-flight key 和 `operationId`；scope 结束后，未完成请求 MUST 被取消，迟到结果 MUST 不得提交状态、写入存储或覆盖更新版本的数据。

#### Scenario: 关闭面板取消所属请求
- **WHEN** 用户关闭一个仍有 HTTP、AI 或轮询请求的面板
- **THEN** 面板的 Request Scope MUST 取消全部所属请求，并阻止请求完成后重新打开面板、显示 toast 或写入面板状态

#### Scenario: 新请求淘汰同一资源的旧请求
- **WHEN** 同一 single-flight key 在旧请求未完成时发起更新请求
- **THEN** 系统 MUST 复用旧请求或明确取消旧请求，并且只有当前 `operationId` 的结果可以提交

#### Scenario: 超时释放占用状态
- **WHEN** 请求超过该操作声明的超时时间
- **THEN** Request Scope MUST 中止底层工作、返回 category 为 `timeout` 的 typed error，并释放 busy、锁和重复动作保护状态

### Requirement: Disposable Scope 管理全部生命周期资源
所有注册 event listener、timer、`requestAnimationFrame`、observer、watcher、object URL、媒体引用、轮询器或全局 facade 的 Module MUST 将 disposer 注册到其 owner 的 Disposable Scope。销毁 MUST 幂等；重复 mount/unmount 后不得残留 listener、后台循环、引用或重复副作用。

#### Scenario: 页面卸载释放全部资源
- **WHEN** Vue 页面、面板或 Reader Session 被卸载或替换
- **THEN** 其 Disposable Scope MUST 停止 timer、animation frame、observer 与轮询，移除 listener，并释放 object URL 和媒体引用

#### Scenario: disposer 可重复执行
- **WHEN** cleanup 因取消、路由切换和应用关闭被调用多次
- **THEN** disposer MUST 每次安全返回，不得重复删除仍由新 scope 拥有的资源或抛出二次清理异常

### Requirement: 初始化必须幂等并具有唯一 owner
每个 runtime Module、Pinia binding、DOM binding、全局错误处理器和后台循环 MUST 具有唯一初始化 owner，并提供可验证的 initialize/dispose 生命周期。系统 MUST 阻止同一 owner 重复注册；不得以 dataset flag、隐式全局变量或脚本加载顺序作为唯一的防重复机制。

#### Scenario: 重复初始化不会重复绑定
- **WHEN** 开发热更新、路由返回或兼容启动链再次调用同一 Module 的 initialize
- **THEN** 系统 MUST 返回已有实例或先完整 dispose 旧实例，且一次用户动作只触发一次处理

#### Scenario: 初始化失败可安全重试
- **WHEN** Module 初始化在部分资源已注册后失败
- **THEN** 系统 MUST 回滚本次已注册资源并返回 typed error，使后续重试从未初始化状态开始

### Requirement: Dialog 与 native picker 满足可访问焦点生命周期
所有 dialog MUST 具有可识别名称、正确的 dialog 语义、初始焦点、键盘焦点圈定和 Escape/关闭行为。打开 native file/folder picker 前 MUST 记录触发元素；picker 成功、取消、超时或窗口重新激活后 MUST 恢复至仍可用的触发元素或明确的安全 fallback，且不得因 blur/visibility 竞态提前结束操作。

#### Scenario: 键盘用户完整操作 dialog
- **WHEN** 用户仅使用键盘打开应用内 dialog
- **THEN** 焦点 MUST 进入 dialog，Tab/Shift+Tab MUST 留在 dialog 内，Escape MUST 按设计关闭，并在关闭后返回原触发控件

#### Scenario: 取消 native picker 后恢复焦点
- **WHEN** 用户打开 native picker 后取消选择
- **THEN** 系统 MUST 返回 canceled 结果、清除 busy 状态并把焦点恢复到仍存在的触发控件，且不得显示失败提示

#### Scenario: picker 失焦不会被误判为取消
- **WHEN** native picker 导致浏览器窗口 blur 或 visibility 改变但 picker 尚未返回
- **THEN** 应用 MUST 保持操作 pending，直到 Adapter 返回选择、取消或明确超时

### Requirement: 重复提交保护不得破坏可恢复性
会产生写入、外部费用、任务创建、删除或迁移的异步动作 MUST 使用 single-flight 或幂等 command key 防止重复提交。控件禁用 MUST 与真实操作生命周期绑定，并在成功、失败、取消和超时后恢复；高风险动作 MUST 在执行前显示目标和影响范围。

#### Scenario: 双击只创建一个任务
- **WHEN** 用户快速双击创建素材任务或 AI 操作按钮
- **THEN** 系统 MUST 只接受一个 command key，并让后续点击复用进行中状态或得到明确的 duplicate 结果

#### Scenario: 失败后允许安全重试
- **WHEN** 受保护动作以 retryable error 结束
- **THEN** 控件 MUST 退出 busy 状态并提供重试，重试 MUST 使用新的 attempt identity 且不得重复提交已成功的副作用

### Requirement: 错误诊断必须可关联且经过脱敏
前端与本地后端 MUST 使用 `operationId` 关联用户动作、请求、后台任务和终态，并记录 category、稳定 error code、耗时与受影响 Module。诊断记录 MUST 有数量或时间上限，且在写盘、导出和 UI 展示前统一脱敏；生产模式不得默认暴露堆栈、credential、cookie、Authorization、带认证代理 URL 或完整私人路径。

#### Scenario: 跨前后端关联一次失败
- **WHEN** 一个用户动作经过前端请求和本地后端任务后失败
- **THEN** 诊断输出 MUST 能用同一 `operationId` 找到各阶段状态，同时不包含任何 secret 值

#### Scenario: 日志达到上限
- **WHEN** 内存或磁盘诊断记录达到配置上限
- **THEN** 系统 MUST 按声明策略淘汰旧记录或轮转文件，不得无限增长或阻塞主要交互

### Requirement: 错误与生命周期行为必须支持故障注入验收
关键 Module MUST 能通过测试 Adapter 注入 timeout、network failure、storage failure、late response、duplicate initialize、取消竞态和 disposer 重入。测试 MUST 通过公开 Interface 断言用户终态、状态一致性和资源释放，而不得只检查源码字符串或私有实现形状。

#### Scenario: 迟到响应不污染新状态
- **WHEN** 测试 Adapter 让旧请求在新请求提交后才返回
- **THEN** 自动化测试 MUST 证明旧结果被丢弃、当前 UI 保持新结果且没有额外存储写入

#### Scenario: 生命周期回归无资源增长
- **WHEN** 自动化测试连续执行多次 mount、操作、取消与 unmount
- **THEN** listener、timer、observer、animation frame 和 object URL 的存活数量 MUST 回到基线

