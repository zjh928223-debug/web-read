export const LEARNING_EVENT_SCHEMA_VERSION = 'learning-event.v1';
export const LEARNING_EVENT_MANIFEST_ROW_ID = 'vocabulary.learning-events.manifest.v1';
export const LEARNING_EVENT_MANIFEST_SCHEMA_VERSION = 'learning-event-manifest.v1';
export const LEARNING_EVENT_SHARD_SCHEMA_VERSION = 'learning-event-shard.v1';
export const LEARNING_EVENT_EXPORT_SCHEMA_VERSION = 'learning-event-export.v1';
export const LEARNING_EVENT_EXPORT_DICTIONARY_VERSION = 'learning-event-field-dictionary.v1';
export const LEARNING_EVENT_SHARD_MAX_EVENTS = 256;
// Training-only ceiling: a single active attempt above 30 minutes is treated as
// a likely pause/background/session-timing anomaly. The event remains auditable.
export const TRAINING_ACTIVE_DURATION_MAX_MS = 30 * 60 * 1000;

export const LEARNING_EVENT_TYPES = Object.freeze([
  'candidate_queued',
  'target_sense_selected',
  'context_attached',
  'context_validated',
  'acquisition_attempt_recorded',
  'acquisition_graduated',
  'article_learning_completed',
  'review_attempt_recorded',
  'legacy_reassessed',
  'policy_changed',
  'event_corrected',
]);

const PROMPT_MODES = Object.freeze(['word_only', 'original_context', 'transfer_context']);
const CUE_LEVELS = Object.freeze([
  'none',
  'target_sentence',
  'surrounding_context',
  'morphology_or_pos',
  'translation',
]);
const RATINGS = Object.freeze(['again', 'hard', 'good', 'easy']);
const SOURCE_KINDS = Object.freeze([
  'article',
  'subtitle',
  'user_local_exam_material',
  'open_corpus',
  'dictionary_example',
  'ai_candidate',
]);
const EVENT_FIELDS = Object.freeze([
  'schema_version',
  'event_id',
  'command_id',
  'correlation_id',
  'event_type',
  'attempt_id',
  'occurred_at',
  'recorded_at',
  'session_id',
  'session_position',
  'learning_unit_id',
  'word_id',
  'target_sense_id',
  'policy_version',
  'scheduler_version',
  'content_version',
  'prompt_mode',
  'cue_level',
  'rating',
  'answer_revealed_before_rating',
  'graduation_eligibility',
  'duration_ms',
  'active_duration_ms',
  'before_state',
  'after_state',
  'source_kind',
  'context_evidence_id',
  'is_legacy',
  'training_eligible',
  'exclusion_reasons',
  'payload',
  'extensions',
]);
const GRADUATION_ELIGIBILITY_FIELDS = Object.freeze([
  'schema_version',
  'delay_policy_version',
  'eligible',
  'reason_codes',
  'target_sense_present',
  'validated_anchor_present',
  'delayed_from_introduction',
  'answer_unrevealed',
  'rating_eligible',
  'introduction_occurred_at',
  'attempt_occurred_at',
  'introduction_episode_id',
  'attempt_episode_id',
  'elapsed_ms',
  'minimum_delay_ms',
  'evaluated_at',
]);
const TRAINING_EXCLUSION_ORDER = Object.freeze([
  'LEGACY_EVENT',
  'DUPLICATE_SUBMISSION',
  'IMPORTED_EVENT',
  'TARGET_SENSE_MISSING',
  'PROMPT_MODE_MISSING',
  'CUE_LEVEL_MISSING',
  'POLICY_VERSION_MISSING',
  'SCHEDULER_VERSION_MISSING',
  'STATE_TRANSITION_MISSING',
  'ACTIVE_DURATION_UNRELIABLE',
  'ANSWER_REVEALED_BEFORE_RATING',
]);
const ATTEMPT_EVENT_TYPES = new Set([
  'acquisition_attempt_recorded',
  'acquisition_graduated',
  'review_attempt_recorded',
]);
const TRAINABLE_ATTEMPT_EVENT_TYPES = new Set([
  'acquisition_attempt_recorded',
  'review_attempt_recorded',
]);
const GRADUATION_REASON_CODES = new Set([
  'LEARNING_UNIT_MISMATCH',
  'TARGET_SENSE_MISSING',
  'TARGET_SENSE_MISMATCH',
  'VALIDATED_ANCHOR_MISSING',
  'ANCHOR_LEARNING_UNIT_MISMATCH',
  'ANCHOR_NOT_VALIDATED',
  'CONTEXT_EVIDENCE_MISMATCH',
  'INTRODUCTION_TIMESTAMP_MISSING',
  'ATTEMPT_BEFORE_INTRODUCTION',
  'INTRODUCTION_EPISODE_MISSING',
  'ATTEMPT_EPISODE_MISSING',
  'SAME_ACQUISITION_EPISODE',
  'MINIMUM_DELAY_NOT_REACHED',
  'ANSWER_REVEALED_BEFORE_RATING',
  'RATING_MISSING',
  'RATING_AGAIN',
]);
const DEFAULT_EXPORT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/#?=&%@+-]{0,511}$/;
const DEFAULT_EXPORT_LOCATOR_ID_FIELDS = new Set([
  'article_id',
  'document_id',
  'subtitle_id',
  'cue_id',
  'path_hash',
]);
const DEFAULT_EXPORT_LOCATOR_INTEGER_FIELDS = new Set([
  'line',
  'line_start',
  'line_end',
  'paragraph',
  'paragraph_index',
  'sentence_index',
  'start_ms',
  'end_ms',
  'page',
  'page_number',
  'offset_start',
  'offset_end',
]);
const UTC_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const EVENT_PARTITION_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

function assertVocabularyBrowserWriterAllowed(operation) {
  globalThis?.__windowsOwnerDomainCutover?.assertBrowserWriterAllowed?.('vocabulary-srs', operation);
}

export class VocabularyLearningContractError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'VocabularyLearningContractError';
    this.code = code;
    this.details = cloneJson(details);
  }
}

function contractError(code, message, details = {}) {
  return new VocabularyLearningContractError(code, message, details);
}

function normalizeIndexedDbFailure(error, operation) {
  if (error instanceof VocabularyLearningContractError) return error;
  const candidateName = typeof error?.name === 'string' ? error.name : '';
  const errorName = /^[A-Za-z][A-Za-z0-9]{0,63}(?:Error|Exception)$/.test(candidateName)
    ? candidateName
    : 'Error';
  return contractError(
    'TRANSACTION_ABORTED',
    'Learning event IndexedDB operation failed',
    {
      reason: 'INDEXEDDB_OPERATION_FAILED',
      operation,
      error_name: errorName,
    },
  );
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function cloneJson(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(cloneJson);
  const result = {};
  for (const key of Object.keys(value)) result[key] = cloneJson(value[key]);
  return result;
}

function canonicalizeJson(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw contractError('INVALID_FIELD_TYPE', 'JSON numbers must be finite', {});
    }
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalizeJson);
  if (!isPlainObject(value)) {
    throw contractError('INVALID_FIELD_TYPE', 'Value must be plain JSON', {});
  }
  const result = {};
  for (const key of Object.keys(value).sort()) result[key] = canonicalizeJson(value[key]);
  return result;
}

function canonicalJson(value) {
  return JSON.stringify(canonicalizeJson(value));
}

function assertExactKeys(value, allowed, path, requireAll = true) {
  if (!isPlainObject(value)) {
    throw contractError('INVALID_FIELD_TYPE', `${path} must be an object`, { field: path });
  }
  const allowedSet = new Set(allowed);
  const unknown = Object.keys(value).filter((key) => !allowedSet.has(key)).sort();
  if (unknown.length) {
    throw contractError('INVALID_FIELD_TYPE', `${path} contains unknown fields`, {
      field: path,
      unknown_fields: unknown,
    });
  }
  if (!requireAll) return;
  const missing = allowed.filter((key) => !Object.prototype.hasOwnProperty.call(value, key));
  if (missing.length) {
    throw contractError('MISSING_REQUIRED_FIELD', `${path} is missing required fields`, {
      field: path,
      missing_fields: missing,
    });
  }
}

function requiredString(value, field) {
  if (typeof value !== 'string' || value.length === 0) {
    throw contractError('INVALID_FIELD_TYPE', `${field} must be a non-empty string`, { field });
  }
  return value;
}

function nullableString(value, field) {
  if (value === null) return null;
  return requiredString(value, field);
}

function requiredBoolean(value, field) {
  if (typeof value !== 'boolean') {
    throw contractError('INVALID_FIELD_TYPE', `${field} must be a boolean`, { field });
  }
  return value;
}

function nullableBoolean(value, field) {
  if (value === null) return null;
  return requiredBoolean(value, field);
}

function integer(value, field, { nullable = false } = {}) {
  if (nullable && value === null) return null;
  if (!Number.isInteger(value) || value < 0) {
    throw contractError('INVALID_FIELD_TYPE', `${field} must be a non-negative integer`, { field });
  }
  return value;
}

function enumValue(value, values, field, { nullable = false } = {}) {
  if (nullable && value === null) return null;
  if (!values.includes(value)) {
    throw contractError('INVALID_ENUM_VALUE', `${field} has an unsupported value`, { field });
  }
  return value;
}

function utcTimestamp(value, field, { nullable = false } = {}) {
  if (nullable && value === null) return null;
  if (
    typeof value !== 'string'
    || !UTC_TIMESTAMP_PATTERN.test(value)
    || !Number.isFinite(Date.parse(value))
  ) {
    throw contractError('INVALID_TIMESTAMP', `${field} must be a UTC ISO-8601 timestamp`, { field });
  }
  return value;
}

function jsonObject(value, field, { nullable = false } = {}) {
  if (nullable && value === null) return null;
  if (!isPlainObject(value)) {
    throw contractError('INVALID_FIELD_TYPE', `${field} must be a JSON object`, { field });
  }
  return canonicalizeJson(value);
}

function normalizeStringArray(value, field) {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw contractError('INVALID_FIELD_TYPE', `${field} must be a string array`, { field });
  }
  return [...new Set(value)].sort();
}

function normalizeOrderedStringArray(value, field) {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw contractError('INVALID_FIELD_TYPE', `${field} must be a string array`, { field });
  }
  return value.filter((entry, index) => value.indexOf(entry) === index);
}

function normalizeGraduationEligibility(value) {
  if (value === null) return null;
  assertExactKeys(value, GRADUATION_ELIGIBILITY_FIELDS, 'graduation_eligibility', true);
  if (value.schema_version !== 'graduation-eligibility.v1') {
    throw contractError('UNSUPPORTED_SCHEMA_VERSION', 'Unsupported graduation eligibility schema', {
      schema_version: value.schema_version,
    });
  }
  if (value.delay_policy_version !== 'acquisition-delay.v1') {
    throw contractError('UNSUPPORTED_SCHEMA_VERSION', 'Unsupported acquisition delay policy', {
      delay_policy_version: value.delay_policy_version,
    });
  }
  const elapsedMs = integer(value.elapsed_ms, 'graduation_eligibility.elapsed_ms', { nullable: true });
  const minimumDelayMs = integer(
    value.minimum_delay_ms,
    'graduation_eligibility.minimum_delay_ms',
  );
  if (minimumDelayMs !== 86400000) {
    throw contractError('INVALID_FIELD_TYPE', 'minimum_delay_ms must be 86400000', {
      field: 'graduation_eligibility.minimum_delay_ms',
    });
  }
  return {
    schema_version: 'graduation-eligibility.v1',
    delay_policy_version: 'acquisition-delay.v1',
    eligible: requiredBoolean(value.eligible, 'graduation_eligibility.eligible'),
    reason_codes: normalizeOrderedStringArray(
      value.reason_codes,
      'graduation_eligibility.reason_codes',
    ),
    target_sense_present: requiredBoolean(
      value.target_sense_present,
      'graduation_eligibility.target_sense_present',
    ),
    validated_anchor_present: requiredBoolean(
      value.validated_anchor_present,
      'graduation_eligibility.validated_anchor_present',
    ),
    delayed_from_introduction: requiredBoolean(
      value.delayed_from_introduction,
      'graduation_eligibility.delayed_from_introduction',
    ),
    answer_unrevealed: requiredBoolean(
      value.answer_unrevealed,
      'graduation_eligibility.answer_unrevealed',
    ),
    rating_eligible: requiredBoolean(
      value.rating_eligible,
      'graduation_eligibility.rating_eligible',
    ),
    introduction_occurred_at: utcTimestamp(
      value.introduction_occurred_at,
      'graduation_eligibility.introduction_occurred_at',
      { nullable: true },
    ),
    attempt_occurred_at: utcTimestamp(
      value.attempt_occurred_at,
      'graduation_eligibility.attempt_occurred_at',
    ),
    introduction_episode_id: nullableString(
      value.introduction_episode_id,
      'graduation_eligibility.introduction_episode_id',
    ),
    attempt_episode_id: requiredString(
      value.attempt_episode_id,
      'graduation_eligibility.attempt_episode_id',
    ),
    elapsed_ms: elapsedMs,
    minimum_delay_ms: minimumDelayMs,
    evaluated_at: utcTimestamp(
      value.evaluated_at,
      'graduation_eligibility.evaluated_at',
    ),
  };
}

function normalizeLearningEventBase(input, { requireAll = false } = {}) {
  assertExactKeys(input, EVENT_FIELDS, 'learning_event', requireAll);
  const schemaVersion = input.schema_version ?? LEARNING_EVENT_SCHEMA_VERSION;
  if (schemaVersion !== LEARNING_EVENT_SCHEMA_VERSION) {
    throw contractError('UNSUPPORTED_SCHEMA_VERSION', 'Unsupported learning event schema', {
      schema_version: schemaVersion,
    });
  }
  const occurredAt = utcTimestamp(input.occurred_at, 'occurred_at');
  const recordedAt = utcTimestamp(input.recorded_at, 'recorded_at');
  if (Date.parse(recordedAt) < Date.parse(occurredAt)) {
    throw contractError('INVALID_TIMESTAMP', 'recorded_at must not precede occurred_at', {
      field: 'recorded_at',
    });
  }
  const durationMs = integer(input.duration_ms ?? null, 'duration_ms', { nullable: true });
  const activeDurationMs = integer(
    input.active_duration_ms ?? null,
    'active_duration_ms',
    { nullable: true },
  );
  if (
    durationMs !== null
    && activeDurationMs !== null
    && activeDurationMs > durationMs
  ) {
    throw contractError('INVALID_FIELD_TYPE', 'active_duration_ms must not exceed duration_ms', {
      field: 'active_duration_ms',
    });
  }
  const eventType = enumValue(input.event_type, LEARNING_EVENT_TYPES, 'event_type');
  const graduationEligibility = normalizeGraduationEligibility(
    input.graduation_eligibility ?? null,
  );
  const normalized = {
    schema_version: LEARNING_EVENT_SCHEMA_VERSION,
    event_id: requiredString(input.event_id, 'event_id'),
    command_id: requiredString(input.command_id, 'command_id'),
    correlation_id: requiredString(input.correlation_id, 'correlation_id'),
    event_type: eventType,
    attempt_id: nullableString(input.attempt_id ?? null, 'attempt_id'),
    occurred_at: occurredAt,
    recorded_at: recordedAt,
    session_id: nullableString(input.session_id ?? null, 'session_id'),
    session_position: integer(
      input.session_position ?? null,
      'session_position',
      { nullable: true },
    ),
    learning_unit_id: requiredString(input.learning_unit_id, 'learning_unit_id'),
    word_id: requiredString(input.word_id, 'word_id'),
    target_sense_id: nullableString(input.target_sense_id ?? null, 'target_sense_id'),
    policy_version: nullableString(input.policy_version ?? null, 'policy_version'),
    scheduler_version: nullableString(input.scheduler_version ?? null, 'scheduler_version'),
    content_version: nullableString(input.content_version ?? null, 'content_version'),
    prompt_mode: enumValue(
      input.prompt_mode ?? null,
      PROMPT_MODES,
      'prompt_mode',
      { nullable: true },
    ),
    cue_level: enumValue(
      input.cue_level ?? null,
      CUE_LEVELS,
      'cue_level',
      { nullable: true },
    ),
    rating: enumValue(input.rating ?? null, RATINGS, 'rating', { nullable: true }),
    answer_revealed_before_rating: nullableBoolean(
      input.answer_revealed_before_rating ?? null,
      'answer_revealed_before_rating',
    ),
    graduation_eligibility: graduationEligibility,
    duration_ms: durationMs,
    active_duration_ms: activeDurationMs,
    before_state: jsonObject(input.before_state ?? null, 'before_state', { nullable: true }),
    after_state: jsonObject(input.after_state ?? null, 'after_state', { nullable: true }),
    source_kind: enumValue(
      input.source_kind ?? null,
      SOURCE_KINDS,
      'source_kind',
      { nullable: true },
    ),
    context_evidence_id: nullableString(
      input.context_evidence_id ?? null,
      'context_evidence_id',
    ),
    is_legacy: requiredBoolean(input.is_legacy ?? false, 'is_legacy'),
    training_eligible: requiredBoolean(
      input.training_eligible ?? false,
      'training_eligible',
    ),
    exclusion_reasons: normalizeStringArray(
      input.exclusion_reasons ?? [],
      'exclusion_reasons',
    ),
    payload: jsonObject(input.payload ?? {}, 'payload'),
    extensions: jsonObject(input.extensions ?? {}, 'extensions'),
  };
  if (ATTEMPT_EVENT_TYPES.has(eventType) && normalized.attempt_id === null) {
    throw contractError('MISSING_REQUIRED_FIELD', 'Attempt events require attempt_id', {
      field: 'attempt_id',
    });
  }
  if (eventType === 'acquisition_attempt_recorded' || eventType === 'acquisition_graduated') {
    for (const field of ['answer_revealed_before_rating', 'context_evidence_id']) {
      if (normalized[field] === null) {
        throw contractError(
          'MISSING_REQUIRED_FIELD',
          'Acquisition event is missing required attempt metadata',
          { field, event_type: eventType },
        );
      }
    }
  }
  if (!ATTEMPT_EVENT_TYPES.has(eventType)) {
    const fieldsThatMustBeNull = [
      'attempt_id',
      'prompt_mode',
      'cue_level',
      'rating',
      'answer_revealed_before_rating',
      'graduation_eligibility',
      'duration_ms',
      'active_duration_ms',
    ];
    const nonNull = fieldsThatMustBeNull.filter((field) => normalized[field] !== null);
    if (nonNull.length) {
      throw contractError('INVALID_FIELD_TYPE', 'Non-attempt event has attempt metadata', {
        fields: nonNull,
      });
    }
  }
  if (
    (eventType === 'acquisition_attempt_recorded' || eventType === 'acquisition_graduated')
    && graduationEligibility === null
  ) {
    throw contractError(
      'MISSING_REQUIRED_FIELD',
      'Acquisition attempt and graduation events require graduation_eligibility',
      { field: 'graduation_eligibility' },
    );
  }
  if (eventType === 'event_corrected') {
    requiredString(normalized.payload.corrects_event_id, 'payload.corrects_event_id');
  }
  return normalized;
}

function evaluateNormalizedTrainingEligibility(event) {
  if (!TRAINABLE_ATTEMPT_EVENT_TYPES.has(event.event_type)) {
    return {
      schema_version: 'training-eligibility.v1',
      eligible: false,
      exclusion_reasons: [],
    };
  }
  const reasons = new Set();
  if (event.is_legacy) reasons.add('LEGACY_EVENT');
  if (event.payload.duplicate_submission === true) reasons.add('DUPLICATE_SUBMISSION');
  if (event.payload.imported_event === true) reasons.add('IMPORTED_EVENT');
  if (event.target_sense_id === null) reasons.add('TARGET_SENSE_MISSING');
  if (event.prompt_mode === null) reasons.add('PROMPT_MODE_MISSING');
  if (event.cue_level === null) reasons.add('CUE_LEVEL_MISSING');
  if (event.event_type === 'review_attempt_recorded' && event.policy_version === null) {
    reasons.add('POLICY_VERSION_MISSING');
  }
  if (event.event_type === 'review_attempt_recorded' && event.scheduler_version === null) {
    reasons.add('SCHEDULER_VERSION_MISSING');
  }
  if (
    event.event_type === 'review_attempt_recorded'
    && (event.before_state === null || event.after_state === null)
  ) {
    reasons.add('STATE_TRANSITION_MISSING');
  }
  if (
    event.active_duration_ms === null
    || event.active_duration_ms === 0
    || event.active_duration_ms > TRAINING_ACTIVE_DURATION_MAX_MS
    || event.payload.active_duration_reliable === false
  ) {
    reasons.add('ACTIVE_DURATION_UNRELIABLE');
  }
  if (event.answer_revealed_before_rating === true) {
    reasons.add('ANSWER_REVEALED_BEFORE_RATING');
  }
  const exclusionReasons = TRAINING_EXCLUSION_ORDER.filter((reason) => reasons.has(reason));
  return {
    schema_version: 'training-eligibility.v1',
    eligible: exclusionReasons.length === 0,
    exclusion_reasons: exclusionReasons,
  };
}

export function evaluateTrainingEligibility(input) {
  const normalized = normalizeLearningEventBase(input, { requireAll: false });
  return evaluateNormalizedTrainingEligibility(normalized);
}

export function normalizeLearningEvent(input) {
  const normalized = normalizeLearningEventBase(input, { requireAll: false });
  const eligibility = evaluateNormalizedTrainingEligibility(normalized);
  normalized.training_eligible = eligibility.eligible;
  normalized.exclusion_reasons = eligibility.exclusion_reasons;
  return cloneJson(normalized);
}

export function assertLearningEvent(input) {
  const normalized = normalizeLearningEventBase(input, { requireAll: true });
  const eligibility = evaluateNormalizedTrainingEligibility(normalized);
  if (
    input.training_eligible !== eligibility.eligible
    || canonicalJson(input.exclusion_reasons) !== canonicalJson(eligibility.exclusion_reasons)
  ) {
    throw contractError('INVALID_FIELD_TYPE', 'Training eligibility fields are inconsistent', {
      field: 'training_eligible',
    });
  }
}

function eventPartitionFor(event) {
  return event.occurred_at.slice(0, 7);
}

function assertEventPartition(partition) {
  if (typeof partition !== 'string' || !EVENT_PARTITION_PATTERN.test(partition)) {
    throw contractError('INVALID_EVENT_PARTITION', 'Event partition must use YYYY-MM', {
      event_partition: typeof partition === 'string' ? partition : null,
    });
  }
  return partition;
}

function shardRowId(partition, index) {
  return `vocabulary.learning-events.v1.${partition}.${String(index).padStart(4, '0')}`;
}

function emptyManifest() {
  return {
    schema_version: LEARNING_EVENT_MANIFEST_SCHEMA_VERSION,
    revision: 0,
    partitions: {},
    event_locations: {},
  };
}

function normalizeManifest(content) {
  if (content === null || content === undefined) return emptyManifest();
  if (!isPlainObject(content) || content.schema_version !== LEARNING_EVENT_MANIFEST_SCHEMA_VERSION) {
    throw contractError('TRANSACTION_ABORTED', 'Learning event manifest is invalid', {
      reason: 'BAD_EVENT_MANIFEST',
    });
  }
  integer(content.revision, 'manifest.revision');
  if (!isPlainObject(content.partitions) || !isPlainObject(content.event_locations)) {
    throw contractError('TRANSACTION_ABORTED', 'Learning event manifest indexes are invalid', {
      reason: 'BAD_EVENT_MANIFEST',
    });
  }
  const manifest = emptyManifest();
  manifest.revision = content.revision;
  for (const partition of Object.keys(content.partitions).sort()) {
    assertEventPartition(partition);
    const entry = content.partitions[partition];
    if (
      !isPlainObject(entry)
      || !Array.isArray(entry.shard_ids)
      || entry.shard_ids.some((id) => typeof id !== 'string')
      || typeof entry.active_shard_id !== 'string'
      || !entry.shard_ids.includes(entry.active_shard_id)
      || !Number.isInteger(entry.event_count)
      || entry.event_count < 0
    ) {
      throw contractError('TRANSACTION_ABORTED', 'Learning event partition manifest is invalid', {
        reason: 'BAD_EVENT_MANIFEST',
        event_partition: partition,
      });
    }
    manifest.partitions[partition] = {
      shard_ids: [...new Set(entry.shard_ids)],
      active_shard_id: entry.active_shard_id,
      event_count: entry.event_count,
    };
  }
  for (const eventId of Object.keys(content.event_locations).sort()) {
    const rowId = content.event_locations[eventId];
    if (typeof rowId !== 'string' || eventId.length === 0) {
      throw contractError('TRANSACTION_ABORTED', 'Learning event location index is invalid', {
        reason: 'BAD_EVENT_MANIFEST',
      });
    }
    manifest.event_locations[eventId] = rowId;
  }
  return manifest;
}

function normalizeShard(content, rowId, expectedPartition = null) {
  if (
    !isPlainObject(content)
    || content.schema_version !== LEARNING_EVENT_SHARD_SCHEMA_VERSION
    || !EVENT_PARTITION_PATTERN.test(content.partition)
    || !Number.isInteger(content.shard_index)
    || content.shard_index < 1
    || !Array.isArray(content.events)
  ) {
    throw contractError('TRANSACTION_ABORTED', 'Learning event shard is invalid', {
      reason: 'BAD_EVENT_SHARD',
      row_id: rowId,
    });
  }
  if (expectedPartition !== null && content.partition !== expectedPartition) {
    throw contractError('INVALID_EVENT_PARTITION', 'Learning event shard partition mismatch', {
      row_id: rowId,
      event_partition: expectedPartition,
    });
  }
  if (shardRowId(content.partition, content.shard_index) !== rowId) {
    throw contractError('TRANSACTION_ABORTED', 'Learning event shard row id is invalid', {
      reason: 'BAD_EVENT_SHARD',
      row_id: rowId,
    });
  }
  const events = content.events.map((event) => {
    assertLearningEvent(event);
    const normalized = normalizeLearningEvent(event);
    if (eventPartitionFor(normalized) !== content.partition) {
      throw contractError('INVALID_EVENT_PARTITION', 'Event is stored in the wrong shard', {
        event_id: normalized.event_id,
        event_partition: content.partition,
      });
    }
    return normalized;
  });
  const eventIds = new Set();
  for (const event of events) {
    if (eventIds.has(event.event_id)) {
      throw contractError('TRANSACTION_ABORTED', 'Learning event shard has duplicate ids', {
        reason: 'BAD_EVENT_SHARD',
        row_id: rowId,
      });
    }
    eventIds.add(event.event_id);
  }
  return {
    schema_version: LEARNING_EVENT_SHARD_SCHEMA_VERSION,
    partition: content.partition,
    shard_index: content.shard_index,
    events,
  };
}

function makeRow(id, content, timestamp) {
  return { id, content: cloneJson(content), timestamp };
}

async function loadManifestFromRowPort(rowPort) {
  if (rowPort.buffered === true) {
    const state = getBufferedLearningEventState(rowPort);
    if (state.manifest) return state.manifest;
    const row = await rowPort.getRow(LEARNING_EVENT_MANIFEST_ROW_ID);
    state.manifest = normalizeManifest(row ? row.content : null);
    return state.manifest;
  }
  const row = await rowPort.getRow(LEARNING_EVENT_MANIFEST_ROW_ID);
  return normalizeManifest(row ? row.content : null);
}

const bufferedLearningEventStates = new WeakMap();

function getBufferedLearningEventState(rowPort) {
  let state = bufferedLearningEventStates.get(rowPort);
  if (!state) {
    state = { manifest: null, shards: new Map() };
    bufferedLearningEventStates.set(rowPort, state);
  }
  return state;
}

async function loadShardFromRowPort(rowPort, rowId, expectedPartition = null) {
  if (rowPort.buffered === true) {
    const state = getBufferedLearningEventState(rowPort);
    if (state.shards.has(rowId)) return state.shards.get(rowId);
    const row = await rowPort.getRow(rowId);
    if (!row) return null;
    const shard = normalizeShard(row.content, rowId, expectedPartition);
    state.shards.set(rowId, shard);
    return shard;
  }
  const row = await rowPort.getRow(rowId);
  return row ? normalizeShard(row.content, rowId, expectedPartition) : null;
}

function transactionRow(rowPort, id, content, timestamp) {
  return rowPort.buffered === true
    ? { id, content, timestamp }
    : makeRow(id, content, timestamp);
}

export function bindLearningEventRepositoryToTransaction(row_port, event_partition) {
  if (
    !row_port
    || typeof row_port.getRow !== 'function'
    || typeof row_port.putRow !== 'function'
  ) {
    throw contractError('INVALID_FIELD_TYPE', 'A transaction row port is required', {
      field: 'row_port',
    });
  }
  const fixedPartition = assertEventPartition(event_partition);

  async function getById(eventId) {
    requiredString(eventId, 'event_id');
    const manifest = await loadManifestFromRowPort(row_port);
    const location = manifest.event_locations[eventId];
    if (!location) return null;
    const shard = await loadShardFromRowPort(row_port, location);
    if (!shard) {
      throw contractError('TRANSACTION_ABORTED', 'Manifest points to a missing event shard', {
        reason: 'MISSING_EVENT_SHARD',
        row_id: location,
      });
    }
    const event = shard.events.find((candidate) => candidate.event_id === eventId);
    if (!event) {
      throw contractError('TRANSACTION_ABORTED', 'Manifest points to a missing event', {
        reason: 'MISSING_EVENT',
        event_id: eventId,
      });
    }
    return cloneJson(event);
  }

  async function append(input) {
    const event = normalizeLearningEvent(input);
    assertLearningEvent(event);
    const eventPartition = eventPartitionFor(event);
    if (eventPartition !== fixedPartition) {
      throw contractError('INVALID_EVENT_PARTITION', 'Event does not belong to transaction partition', {
        event_id: event.event_id,
        event_partition: fixedPartition,
      });
    }

    const manifest = await loadManifestFromRowPort(row_port);
    const existingLocation = manifest.event_locations[event.event_id];
    if (existingLocation) {
      const existing = await getById(event.event_id);
      if (canonicalJson(existing) === canonicalJson(event)) return existing;
      throw contractError('IDEMPOTENCY_CONFLICT', 'event_id was reused with different content', {
        event_id: event.event_id,
      });
    }
    if (event.event_type === 'event_corrected') {
      const correctedId = event.payload.corrects_event_id;
      if (correctedId === event.event_id || !(await getById(correctedId))) {
        throw contractError('INVALID_STATE_TRANSITION', 'Correction event target does not exist', {
          event_id: event.event_id,
          corrects_event_id: correctedId,
        });
      }
    }

    let partitionEntry = manifest.partitions[fixedPartition];
    let shard;
    let activeShardId;
    if (!partitionEntry) {
      activeShardId = shardRowId(fixedPartition, 1);
      partitionEntry = {
        shard_ids: [activeShardId],
        active_shard_id: activeShardId,
        event_count: 0,
      };
      shard = {
        schema_version: LEARNING_EVENT_SHARD_SCHEMA_VERSION,
        partition: fixedPartition,
        shard_index: 1,
        events: [],
      };
    } else {
      activeShardId = partitionEntry.active_shard_id;
      shard = await loadShardFromRowPort(row_port, activeShardId, fixedPartition);
      if (!shard) {
        throw contractError('TRANSACTION_ABORTED', 'Active event shard is missing', {
          reason: 'MISSING_EVENT_SHARD',
          row_id: activeShardId,
        });
      }
      if (shard.events.length >= LEARNING_EVENT_SHARD_MAX_EVENTS) {
        const nextIndex = shard.shard_index + 1;
        activeShardId = shardRowId(fixedPartition, nextIndex);
        if (partitionEntry.shard_ids.includes(activeShardId)) {
          throw contractError('TRANSACTION_ABORTED', 'Next event shard already exists', {
            reason: 'EVENT_SHARD_COLLISION',
            row_id: activeShardId,
          });
        }
        partitionEntry.shard_ids.push(activeShardId);
        partitionEntry.active_shard_id = activeShardId;
        shard = {
          schema_version: LEARNING_EVENT_SHARD_SCHEMA_VERSION,
          partition: fixedPartition,
          shard_index: nextIndex,
          events: [],
        };
        if (row_port.buffered === true) {
          getBufferedLearningEventState(row_port).shards.set(activeShardId, shard);
        }
      }
    }

    if (row_port.buffered === true) {
      getBufferedLearningEventState(row_port).shards.set(activeShardId, shard);
    }

    shard.events.push(event);
    partitionEntry.event_count += 1;
    manifest.partitions[fixedPartition] = partitionEntry;
    manifest.event_locations[event.event_id] = activeShardId;
    manifest.revision += 1;
    await row_port.putRow(transactionRow(row_port, activeShardId, shard, event.recorded_at));
    await row_port.putRow(
      transactionRow(row_port, LEARNING_EVENT_MANIFEST_ROW_ID, manifest, event.recorded_at),
    );
    return cloneJson(event);
  }

  return { getById, append };
}

function filterAndSortEvents(events, query = {}) {
  if (!isPlainObject(query)) {
    throw contractError('INVALID_FIELD_TYPE', 'Learning event query must be an object', {
      field: 'query',
    });
  }
  const occurredFrom = query.occurred_from === undefined
    ? null
    : utcTimestamp(query.occurred_from, 'occurred_from');
  const occurredTo = query.occurred_to === undefined
    ? null
    : utcTimestamp(query.occurred_to, 'occurred_to');
  if (occurredFrom && occurredTo && Date.parse(occurredFrom) > Date.parse(occurredTo)) {
    throw contractError('INVALID_TIMESTAMP', 'occurred_from must not exceed occurred_to', {
      field: 'occurred_from',
    });
  }
  if (query.learning_unit_id !== undefined) {
    requiredString(query.learning_unit_id, 'learning_unit_id');
  }
  if (query.event_type !== undefined) {
    enumValue(query.event_type, LEARNING_EVENT_TYPES, 'event_type');
  }
  return events
    .filter((event) => (
      (query.learning_unit_id === undefined || event.learning_unit_id === query.learning_unit_id)
      && (query.event_type === undefined || event.event_type === query.event_type)
      && (occurredFrom === null || event.occurred_at >= occurredFrom)
      && (occurredTo === null || event.occurred_at <= occurredTo)
    ))
    .sort((left, right) => (
      left.occurred_at.localeCompare(right.occurred_at)
      || left.recorded_at.localeCompare(right.recorded_at)
      || left.event_id.localeCompare(right.event_id)
    ))
    .map(cloneJson);
}

function createMemoryRowPort(rows) {
  return {
    transaction_id: 'in-memory-learning-events',
    async getRow(rowId) {
      return rows.has(rowId) ? cloneJson(rows.get(rowId)) : null;
    },
    async putRow(row) {
      rows.set(row.id, cloneJson(row));
    },
  };
}

function allEventsFromRows(rows) {
  const manifestRow = rows.get(LEARNING_EVENT_MANIFEST_ROW_ID);
  const manifest = normalizeManifest(manifestRow ? manifestRow.content : null);
  const events = [];
  const seenLocations = {};
  for (const partition of Object.keys(manifest.partitions).sort()) {
    let partitionEventCount = 0;
    for (const rowId of manifest.partitions[partition].shard_ids) {
      const row = rows.get(rowId);
      if (!row) {
        throw contractError('TRANSACTION_ABORTED', 'Manifest points to a missing event shard', {
          reason: 'MISSING_EVENT_SHARD',
          row_id: rowId,
        });
      }
      const shard = normalizeShard(row.content, rowId, partition);
      for (const event of shard.events) {
        if (seenLocations[event.event_id]) {
          throw contractError('TRANSACTION_ABORTED', 'Event id exists in multiple shards', {
            reason: 'DUPLICATE_EVENT_ID',
            event_id: event.event_id,
          });
        }
        seenLocations[event.event_id] = rowId;
        if (manifest.event_locations[event.event_id] !== rowId) {
          throw contractError('TRANSACTION_ABORTED', 'Manifest event location is inconsistent', {
            reason: 'BAD_EVENT_MANIFEST',
            event_id: event.event_id,
          });
        }
      }
      partitionEventCount += shard.events.length;
      events.push(...shard.events);
    }
    if (partitionEventCount !== manifest.partitions[partition].event_count) {
      throw contractError('TRANSACTION_ABORTED', 'Manifest event count is inconsistent', {
        reason: 'BAD_EVENT_MANIFEST',
        event_partition: partition,
      });
    }
  }
  if (
    Object.keys(seenLocations).length !== Object.keys(manifest.event_locations).length
  ) {
    throw contractError('TRANSACTION_ABORTED', 'Manifest contains orphan event locations', {
      reason: 'BAD_EVENT_MANIFEST',
    });
  }
  return events;
}

function createRepositoryApi({ append, getById, query }) {
  return {
    append,
    getById,
    query,
    async export(options) {
      const events = await query({});
      return exportLearningEvents(events, options);
    },
  };
}

export function createInMemoryLearningEventRepository(seed = []) {
  if (!Array.isArray(seed)) {
    throw contractError('INVALID_FIELD_TYPE', 'Learning event seed must be an array', {
      field: 'seed',
    });
  }
  const rows = new Map();
  const rowPort = createMemoryRowPort(rows);

  async function append(input) {
    const event = normalizeLearningEvent(input);
    return bindLearningEventRepositoryToTransaction(
      rowPort,
      eventPartitionFor(event),
    ).append(event);
  }

  async function getById(eventId) {
    requiredString(eventId, 'event_id');
    const manifest = normalizeManifest(
      rows.get(LEARNING_EVENT_MANIFEST_ROW_ID)?.content ?? null,
    );
    const partition = Object.keys(manifest.partitions).find((candidate) => (
      manifest.partitions[candidate].shard_ids.includes(
        manifest.event_locations[eventId],
      )
    ));
    if (!partition) return null;
    return bindLearningEventRepositoryToTransaction(rowPort, partition).getById(eventId);
  }

  async function query(queryInput = {}) {
    return filterAndSortEvents(allEventsFromRows(rows), queryInput);
  }

  const repository = createRepositoryApi({ append, getById, query });
  let writeQueue = Promise.resolve();
  let seedFailure = null;

  function enqueueAppend(event, { isSeed = false } = {}) {
    const operation = writeQueue.then(() => {
      if (seedFailure) throw seedFailure;
      return repository.append(event);
    });
    writeQueue = operation.catch((error) => {
      if (isSeed && seedFailure === null) seedFailure = error;
    });
    return operation;
  }

  async function awaitWrites() {
    await writeQueue;
    if (seedFailure) throw seedFailure;
  }

  for (const event of seed) enqueueAppend(event, { isSeed: true });
  return {
    append(event) {
      return enqueueAppend(event);
    },
    async getById(eventId) {
      await awaitWrites();
      return repository.getById(eventId);
    },
    async query(queryInput = {}) {
      await awaitWrites();
      return repository.query(queryInput);
    },
    async export(options) {
      await awaitWrites();
      return repository.export(options);
    },
  };
}

function requestResult(request, fallbackMessage) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error(fallbackMessage));
  });
}

function transactionCompletion(transaction, fallbackMessage) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error(fallbackMessage));
    transaction.onabort = () => reject(transaction.error || new Error(fallbackMessage));
  });
}

function openDatabase(indexedDBApi) {
  if (!indexedDBApi || typeof indexedDBApi.open !== 'function') {
    throw contractError('INVALID_FIELD_TYPE', 'IndexedDB is unavailable for learning events', {
      field: 'indexedDBApi',
    });
  }
  return new Promise((resolve, reject) => {
    const request = indexedDBApi.open('SeekPlayerDB', 1);
    request.onerror = () => reject(request.error || new Error('Failed to open learning event storage'));
    request.onupgradeneeded = (event) => {
      try {
        event.target.transaction?.abort();
      } finally {
        reject(contractError(
          'TRANSACTION_ABORTED',
          'Learning event storage requires the existing IndexedDB schema',
          { reason: 'INDEXEDDB_SCHEMA_UPGRADE_FORBIDDEN' },
        ));
      }
    };
    request.onsuccess = (event) => {
      const database = event.target.result;
      if (!database?.objectStoreNames?.contains('files')) {
        if (typeof database?.close === 'function') database.close();
        reject(contractError(
          'TRANSACTION_ABORTED',
          'Learning event storage requires the existing files object store',
          { reason: 'INDEXEDDB_SCHEMA_MISSING' },
        ));
        return;
      }
      try {
        const schemaTransaction = database.transaction(['files'], 'readonly');
        const filesStore = schemaTransaction.objectStore('files');
        if (filesStore.keyPath !== 'id') {
          try {
            schemaTransaction.abort();
          } catch {
            // An empty readonly transaction may already have completed.
          }
          if (typeof database.close === 'function') database.close();
          reject(contractError(
            'TRANSACTION_ABORTED',
            'Learning event storage requires files keyPath id',
            {
              reason: 'INDEXEDDB_KEY_PATH_MISMATCH',
              expected_key_path: 'id',
            },
          ));
          return;
        }
      } catch (error) {
        if (typeof database.close === 'function') database.close();
        reject(normalizeIndexedDbFailure(error, 'validateSchema'));
        return;
      }
      resolve(database);
    };
  });
}

function idbRowPort(transaction) {
  const store = transaction.objectStore('files');
  return {
    transaction_id: `learning-events-${Date.now()}`,
    getRow(rowId) {
      return requestResult(store.get(rowId), 'Failed to read learning event row')
        .then((row) => (row ? cloneJson(row) : null));
    },
    putRow(row) {
      return requestResult(store.put(cloneJson(row)), 'Failed to write learning event row')
        .then(() => undefined);
    },
  };
}

function listRows(database) {
  const transaction = database.transaction(['files'], 'readonly');
  const completion = transactionCompletion(transaction, 'Failed to scan learning event rows');
  const store = transaction.objectStore('files');
  const rows = [];
  return new Promise((resolve, reject) => {
    const request = store.openCursor();
    request.onerror = () => reject(request.error || new Error('Failed to scan learning event rows'));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      rows.push(cloneJson(cursor.value));
      cursor.continue();
    };
    completion.then(() => resolve(rows), reject);
  });
}

function recoverManifestFromShardRows(rows) {
  const manifest = emptyManifest();
  const shardRows = rows
    .filter((row) => (
      typeof row?.id === 'string'
      && row.id.startsWith('vocabulary.learning-events.v1.')
    ))
    .sort((left, right) => left.id.localeCompare(right.id));
  for (const row of shardRows) {
    const shard = normalizeShard(row.content, row.id);
    let entry = manifest.partitions[shard.partition];
    if (!entry) {
      entry = { shard_ids: [], active_shard_id: row.id, event_count: 0 };
      manifest.partitions[shard.partition] = entry;
    }
    entry.shard_ids.push(row.id);
    entry.active_shard_id = row.id;
    entry.event_count += shard.events.length;
    for (const event of shard.events) {
      if (manifest.event_locations[event.event_id]) {
        throw contractError('TRANSACTION_ABORTED', 'Duplicate event id found during recovery', {
          reason: 'DUPLICATE_EVENT_ID',
          event_id: event.event_id,
        });
      }
      manifest.event_locations[event.event_id] = row.id;
    }
  }
  manifest.revision = Object.keys(manifest.event_locations).length;
  return manifest;
}

async function ensureIndexedDbManifest(database) {
  const readTransaction = database.transaction(['files'], 'readonly');
  const readCompletion = transactionCompletion(
    readTransaction,
    'Failed to read learning event manifest',
  );
  const row = await requestResult(
    readTransaction.objectStore('files').get(LEARNING_EVENT_MANIFEST_ROW_ID),
    'Failed to read learning event manifest',
  );
  await readCompletion;
  if (row) {
    try {
      return normalizeManifest(row.content);
    } catch (error) {
      if (
        error?.code !== 'TRANSACTION_ABORTED'
        || error?.details?.reason !== 'BAD_EVENT_MANIFEST'
      ) {
        throw error;
      }
    }
  }

  const rows = await listRows(database);
  const manifest = recoverManifestFromShardRows(rows);
  if (!Object.keys(manifest.partitions).length) return manifest;
  const timestamp = rows
    .map((candidate) => candidate.timestamp)
    .filter((candidate) => typeof candidate === 'string')
    .sort()
    .at(-1) || '1970-01-01T00:00:00.000Z';
  assertVocabularyBrowserWriterAllowed('recover_learning_event_manifest');
  const writeTransaction = database.transaction(['files'], 'readwrite');
  const writeCompletion = transactionCompletion(
    writeTransaction,
    'Failed to recover learning event manifest',
  );
  writeTransaction.objectStore('files').put(
    makeRow(LEARNING_EVENT_MANIFEST_ROW_ID, manifest, timestamp),
  );
  await writeCompletion;
  return manifest;
}

export function createIndexedDbLearningEventRepository(options = {}) {
  assertExactKeys(options, ['indexedDBApi'], 'options', false);
  const indexedDBApi = options.indexedDBApi
    || (typeof globalThis !== 'undefined' ? globalThis.indexedDB : null);
  let databasePromise = null;
  const getDatabase = () => {
    if (!databasePromise) databasePromise = openDatabase(indexedDBApi);
    return databasePromise;
  };

  async function append(input) {
    assertVocabularyBrowserWriterAllowed('learning_event_append');
    let transaction = null;
    let completion = null;
    try {
      const event = normalizeLearningEvent(input);
      const database = await getDatabase();
      await ensureIndexedDbManifest(database);
      transaction = database.transaction(['files'], 'readwrite');
      completion = transactionCompletion(transaction, 'Failed to append learning event');
      const result = await bindLearningEventRepositoryToTransaction(
        idbRowPort(transaction),
        eventPartitionFor(event),
      ).append(event);
      await completion;
      return result;
    } catch (error) {
      try {
        if (transaction) transaction.abort();
      } catch {
        // The transaction may already have completed or aborted.
      }
      if (completion) await completion.catch(() => undefined);
      throw normalizeIndexedDbFailure(error, 'append');
    }
  }

  async function loadRowsAndManifest() {
    const database = await getDatabase();
    const manifest = await ensureIndexedDbManifest(database);
    const shardIds = [...new Set(
      Object.values(manifest.partitions)
        .flatMap((partition) => partition.shard_ids),
    )];
    const map = new Map([[
      LEARNING_EVENT_MANIFEST_ROW_ID,
      { id: LEARNING_EVENT_MANIFEST_ROW_ID, content: manifest },
    ]]);
    if (shardIds.length) {
      const transaction = database.transaction(['files'], 'readonly');
      const completion = transactionCompletion(
        transaction,
        'Failed to read learning event shards',
      );
      const store = transaction.objectStore('files');
      const rows = await Promise.all(shardIds.map((rowId) => requestResult(
        store.get(rowId),
        'Failed to read learning event shard',
      )));
      await completion;
      rows.filter(Boolean).forEach((row) => map.set(row.id, row));
    }
    const events = allEventsFromRows(map);
    return { events, map };
  }

  async function getById(eventId) {
    try {
      requiredString(eventId, 'event_id');
      const { events } = await loadRowsAndManifest();
      return cloneJson(events.find((event) => event.event_id === eventId) || null);
    } catch (error) {
      throw normalizeIndexedDbFailure(error, 'getById');
    }
  }

  async function query(queryInput = {}) {
    try {
      const { events } = await loadRowsAndManifest();
      return filterAndSortEvents(events, queryInput);
    } catch (error) {
      throw normalizeIndexedDbFailure(error, 'query');
    }
  }

  return createRepositoryApi({ append, getById, query });
}

function safeDefaultExportId(value) {
  return typeof value === 'string' && DEFAULT_EXPORT_ID_PATTERN.test(value);
}

function sanitizeDefaultSourceLocator(value) {
  if (!isPlainObject(value)) return undefined;
  const result = {};
  if (value.locator_version === 'source-locator.v1') {
    result.locator_version = value.locator_version;
  }
  for (const key of [...DEFAULT_EXPORT_LOCATOR_ID_FIELDS].sort()) {
    if (safeDefaultExportId(value[key])) result[key] = value[key];
  }
  for (const key of [...DEFAULT_EXPORT_LOCATOR_INTEGER_FIELDS].sort()) {
    if (Number.isInteger(value[key]) && value[key] >= 0) result[key] = value[key];
  }
  return Object.keys(result).length ? result : undefined;
}

function sanitizeDefaultEventPayload(payload) {
  const result = {};
  if (safeDefaultExportId(payload.source_id)) result.source_id = payload.source_id;
  if (/^[a-f0-9]{64}$/.test(payload.content_sha256)) {
    result.content_sha256 = payload.content_sha256;
  }
  const locator = sanitizeDefaultSourceLocator(payload.source_locator);
  if (locator) result.source_locator = locator;

  if (
    ['user_owned', 'licensed_open', 'dictionary_terms', 'ai_generated', 'unknown']
      .includes(payload.license_kind)
  ) {
    result.license_kind = payload.license_kind;
  }
  if (['user', 'private', 'third_party', 'public'].includes(payload.ownership)) {
    result.ownership = payload.ownership;
  }
  if (['pending', 'validated', 'rejected'].includes(payload.quality_status)) {
    result.quality_status = payload.quality_status;
  }
  for (const key of ['duplicate_submission', 'imported_event', 'active_duration_reliable']) {
    if (typeof payload[key] === 'boolean') result[key] = payload[key];
  }
  if (safeDefaultExportId(payload.corrects_event_id)) {
    result.corrects_event_id = payload.corrects_event_id;
  }
  if (Array.isArray(payload.corrected_fields)) {
    result.corrected_fields = payload.corrected_fields.filter((field) => (
      typeof field === 'string' && /^[a-z][a-z0-9_.]{0,63}$/.test(field)
    ));
  }
  return result;
}

function sanitizeDefaultStateSnapshot(state) {
  if (state === null || !isPlainObject(state)) return null;
  const result = {};
  if (['review-state.v2', 'acquisition-state.v1'].includes(state.schema_version)) {
    result.schema_version = state.schema_version;
  }
  for (const key of [
    'review_state_id',
    'learning_unit_id',
    'word_id',
    'validated_anchor_id',
    'last_acquisition_attempt_id',
    'introduction_episode_id',
  ]) {
    if (safeDefaultExportId(state[key])) result[key] = state[key];
    else if (state[key] === null) result[key] = null;
  }
  if (['new', 'learning', 'review', 'relearning'].includes(state.state)) {
    result.state = state.state;
  }
  if (
    ['candidate', 'introduced', 'acquiring', 'ready_for_check', 'graduated', 'skipped']
      .includes(state.status)
  ) {
    result.status = state.status;
  }
  for (const key of [
    'due_at',
    'last_review_at',
    'created_at',
    'updated_at',
    'introduced_at',
    'last_exposure_at',
    'ready_for_check_at',
    'graduated_at',
    'skipped_at',
  ]) {
    if (typeof state[key] === 'string' && UTC_TIMESTAMP_PATTERN.test(state[key])) {
      result[key] = state[key];
    } else if (state[key] === null) {
      result[key] = null;
    }
  }
  for (const key of [
    'stability',
    'difficulty',
    'elapsed_days',
    'scheduled_days',
    'reps',
    'lapses',
    'learning_steps',
    'revision',
  ]) {
    if (typeof state[key] === 'number' && Number.isFinite(state[key]) && state[key] >= 0) {
      result[key] = state[key];
    }
  }
  for (const key of ['scheduler_version', 'scheduler_parameters_version']) {
    if (safeDefaultExportId(state[key])) result[key] = state[key];
  }
  if (Array.isArray(state.context_evidence_ids)) {
    result.context_evidence_ids = state.context_evidence_ids.filter(safeDefaultExportId);
  }
  result.extensions = {};
  return result;
}

function sanitizeDefaultGraduationEligibility(eligibility) {
  if (eligibility === null) return null;
  return {
    schema_version: eligibility.schema_version,
    delay_policy_version: eligibility.delay_policy_version,
    eligible: eligibility.eligible,
    reason_codes: eligibility.reason_codes.filter((reason) => GRADUATION_REASON_CODES.has(reason)),
    target_sense_present: eligibility.target_sense_present,
    validated_anchor_present: eligibility.validated_anchor_present,
    delayed_from_introduction: eligibility.delayed_from_introduction,
    answer_unrevealed: eligibility.answer_unrevealed,
    rating_eligible: eligibility.rating_eligible,
    introduction_occurred_at: eligibility.introduction_occurred_at,
    attempt_occurred_at: eligibility.attempt_occurred_at,
    introduction_episode_id: eligibility.introduction_episode_id,
    attempt_episode_id: eligibility.attempt_episode_id,
    elapsed_ms: eligibility.elapsed_ms,
    minimum_delay_ms: eligibility.minimum_delay_ms,
    evaluated_at: eligibility.evaluated_at,
  };
}

function sanitizeEventForDefaultExport(event) {
  return {
    schema_version: event.schema_version,
    event_id: event.event_id,
    command_id: event.command_id,
    correlation_id: event.correlation_id,
    event_type: event.event_type,
    attempt_id: event.attempt_id,
    occurred_at: event.occurred_at,
    recorded_at: event.recorded_at,
    session_id: event.session_id,
    session_position: event.session_position,
    learning_unit_id: event.learning_unit_id,
    word_id: event.word_id,
    target_sense_id: event.target_sense_id,
    policy_version: event.policy_version,
    scheduler_version: event.scheduler_version,
    content_version: event.content_version,
    prompt_mode: event.prompt_mode,
    cue_level: event.cue_level,
    rating: event.rating,
    answer_revealed_before_rating: event.answer_revealed_before_rating,
    graduation_eligibility: sanitizeDefaultGraduationEligibility(
      event.graduation_eligibility,
    ),
    duration_ms: event.duration_ms,
    active_duration_ms: event.active_duration_ms,
    before_state: sanitizeDefaultStateSnapshot(event.before_state),
    after_state: sanitizeDefaultStateSnapshot(event.after_state),
    source_kind: event.source_kind,
    context_evidence_id: event.context_evidence_id,
    is_legacy: event.is_legacy,
    training_eligible: event.training_eligible,
    exclusion_reasons: [...event.exclusion_reasons],
    payload: sanitizeDefaultEventPayload(event.payload),
    extensions: {},
  };
}

function exportMetadata(events, includeSensitiveText) {
  const generatedAt = events.length
    ? events.map((event) => event.recorded_at).sort().at(-1)
    : '1970-01-01T00:00:00.000Z';
  return {
    schema_version: LEARNING_EVENT_EXPORT_SCHEMA_VERSION,
    generated_at: generatedAt,
    include_sensitive_text: includeSensitiveText,
    training_active_duration_max_ms: TRAINING_ACTIVE_DURATION_MAX_MS,
    event_schema_version: LEARNING_EVENT_SCHEMA_VERSION,
    event_type_registry: [...LEARNING_EVENT_TYPES],
    policy_versions: [...new Set(events.map((event) => event.policy_version).filter(Boolean))].sort(),
    scheduler_versions: [
      ...new Set(events.map((event) => event.scheduler_version).filter(Boolean)),
    ].sort(),
    content_versions: [...new Set(events.map((event) => event.content_version).filter(Boolean))].sort(),
    field_dictionary: {
      schema_version: LEARNING_EVENT_EXPORT_DICTIONARY_VERSION,
      fields: {
        schema_version: 'Event envelope schema version.',
        event_id: 'Append-only event identity and idempotency key.',
        command_id: 'Business command receipt identity.',
        correlation_id: 'Cross-record correlation identity.',
        event_type: 'Stable event type from the exported registry.',
        attempt_id: 'Acquisition or review attempt identity, otherwise null.',
        occurred_at: 'UTC business occurrence time.',
        recorded_at: 'UTC persistence observation time.',
        session_id: 'Session identity when applicable.',
        session_position: 'Zero-based position within a session.',
        learning_unit_id: 'Review and acquisition identity.',
        word_id: 'Shared VocabularyEntry identity.',
        target_sense_id: 'Target sense identity when selected.',
        policy_version: 'Queue policy version used for the decision.',
        scheduler_version: 'Scheduler implementation version.',
        content_version: 'Prompt or learning content version.',
        prompt_mode: 'word_only, original_context, or transfer_context.',
        cue_level: 'Strongest cue shown before rating.',
        rating: 'again, hard, good, or easy.',
        answer_revealed_before_rating: 'Whether the answer was revealed before rating.',
        graduation_eligibility: 'Frozen acquisition graduation decision snapshot.',
        duration_ms: 'Wall-clock duration in milliseconds.',
        active_duration_ms: 'Active interaction duration in milliseconds.',
        before_state: 'State snapshot before the event transition.',
        after_state: 'State snapshot after the event transition.',
        source_kind: 'Provenance category for referenced content.',
        context_evidence_id: 'Referenced ContextEvidence identity.',
        is_legacy: 'Whether the event originated from legacy data.',
        training_eligible: 'Whether the event is eligible for training.',
        exclusion_reasons: 'Stable reasons the event is excluded from training.',
        payload: 'Versioned event-type-specific JSON data.',
        extensions: 'Forward-compatible namespaced metadata.',
      },
    },
  };
}

export function exportLearningEvents(events, options) {
  if (!Array.isArray(events)) {
    throw contractError('INVALID_FIELD_TYPE', 'Learning events export input must be an array', {
      field: 'events',
    });
  }
  if (!isPlainObject(options)) {
    throw contractError('INVALID_FIELD_TYPE', 'Learning events export options are required', {
      field: 'options',
    });
  }
  assertExactKeys(options, ['format', 'includeSensitiveText'], 'options', false);
  const format = enumValue(options.format, ['json', 'jsonl'], 'format');
  const includeSensitiveText = options.includeSensitiveText === undefined
    ? false
    : requiredBoolean(options.includeSensitiveText, 'includeSensitiveText');
  const normalizedEvents = filterAndSortEvents(
    events.map((event) => normalizeLearningEvent(event)),
    {},
  ).map((event) => (
    includeSensitiveText
      ? cloneJson(event)
      : sanitizeEventForDefaultExport(event)
  ));
  const metadata = exportMetadata(normalizedEvents, includeSensitiveText);
  if (format === 'json') {
    return JSON.stringify({
      ...metadata,
      events: normalizedEvents,
    }, null, 2);
  }
  return [
    JSON.stringify({ record_type: 'metadata', ...metadata }),
    ...normalizedEvents.map((event) => JSON.stringify({ record_type: 'event', event })),
  ].join('\n');
}
