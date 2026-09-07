## ADDED Requirements

### Requirement: 每个实现任务必须有独立 review
实施计划 SHALL 为每个 `E-*` 实现任务定义一个独立 `R-*` review 任务；review MUST 在新对话中只读执行，并 MUST 使用固定 phase base 与 task HEAD 审核准确 diff。

#### Scenario: 实现任务报告完成
- **WHEN** 执行对话完成一个 `E-*` 任务
- **THEN** 对应 `R-*` MUST 检查范围、验收项、focused tests、相邻回归和未授权修改
- **THEN** 未取得 `PASS` 的实现 MUST NOT进入阶段集成

#### Scenario: review 失败
- **WHEN** reviewer 发现会造成启动失败、功能回归、错误数据、双 writer、跨机不可用、媒体失败或无法回滚的 P0-P2 问题
- **THEN** 修复 MUST 由新的 `F-*` 对话完成
- **THEN** 修复后 MUST 再次独立 review

### Requirement: 并行任务必须使用同一阶段基点且避免热点文件冲突
每个并行批次 SHALL 从同一个已集成 `PHASE_BASE` 创建；会修改同一热点文件或同一 owner seam 的任务 MUST 串行，阶段集成后 MUST 重新建立下一阶段基点。

#### Scenario: 两个候选任务修改同一热点文件
- **WHEN** 两个任务都需要修改 `App.vue`、`YouTubeWorkflowPanel.vue`、`src/main.js`、owner API client、production Host、request policy、launcher 或 contract
- **THEN** 两个任务 MUST NOT并行执行
- **THEN** 后一个任务 MUST 基于前一个已 review 且已集成的 commit

### Requirement: 开发迁移必须与真实数据接管分离
P0-P8 SHALL 只使用优化工作区、优化 profile 和 `E:\ReadWebData\SubtitleWorkflow-Optimization`；日常真实数据在只读盘点、dry-run 和用户明确批准之前 MUST NOT被写入、迁移或切换 writer。

#### Scenario: 优化实例尚未完成跨机闭环
- **WHEN** 任一阶段 gate 未通过
- **THEN** 任务 MUST NOT访问日常真实数据执行 mutation
- **THEN** 日常 reader 和受保护工作树 MUST 保持不变

### Requirement: 正式接管必须可验证和可回滚
真实数据接管 SHALL 依次执行只读盘点、backup、dry-run、独立 review、用户批准、migration、Mac 用户路径验收、Windows restart 验收和 rollback rehearsal；任何失败 MUST 保留迁移前数据与旧入口。

#### Scenario: dry-run 发现未知或冲突记录
- **WHEN** 真实数据 dry-run 无法确定记录语义或发现较新 revision
- **THEN** 正式 migration MUST停止
- **THEN** 报告 MUST 保留足够信息供用户决定 keep、migrate 或隔离

#### Scenario: 新 release 未通过最终用户路径
- **WHEN** Mac 无法完成素材打开、播放、marks、annotation、preview 或 SRS 持久化
- **THEN** 日常入口 MUST继续或恢复到上一可用 release
- **THEN** 迁移前 backup MUST保持可验证且不得被覆盖
