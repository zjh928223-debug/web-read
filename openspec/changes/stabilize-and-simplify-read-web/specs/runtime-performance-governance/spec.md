## ADDED Requirements

### Requirement: 关键用户旅程必须有可重复性能基线
系统 SHALL 在 production build 与隔离固定 fixture 下测量冷启动、打开材料、播放/seek、连续单词/语块交互、Material Workflow、Passage Preview 和 SRS Review，并记录 p50、p95、max、请求数、错误数、Long Task 与峰值资源用量。

#### Scenario: 生成可比较基线
- **WHEN** performance harness 对同一 fixture 完成规定轮次
- **THEN** 系统 MUST 输出包含环境、git SHA、配置、每轮原始值和聚合统计的 machine-readable artifact
- **THEN** artifact MUST 能与旧版或上一 baseline 自动差分

### Requirement: 用户动作必须及时反馈
系统 SHALL 让 click/keypress 在 P95 100ms 内产生可见反馈；预计超过 100ms 的操作 MUST 显示 pending、progress 或 queued 状态，并禁止重复提交。

#### Scenario: 远端操作开始
- **WHEN** 用户触发下载、AI、扫描或其他不可预测时长操作
- **THEN** UI MUST 在 100ms 内显示阶段状态和可取消或可重试语义

### Requirement: 性能退化必须阻断发布
系统 SHALL 为 startup、interaction、playback、local API、large media 与 Long Task 设置版本化 budget；初始 budget MUST 来源于实测 baseline，之后只能通过有证据的变更调整。

#### Scenario: 发布候选超过预算
- **WHEN** release journey 的 p95、错误率或 Long Task 超过当前 budget
- **THEN** `verify:release` MUST 失败并保存 trace、截图和 JSON 证据

### Requirement: 浏览器错误与网络失败必须统一采集
系统 SHALL 在 journey 中采集 console error、pageerror、unhandled rejection、requestfailed、HTTP 4xx/5xx、Long Task 和重复请求。

#### Scenario: 交互触发静默请求失败
- **WHEN** 页面请求失败但组件没有抛出可见异常
- **THEN** journey MUST 仍记录 operation、URL、status/error 与 correlationId 并按门槛失败

### Requirement: 测试类型必须明确分层
系统 SHALL 将 source-shape architecture guards、module behavior、browser journeys、performance 和 release verification 使用不同命名与入口；默认 test 结果 MUST NOT 被描述为完整性能或发布验收。

#### Scenario: 执行快速门禁
- **WHEN** 开发者运行 `verify:fast`
- **THEN** 输出 MUST 明确列出已执行和未执行的层级
- **THEN** `verify:full` 与 `verify:release` MUST 有独立可调用入口

