import { planReviewSession } from '../../features/srs-review/srs-session-planner.js';
import { normalizeContextEvidence } from './vocabulary-context-evidence.js';
import { normalizeLearningEvent } from './vocabulary-learning-events.js';
import {
  deriveTargetSenseKey,
  normalizeLearningUnit,
} from './vocabulary-learning-models.js';
import {
  canonicalJson,
  normalizeReviewState,
  sha256Utf8,
} from './vocabulary-learning-uow.js';

export const VOCABULARY_LEGACY_REASSESSMENT_FEATURE_FLAG =
  'VOCABULARY_LEGACY_REASSESSMENT_ENABLED';
export const LEGACY_REASSESSMENT_POLICY_VERSION = 'legacy-reassessment-policy.v1';
export const LEGACY_REASSESSMENT_SESSION_SCHEMA_VERSION =
  'legacy-reassessment-session.v1';

export const LEGACY_REASSESSMENT_ACTIONS = Object.freeze({
  SUPPLEMENT_SENSE: 'supplement_sense',
  SUPPLEMENT_CONTEXT: 'supplement_context',
  CONFIRM_EXISTING_STATE: 'confirm_existing_state',
  REBUILD_REVIEW_STATE: 'rebuild_review_state',
  SKIP: 'skip',
});

// Deliberately conservative defaults: at most five synthetic/dry-run items and
// three minutes of a session. A caller must explicitly opt into another budget.
export const DEFAULT_LEGACY_REASSESSMENT_CONFIG = Object.freeze({
  policy_version: LEGACY_REASSESSMENT_POLICY_VERSION,
  max_batch_items: 5,
  reassessment_budget_ms: 3 * 60 * 1000,
  estimated_item_ms: 36 * 1000,
  dry_run: true,
});

const ACTION_VALUES = new Set(Object.values(LEGACY_REASSESSMENT_ACTIONS));
const ELIGIBLE_CLASSIFICATIONS = new Set([
  'compatible',
  'needs_context',
  'needs_sense',
  'conflicting',
]);
const CLASSIFICATION_PRIORITY = new Map([
  ['conflicting', 0],
  ['needs_sense', 1],
  ['needs_context', 2],
  ['compatible', 3],
]);
const UTC_TIMESTAMP =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const CONFIRMED_TARGET_SENSE_FIELDS = new Set([
  'target_sense_id',
  'learning_unit_id',
  'word_id',
  'gloss',
  'normalized_gloss',
  'part_of_speech',
  'definition',
  'language',
]);

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

function requiredObject(value, field) {
  if (!isPlainObject(value)) {
    fail('INVALID_FIELD_TYPE', `${field} must be an object`, { field });
  }
  return value;
}

function requiredId(value, field) {
  if (typeof value !== 'string' || value.length === 0) {
    fail('INVALID_FIELD_TYPE', `${field} must be a non-empty string`, { field });
  }
  return value;
}

function requiredPositiveInteger(value, field) {
  if (!Number.isInteger(value) || value <= 0) {
    fail('INVALID_FIELD_TYPE', `${field} must be a positive integer`, { field });
  }
  return value;
}

function utcTimestamp(value, field) {
  if (
    typeof value !== 'string'
    || !UTC_TIMESTAMP.test(value)
    || Number.isNaN(Date.parse(value))
    || new Date(value).toISOString() !== value
  ) {
    fail('INVALID_TIMESTAMP', `${field} must be a canonical UTC timestamp`, {
      field,
    });
  }
  return value;
}

function normalizeConfig(input = {}) {
  const source = requiredObject(input, 'config');
  const allowed = new Set([
    'policy_version',
    'max_batch_items',
    'reassessment_budget_ms',
    'estimated_item_ms',
    'dry_run',
  ]);
  const unknown = Object.keys(source).find((key) => !allowed.has(key));
  if (unknown) {
    fail('INVALID_FIELD_TYPE', 'Unknown reassessment config field', {
      field: `config.${unknown}`,
    });
  }
  const dryRun = source.dry_run ?? DEFAULT_LEGACY_REASSESSMENT_CONFIG.dry_run;
  if (dryRun !== true) {
    fail(
      'INVALID_STATE_TRANSITION',
      'P9 reassessment only supports explicit synthetic dry-runs',
      { field: 'config.dry_run' },
    );
  }
  return {
    policy_version: requiredId(
      source.policy_version
        ?? DEFAULT_LEGACY_REASSESSMENT_CONFIG.policy_version,
      'config.policy_version',
    ),
    max_batch_items: requiredPositiveInteger(
      source.max_batch_items
        ?? DEFAULT_LEGACY_REASSESSMENT_CONFIG.max_batch_items,
      'config.max_batch_items',
    ),
    reassessment_budget_ms: requiredPositiveInteger(
      source.reassessment_budget_ms
        ?? DEFAULT_LEGACY_REASSESSMENT_CONFIG.reassessment_budget_ms,
      'config.reassessment_budget_ms',
    ),
    estimated_item_ms: requiredPositiveInteger(
      source.estimated_item_ms
        ?? DEFAULT_LEGACY_REASSESSMENT_CONFIG.estimated_item_ms,
      'config.estimated_item_ms',
    ),
    dry_run: true,
  };
}

function normalizeAuditManifest(input) {
  const manifest = requiredObject(input, 'audit_manifest');
  if (manifest.schema_version !== 'legacy-audit-manifest.v1') {
    fail('UNSUPPORTED_SCHEMA_VERSION', 'Unsupported legacy audit manifest', {
      field: 'audit_manifest.schema_version',
    });
  }
  requiredId(manifest.policy_version, 'audit_manifest.policy_version');
  requiredId(
    manifest.source_snapshot_hmac_sha256,
    'audit_manifest.source_snapshot_hmac_sha256',
  );
  utcTimestamp(manifest.audited_at, 'audit_manifest.audited_at');
  if (!Array.isArray(manifest.items)) {
    fail('INVALID_FIELD_TYPE', 'audit_manifest.items must be an array', {
      field: 'audit_manifest.items',
    });
  }
  const seen = new Set();
  const items = manifest.items.map((rawItem, index) => {
    const item = requiredObject(rawItem, `audit_manifest.items[${index}]`);
    const legacyWordId = requiredId(
      item.legacy_word_id,
      `audit_manifest.items[${index}].legacy_word_id`,
    );
    if (seen.has(legacyWordId)) {
      fail('CONCURRENT_MODIFICATION', 'Audit manifest contains a duplicate item', {
        legacy_word_id: legacyWordId,
      });
    }
    seen.add(legacyWordId);
    if (
      !ELIGIBLE_CLASSIFICATIONS.has(item.classification)
      && item.classification !== 'ignored_or_deleted'
    ) {
      fail('INVALID_ENUM_VALUE', 'Unknown audit classification', {
        field: `audit_manifest.items[${index}].classification`,
      });
    }
    if (!Array.isArray(item.reason_codes)) {
      fail('INVALID_FIELD_TYPE', 'reason_codes must be an array', {
        field: `audit_manifest.items[${index}].reason_codes`,
      });
    }
    return {
      legacy_word_id: legacyWordId,
      classification: item.classification,
      reason_codes: item.reason_codes.map((reason, reasonIndex) =>
        requiredId(
          reason,
          `audit_manifest.items[${index}].reason_codes[${reasonIndex}]`,
        )),
      is_legacy: true,
      training_eligible: false,
    };
  });
  return { ...clone(manifest), items };
}

function reassessmentLearningUnitId(legacyWordId) {
  return `legacy-reassessment:${legacyWordId}`;
}

function compareAuditItems(left, right) {
  return (
    CLASSIFICATION_PRIORITY.get(left.classification)
    - CLASSIFICATION_PRIORITY.get(right.classification)
    || left.legacy_word_id.localeCompare(right.legacy_word_id)
  );
}

export function planLegacyReassessmentBatch(input) {
  const source = requiredObject(input, 'input');
  const manifest = normalizeAuditManifest(source.audit_manifest);
  const plannerInput = requiredObject(source.planner_input, 'planner_input');
  const config = normalizeConfig(source.config ?? {});
  const excludedIds = new Set(source.excluded_legacy_word_ids ?? []);
  const eligibleItems = manifest.items
    .filter((item) =>
      ELIGIBLE_CLASSIFICATIONS.has(item.classification)
      && !excludedIds.has(item.legacy_word_id))
    .sort(compareAuditItems);
  const budgetItemLimit = Math.floor(
    config.reassessment_budget_ms / config.estimated_item_ms,
  );
  const candidateLimit = Math.min(config.max_batch_items, budgetItemLimit);
  const offeredItems = eligibleItems.slice(0, candidateLimit);
  const reassessmentCandidates = offeredItems.map((item) => ({
    learning_unit_id: reassessmentLearningUnitId(item.legacy_word_id),
    queue_kind: 'reassessment',
    due_at: null,
    estimated_duration_ms: config.estimated_item_ms,
    enqueue_reason: [
      'legacy_audit',
      item.classification,
      config.policy_version,
    ].join(':'),
  }));
  const existingCandidates = Array.isArray(plannerInput.candidates)
    ? plannerInput.candidates
    : [];
  const ledger = planReviewSession({
    ...clone(plannerInput),
    candidates: [...clone(existingCandidates), ...reassessmentCandidates],
  });
  const selectedLearningUnitIds = new Set(
    ledger.entries
      .filter((entry) => entry.queue_kind === 'reassessment')
      .map((entry) => entry.learning_unit_id),
  );
  const selectedItems = offeredItems.filter((item) =>
    selectedLearningUnitIds.has(
      reassessmentLearningUnitId(item.legacy_word_id),
    ));
  const selectedIds = new Set(
    selectedItems.map((item) => item.legacy_word_id),
  );
  const unselectedLegacyWordIds = eligibleItems
    .filter((item) => !selectedIds.has(item.legacy_word_id))
    .map((item) => item.legacy_word_id);

  return {
    schema_version: 'legacy-reassessment-batch-plan.v1',
    audit_policy_version: manifest.policy_version,
    reassessment_policy_version: config.policy_version,
    source_snapshot_hmac_sha256: manifest.source_snapshot_hmac_sha256,
    config,
    ledger,
    selected_items: clone(selectedItems),
    unselected_legacy_word_ids: unselectedLegacyWordIds,
    invariants: {
      unselected_items_due_at_changed: false,
      legacy_snapshot_mutated: false,
      real_user_data_accessed: false,
    },
  };
}

function emptyRepositorySnapshot() {
  return {
    schema_version: 'legacy-reassessment-repository.v1',
    sessions_by_id: {},
    events: [],
  };
}

export function createInMemoryLegacyReassessmentRepository(seed) {
  let snapshot = seed ? clone(seed) : emptyRepositorySnapshot();
  if (
    !isPlainObject(snapshot)
    || snapshot.schema_version !== 'legacy-reassessment-repository.v1'
    || !isPlainObject(snapshot.sessions_by_id)
    || !Array.isArray(snapshot.events)
  ) {
    fail('INVALID_FIELD_TYPE', 'Invalid reassessment repository seed', {
      field: 'seed',
    });
  }
  return {
    async getSession(sessionId) {
      requiredId(sessionId, 'session_id');
      return clone(snapshot.sessions_by_id[sessionId] ?? null);
    },
    async putSession(session) {
      const next = requiredObject(session, 'session');
      const sessionId = requiredId(next.session_id, 'session.session_id');
      snapshot.sessions_by_id[sessionId] = clone(next);
      return clone(next);
    },
    async appendEvent(event) {
      const normalized = normalizeLearningEvent(event);
      const existing = snapshot.events.find(
        (candidate) => candidate.event_id === normalized.event_id,
      );
      if (existing) {
        if (JSON.stringify(existing) !== JSON.stringify(normalized)) {
          fail('IDEMPOTENCY_CONFLICT', 'Reassessment event id was reused', {
            event_id: normalized.event_id,
          });
        }
        return clone(existing);
      }
      snapshot.events.push(clone(normalized));
      return clone(normalized);
    },
    async listEvents(sessionId) {
      requiredId(sessionId, 'session_id');
      return clone(
        snapshot.events.filter((event) => event.session_id === sessionId),
      );
    },
    snapshot() {
      return clone(snapshot);
    },
  };
}

function requireEnabled(enabled) {
  if (!enabled) {
    fail('INVALID_STATE_TRANSITION', 'Legacy reassessment writes are disabled', {
      feature_flag: VOCABULARY_LEGACY_REASSESSMENT_FEATURE_FLAG,
    });
  }
}

function getLegacyRecord(legacyRecords, legacyWordId) {
  const record = legacyRecords[legacyWordId] ?? {};
  return {
    word: clone(record.word ?? null),
    contexts: clone(record.contexts ?? []),
    review_state: clone(record.review_state ?? null),
    review_logs: clone(record.review_logs ?? []),
  };
}

function ensureSessionStatus(session, allowed) {
  if (!allowed.includes(session.status)) {
    fail('INVALID_STATE_TRANSITION', 'Reassessment session status is invalid', {
      session_id: session.session_id,
      status: session.status,
      allowed_statuses: allowed,
    });
  }
}

function normalizeConfirmedTargetSense(input, item, occurredAt) {
  const source = requiredObject(input, 'decision.confirmed_target_sense');
  const unknown = Object.keys(source).find(
    (key) => !CONFIRMED_TARGET_SENSE_FIELDS.has(key),
  );
  if (unknown) {
    fail('INVALID_FIELD_TYPE', 'Unknown confirmed target sense field', {
      field: `decision.confirmed_target_sense.${unknown}`,
    });
  }
  for (const field of CONFIRMED_TARGET_SENSE_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(source, field)) {
      fail('MISSING_REQUIRED_FIELD', 'Confirmed target sense field is required', {
        field: `decision.confirmed_target_sense.${field}`,
      });
    }
  }
  const targetSenseId = requiredId(
    source.target_sense_id,
    'decision.confirmed_target_sense.target_sense_id',
  );
  const learningUnitId = requiredId(
    source.learning_unit_id,
    'decision.confirmed_target_sense.learning_unit_id',
  );
  const wordId = requiredId(
    source.word_id,
    'decision.confirmed_target_sense.word_id',
  );
  if (
    learningUnitId !== reassessmentLearningUnitId(item.legacy_word_id)
    || wordId !== item.legacy_word_id
  ) {
    fail(
      'INVALID_CONTEXT_REFERENCE',
      'Confirmed target sense does not match the reassessment item',
      { legacy_word_id: item.legacy_word_id },
    );
  }
  const rawTargetSense = {
    gloss: source.gloss,
    normalized_gloss: source.normalized_gloss,
    part_of_speech: source.part_of_speech,
    definition: source.definition,
    language: source.language,
  };
  const targetSenseKey = deriveTargetSenseKey(rawTargetSense);
  const legacyWord = item.original_state_snapshot.word;
  const normalizedUnit = normalizeLearningUnit({
    schema_version: 'learning-unit.v1',
    learning_unit_id: learningUnitId,
    word_id: wordId,
    normalized_form:
      legacyWord?.lemma
      ?? legacyWord?.word
      ?? legacyWord?.lookup_key
      ?? item.legacy_word_id,
    language: rawTargetSense.language,
    target_sense_id: targetSenseId,
    target_sense_key: targetSenseKey,
    target_sense: rawTargetSense,
    created_at: occurredAt,
    updated_at: occurredAt,
    archived_at: null,
    revision: 0,
    extensions: { legacy_reassessment_dry_run: true },
  });
  return {
    target_sense_id: normalizedUnit.target_sense_id,
    learning_unit_id: normalizedUnit.learning_unit_id,
    word_id: normalizedUnit.word_id,
    target_sense_key: normalizedUnit.target_sense_key,
    ...clone(normalizedUnit.target_sense),
  };
}

function normalizeDecision(rawDecision, item) {
  const decision = requiredObject(rawDecision, 'decision');
  const action = requiredId(decision.action, 'decision.action');
  if (!ACTION_VALUES.has(action)) {
    fail('INVALID_ENUM_VALUE', 'Unknown reassessment action', {
      field: 'decision.action',
    });
  }
  const occurredAt = utcTimestamp(decision.occurred_at, 'decision.occurred_at');
  const normalized = {
    action,
    processing_reason: requiredId(
      decision.processing_reason,
      'decision.processing_reason',
    ),
    operator_choice: requiredId(
      decision.operator_choice,
      'decision.operator_choice',
    ),
    occurred_at: occurredAt,
    event_id: requiredId(decision.event_id, 'decision.event_id'),
    command_id: requiredId(decision.command_id, 'decision.command_id'),
    correlation_id: requiredId(
      decision.correlation_id,
      'decision.correlation_id',
    ),
    confirmed_target_sense: null,
    confirmed_context_evidence: null,
    rebuilt_review_state: null,
  };

  if (action === LEGACY_REASSESSMENT_ACTIONS.SUPPLEMENT_SENSE) {
    normalized.confirmed_target_sense = normalizeConfirmedTargetSense(
      decision.confirmed_target_sense,
      item,
      occurredAt,
    );
  }
  if (action === LEGACY_REASSESSMENT_ACTIONS.SUPPLEMENT_CONTEXT) {
    const context = normalizeContextEvidence(
      requiredObject(
        decision.confirmed_context_evidence,
        'decision.confirmed_context_evidence',
      ),
    );
    if (
      context.learning_unit_id
      !== reassessmentLearningUnitId(item.legacy_word_id)
      || context.quality_status !== 'validated'
    ) {
      fail(
        'INVALID_CONTEXT_REFERENCE',
        'Supplemented context must be a validated reassessment context',
        { legacy_word_id: item.legacy_word_id },
      );
    }
    normalized.confirmed_context_evidence = context;
  }
  if (action === LEGACY_REASSESSMENT_ACTIONS.CONFIRM_EXISTING_STATE) {
    if (!item.original_state_snapshot.review_state) {
      fail('INVALID_STATE_TRANSITION', 'No existing review state to confirm', {
        legacy_word_id: item.legacy_word_id,
      });
    }
  }
  if (action === LEGACY_REASSESSMENT_ACTIONS.REBUILD_REVIEW_STATE) {
    const state = normalizeReviewState(
      requiredObject(
        decision.rebuilt_review_state,
        'decision.rebuilt_review_state',
      ),
    );
    if (
      state.learning_unit_id
      !== reassessmentLearningUnitId(item.legacy_word_id)
      || state.word_id !== item.legacy_word_id
    ) {
      fail(
        'INVALID_CONTEXT_REFERENCE',
        'Rebuilt ReviewState does not match the reassessment item',
        { legacy_word_id: item.legacy_word_id },
      );
    }
    normalized.rebuilt_review_state = state;
  }
  return normalized;
}

function fingerprintDecision(decision) {
  return sha256Utf8(canonicalJson(decision));
}

function outcomeFor(action) {
  return {
    supplement_sense: 'sense_supplemented',
    supplement_context: 'context_supplemented',
    confirm_existing_state: 'existing_state_confirmed',
    rebuild_review_state: 'review_state_rebuilt',
    skip: 'skipped',
  }[action];
}

function buildReassessmentEvent(session, item, decision, result) {
  const context = decision.confirmed_context_evidence;
  const afterState = decision.rebuilt_review_state
    ?? (decision.action === LEGACY_REASSESSMENT_ACTIONS.CONFIRM_EXISTING_STATE
      ? item.original_state_snapshot.review_state
      : null);
  return normalizeLearningEvent({
    schema_version: 'learning-event.v1',
    event_id: decision.event_id,
    command_id: decision.command_id,
    correlation_id: decision.correlation_id,
    event_type: 'legacy_reassessed',
    attempt_id: null,
    occurred_at: decision.occurred_at,
    recorded_at: decision.occurred_at,
    session_id: session.session_id,
    session_position: item.session_position,
    learning_unit_id: reassessmentLearningUnitId(item.legacy_word_id),
    word_id: item.legacy_word_id,
    target_sense_id:
      decision.confirmed_target_sense?.target_sense_id ?? null,
    policy_version: session.reassessment_policy_version,
    scheduler_version: decision.rebuilt_review_state?.scheduler_version ?? null,
    content_version: 'legacy-reassessment-content.v1',
    prompt_mode: null,
    cue_level: null,
    rating: null,
    answer_revealed_before_rating: null,
    graduation_eligibility: null,
    duration_ms: null,
    active_duration_ms: null,
    before_state: clone(item.original_state_snapshot.review_state),
    after_state: clone(afterState),
    source_kind: context?.source_kind ?? null,
    context_evidence_id: context?.context_evidence_id ?? null,
    is_legacy: true,
    training_eligible: false,
    exclusion_reasons: [],
    payload: {
      schema_version: 'legacy-reassessment-result.v1',
      audit_classification: item.audit_item.classification,
      audit_reason_codes: clone(item.audit_item.reason_codes),
      original_state_snapshot: clone(item.original_state_snapshot),
      processing_reason: decision.processing_reason,
      operator_choice: decision.operator_choice,
      action: decision.action,
      outcome: result.outcome,
      reassessment_policy_version: session.reassessment_policy_version,
      decision_fingerprint: result.decision_fingerprint,
      confirmed_target_sense: clone(decision.confirmed_target_sense),
      confirmed_context_evidence: clone(
        decision.confirmed_context_evidence,
      ),
      rebuilt_review_state: clone(decision.rebuilt_review_state),
      retained_on_feature_flag_rollback: true,
    },
    extensions: { dry_run: true },
  });
}

export function createLegacyVocabularyReassessmentService(options = {}) {
  const settings = requiredObject(options, 'options');
  const enabled = settings.enabled ?? false;
  if (typeof enabled !== 'boolean') {
    fail('INVALID_FIELD_TYPE', 'options.enabled must be boolean', {
      field: 'options.enabled',
    });
  }
  const repository = settings.repository
    ?? createInMemoryLegacyReassessmentRepository();
  const legacyRecords = clone(settings.legacy_records ?? {});
  requiredObject(legacyRecords, 'options.legacy_records');
  let featureEnabled = enabled;

  async function getRequiredSession(sessionId) {
    const session = await repository.getSession(sessionId);
    if (!session) {
      fail('INVALID_CONTEXT_REFERENCE', 'Reassessment session was not found', {
        session_id: sessionId,
      });
    }
    return session;
  }

  return {
    async startBatch(input) {
      requireEnabled(featureEnabled);
      const source = requiredObject(input, 'input');
      const plan = planLegacyReassessmentBatch(source);
      const sessionId = requiredId(
        source.reassessment_session_id,
        'input.reassessment_session_id',
      );
      if (await repository.getSession(sessionId)) {
        fail('IDEMPOTENCY_CONFLICT', 'Reassessment session already exists', {
          session_id: sessionId,
        });
      }
      const items = plan.selected_items.map((auditItem, position) => ({
        legacy_word_id: auditItem.legacy_word_id,
        learning_unit_id: reassessmentLearningUnitId(
          auditItem.legacy_word_id,
        ),
        session_position: position,
        audit_item: clone(auditItem),
        original_state_snapshot: getLegacyRecord(
          legacyRecords,
          auditItem.legacy_word_id,
        ),
        status: 'pending',
        result: null,
        confirmed_user_content: {
          target_senses: [],
          contexts: [],
        },
        reassessment_output: {
          confirmed_existing_review_state: null,
          rebuilt_review_state: null,
        },
        decision_fingerprint: null,
      }));
      const session = {
        schema_version: LEGACY_REASSESSMENT_SESSION_SCHEMA_VERSION,
        session_id: sessionId,
        created_at: utcTimestamp(source.started_at, 'input.started_at'),
        updated_at: source.started_at,
        status: 'active',
        feature_flag_enabled: true,
        dry_run: true,
        audit_policy_version: plan.audit_policy_version,
        reassessment_policy_version: plan.reassessment_policy_version,
        source_snapshot_hmac_sha256:
          plan.source_snapshot_hmac_sha256,
        config: clone(plan.config),
        ledger: clone(plan.ledger),
        items,
        unselected_legacy_word_ids: clone(
          plan.unselected_legacy_word_ids,
        ),
        control_log: [],
        revision: 0,
        invariants: clone(plan.invariants),
      };
      return repository.putSession(session);
    },

    async pauseSession(input) {
      requireEnabled(featureEnabled);
      const source = requiredObject(input, 'input');
      const session = await getRequiredSession(
        requiredId(source.session_id, 'input.session_id'),
      );
      ensureSessionStatus(session, ['active']);
      const occurredAt = utcTimestamp(source.occurred_at, 'input.occurred_at');
      session.status = 'paused';
      session.updated_at = occurredAt;
      session.revision += 1;
      session.control_log.push({
        action: 'paused',
        reason: requiredId(source.reason, 'input.reason'),
        occurred_at: occurredAt,
      });
      return repository.putSession(session);
    },

    async resumeSession(input) {
      requireEnabled(featureEnabled);
      const source = requiredObject(input, 'input');
      const session = await getRequiredSession(
        requiredId(source.session_id, 'input.session_id'),
      );
      ensureSessionStatus(session, ['paused']);
      const occurredAt = utcTimestamp(source.occurred_at, 'input.occurred_at');
      session.status = 'active';
      session.updated_at = occurredAt;
      session.revision += 1;
      session.control_log.push({
        action: 'resumed',
        reason: requiredId(source.reason, 'input.reason'),
        occurred_at: occurredAt,
      });
      return repository.putSession(session);
    },

    async processItem(input) {
      requireEnabled(featureEnabled);
      const source = requiredObject(input, 'input');
      const session = await getRequiredSession(
        requiredId(source.session_id, 'input.session_id'),
      );
      ensureSessionStatus(session, ['active']);
      const legacyWordId = requiredId(
        source.legacy_word_id,
        'input.legacy_word_id',
      );
      const item = session.items.find(
        (candidate) => candidate.legacy_word_id === legacyWordId,
      );
      if (!item) {
        fail(
          'INVALID_CONTEXT_REFERENCE',
          'Legacy item was not selected for this batch',
          { legacy_word_id: legacyWordId },
        );
      }
      const decision = normalizeDecision(source.decision, item);
      const decisionFingerprint = fingerprintDecision(decision);
      if (item.status === 'processed') {
        if (
          item.result?.event_id === decision.event_id
          && item.decision_fingerprint === decisionFingerprint
        ) {
          return clone(item.result);
        }
        fail('IDEMPOTENCY_CONFLICT', 'Legacy item was already processed', {
          legacy_word_id: legacyWordId,
          event_id: decision.event_id,
          expected_decision_fingerprint: item.decision_fingerprint ?? null,
          actual_decision_fingerprint: decisionFingerprint,
        });
      }
      const result = {
        schema_version: 'legacy-reassessment-result.v1',
        legacy_word_id: legacyWordId,
        learning_unit_id: item.learning_unit_id,
        action: decision.action,
        outcome: outcomeFor(decision.action),
        event_id: decision.event_id,
        command_id: decision.command_id,
        correlation_id: decision.correlation_id,
        occurred_at: decision.occurred_at,
        processing_reason: decision.processing_reason,
        operator_choice: decision.operator_choice,
        decision_fingerprint: decisionFingerprint,
        confirmed_target_sense: clone(decision.confirmed_target_sense),
        confirmed_context_evidence: clone(
          decision.confirmed_context_evidence,
        ),
        rebuilt_review_state: clone(decision.rebuilt_review_state),
        original_state_preserved: true,
        legacy_logs_preserved: true,
        confirmed_user_content_preserved: true,
        dry_run: true,
      };
      if (decision.confirmed_target_sense) {
        item.confirmed_user_content.target_senses.push(
          clone(decision.confirmed_target_sense),
        );
      }
      if (decision.confirmed_context_evidence) {
        item.confirmed_user_content.contexts.push(
          clone(decision.confirmed_context_evidence),
        );
      }
      if (
        decision.action
        === LEGACY_REASSESSMENT_ACTIONS.CONFIRM_EXISTING_STATE
      ) {
        item.reassessment_output.confirmed_existing_review_state = clone(
          item.original_state_snapshot.review_state,
        );
      }
      if (decision.rebuilt_review_state) {
        item.reassessment_output.rebuilt_review_state = clone(
          decision.rebuilt_review_state,
        );
      }
      item.status = 'processed';
      item.decision_fingerprint = decisionFingerprint;
      item.result = clone(result);
      session.updated_at = decision.occurred_at;
      session.revision += 1;
      const event = buildReassessmentEvent(
        session,
        item,
        decision,
        result,
      );
      await repository.appendEvent(event);
      await repository.putSession(session);
      return clone(result);
    },

    async rollbackFeatureFlag(input) {
      const source = requiredObject(input, 'input');
      const session = await getRequiredSession(
        requiredId(source.session_id, 'input.session_id'),
      );
      ensureSessionStatus(session, ['active', 'paused']);
      const occurredAt = utcTimestamp(source.occurred_at, 'input.occurred_at');
      session.status = 'rolled_back';
      session.feature_flag_enabled = false;
      featureEnabled = false;
      session.updated_at = occurredAt;
      session.revision += 1;
      session.control_log.push({
        action: 'feature_flag_rolled_back',
        reason: requiredId(source.reason, 'input.reason'),
        occurred_at: occurredAt,
        preserved_event_count: (
          await repository.listEvents(session.session_id)
        ).length,
        preserved_confirmed_content: true,
        preserved_legacy_logs: true,
      });
      return repository.putSession(session);
    },

    async getSession(sessionId) {
      return repository.getSession(sessionId);
    },

    async listEvents(sessionId) {
      return repository.listEvents(sessionId);
    },
  };
}
