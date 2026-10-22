import { createSrsScheduler } from './srs-scheduler.js';
import { normalizeLearningEvent } from './vocabulary-learning-events.js';
import {
  canonicalJson,
  runVocabularyLearningUnitOfWork,
  sha256Utf8,
} from './vocabulary-learning-uow.js';
import {
  normalizeReviewPolicy,
  shouldScheduleSameDayRevisit,
} from '../../features/srs-review/srs-review-policy.js';
import {
  estimateActiveAttemptDuration,
  planReviewSession,
} from '../../features/srs-review/srs-session-planner.js';
import { normalizeReviewSessionLedger } from './srs-review-session-ledger.js';
import {
  createSrsReviewExclusionMarker,
  isSrsReviewParticipationExcluded,
  normalizeSrsReviewParticipation,
  SRS_REVIEW_PARTICIPATION_FIELD,
} from './vocabulary-models.js';

export const SRS_REVIEW_SERVICE_V2_VERSION = 'srs-review-service.v2';
export const SRS_REVIEW_ATTEMPT_COMMAND_TYPE = 'record_review_attempt.v2';
export const SRS_REVIEW_REMOVAL_COMMAND_TYPE = 'remove_srs_review_word.v1';

const SRS_REVIEW_EXCLUDED_WORD_IDS_EXTENSION = 'srs_review_excluded_word_ids';
const SRS_REVIEW_EXCLUDED_LEDGER_ITEM_IDS_EXTENSION = 'srs_review_excluded_ledger_item_ids';
const SRS_REVIEW_REMOVAL_OPERATIONS_EXTENSION = 'srs_review_removal_operations_by_id';

const PERSONALIZATION_SHADOW_FEATURE_FLAG = 'VOCABULARY_PERSONALIZATION_SHADOW_ENABLED';

const RATINGS = new Set(['again', 'hard', 'good', 'easy']);
const PROMPT_MODES = new Set(['word_only', 'original_context', 'transfer_context']);
const CUE_LEVELS = new Set([
  'none',
  'target_sentence',
  'surrounding_context',
  'morphology_or_pos',
  'translation',
]);
const UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/u;

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function error(code, message, details = {}) {
  return { code, message, details };
}

function fail(code, message, details = {}) {
  throw error(code, message, details);
}

function requiredId(value, field) {
  if (typeof value !== 'string' || value.length === 0) {
    fail('INVALID_FIELD_TYPE', `${field} must be a non-empty string`, { field });
  }
  return value;
}

function timestamp(value, field) {
  if (typeof value !== 'string' || !UTC_TIMESTAMP.test(value) || !Number.isFinite(Date.parse(value))) {
    fail('INVALID_TIMESTAMP', `${field} must be a UTC timestamp`, { field });
  }
  return value;
}

function integer(value, field) {
  if (!Number.isInteger(value) || value < 0) {
    fail('INVALID_FIELD_TYPE', `${field} must be a non-negative integer`, { field });
  }
  return value;
}

function enumValue(value, allowed, field) {
  if (!allowed.has(value)) {
    fail('INVALID_ENUM_VALUE', `${field} is invalid`, { field, value: typeof value === 'string' ? value : null });
  }
  return value;
}

function localDayAt(instant, timezone) {
  let parts;
  try {
    parts = new Intl.DateTimeFormat('en-US-u-ca-gregory', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date(instant));
  } catch {
    fail('INVALID_FIELD_TYPE', 'timezone must be an IANA timezone', { field: 'timezone' });
  }
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function assertDependencies(options) {
  const required = [
    ['acquisitionRepository', 'loadSnapshot'],
    ['reviewStateRepository', 'getByLearningUnitId'],
    ['learningEventRepository', 'query'],
    ['sessionLedgerRepository', 'getBySessionId'],
    ['sessionLedgerRepository', 'put'],
  ];
  for (const [owner, method] of required) {
    if (!options[owner] || typeof options[owner][method] !== 'function') {
      fail('MISSING_REQUIRED_FIELD', `${owner}.${method} is required`, {
        field: `${owner}.${method}`,
      });
    }
  }
  const shadowRunner = options.personalizationShadowRunner;
  if (shadowRunner !== undefined && shadowRunner !== null
    && typeof shadowRunner !== 'function'
    && typeof shadowRunner.run !== 'function') {
    fail('INVALID_FIELD_TYPE', 'personalizationShadowRunner must be a function or expose run()', {
      field: 'personalizationShadowRunner',
    });
  }
  if (options.onPersonalizationShadowError !== undefined
    && typeof options.onPersonalizationShadowError !== 'function') {
    fail('INVALID_FIELD_TYPE', 'onPersonalizationShadowError must be a function', {
      field: 'onPersonalizationShadowError',
    });
  }
}

function personalizationShadowEnabled(options) {
  const configuredOption = typeof options.personalizationShadowEnabled === 'function'
    ? options.personalizationShadowEnabled()
    : options.personalizationShadowEnabled;
  const configured = configuredOption
    ?? options.featureFlags?.[PERSONALIZATION_SHADOW_FEATURE_FLAG]
    ?? globalThis.__READ_WEB_FEATURE_FLAGS__?.[PERSONALIZATION_SHADOW_FEATURE_FLAG]
    ?? false;
  return configured === true || configured === 'true';
}

function normalizeStartInput(input, now) {
  if (!isObject(input)) fail('INVALID_FIELD_TYPE', 'start input must be an object', { field: 'input' });
  const startedAt = timestamp(input.now ?? now(), 'now');
  const timezone = requiredId(input.timezone, 'timezone');
  const localDay = requiredId(input.local_day, 'local_day');
  if (localDayAt(startedAt, timezone) !== localDay) {
    fail('INVALID_TIMESTAMP', 'local_day does not match now and timezone', { field: 'local_day' });
  }
  return {
    session_id: requiredId(input.session_id, 'session_id'),
    now: startedAt,
    timezone,
    local_day: localDay,
    policy: normalizeReviewPolicy(input.policy),
  };
}

function normalizeAttemptInput(input) {
  if (!isObject(input)) fail('INVALID_FIELD_TYPE', 'attempt input must be an object', { field: 'input' });
  const duration = integer(input.duration_ms, 'duration_ms');
  const activeDuration = integer(input.active_duration_ms, 'active_duration_ms');
  if (activeDuration > duration) {
    fail('INVALID_FIELD_TYPE', 'active_duration_ms exceeds duration_ms', {
      field: 'active_duration_ms',
    });
  }
  const occurredAt = timestamp(input.occurred_at, 'occurred_at');
  const eventPartition = requiredId(input.event_partition, 'event_partition');
  if (!/^\d{4}-(?:0[1-9]|1[0-2])$/u.test(eventPartition)
    || occurredAt.slice(0, 7) !== eventPartition) {
    fail('INVALID_EVENT_PARTITION', 'event_partition must match occurred_at UTC month', {
      event_partition: eventPartition,
    });
  }
  return {
    command_id: requiredId(input.command_id, 'command_id'),
    attempt_id: requiredId(input.attempt_id, 'attempt_id'),
    event_id: requiredId(input.event_id, 'event_id'),
    correlation_id: requiredId(input.correlation_id, 'correlation_id'),
    session_id: requiredId(input.session_id, 'session_id'),
    ledger_item_id: requiredId(input.ledger_item_id, 'ledger_item_id'),
    occurred_at: occurredAt,
    event_partition: eventPartition,
    rating: enumValue(input.rating, RATINGS, 'rating'),
    prompt_mode: enumValue(input.prompt_mode, PROMPT_MODES, 'prompt_mode'),
    cue_level: enumValue(input.cue_level, CUE_LEVELS, 'cue_level'),
    answer_revealed_before_rating: input.answer_revealed_before_rating === true,
    duration_ms: duration,
    active_duration_ms: activeDuration,
    context_evidence_id: input.context_evidence_id == null
      ? null
      : requiredId(input.context_evidence_id, 'context_evidence_id'),
    source_kind: input.source_kind ?? null,
    content_version: input.content_version ?? null,
    active_duration_reliable: input.active_duration_reliable !== false,
  };
}

function normalizeRemovalInput(input, now) {
  if (!isObject(input)) fail('INVALID_FIELD_TYPE', 'removal input must be an object', { field: 'input' });
  const removedAt = timestamp(input.removed_at ?? now(), 'removed_at');
  const operationId = requiredId(input.operation_id || input.operationId, 'operation_id');
  const sessionId = requiredId(input.session_id || input.sessionId, 'session_id');
  const ledgerItemId = requiredId(input.ledger_item_id || input.ledgerItemId, 'ledger_item_id');
  const wordId = requiredId(input.word_id || input.wordId, 'word_id');
  const learningUnitId = input.learning_unit_id || input.learningUnitId;
  if (learningUnitId !== undefined && learningUnitId !== null) {
    requiredId(learningUnitId, 'learning_unit_id');
  }
  return {
    operation_id: operationId,
    session_id: sessionId,
    ledger_item_id: ledgerItemId,
    word_id: wordId,
    learning_unit_id: learningUnitId == null ? null : String(learningUnitId),
    removed_at: removedAt,
    event_partition: removedAt.slice(0, 7),
    command_id: input.command_id || `srs-review-remove:${operationId}:command`,
    correlation_id: input.correlation_id || `srs-review-remove:${operationId}`,
  };
}

function sameLocalDayEvents(events, localDay, timezone) {
  return events.filter((event) => (
    event.event_type === 'review_attempt_recorded'
    && localDayAt(event.occurred_at, timezone) === localDay
  ));
}

function completedRevisitCount(events, learningUnitId) {
  return events.filter((event) => (
    event.learning_unit_id === learningUnitId
    && event.payload?.is_revisit === true
  )).length;
}

function latestEvent(events, learningUnitId) {
  return events
    .filter((event) => event.learning_unit_id === learningUnitId)
    .sort((left, right) => Date.parse(right.occurred_at) - Date.parse(left.occurred_at))[0] ?? null;
}

function planningCandidate(reviewState, estimatedAttemptMs, queueKind, reason, dueAt = reviewState.due_at) {
  return {
    learning_unit_id: reviewState.learning_unit_id,
    queue_kind: queueKind,
    due_at: dueAt,
    estimated_duration_ms: estimatedAttemptMs,
    enqueue_reason: reason,
  };
}

function isUnreviewedPreviewCard(reviewState, learningUnit) {
  return learningUnit?.extensions?.source === 'ielts-preview'
    && reviewState?.state === 'new'
    && Number(reviewState?.reps) === 0
    && Number(reviewState?.learning_steps) === 0
    && Number(reviewState?.lapses) === 0
    && Number(reviewState?.scheduled_days) === 0
    && reviewState?.last_review_at == null;
}

function toVersionedReviewState(beforeState, scheduledState, occurredAt, schedulerVersion) {
  return {
    ...clone(beforeState),
    state: scheduledState.state,
    due_at: scheduledState.due_at,
    stability: scheduledState.stability,
    difficulty: scheduledState.difficulty,
    elapsed_days: scheduledState.elapsed_days,
    scheduled_days: scheduledState.scheduled_days,
    reps: scheduledState.reps,
    lapses: scheduledState.lapses,
    learning_steps: scheduledState.learning_steps,
    last_review_at: scheduledState.last_review_at,
    scheduler_version: schedulerVersion,
    updated_at: occurredAt,
    revision: beforeState.revision,
  };
}

function reviewEvent({
  input,
  ledger,
  entry,
  unit,
  beforeState,
  afterState,
  schedulerVersion,
  schedulerLog,
  revisitDecision,
  recordedAt,
  attemptFingerprint,
  firstResult,
}) {
  return normalizeLearningEvent({
    schema_version: 'learning-event.v1',
    event_id: input.event_id,
    command_id: input.command_id,
    correlation_id: input.correlation_id,
    event_type: 'review_attempt_recorded',
    attempt_id: input.attempt_id,
    occurred_at: input.occurred_at,
    recorded_at: recordedAt,
    session_id: ledger.session_id,
    session_position: entry.position,
    learning_unit_id: unit.learning_unit_id,
    word_id: unit.word_id,
    target_sense_id: unit.target_sense_id,
    policy_version: ledger.policy_version,
    scheduler_version: schedulerVersion,
    content_version: input.content_version,
    prompt_mode: input.prompt_mode,
    cue_level: input.cue_level,
    rating: input.rating,
    answer_revealed_before_rating: input.answer_revealed_before_rating,
    graduation_eligibility: null,
    duration_ms: input.duration_ms,
    active_duration_ms: input.active_duration_ms,
    before_state: beforeState,
    after_state: afterState,
    source_kind: input.source_kind,
    context_evidence_id: input.context_evidence_id,
    is_legacy: false,
    training_eligible: false,
    exclusion_reasons: [],
    payload: {
      service_version: SRS_REVIEW_SERVICE_V2_VERSION,
      ledger_item_id: entry.ledger_item_id,
      queue_kind: entry.queue_kind,
      is_revisit: entry.queue_kind === 'revisit',
      revisit_decision: revisitDecision,
      scheduler_log: schedulerLog,
      active_duration_reliable: input.active_duration_reliable,
      attempt_fingerprint: attemptFingerprint,
      first_result: firstResult,
      duplicate_submission: false,
    },
    extensions: {},
  });
}

function attemptFingerprintPayload(input, ledger, entry) {
  return {
    attempt_id: input.attempt_id,
    session_id: input.session_id,
    ledger_item_id: input.ledger_item_id,
    learning_unit_id: entry.learning_unit_id,
    session_position: entry.position,
    occurred_at: input.occurred_at,
    rating: input.rating,
    prompt_mode: input.prompt_mode,
    cue_level: input.cue_level,
    answer_revealed_before_rating: input.answer_revealed_before_rating,
    duration_ms: input.duration_ms,
    active_duration_ms: input.active_duration_ms,
    active_duration_reliable: input.active_duration_reliable,
    context_evidence_id: input.context_evidence_id,
    source_kind: input.source_kind,
    content_version: input.content_version,
    policy_version: ledger.policy_version,
    mode: ledger.mode,
  };
}

function resultFromReviewEvent(event) {
  const fingerprint = event.payload?.attempt_fingerprint;
  const result = event.payload?.first_result;
  if (typeof fingerprint !== 'string'
    || !/^[a-f0-9]{64}$/u.test(fingerprint)
    || !isObject(result)
    || result.attempt_fingerprint !== fingerprint
    || result.attempt?.attempt_id !== event.attempt_id
    || result.event_id !== event.event_id
    || result.ledger_item_id !== event.payload.ledger_item_id) {
    fail('TRANSACTION_ABORTED', 'Review event is missing recoverable attempt receipt data', {
      event_id: event.event_id,
    });
  }
  return clone(result);
}

function ledgerRuntime(ledger) {
  return {
    completed_item_ids: [...new Set(ledger.extensions.completed_item_ids ?? [])],
    excluded_ledger_item_ids: [...new Set(
      ledger.extensions[SRS_REVIEW_EXCLUDED_LEDGER_ITEM_IDS_EXTENSION] ?? [],
    )],
    attempt_ids: [...new Set(ledger.extensions.attempt_ids ?? [])],
    revisit_counts_by_learning_unit_id: {
      ...(ledger.extensions.revisit_counts_by_learning_unit_id ?? {}),
    },
    attempt_fingerprints_by_id: {
      ...(ledger.extensions.attempt_fingerprints_by_id ?? {}),
    },
    attempt_results_by_id: {
      ...(ledger.extensions.attempt_results_by_id ?? {}),
    },
    active_duration_ms: integer(
      ledger.extensions.active_duration_ms ?? 0,
      'ledger.extensions.active_duration_ms',
    ),
  };
}

function sameIdSet(left, right) {
  const normalize = (values) => [...new Set(
    (Array.isArray(values) ? values : []).map((value) => String(value)),
  )].sort();
  return canonicalJson(normalize(left)) === canonicalJson(normalize(right));
}

function assertRemovalOperationMatches(operation, {
  operationId,
  sessionId,
  wordId,
  ledgerItemId = null,
  learningUnitIds,
  ledgerItemIds,
}) {
  const targetLedgerItemIds = (Array.isArray(ledgerItemIds) ? ledgerItemIds : [])
    .map((value) => String(value));
  const originalLedgerItemMatches = ledgerItemId === null
    ? targetLedgerItemIds.includes(operation?.ledger_item_id)
    : operation?.ledger_item_id === ledgerItemId;
  if (operation?.operation_id !== operationId
    || operation?.session_id !== sessionId
    || operation?.word_id !== wordId
    || !originalLedgerItemMatches
    || !sameIdSet(operation?.learning_unit_ids, learningUnitIds)
    || !sameIdSet(operation?.ledger_item_ids, targetLedgerItemIds)) {
    fail('IDEMPOTENCY_CONFLICT', 'Persisted SRS removal operation does not match its target', {
      operation_id: operationId,
      word_id: wordId,
    });
  }
}

function advanceLedgerCursorPastNonAnswerItems(ledger, runtimeOverride = null) {
  const runtime = runtimeOverride || ledgerRuntime(ledger);
  const completed = new Set(runtime.completed_item_ids);
  const excluded = new Set(runtime.excluded_ledger_item_ids);
  while (ledger.cursor < ledger.entries.length) {
    const ledgerItemId = ledger.entries[ledger.cursor].ledger_item_id;
    if (!completed.has(ledgerItemId) && !excluded.has(ledgerItemId)) break;
    ledger.cursor += 1;
  }
  return ledger;
}

function currentReviewLedgerEntry(ledger) {
  const runtime = ledgerRuntime(ledger);
  const completed = new Set(runtime.completed_item_ids);
  const excluded = new Set(runtime.excluded_ledger_item_ids);
  return ledger.entries.slice(ledger.cursor).find((entry) => (
    !completed.has(entry.ledger_item_id)
    && !excluded.has(entry.ledger_item_id)
  )) || null;
}

function appendRevisitIfAllowed(ledger, entry, result, runtime) {
  const decision = result.revisit_decision;
  if (!decision.allowed) return;
  const nextOrdinal = (runtime.revisit_counts_by_learning_unit_id[entry.learning_unit_id] ?? 0) + 1;
  const alreadyExists = ledger.entries.some((candidate) => (
    candidate.learning_unit_id === entry.learning_unit_id
    && candidate.queue_kind === 'revisit'
    && candidate.revisit_ordinal === nextOrdinal
  ));
  if (alreadyExists) return;
  const completed = new Set(runtime.completed_item_ids);
  const excluded = new Set(runtime.excluded_ledger_item_ids);
  const remainingEstimatedMs = ledger.entries
    .filter((candidate) => (
      !completed.has(candidate.ledger_item_id)
      && !excluded.has(candidate.ledger_item_id)
    ))
    .reduce((total, candidate) => total + candidate.estimated_duration_ms, 0);
  if (
    runtime.active_duration_ms
      + remainingEstimatedMs
      + ledger.estimated_attempt_ms
    > ledger.budget_ms
  ) return;
  const position = ledger.entries.length;
  ledger.entries.push({
    ledger_item_id: `${ledger.session_id}:${position}:revisit:${entry.learning_unit_id}:${nextOrdinal}`,
    position,
    queue_kind: 'revisit',
    learning_unit_id: entry.learning_unit_id,
    enqueue_reason: decision.reason_code,
    estimated_duration_ms: ledger.estimated_attempt_ms,
    planned_due_at: decision.eligible_at,
    revisit_ordinal: nextOrdinal,
    extensions: {
      source_attempt_id: result.attempt.attempt_id,
    },
  });
}

function applyAttemptToLedger(inputLedger, result) {
  const ledger = clone(inputLedger);
  const runtime = ledgerRuntime(ledger);
  if (runtime.attempt_ids.includes(result.attempt.attempt_id)) {
    if (runtime.attempt_fingerprints_by_id[result.attempt.attempt_id] !== result.attempt_fingerprint
      || canonicalJson(runtime.attempt_results_by_id[result.attempt.attempt_id])
        !== canonicalJson(result)) {
      fail('IDEMPOTENCY_CONFLICT', 'Persisted attempt receipts disagree', {
        attempt_id: result.attempt.attempt_id,
      });
    }
    return ledger;
  }
  const entry = ledger.entries.find((candidate) => (
    candidate.ledger_item_id === result.ledger_item_id
  ));
  if (!entry) {
    fail('INVALID_CONTEXT_REFERENCE', 'Attempt references an unknown ledger item', {
      ledger_item_id: result.ledger_item_id,
    });
  }
  runtime.attempt_ids.push(result.attempt.attempt_id);
  if (result.attempt_fingerprint) {
    runtime.attempt_fingerprints_by_id[result.attempt.attempt_id] = result.attempt_fingerprint;
    runtime.attempt_results_by_id[result.attempt.attempt_id] = clone(result);
  }
  runtime.completed_item_ids.push(entry.ledger_item_id);
  runtime.active_duration_ms += result.attempt.active_duration_ms;
  if (entry.queue_kind === 'revisit') {
    runtime.revisit_counts_by_learning_unit_id[entry.learning_unit_id] = Math.max(
      runtime.revisit_counts_by_learning_unit_id[entry.learning_unit_id] ?? 0,
      entry.revisit_ordinal,
    );
  }
  appendRevisitIfAllowed(ledger, entry, result, runtime);
  // The runtime contains the attempt that was just accepted. The ledger
  // extensions are persisted below, so reading them here would advance from
  // the pre-attempt completed set and leave a normal rating on the same card.
  advanceLedgerCursorPastNonAnswerItems(ledger, runtime);
  // Exclusion is participation state, not an answered item. Keep the session
  // active even when the cursor reaches the end because no rating was added
  // for the excluded ledger item(s).
  ledger.status = ledger.cursor === ledger.entries.length
    && runtime.excluded_ledger_item_ids.length === 0
    ? 'completed'
    : 'active';
  ledger.extensions = {
    ...ledger.extensions,
    completed_item_ids: [...new Set(runtime.completed_item_ids)],
    [SRS_REVIEW_EXCLUDED_LEDGER_ITEM_IDS_EXTENSION]: [
      ...new Set(runtime.excluded_ledger_item_ids),
    ],
    attempt_ids: [...new Set(runtime.attempt_ids)],
    revisit_counts_by_learning_unit_id: runtime.revisit_counts_by_learning_unit_id,
    attempt_fingerprints_by_id: runtime.attempt_fingerprints_by_id,
    attempt_results_by_id: runtime.attempt_results_by_id,
    active_duration_ms: runtime.active_duration_ms,
  };
  return normalizeReviewSessionLedger(ledger);
}

export function createSrsReviewServiceV2(options = {}) {
  if (!isObject(options)) fail('INVALID_FIELD_TYPE', 'options must be an object', { field: 'options' });
  assertDependencies(options);
  const acquisitionRepository = options.acquisitionRepository;
  const reviewStateRepository = options.reviewStateRepository;
  const eventRepository = options.learningEventRepository;
  const ledgerRepository = options.sessionLedgerRepository;
  const scheduler = options.scheduler ?? createSrsScheduler(options.schedulerOptions ?? {});
  const schedulerVersion = options.schedulerVersion ?? 'ts-fsrs.v5.4.1';
  const runUnitOfWork = options.runUnitOfWork ?? runVocabularyLearningUnitOfWork;
  const now = options.now ?? (() => new Date().toISOString());
  const locks = new Map();
  const shadowTasks = new Set();

  async function loadReviewStatesById(learningUnitIds) {
    if (typeof reviewStateRepository.loadSnapshot === 'function') {
      const snapshot = await reviewStateRepository.loadSnapshot();
      return snapshot.by_learning_unit_id ?? {};
    }
    const entries = await Promise.all(learningUnitIds.map(async (learningUnitId) => (
      [learningUnitId, await reviewStateRepository.getByLearningUnitId(learningUnitId)]
    )));
    return Object.fromEntries(entries.filter(([, state]) => state));
  }

  function schedulePersonalizationShadow(input) {
    if (!personalizationShadowEnabled(options) || !options.personalizationShadowRunner) return;
    const runner = typeof options.personalizationShadowRunner === 'function'
      ? options.personalizationShadowRunner
      : options.personalizationShadowRunner.run.bind(options.personalizationShadowRunner);
    const task = Promise.resolve()
      .then(async () => runner(clone({
        ...input,
        events: await eventRepository.query({}),
      })))
      .catch((shadowError) => {
        try {
          options.onPersonalizationShadowError?.(shadowError, {
            session_id: input.session_id,
          });
        } catch { /* shadow diagnostics must never affect the review session */ }
      })
      .finally(() => shadowTasks.delete(task));
    shadowTasks.add(task);
  }

  async function flushPersonalizationShadow() {
    await Promise.all([...shadowTasks]);
  }

  const serialize = (sessionId, operation) => {
    const prior = locks.get(sessionId) ?? Promise.resolve();
    const current = prior.then(operation, operation);
    locks.set(sessionId, current.catch(() => undefined));
    return current;
  };

  async function getReviewEvents() {
    return eventRepository.query({ event_type: 'review_attempt_recorded' });
  }

  async function reconcileLedgerFromEvents(inputLedger) {
    let ledger = inputLedger;
    const events = (await getReviewEvents())
      .filter((event) => event.session_id === ledger.session_id)
      .sort((left, right) => (
        left.session_position - right.session_position
        || Date.parse(left.occurred_at) - Date.parse(right.occurred_at)
      ));
    for (const event of events) {
      ledger = applyAttemptToLedger(ledger, resultFromReviewEvent(event));
    }
    return ledger;
  }

  async function reconcileLedgerFromParticipationMarkers(inputLedger) {
    const snapshot = await acquisitionRepository.loadSnapshot();
    const markerGroups = new Map();
    for (const pair of Object.values(snapshot.by_learning_unit_id ?? {})) {
      const unit = pair?.learning_unit;
      const marker = normalizeSrsReviewParticipation(
        unit?.extensions?.[SRS_REVIEW_PARTICIPATION_FIELD],
      );
      if (!unit || !isSrsReviewParticipationExcluded(marker)) continue;
      const wordId = String(unit.word_id || '');
      if (!wordId) continue;
      const existing = markerGroups.get(wordId);
      if (existing && existing.marker.operation_id !== marker.operation_id) {
        fail('IDEMPOTENCY_CONFLICT', 'Word has conflicting SRS removal operations', {
          word_id: wordId,
          operation_ids: [existing.marker.operation_id, marker.operation_id],
        });
      }
      if (existing) {
        existing.learning_unit_ids.push(unit.learning_unit_id);
      } else {
        markerGroups.set(wordId, {
          marker,
          learning_unit_ids: [unit.learning_unit_id],
        });
      }
    }
    if (!markerGroups.size) return inputLedger;

    const ledger = clone(inputLedger);
    const runtime = ledgerRuntime(ledger);
    const completed = new Set(runtime.completed_item_ids);
    const excluded = new Set(runtime.excluded_ledger_item_ids);
    const excludedWordIds = new Set(
      ledger.extensions?.[SRS_REVIEW_EXCLUDED_WORD_IDS_EXTENSION] || [],
    );
    const excludedLedgerItemIds = new Set(runtime.excluded_ledger_item_ids);
    const operations = {
      ...(ledger.extensions?.[SRS_REVIEW_REMOVAL_OPERATIONS_EXTENSION] || {}),
    };
    let changed = false;

    for (const [wordId, group] of markerGroups.entries()) {
      const learningUnitIds = [...new Set(group.learning_unit_ids)].sort();
      const entriesForWord = ledger.entries.filter((candidate) => (
        learningUnitIds.includes(candidate.learning_unit_id)
      ));
      if (!entriesForWord.length) continue;
      const ledgerItemIds = entriesForWord.map((candidate) => candidate.ledger_item_id);
      const existingOperation = operations[group.marker.operation_id];
      if (existingOperation) {
        assertRemovalOperationMatches(existingOperation, {
          operationId: group.marker.operation_id,
          sessionId: ledger.session_id,
          wordId,
          learningUnitIds,
          ledgerItemIds,
        });
      } else {
        const targetEntry = entriesForWord.find((candidate) => (
          candidate.position >= ledger.cursor
          && !completed.has(candidate.ledger_item_id)
          && !excluded.has(candidate.ledger_item_id)
        )) || entriesForWord[0];
        operations[group.marker.operation_id] = {
          schema_version: 'srs-review-removal.v1',
          operation_id: group.marker.operation_id,
          session_id: ledger.session_id,
          word_id: wordId,
          ledger_item_id: targetEntry.ledger_item_id,
          learning_unit_ids: learningUnitIds,
          ledger_item_ids: ledgerItemIds,
          removed_at: group.marker.removed_at,
        };
        changed = true;
      }
      if (!excludedWordIds.has(wordId)) {
        excludedWordIds.add(wordId);
        changed = true;
      }
      for (const ledgerItemId of ledgerItemIds) {
        if (!excludedLedgerItemIds.has(ledgerItemId)) {
          excludedLedgerItemIds.add(ledgerItemId);
          changed = true;
        }
      }
    }
    if (!changed) return inputLedger;

    const reconciled = {
      ...ledger,
      status: 'active',
      extensions: {
        ...ledger.extensions,
        [SRS_REVIEW_EXCLUDED_WORD_IDS_EXTENSION]: [...excludedWordIds],
        [SRS_REVIEW_EXCLUDED_LEDGER_ITEM_IDS_EXTENSION]: [...excludedLedgerItemIds],
        [SRS_REVIEW_REMOVAL_OPERATIONS_EXTENSION]: operations,
      },
    };
    advanceLedgerCursorPastNonAnswerItems(reconciled);
    return normalizeReviewSessionLedger(reconciled);
  }

  async function persistReconciledLedger(inputLedger) {
    const eventReconciled = await reconcileLedgerFromEvents(inputLedger);
    const reconciled = await reconcileLedgerFromParticipationMarkers(eventReconciled);
    if (JSON.stringify(reconciled) === JSON.stringify(eventReconciled)) return eventReconciled;
    reconciled.revision = eventReconciled.revision;
    return ledgerRepository.put(reconciled, eventReconciled.revision);
  }

  async function startReviewSession(rawInput) {
    const input = normalizeStartInput(rawInput, now);
    return serialize(input.session_id, async () => {
      const existing = await ledgerRepository.getBySessionId(input.session_id);
      if (existing) return existing;
      const allEvents = await getReviewEvents();
      const speed = estimateActiveAttemptDuration(allEvents);
      const policy = normalizeReviewPolicy({
        ...input.policy,
        default_attempt_ms: speed.estimated_attempt_ms,
      });
      const snapshot = await acquisitionRepository.loadSnapshot();
      const todayEvents = sameLocalDayEvents(allEvents, input.local_day, input.timezone);
      const candidates = [];
      const pairs = Object.values(snapshot.by_learning_unit_id ?? {})
        .filter((pair) => pair.acquisition_state?.status === 'graduated'
          && !isSrsReviewParticipationExcluded(
            pair.learning_unit?.extensions?.[SRS_REVIEW_PARTICIPATION_FIELD],
          ))
        .sort((left, right) => (
          left.learning_unit.learning_unit_id.localeCompare(right.learning_unit.learning_unit_id)
        ));
      const reviewStatesById = await loadReviewStatesById(
        pairs.map((pair) => pair.learning_unit.learning_unit_id),
      );
      const todayEventsByLearningUnitId = new Map();
      for (const event of todayEvents) {
        const events = todayEventsByLearningUnitId.get(event.learning_unit_id) ?? [];
        events.push(event);
        todayEventsByLearningUnitId.set(event.learning_unit_id, events);
      }
      for (const pair of pairs) {
        const unit = pair.learning_unit;
        const reviewState = reviewStatesById[unit.learning_unit_id];
        if (!reviewState) continue;
        const unitEvents = todayEventsByLearningUnitId.get(unit.learning_unit_id) ?? [];
        const last = latestEvent(unitEvents, unit.learning_unit_id);
        if (unitEvents.length > 0 && last) {
          let revisitDecision = shouldScheduleSameDayRevisit({
            local_day: input.local_day,
            timezone: input.timezone,
            mode: policy.mode,
            review_state: reviewState,
            rating: last.rating,
            completed_revisit_count: completedRevisitCount(todayEvents, unit.learning_unit_id),
            now: last.occurred_at,
          });
          if (revisitDecision.allowed
            && Date.parse(revisitDecision.eligible_at) <= Date.parse(input.now)) {
            candidates.push(planningCandidate(
              reviewState,
              speed.estimated_attempt_ms,
              'revisit',
              revisitDecision.reason_code,
              revisitDecision.eligible_at,
            ));
          }
          continue;
        }
        if (Date.parse(reviewState.due_at) > Date.parse(input.now)) continue;
        const previewIsUnreviewed = isUnreviewedPreviewCard(reviewState, unit);
        const queueKind = reviewState.state === 'relearning'
          ? 'relearning'
          : (previewIsUnreviewed ? 'acquisition' : 'due_review');
        candidates.push(planningCandidate(
          reviewState,
          speed.estimated_attempt_ms,
          queueKind,
          queueKind === 'relearning'
            ? 'SCHEDULER_RELEARNING_DUE'
            : (queueKind === 'acquisition' ? 'PREVIEW_CAPACITY_ACTIVATED' : 'SCHEDULER_DUE'),
        ));
      }
      const planned = planReviewSession({
        now: input.now,
        local_day: input.local_day,
        timezone: input.timezone,
        policy,
        session_id: input.session_id,
        candidates,
      });
      planned.status = planned.entries.length === 0 ? 'completed' : 'active';
      planned.extensions = {
        ...planned.extensions,
        speed_estimate: speed,
        completed_item_ids: [],
        attempt_ids: [],
        revisit_counts_by_learning_unit_id: {},
        attempt_fingerprints_by_id: {},
        attempt_results_by_id: {},
        active_duration_ms: 0,
      };
      const persisted = await ledgerRepository.put(normalizeReviewSessionLedger(planned), null);
      schedulePersonalizationShadow({
        session_id: input.session_id,
        now: input.now,
        candidates,
        acquisition_snapshot: snapshot,
        baseline_ledger: persisted,
      });
      return persisted;
    });
  }

  async function resumeReviewSession(sessionId, resumeOptions = {}) {
    requiredId(sessionId, 'session_id');
    return serialize(sessionId, async () => {
      let ledger = await ledgerRepository.getBySessionId(sessionId);
      if (!ledger) return null;
      if (ledger.status === 'completed' || ledger.status === 'abandoned') return ledger;
      ledger = await persistReconciledLedger(ledger);
      if (ledger.status === 'completed') return ledger;
      const resumeAt = timestamp(resumeOptions.now ?? now(), 'now');
      if (localDayAt(resumeAt, ledger.timezone) !== ledger.local_day) {
        const abandoned = { ...ledger, status: 'abandoned' };
        return ledgerRepository.put(normalizeReviewSessionLedger(abandoned), ledger.revision);
      }
      return ledger;
    });
  }

  async function recordReviewAttempt(rawInput) {
    const input = normalizeAttemptInput(rawInput);
    return serialize(input.session_id, async () => {
      let ledger = await ledgerRepository.getBySessionId(input.session_id);
      if (!ledger) {
        fail('INVALID_STATE_TRANSITION', 'Review session is not active', {
          session_id: input.session_id,
        });
      }
      ledger = await persistReconciledLedger(ledger);
      const entry = ledger.entries.find((candidate) => candidate.ledger_item_id === input.ledger_item_id);
      const runtime = ledgerRuntime(ledger);
      const knownAttempt = runtime.attempt_ids.includes(input.attempt_id);
      const currentEntry = currentReviewLedgerEntry(ledger);
      if (!entry || (!knownAttempt && currentEntry?.ledger_item_id !== input.ledger_item_id)) {
        fail('INVALID_CONTEXT_REFERENCE', 'Attempt is not for the current ledger item', {
          ledger_item_id: input.ledger_item_id,
        });
      }
      if (!knownAttempt && !['active', 'paused'].includes(ledger.status)) {
        fail('INVALID_STATE_TRANSITION', 'Review session is not active', {
          session_id: input.session_id,
        });
      }
      if (entry.planned_due_at && Date.parse(input.occurred_at) < Date.parse(entry.planned_due_at)) {
        fail('INVALID_STATE_TRANSITION', 'Ledger item is not eligible yet', {
          ledger_item_id: entry.ledger_item_id,
        });
      }
      const attemptPayload = attemptFingerprintPayload(input, ledger, entry);
      const attemptFingerprint = sha256Utf8(canonicalJson(attemptPayload));
      const commandPayload = clone({
        ...attemptPayload,
        event_id: input.event_id,
        attempt_fingerprint: attemptFingerprint,
      });
      if (knownAttempt) {
        if (runtime.attempt_fingerprints_by_id[input.attempt_id] !== attemptFingerprint) {
          fail('IDEMPOTENCY_CONFLICT', 'Attempt ID was reused with different content', {
            attempt_id: input.attempt_id,
          });
        }
        return {
          ...clone(runtime.attempt_results_by_id[input.attempt_id]),
          ledger,
        };
      }
      const recordedAt = timestamp(now(), 'recorded_at');
      const result = await runUnitOfWork(
        { indexedDBApi: options.indexedDBApi, now },
        {
          command_id: input.command_id,
          command_type: SRS_REVIEW_ATTEMPT_COMMAND_TYPE,
          correlation_id: input.correlation_id,
          event_partition: input.event_partition,
          payload: commandPayload,
        },
        async (uow) => {
          const unit = await uow.acquisition.getLearningUnit(entry.learning_unit_id);
          const acquisitionState = await uow.acquisition.getState(entry.learning_unit_id);
          if (!unit || acquisitionState?.status !== 'graduated') {
            return uow.abort(error(
              'REVIEW_STATE_BEFORE_GRADUATION',
              'Only graduated learning units may be reviewed',
              { learning_unit_id: entry.learning_unit_id },
            ));
          }
          if (isSrsReviewParticipationExcluded(
            unit.extensions?.[SRS_REVIEW_PARTICIPATION_FIELD],
          )) {
            return uow.abort(error(
              'SRS_REVIEW_REMOVED',
              'Removed learning units cannot be reviewed',
              { learning_unit_id: entry.learning_unit_id, word_id: unit.word_id },
            ));
          }
          const beforeState = await uow.review.getByLearningUnitId(entry.learning_unit_id);
          if (!beforeState) {
            return uow.abort(error('INVALID_CONTEXT_REFERENCE', 'Active ReviewState is missing', {
              learning_unit_id: entry.learning_unit_id,
            }));
          }
          const scheduled = scheduler.schedule(beforeState, input.rating, input.occurred_at);
          const candidateState = toVersionedReviewState(
            beforeState,
            scheduled.reviewState,
            input.occurred_at,
            schedulerVersion,
          );
          const afterState = await uow.review.update(candidateState, beforeState.revision);
          const revisitPolicyState = {
            ...beforeState,
            due_at: afterState.due_at,
            updated_at: afterState.updated_at,
            revision: afterState.revision,
          };
          let revisitDecision = shouldScheduleSameDayRevisit({
            local_day: ledger.local_day,
            timezone: ledger.timezone,
            mode: ledger.mode,
            review_state: revisitPolicyState,
            rating: input.rating,
            completed_revisit_count:
              (ledgerRuntime(ledger).revisit_counts_by_learning_unit_id[entry.learning_unit_id] ?? 0)
                + (entry.queue_kind === 'revisit' ? 1 : 0),
            now: input.occurred_at,
          });
          if (revisitDecision.allowed) {
            const runtime = ledgerRuntime(ledger);
            const completed = new Set([...runtime.completed_item_ids, entry.ledger_item_id]);
            const remainingEstimatedMs = ledger.entries
              .filter((candidate) => !completed.has(candidate.ledger_item_id))
              .reduce((total, candidate) => total + candidate.estimated_duration_ms, 0);
            if (
              runtime.active_duration_ms
                + input.active_duration_ms
                + remainingEstimatedMs
                + ledger.estimated_attempt_ms
              > ledger.budget_ms
            ) {
              revisitDecision = {
                schema_version: 'same-day-revisit-decision.v1',
                allowed: false,
                reason_code: 'SESSION_BUDGET_EXHAUSTED',
                eligible_at: null,
              };
            }
          }
          const firstResult = {
            schema_version: 'review-attempt-result.v1',
            service_version: SRS_REVIEW_SERVICE_V2_VERSION,
            attempt_fingerprint: attemptFingerprint,
            ledger_item_id: entry.ledger_item_id,
            attempt: {
              schema_version: 'review-attempt.v1',
              attempt_id: input.attempt_id,
              command_id: input.command_id,
              correlation_id: input.correlation_id,
              session_id: ledger.session_id,
              session_position: entry.position,
              learning_unit_id: entry.learning_unit_id,
              occurred_at: input.occurred_at,
              recorded_at: recordedAt,
              prompt_mode: input.prompt_mode,
              cue_level: input.cue_level,
              rating: input.rating,
              answer_revealed_before_rating: input.answer_revealed_before_rating,
              duration_ms: input.duration_ms,
              active_duration_ms: input.active_duration_ms,
              context_evidence_id: input.context_evidence_id,
              before_state: beforeState,
              after_state: afterState,
              scheduler_version: schedulerVersion,
              policy_version: ledger.policy_version,
              is_revisit: entry.queue_kind === 'revisit',
              extensions: {
                active_duration_reliable: input.active_duration_reliable,
              },
            },
            event_id: input.event_id,
            revisit_decision: revisitDecision,
          };
          const event = reviewEvent({
            input,
            ledger,
            entry,
            unit,
            beforeState,
            afterState,
            schedulerVersion,
            schedulerLog: scheduled.schedulerLog,
            revisitDecision,
            recordedAt,
            attemptFingerprint,
            firstResult,
          });
          await uow.events.append(event);
          return firstResult;
        },
      );
      let current = await ledgerRepository.getBySessionId(input.session_id);
      if (!(current.extensions.attempt_ids ?? []).includes(result.attempt.attempt_id)) {
        const updated = applyAttemptToLedger(current, result);
        updated.revision = current.revision;
        try {
          current = await ledgerRepository.put(updated, current.revision);
        } catch (caught) {
          if (caught?.code !== 'CONCURRENT_MODIFICATION') throw caught;
          current = await ledgerRepository.getBySessionId(input.session_id);
          if (!(current.extensions.attempt_ids ?? []).includes(result.attempt.attempt_id)) throw caught;
        }
      }
      return { ...clone(result), ledger: current };
    });
  }

  async function removeWordFromReview(rawInput) {
    const input = normalizeRemovalInput(rawInput, now);
    return serialize(input.session_id, async () => {
      let ledger = await ledgerRepository.getBySessionId(input.session_id);
      if (!ledger) {
        fail('INVALID_STATE_TRANSITION', 'Review session is not active', {
          session_id: input.session_id,
        });
      }
      ledger = await persistReconciledLedger(ledger);
      const entry = ledger.entries.find((candidate) => (
        candidate.ledger_item_id === input.ledger_item_id
      ));
      if (!entry || (
        input.learning_unit_id !== null
        && entry.learning_unit_id !== input.learning_unit_id
      )) {
        fail('INVALID_CONTEXT_REFERENCE', 'Removal is not bound to the current ledger item', {
          ledger_item_id: input.ledger_item_id,
          learning_unit_id: input.learning_unit_id,
        });
      }
      const runtime = ledgerRuntime(ledger);
      if (runtime.completed_item_ids.includes(entry.ledger_item_id)) {
        fail('SRS_REVIEW_REMOVE_HAS_RATING', 'A rated ledger item cannot be removed', {
          ledger_item_id: entry.ledger_item_id,
        });
      }
      const currentUnit = await acquisitionRepository.getLearningUnit(entry.learning_unit_id);
      if (!currentUnit || currentUnit.word_id !== input.word_id) {
        fail('INVALID_CONTEXT_REFERENCE', 'Removal word does not match the current learning unit', {
          ledger_item_id: entry.ledger_item_id,
          learning_unit_id: entry.learning_unit_id,
          word_id: input.word_id,
        });
      }
      const currentMarker = normalizeSrsReviewParticipation(
        currentUnit.extensions?.[SRS_REVIEW_PARTICIPATION_FIELD],
      );
      if (currentMarker && currentMarker.operation_id !== input.operation_id) {
        fail('IDEMPOTENCY_CONFLICT', 'The current word is already removed by another operation', {
          word_id: input.word_id,
          operation_id: currentMarker.operation_id,
        });
      }
      const acquisitionSnapshot = await acquisitionRepository.loadSnapshot();
      const learningUnitIds = Object.values(acquisitionSnapshot.by_learning_unit_id || {})
        .map((pair) => pair?.learning_unit)
        .filter((unit) => unit?.word_id === input.word_id)
        .map((unit) => unit.learning_unit_id)
        .sort();
      if (!learningUnitIds.includes(entry.learning_unit_id)) {
        fail('INVALID_CONTEXT_REFERENCE', 'Current learning unit is missing from the removal set', {
          learning_unit_id: entry.learning_unit_id,
          word_id: input.word_id,
        });
      }
      const ledgerItemIdsForWord = ledger.entries
        .filter((candidate) => learningUnitIds.includes(candidate.learning_unit_id))
        .map((candidate) => candidate.ledger_item_id);
      const existingOperations = ledger.extensions?.[SRS_REVIEW_REMOVAL_OPERATIONS_EXTENSION] || {};
      const existingOperation = existingOperations[input.operation_id];
      if (existingOperation) {
        assertRemovalOperationMatches(existingOperation, {
          operationId: input.operation_id,
          sessionId: input.session_id,
          wordId: input.word_id,
          ledgerItemId: input.ledger_item_id,
          learningUnitIds,
          ledgerItemIds: ledgerItemIdsForWord,
        });
        return {
          status: 'removed',
          idempotent: true,
          operation_id: input.operation_id,
          word_id: input.word_id,
          learning_unit_ids: [...(existingOperation.learning_unit_ids || [])],
          ledger,
        };
      }
      if (currentReviewLedgerEntry(ledger)?.ledger_item_id !== entry.ledger_item_id) {
        fail('SRS_REVIEW_REMOVE_CONTEXT_MOVED', 'Only the current unanswered ledger item can be removed', {
          ledger_item_id: entry.ledger_item_id,
        });
      }

      const marker = createSrsReviewExclusionMarker(input.operation_id, input.removed_at);
      await runUnitOfWork(
        { indexedDBApi: options.indexedDBApi, now },
        {
          command_id: input.command_id,
          command_type: SRS_REVIEW_REMOVAL_COMMAND_TYPE,
          correlation_id: input.correlation_id,
          event_partition: input.event_partition,
          payload: {
            operation_id: input.operation_id,
            session_id: input.session_id,
            ledger_item_id: input.ledger_item_id,
            word_id: input.word_id,
            learning_unit_ids: learningUnitIds,
            ledger_item_ids: ledgerItemIdsForWord,
            removed_at: input.removed_at,
          },
        },
        async (uow) => {
          for (const learningUnitId of learningUnitIds) {
            const unit = await uow.acquisition.getLearningUnit(learningUnitId);
            if (!unit || unit.word_id !== input.word_id) {
              return uow.abort(error(
                'INVALID_CONTEXT_REFERENCE',
                'Removal learning unit no longer matches the word',
                { learning_unit_id: learningUnitId, word_id: input.word_id },
              ));
            }
            const existingMarker = normalizeSrsReviewParticipation(
              unit.extensions?.[SRS_REVIEW_PARTICIPATION_FIELD],
            );
            if (existingMarker && existingMarker.operation_id !== input.operation_id) {
              return uow.abort(error(
                'IDEMPOTENCY_CONFLICT',
                'A learning unit is already removed by another operation',
                { learning_unit_id: learningUnitId, operation_id: existingMarker.operation_id },
              ));
            }
            if (isSrsReviewParticipationExcluded(existingMarker)) {
              continue;
            }
            await uow.acquisition.putLearningUnit({
              ...unit,
              extensions: {
                ...(unit.extensions || {}),
                [SRS_REVIEW_PARTICIPATION_FIELD]: marker,
              },
            }, unit.revision);
          }
          return {
            status: 'marked',
            operation_id: input.operation_id,
            word_id: input.word_id,
            learning_unit_ids: learningUnitIds,
          };
        },
      );

      let currentLedger = await ledgerRepository.getBySessionId(input.session_id);
      currentLedger = await persistReconciledLedger(currentLedger);
      const currentRuntime = ledgerRuntime(currentLedger);
      if (currentRuntime.completed_item_ids.includes(input.ledger_item_id)) {
        fail('SRS_REVIEW_REMOVE_HAS_RATING', 'A rated ledger item cannot be removed', {
          ledger_item_id: input.ledger_item_id,
        });
      }
      const reconciledOperation = currentLedger.extensions?.[SRS_REVIEW_REMOVAL_OPERATIONS_EXTENSION]?.[
        input.operation_id
      ];
      if (reconciledOperation) {
        assertRemovalOperationMatches(reconciledOperation, {
          operationId: input.operation_id,
          sessionId: input.session_id,
          wordId: input.word_id,
          ledgerItemId: input.ledger_item_id,
          learningUnitIds,
          ledgerItemIds: ledgerItemIdsForWord,
        });
        return {
          status: 'removed',
          idempotent: false,
          operation_id: input.operation_id,
          word_id: input.word_id,
          learning_unit_ids: learningUnitIds,
          ledger: currentLedger,
        };
      }
      if (currentReviewLedgerEntry(currentLedger)?.ledger_item_id !== input.ledger_item_id) {
        fail('SRS_REVIEW_REMOVE_CONTEXT_MOVED', 'The current ledger item changed before removal was committed', {
          ledger_item_id: input.ledger_item_id,
        });
      }
      const operations = {
        ...(currentLedger.extensions?.[SRS_REVIEW_REMOVAL_OPERATIONS_EXTENSION] || {}),
        [input.operation_id]: {
          schema_version: 'srs-review-removal.v1',
          operation_id: input.operation_id,
          session_id: input.session_id,
          word_id: input.word_id,
          ledger_item_id: input.ledger_item_id,
          learning_unit_ids: learningUnitIds,
          ledger_item_ids: ledgerItemIdsForWord,
          removed_at: input.removed_at,
        },
      };
      const excludedWordIds = [
        ...(currentLedger.extensions?.[SRS_REVIEW_EXCLUDED_WORD_IDS_EXTENSION] || []),
        input.word_id,
      ];
      const excludedLedgerItemIds = [
        ...(currentLedger.extensions?.[SRS_REVIEW_EXCLUDED_LEDGER_ITEM_IDS_EXTENSION] || []),
        ...ledgerItemIdsForWord,
      ];
      const nextLedger = {
        ...currentLedger,
        extensions: {
          ...currentLedger.extensions,
          [SRS_REVIEW_EXCLUDED_WORD_IDS_EXTENSION]: [...new Set(excludedWordIds)],
          [SRS_REVIEW_EXCLUDED_LEDGER_ITEM_IDS_EXTENSION]: [
            ...new Set(excludedLedgerItemIds),
          ],
          [SRS_REVIEW_REMOVAL_OPERATIONS_EXTENSION]: operations,
        },
      };
      advanceLedgerCursorPastNonAnswerItems(nextLedger);
      // Do not convert exclusion into a completed session or a completed item.
      nextLedger.status = 'active';
      const persisted = await ledgerRepository.put(
        normalizeReviewSessionLedger(nextLedger),
        currentLedger.revision,
      );
      return {
        status: 'removed',
        idempotent: false,
        operation_id: input.operation_id,
        word_id: input.word_id,
        learning_unit_ids: learningUnitIds,
        ledger: persisted,
      };
    });
  }

  async function completeReviewSession(sessionId) {
    requiredId(sessionId, 'session_id');
    return serialize(sessionId, async () => {
      const ledger = await ledgerRepository.getBySessionId(sessionId);
      if (!ledger) return null;
      if (ledger.status === 'completed') return ledger;
      const runtime = ledgerRuntime(ledger);
      const completed = new Set(runtime.completed_item_ids);
      if (runtime.excluded_ledger_item_ids.some((itemId) => !completed.has(itemId))) {
        fail('INVALID_STATE_TRANSITION', 'Excluded ledger items cannot be completed as answered', {
          session_id: sessionId,
        });
      }
      if (ledger.cursor !== ledger.entries.length) {
        fail('INVALID_STATE_TRANSITION', 'Review session has unfinished ledger items', {
          session_id: sessionId,
        });
      }
      return ledgerRepository.put(
        normalizeReviewSessionLedger({ ...ledger, status: 'completed' }),
        ledger.revision,
      );
    });
  }

  return {
    startReviewSession,
    recordReviewAttempt,
    removeWordFromReview,
    resumeReviewSession,
    completeReviewSession,
    flushPersonalizationShadow,
  };
}
