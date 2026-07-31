export const ACQUISITION_STATUSES = Object.freeze({
  CANDIDATE: 'candidate',
  INTRODUCED: 'introduced',
  ACQUIRING: 'acquiring',
  READY_FOR_CHECK: 'ready_for_check',
  GRADUATED: 'graduated',
  SKIPPED: 'skipped',
});

const LEARNING_UNIT_SCHEMA = 'learning-unit.v1';
const ACQUISITION_STATE_SCHEMA = 'acquisition-state.v1';
const ACQUISITION_ATTEMPT_SCHEMA = 'acquisition-attempt.v1';
const GRADUATION_ELIGIBILITY_SCHEMA = 'graduation-eligibility.v1';
const DELAY_POLICY_VERSION = 'acquisition-delay.v1';
const MINIMUM_DELAY_MS = 86_400_000;

const ACQUISITION_STATUS_VALUES = new Set(Object.values(ACQUISITION_STATUSES));
const ATTEMPT_KINDS = new Set(['exposure', 'delayed_check', 'reassessment']);
const PROMPT_MODES = new Set(['word_only', 'original_context', 'transfer_context']);
const CUE_LEVELS = new Set([
  'none',
  'target_sentence',
  'surrounding_context',
  'morphology_or_pos',
  'translation',
]);
const RATINGS = new Set(['again', 'hard', 'good', 'easy']);

const LEARNING_UNIT_KEYS = new Set([
  'schema_version',
  'learning_unit_id',
  'word_id',
  'normalized_form',
  'language',
  'target_sense_id',
  'target_sense_key',
  'target_sense',
  'created_at',
  'updated_at',
  'archived_at',
  'revision',
  'extensions',
]);
const TARGET_SENSE_KEYS = new Set([
  'gloss',
  'normalized_gloss',
  'part_of_speech',
  'definition',
  'language',
]);
const ACQUISITION_STATE_KEYS = new Set([
  'schema_version',
  'learning_unit_id',
  'status',
  'context_evidence_ids',
  'validated_anchor_id',
  'last_acquisition_attempt_id',
  'introduction_episode_id',
  'introduced_at',
  'last_exposure_at',
  'ready_for_check_at',
  'graduated_at',
  'skipped_at',
  'revision',
  'extensions',
]);
const ACQUISITION_ATTEMPT_KEYS = new Set([
  'schema_version',
  'attempt_id',
  'command_id',
  'correlation_id',
  'learning_unit_id',
  'target_sense_id',
  'attempt_kind',
  'episode_id',
  'session_id',
  'session_position',
  'occurred_at',
  'recorded_at',
  'prompt_mode',
  'cue_level',
  'rating',
  'answer_revealed_before_rating',
  'context_evidence_id',
  'duration_ms',
  'active_duration_ms',
  'graduation_eligibility',
  'extensions',
]);
const GRADUATION_ELIGIBILITY_KEYS = new Set([
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
const GRADUATION_REASON_CODES = Object.freeze([
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
const GRADUATION_REASON_CODE_SET = new Set(GRADUATION_REASON_CODES);

class VocabularyLearningContractError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'VocabularyLearningContractError';
    this.code = code;
    this.details = cloneJson(details);
  }
}

function fail(code, message, details = {}) {
  throw new VocabularyLearningContractError(code, message, details);
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function requireObject(value, field = 'input') {
  if (!isPlainObject(value)) {
    fail('INVALID_FIELD_TYPE', 'Expected a plain object', { field });
  }
  return value;
}

function assertAllowedKeys(value, allowed, field) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      fail('INVALID_FIELD_TYPE', 'Unknown field is not allowed outside extensions', {
        field: `${field}.${key}`,
      });
    }
  }
}

function requireKey(value, key, field) {
  if (!Object.prototype.hasOwnProperty.call(value, key)) {
    fail('MISSING_REQUIRED_FIELD', 'Required field is missing', { field: `${field}.${key}` });
  }
  return value[key];
}

function normalizeSchema(value, expected, field, applyDefaults) {
  if (value === undefined && applyDefaults) return expected;
  if (typeof value !== 'string' || value !== expected) {
    fail('UNSUPPORTED_SCHEMA_VERSION', 'Unsupported schema version', {
      field,
      expected,
      actual: typeof value === 'string' ? value : null,
    });
  }
  return value;
}

function normalizeRequiredId(value, field) {
  if (typeof value !== 'string' || value.length === 0) {
    fail(value === undefined ? 'MISSING_REQUIRED_FIELD' : 'INVALID_FIELD_TYPE', 'Expected a non-empty ID', {
      field,
    });
  }
  return value;
}

function normalizeNullableId(value, field, applyDefaults) {
  if (value === undefined && applyDefaults) return null;
  if (value === null) return null;
  return normalizeRequiredId(value, field);
}

function normalizeRequiredText(value, field, options = {}) {
  if (typeof value !== 'string') {
    fail(value === undefined ? 'MISSING_REQUIRED_FIELD' : 'INVALID_FIELD_TYPE', 'Expected text', { field });
  }
  let normalized = value.normalize('NFKC');
  if (options.collapseWhitespace) normalized = normalized.replace(/\s+/gu, ' ');
  if (options.trim !== false) normalized = normalized.trim();
  if (options.lowercase) normalized = normalized.toLowerCase();
  if (!normalized) fail('INVALID_FIELD_TYPE', 'Text must not be empty', { field });
  return normalized;
}

function normalizeNullableText(value, field, applyDefaults) {
  if (value === undefined && applyDefaults) return null;
  if (value === null) return null;
  return normalizeRequiredText(value, field);
}

function normalizeLanguage(value, field) {
  const normalized = normalizeRequiredText(value, field, { lowercase: true });
  if (!/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/u.test(normalized)) {
    fail('INVALID_FIELD_TYPE', 'Expected a lowercase BCP-47 language tag', { field });
  }
  return normalized;
}

function normalizeTimestamp(value, field, applyDefaults, nullable = false) {
  if (value === undefined && applyDefaults && nullable) return null;
  if (value === null && nullable) return null;
  if (typeof value !== 'string' || !value.endsWith('Z')) {
    fail(value === undefined ? 'MISSING_REQUIRED_FIELD' : 'INVALID_TIMESTAMP', 'Expected a UTC timestamp', {
      field,
    });
  }
  const time = Date.parse(value);
  if (!Number.isFinite(time)) fail('INVALID_TIMESTAMP', 'Expected a valid UTC timestamp', { field });
  return new Date(time).toISOString();
}

function normalizeNonNegativeInteger(value, field, applyDefaults, defaultValue = 0, nullable = false) {
  if (value === undefined && applyDefaults) return nullable ? null : defaultValue;
  if (value === null && nullable) return null;
  if (!Number.isInteger(value) || value < 0) {
    fail(value === undefined ? 'MISSING_REQUIRED_FIELD' : 'INVALID_FIELD_TYPE', 'Expected a non-negative integer', {
      field,
    });
  }
  return value;
}

function normalizeInteger(value, field, nullable = false) {
  if (value === null && nullable) return null;
  if (!Number.isInteger(value)) {
    fail(value === undefined ? 'MISSING_REQUIRED_FIELD' : 'INVALID_FIELD_TYPE', 'Expected an integer', {
      field,
    });
  }
  return value;
}

function normalizeBoolean(value, field, applyDefaults, defaultValue = false) {
  if (value === undefined && applyDefaults) return defaultValue;
  if (typeof value !== 'boolean') {
    fail(value === undefined ? 'MISSING_REQUIRED_FIELD' : 'INVALID_FIELD_TYPE', 'Expected a boolean', { field });
  }
  return value;
}

function normalizeEnum(value, allowed, field, nullable = false, applyDefaults = false) {
  if (value === undefined && applyDefaults && nullable) return null;
  if (value === null && nullable) return null;
  if (typeof value !== 'string' || !allowed.has(value)) {
    fail(value === undefined ? 'MISSING_REQUIRED_FIELD' : 'INVALID_ENUM_VALUE', 'Unexpected enum value', {
      field,
    });
  }
  return value;
}

function validateJsonValue(value, field) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('INVALID_FIELD_TYPE', 'JSON numbers must be finite', { field });
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => validateJsonValue(item, `${field}[${index}]`));
    return;
  }
  if (!isPlainObject(value)) fail('INVALID_FIELD_TYPE', 'Expected a JSON value', { field });
  Object.entries(value).forEach(([key, item]) => validateJsonValue(item, `${field}.${key}`));
}

function cloneJson(value) {
  if (value === undefined) return undefined;
  validateJsonValue(value, 'value');
  return JSON.parse(JSON.stringify(value));
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function normalizeExtensions(value, field, applyDefaults) {
  if (value === undefined && applyDefaults) return {};
  if (!isPlainObject(value)) {
    fail(value === undefined ? 'MISSING_REQUIRED_FIELD' : 'INVALID_FIELD_TYPE', 'Expected an extensions object', {
      field,
    });
  }
  validateJsonValue(value, field);
  return cloneJson(value);
}

function normalizeIdArray(value, field, applyDefaults) {
  if (value === undefined && applyDefaults) return [];
  if (!Array.isArray(value)) {
    fail(value === undefined ? 'MISSING_REQUIRED_FIELD' : 'INVALID_FIELD_TYPE', 'Expected an ID array', { field });
  }
  const normalized = value.map((item, index) => normalizeRequiredId(item, `${field}[${index}]`));
  if (new Set(normalized).size !== normalized.length) {
    fail('INVALID_FIELD_TYPE', 'ID arrays must not contain duplicates', { field });
  }
  return normalized;
}

function normalizeTargetSense(input, applyDefaults) {
  const source = requireObject(input, 'target_sense');
  assertAllowedKeys(source, TARGET_SENSE_KEYS, 'target_sense');
  const normalized = {
    gloss: normalizeRequiredText(requireKey(source, 'gloss', 'target_sense'), 'target_sense.gloss', {
      collapseWhitespace: true,
    }),
    normalized_gloss: normalizeRequiredText(
      requireKey(source, 'normalized_gloss', 'target_sense'),
      'target_sense.normalized_gloss',
      { collapseWhitespace: true },
    ),
    part_of_speech: normalizeNullableText(
      applyDefaults ? source.part_of_speech : requireKey(source, 'part_of_speech', 'target_sense'),
      'target_sense.part_of_speech',
      applyDefaults,
    ),
    definition: normalizeNullableText(
      applyDefaults ? source.definition : requireKey(source, 'definition', 'target_sense'),
      'target_sense.definition',
      applyDefaults,
    ),
    language: normalizeLanguage(requireKey(source, 'language', 'target_sense'), 'target_sense.language'),
  };
  return normalized;
}

export function deriveTargetSenseKey(input) {
  const targetSense = normalizeTargetSense(input, false);
  return [
    targetSense.language.normalize('NFKC').toLowerCase(),
    (targetSense.part_of_speech || '').normalize('NFKC').trim().toLowerCase(),
    targetSense.normalized_gloss.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase(),
  ].join('\u001f');
}

function normalizeLearningUnitInternal(input, applyDefaults) {
  const source = requireObject(input);
  assertAllowedKeys(source, LEARNING_UNIT_KEYS, 'learning_unit');
  const targetSenseValue = applyDefaults
    ? (source.target_sense === undefined ? null : source.target_sense)
    : requireKey(source, 'target_sense', 'learning_unit');
  const targetSense = targetSenseValue === null ? null : normalizeTargetSense(targetSenseValue, applyDefaults);
  const targetSenseId = normalizeNullableId(
    applyDefaults ? source.target_sense_id : requireKey(source, 'target_sense_id', 'learning_unit'),
    'learning_unit.target_sense_id',
    applyDefaults,
  );
  const suppliedTargetSenseKey = normalizeNullableText(
    applyDefaults ? source.target_sense_key : requireKey(source, 'target_sense_key', 'learning_unit'),
    'learning_unit.target_sense_key',
    applyDefaults,
  );
  if ((targetSense === null) !== (targetSenseId === null)) {
    fail('INVALID_STATE_TRANSITION', 'Target sense ID and value must become present together', {
      field: 'learning_unit.target_sense',
    });
  }
  const derivedTargetSenseKey = targetSense ? deriveTargetSenseKey(targetSense) : null;
  if (suppliedTargetSenseKey !== null && suppliedTargetSenseKey !== derivedTargetSenseKey) {
    fail('INVALID_FIELD_TYPE', 'target_sense_key does not match target-sense-key.v1', {
      field: 'learning_unit.target_sense_key',
    });
  }
  const createdAt = normalizeTimestamp(
    requireKey(source, 'created_at', 'learning_unit'),
    'learning_unit.created_at',
    applyDefaults,
  );
  const updatedAt = normalizeTimestamp(
    requireKey(source, 'updated_at', 'learning_unit'),
    'learning_unit.updated_at',
    applyDefaults,
  );
  const archivedAt = normalizeTimestamp(
    applyDefaults ? source.archived_at : requireKey(source, 'archived_at', 'learning_unit'),
    'learning_unit.archived_at',
    applyDefaults,
    true,
  );
  if (Date.parse(updatedAt) < Date.parse(createdAt)) {
    fail('INVALID_TIMESTAMP', 'updated_at must not precede created_at', { field: 'learning_unit.updated_at' });
  }
  if (archivedAt !== null && Date.parse(archivedAt) < Date.parse(createdAt)) {
    fail('INVALID_TIMESTAMP', 'archived_at must not precede created_at', { field: 'learning_unit.archived_at' });
  }
  const normalized = {
    schema_version: normalizeSchema(source.schema_version, LEARNING_UNIT_SCHEMA, 'learning_unit.schema_version', applyDefaults),
    learning_unit_id: normalizeRequiredId(
      requireKey(source, 'learning_unit_id', 'learning_unit'),
      'learning_unit.learning_unit_id',
    ),
    word_id: normalizeRequiredId(requireKey(source, 'word_id', 'learning_unit'), 'learning_unit.word_id'),
    normalized_form: normalizeRequiredText(
      requireKey(source, 'normalized_form', 'learning_unit'),
      'learning_unit.normalized_form',
      { collapseWhitespace: true },
    ),
    language: normalizeLanguage(requireKey(source, 'language', 'learning_unit'), 'learning_unit.language'),
    target_sense_id: targetSenseId,
    target_sense_key: derivedTargetSenseKey,
    target_sense: targetSense,
    created_at: createdAt,
    updated_at: updatedAt,
    archived_at: archivedAt,
    revision: normalizeNonNegativeInteger(
      applyDefaults ? source.revision : requireKey(source, 'revision', 'learning_unit'),
      'learning_unit.revision',
      applyDefaults,
    ),
    extensions: normalizeExtensions(
      applyDefaults ? source.extensions : requireKey(source, 'extensions', 'learning_unit'),
      'learning_unit.extensions',
      applyDefaults,
    ),
  };
  if (normalized.target_sense && normalized.target_sense.language !== normalized.language) {
    fail('INVALID_FIELD_TYPE', 'Target sense language must match the learning unit language', {
      field: 'learning_unit.target_sense.language',
    });
  }
  return normalized;
}

export function normalizeLearningUnit(input) {
  return normalizeLearningUnitInternal(input, true);
}

export function assertLearningUnit(input) {
  const normalized = normalizeLearningUnitInternal(input, false);
  if (canonicalJson(normalized) !== canonicalJson(input)) {
    fail('INVALID_FIELD_TYPE', 'LearningUnit must already be normalized', { field: 'learning_unit' });
  }
}

function normalizeAcquisitionStateInternal(input, applyDefaults) {
  const source = requireObject(input);
  assertAllowedKeys(source, ACQUISITION_STATE_KEYS, 'acquisition_state');
  const contextEvidenceIds = normalizeIdArray(
    applyDefaults ? source.context_evidence_ids : requireKey(source, 'context_evidence_ids', 'acquisition_state'),
    'acquisition_state.context_evidence_ids',
    applyDefaults,
  );
  const validatedAnchorId = normalizeNullableId(
    applyDefaults ? source.validated_anchor_id : requireKey(source, 'validated_anchor_id', 'acquisition_state'),
    'acquisition_state.validated_anchor_id',
    applyDefaults,
  );
  if (validatedAnchorId !== null && !contextEvidenceIds.includes(validatedAnchorId)) {
    fail('INVALID_CONTEXT_REFERENCE', 'Validated anchor must be present in context_evidence_ids', {
      field: 'acquisition_state.validated_anchor_id',
    });
  }
  const status = normalizeEnum(
    requireKey(source, 'status', 'acquisition_state'),
    ACQUISITION_STATUS_VALUES,
    'acquisition_state.status',
  );
  const introductionEpisodeId = normalizeNullableId(
    applyDefaults ? source.introduction_episode_id : requireKey(source, 'introduction_episode_id', 'acquisition_state'),
    'acquisition_state.introduction_episode_id',
    applyDefaults,
  );
  const introducedAt = normalizeTimestamp(
    applyDefaults ? source.introduced_at : requireKey(source, 'introduced_at', 'acquisition_state'),
    'acquisition_state.introduced_at',
    applyDefaults,
    true,
  );
  if (status !== ACQUISITION_STATUSES.CANDIDATE && status !== ACQUISITION_STATUSES.SKIPPED) {
    if (introductionEpisodeId === null || introducedAt === null) {
      fail('INVALID_STATE_TRANSITION', 'Introduced acquisition states require introduction identity and time', {
        field: 'acquisition_state.status',
      });
    }
  }
  const graduatedAt = normalizeTimestamp(
    applyDefaults ? source.graduated_at : requireKey(source, 'graduated_at', 'acquisition_state'),
    'acquisition_state.graduated_at',
    applyDefaults,
    true,
  );
  const skippedAt = normalizeTimestamp(
    applyDefaults ? source.skipped_at : requireKey(source, 'skipped_at', 'acquisition_state'),
    'acquisition_state.skipped_at',
    applyDefaults,
    true,
  );
  if ((status === ACQUISITION_STATUSES.GRADUATED) !== (graduatedAt !== null)) {
    fail('INVALID_STATE_TRANSITION', 'graduated_at is required only for graduated state', {
      field: 'acquisition_state.graduated_at',
    });
  }
  if ((status === ACQUISITION_STATUSES.SKIPPED) !== (skippedAt !== null)) {
    fail('INVALID_STATE_TRANSITION', 'skipped_at is required only for skipped state', {
      field: 'acquisition_state.skipped_at',
    });
  }
  const normalized = {
    schema_version: normalizeSchema(
      source.schema_version,
      ACQUISITION_STATE_SCHEMA,
      'acquisition_state.schema_version',
      applyDefaults,
    ),
    learning_unit_id: normalizeRequiredId(
      requireKey(source, 'learning_unit_id', 'acquisition_state'),
      'acquisition_state.learning_unit_id',
    ),
    status,
    context_evidence_ids: contextEvidenceIds,
    validated_anchor_id: validatedAnchorId,
    last_acquisition_attempt_id: normalizeNullableId(
      applyDefaults
        ? source.last_acquisition_attempt_id
        : requireKey(source, 'last_acquisition_attempt_id', 'acquisition_state'),
      'acquisition_state.last_acquisition_attempt_id',
      applyDefaults,
    ),
    introduction_episode_id: introductionEpisodeId,
    introduced_at: introducedAt,
    last_exposure_at: normalizeTimestamp(
      applyDefaults ? source.last_exposure_at : requireKey(source, 'last_exposure_at', 'acquisition_state'),
      'acquisition_state.last_exposure_at',
      applyDefaults,
      true,
    ),
    ready_for_check_at: normalizeTimestamp(
      applyDefaults ? source.ready_for_check_at : requireKey(source, 'ready_for_check_at', 'acquisition_state'),
      'acquisition_state.ready_for_check_at',
      applyDefaults,
      true,
    ),
    graduated_at: graduatedAt,
    skipped_at: skippedAt,
    revision: normalizeNonNegativeInteger(
      applyDefaults ? source.revision : requireKey(source, 'revision', 'acquisition_state'),
      'acquisition_state.revision',
      applyDefaults,
    ),
    extensions: normalizeExtensions(
      applyDefaults ? source.extensions : requireKey(source, 'extensions', 'acquisition_state'),
      'acquisition_state.extensions',
      applyDefaults,
    ),
  };
  return normalized;
}

export function normalizeAcquisitionState(input) {
  return normalizeAcquisitionStateInternal(input, true);
}

export function assertAcquisitionState(input) {
  const normalized = normalizeAcquisitionStateInternal(input, false);
  if (canonicalJson(normalized) !== canonicalJson(input)) {
    fail('INVALID_FIELD_TYPE', 'AcquisitionState must already be normalized', {
      field: 'acquisition_state',
    });
  }
}

function normalizeGraduationEligibility(input, applyDefaults = false) {
  const source = requireObject(input, 'graduation_eligibility');
  assertAllowedKeys(source, GRADUATION_ELIGIBILITY_KEYS, 'graduation_eligibility');
  const reasonCodes = requireKey(source, 'reason_codes', 'graduation_eligibility');
  if (!Array.isArray(reasonCodes) || reasonCodes.some((code) => !GRADUATION_REASON_CODE_SET.has(code))) {
    fail('INVALID_ENUM_VALUE', 'Unexpected graduation reason code', {
      field: 'graduation_eligibility.reason_codes',
    });
  }
  const canonicalReasonCodes = GRADUATION_REASON_CODES.filter((code) => reasonCodes.includes(code));
  if (canonicalReasonCodes.length !== reasonCodes.length
    || canonicalReasonCodes.some((code, index) => code !== reasonCodes[index])) {
    fail('INVALID_FIELD_TYPE', 'Graduation reason codes must be unique and canonically ordered', {
      field: 'graduation_eligibility.reason_codes',
    });
  }
  const elapsedMs = normalizeInteger(
    requireKey(source, 'elapsed_ms', 'graduation_eligibility'),
    'graduation_eligibility.elapsed_ms',
    true,
  );
  const minimumDelayMs = normalizeNonNegativeInteger(
    requireKey(source, 'minimum_delay_ms', 'graduation_eligibility'),
    'graduation_eligibility.minimum_delay_ms',
    applyDefaults,
  );
  if (minimumDelayMs !== MINIMUM_DELAY_MS) {
    fail('INVALID_FIELD_TYPE', 'minimum_delay_ms must match acquisition-delay.v1', {
      field: 'graduation_eligibility.minimum_delay_ms',
    });
  }
  const normalized = {
    schema_version: normalizeSchema(
      source.schema_version,
      GRADUATION_ELIGIBILITY_SCHEMA,
      'graduation_eligibility.schema_version',
      applyDefaults,
    ),
    delay_policy_version: normalizeSchema(
      source.delay_policy_version,
      DELAY_POLICY_VERSION,
      'graduation_eligibility.delay_policy_version',
      applyDefaults,
    ),
    eligible: normalizeBoolean(requireKey(source, 'eligible', 'graduation_eligibility'), 'graduation_eligibility.eligible'),
    reason_codes: canonicalReasonCodes,
    target_sense_present: normalizeBoolean(
      requireKey(source, 'target_sense_present', 'graduation_eligibility'),
      'graduation_eligibility.target_sense_present',
    ),
    validated_anchor_present: normalizeBoolean(
      requireKey(source, 'validated_anchor_present', 'graduation_eligibility'),
      'graduation_eligibility.validated_anchor_present',
    ),
    delayed_from_introduction: normalizeBoolean(
      requireKey(source, 'delayed_from_introduction', 'graduation_eligibility'),
      'graduation_eligibility.delayed_from_introduction',
    ),
    answer_unrevealed: normalizeBoolean(
      requireKey(source, 'answer_unrevealed', 'graduation_eligibility'),
      'graduation_eligibility.answer_unrevealed',
    ),
    rating_eligible: normalizeBoolean(
      requireKey(source, 'rating_eligible', 'graduation_eligibility'),
      'graduation_eligibility.rating_eligible',
    ),
    introduction_occurred_at: normalizeTimestamp(
      requireKey(source, 'introduction_occurred_at', 'graduation_eligibility'),
      'graduation_eligibility.introduction_occurred_at',
      applyDefaults,
      true,
    ),
    attempt_occurred_at: normalizeTimestamp(
      requireKey(source, 'attempt_occurred_at', 'graduation_eligibility'),
      'graduation_eligibility.attempt_occurred_at',
      applyDefaults,
    ),
    introduction_episode_id: normalizeNullableId(
      requireKey(source, 'introduction_episode_id', 'graduation_eligibility'),
      'graduation_eligibility.introduction_episode_id',
      applyDefaults,
    ),
    attempt_episode_id: normalizeRequiredId(
      requireKey(source, 'attempt_episode_id', 'graduation_eligibility'),
      'graduation_eligibility.attempt_episode_id',
    ),
    elapsed_ms: elapsedMs,
    minimum_delay_ms: minimumDelayMs,
    evaluated_at: normalizeTimestamp(
      requireKey(source, 'evaluated_at', 'graduation_eligibility'),
      'graduation_eligibility.evaluated_at',
      applyDefaults,
    ),
  };
  const expectedEligible = normalized.reason_codes.length === 0
    && normalized.target_sense_present
    && normalized.validated_anchor_present
    && normalized.delayed_from_introduction
    && normalized.answer_unrevealed
    && normalized.rating_eligible;
  if (normalized.eligible !== expectedEligible) {
    fail('INVALID_FIELD_TYPE', 'Graduation eligibility flags and reason codes are inconsistent', {
      field: 'graduation_eligibility.eligible',
    });
  }
  return normalized;
}

function normalizeAcquisitionAttemptInternal(input, applyDefaults) {
  const source = requireObject(input);
  assertAllowedKeys(source, ACQUISITION_ATTEMPT_KEYS, 'acquisition_attempt');
  const attemptKind = normalizeEnum(
    requireKey(source, 'attempt_kind', 'acquisition_attempt'),
    ATTEMPT_KINDS,
    'acquisition_attempt.attempt_kind',
  );
  const rating = normalizeEnum(
    applyDefaults ? source.rating : requireKey(source, 'rating', 'acquisition_attempt'),
    RATINGS,
    'acquisition_attempt.rating',
    true,
    applyDefaults,
  );
  if (attemptKind !== 'exposure' && rating === null) {
    fail('MISSING_REQUIRED_FIELD', 'Non-exposure attempts require a rating', {
      field: 'acquisition_attempt.rating',
    });
  }
  const graduationEligibilityValue = applyDefaults
    ? (source.graduation_eligibility === undefined ? null : source.graduation_eligibility)
    : requireKey(source, 'graduation_eligibility', 'acquisition_attempt');
  const graduationEligibility = graduationEligibilityValue === null
    ? null
    : normalizeGraduationEligibility(graduationEligibilityValue);
  if (attemptKind === 'delayed_check' && graduationEligibility === null) {
    fail('MISSING_REQUIRED_FIELD', 'Delayed checks require graduation eligibility', {
      field: 'acquisition_attempt.graduation_eligibility',
    });
  }
  const occurredAt = normalizeTimestamp(
    requireKey(source, 'occurred_at', 'acquisition_attempt'),
    'acquisition_attempt.occurred_at',
    applyDefaults,
  );
  const recordedAt = normalizeTimestamp(
    requireKey(source, 'recorded_at', 'acquisition_attempt'),
    'acquisition_attempt.recorded_at',
    applyDefaults,
  );
  if (Date.parse(recordedAt) < Date.parse(occurredAt)) {
    fail('INVALID_TIMESTAMP', 'recorded_at must not precede occurred_at', {
      field: 'acquisition_attempt.recorded_at',
    });
  }
  const durationMs = normalizeNonNegativeInteger(
    requireKey(source, 'duration_ms', 'acquisition_attempt'),
    'acquisition_attempt.duration_ms',
    applyDefaults,
  );
  const activeDurationMs = normalizeNonNegativeInteger(
    requireKey(source, 'active_duration_ms', 'acquisition_attempt'),
    'acquisition_attempt.active_duration_ms',
    applyDefaults,
  );
  if (activeDurationMs > durationMs) {
    fail('INVALID_FIELD_TYPE', 'active_duration_ms must not exceed duration_ms', {
      field: 'acquisition_attempt.active_duration_ms',
    });
  }
  const episodeId = normalizeRequiredId(
    requireKey(source, 'episode_id', 'acquisition_attempt'),
    'acquisition_attempt.episode_id',
  );
  const answerRevealed = normalizeBoolean(
    applyDefaults
      ? source.answer_revealed_before_rating
      : requireKey(source, 'answer_revealed_before_rating', 'acquisition_attempt'),
    'acquisition_attempt.answer_revealed_before_rating',
    applyDefaults,
  );
  if (graduationEligibility !== null) {
    const expectedElapsed = graduationEligibility.introduction_occurred_at === null
      ? null
      : Date.parse(occurredAt) - Date.parse(graduationEligibility.introduction_occurred_at);
    const expectedDelayed = expectedElapsed !== null
      && expectedElapsed >= MINIMUM_DELAY_MS
      && graduationEligibility.introduction_episode_id !== null
      && graduationEligibility.introduction_episode_id !== episodeId;
    const expectedRatingEligible = rating !== null && rating !== 'again';
    if (graduationEligibility.attempt_occurred_at !== occurredAt
      || graduationEligibility.attempt_episode_id !== episodeId
      || graduationEligibility.elapsed_ms !== expectedElapsed
      || graduationEligibility.delayed_from_introduction !== expectedDelayed
      || graduationEligibility.answer_unrevealed !== !answerRevealed
      || graduationEligibility.rating_eligible !== expectedRatingEligible) {
      fail('INVALID_CONTEXT_REFERENCE', 'Graduation eligibility does not match its acquisition attempt', {
        field: 'acquisition_attempt.graduation_eligibility',
      });
    }
  }
  const sessionId = normalizeNullableId(
    applyDefaults ? source.session_id : requireKey(source, 'session_id', 'acquisition_attempt'),
    'acquisition_attempt.session_id',
    applyDefaults,
  );
  const sessionPosition = normalizeNonNegativeInteger(
    applyDefaults ? source.session_position : requireKey(source, 'session_position', 'acquisition_attempt'),
    'acquisition_attempt.session_position',
    applyDefaults,
    0,
    true,
  );
  if ((sessionId === null) !== (sessionPosition === null)) {
    fail('INVALID_FIELD_TYPE', 'session_id and session_position must be present together', {
      field: 'acquisition_attempt.session_id',
    });
  }
  return {
    schema_version: normalizeSchema(
      source.schema_version,
      ACQUISITION_ATTEMPT_SCHEMA,
      'acquisition_attempt.schema_version',
      applyDefaults,
    ),
    attempt_id: normalizeRequiredId(requireKey(source, 'attempt_id', 'acquisition_attempt'), 'acquisition_attempt.attempt_id'),
    command_id: normalizeRequiredId(requireKey(source, 'command_id', 'acquisition_attempt'), 'acquisition_attempt.command_id'),
    correlation_id: normalizeRequiredId(
      requireKey(source, 'correlation_id', 'acquisition_attempt'),
      'acquisition_attempt.correlation_id',
    ),
    learning_unit_id: normalizeRequiredId(
      requireKey(source, 'learning_unit_id', 'acquisition_attempt'),
      'acquisition_attempt.learning_unit_id',
    ),
    target_sense_id: normalizeRequiredId(
      requireKey(source, 'target_sense_id', 'acquisition_attempt'),
      'acquisition_attempt.target_sense_id',
    ),
    attempt_kind: attemptKind,
    episode_id: episodeId,
    session_id: sessionId,
    session_position: sessionPosition,
    occurred_at: occurredAt,
    recorded_at: recordedAt,
    prompt_mode: normalizeEnum(
      requireKey(source, 'prompt_mode', 'acquisition_attempt'),
      PROMPT_MODES,
      'acquisition_attempt.prompt_mode',
    ),
    cue_level: normalizeEnum(
      requireKey(source, 'cue_level', 'acquisition_attempt'),
      CUE_LEVELS,
      'acquisition_attempt.cue_level',
    ),
    rating,
    answer_revealed_before_rating: answerRevealed,
    context_evidence_id: normalizeNullableId(
      applyDefaults ? source.context_evidence_id : requireKey(source, 'context_evidence_id', 'acquisition_attempt'),
      'acquisition_attempt.context_evidence_id',
      applyDefaults,
    ),
    duration_ms: durationMs,
    active_duration_ms: activeDurationMs,
    graduation_eligibility: graduationEligibility,
    extensions: normalizeExtensions(
      applyDefaults ? source.extensions : requireKey(source, 'extensions', 'acquisition_attempt'),
      'acquisition_attempt.extensions',
      applyDefaults,
    ),
  };
}

export function normalizeAcquisitionAttempt(input) {
  return normalizeAcquisitionAttemptInternal(input, true);
}

export function assertAcquisitionAttempt(input) {
  const normalized = normalizeAcquisitionAttemptInternal(input, false);
  if (canonicalJson(normalized) !== canonicalJson(input)) {
    fail('INVALID_FIELD_TYPE', 'AcquisitionAttempt must already be normalized', {
      field: 'acquisition_attempt',
    });
  }
}

function normalizeEligibilityAttempt(input) {
  const source = requireObject(input, 'attempt');
  const keys = new Set([
    'attempt_id',
    'learning_unit_id',
    'target_sense_id',
    'episode_id',
    'occurred_at',
    'rating',
    'answer_revealed_before_rating',
    'context_evidence_id',
  ]);
  assertAllowedKeys(source, keys, 'attempt');
  return {
    attempt_id: normalizeRequiredId(requireKey(source, 'attempt_id', 'attempt'), 'attempt.attempt_id'),
    learning_unit_id: normalizeRequiredId(
      requireKey(source, 'learning_unit_id', 'attempt'),
      'attempt.learning_unit_id',
    ),
    target_sense_id: normalizeRequiredId(
      requireKey(source, 'target_sense_id', 'attempt'),
      'attempt.target_sense_id',
    ),
    episode_id: normalizeRequiredId(requireKey(source, 'episode_id', 'attempt'), 'attempt.episode_id'),
    occurred_at: normalizeTimestamp(requireKey(source, 'occurred_at', 'attempt'), 'attempt.occurred_at'),
    rating: normalizeEnum(requireKey(source, 'rating', 'attempt'), RATINGS, 'attempt.rating', true),
    answer_revealed_before_rating: normalizeBoolean(
      requireKey(source, 'answer_revealed_before_rating', 'attempt'),
      'attempt.answer_revealed_before_rating',
    ),
    context_evidence_id: normalizeNullableId(
      requireKey(source, 'context_evidence_id', 'attempt'),
      'attempt.context_evidence_id',
    ),
  };
}

function normalizeEligibilityAnchor(input) {
  if (input === null) return null;
  const source = requireObject(input, 'validated_anchor');
  return {
    context_evidence_id: normalizeRequiredId(
      requireKey(source, 'context_evidence_id', 'validated_anchor'),
      'validated_anchor.context_evidence_id',
    ),
    learning_unit_id: normalizeRequiredId(
      requireKey(source, 'learning_unit_id', 'validated_anchor'),
      'validated_anchor.learning_unit_id',
    ),
    quality_status: normalizeRequiredText(
      requireKey(source, 'quality_status', 'validated_anchor'),
      'validated_anchor.quality_status',
    ),
  };
}

export function evaluateGraduationEligibility(input) {
  const source = requireObject(input);
  assertAllowedKeys(
    source,
    new Set(['learning_unit', 'acquisition_state', 'validated_anchor', 'attempt', 'evaluated_at']),
    'input',
  );
  const learningUnit = normalizeLearningUnitInternal(requireKey(source, 'learning_unit', 'input'), false);
  const acquisitionState = normalizeAcquisitionStateInternal(
    requireKey(source, 'acquisition_state', 'input'),
    false,
  );
  const validatedAnchor = normalizeEligibilityAnchor(requireKey(source, 'validated_anchor', 'input'));
  const attempt = normalizeEligibilityAttempt(requireKey(source, 'attempt', 'input'));
  const evaluatedAt = normalizeTimestamp(requireKey(source, 'evaluated_at', 'input'), 'evaluated_at');

  const learningUnitMismatch = acquisitionState.learning_unit_id !== learningUnit.learning_unit_id
    || attempt.learning_unit_id !== learningUnit.learning_unit_id;
  const targetSensePresent = learningUnit.target_sense_id !== null && learningUnit.target_sense !== null;
  const targetSenseMismatch = targetSensePresent && attempt.target_sense_id !== learningUnit.target_sense_id;
  const validatedAnchorPresent = validatedAnchor !== null && acquisitionState.validated_anchor_id !== null;
  const anchorLearningUnitMismatch = validatedAnchor !== null
    && validatedAnchor.learning_unit_id !== learningUnit.learning_unit_id;
  const anchorNotValidated = validatedAnchor !== null && validatedAnchor.quality_status !== 'validated';
  const contextEvidenceMismatch = validatedAnchor !== null && (
    acquisitionState.validated_anchor_id !== validatedAnchor.context_evidence_id
    || attempt.context_evidence_id !== validatedAnchor.context_evidence_id
  );
  const introductionTimestampMissing = acquisitionState.introduced_at === null;
  const introductionEpisodeMissing = acquisitionState.introduction_episode_id === null;
  const introductionTime = introductionTimestampMissing ? null : Date.parse(acquisitionState.introduced_at);
  const attemptTime = Date.parse(attempt.occurred_at);
  const elapsedMs = introductionTime === null || attemptTime < introductionTime
    ? (introductionTime === null ? null : 0)
    : attemptTime - introductionTime;
  const attemptBeforeIntroduction = introductionTime !== null && attemptTime < introductionTime;
  const sameEpisode = !introductionEpisodeMissing
    && acquisitionState.introduction_episode_id === attempt.episode_id;
  const minimumDelayNotReached = introductionTime !== null
    && !attemptBeforeIntroduction
    && elapsedMs < MINIMUM_DELAY_MS;
  const delayedFromIntroduction = elapsedMs !== null
    && elapsedMs >= MINIMUM_DELAY_MS
    && !introductionEpisodeMissing
    && !sameEpisode;
  const answerUnrevealed = !attempt.answer_revealed_before_rating;
  const ratingEligible = attempt.rating !== null && attempt.rating !== 'again';

  const conditions = new Map([
    ['LEARNING_UNIT_MISMATCH', learningUnitMismatch],
    ['TARGET_SENSE_MISSING', !targetSensePresent],
    ['TARGET_SENSE_MISMATCH', targetSenseMismatch],
    ['VALIDATED_ANCHOR_MISSING', !validatedAnchorPresent],
    ['ANCHOR_LEARNING_UNIT_MISMATCH', anchorLearningUnitMismatch],
    ['ANCHOR_NOT_VALIDATED', anchorNotValidated],
    ['CONTEXT_EVIDENCE_MISMATCH', contextEvidenceMismatch],
    ['INTRODUCTION_TIMESTAMP_MISSING', introductionTimestampMissing],
    ['ATTEMPT_BEFORE_INTRODUCTION', attemptBeforeIntroduction],
    ['INTRODUCTION_EPISODE_MISSING', introductionEpisodeMissing],
    ['ATTEMPT_EPISODE_MISSING', false],
    ['SAME_ACQUISITION_EPISODE', sameEpisode],
    ['MINIMUM_DELAY_NOT_REACHED', minimumDelayNotReached],
    ['ANSWER_REVEALED_BEFORE_RATING', !answerUnrevealed],
    ['RATING_MISSING', attempt.rating === null],
    ['RATING_AGAIN', attempt.rating === 'again'],
  ]);
  const reasonCodes = GRADUATION_REASON_CODES.filter((code) => conditions.get(code));
  const eligible = !learningUnitMismatch
    && targetSensePresent
    && !targetSenseMismatch
    && validatedAnchorPresent
    && !anchorLearningUnitMismatch
    && !anchorNotValidated
    && !contextEvidenceMismatch
    && delayedFromIntroduction
    && answerUnrevealed
    && ratingEligible;

  return {
    schema_version: GRADUATION_ELIGIBILITY_SCHEMA,
    delay_policy_version: DELAY_POLICY_VERSION,
    eligible,
    reason_codes: reasonCodes,
    target_sense_present: targetSensePresent,
    validated_anchor_present: validatedAnchorPresent,
    delayed_from_introduction: delayedFromIntroduction,
    answer_unrevealed: answerUnrevealed,
    rating_eligible: ratingEligible,
    introduction_occurred_at: acquisitionState.introduced_at,
    attempt_occurred_at: attempt.occurred_at,
    introduction_episode_id: acquisitionState.introduction_episode_id,
    attempt_episode_id: attempt.episode_id,
    elapsed_ms: introductionTime === null ? null : attemptTime - introductionTime,
    minimum_delay_ms: MINIMUM_DELAY_MS,
    evaluated_at: evaluatedAt,
  };
}
