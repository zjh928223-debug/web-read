## ADDED Requirements

### Requirement: remote mode 必须按域切换唯一 canonical writer
Reader Session、marks/activity、Passage Preview、Annotation、Vocabulary/SRS 与 Workflow SHALL 分别经过远程只读、远程 command、旧 writer 阻断和 authority checkpoint；任一时刻每个域 MUST 只有一个 canonical writer。

#### Scenario: 域尚未通过 authority checkpoint
- **WHEN** remote adapter 已可查询但该域 checkpoint 尚未提交
- **THEN** 系统 MUST 保持当前已声明 writer 的权威性
- **THEN** 系统 MUST NOT 同时让浏览器和 Windows Host 接受 canonical mutation

#### Scenario: 域完成 authority checkpoint
- **WHEN** 远程 read、command、receipt、restart 与 rollback 验收全部通过
- **THEN** Windows owner MUST 成为该域唯一 canonical writer
- **THEN** remote mode 的 legacy browser writer MUST 被阻断或降为只读 migration adapter

### Requirement: marks-activity 必须是 marks 的唯一写入 owner
`marks-activity` SHALL 独占 marks mutation、revision、latest-wins ledger 与 receipt；Reader Session MAY 返回 `marksRevision` 或只读 marks projection，但 Reader Session commit MUST NOT 写入或覆盖 canonical marks。

#### Scenario: Reader Session 与 marks projection 不一致
- **WHEN** Reader Session projection 与 `marks-activity` 当前 revision 不一致
- **THEN** UI MUST 采用 `marks-activity` 的 authoritative result
- **THEN** 系统 MUST NOT 通过 Reader Session commit 回写旧 projection

### Requirement: Mac 只能保留非权威临时状态
remote mode 下 Mac SHALL 只保留 view state、UI 偏好、可丢弃缓存和未确认 intent；IndexedDB、localStorage、audio-folder 或 outbox MUST NOT 成为 Windows owner 之外的 canonical persistence。

#### Scenario: Windows Host 暂时不可用
- **WHEN** Mac 无法连接 Windows owner
- **THEN** UI MUST 显示不可用或可重试状态并保留当前内存 intent
- **THEN** 系统 MUST NOT 静默切换为 Mac canonical writer

### Requirement: 写入结果必须以 owner receipt 和 revision 为准
每个 remote mutation SHALL 使用现有 expected revision、idempotency key 和 receipt 语义；transport 成功 MUST NOT 被视为 durability 成功，`commit-unknown` MUST 使用原 operation identity 查询结果。

#### Scenario: command response 在 commit 后丢失
- **WHEN** Mac 因网络中断无法判断 command 是否已提交
- **THEN** 重试 MUST 使用原 idempotency key 或 receipt query
- **THEN** 系统 MUST NOT 以新 operation identity 重复产生副作用

### Requirement: 学习域必须按可独立验收的顺序迁移
迁移 SHALL 按 Reader Session、marks/activity、Workflow 闭环、Passage Preview/Annotation、Vocabulary/SRS 的顺序推进；Passage Preview 与 Annotation MAY 在文件不重叠时并行，但每个 lane MUST 独立 review 后才能集成。

#### Scenario: 前一阶段未通过 review
- **WHEN** 当前阶段存在未解决 P0-P2 finding 或阶段 gate 未通过
- **THEN** 后续依赖阶段 MUST NOT开始 authority cutover
- **THEN** 已通过阶段 MUST 保持可运行和可回滚
