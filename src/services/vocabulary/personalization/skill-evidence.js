import { SKILL_TAXONOMY, normalizeSkillTags } from './skill-taxonomy.js';

export const SKILL_EVIDENCE_SCHEMA_VERSION = 'skill-evidence.v1';
export const SKILL_EVENT_ID_POLICY = 'skill-event-id-required.v1';
export const SKILL_EVIDENCE_OUTCOMES = Object.freeze([
  'success',
  'partial',
  'failure',
  'skip',
]);

// Keep this ceiling aligned with the event-data quality boundary without
// importing the event repository into the personalization layer.
export const SKILL_EVIDENCE_ACTIVE_DURATION_MAX_MS = 30 * 60 * 1000;

export const SKILL_EVIDENCE_REASON_ORDER = Object.freeze([
  'MISSING_EVENT_ID',
  'DUPLICATE_EVENT_ID_CONFLICT',
  'TRAINING_ELIGIBILITY_MISSING',
  'MISSING_LEARNING_UNIT_ID',
  'MISSING_OCCURRED_AT',
  'AMBIGUOUS_OCCURRED_AT',
  'INVALID_OCCURRED_AT',
  'MISSING_SKILL_TAGS',
  'UNKNOWN_SKILL',
  'NO_KNOWN_SKILL_TAGS',
  'OUTCOME_UNKNOWN',
  'SKIP_NOT_FAILURE',
  'PRESENTATION_SIGNAL_NOT_SKILL_FAILURE',
  'ANSWER_REVEALED',
  'ANSWER_REVEALED_BEFORE_RATING',
  'STRONG_CUE',
  'LEGACY',
  'LEGACY_EVENT',
  'TRAINING_INELIGIBLE',
  'IMPORTED_EVENT',
  'TARGET_SENSE_MISSING',
  'PROMPT_MODE_MISSING',
  'CUE_LEVEL_MISSING',
  'POLICY_VERSION_MISSING',
  'SCHEDULER_VERSION_MISSING',
  'STATE_TRANSITION_MISSING',
  'ACTIVE_DURATION_INVALID',
  'ACTIVE_DURATION_EXCEEDS_DURATION',
  'ACTIVE_DURATION_UNRELIABLE',
  'ABNORMAL_ACTIVE_DURATION',
  'CONTENT_DIFFICULTY_DOWNWEIGHTED',
  'CONTENT_DIFFICULTY_EXCLUDED',
  'INVALID_CONTENT_EXCLUDED',
  'PRESENTATION_DISLIKE_NOT_KNOWLEDGE_FAILURE',
  'PRESENTATION_SIGNAL_EXCLUDED',
  'DUPLICATE_SUBMISSION',
  'INVALID_STATE_TRANSITION',
  'EXPLICIT_ZERO_WEIGHT',
  'WEIGHT_CLAMPED',
  'EVENT_EXCLUSION',
]);

const REASON_ORDER = new Map(SKILL_EVIDENCE_REASON_ORDER.map((reason, index) => [reason, index]));
const HARD_EXCLUSION_REASONS = new Set([
  'MISSING_EVENT_ID',
  'DUPLICATE_EVENT_ID_CONFLICT',
  'TRAINING_ELIGIBILITY_MISSING',
  'MISSING_LEARNING_UNIT_ID',
  'MISSING_OCCURRED_AT',
  'AMBIGUOUS_OCCURRED_AT',
  'INVALID_OCCURRED_AT',
  'MISSING_SKILL_TAGS',
  'NO_KNOWN_SKILL_TAGS',
  'OUTCOME_UNKNOWN',
  'ANSWER_REVEALED',
  'ANSWER_REVEALED_BEFORE_RATING',
  'LEGACY',
  'LEGACY_EVENT',
  'TRAINING_INELIGIBLE',
  'IMPORTED_EVENT',
  'TARGET_SENSE_MISSING',
  'PROMPT_MODE_MISSING',
  'CUE_LEVEL_MISSING',
  'POLICY_VERSION_MISSING',
  'SCHEDULER_VERSION_MISSING',
  'STATE_TRANSITION_MISSING',
  'ACTIVE_DURATION_INVALID',
  'ACTIVE_DURATION_EXCEEDS_DURATION',
  'ACTIVE_DURATION_UNRELIABLE',
  'ABNORMAL_ACTIVE_DURATION',
  'CONTENT_DIFFICULTY_EXCLUDED',
  'INVALID_CONTENT_EXCLUDED',
  'PRESENTATION_SIGNAL_EXCLUDED',
  'DUPLICATE_SUBMISSION',
  'INVALID_STATE_TRANSITION',
  'EVENT_EXCLUSION',
]);

const TRAINING_EXCLUSION_REASONS = new Set([
  ...HARD_EXCLUSION_REASONS,
  'DUPLICATE_SUBMISSION',
  'INVALID_STATE_TRANSITION',
  'CONTENT_DIFFICULTY_DOWNWEIGHTED',
  'PRESENTATION_DISLIKE_NOT_KNOWLEDGE_FAILURE',
]);

const STRONG_CUE_VALUES = new Set([
  'translation',
  'meaning',
  'definition',
  'answer',
  'answer_revealed',
  'full',
  'strong',
  '中文释义',
]);

const HIGH_DIFFICULTY_VALUES = new Set([
  'hard',
  'high',
  'very_high',
  'too_hard',
  'complex',
  'difficult',
]);

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function readField(source, names) {
  const input = asObject(source);
  const payload = asObject(input.payload);
  for (const name of names) {
    if (input[name] !== undefined && input[name] !== null) return input[name];
    if (payload[name] !== undefined && payload[name] !== null) return payload[name];
  }
  return undefined;
}

function readBoolean(source, names) {
  const value = readField(source, names);
  if (value === true || value === false) return value;
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true' || normalized === 'yes' || normalized === '1') return true;
  if (normalized === 'false' || normalized === 'no' || normalized === '0') return false;
  return undefined;
}

function normalizeEventId(event) {
  const source = asObject(event);
  const value = source.event_id ?? source.eventId;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function canonicalize(value, seen = new Set()) {
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Date) return value.toISOString();
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => canonicalize(item, seen));
  const result = {};
  for (const key of Object.keys(value).sort(compareText)) {
    result[key] = canonicalize(value[key], seen);
  }
  seen.delete(value);
  return result;
}

function canonicalEventSignature(event) {
  return JSON.stringify(canonicalize(asObject(event)));
}

/**
 * Event ids are the only safe replay identity. Exact duplicates are collapsed;
 * conflicting payloads sharing an id are represented once and marked unsafe;
 * events without an id are retained only so conversion can emit an exclusion.
 */
export function deduplicateLearningEvents(events) {
  const values = Array.isArray(events) ? events : [];
  const firstById = new Map();
  const accepted = [];

  for (const event of values) {
    const eventId = normalizeEventId(event);
    if (!eventId) {
      accepted.push({ event, event_id_status: 'missing' });
      continue;
    }

    const signature = canonicalEventSignature(event);
    const first = firstById.get(eventId);
    if (!first) {
      const entry = { event, event_id: eventId, signature, event_id_status: 'valid' };
      firstById.set(eventId, entry);
      accepted.push(entry);
      continue;
    }

    if (first.signature !== signature) {
      first.event_id_status = 'conflict';
      if (compareText(signature, first.signature) < 0) {
        first.event = event;
        first.signature = signature;
      }
    }
    // Equal payloads and conflicting repeats are both emitted at most once.
  }

  return [...accepted]
    .sort((left, right) => compareText(
      `${left.event_id ?? ''}\u0000${left.event_id_status}\u0000${left.signature}`,
      `${right.event_id ?? ''}\u0000${right.event_id_status}\u0000${right.signature}`,
    ))
    .map(({ event, event_id_status: eventIdStatus }) => ({
      event,
      event_id_status: eventIdStatus,
    }));
}

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function compareText(left, right) {
  return left < right ? -1 : (left > right ? 1 : 0);
}

function normalizeDate(value) {
  if (value instanceof Date) {
    const timestamp = value.getTime();
    return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
  }
  if (typeof value !== 'string' || !value.trim() || !hasExplicitTimezone(value)) return null;
  const date = new Date(value.trim());
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function hasExplicitTimezone(value) {
  if (value instanceof Date) return Number.isFinite(value.getTime());
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'string') return false;
  return /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value.trim());
}

function addReason(reasons, reason) {
  if (!reasons.includes(reason)) reasons.push(reason);
}

function sortReasons(reasons) {
  return [...new Set(reasons)].sort((left, right) => (
    (REASON_ORDER.get(left) ?? Number.MAX_SAFE_INTEGER) -
      (REASON_ORDER.get(right) ?? Number.MAX_SAFE_INTEGER)
    || compareText(left, right)
  ));
}

function roundWeight(value) {
  return Math.round(Math.max(0, Math.min(1, value)) * 1_000_000) / 1_000_000;
}

function normalizeWeight(value, reasons) {
  if (value === undefined || value === null || value === '') return 1;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    addReason(reasons, 'EXPLICIT_ZERO_WEIGHT');
    return 0;
  }
  if (numeric > 1) {
    addReason(reasons, 'WEIGHT_CLAMPED');
    return 1;
  }
  if (numeric === 0) addReason(reasons, 'EXPLICIT_ZERO_WEIGHT');
  return numeric;
}

function normalizeRating(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value <= 1) return 'failure';
    if (value === 2) return 'partial';
    return 'success';
  }
  const normalized = normalizeText(value).toLowerCase();
  if (!normalized) return null;
  if (['again', 'failure', 'failed', 'fail', 'incorrect', 'wrong', 'no'].includes(normalized)) {
    return 'failure';
  }
  if (['hard', 'partial', 'partially_correct', 'difficult'].includes(normalized)) {
    return 'partial';
  }
  if (['good', 'easy', 'success', 'succeeded', 'correct', 'pass', 'passed', 'yes'].includes(normalized)) {
    return 'success';
  }
  if (['skip', 'skipped', 'omit', 'omitted'].includes(normalized)) return 'skip';
  return null;
}

function normalizeOutcome(source, reasons) {
  const skipped = readBoolean(source, ['skipped', 'is_skipped', 'was_skipped', 'skip']);
  const eventType = normalizeText(readField(source, ['event_type', 'eventType'])).toLowerCase();
  if (skipped === true || eventType.includes('skip')) {
    addReason(reasons, 'SKIP_NOT_FAILURE');
    return 'skip';
  }

  const explicit = readField(source, ['outcome', 'result', 'status']);
  const explicitOutcome = normalizeRating(explicit);
  if (explicitOutcome) {
    if (explicitOutcome === 'skip') addReason(reasons, 'SKIP_NOT_FAILURE');
    return explicitOutcome;
  }

  const ratingOutcome = normalizeRating(readField(source, ['rating', 'score']));
  if (ratingOutcome) {
    if (ratingOutcome === 'skip') addReason(reasons, 'SKIP_NOT_FAILURE');
    return ratingOutcome;
  }

  const correct = readBoolean(source, ['is_correct', 'correct', 'was_correct']);
  if (correct === true) return 'success';
  if (correct === false) return 'failure';

  addReason(reasons, 'OUTCOME_UNKNOWN');
  return 'skip';
}

function isStrongCue(value) {
  const normalized = normalizeText(value).toLowerCase();
  if (!normalized) return false;
  if (STRONG_CUE_VALUES.has(normalized)) return true;
  const numeric = Number(normalized);
  return Number.isFinite(numeric) && numeric >= 4;
}

function isHighDifficulty(value) {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0.75;
  const normalized = normalizeText(value).toLowerCase().replaceAll('-', '_').replaceAll(' ', '_');
  return HIGH_DIFFICULTY_VALUES.has(normalized);
}

function isPresentationDisliked(source) {
  const explicit = readBoolean(source, [
    'presentation_disliked',
    'presentationDisliked',
    'disliked_presentation',
    'variant_disliked',
  ]);
  if (explicit === true) return true;
  const feedback = normalizeText(readField(source, [
    'presentation_feedback',
    'presentationFeedback',
    'presentation_preference',
    'presentationPreference',
    'preference_feedback',
    'preferenceFeedback',
    'feedback_type',
    'feedback',
  ])).toLowerCase().replaceAll('-', '_').replaceAll(' ', '_');
  return new Set([
    'disliked',
    'presentation_disliked',
    'not_this_format',
    'too_hard',
    'too_hard_presentation',
  ]).has(feedback);
}

function readTags(source) {
  return readField(source, ['skill_tags', 'skillTags', 'skills', 'skill_ids', 'skillIds']);
}

function normalizeEventExclusions(source, reasons) {
  const values = readField(source, ['exclusion_reasons', 'exclusionReasons', 'exclusions']);
  const list = Array.isArray(values) ? values : (values == null ? [] : [values]);
  let hasExclusion = false;
  for (const value of list) {
    const normalized = normalizeText(value).toUpperCase().replace(/[^A-Z0-9]+/g, '_');
    if (!normalized) continue;
    hasExclusion = true;
    addReason(reasons, SKILL_EVIDENCE_REASON_ORDER.includes(normalized) ? normalized : 'EVENT_EXCLUSION');
  }
  return hasExclusion;
}

function isInvalidContent(source) {
  const invalid = readBoolean(source, [
    'content_valid',
    'contentValid',
    'is_content_valid',
    'isContentValid',
    'content_eligible',
    'contentEligible',
    'sentence_valid',
    'sentenceValid',
  ]);
  if (invalid === false) return true;
  const explicitlyInvalid = readBoolean(source, ['content_invalid', 'contentInvalid']);
  if (explicitlyInvalid === true) return true;
  const status = normalizeText(readField(source, [
    'content_status',
    'contentStatus',
    'content_quality',
    'contentQuality',
    'content_quality_status',
    'contentQualityStatus',
  ])).toLowerCase().replaceAll('-', '_').replaceAll(' ', '_');
  return ['invalid', 'rejected', 'unusable', 'unavailable'].includes(status);
}

function normalizeDuration(source, reasons) {
  const activeValue = readField(source, ['active_duration_ms', 'activeDurationMs']);
  const durationValue = readField(source, ['duration_ms', 'durationMs']);
  const reliable = readBoolean(source, ['active_duration_reliable', 'activeDurationReliable']);
  let factor = 1;

  if (activeValue !== undefined) {
    const active = Number(activeValue);
    if (!Number.isFinite(active) || active < 0) {
      addReason(reasons, 'ACTIVE_DURATION_INVALID');
      factor = 0;
    } else {
      if (active === 0 || active > SKILL_EVIDENCE_ACTIVE_DURATION_MAX_MS) {
        addReason(reasons, 'ABNORMAL_ACTIVE_DURATION');
        addReason(reasons, 'ACTIVE_DURATION_UNRELIABLE');
        factor = Math.min(factor, 0.25);
      }
      if (durationValue !== undefined) {
        const duration = Number(durationValue);
        if (!Number.isFinite(duration) || duration < 0) {
          addReason(reasons, 'ACTIVE_DURATION_INVALID');
          factor = 0;
        } else if (active > duration) {
          addReason(reasons, 'ACTIVE_DURATION_EXCEEDS_DURATION');
          factor = 0;
        }
      }
    }
  }
  if (reliable === false) {
    addReason(reasons, 'ACTIVE_DURATION_UNRELIABLE');
    factor = Math.min(factor, 0.25);
  }
  return factor;
}

function normalizeLearningUnitId(source, reasons) {
  const explicit = readField(source, ['learning_unit_id', 'learningUnitId']);
  if (explicit !== undefined && explicit !== null && normalizeText(explicit)) return normalizeText(explicit);
  addReason(reasons, 'MISSING_LEARNING_UNIT_ID');
  return null;
}

/**
 * Convert one ordinary event-like object to the small, stable SkillEvidence
 * hand-off object. Signals about presentation or content quality are kept as
 * exclusions; they never get rewritten as a knowledge failure.
 */
export function toSkillEvidence(event, options = {}) {
  const source = asObject(event);
  const taxonomy = options?.taxonomy ?? SKILL_TAXONOMY;
  const reasons = [];
  let weight = normalizeWeight(readField(source, ['weight']), reasons);

  const trainingEligibility = readField(source, ['training_eligible', 'trainingEligible']);
  if (trainingEligibility !== true) {
    addReason(
      reasons,
      readBoolean(source, ['training_eligible', 'trainingEligible']) === false
        ? 'TRAINING_INELIGIBLE'
        : 'TRAINING_ELIGIBILITY_MISSING',
    );
    weight = 0;
  }

  const eventId = normalizeEventId(source);
  const eventIdStatus = options?.event_id_status;
  if (!eventId || eventIdStatus === 'missing') {
    addReason(reasons, 'MISSING_EVENT_ID');
    weight = 0;
  } else if (eventIdStatus === 'conflict') {
    addReason(reasons, 'DUPLICATE_EVENT_ID_CONFLICT');
    weight = 0;
  }

  const learningUnitId = normalizeLearningUnitId(source, reasons);
  if (!learningUnitId) weight = 0;

  const occurredAtValue = readField(source, ['occurred_at', 'occurredAt', 'timestamp', 'created_at']);
  const occurredAt = normalizeDate(occurredAtValue);
  if (occurredAtValue === undefined) {
    addReason(reasons, 'MISSING_OCCURRED_AT');
    weight = 0;
  } else if (typeof occurredAtValue === 'string' && !hasExplicitTimezone(occurredAtValue)) {
    addReason(reasons, 'AMBIGUOUS_OCCURRED_AT');
    weight = 0;
  } else if (!occurredAt) {
    addReason(reasons, 'INVALID_OCCURRED_AT');
    weight = 0;
  }

  const tags = normalizeSkillTags(readTags(source), taxonomy);
  if (tags.skill_tags.length === 0) {
    addReason(reasons, 'MISSING_SKILL_TAGS');
    weight = 0;
  }
  for (const reason of tags.reasons) addReason(reasons, reason);
  if (tags.known_skill_tags.length === 0 && tags.skill_tags.length > 0) {
    addReason(reasons, 'NO_KNOWN_SKILL_TAGS');
    weight = 0;
  }

  const outcome = normalizeOutcome(source, reasons);
  if (outcome === 'skip') weight = 0;

  const answerRevealed = readBoolean(source, [
    'answer_revealed_before_rating',
    'answerRevealedBeforeRating',
    'answer_revealed',
    'answerRevealed',
    'revealed_answer',
    'translation_shown',
  ]);
  if (answerRevealed === true) {
    addReason(reasons, 'ANSWER_REVEALED');
    addReason(reasons, 'ANSWER_REVEALED_BEFORE_RATING');
    weight = 0;
  }

  const cueLevel = readField(source, ['cue_level', 'cueLevel', 'prompt_strength', 'promptStrength']);
  if (isStrongCue(cueLevel)) {
    addReason(reasons, 'STRONG_CUE');
    weight *= 0.35;
  }

  if (readBoolean(source, ['is_legacy', 'isLegacy', 'legacy', 'legacy_compatibility']) === true) {
    addReason(reasons, 'LEGACY');
    addReason(reasons, 'LEGACY_EVENT');
    weight = 0;
  }
  if (readBoolean(source, ['training_eligible', 'trainingEligible']) === false) {
    addReason(reasons, 'TRAINING_INELIGIBLE');
    weight = 0;
  }

  const durationFactor = normalizeDuration(source, reasons);
  weight *= durationFactor;

  const difficultContent = isHighDifficulty(readField(source, [
    'content_difficulty',
    'contentDifficulty',
    'sentence_difficulty_band',
    'sentenceDifficultyBand',
    'difficulty_band',
    'difficultyBand',
  ]));
  if (difficultContent) {
    addReason(reasons, 'CONTENT_DIFFICULTY_DOWNWEIGHTED');
    addReason(reasons, 'CONTENT_DIFFICULTY_EXCLUDED');
    weight = 0;
  }

  if (isPresentationDisliked(source)) {
    addReason(reasons, 'PRESENTATION_DISLIKE_NOT_KNOWLEDGE_FAILURE');
    addReason(reasons, 'PRESENTATION_SIGNAL_EXCLUDED');
    weight = 0;
    if (outcome === 'skip') addReason(reasons, 'PRESENTATION_SIGNAL_NOT_SKILL_FAILURE');
  }

  if (isInvalidContent(source)) {
    addReason(reasons, 'INVALID_CONTENT_EXCLUDED');
    weight = 0;
  }

  const hasTrainingExclusion = normalizeEventExclusions(source, reasons);
  if (hasTrainingExclusion) weight = 0;
  if (reasons.some((reason) => HARD_EXCLUSION_REASONS.has(reason))) weight = 0;

  if (outcome === 'skip' && !reasons.includes('SKIP_NOT_FAILURE')) {
    addReason(reasons, 'SKIP_NOT_FAILURE');
  }

  return {
    learning_unit_id: learningUnitId,
    occurred_at: occurredAt,
    skill_tags: tags.skill_tags,
    outcome,
    weight: roundWeight(weight),
    exclusions: sortReasons(reasons),
  };
}

export const learningEventToSkillEvidence = toSkillEvidence;
export const normalizeLearningEventToSkillEvidence = toSkillEvidence;

function evidenceSortKey(evidence) {
  return [
    evidence.occurred_at ?? '',
    evidence.learning_unit_id ?? '',
    evidence.skill_tags.join(','),
    evidence.outcome,
    String(evidence.weight),
    evidence.exclusions.join(','),
  ].join('\u0000');
}

/** Convert and stably order an event collection for replayable aggregation. */
export function eventsToSkillEvidence(events, options = {}) {
  return deduplicateLearningEvents(events)
    .map(({ event, event_id_status: eventIdStatus }) => toSkillEvidence(event, {
      ...options,
      event_id_status: eventIdStatus,
    }))
    .sort((left, right) => compareText(evidenceSortKey(left), evidenceSortKey(right)));
}

/**
 * Normalize an already-shaped evidence object without applying event-only
 * signals a second time. This is the boundary used by estimators during replay.
 */
export function normalizeSkillEvidence(input, options = {}) {
  const source = asObject(input);
  const taxonomy = options?.taxonomy ?? SKILL_TAXONOMY;
  const reasons = [];
  const tags = normalizeSkillTags(source.skill_tags ?? source.skillTags, taxonomy);
  const learningUnitId = normalizeText(source.learning_unit_id ?? source.learningUnitId) || null;
  const occurredAtValue = source.occurred_at ?? source.occurredAt;
  const hasOccurredAtField = source.occurred_at !== undefined || source.occurredAt !== undefined;
  const occurredAt = normalizeDate(occurredAtValue);
  const outcome = SKILL_EVIDENCE_OUTCOMES.includes(source.outcome) ? source.outcome : 'skip';
  let weight = normalizeWeight(source.weight, reasons);

  if (!learningUnitId) {
    addReason(reasons, 'MISSING_LEARNING_UNIT_ID');
    weight = 0;
  }
  if (!occurredAt) {
    addReason(
      reasons,
      !hasOccurredAtField
        ? 'MISSING_OCCURRED_AT'
        : (typeof occurredAtValue === 'string' && !hasExplicitTimezone(occurredAtValue)
          ? 'AMBIGUOUS_OCCURRED_AT'
          : 'INVALID_OCCURRED_AT'),
    );
    weight = 0;
  }
  if (tags.skill_tags.length === 0) {
    addReason(reasons, 'MISSING_SKILL_TAGS');
    weight = 0;
  }
  for (const reason of tags.reasons) addReason(reasons, reason);
  if (tags.known_skill_tags.length === 0 && tags.skill_tags.length > 0) {
    addReason(reasons, 'NO_KNOWN_SKILL_TAGS');
    weight = 0;
  }
  if (outcome === 'skip') {
    addReason(reasons, 'SKIP_NOT_FAILURE');
    weight = 0;
  }
  if (readBoolean(source, ['training_eligible', 'trainingEligible']) === false) {
    addReason(reasons, 'TRAINING_INELIGIBLE');
    weight = 0;
  }
  if (readBoolean(source, ['is_legacy', 'isLegacy', 'legacy']) === true) {
    addReason(reasons, 'LEGACY');
    weight = 0;
  }
  const inputTrainingExclusions = source.exclusion_reasons ?? source.exclusionReasons;
  const inputTrainingExclusionList = Array.isArray(inputTrainingExclusions)
    ? inputTrainingExclusions
    : (inputTrainingExclusions == null ? [] : [inputTrainingExclusions]);
  for (const reason of inputTrainingExclusionList) {
    const normalized = normalizeText(reason).toUpperCase().replace(/[^A-Z0-9]+/g, '_');
    if (!normalized) continue;
    addReason(reasons, SKILL_EVIDENCE_REASON_ORDER.includes(normalized) ? normalized : 'EVENT_EXCLUSION');
    weight = 0;
  }
  for (const reason of Array.isArray(source.exclusions) ? source.exclusions : []) {
    if (typeof reason === 'string' && reason.trim()) addReason(reasons, reason.trim());
  }
  if (reasons.some((reason) => isTrainingExclusionReason(reason))) weight = 0;

  return {
    learning_unit_id: learningUnitId,
    occurred_at: occurredAt,
    skill_tags: tags.skill_tags,
    outcome,
    weight: roundWeight(weight),
    exclusions: sortReasons(reasons),
  };
}

export function isSkillEvidence(value) {
  const evidence = asObject(value);
  return SKILL_EVIDENCE_OUTCOMES.includes(evidence.outcome)
    && Array.isArray(evidence.skill_tags)
    && Array.isArray(evidence.exclusions)
    && typeof evidence.weight === 'number';
}

export function isTrainingExclusionReason(reason) {
  const normalized = normalizeText(reason).toUpperCase().replace(/[^A-Z0-9]+/g, '_');
  return TRAINING_EXCLUSION_REASONS.has(normalized);
}

export function isHardSkillEvidenceExclusion(reason) {
  return HARD_EXCLUSION_REASONS.has(reason);
}
