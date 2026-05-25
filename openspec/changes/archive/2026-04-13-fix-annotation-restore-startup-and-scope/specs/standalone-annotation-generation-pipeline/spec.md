## ADDED Requirements

### Requirement: Generated bundle scope MUST remain stable across manual transcript import and later restore
annotation generation pipeline 在手动导入 transcript 后 MUST 立即建立与后续刷新恢复一致的 `audioKey + documentId` scope 语义。当前会话中的 generated bundle 保存与刷新后的 generated bundle 恢复 MUST 使用同一 scope，而不是在保存时继续沿用旧 `currentDocId`、恢复时再切换到新的 derived doc id。

#### Scenario: Save scope and restore scope stay aligned for the same article

- **WHEN** 用户手动导入 transcript，并在当前会话里生成或增量生成 annotation
- **THEN** pipeline 保存 generated bundle 时使用的 `audioKey + documentId` scope MUST 与刷新后 restore 使用的 scope 一致
- **AND** refresh 之后 generated bundle MUST 能按该 scope 被重新 load 和 index

### Requirement: Restore scope fix MUST NOT change add-only merge semantics
这次 restore scope 修复 MUST 只解决保存 scope 与恢复 scope 的一致性问题。system MUST NOT 借此修改 `appendGeneratedItems()` 的 add-only merge 语义，也 MUST NOT 引入 replace、repair 或批量替换旧 annotation 的行为。

#### Scenario: Merge strategy remains unchanged while restore scope is fixed

- **WHEN** system 实施本 change 的 restore / scope 修复
- **THEN** 增量生成的 merge 仍然 MUST 保持现有 add-only 行为
- **AND** 同一 `occurrenceKey` 的旧 item 处理策略 MUST 保持不变
