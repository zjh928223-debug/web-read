# P0 跨模块契约

状态：P0 契约冻结；P1–P5 仍受真实快照与 worktree gate 阻塞
契约族：`vocabulary-learning-contracts.v1`
字段命名：持久化 row、事件和 DTO 一律 `snake_case`

## 规范约定

- 下表“必需=是”表示持久化对象必须包含该 key；“可空=是”表示值可为 `null`，不得用缺失 key 代替。
- 默认值由 `normalize*` 在写入前物化；`assert*` 不补默认值，只校验完整对象。
- ID 是不透明、非空、大小写敏感字符串。时间是带 `Z` 的 UTC ISO-8601。`local_day` 必须同时携带 IANA `timezone`。
- 未知 major `schema_version` 报 `UNSUPPORTED_SCHEMA_VERSION`。未知字段只允许放在 `extensions`。
- repository 输入与输出均深拷贝；任何失败不得留下部分写入。
- 所有业务 row 固定使用 `SeekPlayerDB`、version `1`、`files` object store、`keyPath: "id"`；公开工厂不得接受 DB 名、version、store 名或 keyPath override。
- `learning_unit_id` 是 acquisition/review 身份；`word_id` 只关联共享 VocabularyEntry。

## 稳定错误

所有跨模块错误必须是 `{ code, message, details }`；`details` 不得包含用户正文或答案。

| code | 触发条件 |
|---|---|
| `UNSUPPORTED_SCHEMA_VERSION` | 未知 major schema |
| `MISSING_REQUIRED_FIELD` | 必需 key 缺失 |
| `INVALID_FIELD_TYPE` | 类型错误 |
| `INVALID_ENUM_VALUE` | 枚举值错误 |
| `INVALID_TIMESTAMP` | 时间无效或非 UTC |
| `INVALID_STATE_TRANSITION` | acquisition/review 非法迁移 |
| `DUPLICATE_TARGET_SENSE` | 同一 active `(word_id, target_sense_key)` 已存在 |
| `INVALID_CONTEXT_REFERENCE` | context 不属于当前 unit |
| `NO_VALIDATED_ANCHOR` | 缺少 validated anchor |
| `DELAY_POLICY_NOT_SATISFIED` | 延迟或跨 episode 条件不满足 |
| `ANSWER_REVEALED` | 评分前已揭示答案 |
| `RATING_NOT_ELIGIBLE` | rating 为 `again` 或缺失 |
| `REVIEW_STATE_BEFORE_GRADUATION` | 未毕业 unit 创建 ReviewState |
| `REVIEW_STATE_ALREADY_EXISTS` | unit 已有 active ReviewState |
| `UNKNOWN_REVIEW_STATE` | legacy state 枚举未知；不得自动转换 |
| `IDEMPOTENCY_CONFLICT` | 同 command/attempt/event ID 的 fingerprint 不同 |
| `CONCURRENT_MODIFICATION` | expected revision 不匹配 |
| `INVALID_EVENT_PARTITION` | event partition 不符合冻结格式 |
| `TRANSACTION_ABORTED` | UoW 任一步失败 |

## Target sense 与唯一性决策

同一 `word_id` **允许同时存在多个 active target senses**。P1 不得建立 `word_id` 单列唯一约束。

`target_sense_key` 由以下纯函数产生：

```text
target-sense-key.v1:
  NFKC(language).lowercase()
  + "\u001f" + NFKC(part_of_speech ?? "").trim().lowercase()
  + "\u001f" + NFKC(normalized_gloss).trim().replace(/\s+/g, " ").lowercase()
```

唯一约束是 active `(word_id, target_sense_key)`；`archived_at != null` 的 unit 不参与唯一性。candidate 尚未选义项时 `target_sense_key = null`，由不透明 `learning_unit_id` 区分。义项选择必须在同一 transaction 内检查冲突。

## `LearningUnit` — `learning-unit.v1`

| 字段 | 类型 | 必需 | 可空 | 默认/约束 |
|---|---|---:|---:|---|
| `schema_version` | string | 是 | 否 | 固定 `learning-unit.v1` |
| `learning_unit_id` | ID | 是 | 否 | 创建后不可变 |
| `word_id` | ID | 是 | 否 | 创建后不可变 |
| `normalized_form` | string | 是 | 否 | 非空，NFKC |
| `language` | string | 是 | 否 | 小写 BCP-47 |
| `target_sense_id` | ID | 是 | 是 | candidate 可为 `null` |
| `target_sense_key` | string | 是 | 是 | 按 `target-sense-key.v1` 计算 |
| `target_sense` | `TargetSense` | 是 | 是 | introduced 起不得为 `null` |
| `created_at` | UTC timestamp | 是 | 否 | 不可变 |
| `updated_at` | UTC timestamp | 是 | 否 | 不早于 `created_at` |
| `archived_at` | UTC timestamp | 是 | 是 | 默认 `null` |
| `revision` | integer | 是 | 否 | 默认 `0`，每次写入 +1 |
| `extensions` | object | 是 | 否 | 默认 `{}` |

`TargetSense` 的完整字段为：`gloss: string`、`normalized_gloss: string`、`part_of_speech: string|null`、`definition: string|null`、`language: string`；全部 key 必需。每个 unit 恰有一个 AcquisitionState，毕业前不得存在 ReviewState。

## `AcquisitionState` — `acquisition-state.v1`

| 字段 | 类型 | 必需 | 可空 | 默认/约束 |
|---|---|---:|---:|---|
| `schema_version` | string | 是 | 否 | 固定 `acquisition-state.v1` |
| `learning_unit_id` | ID | 是 | 否 | map key 必须相同 |
| `status` | enum | 是 | 否 | 见下方状态机 |
| `context_evidence_ids` | ID[] | 是 | 否 | 默认 `[]`，无重复 |
| `validated_anchor_id` | ID | 是 | 是 | 默认 `null` |
| `last_acquisition_attempt_id` | ID | 是 | 是 | 默认 `null` |
| `introduction_episode_id` | ID | 是 | 是 | introduced 起必需 |
| `introduced_at` | UTC timestamp | 是 | 是 | 默认 `null` |
| `last_exposure_at` | UTC timestamp | 是 | 是 | 默认 `null` |
| `ready_for_check_at` | UTC timestamp | 是 | 是 | 默认 `null` |
| `graduated_at` | UTC timestamp | 是 | 是 | 仅 graduated 非空 |
| `skipped_at` | UTC timestamp | 是 | 是 | 仅 skipped 非空 |
| `revision` | integer | 是 | 否 | 默认 `0` |
| `extensions` | object | 是 | 否 | 默认 `{}` |

```text
candidate -> introduced -> acquiring -> ready_for_check -> graduated
candidate|introduced|acquiring|ready_for_check -> skipped
```

`graduated`、`skipped` 是终态。anchor 必须引用同 unit 且 `quality_status=validated` 的 ContextEvidence。

## `ContextEvidence` — `context-evidence.v1`

| 字段 | 类型 | 必需 | 可空 | 默认/约束 |
|---|---|---:|---:|---|
| `schema_version` | string | 是 | 否 | 固定 `context-evidence.v1` |
| `context_evidence_id` | ID | 是 | 否 | 不可变 |
| `learning_unit_id` | ID | 是 | 否 | 不可变 |
| `sentence` | string | 是 | 否 | 非空 |
| `surrounding_text` | string | 是 | 是 | 默认 `null` |
| `content_sha256` | lowercase hex64 | 是 | 否 | 对规范化 sentence + surrounding text |
| `source_kind` | enum | 是 | 否 | 见下 |
| `source_id` | ID | 是 | 是 | 默认 `null` |
| `source_title` | string | 是 | 是 | 默认 `null` |
| `source_locator` | object | 是 | 否 | 至少含 `locator_version` |
| `license_kind` | enum | 是 | 否 | 见下 |
| `ownership` | enum | 是 | 否 | 见下 |
| `quality_status` | enum | 是 | 否 | 默认 `pending` |
| `quality_reason` | string | 是 | 是 | 默认 `null` |
| `created_at` | UTC timestamp | 是 | 否 | 不可变 |
| `validated_at` | UTC timestamp | 是 | 是 | validated 时必需 |
| `revision` | integer | 是 | 否 | 默认 `0`，每次写入 +1 |
| `extensions` | object | 是 | 否 | 默认 `{}` |

- `source_kind`: `article/subtitle/user_local_exam_material/open_corpus/dictionary_example/ai_candidate`
- `license_kind`: `user_owned/licensed_open/dictionary_terms/ai_generated/unknown`
- `ownership`: `user/private/third_party/public`
- `quality_status`: `pending/validated/rejected`
- `source_locator.locator_version` 固定 `source-locator.v1`。
- 去重键：`learning_unit_id + content_sha256 + source_id + canonical_json(source_locator)`。
- unknown license、未知来源和 AI 默认 pending。默认导出不含本地/版权材料正文。

存储 row ID 固定为 `vocabulary.context-evidence.store.v1`，content 固定为：

```ts
type ContextEvidenceStoreV1 = {
  schema_version: "context-evidence-store.v1"
  by_context_evidence_id: Record<string, ContextEvidence>
}
```

map key 必须等于 value 的 `context_evidence_id`。P2 同时提供普通 repository 和绑定到
外部 transaction 的 adapter；绑定版不得自行打开 DB/transaction：

```ts
ContextEvidenceTransactionRepository.getById(
  context_evidence_id: string
): Promise<ContextEvidence|null>
ContextEvidenceTransactionRepository.listByLearningUnit(
  learning_unit_id: string
): Promise<ContextEvidence[]>
ContextEvidenceTransactionRepository.put(
  evidence: ContextEvidence,
  expected_revision: number|null
): Promise<ContextEvidence>
```

## `AcquisitionAttempt` — `acquisition-attempt.v1`

| 字段 | 类型 | 必需 | 可空 | 默认/约束 |
|---|---|---:|---:|---|
| `schema_version` | string | 是 | 否 | 固定 `acquisition-attempt.v1` |
| `attempt_id` | ID | 是 | 否 | 幂等键 |
| `command_id` | ID | 是 | 否 | 指向 CommandReceipt |
| `correlation_id` | ID | 是 | 否 | 跨事件关联 |
| `learning_unit_id` | ID | 是 | 否 | 必需 |
| `target_sense_id` | ID | 是 | 否 | delayed check 必需 |
| `attempt_kind` | enum | 是 | 否 | `exposure/delayed_check/reassessment` |
| `episode_id` | ID | 是 | 否 | 本次 acquisition episode |
| `session_id` | ID | 是 | 是 | 默认 `null` |
| `session_position` | integer | 是 | 是 | 默认 `null`，非负 |
| `occurred_at` | UTC timestamp | 是 | 否 | 用户动作时间 |
| `recorded_at` | UTC timestamp | 是 | 否 | 不早于 occurred |
| `prompt_mode` | enum | 是 | 否 | `word_only/original_context/transfer_context` |
| `cue_level` | enum | 是 | 否 | 见 ReviewAttempt |
| `rating` | enum | 是 | 是 | exposure 可 `null`；否则四级 |
| `answer_revealed_before_rating` | boolean | 是 | 否 | 默认 `false` |
| `context_evidence_id` | ID | 是 | 是 | 默认 `null` |
| `duration_ms` | integer | 是 | 否 | 非负 |
| `active_duration_ms` | integer | 是 | 否 | `0..duration_ms` |
| `graduation_eligibility` | `GraduationEligibility` | 是 | 是 | delayed check 必需 |
| `extensions` | object | 是 | 否 | 默认 `{}` |

### `GraduationEligibility` — `graduation-eligibility.v1`

| 字段 | 类型 | 必需 | 可空 | 默认/约束 |
|---|---|---:|---:|---|
| `schema_version` | string | 是 | 否 | 固定 `graduation-eligibility.v1` |
| `delay_policy_version` | string | 是 | 否 | 固定 `acquisition-delay.v1` |
| `eligible` | boolean | 是 | 否 | 下述条件的纯函数结果 |
| `reason_codes` | string[] | 是 | 否 | 默认 `[]`，排序稳定 |
| `target_sense_present` | boolean | 是 | 否 | 必须 true |
| `validated_anchor_present` | boolean | 是 | 否 | 必须 true |
| `delayed_from_introduction` | boolean | 是 | 否 | 按 v1 规则 |
| `answer_unrevealed` | boolean | 是 | 否 | 必须 true |
| `rating_eligible` | boolean | 是 | 否 | rating 非 `again` |
| `introduction_occurred_at` | UTC timestamp | 是 | 是 | 来自 AcquisitionState；缺失为 `null` |
| `attempt_occurred_at` | UTC timestamp | 是 | 否 | 来自 attempt |
| `introduction_episode_id` | ID | 是 | 是 | 来自 AcquisitionState；缺失为 `null` |
| `attempt_episode_id` | ID | 是 | 否 | 来自 attempt |
| `elapsed_ms` | integer | 是 | 是 | 可计算时为 attempt - introduction，否则 `null` |
| `minimum_delay_ms` | integer | 是 | 否 | 固定 `86400000` |
| `evaluated_at` | UTC timestamp | 是 | 否 | 必须由 evaluator 调用方显式传入 |

`acquisition-delay.v1` 的判定固定为：

```text
delayed_from_introduction =
  elapsed_ms >= 86_400_000
  AND introduction_episode_id != attempt_episode_id
```

时区和日历日不参与计算。`eligible` 当且仅当 target sense、validated anchor、delay、answer
unrevealed、rating eligible 五项全 true。graduation 必须复制已持久化 attempt 的 eligibility，
不得重新计算或重新解释。

`GraduationEligibilityInput` 固定为：

```ts
type GraduationEligibilityInput = {
  learning_unit: LearningUnit
  acquisition_state: AcquisitionState
  validated_anchor: ContextEvidence|null
  attempt: {
    attempt_id: string
    learning_unit_id: string
    target_sense_id: string
    episode_id: string
    occurred_at: string
    rating: "again"|"hard"|"good"|"easy"|null
    answer_revealed_before_rating: boolean
    context_evidence_id: string|null
  }
  evaluated_at: string
}
```

`evaluated_at` 来自 UoW dependency `now()`：P6 在 transaction callback 读取完相关 rows 后只调用
一次，将结果作为 evaluator 输入并原样保存。evaluator 本身不得读取系统时钟；回放时使用事件中
已保存的 `evaluated_at`。

`reason_codes` 只允许下列值，并按此顺序过滤输出所有适用原因：

```text
LEARNING_UNIT_MISMATCH
TARGET_SENSE_MISSING
TARGET_SENSE_MISMATCH
VALIDATED_ANCHOR_MISSING
ANCHOR_LEARNING_UNIT_MISMATCH
ANCHOR_NOT_VALIDATED
CONTEXT_EVIDENCE_MISMATCH
INTRODUCTION_TIMESTAMP_MISSING
ATTEMPT_BEFORE_INTRODUCTION
INTRODUCTION_EPISODE_MISSING
ATTEMPT_EPISODE_MISSING
SAME_ACQUISITION_EPISODE
MINIMUM_DELAY_NOT_REACHED
ANSWER_REVEALED_BEFORE_RATING
RATING_MISSING
RATING_AGAIN
```

时间或 ID 字段格式错误在 evaluator 之前由 `assert*` 报稳定 ContractError，不进入 reason
codes。缺 introduction 时间/episode 是合法的“尚未具备资格”输入，分别产生上述缺失原因。
`elapsed_ms=null` 时 `delayed_from_introduction=false`；时间倒序同时产生
`ATTEMPT_BEFORE_INTRODUCTION`，不足 24 小时但非倒序产生 `MINIMUM_DELAY_NOT_REACHED`。

## `ReviewState` — `review-state.v2`

存储 row ID 固定 `vocabulary.review.store.v2`，content schema 固定 `review-store.v2`：

```text
{ schema_version: "review-store.v2", by_learning_unit_id: Record<ID, ReviewState> }
```

| 字段 | 类型 | 必需 | 可空 | 默认/约束 |
|---|---|---:|---:|---|
| `schema_version` | string | 是 | 否 | 固定 `review-state.v2` |
| `review_state_id` | ID | 是 | 否 | 不可变 |
| `learning_unit_id` | ID | 是 | 否 | map key 必须相同 |
| `word_id` | ID | 是 | 否 | 冗余关联，不是 identity |
| `state` | enum | 是 | 否 | `new/learning/review/relearning` |
| `due_at` | UTC timestamp | 是 | 否 | 必需 |
| `stability` | finite number | 是 | 否 | 非负 |
| `difficulty` | finite number | 是 | 否 | scheduler 合法范围 |
| `elapsed_days` | integer | 是 | 否 | 非负 |
| `scheduled_days` | integer | 是 | 否 | 非负 |
| `reps` | integer | 是 | 否 | 非负 |
| `lapses` | integer | 是 | 否 | 非负 |
| `learning_steps` | integer | 是 | 否 | 非负 |
| `last_review_at` | UTC timestamp | 是 | 是 | initial 可 `null` |
| `scheduler_version` | string | 是 | 否 | 非空 |
| `scheduler_parameters_version` | string | 是 | 否 | 非空 |
| `created_at` | UTC timestamp | 是 | 否 | 不可变 |
| `updated_at` | UTC timestamp | 是 | 否 | 不早于 created |
| `revision` | integer | 是 | 否 | 默认 `0` |
| `extensions` | object | 是 | 否 | 默认 `{}` |

每个 unit 最多一个 active state。initial state 只能由 successful graduation 或 explicit legacy reassessment 创建。新状态不得写回 `vocabulary.srs.store.v1.reviewStates`。

## `ReviewAttempt` — `review-attempt.v1`

| 字段 | 类型 | 必需 | 可空 | 默认/约束 |
|---|---|---:|---:|---|
| `schema_version` | string | 是 | 否 | 固定 `review-attempt.v1` |
| `attempt_id` | ID | 是 | 否 | attempt 幂等键 |
| `command_id` | ID | 是 | 否 | 指向 CommandReceipt |
| `correlation_id` | ID | 是 | 否 | 跨事件关联 |
| `session_id` | ID | 是 | 否 | 必需 |
| `session_position` | integer | 是 | 否 | 非负 |
| `learning_unit_id` | ID | 是 | 否 | 已毕业 unit |
| `occurred_at` | UTC timestamp | 是 | 否 | 用户动作时间 |
| `recorded_at` | UTC timestamp | 是 | 否 | 不早于 occurred |
| `prompt_mode` | enum | 是 | 否 | `word_only/original_context/transfer_context` |
| `cue_level` | enum | 是 | 否 | `none/target_sentence/surrounding_context/morphology_or_pos/translation` |
| `rating` | enum | 是 | 否 | `again/hard/good/easy` |
| `answer_revealed_before_rating` | boolean | 是 | 否 | 默认 `false` |
| `duration_ms` | integer | 是 | 否 | 非负 |
| `active_duration_ms` | integer | 是 | 否 | `0..duration_ms` |
| `context_evidence_id` | ID | 是 | 是 | 默认 `null` |
| `before_state` | `ReviewState` | 是 | 否 | 完整调度前快照 |
| `after_state` | `ReviewState` | 是 | 否 | 完整调度后快照 |
| `scheduler_version` | string | 是 | 否 | 非空 |
| `policy_version` | string | 是 | 否 | 非空 |
| `is_revisit` | boolean | 是 | 否 | 默认 `false` |
| `extensions` | object | 是 | 否 | 默认 `{}` |

attempt ID 重试不得重复调度。prompt/cue/answer reveal 仅作为元数据，rating 才进入 scheduler。

## `SessionLedger` — `session-ledger.v1`

| 字段 | 类型 | 必需 | 可空 | 默认/约束 |
|---|---|---:|---:|---|
| `schema_version` | string | 是 | 否 | 固定 `session-ledger.v1` |
| `session_id` | ID | 是 | 否 | 不可变 |
| `created_at` | UTC timestamp | 是 | 否 | 不可变 |
| `local_day` | `YYYY-MM-DD` | 是 | 否 | 与 timezone 成对 |
| `timezone` | IANA timezone | 是 | 否 | 必需 |
| `policy_version` | string | 是 | 否 | 固化 |
| `mode` | enum | 是 | 否 | `once_daily/balanced/intensive` |
| `budget_ms` | integer | 是 | 否 | 默认 `3600000` |
| `estimated_attempt_ms` | integer | 是 | 否 | 无数据默认 `36000` |
| `entries` | `LedgerEntry[]` | 是 | 否 | 默认 `[]` |
| `cursor` | integer | 是 | 否 | 默认 `0`，不大于 entries.length |
| `status` | enum | 是 | 否 | `planned/active/paused/completed/abandoned` |
| `backlog` | `SessionBacklog` | 是 | 否 | 完整对象 |
| `revision` | integer | 是 | 否 | 默认 `0` |
| `extensions` | object | 是 | 否 | 默认 `{}` |

`LedgerEntry` 全字段：`ledger_item_id: ID`、`position: integer`、`queue_kind: due_review|relearning|revisit|reassessment|acquisition`、`learning_unit_id: ID`、`enqueue_reason: string`、`estimated_duration_ms: integer`、`planned_due_at: UTC timestamp|null`、`revisit_ordinal: integer`、`extensions: object`；全部 key 必需。

`SessionBacklog` 全字段：`due_review_count`、`relearning_count`、`reassessment_count`、`acquisition_count`、`estimated_ms` 均为非负 integer，另含必需 `extensions: object`。已有 entry 不重排；设置变化只影响下一 session。

## `LearningEvent` — `learning-event.v1`

| 字段 | 类型 | 必需 | 可空 | 默认/约束 |
|---|---|---:|---:|---|
| `schema_version` | string | 是 | 否 | 固定 `learning-event.v1` |
| `event_id` | ID | 是 | 否 | event 幂等键 |
| `command_id` | ID | 是 | 否 | 指向 CommandReceipt |
| `correlation_id` | ID | 是 | 否 | 跨事件关联 |
| `event_type` | string enum | 是 | 否 | registry 中的稳定类型 |
| `attempt_id` | ID | 是 | 是 | attempt 事件必需 |
| `occurred_at` | UTC timestamp | 是 | 否 | 业务发生时间 |
| `recorded_at` | UTC timestamp | 是 | 否 | 不早于 occurred |
| `session_id` | ID | 是 | 是 | 默认 `null` |
| `session_position` | integer | 是 | 是 | 默认 `null` |
| `learning_unit_id` | ID | 是 | 否 | review identity |
| `word_id` | ID | 是 | 否 | VocabularyEntry 关联 |
| `target_sense_id` | ID | 是 | 是 | candidate 事件可空 |
| `policy_version` | string | 是 | 是 | 不适用时 `null` |
| `scheduler_version` | string | 是 | 是 | 不适用时 `null` |
| `content_version` | string | 是 | 是 | 不适用时 `null` |
| `prompt_mode` | enum | 是 | 是 | 非 attempt 为 `null` |
| `cue_level` | enum | 是 | 是 | 非 attempt 为 `null` |
| `rating` | enum | 是 | 是 | 非 attempt 为 `null` |
| `answer_revealed_before_rating` | boolean | 是 | 是 | 非 attempt 为 `null` |
| `graduation_eligibility` | `GraduationEligibility` | 是 | 是 | acquisition/graduation 必需 |
| `duration_ms` | integer | 是 | 是 | 非 attempt 为 `null` |
| `active_duration_ms` | integer | 是 | 是 | 非 attempt 为 `null` |
| `before_state` | object | 是 | 是 | 不适用时 `null` |
| `after_state` | object | 是 | 是 | 不适用时 `null` |
| `source_kind` | enum | 是 | 是 | 默认 `null` |
| `context_evidence_id` | ID | 是 | 是 | 默认 `null` |
| `is_legacy` | boolean | 是 | 否 | 默认 `false` |
| `training_eligible` | boolean | 是 | 否 | 默认 `false` |
| `exclusion_reasons` | string[] | 是 | 否 | 默认 `[]`，排序稳定 |
| `payload` | object | 是 | 否 | 事件类型专属数据 |
| `extensions` | object | 是 | 否 | 默认 `{}` |

事件 append-only；纠错使用 `event_corrected.payload.corrects_event_id`。acquisition attempt 与 graduation event 必须复制同一个 attempt ID、answer reveal 和 eligibility。非 attempt event 的 attempt/reveal/eligibility 字段显式为 `null`。

`event_type` v1 registry 固定为：`candidate_queued`、`target_sense_selected`、`context_attached`、`context_validated`、`acquisition_attempt_recorded`、`acquisition_graduated`、`review_attempt_recorded`、`legacy_reassessed`、`policy_changed`、`event_corrected`。新增类型需要新 registry version，P1–P5 不得私自扩枚举。

## `CommandReceipt` — `command-receipt.v1`

每个 command 使用独立 row，row ID 固定算法：

```text
"vocabulary.learning-command-receipt.v1:" + command_id
```

row 为 `{ id, content, timestamp }`，其中 `content`：

| 字段 | 类型 | 必需 | 可空 | 默认/约束 |
|---|---|---:|---:|---|
| `schema_version` | string | 是 | 否 | 固定 `command-receipt.v1` |
| `command_id` | ID | 是 | 否 | 与 row ID 后缀相同 |
| `command_type` | string | 是 | 否 | 稳定命令类型 |
| `contract_version` | string | 是 | 否 | 固定 `vocabulary-learning-contracts.v1` |
| `payload_fingerprint` | lowercase hex64 | 是 | 否 | 下述算法 |
| `status` | enum | 是 | 否 | 持久化时只允许 `committed` |
| `result` | JSON value | 是 | 否 | 完整规范化 command result |
| `result_sha256` | lowercase hex64 | 是 | 否 | canonical result hash |
| `correlation_id` | ID | 是 | 否 | 必需 |
| `touched_row_ids` | ID[] | 是 | 否 | 排序、去重 |
| `event_ids` | ID[] | 是 | 否 | 排序、去重 |
| `committed_at` | UTC timestamp | 是 | 否 | 最终 puts 排队前生成；成功仍以 `oncomplete` 为准 |
| `extensions` | object | 是 | 否 | 默认 `{}` |

fingerprint 算法固定：

```text
SHA-256(
  UTF-8(
    canonical_json({
      command_type,
      contract_version: "vocabulary-learning-contracts.v1",
      payload
    })
  )
)
```

`canonical_json.v1`：object key Unicode code-point 升序；array 保序；保留显式 `null`；数字必须 finite 且用 JSON 最短十进制；禁止 `undefined`、NaN、Infinity、Date 和自定义 prototype。

跨刷新幂等流程：

1. 在同一 readwrite transaction 首先读取 receipt row。
2. 已存在且 fingerprint 相同：返回 receipt 中深拷贝的 `result`，不执行 callback、不新增 event、不更新 timestamp。
3. 已存在且 fingerprint 不同：abort 并报 `IDEMPOTENCY_CONFLICT`。
4. 不存在：执行 callback，并将 receipt、业务 rows、event manifest/shard 放在同一 transaction。
5. 不持久化 `pending` receipt；transaction abort 后不存在 receipt。

## 共享 IndexedDB unit-of-work

事务版本：`vocabulary-learning-uow.v1`。公开 API 不接受 DB/schema override。

```ts
type VocabularyLearningCommand = {
  command_id: string
  command_type: string
  correlation_id: string
  event_partition: string
  payload: JsonValue
}

runVocabularyLearningUnitOfWork(
  dependencies: {
    indexedDBApi?: IDBFactory
    now?: () => string
  },
  command: VocabularyLearningCommand,
  execute: (uow: VocabularyLearningUnitOfWork) => Promise<JsonValue>
): Promise<JsonValue>

interface VocabularyLearningTransactionRowPort {
  transaction_id: string
  getRow(row_id: string): Promise<FileRow|null>
  putRow(row: FileRow): Promise<void>
  abort(error: ContractError): never
}

interface VocabularyLearningUnitOfWork {
  abort(error: ContractError): never
  acquisition: AcquisitionTransactionRepository
  contexts: ContextEvidenceTransactionRepository
  review: ReviewTransactionRepository
  events: LearningEventTransactionRepository
}

interface AcquisitionTransactionRepository {
  getLearningUnit(learning_unit_id: string): Promise<LearningUnit|null>
  findActiveByWordAndSense(
    word_id: string,
    target_sense_key: string
  ): Promise<LearningUnit|null>
  putLearningUnit(
    unit: LearningUnit,
    expected_revision: number|null
  ): Promise<LearningUnit>
  getState(learning_unit_id: string): Promise<AcquisitionState|null>
  putState(
    state: AcquisitionState,
    expected_revision: number|null
  ): Promise<AcquisitionState>
  getAttempt(attempt_id: string): Promise<AcquisitionAttempt|null>
  putAttempt(attempt: AcquisitionAttempt): Promise<AcquisitionAttempt>
}

interface ContextEvidenceTransactionRepository {
  getById(context_evidence_id: string): Promise<ContextEvidence|null>
  listByLearningUnit(learning_unit_id: string): Promise<ContextEvidence[]>
  put(
    evidence: ContextEvidence,
    expected_revision: number|null
  ): Promise<ContextEvidence>
}

interface ReviewTransactionRepository {
  getByLearningUnitId(learning_unit_id: string): Promise<ReviewState|null>
  putInitial(state: ReviewState): Promise<ReviewState>
  update(state: ReviewState, expected_revision: number): Promise<ReviewState>
}

interface LearningEventTransactionRepository {
  getById(event_id: string): Promise<LearningEvent|null>
  append(event: LearningEvent): Promise<LearningEvent>
}

createVocabularyLearningTransactionRowPort(
  transaction: IDBTransaction,
  transaction_id: string
): VocabularyLearningTransactionRowPort
bindReviewRepositoryToTransaction(
  row_port: VocabularyLearningTransactionRowPort
): ReviewTransactionRepository
assembleVocabularyLearningUnitOfWork(
  row_port: VocabularyLearningTransactionRowPort,
  event_partition: string
): VocabularyLearningUnitOfWork
```

graduation 在同一个 `files` readwrite transaction 原子更新：

1. `vocabulary.acquisition.store.v1`
2. `vocabulary.context-evidence.store.v1`（同 transaction 读取并验证；命令新增/更新证据时才写）
3. `vocabulary.review.store.v2`
4. `vocabulary.learning-events.manifest.v1`
5. transaction 开始前由 `event_partition` 确定的一个 event shard
6. 当前 command 的 `vocabulary.learning-command-receipt.v1:<command_id>`

`event_partition` 固定格式 `YYYY-MM`（UTC occurred_at 所在月）；callback 不得改变。callback 只等待同一 transaction 的 IDB request；禁止网络、timer、AI、嵌套 transaction 或自行 commit 的 repository。只有 `transaction.oncomplete` 可报告成功。in-memory UoW 必须提供同等 all-or-nothing 与失败注入行为。

组装顺序固定且无循环依赖：

1. P6 打开唯一 `files` readwrite transaction。
2. P6 用该 transaction 创建一个 `VocabularyLearningTransactionRowPort`。
3. P6 将同一个 row port 分别传给 P1/P2/P3 binder 和 P6 的 review binder。
4. P6 用四个已绑定 repository 组装 `VocabularyLearningUnitOfWork`，再调用业务 callback。

row port 是唯一可接触原始 `FileRow`/IDB request 的边界；binder 不得接收完整 UoW，不得打开
DB/transaction，也不得 commit。完整 UoW 不暴露 `getRow/putRow`，因此业务 callback 只能通过
已绑定 repository 操作。

## 公共辅助类型

以下名称是 P1–P7 可直接依赖的完整定义；不得以本地同名但不同结构的类型替代。
`IDBFactory` 与 `IDBTransaction` 使用浏览器标准 Web IDL 类型；测试 double 必须实现相同
observable contract。

```ts
type JsonPrimitive = string|number|boolean|null
type JsonValue = JsonPrimitive|JsonValue[]|{ [key: string]: JsonValue }
type FileRow = { id: string, content: JsonValue, timestamp: string }
type TargetSense = {
  gloss: string
  normalized_gloss: string
  part_of_speech: string|null
  definition: string|null
  language: string
}
type ContractError = {
  code:
    |"UNSUPPORTED_SCHEMA_VERSION"|"MISSING_REQUIRED_FIELD"|"INVALID_FIELD_TYPE"
    |"INVALID_ENUM_VALUE"|"INVALID_TIMESTAMP"|"INVALID_STATE_TRANSITION"
    |"DUPLICATE_TARGET_SENSE"|"INVALID_CONTEXT_REFERENCE"|"NO_VALIDATED_ANCHOR"
    |"DELAY_POLICY_NOT_SATISFIED"|"ANSWER_REVEALED"|"RATING_NOT_ELIGIBLE"
    |"REVIEW_STATE_BEFORE_GRADUATION"|"REVIEW_STATE_ALREADY_EXISTS"
    |"UNKNOWN_REVIEW_STATE"|"IDEMPOTENCY_CONFLICT"|"CONCURRENT_MODIFICATION"
    |"INVALID_EVENT_PARTITION"|"TRANSACTION_ABORTED"
  message: string
  details: { [key: string]: JsonValue }
}

type AcquisitionStoreV1 = {
  schema_version: "acquisition-store.v1"
  by_learning_unit_id: Record<string, {
    learning_unit: LearningUnit
    acquisition_state: AcquisitionState
  }>
  acquisition_attempts_by_id: Record<string, AcquisitionAttempt>
}
type AcquisitionRepositorySeed = { store: AcquisitionStoreV1 }

type ContextEvidenceExportV1 = {
  schema_version: "context-evidence-export.v1"
  generated_at: string
  include_user_owned_text: boolean
  items: JsonValue[]
}

type TrainingEligibilityV1 = {
  schema_version: "training-eligibility.v1"
  eligible: boolean
  exclusion_reasons: string[]
}

type ReviewPolicyV1 = {
  schema_version: "review-policy.v1"
  policy_version: string
  mode: "once_daily"|"balanced"|"intensive"
  budget_ms: number
  default_attempt_ms: number
  balanced_revisit_delay_ms: number
  balanced_max_revisits_per_local_day: 1
}
type ReviewPlanningCandidateV1 = {
  learning_unit_id: string
  queue_kind: "due_review"|"relearning"|"revisit"|"reassessment"|"acquisition"
  due_at: string|null
  estimated_duration_ms: number
  enqueue_reason: string
}
type ReviewPlanningInput = {
  now: string
  local_day: string
  timezone: string
  policy: ReviewPolicyV1
  session_id: string
  candidates: readonly ReviewPlanningCandidateV1[]
}
type SameDayRevisitInput = {
  local_day: string
  timezone: string
  mode: ReviewPolicyV1["mode"]
  review_state: ReviewState
  rating: "again"|"hard"|"good"|"easy"
  completed_revisit_count: number
  now: string
}
type SameDayRevisitDecisionV1 = {
  schema_version: "same-day-revisit-decision.v1"
  allowed: boolean
  reason_code: string
  eligible_at: string|null
}
type ActiveSpeedEstimateV1 = {
  schema_version: "active-speed-estimate.v1"
  estimated_attempt_ms: number
  eligible_sample_count: number
  excluded_sample_count: number
  estimator_version: string
}

type VocabularySrsStoreV1Snapshot = {
  schemaVersion: 1
  words: readonly JsonValue[]
  contexts: readonly JsonValue[]
  reviewStates: readonly JsonValue[]
  reviewLogs: readonly JsonValue[]
}
type LegacyAuditOptionsV1 = {
  policy_version: string
  source_snapshot_hmac_sha256: string
  audited_at: string
}
type LegacyAuditClassification =
  "compatible"|"needs_context"|"needs_sense"|"conflicting"|"ignored_or_deleted"
type LegacyAuditManifestV1 = {
  schema_version: "legacy-audit-manifest.v1"
  policy_version: string
  source_snapshot_hmac_sha256: string
  audited_at: string
  items: Array<{
    legacy_word_id: string
    classification: LegacyAuditClassification
    reason_codes: string[]
    is_legacy: true
    training_eligible: false
  }>
}
```

## P1–P5 精确导出

### P1

```ts
normalizeLearningUnit(input: unknown): LearningUnit
assertLearningUnit(input: unknown): asserts input is LearningUnit
normalizeAcquisitionState(input: unknown): AcquisitionState
assertAcquisitionState(input: unknown): asserts input is AcquisitionState
normalizeAcquisitionAttempt(input: unknown): AcquisitionAttempt
assertAcquisitionAttempt(input: unknown): asserts input is AcquisitionAttempt
deriveTargetSenseKey(input: TargetSense): string
evaluateGraduationEligibility(input: GraduationEligibilityInput): GraduationEligibility
createInMemoryAcquisitionRepository(seed?: AcquisitionRepositorySeed): AcquisitionRepository
createIndexedDbAcquisitionRepository(options?: { indexedDBApi?: IDBFactory }): AcquisitionRepository
bindAcquisitionRepositoryToTransaction(
  row_port: VocabularyLearningTransactionRowPort
): AcquisitionTransactionRepository
interface AcquisitionRepository extends AcquisitionTransactionRepository {
  loadSnapshot(): Promise<AcquisitionStoreV1>
}
```

P1 IndexedDB factory 内部必须使用固定 schema 常量，不得接受或读取 `dbName/dbVersion/storeName/keyPath`。
非 transaction 版本每个写方法自行完成一个 readwrite transaction，transaction binding 版本
不得 open DB 或创建 transaction。

### P2

```ts
normalizeContextEvidence(input: unknown): ContextEvidence
assertContextEvidence(input: unknown): asserts input is ContextEvidence
selectValidatedAnchor(
  learning_unit_id: string,
  contexts: readonly ContextEvidence[]
): ContextEvidence|null
exportContextEvidence(
  contexts: readonly ContextEvidence[],
  options?: { includeUserOwnedText?: boolean }
): ContextEvidenceExportV1
createInMemoryContextEvidenceRepository(
  seed?: ContextEvidenceStoreV1
): ContextEvidenceRepository
createIndexedDbContextEvidenceRepository(
  options?: { indexedDBApi?: IDBFactory }
): ContextEvidenceRepository
bindContextEvidenceRepositoryToTransaction(
  row_port: VocabularyLearningTransactionRowPort
): ContextEvidenceTransactionRepository
interface ContextEvidenceRepository extends ContextEvidenceTransactionRepository {
  loadSnapshot(): Promise<ContextEvidenceStoreV1>
}
```

P2 不得联网；`includeUserOwnedText` 默认 `false`。IndexedDB factory 与 P1 相同，只允许
`indexedDBApi`，不得接受 schema override。

### P3

```ts
normalizeLearningEvent(input: unknown): LearningEvent
assertLearningEvent(input: unknown): asserts input is LearningEvent
evaluateTrainingEligibility(event: LearningEvent): TrainingEligibilityV1
createInMemoryLearningEventRepository(seed?: readonly LearningEvent[]): LearningEventRepository
createIndexedDbLearningEventRepository(options?: { indexedDBApi?: IDBFactory }): LearningEventRepository
bindLearningEventRepositoryToTransaction(
  row_port: VocabularyLearningTransactionRowPort,
  event_partition: string
): LearningEventTransactionRepository
exportLearningEvents(
  events: readonly LearningEvent[],
  options: { format: "json"|"jsonl", includeSensitiveText?: boolean }
): string
type LearningEventQueryV1 = {
  learning_unit_id?: string
  event_type?: string
  occurred_from?: string
  occurred_to?: string
}
type LearningEventExportOptionsV1 = {
  format: "json"|"jsonl"
  includeSensitiveText?: boolean
}
interface LearningEventRepository extends LearningEventTransactionRepository {
  query(query: LearningEventQueryV1): Promise<LearningEvent[]>
  export(options: LearningEventExportOptionsV1): Promise<string>
}
```

transaction binding 只提供上方冻结的 `getById/append`，不得自行 open DB。

### P4

```ts
normalizeReviewPolicy(input: unknown): ReviewPolicyV1
planReviewSession(input: ReviewPlanningInput): SessionLedger
shouldScheduleSameDayRevisit(input: SameDayRevisitInput): SameDayRevisitDecisionV1
estimateActiveAttemptDuration(events: readonly LearningEvent[]): ActiveSpeedEstimateV1
```

全部为纯函数；无个人数据时 `estimated_attempt_ms=36000`。

### P5

```ts
auditLegacyVocabularySnapshot(
  snapshot: VocabularySrsStoreV1Snapshot,
  options: LegacyAuditOptionsV1
): LegacyAuditManifestV1
```

只接收值、返回值，不持有写 repository，不修改 snapshot。

P6 启动前必须审阅 P1/P2/P3 的 DTO、错误码、transaction bindings 与 receipt fingerprint
tests。`ReviewTransactionRepository`、`vocabulary.review.store.v2` repository 和共享 UoW 的
唯一实现 owner 是 P6；P7 必须在 P6 合并后复用它，不得新增第二套 review repository。
