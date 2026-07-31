const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '..');
const modulePath = path.join(
  root,
  'src',
  'services',
  'vocabulary',
  'legacy-vocabulary-reassessment.js',
);
const fixturePath = path.join(
  root,
  'scripts',
  'fixtures',
  'legacy-vocabulary-reassessment-cases.json',
);

async function loadModules() {
  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'read-web-p9-check-'),
  );
  const sources = [
    [
      'src/features/srs-review/srs-review-policy.js',
      'srs-review-policy.mjs',
    ],
    [
      'src/features/srs-review/srs-session-planner.js',
      'srs-session-planner.mjs',
    ],
    [
      'src/services/vocabulary/vocabulary-learning-models.js',
      'vocabulary-learning-models.mjs',
    ],
    [
      'src/services/vocabulary/vocabulary-acquisition-repository.js',
      'vocabulary-acquisition-repository.mjs',
    ],
    [
      'src/services/vocabulary/vocabulary-context-evidence.js',
      'vocabulary-context-evidence.mjs',
    ],
    [
      'src/services/vocabulary/vocabulary-learning-events.js',
      'vocabulary-learning-events.mjs',
    ],
    [
      'src/services/vocabulary/vocabulary-learning-uow.js',
      'vocabulary-learning-uow.mjs',
    ],
    [
      'src/services/vocabulary/legacy-vocabulary-reassessment.js',
      'legacy-vocabulary-reassessment.mjs',
    ],
  ];
  try {
    for (const [relativePath, stagedName] of sources) {
      let source = fs.readFileSync(path.join(root, relativePath), 'utf8');
      source = source
        .replaceAll(
          "from './srs-review-policy.js'",
          "from './srs-review-policy.mjs'",
        )
        .replaceAll(
          "from '../../features/srs-review/srs-session-planner.js'",
          "from './srs-session-planner.mjs'",
        )
        .replaceAll(
          "from './vocabulary-learning-models.js'",
          "from './vocabulary-learning-models.mjs'",
        )
        .replaceAll(
          "from './vocabulary-acquisition-repository.js'",
          "from './vocabulary-acquisition-repository.mjs'",
        )
        .replaceAll(
          "from './vocabulary-context-evidence.js'",
          "from './vocabulary-context-evidence.mjs'",
        )
        .replaceAll(
          "from './vocabulary-learning-events.js'",
          "from './vocabulary-learning-events.mjs'",
        )
        .replaceAll(
          "from './vocabulary-learning-uow.js'",
          "from './vocabulary-learning-uow.mjs'",
        );
      fs.writeFileSync(path.join(tempDir, stagedName), source);
    }
    return {
      reassessment: await import(pathToFileURL(path.join(
        tempDir,
        'legacy-vocabulary-reassessment.mjs',
      )).href),
      contexts: await import(pathToFileURL(path.join(
        tempDir,
        'vocabulary-context-evidence.mjs',
      )).href),
    };
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function reviewPolicy(budgetMs) {
  return {
    schema_version: 'review-policy.v1',
    policy_version: 'review-policy.synthetic.v1',
    mode: 'balanced',
    budget_ms: budgetMs,
    default_attempt_ms: 36000,
    balanced_revisit_delay_ms: 900000,
    balanced_max_revisits_per_local_day: 1,
  };
}

function plannerInput(budgetMs, candidates = []) {
  return {
    now: '2026-07-28T00:00:00.000Z',
    local_day: '2026-07-28',
    timezone: 'UTC',
    policy: reviewPolicy(budgetMs),
    session_id: 'planner-session-p9',
    candidates,
  };
}

function rebuiltReviewState() {
  return {
    schema_version: 'review-state.v2',
    review_state_id: 'review-state-rebuilt-polysemy',
    learning_unit_id: 'legacy-reassessment:word-polysemy-conflict',
    word_id: 'word-polysemy-conflict',
    state: 'new',
    due_at: '2026-07-28T00:02:00.000Z',
    stability: 0,
    difficulty: 5,
    elapsed_days: 0,
    scheduled_days: 0,
    reps: 0,
    lapses: 0,
    learning_steps: 0,
    last_review_at: null,
    scheduler_version: 'fsrs.v1',
    scheduler_parameters_version: 'fsrs-parameters.v1',
    created_at: '2026-07-28T00:02:00.000Z',
    updated_at: '2026-07-28T00:02:00.000Z',
    revision: 0,
    extensions: {
      reassessment_policy_version: 'legacy-reassessment-policy.v1',
    },
  };
}

async function main() {
  const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  const originalFixture = JSON.stringify(fixture);
  const moduleSource = fs.readFileSync(modulePath, 'utf8');
  const loaded = await loadModules();
  const reassessment = loaded.reassessment;
  const contextModule = loaded.contexts;

  assert.equal(fixture.synthetic_only, true);
  assert.equal(
    reassessment.DEFAULT_LEGACY_REASSESSMENT_CONFIG.max_batch_items,
    5,
  );
  assert.equal(
    reassessment.DEFAULT_LEGACY_REASSESSMENT_CONFIG.reassessment_budget_ms,
    180000,
  );
  assert.equal(
    reassessment.DEFAULT_LEGACY_REASSESSMENT_CONFIG.dry_run,
    true,
  );
  assert.doesNotMatch(moduleSource, /indexedDB\.open|SeekPlayerDB|objectStoreNames/);
  assert.doesNotMatch(moduleSource, /vocabulary\.srs\.store\.v1/);

  const dueCandidate = {
    learning_unit_id: 'graduated-due-item',
    queue_kind: 'due_review',
    due_at: '2026-07-27T00:00:00.000Z',
    estimated_duration_ms: 36000,
    enqueue_reason: 'scheduler_due',
  };
  const constrainedPlan = reassessment.planLegacyReassessmentBatch({
    audit_manifest: fixture.audit_manifest,
    planner_input: plannerInput(3 * 36000, [dueCandidate]),
  });
  assert.deepEqual(
    constrainedPlan.ledger.entries.map((entry) => entry.queue_kind),
    ['due_review', 'reassessment', 'reassessment'],
  );
  assert.equal(constrainedPlan.selected_items.length, 2);
  assert.equal(constrainedPlan.unselected_legacy_word_ids.length, 4);
  assert.equal(
    constrainedPlan.invariants.unselected_items_due_at_changed,
    false,
  );
  assert.equal(
    fixture.legacy_records['word-z-unselected'].review_state.due_at,
    '2027-01-01T00:00:00.000Z',
  );

  const repository =
    reassessment.createInMemoryLegacyReassessmentRepository();
  const disabledService =
    reassessment.createLegacyVocabularyReassessmentService({
      enabled: false,
      repository,
      legacy_records: fixture.legacy_records,
    });
  await assert.rejects(
    disabledService.startBatch({
      audit_manifest: fixture.audit_manifest,
      planner_input: plannerInput(10 * 36000),
      reassessment_session_id: 'disabled-session',
      started_at: '2026-07-28T00:00:00.000Z',
    }),
    (error) =>
      error.code === 'INVALID_STATE_TRANSITION'
      && error.details.feature_flag
        === 'VOCABULARY_LEGACY_REASSESSMENT_ENABLED',
  );

  const service = reassessment.createLegacyVocabularyReassessmentService({
    enabled: true,
    repository,
    legacy_records: fixture.legacy_records,
  });
  const session = await service.startBatch({
    audit_manifest: fixture.audit_manifest,
    planner_input: plannerInput(10 * 36000),
    reassessment_session_id: 'reassessment-session-p9',
    started_at: '2026-07-28T00:00:00.000Z',
  });
  assert.equal(session.items.length, 5);
  assert.deepEqual(session.unselected_legacy_word_ids, ['word-z-unselected']);
  assert.equal(session.dry_run, true);
  assert.equal(session.feature_flag_enabled, true);

  await service.pauseSession({
    session_id: session.session_id,
    reason: 'synthetic operator break',
    occurred_at: '2026-07-28T00:00:30.000Z',
  });
  const resumed = await service.resumeSession({
    session_id: session.session_id,
    reason: 'synthetic operator resumed',
    occurred_at: '2026-07-28T00:01:00.000Z',
  });
  assert.equal(resumed.status, 'active');
  assert.deepEqual(
    resumed.control_log.map((entry) => entry.action),
    ['paused', 'resumed'],
  );

  const decisions = [
    {
      legacy_word_id: 'word-bad-reference',
      decision: {
        action: 'skip',
        processing_reason: 'bad reference requires later manual repair',
        operator_choice: 'skip this synthetic item',
        occurred_at: '2026-07-28T00:02:00.000Z',
        event_id: 'reassessment-event-skip',
        command_id: 'reassessment-command-skip',
        correlation_id: 'reassessment-correlation-skip',
      },
    },
    {
      legacy_word_id: 'word-polysemy-conflict',
      decision: {
        action: 'rebuild_review_state',
        processing_reason: 'operator selected one synthetic target sense',
        operator_choice: 'rebuild as a new review state',
        occurred_at: '2026-07-28T00:03:00.000Z',
        event_id: 'reassessment-event-rebuild',
        command_id: 'reassessment-command-rebuild',
        correlation_id: 'reassessment-correlation-rebuild',
        rebuilt_review_state: rebuiltReviewState(),
      },
    },
    {
      legacy_word_id: 'word-needs-sense',
      decision: {
        action: 'supplement_sense',
        processing_reason: 'synthetic context supports the selected meaning',
        operator_choice: 'confirm target sense',
        occurred_at: '2026-07-28T00:04:00.000Z',
        event_id: 'reassessment-event-sense',
        command_id: 'reassessment-command-sense',
        correlation_id: 'reassessment-correlation-sense',
        confirmed_target_sense: {
          target_sense_id: 'target-sense-draft-document',
          learning_unit_id: 'legacy-reassessment:word-needs-sense',
          word_id: 'word-needs-sense',
          gloss: 'preliminary document',
          normalized_gloss: 'preliminary document',
          part_of_speech: 'noun',
          definition: 'a preliminary version',
          language: 'en',
        },
      },
    },
    {
      legacy_word_id: 'word-needs-context',
      decision: {
        action: 'supplement_context',
        processing_reason: 'operator confirmed synthetic local context',
        operator_choice: 'attach validated context',
        occurred_at: '2026-07-28T00:05:00.000Z',
        event_id: 'reassessment-event-context',
        command_id: 'reassessment-command-context',
        correlation_id: 'reassessment-correlation-context',
        confirmed_context_evidence: {
          schema_version: 'context-evidence.v1',
          context_evidence_id: 'reassessment-context-steady',
          learning_unit_id: 'legacy-reassessment:word-needs-context',
          sentence: 'A synthetic signal remained steady.',
          surrounding_text: null,
          content_sha256:
            contextModule.deriveContextEvidenceContentSha256(
              'A synthetic signal remained steady.',
              null,
            ),
          source_kind: 'open_corpus',
          source_id: 'synthetic-open-corpus',
          source_title: 'Synthetic P9 fixture',
          source_locator: {
            locator_version: 'source-locator.v1',
            record_id: 'p9-steady-1',
          },
          license_kind: 'licensed_open',
          ownership: 'public',
          quality_status: 'validated',
          quality_reason: 'operator confirmed synthetic fixture',
          created_at: '2026-07-28T00:05:00.000Z',
          validated_at: '2026-07-28T00:05:00.000Z',
          revision: 0,
          extensions: { synthetic: true },
        },
      },
    },
    {
      legacy_word_id: 'word-compatible',
      decision: {
        action: 'confirm_existing_state',
        processing_reason: 'legacy word is compatible with the frozen policy',
        operator_choice: 'keep existing state',
        occurred_at: '2026-07-28T00:06:00.000Z',
        event_id: 'reassessment-event-confirm',
        command_id: 'reassessment-command-confirm',
        correlation_id: 'reassessment-correlation-confirm',
      },
    },
  ];

  const outcomes = [];
  for (const decision of decisions) {
    outcomes.push(await service.processItem({
      session_id: session.session_id,
      ...decision,
    }));
  }
  assert.deepEqual(
    new Set(outcomes.map((result) => result.outcome)),
    new Set([
      'skipped',
      'review_state_rebuilt',
      'sense_supplemented',
      'context_supplemented',
      'existing_state_confirmed',
    ]),
  );
  const idempotent = await service.processItem({
    session_id: session.session_id,
    ...decisions[4],
  });
  assert.deepEqual(idempotent, outcomes[4]);
  const idempotentSense = await service.processItem({
    session_id: session.session_id,
    ...decisions[2],
  });
  assert.deepEqual(idempotentSense, outcomes[2]);
  assert.match(idempotentSense.decision_fingerprint, /^[a-f0-9]{64}$/);

  async function assertNoMutationOnReject(input, predicate) {
    const before = JSON.stringify(repository.snapshot());
    await assert.rejects(
      service.processItem({
        session_id: session.session_id,
        ...input,
      }),
      predicate,
    );
    assert.equal(
      JSON.stringify(repository.snapshot()),
      before,
      'rejected decisions must leave session and event bytes unchanged',
    );
  }

  const compatibleDecision = decisions[4];
  const compatibleMutations = [
    {
      ...compatibleDecision,
      decision: {
        ...compatibleDecision.decision,
        action: 'skip',
      },
    },
    {
      ...compatibleDecision,
      decision: {
        ...compatibleDecision.decision,
        processing_reason: 'changed processing reason',
      },
    },
    {
      ...compatibleDecision,
      decision: {
        ...compatibleDecision.decision,
        operator_choice: 'changed operator choice',
      },
    },
    {
      ...compatibleDecision,
      decision: {
        ...compatibleDecision.decision,
        command_id: 'changed-command-id',
      },
    },
    {
      ...compatibleDecision,
      decision: {
        ...compatibleDecision.decision,
        correlation_id: 'changed-correlation-id',
      },
    },
    {
      ...compatibleDecision,
      decision: {
        ...compatibleDecision.decision,
        occurred_at: '2026-07-28T00:06:01.000Z',
      },
    },
  ];
  for (const mutation of compatibleMutations) {
    await assertNoMutationOnReject(
      mutation,
      (error) =>
        error.code === 'IDEMPOTENCY_CONFLICT'
        && error.details.expected_decision_fingerprint
        !== error.details.actual_decision_fingerprint,
    );
  }

  const changedSensePayload = JSON.parse(JSON.stringify(decisions[2]));
  changedSensePayload.decision.confirmed_target_sense.gloss =
    'changed preliminary document';
  await assertNoMutationOnReject(
    changedSensePayload,
    (error) => error.code === 'IDEMPOTENCY_CONFLICT',
  );

  const changedContextPayload = JSON.parse(JSON.stringify(decisions[3]));
  changedContextPayload.decision.confirmed_context_evidence.sentence =
    'A changed synthetic signal remained steady.';
  changedContextPayload.decision.confirmed_context_evidence.content_sha256 =
    contextModule.deriveContextEvidenceContentSha256(
      changedContextPayload.decision.confirmed_context_evidence.sentence,
      null,
    );
  await assertNoMutationOnReject(
    changedContextPayload,
    (error) => error.code === 'IDEMPOTENCY_CONFLICT',
  );

  const changedReviewStatePayload = JSON.parse(JSON.stringify(decisions[1]));
  changedReviewStatePayload.decision.rebuilt_review_state
    .scheduler_parameters_version = 'fsrs-parameters.changed.v1';
  await assertNoMutationOnReject(
    changedReviewStatePayload,
    (error) => error.code === 'IDEMPOTENCY_CONFLICT',
  );

  const invalidSenseMutations = [
    (sense) => {
      sense.unknown_field = 'rejected';
    },
    (sense) => {
      sense.gloss = '   ';
    },
    (sense) => {
      sense.language = 'english';
    },
    (sense) => {
      sense.target_sense_id = '';
    },
    (sense) => {
      sense.learning_unit_id = 'legacy-reassessment:wrong-item';
    },
    (sense) => {
      sense.word_id = 'wrong-word-id';
    },
  ];
  for (const mutate of invalidSenseMutations) {
    const invalidDecision = JSON.parse(JSON.stringify(decisions[2]));
    mutate(invalidDecision.decision.confirmed_target_sense);
    await assertNoMutationOnReject(
      invalidDecision,
      (error) =>
        error.code === 'INVALID_FIELD_TYPE'
        || error.code === 'MISSING_REQUIRED_FIELD'
        || error.code === 'INVALID_CONTEXT_REFERENCE',
    );
  }

  const beforeRollback = await service.getSession(session.session_id);
  const eventsBeforeRollback = await service.listEvents(session.session_id);
  assert.equal(eventsBeforeRollback.length, 5);
  assert.ok(eventsBeforeRollback.every((event) => event.is_legacy === true));
  assert.ok(
    eventsBeforeRollback.every(
      (event) => event.training_eligible === false,
    ),
  );
  const senseEvent = eventsBeforeRollback.find(
    (event) => event.event_id === 'reassessment-event-sense',
  );
  const senseItem = beforeRollback.items.find(
    (item) => item.legacy_word_id === 'word-needs-sense',
  );
  assert.equal(
    senseEvent.target_sense_id,
    senseItem.confirmed_user_content.target_senses[0].target_sense_id,
  );
  assert.deepEqual(
    senseEvent.payload.confirmed_target_sense,
    senseItem.confirmed_user_content.target_senses[0],
  );
  assert.deepEqual(
    senseEvent.payload.confirmed_target_sense,
    outcomes[2].confirmed_target_sense,
  );
  assert.equal(
    senseItem.decision_fingerprint,
    outcomes[2].decision_fingerprint,
  );
  assert.ok(
    eventsBeforeRollback.every(
      (event) =>
        event.payload.original_state_snapshot
        && event.payload.processing_reason
        && event.payload.operator_choice
        && event.payload.reassessment_policy_version
          === 'legacy-reassessment-policy.v1',
    ),
  );
  assert.deepEqual(
    beforeRollback.items.find(
      (item) => item.legacy_word_id === 'word-compatible',
    ).original_state_snapshot.review_logs,
    fixture.legacy_records['word-compatible'].review_logs,
  );

  const rolledBack = await service.rollbackFeatureFlag({
    session_id: session.session_id,
    reason: 'synthetic rollback drill',
    occurred_at: '2026-07-28T00:07:00.000Z',
  });
  assert.equal(rolledBack.status, 'rolled_back');
  assert.equal(rolledBack.feature_flag_enabled, false);
  assert.equal(
    rolledBack.control_log.at(-1).preserved_event_count,
    5,
  );
  assert.equal(
    rolledBack.items.find(
      (item) => item.legacy_word_id === 'word-needs-sense',
    ).confirmed_user_content.target_senses.length,
    1,
  );
  assert.equal(
    rolledBack.items.find(
      (item) => item.legacy_word_id === 'word-needs-context',
    ).confirmed_user_content.contexts.length,
    1,
  );
  assert.equal(
    rolledBack.items.find(
      (item) => item.legacy_word_id === 'word-polysemy-conflict',
    ).reassessment_output.rebuilt_review_state.schema_version,
    'review-state.v2',
  );
  assert.deepEqual(
    rolledBack.items.find(
      (item) => item.legacy_word_id === 'word-compatible',
    ).reassessment_output.confirmed_existing_review_state,
    fixture.legacy_records['word-compatible'].review_state,
  );
  assert.equal((await service.listEvents(session.session_id)).length, 5);
  await assert.rejects(
    service.processItem({
      session_id: session.session_id,
      ...decisions[0],
    }),
    (error) => error.code === 'INVALID_STATE_TRANSITION',
  );
  await assert.rejects(
    service.startBatch({
      audit_manifest: fixture.audit_manifest,
      planner_input: plannerInput(10 * 36000),
      reassessment_session_id: 'post-rollback-session',
      started_at: '2026-07-28T00:08:00.000Z',
    }),
    (error) =>
      error.code === 'INVALID_STATE_TRANSITION'
      && error.details.feature_flag
        === 'VOCABULARY_LEGACY_REASSESSMENT_ENABLED',
  );

  assert.equal(JSON.stringify(fixture), originalFixture);
  console.log(
    'legacy vocabulary reassessment focused verification passed '
      + '(budgeted batch, five outcomes, events, pause/resume, rollback)',
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
