## Context

当前 `src/services/vocabulary/vocabulary-service.js` 的 `addWord()` 会同时创建 `VocabularyEntry`、`Context` 和初始 FSRS `ReviewState`。因此，从文章标注加入的词、考试词表候选词和已经适合长期复习的词，在数据层没有可靠边界。当前调度器开启 `learning_steps: ['1m', '10m']` 与 `relearning_steps: ['10m']`，但复习页面又通过“当天已经复习过即不进入队列”的规则固定每日总量，短时调度实际上无法完整表达。

用户的主要学习目标是上下文支持的接受性词汇：一个词可能经过 3–4 个月的多次接触才逐步熟悉；看到孤立词形时未必立即说出中文，但在真实句子中可以快速理解。这不是简单的“认识/不认识”，而是原语境识别、新语境迁移识别、孤立提取三种能力发展的不同阶段。

实现还必须遵守以下约束：

- 保持 `SeekPlayerDB` version 1、`files` object store 和 `id` key path，不做 IndexedDB schema migration。
- 不在 `src/composables/reader-runtime.js` 或 `src/composables/session-init.js` 添加业务逻辑。
- 保持 ECDICT 为只读、可选、瞬时建议来源；ECDICT 没有可作为自然例句来源的字段。
- 不把受版权保护的 IELTS 例句打包进应用；用户合法持有的材料只在本地导入和使用。
- 当前工作树和 `src/features/srs-review/` 存在其他未提交改动，实施必须以独立 branch/worktree 和文件所有权控制并行冲突。

## Goals / Non-Goals

**Goals:**

- 在后端严格区分 acquisition 与 review，而不强迫前端立即显示两个独立页面。
- 用“词形 + 目标义项”作为学习单位，并允许多个真实句子作为同一义项的证据。
- 让 graduation 成为创建 FSRS 状态的唯一领域入口。
- 兼容旧数据，通过可暂停、可回滚、限流的 reassessment 逐批迁移。
- 让同日策略尊重用户习惯，同时记录足够的数据比较学习效果。
- 用时间预算生成每日计划，而不是以固定 100 词作为硬目标。
- 建立可审计的原始事件数据，为日后个性化 FSRS 参数与策略比较提供可靠输入。
- 为多对话并行实施划出明确模块、依赖、文件所有权和合并门槛。
- 用用户本地词批次驱动通用首次接触覆盖层，复用现有复习页视觉结构，并以可追溯短真实句验证 acquisition 的首次引入体验。

**Non-Goals:**

- 本次只实现首次接触覆盖层，不实现完整 acquisition 管理页面或重做现有复习页面。
- 本次不在线训练模型，不自动发布个性化参数，也不保证首次上线就改变 FSRS 默认参数。
- 本次不提供考试词表或版权例句内容，只提供本地导入、来源记录和筛选能力。
- 本次不把孤立释义回忆设为 graduation 的硬门槛。
- 本次不让 AI 成为例句生成或正常复习的运行时依赖。
- 本次不改动 IndexedDB 数据库版本和 object store。
- 本轮只实现通用首次接触、真实句筛选与预习自动 Aria 发音。至少 24 小时延迟检查、graduation、创建 `ReviewState` 与 FSRS 接入仍属于后续轮次。延迟检查未来仍使用手动发音，不继承本轮预习自动播放规则。

## Decisions

### 1. 共享词条，分离两个生命周期

保留一个规范化的 `VocabularyEntry` 表示词形、lemma、发音和通用词典建议；新增 `LearningUnit` 表示 `word_id + target_sense`。领域层允许同一词同时维护多个 active target senses，唯一键固定为 `(word_id, target_sense_key)`；初期 UI 可以一次只编辑一个义项，但 repository 不得建立 `word_id` 单列唯一约束。

每个 `LearningUnit` 最多拥有一个 `AcquisitionState` 和一个 `ReviewState`：

```text
candidate
  -> introduced
  -> acquiring
  -> ready_for_check
  -> graduated
  -> review: new/learning/review/relearning

任意 acquisition 状态 -> skipped
legacy_review_state -> reassessment -> graduated 或 skipped
```

`AcquisitionState` 负责是否选定目标义项、是否具有合格语境、最近一次接触、延迟检查结果和毕业时间。`ReviewState` 只存在于 graduation 之后。旧 `word_id` 级 FSRS 状态在兼容期映射到一个 legacy `LearningUnit`，随后经过 reassessment 再决定保留、重建或跳过。

替代方案是继续以 `Word.status` 同时表示学习和复习阶段；该方案无法表达一词多义、语境证据与 FSRS 状态的独立性，拒绝采用。

### 2. 采用独立领域服务与显式命令

新增以下边界：

- `VocabularyAcquisitionService`
  - `queueCandidate`
  - `introduceCandidate`
  - `selectTargetSense`
  - `attachContextEvidence`
  - `recordAcquisitionAttempt`
  - `markReadyForCheck`
  - `graduateLearningUnit`
  - `skipLearningUnit`
- `SrsReviewService`
  - `getDueLearningUnits`
  - `startReviewSession`
  - `recordReviewAttempt`
  - `completeReviewSession`
- `VocabularyLearningEventRepository`
  - `append`
  - `query`
  - `export`
- `LegacyVocabularyAuditService`
  - `classify`
  - `enqueueReassessmentBatch`
  - `commitReassessment`

现有 `createVocabularyService()` 在迁移期保持查询和兼容操作，但新调用方不得直接调用隐式建卡的 `addWord()`。最终将其拆成显式 `upsertVocabularyEntry()` 与 acquisition 命令；兼容方法必须标记 `legacyCompatibility: true` 并可由验证脚本追踪剩余调用者。

### 3. graduation 使用单事务 unit of work

`graduateLearningUnit()` 必须在同一个 IndexedDB `readwrite` transaction 中：

1. 读取 `LearningUnit`、`AcquisitionState`、合格 `ContextEvidence` 和现有 `ReviewState`。
2. 验证目标义项、真实语境锚点和延迟检查均满足条件。
3. 防止重复 graduation。
4. 创建 FSRS initial `ReviewState`，其主关联键为 `learning_unit_id`。
5. 将 acquisition 状态改为 `graduated`。
6. 追加 `acquisition_graduated` 事件。
7. 一起提交或一起失败。

为了保持 IndexedDB schema，记录继续放在 `files` object store 中，以命名 row key 区分逻辑集合。repository 层负责多 row transaction；业务层不得散落直接 `put()`。建议逻辑键：

- `vocabulary.acquisition.store.v1`
- `vocabulary.context-evidence.store.v1`
- `vocabulary.review.store.v2`
- `vocabulary.learning-events.manifest.v1`
- `vocabulary.learning-events.v1.<yyyy-mm>`
- `vocabulary.learning-command-receipt.v1:<command_id>`
- 现有 `vocabulary.srs.store.v1` 在迁移期保留

`vocabulary.review.store.v2` 以 `learning_unit_id` 为唯一业务键；现有
`vocabulary.srs.store.v1.reviewStates[*].word_id` 只属于 legacy 兼容与审计，不接收新 graduation 写入。
具体字段见 `p0-contracts.md` 的 ReviewState v2。

P1、P2 与 P3 必须分别提供绑定到 `VocabularyLearningTransactionRowPort` 的
acquisition/context/event adapter；binder 不得接收完整 UoW，也不得自行打开数据库或
transaction。P6 是 row-port factory、UoW assembler 与 graduation unit-of-work owner：先从
单一 `files` readwrite transaction 创建 row port，再绑定四个 repository 并组装完整 UoW。
该 transaction 必须读取/验证 context row，并更新 acquisition row、review v2 row、event
manifest、预先选定的 event shard 和 command receipt row。receipt 保存 canonical payload
fingerprint 与完整规范化 result；刷新后相同 command/fingerprint 直接返回 receipt result，
不同 fingerprint 必须 abort。只有 transaction `oncomplete` 后业务命令才算成功；
任一失败必须 abort。具体接口见 `p0-contracts.md` 的 `vocabulary-learning-uow.v1`。
`ReviewTransactionRepository` 与 review v2 repository 的唯一实现 owner 也是 P6；P7 必须在
P6 合并后复用该 repository，只拥有 review service/session ledger，不得实现第二套持久化层。

具体分片大小由实现基准测试确定，但事件不得无限追加到单一巨型 JSON row。

### 4. graduation 评价的是首次可靠联系，不是完全掌握

graduation 必须同时满足：

- 已选择一个明确、面向用户的 target sense，包含简短中文释义或等价解释。
- 至少一个 `ContextEvidence` 通过来源和内容校验。
- 使用 `acquisition-delay.v1`：检查发生在首次引入至少 86,400,000ms 后，且 `attempt_episode_id` 与 `introduction_episode_id` 不同；用户未先查看中文答案，并能借助英文语境判断该义项和它在句中的大致作用。
- 检查结果不是 `again`。

系统记录但不强制：

- 能否在新语境中迁移识别。
- 能否从孤立词形提取释义。
- 发音、拼写、其他义项是否掌握。

这允许用户保持基于句子的学习方式，同时把孤立提取作为后续成熟度信号，而不是错误地把它解释成“不认识”。

### 5. 句子是有来源的证据，不是卡片身份

`ContextEvidence` 至少包含：

- `learning_unit_id`
- `sentence`
- 可选 `surrounding_text`
- `source_kind`
- `source_id` / `source_title` / `source_locator`
- `license_kind`
- `ownership`
- `quality_status`
- `created_at`

来源优先级：

1. 用户导入的文章和视频字幕。
2. 用户合法持有并主动本地导入的考试材料。
3. 许可明确的开放语料。
4. 使用条款允许的词典示例。
5. AI 离线候选，仅在用户启用后生成、缓存并通过人工确认。

`quality_status` 至少区分 `pending`、`validated`、`rejected`。考试材料只存本地内容与定位信息，不随应用分发。来源不明或许可不明的批量句子不能自动成为 graduation 锚点。

### 6. 评分与提示层级正交记录

四级评分保持：

- `again` / 忘记：无法建立目标义项联系，或理解错误。
- `hard` / 困难：在较强提示或较长思考后理解正确。
- `good` / 一般：在当前提示条件下正常正确。
- `easy` / 容易：快速、稳定、低提示正确。

每次 attempt 另记：

- `prompt_mode`: `word_only`、`original_context`、`transfer_context`
- `cue_level`: 从未揭示释义，到显示目标句、周边语境、首字母/词性提示、中文释义
- `answer_revealed_before_rating`

调度器只接收 rating；分析层同时使用 cue 数据。这样不会把“看句子后答对”和“孤立词形立即答对”误认为完全相同，也不会因为用户需要语境就强制判错。

Acquisition 检查与 review 评分使用不同 DTO。`AcquisitionAttempt` 必须保存 `attempt_id`、
目标义项、所用 `ContextEvidence`、提示条件、是否提前揭示答案，以及版本化
`graduation_eligibility` 判定快照。graduation event 必须引用同一 qualifying attempt，
不得在毕业时重新推断或覆盖检查结果。

### 7. 同日复习采用可切换策略，默认 `balanced`

策略定义：

- `once_daily`：一个 `LearningUnit` 在一个本地日最多提交一次正式 attempt；同日 FSRS short step 只记录为下一日候选，不再次展示。
- `balanced`：成熟且答对的 review 当天不重复；新 graduation、learning/relearning 或答 `again` 的项目允许一次 10–20 分钟后的短时 revisit。单日正式 attempt 次数有上限。
- `intensive`：按 scheduler 提供的全部 learning/relearning short steps 展示，但仍受安全上限与时间预算约束。

默认 `balanced`，但不强行覆盖用户选择。策略切换只影响未来队列选择，不回写历史 rating，不批量重排所有到期时间。每个 session 固化 `policy_version` 和 mode，途中修改设置只对下一 session 生效。

### 8. 每日计划由时间预算和个人速度生成

初始默认预算为 60 分钟，初始速度估算为 36 秒/attempt。规划器按优先级分配：

1. overdue/due review
2. relearning 和当日允许的 revisit
3. legacy reassessment
4. 新 acquisition

规划器输出固定的 session ledger，而不是每次重新查询后改变总数。实际耗时通过最近可靠 attempt 的截尾移动统计更新；异常中断、后台停留和超长音频不进入速度估计。若 due 工作已超过预算，系统显示 backlog 和预计时间，但不偷偷丢弃或伪装为已完成。

### 9. 事件数据 append-only，派生视图可重建

统一事件 envelope：

- `event_id`, `event_type`, `occurred_at`, `recorded_at`
- `attempt_id`, `answer_revealed_before_rating`, `graduation_eligibility`
- `session_id`, `session_position`
- `learning_unit_id`, `word_id`, `target_sense_id`
- `policy_version`, `scheduler_version`, `content_version`
- `prompt_mode`, `cue_level`, `rating`
- `duration_ms`, `active_duration_ms`
- `before_state`, `after_state`
- `source_kind`, `context_evidence_id`
- `is_legacy`, `training_eligible`, `exclusion_reasons`

核心事件包括 candidate queued、context attached/validated、acquisition attempt、graduated、review attempt、reassessment 和 policy changed。原始事件不修改；纠正通过补偿事件完成。当前 `reviewLogs` 在兼容期继续写入，同时产生新事件，等导出和回放验证稳定后再决定是否去掉双写。

### 10. 个性化参数先观测、后评估、再发布

首期只收集数据和生成离线报告，仍使用稳定默认参数。优化输入必须排除：

- legacy 不可解释日志
- 缺少 policy/prompt 元数据的记录
- 重复提交、异常耗时、导入伪造事件
- 同日强提示 attempt（除非模型显式建模）

初始启用门槛采用保守值：至少 500–1000 条合格、跨多个自然日的 review attempt，并具有足够的 rating 分布。候选参数用时间切分 holdout 与当前参数比较校准误差和预测损失；只有明确改善且通过 sanity checks 才生成待确认的 `PolicyCandidate`。发布新版本不对全部卡片做无提示的批量 reschedule。

### 11. 旧数据采用审计清单与渐进 reassessment

首次启用新模型时只生成只读 audit：

- `compatible`: 数据能可靠映射到一个 target sense 和 context。
- `needs_context`: 有词和 review 状态，但缺少可验证句子。
- `needs_sense`: 有词和句子，但目标义项不明确。
- `conflicting`: 重复、多个不兼容状态或坏引用。
- `ignored_or_deleted`: 不迁移。

系统保存 audit manifest、旧记录 hash 和 migration policy version。每次只从 `needs_*` 中提取小批量进入 reassessment，默认不超过当日时间预算的一部分。旧日志保留为 `is_legacy: true` 且默认 `training_eligible: false`。迁移完成前旧 review 路径仍可读，回滚只需关闭 feature flag 并停止新批次，不删除原记录。

### 12. 实施采用 feature flags 与一写多读阶段

建议 flags：

- `VOCABULARY_ACQUISITION_ENABLED`
- `VOCABULARY_EVENT_LOG_ENABLED`
- `SRS_REVIEW_POLICY_V2_ENABLED`
- `VOCABULARY_LEGACY_REASSESSMENT_ENABLED`

迁移顺序：

1. 先加入纯模型、repository 合约、事件记录和只读 audit，不改变 UI。
2. 加入 acquisition service 与 graduation transaction，仅对考试词表新入口启用。
3. 将文章结算迁移到候选/acquisition 入口，仍保留旧兼容开关。
4. 加入 review policy V2、session ledger 和 cue 元数据。
5. 小批启用 legacy reassessment。
6. 数据质量达标后才运行参数离线评估。
7. 全部调用方迁移并通过 guard 后，删除隐式建卡兼容逻辑。

### 13. 并行开发按波次和文件所有权进行

并行任务必须使用独立 branch/worktree。一个波次内各任务优先新增独立文件；修改 `src/services/vocabulary/index.js`、`vocabulary-models.js`、`vocabulary-service.js`、`src/features/srs-review/useSrsReview.js` 的集成工作集中到指定 owner，避免多个对话同时编辑。

```text
Wave 0: 契约与基线
  -> Wave 1A 领域模型/repository
  -> Wave 1B 语境证据与来源
  -> Wave 1C 学习事件 repository/导出
  -> Wave 1D Review policy/planner 纯函数
  -> Wave 1E legacy audit 纯函数

Wave 1A + 1B + 1C -> Wave 2A acquisition/graduation
Wave 1C + 1D + Wave 2A -> Wave 2B review service/session ledger
Wave 1E + 1D + 2A -> Wave 2C reassessment
Wave 2A -> Wave 2D 考试词表导入

Wave 2A -> Wave 3A 现有服务/文章结算迁移
Wave 2B -> Wave 3B 复习 UI 集成
Wave 1C + 2B -> Wave 3C 个人数据报告
Wave 3C + 足够真实数据 -> Wave 4 参数优化
```

P6 不得仅依据 P1+P2 启动；P3 的 transaction-bound event adapter 是 graduation 原子性的
硬依赖，P2 的 transaction-bound context adapter 是 anchor 原子验证的硬依赖。P7 不得与
P6 同时实现 review repository，必须等待 P6 的共享 repository/UoW 合并。每个任务先合并上游，再运行自己的 focused verification；每个 wave 结束后统一运行
`npm run build` 与 `npm run verify:vite`。

### 14. 通用首次接触是一个隔离的 UI 垂直切片

该覆盖层允许在完整 acquisition 管理页面之前落地，但必须保持隔离：

- importer 接受任意数量的 `answers[]` 或 `vocabulary-preview.first-contact.v1 items[]`，按 lemma 去重，并将多释义输入降为一个明确标注的主要义或主要义建议。已有 `primary-sense-policy.v1` 达成多来源共识时才标为 resolved；否则不得宣称词频比例。
- 入口位于“今日复习”附近，以覆盖层打开，并复用复习页的两栏卡片、页头与底部操作区视觉语言；不得修改“今日复习”的队列、评分、自动播放或历史行为。
- 真实句候选优先来自用户文章/字幕和许可开放语料；当前开放适配器通过同源 Vite endpoint 查询 Tatoeba，只接收已批准、带简体中文翻译和 `CC BY 2.0 FR` 的记录，并保存句子 ID、作者及链接。候选必须通过 `sentence-candidate-ranking.v1` 的 `first_preview` 义项、来源和难度硬约束。
- 预习 UI 只依赖 `sentence-source-registry.v1`，不直接绑定具体语料服务。Tatoeba 保持第一来源；Wordnik 是第二来源，只在前者未返回合格句时调用。Wordnik API key 仅由 Vite/Node 同源代理从 `WORDNIK_API_KEY` 读取，客户端 bundle、URL 与响应均不得包含密钥；代理采用每小时 80 次本地安全预算并读取官方 rate-limit header。Wordnik 格式化结果可在当前页面会话内暂存以避免往返导航重复调用，但不得写入 localStorage、IndexedDB 或独立语料仓库。
- Wordnik `/examples` 不提供中文整句翻译，也不把例句绑定到可验证的词典 sense id。因此适配器只把官方针对该词返回的真实例句作为“主要义的 provider-ranked 候选”，继续执行短句、结构、来源和词形筛选；页面明确显示整句中文暂缺，不伪造翻译。Wordnik 数据旁必须链接到具体 word 页面并显示未缩放的官方 `Powered by Wordnik` badge。
- 用户本地考试原句不得用于 `first_preview`；其定位只保留给 `late_context_transfer`。没有合格候选时显示无句状态，AI 不得现编默认替代句。
- 状态仅为 `not_started`、`in_progress`、`completed`，保存动态批次当前位置与每词学习内容揭示状态。它不复用或写入 SRS repository，不创建 `ReviewState`。
- 卡片首态只显示单词；学习内容揭示后显示可用音标、一个中文主要义和至多一条带中文翻译与 attribution 的短真实句。同日不追加第二或第三条重复语境。
- 发音服务优先严格匹配系统语音 `Microsoft Aria Online (Natural) - English (United States)`；不可用时只请求 Vite dev/preview 提供的同源 `/api/tts/edge`，该端点用 `node-edge-tts` 合成并声明 `en-US-AriaNeural`。客户端不得接受其他英语语音；两者都不可用时显示“Aria美式发音暂不可用”。
- 每个预习词进入时自动播放一次，用户点击可以重播；切词、完成或关闭覆盖层必须取消等待 voice、真实句 fetch 与尚未完成的播放请求，防止旧词延迟显示或播放。该严格服务设计为可供后续 review 调用，但本覆盖层不改变现有 review 发音策略。
- 本覆盖层不依赖 ECDICT 或 AI API；新增的 Vite/Node 端点分别负责按需生成 Aria 音频和代理许可开放短句，不接触 IndexedDB 或 SRS。

## Risks / Trade-offs

### 本地例句与音频仓库（Wave C5）

首次接触的来源顺序调整为：本地只读仓库 → Tatoeba → Wordnik。本地仓库由独立构建脚本从用户本机的 MDX、Open English WordNet 和可选 Kaikki JSONL 生成 SQLite；运行时 Vite 插件只读打开该库，不写 `localStorage`、IndexedDB 或语料源文件。

文本首批使用 Vocabulary.com 的带出版物来源用例与 LDOCE 的义项例句；其他学习型词典用于扩大覆盖率和交叉验证。MDD 音频作为同一仓库的可选后续索引，不阻塞文字例句链路。受再分发限制的原文件、抽取文本、音频与 SQLite 均位于 `/data/dictionaries/` 并保持 Git 忽略，仓库只提交解析器、schema、来源 manifest 模板和合成测试数据。

候选排序先满足词形/lemma、句长和目标词明确出现，再按词典义项顺序、来源类型和结构难度排序。资源数量只提高覆盖率；UI 仍只展示一个主要义和一条句子。
- [一词多义使数据模型和 UI 复杂] → repository 允许多个 active target senses 并以 `(word_id, target_sense_key)` 唯一；初期 UI 可一次只编辑一个义项。
- [同日 revisit 可能提高短期正确率而非长期保持] → 三种策略可切换，分析使用跨日 retention 指标，不用同日正确率单独决策。
- [一次/日可能违背 scheduler short steps] → 明确这是产品 queue policy，不篡改 FSRS rating；通过 policy_version 和实验报告评估代价。
- [事件量使单 row JSON 膨胀] → 按月或大小分片，保留 manifest，并做导出与损坏恢复测试。
- [多 row graduation 出现部分写入] → 只允许 repository unit of work 在单 IndexedDB transaction 中提交。
- [真实句子许可不清] → 强制 provenance 与 license/ownership 字段；不明来源只能 pending，不能批量再分发。
- [旧数据重新评估造成复习洪峰] → audit 先行、分批入队、时间预算限流、feature flag 可暂停。
- [多个执行对话产生 merge 冲突] → 独立 worktree、单文件 owner、共享入口文件由集成任务统一修改。
- [过早个性化导致参数过拟合] → 设置样本与跨日门槛、时间切分 holdout、人工确认发布。
- [双写期间新旧日志不一致] → 每次提交生成共同 correlation id，并提供一致性检查和补偿事件。

## Migration Plan

1. 导出当前 `vocabulary.srs.store.v1` 快照并记录 hash；新增只读审计命令，不写业务数据。
2. 合并领域模型、repository 和事件 envelope，所有新能力保持 flag off。
3. 启用考试词表 candidate pool，在小样本上验证不会产生 `ReviewState`。
4. 启用 graduation transaction，验证每个毕业单元恰好产生一个 initial `ReviewState` 和一个事件。
5. 对新 session 启用 `balanced` policy ledger；保留回到旧 daily queue 的开关。
6. 逐批启用 reassessment，并监控 backlog、耗时和错误率。
7. 迁移文章标注结算，增加 guard 禁止新调用方使用隐式 `addWord()`。
8. 稳定一个观察周期后评估是否移除兼容路径。

回滚不删除新数据：关闭 flags，停止新 graduation/reassessment，让旧读取路径继续工作。若新记录损坏，以迁移前 snapshot 与 append-only 事件重建；禁止直接覆盖用户原始 review logs。

## Open Questions

- `balanced` 的默认 revisit 延迟采用固定 15 分钟，还是直接采用 scheduler 的第一个 short step 并限制最多一次。
- 用户本地考试材料的保存粒度是完整句子、短摘录还是只保存定位符；需结合实际导入格式确认。
- 个性化参数发布是否每月人工确认，还是达到显著改善后自动创建待确认候选；建议首期只生成报告。
