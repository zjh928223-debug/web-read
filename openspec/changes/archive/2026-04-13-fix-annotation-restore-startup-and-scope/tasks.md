## 1. Startup Restore Guard

- [x] 1.1 审查 `clearPersistedReaderContentOnStartup()` 与 `clearDBStore()` 的调用关系，确认正常启动路径上最小可移除或可收敛的清空点
- [x] 1.2 调整 startup restore 流程，避免在默认页面启动时无条件清空 IndexedDB 中的 transcript / marks / reader 内容
- [x] 1.3 保留现有显式清理能力与 diagnostics，确保这次修复只改变正常 restore 路径

## 2. Transcript Import Scope Sync

- [x] 2.1 审查手动导入 transcript 后 `processTranscript()`、`currentDocId`、`switchSentenceNotesDoc(transcriptData)` 的接线关系
- [x] 2.2 在手动导入 transcript 的路径上同步更新 `currentDocId`，复用与 restore 相同的 document scope 语义
- [x] 2.3 确认生成保存、增量保存、刷新恢复三条路径都复用同一个 `audioKey + documentId` scope

## 3. Restore And Diagnostics Verification

- [x] 3.1 保留并补足 restore diagnostics，确保能直接观察 save scope、restore scope、generated index refresh 与 transcript restore 结果
- [x] 3.2 验证刷新后 transcript 仍能恢复，不再出现 `words = 0`、页面回到 `unconfigured` 的退化现象
- [x] 3.3 验证同一篇文章刷新前保存过的 generated bundle 刷新后仍能按同一 scope 被 load 和 index
- [x] 3.4 验证刷新后的 annotation 状态尽可能恢复到刷新前，而不是明显更少
- [x] 3.5 验证这次改动没有触碰 `appendGeneratedItems()` 的 add-only merge 语义，并运行相关 `node --check` / 页面复测
