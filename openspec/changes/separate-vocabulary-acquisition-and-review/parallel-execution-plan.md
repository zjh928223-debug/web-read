# 并行执行手册

## 先说结论

这项改造不能把所有模块同时开工。安全方式是按 wave 并行：同一 wave 内任务互不修改共享入口文件；上游 wave 合并并通过验证后，下一 wave 才开始。推荐每个执行对话使用独立 branch/worktree，不要让多个对话直接写当前 dirty worktree。

并行任务总览：

| 任务 | 类型 | 可并行 | 前置依赖 | 主要交付 |
|---|---|---:|---|---|
| P0 契约与基线 | HITL | 否 | 无 | 快照、基线、字段契约 |
| P1 学习单位/repository | AFK | 是 | P0 | acquisition 数据闭环 |
| P2 语境证据/来源 | AFK | 是 | P0 | provenance 闭环 |
| P3 事件数据/导出 | AFK | 是 | P0 | append-only 事件闭环 |
| P4 Review policy/planner | AFK | 是 | P0 | 三模式与时间预算闭环 |
| P5 Legacy audit | AFK | 是 | P0 | 只读审计闭环 |
| P6 Acquisition/graduation | AFK | 否 | P1+P2+P3 | 原子毕业闭环 |
| P7 Review service V2 | AFK | 否 | P3+P4+P6 | 复习 session 闭环 |
| P8 考试词表导入 | HITL | 是 | P6 | 导入到毕业示例 |
| P9 Legacy reassessment | HITL | 是 | P5+P6+P4 | 小批迁移闭环 |
| P10 文章结算集成 | AFK | 否 | P6 | 旧入口迁移 |
| P11 复习 UI 集成 | HITL | 是 | P7 | 最小 UI 接入 |
| P12 统计报告 | AFK | 是 | P3+P7 | 可重建报告 |
| P13 参数优化 | HITL | 否 | P12+真实数据门槛 | 候选参数报告 |
| P14 清理与总验收 | HITL | 否 | 全部 | 兼容删除/迁移演练 |

## 分支与文件所有权规则

1. 每个对话从相同、干净的基线 commit 创建 `codex/vocab-<task>` branch 和独立 worktree。
2. P1–P5 只新增自己的模块和 focused verification，不修改：
   - `src/services/vocabulary/index.js`
   - `src/services/vocabulary/vocabulary-models.js`
   - `src/services/vocabulary/vocabulary-service.js`
   - `src/features/srs-review/useSrsReview.js`
   - `src/features/srs-review/SrsReviewPage.vue`
3. P6 是 acquisition 集成 owner；P7 是 review service owner；P10 是 vocabulary 共享入口 owner；P11 是 SRS UI owner。
4. 如果任务发现必须改动别人的 owner 文件，停止在该文件上的编辑，把所需接口写入 handoff，不自行越界。
5. 每个任务合并前必须先 rebase/merge 最新上游，运行自己的 focused verification；每个 wave 完成后统一运行 build 与 Vite verification。

## Wave 0：只运行一个对话

### P0 契约与基线

复制给执行模型：

> 你负责变更 `separate-vocabulary-acquisition-and-review` 的 P0 基线任务。先完整阅读 `proposal.md`、`design.md`、三个 specs 和 `tasks.md`，再检查当前 dirty worktree；不要实现业务功能。完成：1）设计一个只读导出当前 `vocabulary.srs.store.v1` 测试快照的方法并记录 hash；2）运行并记录现有 build/Vite/vocabulary/SRS verification 基线；3）补充字段契约与不变量；4）增加不会改 IndexedDB version/object store 的 guard 方案。不得覆盖用户未提交改动。输出基线报告、已知失败、后续任务可依赖的精确接口契约。

完成标准：P1–P5 能依据同一字段契约开工，且现有失败有清楚归属。

## Wave 1：五个对话可同时运行

### P1 学习单位与 repository

> 你只负责 P1：严格按 `p0-contracts.md` 实现 `LearningUnit`、`AcquisitionState`、`AcquisitionAttempt` 和 acquisition repository 的最小纵向闭环。阅读 OpenSpec 后，优先新增 `src/services/vocabulary/vocabulary-learning-models.js`、`vocabulary-acquisition-repository.js` 和对应 verification。必须提供 in-memory、IndexedDB repository 和接收 `VocabularyLearningTransactionRowPort` 的 binder；binder 不得接收完整 UoW。IndexedDB 只能使用 `SeekPlayerDB` version 1 的 `files` store，公开工厂只允许注入 `indexedDBApi`，不得接受 schema override。证明导入 candidate 不会生成 `ReviewState`，证明同一 `word_id` 的多个 active `target_sense_key` 共存且重复组合被拒绝，并覆盖 `acquisition-delay.v1` 的 24 小时与跨 episode 判定。不要修改 vocabulary 共享入口、旧 service 或 Vue 文件。完成后报告公开接口、数据键、测试命令和集成注意事项。

### P2 真实语境证据

> 你只负责 P2：严格按 `p0-contracts.md` 实现带 provenance 的 `ContextEvidence` 纵向闭环，包括固定 `vocabulary.context-evidence.store.v1` row、in-memory/IndexedDB repository、接收 `VocabularyLearningTransactionRowPort` 的 binder、来源/ownership/license/quality normalization、去重、validated anchor 选择和默认导出脱敏。binder 不得接收完整 UoW，也不得自行 open DB/transaction。IndexedDB factory 只允许注入 `indexedDBApi`。使用 fixtures 覆盖文章、字幕、用户本地考试材料、开放语料、词典示例、AI pending 和来源不明。不得联网抓取或把 IELTS 原文写进仓库，不得引入 AI 运行时依赖。只新增独立模块与 verification，不修改共享入口或 UI。完成后报告接口和版权边界。

### P3 事件数据与导出

> 你只负责 P3：实现 append-only `LearningEvent` 的最小纵向闭环，包括 event envelope、in-memory repository、IndexedDB 分片/manifest、接收 `VocabularyLearningTransactionRowPort` 的 binder、幂等 event id、correction event、training eligibility 和 JSON/JSONL 脱敏导出。binder 不得接收完整 UoW。只能使用现有 DB version/object store，事件不得无限堆在一个 row。只新增模块与 verification，不接入现有 service。完成后报告事务能力、分片策略、恢复行为和导出 schema。

### P4 Review policy 与 planner

> 你只负责 P4：以纯函数实现 `once_daily`、`balanced`、`intensive` 和 60 分钟时间预算 session planner。`balanced` 必须让 mature 正确卡一天一次，只允许 new/learning/relearning 或 `again` 在 10–20 分钟后最多 revisit 一次。ledger 必须固定、可解释并输出 backlog。速度初值 36 秒/attempt，个人速度排除异常 active duration。只新增模块与 verification，不改现有 `useSrsReview.js`。重点测试跨午夜、时区、预算不足、途中切换设置和无限循环保护。

### P5 Legacy audit

> 你只负责 P5：实现旧 vocabulary snapshot 的只读 audit。分类 `compatible`、`needs_context`、`needs_sense`、`conflicting`、`ignored_or_deleted`，记录原因、旧 snapshot hash、policy version，重复运行结果幂等。旧日志默认 `is_legacy: true` 且不可训练。只新增 audit 模块、fixtures 和 verification，严禁改写旧 snapshot、due date 或创建卡。完成后报告分类统计与 reassessment 所需输入。

Wave 1 合并门槛：

- P0 1.1 的真实迁移前脱敏快照已由用户授权导出并记录 keyed hash，且 1.3 的独立 worktree 已就绪；合成 fixture 通过不能替代此门槛。
- 五个模块没有共享文件冲突。
- 所有 focused verification 通过。
- `npm run build` 和 `npm run verify:vite` 未新增失败。
- P1/P2/P3 的公开接口、接收 `VocabularyLearningTransactionRowPort` 的 binders、command receipt row 与 payload fingerprint fixtures 经过一次集成审阅，P6 才能开工。

## Wave 2：先两项，再三项

### 第一批：先 P6，再 P7

P6：

> 你负责 P6 acquisition service 与原子 graduation。基于已合并的 P1/P2/P3，实现 candidate→introduced→acquiring→ready_for_check→graduated 状态机，以及 target sense、context、attempt 命令。你先从唯一 IDB transaction 创建 `VocabularyLearningTransactionRowPort`，再把同一 port 传给 P1/P2/P3 binder 和 P6 review binder，最后组装完整 UoW；binder 不得接收完整 UoW。graduation 在该 transaction 读取并验证 anchor，并按 `GraduationEligibilityInput` 使用显式 `evaluated_at` 计算 `acquisition-delay.v1`；提交 acquisition state、唯一 initial `ReviewState`、event manifest/shard 和 receipt。相同 command/fingerprint 跨刷新返回已存 result，不同 fingerprint 必须 abort。你是 row-port factory、UoW assembler、`ReviewTransactionRepository` 与 review v2 repository 的唯一 owner。默认 feature flag off。不要修改文章结算或 SRS UI。提供端到端 verification、刷新重试和失败注入测试。

P7：

> 你负责 P7 Review service V2。等待 P6 合并后，基于 P3/P4/P6，只允许 graduated `LearningUnit` 进入 review。必须复用 P6 的 `ReviewTransactionRepository` 与 review v2 repository，不得新增第二套持久化层。实现 session ledger、四级 rating、cue/prompt metadata、FSRS before/after、三种同日 mode、attempt 幂等、session 恢复。你只拥有新的 review service/session ledger 文件，不要修改现有 `useSrsReview.js` 或共享 index；由 P11/P10 集成。提供完整 focused verification，特别证明 `good + original_context` 和 `good + word_only` 在调度 rating 相同、分析 metadata 不同。

### 第二批：P8、P9 可并行，P10 等 P6

P8：

> 你负责 P8 考试词表导入闭环。先实现最小 CSV/JSON 行模型和预览，再把确认行写入 candidate pool，绝不能立即建 FSRS 卡。实现从用户已有文章/字幕/本地考试材料匹配句子，缺句时返回明确缺口与三个后续动作。完成一个导入一行→补真实句→延迟检查→graduation→进入 review 的自动化示例。不要打包考试原文，不在 review 时调用 API。若导入字段需要产品选择，先用文档 fixture 给出默认值与可修改点，不要扩张 UI。

P9：

> 你负责 P9 legacy reassessment。基于 P5 audit、P6 graduation 和 P4 planner，按预算选择小批量旧词，支持补义项、补语境、确认已有状态、重建状态、skip，并记录原状态与事件。必须可暂停/恢复/关闭 flag，未入批次的旧词不得同时变到期。先用 fixtures 做端到端 dry-run，默认不碰真实用户数据；任何真实迁移都必须留到人工确认。

P10：

> 你负责 P10 vocabulary 共享入口与文章结算迁移，是本 wave 唯一可以修改 `src/services/vocabulary/index.js`、`vocabulary-service.js`、`srs-candidates.js`、`article-srs-settlement.js` 的 owner。将 `addWord()` 拆为显式 upsert/acquisition/legacy adapter，把新文章词迁移为 candidate/acquisition，不再隐式建卡；保持旧恢复和 pending 行为。先检查并保护当前未提交修改，逐个迁移调用方，新增 guard 报告剩余 legacy 调用。不得修改 SRS UI。

Wave 2 合并门槛：

- candidate 与 acquiring 项目不会出现在 due review。
- graduation 故障时不存在半提交。
- review session 三种 mode 的行为可通过固定 fixtures 重现。
- 旧词只读 audit 和小批 reassessment dry-run 均不改真实数据。

## Wave 3：三个对话可并行

### P11 复习 UI 最小接入

> 你负责 P11，是唯一可修改 `src/features/srs-review/useSrsReview.js`、`SrsReviewPage.vue` 和相关 CSS/flow verification 的 owner。先合并并理解这些文件中已有的用户改动，再把数据源接到 Review service V2。保持四个中文评分；记录 cue/prompt；显示 mode、预计时间、backlog、revisit reason，但不要强制拆成两个前端页面。保持音频、键盘、答案揭示、自动前进和恢复；快速连点只提交一次。不要重构 reader runtime。

### P12 统计报告

> 你负责 P12：只基于 append-only events 构建可删除重建的统计模块，输出个人 active speed、跨日 retention、lapse、revisit burden、acquisition-to-graduation time、三种 mode 的描述性比较、training eligible 数和缺口。明确观察数据不能证明因果。优先输出 service/report object 与 verification，不要求先做复杂 UI。

### P13 文档、guard 与验证编排

> 你负责 P13（不是参数优化）：更新 README/PROJECT_MAP/SRS 文档中的分级和生命周期说明，新增/整理 verification 命令与永久 guard，检查 DB schema、AI 可选性和版权样本。不要修改业务实现。运行受影响验证并形成矩阵，区分既有失败与新失败。

Wave 3 合并门槛：

- 用户可以完成一次带语境的四级复习，事件、FSRS 状态和 ledger 一致。
- 60 分钟计划能显示预计数量、剩余时间和 backlog。
- 报告可从清空后的派生缓存重建。
- 文档不再声称“五级评分”或“所有新词立即进入复习”。

## Wave 4：先收集真实数据，不要现在并行编码

### P14 参数优化与受控发布

只有在真实合格跨日 review attempt 达到门槛后才开启：

> 你负责个性化参数离线评估。不得为了跑优化而降低数据门槛或把 legacy/强提示/异常耗时混入训练。用时间切分 train/validation/holdout，对当前参数和候选参数比较校准与预测损失，输出训练窗口、事件 hash、optimizer version、指标和影响预览。未改善则只生成拒绝报告；改善则生成待人工确认候选。不得自动重排全部 due date。

### P15 最终迁移与兼容清理

> 你负责最终迁移演练和兼容清理。先用备份 snapshot 做 dry-run、部分 reassessment、回滚、恢复；核对记录数量、hash 和 orphan。只有所有调用方均已迁移且 guard 通过，才删除隐式建卡 adapter。运行全部 focused verification、build 和 Vite verification，记录可回滚点。不得删除原始 review logs。

## 需要用户参与的检查点

- P8：确认考试词表实际列名与用户材料的导入形式。
- P9：确认第一批真实 reassessment 的数量和时间占比。
- P11：试用三种 mode，重点比较主观负担，不立即用短期正确率下结论。
- P14：确认是否发布个性化参数候选。
- P15：确认何时删除 legacy adapter。

## 推荐的实际首轮

第一轮只开 6 个对话：P0 先完成；然后同时开 P1–P5。不要一开始就开 P6–P15，因为后面的接口依赖前面产物，过早并行只会制造重复实现和 merge 冲突。
