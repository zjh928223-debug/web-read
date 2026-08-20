import {
  ACQUISITION_STATUSES,
  evaluateGraduationEligibility,
  normalizeAcquisitionAttempt,
  normalizeAcquisitionState,
  normalizeLearningUnit,
} from './vocabulary-learning-models.js';
import { normalizeContextEvidence } from './vocabulary-context-evidence.js';
import { normalizeLearningEvent } from './vocabulary-learning-events.js';
import {
  canonicalJson,
  runVocabularyLearningBatchSession,
  runVocabularyLearningUnitOfWork,
} from './vocabulary-learning-uow.js';

export const VOCABULARY_ACQUISITION_FEATURE_FLAG = 'VOCABULARY_ACQUISITION_ENABLED';

const COMMAND_TYPES = Object.freeze({
  QUEUE_CANDIDATE: 'queue_vocabulary_candidate',
  INTRODUCE: 'introduce_vocabulary_candidate',
  SELECT_SENSE: 'select_vocabulary_target_sense',
  ATTACH_CONTEXT: 'attach_vocabulary_context_evidence',
  RECORD_ATTEMPT: 'record_vocabulary_acquisition_attempt',
  MARK_READY: 'mark_vocabulary_ready_for_check',
  GRADUATE: 'graduate_learning_unit',
  COMPLETE_ARTICLE: 'complete_article_learning_unit',
  SKIP: 'skip_vocabulary_learning_unit',
});
const EVENT_PARTITION = /^\d{4}-(?:0[1-9]|1[0-2])$/u;
const UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function contractError(code, message, details = {}) {
  const error = new Error(message);
  error.name = 'VocabularyLearningContractError';
  error.code = code;
  error.details = clone(details);
  return error;
}

function fail(code, message, details = {}) {
  throw contractError(code, message, details);
}

function requiredId(value, field) {
  if (typeof value !== 'string' || value.length === 0) {
    fail('INVALID_FIELD_TYPE', 'Expected a non-empty ID', { field });
  }
  return value;
}

function utcTimestamp(value, field) {
  if (typeof value !== 'string'
    || !UTC_TIMESTAMP.test(value)
    || Number.isNaN(Date.parse(value))
    || new Date(value).toISOString() !== value) {
    fail('INVALID_TIMESTAMP', 'Expected a UTC timestamp', { field });
  }
  return value;
}

function assertStatus(state, expected) {
  if (!expected.includes(state.status)) {
    fail('INVALID_STATE_TRANSITION', 'Acquisition command is not valid in the current state', {
      from_status: state.status,
      allowed_statuses: expected,
    });
  }
}

function featureFlagError() {
  return contractError('INVALID_STATE_TRANSITION', 'Vocabulary acquisition writes are disabled', {
    feature_flag: VOCABULARY_ACQUISITION_FEATURE_FLAG,
  });
}

function eventBase({
  eventId,
  command,
  eventType,
  unit,
  occurredAt,
  recordedAt,
  attempt = null,
  anchor = null,
  payload = {},
}) {
  return normalizeLearningEvent({
    schema_version: 'learning-event.v1',
    event_id: eventId,
    command_id: command.command_id,
    correlation_id: command.correlation_id,
    event_type: eventType,
    attempt_id: attempt?.attempt_id ?? null,
    occurred_at: occurredAt,
    recorded_at: recordedAt,
    session_id: attempt?.session_id ?? null,
    session_position: attempt?.session_position ?? null,
    learning_unit_id: unit.learning_unit_id,
    word_id: unit.word_id,
    target_sense_id: unit.target_sense_id,
    policy_version: null,
    scheduler_version: null,
    content_version: 'vocabulary-acquisition-content.v1',
    prompt_mode: attempt?.prompt_mode ?? null,
    cue_level: attempt?.cue_level ?? null,
    rating: attempt?.rating ?? null,
    answer_revealed_before_rating: attempt?.answer_revealed_before_rating ?? null,
    graduation_eligibility: attempt?.graduation_eligibility ?? null,
    duration_ms: attempt?.duration_ms ?? null,
    active_duration_ms: attempt?.active_duration_ms ?? null,
    before_state: null,
    after_state: null,
    source_kind: anchor?.source_kind ?? null,
    context_evidence_id: attempt?.context_evidence_id ?? anchor?.context_evidence_id ?? null,
    is_legacy: false,
    training_eligible: false,
    exclusion_reasons: [],
    payload,
    extensions: {},
  });
}

function commandOccurredAt(payload, commandType) {
  switch (commandType) {
    case COMMAND_TYPES.QUEUE_CANDIDATE:
      return payload?.learning_unit?.created_at;
    case COMMAND_TYPES.SELECT_SENSE:
    case COMMAND_TYPES.INTRODUCE:
    case COMMAND_TYPES.ATTACH_CONTEXT:
    case COMMAND_TYPES.MARK_READY:
    case COMMAND_TYPES.SKIP:
      return payload?.occurred_at;
    case COMMAND_TYPES.RECORD_ATTEMPT:
      return payload?.attempt?.occurred_at;
    case COMMAND_TYPES.GRADUATE:
      return payload?.graduated_at;
    case COMMAND_TYPES.COMPLETE_ARTICLE:
      return payload?.completed_at;
    default:
      fail('INVALID_ENUM_VALUE', 'Unknown acquisition command type', {
        field: 'command.command_type',
      });
  }
}

function assertCommandEventPartition(eventPartition, occurredAt) {
  const timestamp = utcTimestamp(occurredAt, 'command.occurred_at');
  const expectedPartition = timestamp.slice(0, 7);
  if (typeof eventPartition !== 'string'
    || !EVENT_PARTITION.test(eventPartition)
    || eventPartition !== expectedPartition) {
    fail('INVALID_EVENT_PARTITION', 'Command event partition does not match occurred month', {
      event_partition: typeof eventPartition === 'string' ? eventPartition : null,
      expected_partition: expectedPartition,
    });
  }
}

function normalizeServiceCommand(raw, commandType) {
  if (!isPlainObject(raw)) fail('INVALID_FIELD_TYPE', 'Command must be an object', { field: 'command' });
  canonicalJson(raw.payload);
  assertCommandEventPartition(
    raw.event_partition,
    commandOccurredAt(raw.payload, commandType),
  );
  return {
    command_id: requiredId(raw.command_id, 'command.command_id'),
    command_type: commandType,
    correlation_id: requiredId(raw.correlation_id, 'command.correlation_id'),
    event_partition: raw.event_partition,
    payload: clone(raw.payload),
  };
}

function initialReviewState(unit, payload, graduatedAt) {
  return {
    schema_version: 'review-state.v2',
    review_state_id: requiredId(payload.review_state_id, 'payload.review_state_id'),
    learning_unit_id: unit.learning_unit_id,
    word_id: unit.word_id,
    state: 'new',
    due_at: graduatedAt,
    stability: 0,
    difficulty: 5,
    elapsed_days: 0,
    scheduled_days: 0,
    reps: 0,
    lapses: 0,
    learning_steps: 0,
    last_review_at: null,
    scheduler_version: requiredId(
      payload.scheduler_version ?? 'fsrs.v1',
      'payload.scheduler_version',
    ),
    scheduler_parameters_version: requiredId(
      payload.scheduler_parameters_version ?? 'fsrs-parameters.v1',
      'payload.scheduler_parameters_version',
    ),
    created_at: graduatedAt,
    updated_at: graduatedAt,
    revision: 0,
    extensions: {},
  };
}

function graduationFailure(eligibility) {
  if (eligibility.reason_codes.includes('VALIDATED_ANCHOR_MISSING')) {
    return contractError('NO_VALIDATED_ANCHOR', 'Graduation requires a validated anchor', {});
  }
  if (eligibility.reason_codes.includes('ANSWER_REVEALED_BEFORE_RATING')) {
    return contractError('ANSWER_REVEALED', 'The answer was revealed before rating', {});
  }
  if (eligibility.reason_codes.includes('RATING_AGAIN')
    || eligibility.reason_codes.includes('RATING_MISSING')) {
    return contractError('RATING_NOT_ELIGIBLE', 'The acquisition rating is not eligible', {});
  }
  return contractError('DELAY_POLICY_NOT_SATISFIED', 'Graduation delay policy was not satisfied', {
    reason_codes: eligibility.reason_codes,
  });
}

export function createVocabularyAcquisitionService(options = {}) {
  if (!isPlainObject(options)) fail('INVALID_FIELD_TYPE', 'Service options must be an object', { field: 'options' });
  const enabled = options.enabled ?? false;
  const hasCustomUnitOfWork = Object.prototype.hasOwnProperty.call(options, 'runUnitOfWork');
  const hasCustomBatchSession = Object.prototype.hasOwnProperty.call(options, 'runBatchSession');
  const runUnitOfWork = options.runUnitOfWork ?? runVocabularyLearningUnitOfWork;
  const runBatchSession = options.runBatchSession ?? runVocabularyLearningBatchSession;
  const batchSupported = hasCustomBatchSession || !hasCustomUnitOfWork;
  const now = options.now ?? (() => new Date().toISOString());
  if (typeof enabled !== 'boolean'
    || typeof runUnitOfWork !== 'function'
    || typeof runBatchSession !== 'function'
    || typeof now !== 'function') {
    fail('INVALID_FIELD_TYPE', 'Invalid acquisition service dependency', { field: 'options' });
  }

  async function run(rawCommand, commandType, callback) {
    if (!enabled) throw featureFlagError();
    const command = normalizeServiceCommand(rawCommand, commandType);
    let commandTimestamp;
    const commandNow = () => {
      commandTimestamp ??= now();
      return commandTimestamp;
    };
    return runUnitOfWork(
      { now: commandNow },
      command,
      (uow) => callback(uow, command, commandNow),
    );
  }

  const service = {
    queueCandidate(rawCommand) {
      return run(rawCommand, COMMAND_TYPES.QUEUE_CANDIDATE, async (uow, command) => {
        const unit = normalizeLearningUnit(command.payload.learning_unit);
        if (unit.target_sense_id !== null) {
          fail('INVALID_STATE_TRANSITION', 'Candidate must not select a target sense implicitly', {
            learning_unit_id: unit.learning_unit_id,
          });
        }
        const stored = await uow.acquisition.putLearningUnit(unit, null);
        const eventId = requiredId(command.payload.event_id, 'payload.event_id');
        await uow.events.append(eventBase({
          eventId,
          command,
          eventType: 'candidate_queued',
          unit: stored,
          occurredAt: stored.created_at,
          recordedAt: stored.updated_at,
          payload: { normalized_form: stored.normalized_form },
        }));
        return {
          schema_version: 'acquisition-command-result.v1',
          learning_unit_id: stored.learning_unit_id,
          status: ACQUISITION_STATUSES.CANDIDATE,
          event_id: eventId,
        };
      });
    },

    selectTargetSense(rawCommand) {
      return run(rawCommand, COMMAND_TYPES.SELECT_SENSE, async (uow, command) => {
        const learningUnitId = requiredId(command.payload.learning_unit_id, 'payload.learning_unit_id');
        const unit = await uow.acquisition.getLearningUnit(learningUnitId);
        const state = await uow.acquisition.getState(learningUnitId);
        if (!unit || !state) fail('INVALID_CONTEXT_REFERENCE', 'Learning unit does not exist', { learning_unit_id: learningUnitId });
        assertStatus(state, [ACQUISITION_STATUSES.CANDIDATE]);
        const next = normalizeLearningUnit({
          ...unit,
          target_sense_id: requiredId(command.payload.target_sense_id, 'payload.target_sense_id'),
          target_sense: command.payload.target_sense,
          target_sense_key: null,
          updated_at: command.payload.occurred_at,
        });
        const stored = await uow.acquisition.putLearningUnit(next, unit.revision);
        const eventId = requiredId(command.payload.event_id, 'payload.event_id');
        await uow.events.append(eventBase({
          eventId,
          command,
          eventType: 'target_sense_selected',
          unit: stored,
          occurredAt: command.payload.occurred_at,
          recordedAt: command.payload.occurred_at,
          payload: { target_sense_key: stored.target_sense_key },
        }));
        return {
          schema_version: 'acquisition-command-result.v1',
          learning_unit_id: stored.learning_unit_id,
          status: state.status,
          event_id: eventId,
        };
      });
    },

    introduceCandidate(rawCommand) {
      return run(rawCommand, COMMAND_TYPES.INTRODUCE, async (uow, command) => {
        const learningUnitId = requiredId(command.payload.learning_unit_id, 'payload.learning_unit_id');
        const unit = await uow.acquisition.getLearningUnit(learningUnitId);
        const state = await uow.acquisition.getState(learningUnitId);
        if (!unit || !state) fail('INVALID_CONTEXT_REFERENCE', 'Learning unit does not exist', { learning_unit_id: learningUnitId });
        assertStatus(state, [ACQUISITION_STATUSES.CANDIDATE]);
        if (unit.target_sense_id === null) {
          fail('INVALID_STATE_TRANSITION', 'Introduction requires a selected target sense', {
            learning_unit_id: learningUnitId,
          });
        }
        const next = normalizeAcquisitionState({
          ...state,
          status: ACQUISITION_STATUSES.INTRODUCED,
          introduction_episode_id: command.payload.episode_id,
          introduced_at: command.payload.occurred_at,
          last_exposure_at: command.payload.occurred_at,
        });
        const stored = await uow.acquisition.putState(next, state.revision);
        return {
          schema_version: 'acquisition-command-result.v1',
          learning_unit_id: learningUnitId,
          status: stored.status,
          event_id: null,
        };
      });
    },

    attachContextEvidence(rawCommand) {
      return run(rawCommand, COMMAND_TYPES.ATTACH_CONTEXT, async (uow, command) => {
        const evidence = normalizeContextEvidence(command.payload.context_evidence);
        const unit = await uow.acquisition.getLearningUnit(evidence.learning_unit_id);
        const state = await uow.acquisition.getState(evidence.learning_unit_id);
        if (!unit || !state) fail('INVALID_CONTEXT_REFERENCE', 'Learning unit does not exist', { learning_unit_id: evidence.learning_unit_id });
        assertStatus(state, [ACQUISITION_STATUSES.INTRODUCED, ACQUISITION_STATUSES.ACQUIRING]);
        const storedEvidence = await uow.contexts.put(evidence, null);
        const contextIds = [...new Set([...state.context_evidence_ids, storedEvidence.context_evidence_id])];
        const next = normalizeAcquisitionState({
          ...state,
          status: ACQUISITION_STATUSES.ACQUIRING,
          context_evidence_ids: contextIds,
          validated_anchor_id: storedEvidence.quality_status === 'validated'
            ? (state.validated_anchor_id ?? storedEvidence.context_evidence_id)
            : state.validated_anchor_id,
          last_exposure_at: command.payload.occurred_at,
        });
        const storedState = await uow.acquisition.putState(next, state.revision);
        const eventId = requiredId(command.payload.event_id, 'payload.event_id');
        await uow.events.append(eventBase({
          eventId,
          command,
          eventType: 'context_attached',
          unit,
          occurredAt: command.payload.occurred_at,
          recordedAt: command.payload.occurred_at,
          anchor: storedEvidence,
          payload: {
            context_evidence_id: storedEvidence.context_evidence_id,
            quality_status: storedEvidence.quality_status,
          },
        }));
        return {
          schema_version: 'acquisition-command-result.v1',
          learning_unit_id: unit.learning_unit_id,
          status: storedState.status,
          event_id: eventId,
        };
      });
    },

    recordAcquisitionAttempt(rawCommand) {
      return run(rawCommand, COMMAND_TYPES.RECORD_ATTEMPT, async (uow, command, commandNow) => {
        const input = command.payload.attempt;
        const learningUnitId = requiredId(input.learning_unit_id, 'payload.attempt.learning_unit_id');
        const unit = await uow.acquisition.getLearningUnit(learningUnitId);
        const state = await uow.acquisition.getState(learningUnitId);
        if (!unit || !state) fail('INVALID_CONTEXT_REFERENCE', 'Learning unit does not exist', { learning_unit_id: learningUnitId });
        assertStatus(state, [ACQUISITION_STATUSES.ACQUIRING, ACQUISITION_STATUSES.READY_FOR_CHECK]);
        const anchor = state.validated_anchor_id === null
          ? null
          : await uow.contexts.getById(state.validated_anchor_id);
        const evaluatedAt = commandNow();
        const eligibility = input.attempt_kind === 'delayed_check'
          ? evaluateGraduationEligibility({
            learning_unit: unit,
            acquisition_state: state,
            validated_anchor: anchor,
            attempt: {
              attempt_id: input.attempt_id,
              learning_unit_id: learningUnitId,
              target_sense_id: input.target_sense_id,
              episode_id: input.episode_id,
              occurred_at: input.occurred_at,
              rating: input.rating,
              answer_revealed_before_rating: input.answer_revealed_before_rating,
              context_evidence_id: input.context_evidence_id,
            },
            evaluated_at: evaluatedAt,
          })
          : null;
        const attempt = normalizeAcquisitionAttempt({
          ...input,
          command_id: command.command_id,
          correlation_id: command.correlation_id,
          recorded_at: input.recorded_at ?? evaluatedAt,
          graduation_eligibility: eligibility,
        });
        const storedAttempt = await uow.acquisition.putAttempt(attempt);
        const nextState = normalizeAcquisitionState({
          ...state,
          last_acquisition_attempt_id: storedAttempt.attempt_id,
          last_exposure_at: storedAttempt.occurred_at,
        });
        await uow.acquisition.putState(nextState, state.revision);
        const eventId = storedAttempt.attempt_kind === 'delayed_check'
          ? requiredId(command.payload.event_id, 'payload.event_id')
          : null;
        if (eventId !== null) {
          await uow.events.append(eventBase({
            eventId,
            command,
            eventType: 'acquisition_attempt_recorded',
            unit,
            occurredAt: storedAttempt.occurred_at,
            recordedAt: storedAttempt.recorded_at,
            attempt: storedAttempt,
            anchor,
            payload: { active_duration_reliable: true },
          }));
        }
        return {
          schema_version: 'acquisition-attempt-result.v1',
          learning_unit_id: unit.learning_unit_id,
          attempt_id: storedAttempt.attempt_id,
          event_id: eventId,
          graduation_eligibility: storedAttempt.graduation_eligibility,
        };
      });
    },

    markReadyForCheck(rawCommand) {
      return run(rawCommand, COMMAND_TYPES.MARK_READY, async (uow, command) => {
        const learningUnitId = requiredId(command.payload.learning_unit_id, 'payload.learning_unit_id');
        const state = await uow.acquisition.getState(learningUnitId);
        if (!state) fail('INVALID_CONTEXT_REFERENCE', 'Learning unit does not exist', { learning_unit_id: learningUnitId });
        assertStatus(state, [ACQUISITION_STATUSES.ACQUIRING]);
        const stored = await uow.acquisition.putState(normalizeAcquisitionState({
          ...state,
          status: ACQUISITION_STATUSES.READY_FOR_CHECK,
          ready_for_check_at: command.payload.occurred_at,
        }), state.revision);
        return {
          schema_version: 'acquisition-command-result.v1',
          learning_unit_id: learningUnitId,
          status: stored.status,
          event_id: null,
        };
      });
    },

    graduateLearningUnit(rawCommand) {
      return run(rawCommand, COMMAND_TYPES.GRADUATE, async (uow, command) => {
        const learningUnitId = requiredId(command.payload.learning_unit_id, 'payload.learning_unit_id');
        const unit = await uow.acquisition.getLearningUnit(learningUnitId);
        const state = await uow.acquisition.getState(learningUnitId);
        if (!unit || !state) fail('INVALID_CONTEXT_REFERENCE', 'Learning unit does not exist', { learning_unit_id: learningUnitId });
        assertStatus(state, [ACQUISITION_STATUSES.READY_FOR_CHECK]);
        const attempt = await uow.acquisition.getAttempt(command.payload.attempt_id);
        if (!attempt || attempt.learning_unit_id !== learningUnitId) {
          fail('INVALID_CONTEXT_REFERENCE', 'Qualifying attempt does not exist', {
            learning_unit_id: learningUnitId,
          });
        }
        if (attempt.attempt_kind !== 'delayed_check') {
          fail('RATING_NOT_ELIGIBLE', 'Only a delayed check can qualify for graduation', {});
        }
        const anchor = state.validated_anchor_id === null
          ? null
          : await uow.contexts.getById(state.validated_anchor_id);
        if (!anchor
          || anchor.learning_unit_id !== learningUnitId
          || anchor.quality_status !== 'validated'
          || anchor.context_evidence_id !== attempt.context_evidence_id) {
          fail('NO_VALIDATED_ANCHOR', 'Graduation requires a validated anchor', {});
        }
        if (!attempt.graduation_eligibility?.eligible) {
          throw graduationFailure(attempt.graduation_eligibility ?? { reason_codes: [] });
        }
        if (await uow.review.getByLearningUnitId(learningUnitId)) {
          fail('REVIEW_STATE_ALREADY_EXISTS', 'ReviewState already exists', {
            learning_unit_id: learningUnitId,
          });
        }
        const graduatedAt = command.payload.graduated_at;
        const reviewState = await uow.review.putInitial(initialReviewState(
          unit,
          command.payload,
          graduatedAt,
        ));
        const graduatedState = await uow.acquisition.putState(normalizeAcquisitionState({
          ...state,
          status: ACQUISITION_STATUSES.GRADUATED,
          graduated_at: graduatedAt,
        }), state.revision);
        const eventId = requiredId(command.payload.event_id, 'payload.event_id');
        await uow.events.append(eventBase({
          eventId,
          command,
          eventType: 'acquisition_graduated',
          unit,
          occurredAt: graduatedAt,
          recordedAt: graduatedAt,
          attempt,
          anchor,
          payload: {
            review_state_id: reviewState.review_state_id,
            acquisition_status: graduatedState.status,
            active_duration_reliable: true,
          },
        }));
        return {
          schema_version: 'graduation-result.v1',
          learning_unit_id: learningUnitId,
          review_state_id: reviewState.review_state_id,
          event_id: eventId,
        };
      });
    },

    completeArticleLearning(rawCommand) {
      return run(rawCommand, COMMAND_TYPES.COMPLETE_ARTICLE, async (uow, command) => {
        const learningUnitId = requiredId(command.payload.learning_unit_id, 'payload.learning_unit_id');
        const unit = await uow.acquisition.getLearningUnit(learningUnitId);
        let state = await uow.acquisition.getState(learningUnitId);
        if (!unit || !state) fail('INVALID_CONTEXT_REFERENCE', 'Learning unit does not exist', { learning_unit_id: learningUnitId });
        assertStatus(state, [ACQUISITION_STATUSES.ACQUIRING, ACQUISITION_STATUSES.READY_FOR_CHECK]);
        let anchor = state.validated_anchor_id === null
          ? null
          : await uow.contexts.getById(state.validated_anchor_id);
        if (!anchor) {
          for (const contextEvidenceId of state.context_evidence_ids) {
            const candidate = await uow.contexts.getById(contextEvidenceId);
            if (candidate?.source_kind === 'article') {
              anchor = candidate;
              break;
            }
          }
        }
        if (!anchor || anchor.learning_unit_id !== learningUnitId) {
          fail('NO_VALIDATED_ANCHOR', 'Article completion requires an article context', {});
        }
        if (anchor.source_kind !== 'article') {
          fail('INVALID_CONTEXT_REFERENCE', 'Only article context may use article completion', {
            context_evidence_id: anchor.context_evidence_id,
          });
        }
        const completedAt = command.payload.completed_at;
        if (state.status === ACQUISITION_STATUSES.ACQUIRING) {
          state = await uow.acquisition.putState(normalizeAcquisitionState({
            ...state,
            status: ACQUISITION_STATUSES.READY_FOR_CHECK,
            ready_for_check_at: completedAt,
          }), state.revision);
        }
        if (await uow.review.getByLearningUnitId(learningUnitId)) {
          fail('REVIEW_STATE_ALREADY_EXISTS', 'ReviewState already exists', {
            learning_unit_id: learningUnitId,
          });
        }
        const reviewState = await uow.review.putInitial(initialReviewState(
          unit,
          command.payload,
          completedAt,
        ));
        const graduatedState = await uow.acquisition.putState(normalizeAcquisitionState({
          ...state,
          status: ACQUISITION_STATUSES.GRADUATED,
          graduated_at: completedAt,
        }), state.revision);
        const eventId = requiredId(command.payload.event_id, 'payload.event_id');
        await uow.events.append(eventBase({
          eventId,
          command,
          eventType: 'article_learning_completed',
          unit,
          occurredAt: completedAt,
          recordedAt: completedAt,
          anchor,
          payload: {
            review_state_id: reviewState.review_state_id,
            acquisition_status: graduatedState.status,
            completion_basis: 'confirmed_article_completion',
            active_duration_reliable: false,
          },
        }));
        return {
          schema_version: 'article-learning-completion-result.v1',
          learning_unit_id: learningUnitId,
          review_state_id: reviewState.review_state_id,
          event_id: eventId,
        };
      });
    },

    skipLearningUnit(rawCommand) {
      return run(rawCommand, COMMAND_TYPES.SKIP, async (uow, command) => {
        const learningUnitId = requiredId(command.payload.learning_unit_id, 'payload.learning_unit_id');
        const state = await uow.acquisition.getState(learningUnitId);
        if (!state) fail('INVALID_CONTEXT_REFERENCE', 'Learning unit does not exist', { learning_unit_id: learningUnitId });
        assertStatus(state, [
          ACQUISITION_STATUSES.CANDIDATE,
          ACQUISITION_STATUSES.INTRODUCED,
          ACQUISITION_STATUSES.ACQUIRING,
          ACQUISITION_STATUSES.READY_FOR_CHECK,
        ]);
        const stored = await uow.acquisition.putState(normalizeAcquisitionState({
          ...state,
          status: ACQUISITION_STATUSES.SKIPPED,
          skipped_at: command.payload.occurred_at,
        }), state.revision);
        return {
          schema_version: 'acquisition-command-result.v1',
          learning_unit_id: learningUnitId,
          status: stored.status,
          event_id: null,
        };
      });
    },
  };
  if (batchSupported) {
    service.runBatch = function runBatch(work) {
      if (!enabled) return Promise.reject(featureFlagError());
      if (typeof work !== 'function') return Promise.reject(contractError('INVALID_FIELD_TYPE', 'Batch work must be a function', { field: 'work' }));
      return runBatchSession({ now }, async (runCommand) => {
        const batchService = createVocabularyAcquisitionService({
          enabled,
          now,
          runUnitOfWork(commandDependencies, rawCommand, execute) {
            return runCommand(commandDependencies, rawCommand, execute);
          },
        });
        return work(batchService);
      });
    };
  }

  return service;
}
