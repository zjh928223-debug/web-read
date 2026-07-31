const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

async function loadWave1Modules(repoRoot) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'read-web-wave1-integration-'));
  const sources = [
    ['src/services/vocabulary/vocabulary-learning-models.js', 'vocabulary-learning-models.mjs'],
    ['src/services/vocabulary/vocabulary-acquisition-repository.js', 'vocabulary-acquisition-repository.mjs'],
    ['src/services/vocabulary/vocabulary-context-evidence.js', 'vocabulary-context-evidence.mjs'],
    ['src/services/vocabulary/vocabulary-learning-events.js', 'vocabulary-learning-events.mjs'],
    ['src/features/srs-review/srs-review-policy.js', 'srs-review-policy.mjs'],
    ['src/features/srs-review/srs-session-planner.js', 'srs-session-planner.mjs'],
    ['src/services/vocabulary/legacy-vocabulary-audit.js', 'legacy-vocabulary-audit.mjs'],
  ];

  for (const [relativePath, stagedName] of sources) {
    let source = fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
    source = source
      .replace("from './vocabulary-learning-models.js'", "from './vocabulary-learning-models.mjs'")
      .replace("from './srs-review-policy.js'", "from './srs-review-policy.mjs'");
    fs.writeFileSync(path.join(tempDir, stagedName), source);
  }

  try {
    const names = sources.map(([, stagedName]) => stagedName);
    const modules = await Promise.all(names.map((name) => import(
      `${pathToFileURL(path.join(tempDir, name)).href}?wave1=1`
    )));
    return {
      models: modules[0],
      acquisition: modules[1],
      contexts: modules[2],
      events: modules[3],
      policy: modules[4],
      planner: modules[5],
      legacy: modules[6],
    };
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function createMemoryRowPort() {
  const rows = new Map();
  let writeCount = 0;
  return {
    rows,
    get writeCount() {
      return writeCount;
    },
    port: {
      transaction_id: 'wave1-integration-transaction',
      async getRow(rowId) {
        return rows.has(rowId) ? clone(rows.get(rowId)) : null;
      },
      async putRow(row) {
        rows.set(row.id, clone(row));
        writeCount += 1;
      },
      abort(error) {
        throw error;
      },
    },
  };
}

async function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const api = await loadWave1Modules(repoRoot);

  assert.equal(typeof api.models.normalizeLearningUnit, 'function');
  assert.equal(typeof api.acquisition.bindAcquisitionRepositoryToTransaction, 'function');
  assert.equal(typeof api.contexts.bindContextEvidenceRepositoryToTransaction, 'function');
  assert.equal(typeof api.events.normalizeLearningEvent, 'function');
  assert.equal(typeof api.policy.normalizeReviewPolicy, 'function');
  assert.equal(typeof api.planner.planReviewSession, 'function');
  assert.equal(typeof api.legacy.auditLegacyVocabularySnapshot, 'function');

  const targetSense = {
    gloss: '港口',
    normalized_gloss: '港口',
    part_of_speech: 'noun',
    definition: 'a sheltered place for ships',
    language: 'en',
  };
  const targetSenseKey = api.models.deriveTargetSenseKey(targetSense);
  const learningUnit = api.models.normalizeLearningUnit({
    learning_unit_id: 'unit-harbor-port',
    word_id: 'word-harbor',
    normalized_form: 'harbor',
    language: 'en',
    target_sense_id: 'sense-harbor-port',
    target_sense: targetSense,
    created_at: '2026-07-20T08:00:00.000Z',
    updated_at: '2026-07-20T08:00:00.000Z',
  });
  assert.equal(learningUnit.target_sense_key, targetSenseKey);

  const rowPort = createMemoryRowPort();
  const acquisitionRepository = api.acquisition.bindAcquisitionRepositoryToTransaction(rowPort.port);
  const contextRepository = api.contexts.bindContextEvidenceRepositoryToTransaction(rowPort.port);
  await acquisitionRepository.putLearningUnit(learningUnit, null);

  const evidence = api.contexts.normalizeContextEvidence({
    context_evidence_id: 'context-harbor-port',
    learning_unit_id: learningUnit.learning_unit_id,
    sentence: 'The boat returned to the harbor before sunset.',
    surrounding_text: 'The crew had crossed the bay.',
    source_kind: 'article',
    source_id: 'article-local-harbor',
    source_title: 'Imported reading',
    source_locator: {
      locator_version: 'source-locator.v1',
      paragraph_index: 2,
      sentence_index: 1,
    },
    license_kind: 'user_owned',
    ownership: 'user',
    quality_status: 'validated',
    quality_reason: 'user_confirmed',
    created_at: '2026-07-20T08:00:00.000Z',
    validated_at: '2026-07-20T08:05:00.000Z',
    extensions: {},
  });
  await contextRepository.put(evidence, null);

  const acquisitionState = api.models.normalizeAcquisitionState({
    learning_unit_id: learningUnit.learning_unit_id,
    status: 'introduced',
    context_evidence_ids: [evidence.context_evidence_id],
    validated_anchor_id: evidence.context_evidence_id,
    introduction_episode_id: 'episode-harbor-introduction',
    introduced_at: '2026-07-20T08:00:00.000Z',
  });
  await acquisitionRepository.putState(acquisitionState, 0);

  const storedContexts = await contextRepository.listByLearningUnit(learningUnit.learning_unit_id);
  const anchor = api.contexts.selectValidatedAnchor(learningUnit.learning_unit_id, storedContexts);
  assert.equal(anchor.context_evidence_id, acquisitionState.validated_anchor_id);
  assert.equal((await acquisitionRepository.getLearningUnit(learningUnit.learning_unit_id)).target_sense_key, targetSenseKey);

  const attemptInput = {
    attempt_id: 'attempt-harbor-delayed',
    learning_unit_id: learningUnit.learning_unit_id,
    target_sense_id: learningUnit.target_sense_id,
    episode_id: 'episode-harbor-check',
    occurred_at: '2026-07-21T08:00:00.000Z',
    rating: 'good',
    answer_revealed_before_rating: false,
    context_evidence_id: anchor.context_evidence_id,
  };
  const eligibility = api.models.evaluateGraduationEligibility({
    learning_unit: learningUnit,
    acquisition_state: acquisitionState,
    validated_anchor: anchor,
    attempt: attemptInput,
    evaluated_at: '2026-07-21T08:00:01.000Z',
  });
  assert.equal(eligibility.eligible, true);

  const attempt = api.models.normalizeAcquisitionAttempt({
    schema_version: 'acquisition-attempt.v1',
    ...attemptInput,
    command_id: 'command-harbor-delayed',
    correlation_id: 'correlation-harbor',
    attempt_kind: 'delayed_check',
    session_id: null,
    session_position: null,
    recorded_at: '2026-07-21T08:00:01.000Z',
    prompt_mode: 'original_context',
    cue_level: 'target_sentence',
    duration_ms: 12000,
    active_duration_ms: 9000,
    graduation_eligibility: eligibility,
    extensions: {},
  });
  await acquisitionRepository.putAttempt(attempt);
  assert.deepEqual(await acquisitionRepository.getAttempt(attempt.attempt_id), attempt);

  const acquisitionEvent = api.events.normalizeLearningEvent({
    schema_version: 'learning-event.v1',
    event_id: 'event-harbor-acquisition-attempt',
    command_id: attempt.command_id,
    correlation_id: attempt.correlation_id,
    event_type: 'acquisition_attempt_recorded',
    attempt_id: attempt.attempt_id,
    occurred_at: attempt.occurred_at,
    recorded_at: attempt.recorded_at,
    session_id: attempt.session_id,
    session_position: attempt.session_position,
    learning_unit_id: learningUnit.learning_unit_id,
    word_id: learningUnit.word_id,
    target_sense_id: learningUnit.target_sense_id,
    policy_version: null,
    scheduler_version: null,
    content_version: 'content.v1',
    prompt_mode: attempt.prompt_mode,
    cue_level: attempt.cue_level,
    rating: attempt.rating,
    answer_revealed_before_rating: attempt.answer_revealed_before_rating,
    graduation_eligibility: attempt.graduation_eligibility,
    duration_ms: attempt.duration_ms,
    active_duration_ms: attempt.active_duration_ms,
    before_state: null,
    after_state: null,
    source_kind: anchor.source_kind,
    context_evidence_id: anchor.context_evidence_id,
    is_legacy: false,
    training_eligible: true,
    exclusion_reasons: [],
    payload: {
      target_sense: learningUnit.target_sense,
      source_id: anchor.source_id,
      content_sha256: anchor.content_sha256,
      source_locator: anchor.source_locator,
      sentence: anchor.sentence,
      surrounding_text: anchor.surrounding_text,
    },
    extensions: {},
  });
  const eventRepository = api.events.createInMemoryLearningEventRepository();
  await eventRepository.append(acquisitionEvent);
  const exportedEvents = api.events.exportLearningEvents(
    await eventRepository.query({ learning_unit_id: learningUnit.learning_unit_id }),
    { format: 'json' },
  );
  assert.equal(exportedEvents.includes(anchor.sentence), false);
  assert.equal(exportedEvents.includes(anchor.surrounding_text), false);
  assert.equal(exportedEvents.includes(anchor.content_sha256), true);
  assert.equal(exportedEvents.includes(learningUnit.learning_unit_id), true);

  const legacySnapshot = {
    schemaVersion: 1,
    words: [{
      id: 'legacy-meadow',
      lemma: 'meadow',
      language: 'en',
      meaning: '草地',
      status: 'new',
    }],
    contexts: [],
    reviewStates: [{
      word_id: 'legacy-meadow',
      state: 'review',
      due_at: '2026-07-28T00:00:00.000Z',
    }],
    reviewLogs: [],
  };
  const legacyBefore = JSON.stringify(legacySnapshot);
  const writeCountBeforeAudit = rowPort.writeCount;
  const manifest = api.legacy.auditLegacyVocabularySnapshot(legacySnapshot, {
    policy_version: 'legacy-audit.v1:wave1-integration',
    source_snapshot_hmac_sha256: 'a'.repeat(64),
    audited_at: '2026-07-27T09:00:00.000Z',
  });
  assert.equal(JSON.stringify(legacySnapshot), legacyBefore);
  assert.equal(rowPort.writeCount, writeCountBeforeAudit);
  assert.equal(manifest.items[0].classification, 'needs_context');
  assert.equal(manifest.items[0].is_legacy, true);
  assert.equal(manifest.items[0].training_eligible, false);

  const reviewPolicy = api.policy.normalizeReviewPolicy({
    schema_version: 'review-policy.v1',
    policy_version: 'review-policy.v1:wave1-integration',
    mode: 'balanced',
    budget_ms: 108000,
    default_attempt_ms: 36000,
    balanced_revisit_delay_ms: 900000,
    balanced_max_revisits_per_local_day: 1,
  });
  const reassessmentCandidate = manifest.items
    .filter((item) => item.classification.startsWith('needs_'))
    .map((item) => ({
      learning_unit_id: `legacy:${item.legacy_word_id}`,
      queue_kind: 'reassessment',
      due_at: null,
      estimated_duration_ms: 36000,
      enqueue_reason: `legacy audit: ${item.classification}`,
    }));
  const planningInput = {
    now: '2026-07-27T10:00:00.000Z',
    local_day: '2026-07-27',
    timezone: 'UTC',
    policy: reviewPolicy,
    session_id: 'session-wave1-integration',
    candidates: [
      {
        learning_unit_id: learningUnit.learning_unit_id,
        queue_kind: 'due_review',
        due_at: '2026-07-27T09:00:00.000Z',
        estimated_duration_ms: 36000,
        enqueue_reason: 'synthetic graduated review due',
      },
      ...reassessmentCandidate,
      {
        learning_unit_id: 'unit-new-acquisition',
        queue_kind: 'acquisition',
        due_at: null,
        estimated_duration_ms: 36000,
        enqueue_reason: 'synthetic acquisition capacity',
      },
    ],
  };
  const planningBefore = JSON.stringify(planningInput);
  const ledger = api.planner.planReviewSession(planningInput);
  assert.equal(JSON.stringify(planningInput), planningBefore);
  assert.deepEqual(api.planner.planReviewSession(planningInput), ledger);
  assert.deepEqual(ledger.entries.map((entry) => entry.queue_kind), [
    'due_review',
    'reassessment',
    'acquisition',
  ]);
  assert.equal(ledger.policy_version, reviewPolicy.policy_version);
  assert.equal(ledger.mode, 'balanced');

  const reviewStateV2 = {
    schema_version: 'review-state.v2',
    review_state_id: 'review-state-harbor-port',
    learning_unit_id: learningUnit.learning_unit_id,
    word_id: learningUnit.word_id,
    state: 'learning',
    due_at: '2026-07-27T10:15:00.000Z',
    stability: 0,
    difficulty: 5,
    elapsed_days: 0,
    scheduled_days: 0,
    reps: 0,
    lapses: 0,
    learning_steps: 1,
    last_review_at: null,
    scheduler_version: 'fsrs.v1',
    scheduler_parameters_version: 'fsrs-parameters.v1',
    created_at: '2026-07-27T09:00:00.000Z',
    updated_at: '2026-07-27T09:00:00.000Z',
    revision: 0,
    extensions: {},
  };
  const sameDayRevisitInput = {
    local_day: '2026-07-27',
    timezone: 'UTC',
    mode: reviewPolicy.mode,
    review_state: reviewStateV2,
    rating: 'good',
    completed_revisit_count: 0,
    now: '2026-07-27T10:00:00.000Z',
  };
  const revisitDecision = api.policy.shouldScheduleSameDayRevisit(sameDayRevisitInput);
  assert.equal(revisitDecision.allowed, true);
  assert.throws(
    () => api.policy.shouldScheduleSameDayRevisit({
      ...sameDayRevisitInput,
      review_state: {
        state: 'learning',
        due_at: reviewStateV2.due_at,
      },
    }),
    (error) => error?.code === 'MISSING_REQUIRED_FIELD',
  );

  assert.equal(rowPort.rows.has('vocabulary.acquisition.store.v1'), true);
  assert.equal(rowPort.rows.has('vocabulary.context-evidence.store.v1'), true);
  assert.equal(rowPort.rows.has('vocabulary.review.store.v2'), false);
  console.log('Vocabulary Wave 1 integration verification passed.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
