## Context

当前 annotation 刷新后恢复失败，已经通过 diagnostics 明确定位到两个根因。第一，启动阶段的 `clearPersistedReaderContentOnStartup()` 在正常页面启动时无条件调用 `clearDBStore()`，导致 IndexedDB 中的 transcript、marks 等 reader 内容在 `restoreSession()` 之前被清空，annotation restore 没有输入。第二，手动导入 transcript 时 `processTranscript()` 会重建 words 和 globalIndex，但不会同步刷新 `currentDocId`；而刷新后的恢复路径会通过 `switchSentenceNotesDoc(transcriptData)` 生成新的 derived doc id，导致生成保存与刷新恢复使用的 annotation scope 不一致。

这次 change 的目标是对 restore 链路做最小修复。范围必须控制在 startup 清空策略和 transcript import scope 同步，不进入 merge replace/repair，不重构 annotation controller、storage、planner 或 click resolver。

## Goals / Non-Goals

**Goals:**
- 停止在正常启动时无条件清空 IndexedDB reader 内容，确保 `restoreSession()` 能拿到 transcript、marks 和其他 restore 输入。
- 让手动导入 transcript 的路径与刷新恢复路径使用相同的 `currentDocId` / document scope 语义。
- 让生成保存和刷新恢复对同一篇文章使用同一 scope，从而能重新 load 和 index 之前保存的 generated bundle。
- 保留现有 diagnostics，继续输出 save scope、restore scope、generated index refresh 等关键证据，方便复测。

**Non-Goals:**
- 不修改 `appendGeneratedItems()` 的 add-only merge 语义。
- 不引入 replace/repair，不处理增量补齐策略。
- 不重构 annotation restore 架构，不改 bubble、resolver、planner、API settings UI 或 provider client 主逻辑。
- 不顺手做 annotation 系统级清理或大规模模块化。

## Decisions

### Decision 1: 启动时不再把“清理旧 reader 数据”作为默认 restore 前步骤

`clearPersistedReaderContentOnStartup()` 当前直接调用 `clearDBStore()`，它会清掉所有 IndexedDB 文件项。这个动作与“正常启动后要恢复上次会话”是直接冲突的。因此这次修复采用最小策略：保留这个函数作为显式清理入口的候选，但不在默认 startup restore 流程里调用会破坏 restore 输入的全量清空逻辑。

备选方案：
- 保留现状并尝试在清空后重新从别处恢复 transcript：不成立，因为 transcript 本身就是 restore 输入。
- 只对白名单 key 保留、其余清空：比这次所需更重，也容易带来新的遗漏。

### Decision 2: 在手动导入 transcript 的路径上立即同步 `currentDocId`

scope 不一致的根本原因不是 storage 模块，而是手动导入 transcript 后当前页面仍然停留在旧 `currentDocId`。最小修复应该靠近 transcript import seam：在 `processTranscript(json)` 之后或与之等价的导入路径上，立即用与恢复路径相同的规则更新 `currentDocId`。这样生成保存和刷新恢复会复用同一 document scope 语义。

备选方案：
- 改 storage key，兼容旧 scope 和新 scope 双读：会把简单 restore 修复扩成存储兼容策略，超范围。
- 在 annotation controller 内部回避 `currentDocId`：会让 scope 规则散落到业务层，不是最小修复。

### Decision 3: diagnostics 保留并补充验证，不作为这次 change 的主逻辑目标

上一轮 diagnostics 已经能暴露 `currentDocId` 与 `derivedDocId` 不一致、以及 restore 前输入为空的问题。这次修复保留这些 diagnostics，用它们作为验收依据，而不是删掉后再凭主观判断“应该好了”。

备选方案：
- 修完后移除 diagnostics：会让复测再次失去证据链，不利于确认问题是否真的只在 restore 层。

## Risks / Trade-offs

- [Risk] 停止 startup 清空后保留了更多旧 reader 状态，暴露出历史脏数据问题 → Mitigation：这次只修 restore 输入被错误清空的问题，不改变现有显式清理能力。
- [Risk] 在手动导入 transcript 路径上更新 `currentDocId` 可能影响 sentence notes 作用域 → Mitigation：复用现有 `switchSentenceNotesDoc` / `buildCurrentSentenceDocId` 语义，不发明第二套 doc id 规则。
- [Risk] 修复后 restore 能恢复 transcript，但 annotation 仍可能受 merge 或历史数据问题影响 → Mitigation：本 change 明确只解决 startup 清空和 scope 不一致；其余问题保持分离，不混修。
