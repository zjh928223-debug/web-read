# 个性化学习指导层：详细规划与并行执行手册

## 1. 目标与非目标

目标不是让用户每天机械地重复同一个词，也不是让一个“老虎机”单独决定学习内容。目标是建立一个可持续替换的学习指导层：

1. 初次预习只完成一次低压力理解：看到词形、主要词义和一条能读懂的真实句子。
2. 跨日记忆仍由现有 FSRS 管理，并以 `word + target sense` 的 `LearningUnit` 为单位。
3. 系统从长期反馈中判断用户在词性、词形、义项、搭配和语境迁移等方面的薄弱点。
4. 课程规划器必须覆盖重要薄弱项；用户不喜欢某类内容，不能成为永久回避它的理由。
5. 偏好模型只选择呈现方式，让必须学的内容更容易接受。
6. 所有模型都能替换、回放、比较和回滚，不把某个算法永久焊死在数据结构里。

本阶段不做以下事情：

- 不改变 `SeekPlayerDB` version 1 或 `files` object store。
- 不批量重排已有 FSRS due date，不改写历史 rating。
- 不把 AI 现编句子冒充真实语料。
- 不立即实现复杂强化学习、深度模型或在线自动调参。
- 不直接改 `reader-runtime.js`、`session-init.js` 或共享 UI 入口。

## 2. 决策分层

一次学习会话的决策顺序固定为：

```text
真实事件与内容证据
  -> MemoryEstimator：这个词义什么时候到期（现有 FSRS）
  -> SkillEstimator：用户在哪类知识上薄弱、证据有多充分
  -> CurriculumPlanner：本次必须覆盖哪些到期项和薄弱项
  -> PresentationRanker：对已选内容采用哪种呈现形式
  -> ContentValidator：句子与义项是否真实、匹配、可用
  -> SessionPlan：固定版本、理由、配额和确定性顺序
```

四个边界不得混淆：

- `MemoryEstimator` 不决定用户喜欢什么。
- `SkillEstimator` 只估计掌握度，不直接排课。
- `CurriculumPlanner` 对学习内容拥有最终约束权。
- `PresentationRanker` 只能在允许的形式中排序，不能删除必学内容。

## 3. 稳定数据与可替换模型

### 3.1 永久保留的数据

现有 append-only `LearningEvent` 是事实层。后续事件或 event extension 至少能够表达：

- `learning_unit_id`、`word_id`、`target_sense_key`
- `skill_tags`
- `prompt_mode`、`presentation_variant`、`cue_level`
- `rating`、是否揭示答案、是否跳过、是否主动重播
- `active_duration_ms`、首次操作延迟和完成状态
- `policy_version`、`scheduler_version`、`content_version`
- 未来新增的 `knowledge_schema_version`、`skill_estimator_version`、`preference_model_version`

原始事件只追加或用 correction event 纠正。任何统计、掌握度、偏好向量和 session plan 都是可删除重建的派生状态。

### 3.2 第一版公共对象形状

并行任务使用普通对象交接，不要求第一波就建立共享基类：

```js
SkillEvidence = {
  learning_unit_id,
  occurred_at,
  skill_tags: ['pos.verb', 'morphology.irregular'],
  outcome: 'success' | 'partial' | 'failure' | 'skip',
  weight,
  exclusions: []
}

SkillEstimate = {
  skill_id,
  mastery_mean,
  uncertainty,
  eligible_evidence_count,
  last_observed_at,
  estimator_version
}

PresentationCandidate = {
  variant_id,
  features: {
    modality,
    context_level,
    interaction,
    sentence_difficulty_band
  }
}

CurriculumCandidate = {
  learning_unit_id,
  due_at,
  memory_priority,
  skill_tags,
  importance,
  estimated_duration_ms,
  allowed_presentations,
  content_status
}

PlanDecision = {
  learning_unit_id,
  selected_presentation,
  reasons,
  constraint_hits,
  score_components,
  model_versions
}
```

## 4. 第一版模型选择

### 4.1 记忆模型

继续使用现有 FSRS。它处理每个已毕业 `LearningUnit` 的记忆状态和跨日到期，不承担技能诊断或呈现偏好学习。

### 4.2 技能诊断模型

第一版使用带先验和平滑的加权 Beta 估计，而不是立即上 BKT/PFA：

- `success`、`partial`、`failure` 对 alpha/beta 贡献不同权重。
- 强提示、答案已揭示、异常耗时和 legacy 数据降低权重或排除。
- 输出均值、样本量和不确定性；数据不足时明确显示不确定，而不是假装精确。
- 词性、词形和其他技能共享相同接口，后续可替换为带时间衰减的 BKT/PFA。

初始技能 taxonomy：

- `pos.noun`、`pos.verb`、`pos.adjective`、`pos.adverb`
- `morphology.inflection`、`morphology.derivation`、`morphology.irregular`
- `sense.primary`、`sense.secondary`
- `usage.collocation`
- `usage.context_transfer`

### 4.3 内容规划模型

第一版是确定性的受约束排序，不是纯老虎机：

- 硬约束：已到期项目、最低薄弱技能覆盖、时间预算、内容可用性、同日上限。
- 软分数：记忆紧迫度、技能缺口、考试/通用重要性、新颖度、疲劳成本。
- 偏好只以有上限的小权重参与，不能抵消硬约束。
- 相同输入、版本和随机种子必须得到相同计划，并给出逐项理由。

### 4.4 呈现偏好模型

第一版使用带平滑的分组平均/线性打分，学习的是“哪种形式更适合”，不是“哪些内容可以不学”。可观察信号包括跳过、完成、揭示延迟、主动重播、耗时异常和评分，但必须区分：

- 不喜欢某种形式；
- 某类知识确实不会；
- 句子本身过难或内容证据不合格。

积累足够样本后，可在相同接口下替换成 constrained LinUCB。老虎机只在 `CurriculumPlanner` 已经选定的必学内容上探索呈现形式，并保留探索上限、最低内容覆盖和确定性 fallback。

## 5. 主要词义与句子来源

### 5.1 主要词义

候选义项按 lemma 与 POS 分开，综合三类证据：

1. 学习型词典的义项顺序。
2. Open English WordNet/WordNet 的 most-frequent-sense 证据。
3. 通用语料与考试领域语料的义项分布。

默认要求至少两类证据一致。若证据冲突或 POS 不明确，标记 `unresolved`，不向用户展示一串同权重中文释义。ECDICT 的 whole-word frequency 只能帮助判断这个词是否常见，不能判断哪个 sense 最常见。

### 5.2 句子来源优先级

1. 用户自己拥有或导入的文章、字幕和笔记。
2. 可再分发的开放语料，例如 VOA Learning English、Simple English Wikipedia、Open English WordNet 例证，以及经过许可过滤的 Tatoeba。
3. 具有明确许可和来源字段的词典例句。
4. IELTS/剑雅原句只在该词主要义项已经熟悉后作为高难迁移材料，并保留在用户本地，不进入可分发仓库。

AI 可以做检索查询生成、候选排序、中文解释和难度分析。AI 生成句只能明确标为 `generated` 辅助材料，默认不能成为 `validated authentic anchor`。

第一版句子排序至少考虑：目标义项匹配、来源/许可、句长、从句深度、非目标生词比例、能否脱离长段落理解。预习优先短而自然的单句；复杂原文延后到熟练后的迁移阶段。

## 6. 并行工作波次

### Wave A：四个独立核心（现在并行）

四个任务只能新增各自模块、fixture 和直接运行的 verification，不修改 `package.json`、共享 vocabulary index、现有事件模型、service、Pinia/Vue 或 runtime 文件。

| 任务 | 文件所有权 | 交付 |
|---|---|---|
| PL-A 内容证据 | `personalization/primary-sense-policy.js`、`sentence-source-policy.js`、`sentence-candidate-ranking.js`；对应 fixture/verification | 主要义项共识、来源许可校验、可理解句排序、确定性理由 |
| PL-B 技能诊断 | `personalization/skill-taxonomy.js`、`skill-evidence.js`、`skill-estimator.js`；对应 fixture/verification | taxonomy、事件到证据转换、平滑掌握度与不确定性 |
| PL-C 呈现偏好 | `personalization/presentation-features.js`、`preference-estimator.js`、`presentation-ranker.js`；对应 fixture/verification | 偏好/能力混淆保护、形式排序、边界与 fallback |
| PL-D 课程规划 | `personalization/curriculum-planner.js`、`curriculum-constraints.js`；对应 fixture/verification | 时间预算、薄弱项最低覆盖、偏好权重上限、可解释确定性计划 |

目录统一为 `src/services/vocabulary/personalization/`。Verification 文件命名为 `scripts/verify-vocabulary-personalization-<area>.mjs`，fixture 放入 `scripts/fixtures/`。每个任务必须用 `node scripts/...` 自验，并报告公开接口和集成假设。

### Wave B：契约统一与 shadow mode 集成

等 PL-A 至 PL-D 全部完成并审查后，只开一个 integration owner：

1. 统一四个模块的对象校验、版本名和错误语义。
2. 从现有 `LearningEvent` 只读构建技能与偏好证据；不得改历史事件。
3. 在现有 review planner 旁运行 shadow plan，只记录比较报告，不影响用户队列。
4. 增加派生缓存时仍写入现有 `files` store，缓存删除后必须可重建。
5. 统一添加 package scripts、共享 export 和 schema/no-runtime-AI guards。

### Wave C：可见反馈与有限控制

先让用户看到而不自动接管：

- 展示“为什么选这个词”“本次覆盖了哪个薄弱项”“为什么采用这种形式”。
- 提供轻量反馈：太难、太简单、不喜欢这种形式、内容有误。
- 反馈写为事件，不直接手改模型权重。
- 用户试用并确认 shadow plan 合理后，feature flag 才允许 `CurriculumPlanner` 控制未来 session 的队列选择。

### Wave D：模型替换与离线评估

只有在跨日合格样本达到门槛后才比较：

- Beta baseline 与 BKT/PFA 技能估计。
- 静态/线性偏好 baseline 与 constrained LinUCB。
- 当前 planner 与候选 planner 的 retention、完成率、时间负担、薄弱项覆盖和校准。

必须按时间切分 train/validation/holdout，记录事件 hash 与所有版本。候选不改善时只生成拒绝报告；通过时也必须人工发布，并且只影响未来决策。

## 7. Wave A 统一验收门槛

每个并行任务都必须满足：

- 纯函数核心不读取 `window`、DOM、IndexedDB 或网络。
- 相同输入得到相同输出，tie-break 有固定规则。
- 无 AI 运行时硬依赖，无受版权保护句子写入 fixture。
- 输入不可变；返回结果包含 version 和可解释 reasons。
- 空数据、小样本、冲突证据、异常耗时与全部候选不合格均有测试。
- 不修改 IndexedDB schema，不批量重排 due date，不创建 review card。
- 不越过文件所有权；发现需要共享入口时写入 handoff，留给 Wave B。

## 8. 合并顺序与协调

建议按 `PL-A -> PL-B -> PL-C -> PL-D` 顺序审查，但四者可以从同一干净基线同时开发。合并每项后先运行其 focused verification；四项全部合并后运行：

```bash
npm run build
npm run verify:vite
node scripts/vocabulary-learning-events-check.cjs
node scripts/srs-review-policy-planner-check.cjs
node scripts/srs-review-service-v2-check.cjs
```

Wave B 开始前必须检查四个 handoff 的对象字段、版本命名和失败语义。若存在冲突，由 integration owner 写单一 adapter，不让多个并行任务反复修改共享入口。

## 9. 产品验收场景

最终能力必须覆盖这些实际情形：

1. 首次看到陌生词，只显示主要词义和一条低生词率真实句子，不要求当天再见。
2. 用户经常跳过动词变化练习：系统仍安排必要的动词/词形内容，但改用更易接受的呈现形式。
3. 用户对某个 primary sense 已稳定：系统才逐渐引入 secondary sense 和更复杂原文。
4. 原始 IELTS 句含十多个生词：不用于第一次预习，留到 context-transfer 阶段。
5. 更换技能或偏好模型后，从同一事件日志重建；历史与 FSRS 状态不丢失。
6. 新模型效果差时关闭 feature flag，立即回到确定性 baseline，不需要从零开始。
