import {
  normalizePresentationVariant,
  normalizePresentationVariants,
} from './presentation-features.js';

export const PREFERENCE_ESTIMATOR_VERSION = 'presentation-preference.v1';
export const PREFERENCE_MODEL_VERSION = PREFERENCE_ESTIMATOR_VERSION;

export const DEFAULT_PREFERENCE_ESTIMATION_OPTIONS = Object.freeze({
  prior_strength: 4,
  minimum_samples_for_confidence: 3,
  reveal_reference_ms: 8_000,
  minimum_active_duration_ms: 250,
  maximum_active_duration_ms: 30 * 60 * 1_000,
  default_expected_duration_ms: 4_000,
  duration_by_difficulty_band: Object.freeze({
    none: 1_500,
    easy: 2_500,
    medium: 4_000,
    hard: 6_000,
    unspecified: 4_000,
  }),
});

const ESTIMATION_OPTION_ALIASES = Object.freeze({
  prior_strength: Object.freeze(['prior_strength', 'priorStrength']),
  minimum_samples_for_confidence: Object.freeze([
    'minimum_samples_for_confidence',
    'minimumSamplesForConfidence',
  ]),
  reveal_reference_ms: Object.freeze(['reveal_reference_ms', 'revealReferenceMs']),
  minimum_active_duration_ms: Object.freeze([
    'minimum_active_duration_ms',
    'minimumActiveDurationMs',
  ]),
  maximum_active_duration_ms: Object.freeze([
    'maximum_active_duration_ms',
    'maximumActiveDurationMs',
  ]),
  default_expected_duration_ms: Object.freeze([
    'default_expected_duration_ms',
    'defaultExpectedDurationMs',
  ]),
});

const RATING_SIGNAL = Object.freeze({
  again: 0,
  hard: -0.06,
  good: 0.06,
  easy: 0.10,
});

const REASON_MESSAGES = Object.freeze({
  ABNORMAL_DURATION_IGNORED: 'Abnormal or unreliable active duration was ignored for preference.',
  COMPLETION_SIGNAL_USED: 'Completion was used as a weak engagement signal.',
  CONTENT_INVALID_EXCLUDED: 'Invalid or unusable content was excluded from preference evidence.',
  CONTENT_NOT_VALIDATED_EXCLUDED: 'Content without an explicit valid status was excluded from preference training.',
  DETERMINISTIC_DEFAULT_BASELINE: 'No reliable variant evidence; the ranker should use its deterministic default.',
  DURATION_MISSING: 'No usable active duration was available.',
  DURATION_SIGNAL_USED: 'A bounded, difficulty-aware active-duration signal was used.',
  EVENT_EXCLUSION_REASONS_PRESENT: 'Learning event exclusion reasons made the event ineligible for preference training.',
  TRAINING_INELIGIBLE_EXCLUDED: 'training_eligible=false excluded the event from preference training.',
  TRAINING_ELIGIBILITY_MISSING: 'Missing training_eligible marker made the event ineligible for preference training.',
  TRAINING_INELIGIBLE: 'The event explicitly declared itself ineligible for training.',
  INVALID_TRAINING_ELIGIBILITY: 'Invalid training eligibility marker made the event ineligible for training.',
  INVALID_EXCLUSION_REASONS: 'Invalid exclusion reasons made the event ineligible for training.',
  INVALID_EXCLUSION_REASON: 'An invalid exclusion reason made the event ineligible for training.',
  MISSING_EVENT_ID_EXCLUDED: 'Missing event_id made the event ineligible for replay-safe preference training.',
  DUPLICATE_EVENT_ID_IGNORED: 'A duplicate event_id was ignored to keep append-only submissions idempotent.',
  EVENT_ID_CONFLICT_EXCLUDED: 'Conflicting canonical payloads for one event_id were excluded as a group.',
  KNOWLEDGE_CONFONDED_SIGNAL_IGNORED: 'Knowledge failure or uncertainty suppressed confounded negative preference signals.',
  KNOWLEDGE_FAILURE_NOT_NEGATIVE_PREFERENCE: 'Knowledge failure was not treated as dislike of the presentation.',
  KNOWLEDGE_UNRESOLVED_NEGATIVE_IGNORED: 'Missing or unknown knowledge outcome suppressed negative preference signals.',
  NEGATIVE_PREFERENCE_INSUFFICIENT_EVIDENCE: 'Negative preference requires isolated knowledge evidence and enough observations.',
  LOW_SAMPLE_UNCERTAIN: 'The sample is below the confidence threshold; the estimate remains uncertain.',
  INVALID_EVENT_EXCLUDED: 'The event did not have a usable presentation variant.',
  RATING_SIGNAL_USED: 'Rating was used only as a weak presentation signal.',
  RATING_IGNORED_KNOWLEDGE_CONFOUNDED: 'Rating was ignored because it is confounded with knowledge outcome.',
  REPLAY_SIGNAL_USED: 'Active replay was used as a bounded engagement signal.',
  REVEAL_FRICTION_USED: 'Early answer reveal was used as a bounded format-friction signal.',
  REVEAL_IGNORED_KNOWLEDGE_CONFOUNDED: 'Answer reveal was ignored because knowledge outcome was confounded.',
  REVEAL_DELAY_MISSING: 'Answer reveal had no usable delay, so no reveal-friction signal was added.',
  SKIP_SIGNAL_USED: 'Skip was used as a weak negative engagement signal.',
  SKIP_IGNORED_KNOWLEDGE_CONFOUNDED: 'Skip was not treated as dislike when knowledge outcome was confounded.',
  NO_VARIANT_OBSERVATIONS: 'No eligible observations were seen for this variant.',
  RELATIVE_TO_GLOBAL_BASELINE: 'Variant preference is measured relative to the smoothed all-variant baseline.',
  UNSEEN_VARIANT: 'This variant was not observed; preference contribution is neutral.',
});

const FAILURE_TOKENS = new Set([
  'again',
  'failed',
  'failure',
  'forgot',
  'incorrect',
  'wrong',
]);
const UNCERTAIN_TOKENS = new Set(['partial', 'uncertain', 'unknown', 'ambiguous']);
const SUCCESS_TOKENS = new Set(['correct', 'known', 'retained', 'success', 'succeeded']);
const INVALID_CONTENT_TOKENS = new Set([
  'invalid',
  'malformed',
  'mismatch',
  'mismatched',
  'poor',
  'rejected',
  'unusable',
]);
const VALID_CONTENT_TOKENS = new Set(['authentic', 'valid', 'validated', 'usable']);
const SKIP_TOKENS = new Set(['skip', 'skipped']);
const COMPLETE_TOKENS = new Set([
  'complete',
  'completed',
  'failure',
  'finished',
  'partial',
  'success',
]);

export class PreferenceEstimationError extends TypeError {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'PreferenceEstimationError';
    this.code = code;
    this.details = { ...details };
  }
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function firstDefined(source, keys) {
  for (const key of keys) {
    if (source[key] !== undefined && source[key] !== null) return source[key];
  }
  return undefined;
}

function optionValue(source, keys) {
  if (!isPlainObject(source)) return undefined;
  for (const key of keys) {
    if (
      Object.prototype.hasOwnProperty.call(source, key)
      && source[key] !== undefined
      && source[key] !== null
    ) return source[key];
  }
  return undefined;
}

function normalizedFiniteOption(source, key, fallback, { minimum = null } = {}) {
  const raw = optionValue(source, ESTIMATION_OPTION_ALIASES[key] ?? [key]);
  if (raw === undefined || raw === null) return fallback;
  if (!Number.isFinite(raw)) {
    throw new PreferenceEstimationError(
      'INVALID_NUMERIC_OPTION',
      `${key} must be a finite number`,
      { field: key },
    );
  }
  if (minimum !== null && raw < minimum) {
    throw new PreferenceEstimationError(
      'INVALID_NUMERIC_OPTION',
      `${key} must be at least ${minimum}`,
      { field: key },
    );
  }
  return raw;
}

function normalizeDurationBaselines(source) {
  const raw = optionValue(source, ['duration_by_difficulty_band', 'durationByDifficultyBand']);
  if (raw === undefined || raw === null) {
    return { ...DEFAULT_PREFERENCE_ESTIMATION_OPTIONS.duration_by_difficulty_band };
  }
  if (!isPlainObject(raw)) {
    throw new PreferenceEstimationError(
      'INVALID_NUMERIC_OPTION',
      'duration_by_difficulty_band must be a plain object',
      { field: 'duration_by_difficulty_band' },
    );
  }
  const entries = [];
  for (const key of Object.keys(raw).sort(compareStrings)) {
    const value = raw[key];
    if (!Number.isFinite(value)) {
      throw new PreferenceEstimationError(
        'INVALID_NUMERIC_OPTION',
        `duration_by_difficulty_band.${key} must be a finite number`,
        { field: `duration_by_difficulty_band.${key}` },
      );
    }
    if (value <= 0) {
      throw new PreferenceEstimationError(
        'INVALID_NUMERIC_OPTION',
        `duration_by_difficulty_band.${key} must be greater than zero`,
        { field: `duration_by_difficulty_band.${key}` },
      );
    }
    entries.push([key, value]);
  }
  return Object.fromEntries(entries);
}

/** Normalize every estimator numeric option before any arithmetic occurs. */
export function normalizePreferenceEstimationOptions(options = {}) {
  const source = isPlainObject(options) ? options : {};
  const normalized = {
    prior_strength: normalizedFiniteOption(
      source,
      'prior_strength',
      DEFAULT_PREFERENCE_ESTIMATION_OPTIONS.prior_strength,
      { minimum: 0 },
    ),
    minimum_samples_for_confidence: normalizedFiniteOption(
      source,
      'minimum_samples_for_confidence',
      DEFAULT_PREFERENCE_ESTIMATION_OPTIONS.minimum_samples_for_confidence,
      { minimum: 0 },
    ),
    reveal_reference_ms: normalizedFiniteOption(
      source,
      'reveal_reference_ms',
      DEFAULT_PREFERENCE_ESTIMATION_OPTIONS.reveal_reference_ms,
      { minimum: 0 },
    ),
    minimum_active_duration_ms: normalizedFiniteOption(
      source,
      'minimum_active_duration_ms',
      DEFAULT_PREFERENCE_ESTIMATION_OPTIONS.minimum_active_duration_ms,
      { minimum: 0 },
    ),
    maximum_active_duration_ms: normalizedFiniteOption(
      source,
      'maximum_active_duration_ms',
      DEFAULT_PREFERENCE_ESTIMATION_OPTIONS.maximum_active_duration_ms,
      { minimum: 0 },
    ),
    default_expected_duration_ms: normalizedFiniteOption(
      source,
      'default_expected_duration_ms',
      DEFAULT_PREFERENCE_ESTIMATION_OPTIONS.default_expected_duration_ms,
      { minimum: 0 },
    ),
    duration_by_difficulty_band: normalizeDurationBaselines(source),
  };
  if (normalized.maximum_active_duration_ms < normalized.minimum_active_duration_ms) {
    throw new PreferenceEstimationError(
      'INVALID_NUMERIC_OPTION',
      'maximum_active_duration_ms must not be below minimum_active_duration_ms',
      { field: 'maximum_active_duration_ms' },
    );
  }
  // Candidate collections are not numeric options, but preserving these
  // aliases keeps the array overload deterministic after option validation.
  for (const key of ['variants', 'candidate_variants', 'candidateVariants']) {
    if (Array.isArray(source[key])) normalized[key] = source[key];
  }
  return normalized;
}

function readBoolean(source, keys) {
  const value = firstDefined(source, keys);
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }
  return undefined;
}

function readBooleanFlags(source, keys) {
  let seen = false;
  let anyTrue = false;
  let anyFalse = false;
  for (const key of keys) {
    const value = source[key];
    let normalized;
    if (typeof value === 'boolean') normalized = value;
    else if (typeof value === 'string') {
      const token = value.trim().toLowerCase();
      if (token === 'true') normalized = true;
      else if (token === 'false') normalized = false;
    }
    if (normalized === undefined) continue;
    seen = true;
    if (normalized) anyTrue = true;
    else anyFalse = true;
  }
  return { seen, anyTrue, anyFalse };
}

function readBooleanWithFalsePrecedence(source, keys) {
  const flags = readBooleanFlags(source, keys);
  if (flags.anyFalse) return false;
  if (flags.anyTrue) return true;
  return undefined;
}

function readBooleanWithTruePrecedence(source, keys) {
  const flags = readBooleanFlags(source, keys);
  if (flags.anyTrue) return true;
  if (flags.anyFalse) return false;
  return undefined;
}

function readStrictBooleanWithFalsePrecedence(source, keys) {
  let seen = false;
  let invalid = false;
  let anyTrue = false;
  let anyFalse = false;
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(source, key)) continue;
    seen = true;
    if (source[key] === true) anyTrue = true;
    else if (source[key] === false) anyFalse = true;
    else invalid = true;
  }
  return {
    seen,
    invalid,
    value: anyFalse ? false : anyTrue ? true : undefined,
  };
}

function normalizeToken(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase().replace(/\s+/g, '_');
  return normalized || null;
}

function compareStrings(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function normalizeRating(value) {
  if (typeof value === 'number' && Number.isInteger(value)) {
    return { 1: 'again', 2: 'hard', 3: 'good', 4: 'easy' }[value] ?? null;
  }
  const token = normalizeToken(value);
  if (token && Object.prototype.hasOwnProperty.call(RATING_SIGNAL, token)) return token;
  return null;
}

function normalizeKnowledgeStatus(source, rating) {
  const explicitCorrect = readBooleanWithFalsePrecedence(source, [
    'knowledge_correct',
    'answer_correct',
    'correct',
    'is_correct',
  ]);
  const explicitFailure = readBooleanWithFalsePrecedence(source, [
    'knowledge_failed',
    'knowledge_failure',
    'knowledgeFailed',
    'knowledgeFailure',
  ]);
  const rawStatus = firstDefined(source, [
    'knowledge_outcome',
    'knowledgeOutcome',
    'knowledge_result',
    'knowledgeResult',
    'knowledge_status',
    'knowledgeStatus',
    'answer_outcome',
    'answerOutcome',
    'skill_outcome',
    'skillOutcome',
    'outcome',
    'status',
  ]);
  const status = normalizeToken(rawStatus);
  // Conservative conflict handling: a failure marker wins over a positive
  // marker so contradictory event extensions cannot turn knowledge difficulty
  // into apparent format dislike (or apparent format approval).
  if (explicitCorrect === false || explicitFailure === true) return 'failure';
  if (status && FAILURE_TOKENS.has(status)) return 'failure';
  if (status && UNCERTAIN_TOKENS.has(status)) return 'uncertain';
  if (explicitCorrect === true || explicitFailure === false) return 'success';
  if (status && SUCCESS_TOKENS.has(status)) return 'success';
  // `again` is a knowledge signal in the existing rating vocabulary, not a
  // safe standalone indication that a presentation was disliked.
  if (rating === 'again') return 'failure';
  return 'unknown';
}

function normalizeContentStatus(source) {
  const explicitValid = readBooleanWithFalsePrecedence(source, [
    'content_valid',
    'contentValid',
    'sentence_valid',
    'sentenceValid',
    'is_content_valid',
    'isContentValid',
    'is_sentence_valid',
    'isSentenceValid',
  ]);
  const rawStatus = firstDefined(source, [
    'content_status',
    'contentStatus',
    'sentence_quality',
    'sentenceQuality',
    'content_quality',
    'contentQuality',
    'quality_status',
    'qualityStatus',
  ]);
  const status = normalizeToken(rawStatus);
  // Invalid quality evidence is a hard exclusion even if another extension
  // optimistically marked the item valid.
  if (status && INVALID_CONTENT_TOKENS.has(status)) return 'invalid';
  if (explicitValid === false) return 'invalid';
  if (explicitValid === true) return 'valid';
  if (status && VALID_CONTENT_TOKENS.has(status)) return 'valid';
  return 'unknown';
}

function normalizeEventId(source) {
  const raw = firstDefined(source, ['event_id', 'eventId', 'id']);
  if (typeof raw !== 'string') return null;
  const normalized = raw.trim();
  return normalized || null;
}

function normalizeExclusionReasons(source) {
  const raw = firstDefined(source, ['exclusion_reasons', 'exclusionReasons']);
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) return ['INVALID_EXCLUSION_REASONS'];
  const reasons = [];
  for (const value of raw) {
    if (typeof value !== 'string' || !value.trim()) {
      reasons.push('INVALID_EXCLUSION_REASON');
      continue;
    }
    const normalized = value.trim();
    if (!reasons.includes(normalized)) reasons.push(normalized);
  }
  return reasons.sort(compareStrings);
}

function normalizeTrainingEligibility(source) {
  const trainingKeys = [
    'training_eligible',
    'trainingEligible',
  ];
  const strictMarker = readStrictBooleanWithFalsePrecedence(source, trainingKeys);
  const hasTrainingMarker = strictMarker.seen;
  const explicitTrainingEligible = strictMarker.value;
  const reasons = normalizeExclusionReasons(source);
  const invalidTrainingMarker = hasTrainingMarker
    && (strictMarker.invalid || explicitTrainingEligible === undefined);
  if (invalidTrainingMarker && !reasons.includes('INVALID_TRAINING_ELIGIBILITY')) {
    reasons.push('INVALID_TRAINING_ELIGIBILITY');
    reasons.sort(compareStrings);
  }
  if (!hasTrainingMarker && !reasons.includes('TRAINING_ELIGIBILITY_MISSING')) {
    reasons.push('TRAINING_ELIGIBILITY_MISSING');
    reasons.sort(compareStrings);
  }
  const trainingEligible = explicitTrainingEligible === true
    && !invalidTrainingMarker
    && reasons.length === 0;
  if (!trainingEligible && explicitTrainingEligible === false && reasons.length === 0) {
    reasons.push('TRAINING_INELIGIBLE');
  }
  return {
    training_eligible: trainingEligible,
    exclusion_reasons: reasons,
  };
}

function normalizeReplayCount(source) {
  const rawCount = firstDefined(source, [
    'active_replay_count',
    'activeReplayCount',
    'replay_count',
    'replayCount',
    'replays',
  ]);
  const count = finiteNumber(rawCount);
  if (count !== null) return Math.max(0, Math.floor(count));
  const replayed = readBooleanWithTruePrecedence(source, [
    'active_replay',
    'activeReplay',
    'active_replayed',
    'activeReplayed',
    'replayed',
    'was_replayed',
    'wasReplayed',
  ]);
  return replayed === true ? 1 : 0;
}

function normalizeDuration(source, options) {
  const rawDuration = firstDefined(source, [
    'effective_duration_ms',
    'effectiveDurationMs',
    'active_duration_ms',
    'activeDurationMs',
    'duration_ms',
    'durationMs',
  ]);
  const duration = finiteNumber(rawDuration);
  const explicitAnomaly = readBooleanWithTruePrecedence(source, [
    'duration_anomaly',
    'durationAnomaly',
    'timing_anomaly',
    'timingAnomaly',
    'is_abnormal_duration',
    'isAbnormalDuration',
    'abnormal_duration',
    'abnormalDuration',
  ]);
  const reliableMarker = readBooleanWithFalsePrecedence(source, [
    'active_duration_reliable',
    'activeDurationReliable',
  ]);
  const unreliable = reliableMarker === false;
  if (duration === null) {
    return {
      active_duration_ms: null,
      duration_status: explicitAnomaly === true || unreliable ? 'abnormal' : 'missing',
      active_duration_reliable: reliableMarker ?? null,
    };
  }
  const totalDuration = finiteNumber(firstDefined(source, ['duration_ms', 'durationMs']));
  const outOfBounds = duration < 0
    || duration < options.minimum_active_duration_ms
    || duration > options.maximum_active_duration_ms
    || (totalDuration !== null && duration > totalDuration);
  // An explicit reliable marker is evidence that the event producer already
  // handled pause/background timing. It must not become an anomaly merely
  // because this estimator has a generic duration bound. Explicit anomaly or
  // explicit unreliability still wins, and a negative duration is impossible.
  const abnormal = explicitAnomaly === true
    || unreliable
    || duration < 0
    || (reliableMarker !== true && outOfBounds);
  return {
    active_duration_ms: duration,
    duration_status: abnormal ? 'abnormal' : 'valid',
    active_duration_reliable: reliableMarker ?? null,
  };
}

function resolveVariant(source) {
  const rawVariant = firstDefined(source, [
    'presentation_variant',
    'presentation',
    'variant',
    'variant_id',
    'prompt_mode',
  ]);
  if (rawVariant === undefined) return null;

  const extensionFeatures = isPlainObject(source.presentation_features)
    ? source.presentation_features
    : (isPlainObject(source.features) ? source.features : {});
  if (isPlainObject(rawVariant)) {
    return normalizePresentationVariant({
      ...rawVariant,
      features: {
        ...(isPlainObject(rawVariant.features) ? rawVariant.features : {}),
        ...extensionFeatures,
      },
    });
  }
  return normalizePresentationVariant({
    variant_id: rawVariant,
    features: extensionFeatures,
  });
}

function resolveCompleted(source, skipped, rating) {
  const explicitCompleted = readBooleanWithFalsePrecedence(source, [
    'completed',
    'isCompleted',
    'is_completed',
    'attempt_completed',
    'attemptCompleted',
  ]);
  if (explicitCompleted !== undefined) return explicitCompleted && !skipped;

  const status = normalizeToken(firstDefined(source, ['status', 'outcome']));
  if (status && COMPLETE_TOKENS.has(status)) return !skipped;
  if (rating !== null) return !skipped;
  return false;
}

function resolveSkipped(source) {
  const explicitSkipped = readBooleanWithFalsePrecedence(source, [
    'skipped',
    'is_skipped',
    'isSkipped',
  ]);
  if (explicitSkipped !== undefined) return explicitSkipped;
  const status = normalizeToken(firstDefined(source, ['status', 'outcome']));
  return status !== null && SKIP_TOKENS.has(status);
}

function normalizeReveal(source) {
  const explicitRevealed = readBooleanWithFalsePrecedence(source, [
    'answer_revealed_before_rating',
    'answerRevealedBeforeRating',
    'answer_revealed',
    'answerRevealed',
    'revealed_answer',
    'revealedAnswer',
  ]);
  const rawDelay = firstDefined(source, [
    'reveal_delay_ms',
    'revealDelayMs',
    'answer_reveal_delay_ms',
    'answerRevealDelayMs',
    'time_to_reveal_ms',
    'timeToRevealMs',
  ]);
  const delay = finiteNumber(rawDelay);
  const revealed = explicitRevealed ?? delay !== null;
  return {
    answer_revealed_before_rating: revealed,
    reveal_delay_ms: delay !== null && delay >= 0 ? delay : null,
  };
}

/**
 * Convert a loose behavior observation into a small, non-sensitive record.
 * Invalid records are returned as excluded records instead of causing one
 * malformed historical event to abort a rebuild.
 */
export function normalizePreferenceEvent(input, options = {}) {
  const mergedOptions = normalizePreferenceEstimationOptions(options);
  const eventId = isPlainObject(input) ? normalizeEventId(input) : null;
  if (!isPlainObject(input)) {
    return {
      valid: false,
      exclusion_reason: 'INVALID_EVENT',
      event_id: eventId,
      variant: null,
    };
  }

  let variant;
  try {
    variant = resolveVariant(input);
  } catch (error) {
    return {
      valid: false,
      exclusion_reason: 'INVALID_EVENT',
      event_id: eventId,
      variant: null,
      error_code: error.code ?? 'INVALID_PRESENTATION_VARIANT',
    };
  }
  if (variant === null) {
    return {
      valid: false,
      exclusion_reason: 'INVALID_EVENT',
      event_id: eventId,
      variant: null,
    };
  }

  const rating = normalizeRating(input.rating);
  const skipped = resolveSkipped(input);
  const completed = resolveCompleted(input, skipped, rating);
  const reveal = normalizeReveal(input);
  const duration = normalizeDuration(input, mergedOptions);
  const contentStatus = normalizeContentStatus(input);
  const knowledgeStatus = normalizeKnowledgeStatus(input, rating);
  const training = normalizeTrainingEligibility(input);
  if (eventId === null && !training.exclusion_reasons.includes('MISSING_EVENT_ID_EXCLUDED')) {
    training.exclusion_reasons.push('MISSING_EVENT_ID_EXCLUDED');
    training.exclusion_reasons.sort(compareStrings);
  }
  const expectedDuration = finiteNumber(firstDefined(input, [
    'expected_duration_ms',
    'expectedDurationMs',
    'presentation_expected_duration_ms',
    'presentationExpectedDurationMs',
  ]));

  return {
    valid: true,
    event_id: eventId,
    variant,
    completed,
    skipped,
    rating,
    knowledge_status: knowledgeStatus,
    content_status: contentStatus,
    answer_revealed_before_rating: reveal.answer_revealed_before_rating,
    reveal_delay_ms: reveal.reveal_delay_ms,
    replay_count: normalizeReplayCount(input),
    active_duration_ms: duration.active_duration_ms,
    duration_status: duration.duration_status,
    active_duration_reliable: duration.active_duration_reliable,
    expected_duration_ms: expectedDuration !== null && expectedDuration > 0
      ? expectedDuration
      : null,
    training_eligible: training.training_eligible
      && eventId !== null
      && contentStatus === 'valid',
    exclusion_reasons: training.exclusion_reasons,
  };
}

function addReason(reasonCounts, code, count = 1) {
  reasonCounts.set(code, (reasonCounts.get(code) ?? 0) + count);
}

function scorePart(parts, code, value) {
  if (value === 0) return;
  parts.push({ code, value });
}

function expectedDurationForEvent(record, options) {
  if (record.expected_duration_ms !== null) return record.expected_duration_ms;
  const band = record.variant.features.sentence_difficulty_band;
  const configured = isPlainObject(options.duration_by_difficulty_band)
    ? finiteNumber(options.duration_by_difficulty_band[band])
    : null;
  return configured ?? options.default_expected_duration_ms;
}

function isKnowledgeConfounded(record) {
  return record.knowledge_status === 'failure' || record.knowledge_status === 'uncertain';
}

function isKnowledgeIsolated(record) {
  // Only an explicit successful/correct knowledge outcome isolates a
  // presentation signal from the learner's ability on the item.
  return record.knowledge_status === 'success';
}

function contentWeight(record, reasonCounts) {
  if (record.content_status === 'invalid') {
    addReason(reasonCounts, 'CONTENT_INVALID_EXCLUDED');
    return 0;
  }
  if (record.content_status !== 'valid') {
    addReason(reasonCounts, 'CONTENT_NOT_VALIDATED_EXCLUDED');
    return 0;
  }
  return 1;
}

function trainingEligibilityWeight(record, reasonCounts) {
  const exclusionReasons = Array.isArray(record.exclusion_reasons)
    ? record.exclusion_reasons
    : ['INVALID_EXCLUSION_REASONS'];
  if (record.training_eligible === false) {
    addReason(reasonCounts, 'TRAINING_INELIGIBLE_EXCLUDED');
  }
  if (exclusionReasons.length > 0) {
    addReason(reasonCounts, 'EVENT_EXCLUSION_REASONS_PRESENT');
    for (const reason of exclusionReasons) addReason(reasonCounts, reason);
  }
  if (record.event_id === null) {
    addReason(reasonCounts, 'MISSING_EVENT_ID_EXCLUDED');
  }
  if (record.content_status !== 'valid') {
    addReason(reasonCounts, 'CONTENT_NOT_VALIDATED_EXCLUDED');
  }
  return record.training_eligible === true
    && record.event_id !== null
    && record.content_status === 'valid'
    && exclusionReasons.length === 0
    ? 1
    : 0;
}

function excludedScore(record, reasonCounts) {
  const reasonCodes = [...reasonCounts.keys()].sort();
  return {
    eligible: false,
    signal: 0,
    weight: 0,
    reason_codes: reasonCodes,
    reason_counts: Object.fromEntries(reasonCodes.map((code) => [code, reasonCounts.get(code)])),
    record,
  };
}

/**
 * Score one event without looking at other events.  This function is useful
 * for adapters and makes the confounder policy explicit for verification.
 */
function scoreNormalizedPreferenceEvent(record, mergedOptions) {
  const reasonCounts = new Map();
  if (!record.valid) {
    addReason(reasonCounts, 'INVALID_EVENT_EXCLUDED');
    return excludedScore(record, reasonCounts);
  }

  const weight = contentWeight(record, reasonCounts);
  const trainingWeight = trainingEligibilityWeight(record, reasonCounts);
  if (weight === 0 || trainingWeight === 0) {
    return excludedScore(record, reasonCounts);
  }

  const parts = [];
  const knowledgeConfounded = isKnowledgeConfounded(record);
  const knowledgeIsolated = isKnowledgeIsolated(record);

  if (record.skipped) {
    if (!knowledgeIsolated) {
      if (knowledgeConfounded) {
        addReason(reasonCounts, 'SKIP_IGNORED_KNOWLEDGE_CONFOUNDED');
        addReason(reasonCounts, 'KNOWLEDGE_FAILURE_NOT_NEGATIVE_PREFERENCE');
      } else {
        addReason(reasonCounts, 'KNOWLEDGE_UNRESOLVED_NEGATIVE_IGNORED');
      }
    } else {
      scorePart(parts, 'SKIP_SIGNAL_USED', -0.65);
      addReason(reasonCounts, 'SKIP_SIGNAL_USED');
    }
  } else if (record.completed) {
    scorePart(parts, 'COMPLETION_SIGNAL_USED', 0.28);
    addReason(reasonCounts, 'COMPLETION_SIGNAL_USED');
  }

  if (record.rating !== null) {
    if (!knowledgeIsolated) {
      if (record.rating === 'again' || knowledgeConfounded) {
        addReason(reasonCounts, 'RATING_IGNORED_KNOWLEDGE_CONFOUNDED');
        if (knowledgeConfounded) addReason(reasonCounts, 'KNOWLEDGE_FAILURE_NOT_NEGATIVE_PREFERENCE');
      } else {
        addReason(reasonCounts, 'KNOWLEDGE_UNRESOLVED_NEGATIVE_IGNORED');
      }
    } else {
      scorePart(parts, 'RATING_SIGNAL_USED', RATING_SIGNAL[record.rating]);
      addReason(reasonCounts, 'RATING_SIGNAL_USED');
    }
  }

  if (record.answer_revealed_before_rating) {
    if (!knowledgeIsolated) {
      if (knowledgeConfounded) {
        addReason(reasonCounts, 'REVEAL_IGNORED_KNOWLEDGE_CONFOUNDED');
        addReason(reasonCounts, 'KNOWLEDGE_FAILURE_NOT_NEGATIVE_PREFERENCE');
      } else {
        addReason(reasonCounts, 'KNOWLEDGE_UNRESOLVED_NEGATIVE_IGNORED');
      }
    } else if (record.reveal_delay_ms === null) {
      addReason(reasonCounts, 'REVEAL_DELAY_MISSING');
    } else {
      const revealReference = Math.max(1, mergedOptions.reveal_reference_ms);
      const quickReveal = clamp(1 - record.reveal_delay_ms / revealReference, 0, 1);
      scorePart(parts, 'REVEAL_FRICTION_USED', -0.18 * quickReveal);
      if (quickReveal > 0) addReason(reasonCounts, 'REVEAL_FRICTION_USED');
    }
  }

  if (record.replay_count > 0) {
    if (knowledgeConfounded) {
      addReason(reasonCounts, 'KNOWLEDGE_CONFONDED_SIGNAL_IGNORED');
    } else {
      const replaySignal = Math.min(0.14, 0.05 * record.replay_count);
      scorePart(parts, 'REPLAY_SIGNAL_USED', replaySignal);
      addReason(reasonCounts, 'REPLAY_SIGNAL_USED');
    }
  }

  if (record.duration_status === 'abnormal') {
    addReason(reasonCounts, 'ABNORMAL_DURATION_IGNORED');
  } else if (record.duration_status === 'missing') {
    addReason(reasonCounts, 'DURATION_MISSING');
  } else if (!knowledgeIsolated) {
    if (knowledgeConfounded) addReason(reasonCounts, 'KNOWLEDGE_CONFONDED_SIGNAL_IGNORED');
    else addReason(reasonCounts, 'KNOWLEDGE_UNRESOLVED_NEGATIVE_IGNORED');
  } else {
    const expected = Math.max(1, expectedDurationForEvent(record, mergedOptions));
    const durationRatio = Math.log(Math.max(1, record.active_duration_ms) / expected);
    scorePart(parts, 'DURATION_SIGNAL_USED', 0.08 * Math.tanh(durationRatio));
    addReason(reasonCounts, 'DURATION_SIGNAL_USED');
  }

  // Events with no positive/negative component still count as low-information
  // observations. Their neutral weight helps uncertainty fall slowly rather
  // than pretending that a missing field is a strong preference signal.
  const signal = clamp(parts.reduce((sum, part) => sum + part.value, 0), -1, 1);
  const effectiveWeight = weight * (parts.length > 0 ? 1 : 0.25);
  const reasonCodes = [...reasonCounts.keys()].sort();
  return {
    eligible: true,
    signal,
    weight: effectiveWeight,
    reason_codes: reasonCodes,
    reason_counts: Object.fromEntries(reasonCodes.map((code) => [code, reasonCounts.get(code)])),
    parts,
    record,
  };
}

/**
 * Public scorer: always rebuild a complete normalized record. A caller cannot
 * smuggle NaN, Infinity, or missing fields through a forged `valid: true`
 * object and alter the arithmetic path.
 */
export function scorePreferenceEvent(input, options = {}) {
  const mergedOptions = normalizePreferenceEstimationOptions(options);
  const record = normalizePreferenceEvent(input, mergedOptions);
  return scoreNormalizedPreferenceEvent(record, mergedOptions);
}

function eventCannotTrain(record) {
  return !record.valid
    || record.event_id === null
    || record.training_eligible !== true
    || !Array.isArray(record.exclusion_reasons)
    || record.exclusion_reasons.length > 0
    || record.content_status !== 'valid';
}

function compareNormalizedEvents(left, right) {
  const leftCannotTrain = eventCannotTrain(left);
  const rightCannotTrain = eventCannotTrain(right);
  if (leftCannotTrain !== rightCannotTrain) return leftCannotTrain ? -1 : 1;
  return compareStrings(JSON.stringify(left), JSON.stringify(right));
}

function canonicalEventPayloadKey(record) {
  const payload = { ...record };
  delete payload.event_id;
  return JSON.stringify(payload);
}

function deduplicateEventsById(events) {
  const byEventId = new Map();
  const anonymous = [];
  let duplicateCount = 0;
  let conflictGroupCount = 0;
  let conflictEventCount = 0;
  for (const event of events) {
    if (event.event_id === null) {
      anonymous.push(event);
      continue;
    }
    const group = byEventId.get(event.event_id);
    if (!group) {
      byEventId.set(event.event_id, {
        payload_key: canonicalEventPayloadKey(event),
        records: [event],
        conflict: false,
      });
      continue;
    }
    duplicateCount += 1;
    group.records.push(event);
    if (group.payload_key !== canonicalEventPayloadKey(event)) group.conflict = true;
  }

  const deduplicated = [...byEventId.values()]
    .flatMap((group) => {
      if (group.conflict) {
        conflictGroupCount += 1;
        conflictEventCount += group.records.length;
        return [];
      }
      return [group.records[0]];
    })
    .concat(anonymous)
    .sort(compareNormalizedEvents);
  return {
    events: deduplicated,
    duplicateCount,
    conflictGroupCount,
    conflictEventCount,
  };
}

function createStats() {
  return {
    observed_count: 0,
    eligible_count: 0,
    excluded_count: 0,
    effective_sample_count: 0,
    positive_evidence: 0,
    negative_evidence: 0,
    signal_sum: 0,
    reason_counts: new Map(),
    completion_count: 0,
    skip_count: 0,
    reveal_count: 0,
    replay_count: 0,
    rating_count: 0,
    abnormal_duration_count: 0,
    knowledge_confounded_count: 0,
    invalid_content_count: 0,
  };
}

function addStats(stats, scored) {
  for (const [code, count] of Object.entries(scored.reason_counts ?? {})) {
    addReason(stats.reason_counts, code, count);
  }
  const record = scored.record;
  if (!record?.valid) return;
  stats.observed_count += 1;
  if (record.content_status === 'invalid') stats.invalid_content_count += 1;
  if (record.duration_status === 'abnormal') stats.abnormal_duration_count += 1;
  if (isKnowledgeConfounded(record)) stats.knowledge_confounded_count += 1;
  if (record.completed && !record.skipped) stats.completion_count += 1;
  if (record.skipped) stats.skip_count += 1;
  if (record.answer_revealed_before_rating) stats.reveal_count += 1;
  stats.replay_count += record.replay_count;
  if (record.rating !== null) stats.rating_count += 1;

  if (!scored.eligible) {
    stats.excluded_count += 1;
    return;
  }
  stats.eligible_count += 1;
  stats.effective_sample_count += scored.weight;
  stats.signal_sum += scored.signal * scored.weight;
  stats.positive_evidence += Math.max(0, scored.signal) * scored.weight;
  stats.negative_evidence += Math.max(0, -scored.signal) * scored.weight;
}

function mergeStats(target, source) {
  for (const key of [
    'observed_count',
    'eligible_count',
    'excluded_count',
    'effective_sample_count',
    'positive_evidence',
    'negative_evidence',
    'signal_sum',
    'completion_count',
    'skip_count',
    'reveal_count',
    'replay_count',
    'rating_count',
    'abnormal_duration_count',
    'knowledge_confounded_count',
    'invalid_content_count',
  ]) {
    target[key] += source[key];
  }
  for (const [code, count] of source.reason_counts) addReason(target.reason_counts, code, count);
}

function statsMean(stats, priorStrength) {
  const denominator = priorStrength + stats.effective_sample_count;
  if (denominator <= 0) return 0;
  return clamp(
    (stats.positive_evidence - stats.negative_evidence) / denominator,
    -1,
    1,
  );
}

function statsUncertainty(stats, priorStrength) {
  if (stats.eligible_count === 0) return 1;
  const confidence = stats.effective_sample_count
    / (stats.effective_sample_count + Math.max(0.001, priorStrength));
  const signalAgreement = stats.effective_sample_count === 0
    ? 1
    : 1 - clamp(Math.abs(stats.signal_sum) / stats.effective_sample_count, 0, 1);
  return clamp((1 - confidence) * 0.8 + signalAgreement * 0.2, 0, 1);
}

function sortedReasonCodes(reasonCounts) {
  return [...reasonCounts.keys()].sort();
}

function reasonObjects(reasonCodes, reasonCounts) {
  return reasonCodes.map((code) => ({
    code,
    message: Object.prototype.hasOwnProperty.call(REASON_MESSAGES, code)
      ? REASON_MESSAGES[code]
      : 'A deterministic preference-estimation rule was applied.',
    count: reasonCounts?.get(code) ?? undefined,
  })).map((reason) => {
    if (reason.count === undefined) {
      const { count, ...withoutCount } = reason;
      return withoutCount;
    }
    return reason;
  });
}

function buildEstimate(variant, stats, baseline, options) {
  const priorStrength = Math.max(0.001, options.prior_strength);
  const rawMean = statsMean(stats, priorStrength);
  const uncertainty = statsUncertainty(stats, priorStrength);
  const reasonCounts = new Map(stats.reason_counts);
  const negativeEvidenceSufficient = stats.negative_evidence > 0
    && stats.eligible_count >= options.minimum_samples_for_confidence;
  if (stats.eligible_count === 0) {
    addReason(reasonCounts, 'NO_VARIANT_OBSERVATIONS');
    addReason(reasonCounts, 'UNSEEN_VARIANT');
  } else {
    addReason(reasonCounts, 'RELATIVE_TO_GLOBAL_BASELINE');
    if (stats.eligible_count < options.minimum_samples_for_confidence) {
      addReason(reasonCounts, 'LOW_SAMPLE_UNCERTAIN');
    }
    if (stats.negative_evidence > 0 && !negativeEvidenceSufficient) {
      addReason(reasonCounts, 'NEGATIVE_PREFERENCE_INSUFFICIENT_EVIDENCE');
    }
  }
  const observed = stats.eligible_count > 0;
  const rawRelativePreference = rawMean - baseline.mean;
  // An unresolved/unknown knowledge record may be neutral evidence, but it
  // must not become a negative presentation preference merely because another
  // variant has a positive global baseline. Negative preference is enabled
  // only after explicit knowledge isolation and enough eligible observations.
  const relativePreference = observed
    ? clamp(
      negativeEvidenceSufficient
        ? rawRelativePreference
        : Math.max(0, rawRelativePreference),
      -1,
      1,
    )
    : 0;
  const reasonCodes = sortedReasonCodes(reasonCounts);
  return {
    version: PREFERENCE_ESTIMATOR_VERSION,
    variant_id: variant.variant_id,
    features: { ...variant.features },
    preference_score: relativePreference,
    raw_mean: rawMean,
    baseline_mean: baseline.mean,
    sample_count: stats.eligible_count,
    observed_count: stats.observed_count,
    excluded_count: stats.excluded_count,
    effective_sample_count: stats.effective_sample_count,
    uncertainty: observed ? uncertainty : 1,
    observed,
    signal_summary: {
      positive_evidence: stats.positive_evidence,
      negative_evidence: stats.negative_evidence,
      completion_count: stats.completion_count,
      skip_count: stats.skip_count,
      reveal_count: stats.reveal_count,
      replay_count: stats.replay_count,
      rating_count: stats.rating_count,
      abnormal_duration_count: stats.abnormal_duration_count,
      knowledge_confounded_count: stats.knowledge_confounded_count,
      invalid_content_count: stats.invalid_content_count,
    },
    reason_codes: reasonCodes,
    reasons: reasonObjects(reasonCodes, reasonCounts),
  };
}

function resolveEstimatorInput(input, options) {
  if (Array.isArray(input)) {
    return {
      events: input,
      variants: options.variants
        ?? options.candidate_variants
        ?? options.candidateVariants
        ?? [],
    };
  }
  if (!isPlainObject(input)) {
    throw new PreferenceEstimationError(
      'INVALID_ESTIMATOR_INPUT',
      'preference estimator input must be an events array or object',
      { field: 'input' },
    );
  }
  return {
    events: input.events ?? input.history ?? [],
    variants: input.variants
      ?? input.presentations
      ?? input.candidate_variants
      ?? input.candidateVariants
      ?? input.allowed_presentations
      ?? options.variants
      ?? options.candidate_variants
      ?? options.candidateVariants
      ?? [],
  };
}

/**
 * Estimate relative presentation preference from immutable event snapshots.
 * The output is rebuildable from the same history and contains no persistence
 * or runtime integration behavior.
 */
export function estimatePresentationPreferences(input, options = {}) {
  const mergedOptions = normalizePreferenceEstimationOptions(options);
  const { events, variants } = resolveEstimatorInput(input, mergedOptions);
  if (!Array.isArray(events)) {
    throw new PreferenceEstimationError(
      'INVALID_ESTIMATOR_EVENTS',
      'preference estimator events must be an array',
      { field: 'events' },
    );
  }
  if (!Array.isArray(variants)) {
    throw new PreferenceEstimationError(
      'INVALID_ESTIMATOR_VARIANTS',
      'preference estimator variants must be an array',
      { field: 'variants' },
    );
  }

  const normalizedVariants = normalizePresentationVariants(variants);
  // Summation is commutative mathematically, but IEEE-754 addition is not
  // bit-for-bit commutative across different iteration orders. Canonicalize
  // the small normalized records before accumulating so replaying history in
  // a different source order still produces identical JSON numbers.
  const normalizedEventRecords = events
    .map((event) => normalizePreferenceEvent(event, mergedOptions))
    .sort(compareNormalizedEvents);
  const {
    events: normalizedEvents,
    duplicateCount,
    conflictGroupCount,
    conflictEventCount,
  } = deduplicateEventsById(normalizedEventRecords);
  const variantCandidates = normalizePresentationVariants([
    ...normalizedVariants,
    ...normalizedEvents
      .filter((event) => event.valid && event.variant)
      .map((event) => event.variant),
  ]);

  const statsByVariant = new Map(variantCandidates.map((variant) => [
    variant.variant_id,
    createStats(),
  ]));
  const globalStats = createStats();
  const globalExclusionReasons = new Map();
  if (duplicateCount > 0) {
    addReason(globalExclusionReasons, 'DUPLICATE_EVENT_ID_IGNORED', duplicateCount);
  }
  if (conflictGroupCount > 0) {
    addReason(globalExclusionReasons, 'EVENT_ID_CONFLICT_EXCLUDED', conflictGroupCount);
  }

  for (const event of normalizedEvents) {
    if (!event.valid || !event.variant) {
      addReason(globalExclusionReasons, 'INVALID_EVENT_EXCLUDED');
      continue;
    }
    const scored = scoreNormalizedPreferenceEvent(event, mergedOptions);
    const stats = statsByVariant.get(event.variant.variant_id) ?? createStats();
    statsByVariant.set(event.variant.variant_id, stats);
    addStats(stats, scored);
    if (scored.eligible) addStats(globalStats, scored);
    else {
      // Keep invalid-content and other exclusions visible globally without
      // letting them enter the baseline's denominator.
      const record = scored.record;
      if (record?.valid) {
        globalStats.observed_count += 1;
        globalStats.excluded_count += 1;
        for (const [code, count] of Object.entries(scored.reason_counts ?? {})) {
          addReason(globalExclusionReasons, code, count);
        }
      }
    }
  }

  const baseline = {
    version: PREFERENCE_ESTIMATOR_VERSION,
    mean: statsMean(globalStats, Math.max(0.001, mergedOptions.prior_strength)),
    sample_count: globalStats.eligible_count,
    observed_count: globalStats.observed_count,
    excluded_count: globalStats.excluded_count,
    effective_sample_count: globalStats.effective_sample_count,
    uncertainty: statsUncertainty(globalStats, Math.max(0.001, mergedOptions.prior_strength)),
  };
  const estimates = variantCandidates
    .map((variant) => buildEstimate(
      variant,
      statsByVariant.get(variant.variant_id) ?? createStats(),
      baseline,
      mergedOptions,
    ))
    .sort((left, right) => (
      left.variant_id < right.variant_id ? -1 : left.variant_id > right.variant_id ? 1 : 0
    ));

  const globalReasonCounts = new Map(globalStats.reason_counts);
  for (const [code, count] of globalExclusionReasons) addReason(globalReasonCounts, code, count);
  if (globalStats.eligible_count === 0) {
    addReason(globalReasonCounts, 'DETERMINISTIC_DEFAULT_BASELINE');
  }
  const globalReasonCodes = sortedReasonCodes(globalReasonCounts);

  // Object.fromEntries defines `__proto__` as a normal own data property,
  // keeping the open variant-id namespace enumerable and serializable.
  const byVariant = Object.fromEntries(
    estimates.map((estimate) => [estimate.variant_id, estimate]),
  );
  return {
    version: PREFERENCE_ESTIMATOR_VERSION,
    estimator_version: PREFERENCE_ESTIMATOR_VERSION,
    baseline,
    estimates,
    by_variant: byVariant,
    events_seen: events.length,
    events_deduplicated: normalizedEvents.length,
    duplicate_event_count: duplicateCount,
    conflicting_event_id_count: conflictGroupCount,
    conflicting_event_count: conflictEventCount,
    events_excluded: normalizedEvents.filter((event) => !event.valid).length
      + globalStats.excluded_count
      + duplicateCount
      + conflictGroupCount,
    reason_codes: globalReasonCodes,
    reasons: reasonObjects(globalReasonCodes, globalReasonCounts),
  };
}

export function estimatePreferenceBaseline(input, options = {}) {
  return estimatePresentationPreferences(input, options);
}

export function estimatePresentationPreference(variant, events, options = {}) {
  const result = estimatePresentationPreferences({ variants: [variant], events }, options);
  return result.estimates[0] ?? {
    version: PREFERENCE_ESTIMATOR_VERSION,
    variant_id: normalizePresentationVariant(variant).variant_id,
    preference_score: 0,
    sample_count: 0,
    uncertainty: 1,
    observed: false,
    reason_codes: ['NO_VARIANT_OBSERVATIONS', 'UNSEEN_VARIANT'],
    reasons: reasonObjects(['NO_VARIANT_OBSERVATIONS', 'UNSEEN_VARIANT']),
  };
}
