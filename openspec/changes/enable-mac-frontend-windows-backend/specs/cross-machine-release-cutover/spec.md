## ADDED Requirements

### Requirement: Optimization 跨机实现必须按完整用户旅程验收
剩余开发 SHALL 以一个 implementation task 和一个 independent read-only review 完成 optimization 环境验收，而不是按接口、数据域或文件建立独立迁移阶段。review MUST 只依据既定个人用户旅程和真实 P0-P2 产品、数据、环境隔离或回归风险判定 PASS/FAIL。

#### Scenario: Optimization 实现报告完成
- **WHEN** Mac 能通过 Windows private-LAN 入口完成 Reader、媒体、marks，以及 URL 提交、Windows 下载/处理、基本状态和结果打开的 workflow 主路径
- **THEN** 一个新的只读 review MUST 以实现任务的实机结果、代码和测试为主要证据，只复跑低成本检查、可疑路径或证据缺口
- **THEN** Preview、Annotation、Vocabulary 和 SRS 的已记录问题 MUST NOT默认阻塞迁移
- **THEN** review MUST NOT因为扫描、设备指纹、多用户、HA、rate limit、企业认证、压力测试或理论威胁缺失而判定失败

#### Scenario: Optimization review 发现真实问题
- **WHEN** reviewer 发现既定范围内的 P0-P2 问题
- **THEN** 系统 MAY 执行一次范围明确的 fresh fix task 和一次 fresh re-review
- **THEN** 第二次 review 仍失败时 MUST 停止并由用户决定，不得自动扩大修复循环

### Requirement: 真实数据切换必须等待明确授权
在 optimization 用户旅程 PASS 前，系统 MUST NOT读取或写入日常真实数据。真实数据切换 MUST 在用户明确授权后先确认必用数据实际存放位置、暂停旧入口写入，并 MUST 在切换前创建普通可恢复备份、保留原数据和旧配置。必要迁移 SHOULD 复用现有导出/导入能力，不得默认建设新迁移平台。

#### Scenario: 尚未取得真实数据授权
- **WHEN** optimization 已通过但用户尚未明确批准真实数据操作
- **THEN** 日常数据根、日常入口和受保护工作树 MUST 保持不变
- **THEN** 调度器 MUST NOT创建或启动真实数据切换任务

#### Scenario: 真实数据不兼容或切换失败
- **WHEN** 执行中发现未知格式、无法安全读取的数据或核心 Mac 用户路径失败
- **THEN** 切换 MUST 停止且不得猜测迁移
- **THEN** 原数据、备份和旧配置 MUST 保留，不得执行破坏性清理

#### Scenario: Optimization 已验证的耗时流程没有相关变化
- **WHEN** 真实数据切换未改变 workflow、下载、转录或 AI 处理代码
- **THEN** 最终验收 MUST 复用 optimization 的有效结果
- **THEN** review MUST NOT无理由重复这些耗时流程
