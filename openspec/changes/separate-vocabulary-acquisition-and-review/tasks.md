## 1. 基线、并行环境与契约

- [x] 1.1 在开始实现前导出 `vocabulary.srs.store.v1` 的脱敏测试快照、记录 hash，并验证导出过程不改写 IndexedDB。
- [x] 1.2 记录当前 `npm run build`、`npm run verify:vite`、现有 vocabulary/SRS focused verification 的基线结果，将既有失败与本变更失败分开。
- [x] 1.3 为每个并行任务建立独立 `codex/` branch 与 worktree，确认一个任务只拥有其声明的文件，禁止在共享 dirty worktree 中并发编辑。
- [x] 1.4 固化 `LearningUnit`、`AcquisitionState`、`ContextEvidence`、`ReviewAttempt`、`SessionLedger`、`LearningEvent` 的字段词汇表和版本号。
- [x] 1.5 增加 guard，确认本变更不提升 `SeekPlayerDB` version、不新增 object store、不向 `reader-runtime.js` 或 `session-init.js` 添加业务逻辑。

## 1A. Passage 1 五词本地预习试点

- [x] 1A.1 更新 proposal/design/spec，明确共享复习视觉体系的五词试点是唯一 UI 例外，且不扩大到延迟检查或完整 acquisition 产品。
- [x] 1A.2 新增纯 importer/短语抽取逻辑，只读取用户选择 JSON 的五个 Passage 1 项，且源码、fixture 和发布包不包含版权原句或目标短语。
- [x] 1A.3 新增覆盖层 UI 与“待预习”入口，支持学习内容揭示、默认折叠原句、上一个/下一词、完成态和本地刷新恢复，同时保持今日复习不变。
- [x] 1A.4 抽出严格 Aria 美式发音服务，验证系统精确语音优先、仅 `en-US-AriaNeural` 回退、无自动播放和不可用提示。
- [x] 1A.5 新增 focused verification，并通过受影响验证、`npm run build`、`npm run verify:vite`；证明无新 `ReviewState`、无 IndexedDB schema 变化、ECDICT 关闭可用。
- [x] 1A.6 收紧 importer：只允许五个指定 lemma，按 lemma 去重并按固定顺序返回，拒绝任意五条 RP1 数据或同词跨来源重复计数。
- [x] 1A.7 为 Vite dev/preview 增加同源 `node-edge-tts` Aria 端点，并在切词、完成和关闭时取消等待中的 voice/fetch/播放请求。
- [x] 1A.8 将专项验证改为仓库内自包含 fixture，并增加真实 Aria MP3 端点检查和浏览器端导入、刷新恢复、完成及 `ReviewState` 前后不变验证。
- [x] 1A.9 补充五词预习微阅读本地 schema/合并与兼容迁移，加入短语中文、英文语义块、按住中文和默认折叠的完整语境，不复用 reader chunk runtime。
- [x] 1A.10 将预习词改为进入时自动播放一次严格 Aria 美音，加入手动语境连续/单块朗读和当前块高亮，并保证切词、关闭、blur/visibilitychange 时取消和复位。
- [x] 1A.11 增补合成 fixture 的单元/组件/浏览器验证，分离真实 Aria 联网检查，并通过 build、Vite、SRS、OpenSpec strict 与架构守卫；仍不得创建 `ReviewState`。

## 2. Wave 1A：学习单位与 acquisition repository

- [x] 2.1 新增 `vocabulary-learning-models.js`，定义 `LearningUnit`、acquisition 状态枚举、目标义项和 normalization/assertion 纯函数。
- [x] 2.2 新增空 acquisition snapshot、版本字段、clone/normalize 逻辑，并为未知字段、旧字段、坏引用建立确定性处理规则。
- [x] 2.3 新增 in-memory acquisition repository，覆盖 load、query、幂等 update 和并发更新合约。
- [x] 2.4 新增 IndexedDB acquisition repository 与接收 `VocabularyLearningTransactionRowPort` 的 binder；binder 不得接收完整 UoW，且不改变数据库 schema。
- [x] 2.5 增加 focused verification，证明 candidate 不会隐式生成 `ReviewState`，并覆盖同一 `word_id` 多个 active `target_sense_key` 共存及重复组合拒绝。
- [x] 2.6 提交本模块时不修改 `src/services/vocabulary/index.js`、`vocabulary-service.js` 或任何 Vue 文件；由后续集成任务统一导出。

## 3. Wave 1B：真实语境证据与来源策略

- [x] 3.1 新增 `vocabulary-context-evidence.js`，定义固定 `vocabulary.context-evidence.store.v1` row、来源类型、ownership/license、quality status 和 source locator normalization。
- [x] 3.2 实现文章、字幕、用户本地考试材料、开放语料、词典示例、AI 候选六类来源的验证规则。
- [x] 3.3 实现 in-memory/IndexedDB ContextEvidence repository、接收 `VocabularyLearningTransactionRowPort` 的 binder、target sense 关联、去重和 validated anchor 选择；binder 不得接收完整 UoW 或自行 open DB/transaction。
- [x] 3.4 实现默认导出脱敏规则：版权本地材料只导出 source id、hash、locator，除非用户显式包含个人内容。
- [x] 3.5 增加 fixtures 与 focused verification，覆盖来源不明、AI pending、合法本地来源、重复句子和多句同义项。
- [x] 3.6 本模块不接入外部 API，也不复制或打包任何 IELTS 原文例句。

## 4. Wave 1C：学习事件 repository 与导出

- [x] 4.1 新增 `vocabulary-learning-events.js`，定义统一 event envelope、event types、correlation id 和 training eligibility 字段。
- [x] 4.2 实现 append-only in-memory repository，重复 `event_id` 必须幂等，纠错必须写 correction event。
- [x] 4.3 实现 IndexedDB 分片 repository、manifest 与接收 `VocabularyLearningTransactionRowPort` 的 binder；按月份或可配置大小滚动分片，不创建新 object store。
- [x] 4.4 实现 active duration、重复提交、legacy、缺失 cue/policy metadata 的数据质量分类和 exclusion reasons。
- [x] 4.5 实现版本化 JSON/JSONL 导出和字段字典；默认不包含无权再分发的完整语境文本。
- [x] 4.6 增加 focused verification，覆盖分片滚动、manifest 恢复、重复写入、补偿事件、脱敏导出和坏分片报错。

## 5. Wave 1D：Review policy 与时间预算纯函数

- [x] 5.1 新增 `srs-review-policy.js`，定义 `once_daily`、`balanced`、`intensive` 及 versioned policy schema。
- [x] 5.2 实现纯函数判断某次 scheduler due 是否能在同日重新入队；`balanced` 只允许 new/learning/relearning 或 `again` 最多一次 revisit。
- [x] 5.3 新增 `srs-session-planner.js`，按 due review、relearning/revisit、reassessment、acquisition 生成固定 ledger。
- [x] 5.4 实现 60 分钟、36 秒/attempt 的初始估算，以及从近期 active duration 计算截尾个人速度的逻辑。
- [x] 5.5 实现 backlog、预计完成时间、入队 reason 和预算耗尽的可解释输出。
- [x] 5.6 增加 focused verification，覆盖跨午夜、本地时区、session 中切换设置、预算不足、异常耗时和防无限 revisit。

## 6. Wave 1E：Legacy 只读审计

- [x] 6.1 新增 `legacy-vocabulary-audit.js`，读取现有 word/context/reviewState/reviewLog 并生成不写业务数据的 audit manifest。
- [x] 6.2 实现 `compatible`、`needs_context`、`needs_sense`、`conflicting`、`ignored_or_deleted` 分类及原因码。
- [x] 6.3 为旧 review log 生成只读训练资格判断，默认 `is_legacy: true`、`training_eligible: false`。
- [x] 6.4 实现旧 snapshot hash、audit policy version 和重复执行幂等性。
- [x] 6.5 增加 focused verification，覆盖孤儿状态、重复 lemma、缺失句子、多义冲突、ignored/deleted 和坏日期。

## 7. Wave 2A：Acquisition service 与原子 graduation

- [x] 7.1 在 Wave 1A、1B、1C 合并后新增 `vocabulary-acquisition-service.js`，实现 candidate、introduce、sense、context 和 attempt 命令。
- [x] 7.2 实现 acquisition 状态机 guard，禁止跳过必要阶段或对 skipped/graduated 单元做非法转换。
- [x] 7.3 实现 graduation eligibility evaluator：目标义项、validated anchor、`acquisition-delay.v1`（至少 86,400,000ms 且跨 episode）、评分前未揭示中文和非 `again`。
- [x] 7.4 作为唯一 owner 实现 transaction row-port factory、共享 UoW assembler、ReviewTransactionRepository 与 review v2 repository；先创建 row port，再绑定四个 repository 并组装 UoW，在一个 transaction 中验证 anchor 和提交全部 rows。
- [x] 7.5 为 graduation 增加 command/attempt id 幂等性；receipt 保存 canonical payload fingerprint 与完整 result，刷新后相同 fingerprint 返回首次结果，不同 fingerprint 以 `IDEMPOTENCY_CONFLICT` abort。
- [x] 7.6 增加 feature flag，默认关闭新写入路径；关闭时不删除已产生的新记录。
- [x] 7.7 增加端到端 focused verification，覆盖成功、缺少句子、提前揭示答案、事务中途失败、重复点击和一词两义。

## 8. Wave 2B：Review service V2 与 session ledger

- [x] 8.1 在 P3、P4、P6 合并后新增 `srs-review-service-v2.js`，复用 P6 的 ReviewTransactionRepository/review v2 repository，只查询 graduated 且具有 active `ReviewState` 的 `LearningUnit`。
- [x] 8.2 实现 `startReviewSession()`，固化 policy version、mode、预算、速度估计、ledger 顺序和每项入队原因。
- [x] 8.3 实现 `recordReviewAttempt()`，分开接收 rating 与 prompt/cue metadata，并以 attempt id 防重复提交。
- [x] 8.4 将 rating 交给现有 FSRS scheduler，保存 before/after state、scheduler version、correlation id 和新 learning event。
- [x] 8.5 实现三种同日模式，不篡改历史 due date；`balanced` 的一次 revisit 必须同时受时间和次数限制。
- [x] 8.6 实现 session 恢复与完成，已提交 attempt 不得因刷新页面重复调度。
- [x] 8.7 增加 focused verification，覆盖四级映射、非法评分、提示层级、三种 mode、固定 ledger、恢复和跨日行为。

## 9. Wave 2C：考试词表候选导入闭环

- [x] 9.1 定义考试词表最小导入格式：lemma、可选 target meaning、考试类别/级别、来源标识，不要求预先具有句子。
- [x] 9.2 新增 importer/normalizer，提供格式错误、重复词、已存在词、同词不同义项的预览报告。
- [x] 9.3 将确认后的行只写入 candidate pool，验证不会创建 `ReviewState` 或污染正式 due queue。
- [x] 9.4 实现候选词的句子匹配：先搜索用户已导入文章/字幕和用户本地考试材料，再返回缺口清单。
- [x] 9.5 对缺句候选提供“等待自然遇见”“从许可语料导入”“可选 AI 候选”三种动作，但不在 review 时调用 API。
- [x] 9.6 完成一个最小端到端示例：导入一行、匹配或添加真实句、延迟检查、graduation、进入 review。
- [x] 9.7 增加 focused verification，覆盖空行、重复、版权来源脱敏、无句不毕业和导入回滚。

## 10. Wave 2D：旧词 reassessment 闭环

- [x] 10.1 在 Wave 1E 和 2A 合并后新增 `legacy-vocabulary-reassessment.js`，从 audit manifest 选择有限批次。
- [x] 10.2 将 reassessment 预算接入 session planner，确保未入选旧词不会同时变为到期。
- [x] 10.3 实现补义项、补真实语境、确认已有状态、重建 review state、skip 五类处理结果。
- [x] 10.4 保存原状态快照、处理理由、操作者选择、policy version 和 reassessment event。
- [x] 10.5 实现暂停、恢复和 feature flag 回滚；回滚不得删除旧日志或已确认的用户内容。
- [x] 10.6 增加端到端 focused verification，使用坏引用、多义冲突、无语境和兼容旧词 fixtures 演练一个批次。

## 11. Wave 3A：现有服务与文章结算迁移

- [x] 11.1 指定唯一 integration owner 修改 `src/services/vocabulary/index.js`，集中导出已合并的新模块。
- [x] 11.2 将 `vocabulary-service.addWord()` 拆分为显式 upsert/acquisition/legacy adapter，保留临时兼容标记和调用追踪。
- [x] 11.3 将 `srs-candidates.js` 与 `article-srs-settlement.js` 的新词路径迁移为 candidate/acquisition，不再隐式建 FSRS 卡。
- [x] 11.4 保持既有文章结算的恢复、错误提示和 pending candidate 行为，增加新旧 flag 的回退路径。
- [x] 11.5 增加 guard 搜索所有 `addWord()` 调用，区分已迁移调用和明确 legacy 调用。
- [x] 11.6 更新相关 focused verification，证明文章新词先进入 acquisition，已有 graduated 词不会被重复创建。

## 12. Wave 3B：复习 UI 最小接入

- [x] 12.1 指定唯一 SRS UI owner，在合并当前未提交 SRS 改动后，将 `useSrsReview.js` 的数据源迁移到 Review service V2。
- [x] 12.2 保持“忘记、困难、一般、容易”四个动作，移除任何仍存在的第五个评分语义或把“掌握”改为非 rating 管理动作。
- [x] 12.3 在不强制拆页面的前提下显示当前 mode、预计剩余时间、backlog 和 revisit 原因。
- [x] 12.4 记录 `word_only`、`original_context`、`transfer_context` 与逐级提示，不把显示句子自动判定为失败。
- [x] 12.5 保持答题揭示、音频、键盘、自动前进和刷新恢复行为；同一 attempt 的快速连点只能提交一次。
- [ ] 12.6 增加组件/流程 focused verification，并手工验证 60 分钟预算、三种 mode、答错 revisit 和 mature card 当日不重复。（focused verification 已完成；手工验收待补。）

## 13. Wave 3C：个人数据报告

- [ ] 13.1 新增可重建的统计模块，按日、prompt mode、cue level、rating、状态和来源汇总 attempt。
- [ ] 13.2 实现个人速度估计、跨日 retention、lapse rate、revisit burden 和 acquisition-to-graduation time。
- [ ] 13.3 实现三种同日策略的观察性比较，明确样本不随机时只能描述相关性，不能宣称因果。
- [ ] 13.4 显示数据质量、training eligible 数、跨日覆盖和达到参数训练门槛尚缺的数据。
- [ ] 13.5 增加从原始事件重建派生报告的 verification，删除缓存后结果必须一致。

## 14. Wave 4：离线参数优化与受控发布

- [ ] 14.1 在积累至少配置门槛的合格跨日 attempt 后，建立只读训练数据构建器，严格应用 exclusion reasons。
- [ ] 14.2 以时间切分 train/validation/holdout，记录数据窗口、事件 hash、当前参数、候选参数和 optimizer version。
- [ ] 14.3 对当前参数与候选参数比较 calibration、log loss 或项目选定的预测指标，并增加参数边界 sanity checks。
- [ ] 14.4 数据不足或 holdout 未改善时只生成拒绝报告，不产生可发布候选。
- [ ] 14.5 候选通过时生成影响预览和待确认 `PolicyCandidate`，不得自动改写全部 due date。
- [ ] 14.6 实现手动发布、版本回滚和新旧参数审计；发布后只按明确策略影响未来 scheduling。

## 15. 收尾、兼容清理与整体验收

- [x] 15.1 更新 README/PROJECT_MAP 与 SRS 文档，纠正任何“五级评分”或“所有新词立即入队”的过时说明。
- [ ] 15.2 运行所有新增 focused verification、受影响现有 verification、`npm run build` 和 `npm run verify:vite`。
- [ ] 15.3 使用迁移前 snapshot 做 dry-run、部分 reassessment、回滚、再恢复演练，比较 word/context/reviewLog 数量与 hash。
- [ ] 15.4 验证无 IndexedDB version/object store 变化，无受版权保护例句进入仓库，无 AI 运行时硬依赖。
- [ ] 15.5 全部调用方迁移后删除 legacy 隐式建卡 adapter，并增加永久 guard 防止重新引入。
- [ ] 15.6 在真实使用观察期结束后，记录 `once_daily`、`balanced`、`intensive` 的耗时与跨日效果，再决定是否调整默认 mode。

## 16. Wave B：个性化学习指导 shadow 集成

- [x] 16.1 建立 personalization 统一导出与版本化适配边界，统一 plain-object、错误码和未知字段处理，不让四个独立模块直接依赖运行时仓库。
- [x] 16.2 实现只读 `LearningEvent` 适配器，从现有合格事件重建 skill/preference 输入；缺失 skill tag 或 presentation metadata 时必须显式降级，不得猜测为知识缺陷。
- [x] 16.3 实现 shadow planner：在现有固定 `SessionLedger` 旁生成个性化计划与逐项差异报告，只观察、不改队列、不改 due date、不创建 `ReviewState`。
- [x] 16.4 将 shadow 报告作为可重建派生缓存保存在现有 `files` object store 的独立 row；保持 `SeekPlayerDB` version 1 与现有 schema 不变。
- [x] 16.5 在 `SrsReviewServiceV2.startReviewSession()` 增加默认关闭、故障隔离的 shadow hook；无论 shadow 成功或失败，调用方收到的正式 ledger 必须完全一致。
- [x] 16.6 增加 focused verification、统一 package scripts、无运行时 AI/无 schema 升级 guard，并通过相关回归、build 与 Vite 验证。

## 17. Wave B2：只读 shadow 诊断页

- [x] 17.1 扩展 shadow 派生报告，保存可重建的 skill/preference 模型快照与学习单元显示标签，并为报告 repository 增加只读最近报告查询。
- [x] 17.2 新增纯诊断 view-model，将正式队列、shadow 建议、位置变化、技能证据、偏好证据和数据不足状态转换为可解释展示数据。
- [x] 17.3 新增独立 Vue 诊断页，支持会话选择、刷新、变化项选择、空状态和错误状态；页面只读且不得提供发布、改队、改 due date 或修改评分的操作。
- [x] 17.4 增加 Vite 多页入口和复习页“模型观察”入口，沿用现有 SRS 蓝灰视觉体系并支持窄屏布局。
- [x] 17.5 增加 focused verification 与浏览器验收，覆盖报告重建、默认关闭、队列不变、真实 IndexedDB schema guard、桌面/移动端渲染、build 和 Vite 加载。
