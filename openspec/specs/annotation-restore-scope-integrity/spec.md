# annotation-restore-scope-integrity Specification

## Purpose
TBD - created by archiving change fix-annotation-restore-startup-and-scope. Update Purpose after archive.
## Requirements
### Requirement: Startup restore MUST preserve reader inputs needed by annotation restore
系统在正常页面启动和 session restore 流程中 MUST 保留 annotation restore 所依赖的 reader 输入，包括 transcript、marks 和其他 restoreSession 读取的基础内容。系统 MUST NOT 在 restore 之前无条件清空这些持久化输入。

#### Scenario: Normal startup does not wipe transcript before restore
- **WHEN** 用户正常刷新页面或重新打开页面
- **THEN** 系统 MUST NOT 在 `restoreSession()` 执行前无条件清空 transcript、marks 或等价 reader 内容
- **AND** `restoreSession()` MUST 仍然能够读取上次保存的 transcript 作为 annotation restore 输入

### Requirement: Manual transcript import and later restore MUST use the same document scope
系统在手动导入 transcript 后 MUST 立即建立与刷新恢复路径一致的 `documentId` / scope 语义。后续 annotation 保存和刷新恢复 MUST 基于同一篇文章的同一 scope，而不是导入时用旧 `currentDocId`、刷新时再切到新的 derived doc id。

#### Scenario: Generated save scope matches later restore scope
- **WHEN** 用户手动导入 transcript，并在当前会话里生成和保存 annotation
- **THEN** 本次保存使用的 `audioKey` + `documentId` scope MUST 与刷新后 restore 使用的 scope 一致
- **AND** 刷新后系统 MUST 能用该 scope 重新读取之前保存的 generated bundle

### Requirement: Restore fix MUST NOT change merge replacement strategy
这次 restore 修复 MUST 仅限于 startup restore 输入保留和 document scope 一致性。系统 MUST NOT 借这次修复顺手改变 `appendGeneratedItems()` 的 add-only merge 语义，也 MUST NOT 引入 replace/repair。

#### Scenario: Restore fix leaves merge semantics unchanged
- **WHEN** 系统实施本 change 的修复
- **THEN** 增量 merge 仍然 MUST 保持现有 add-only 语义
- **AND** replace/repair 策略 MUST 留给后续独立 change 处理

