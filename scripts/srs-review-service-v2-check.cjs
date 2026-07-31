const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

async function loadModules(repoRoot) {
  const tempDir = fs.mkdtempSync(path.join(repoRoot, '.tmp-p7-check-'));
  const sources = [
    'src/services/vocabulary/vocabulary-learning-models.js',
    'src/services/vocabulary/vocabulary-acquisition-repository.js',
    'src/services/vocabulary/vocabulary-context-evidence.js',
    'src/services/vocabulary/vocabulary-learning-events.js',
    'src/services/vocabulary/vocabulary-learning-uow.js',
    'src/features/srs-review/srs-review-policy.js',
    'src/features/srs-review/srs-session-planner.js',
    'src/services/vocabulary/srs-review-session-ledger.js',
    'src/services/vocabulary/srs-review-service-v2.js',
    'src/services/vocabulary/srs-scheduler.js',
    'src/services/vocabulary/vocabulary-models.js',
  ];
  const replacements = new Map(sources.map((source) => [
    path.basename(source),
    path.basename(source, '.js') + '.mjs',
  ]));
  try {
    for (const source of sources) {
      let content = fs.readFileSync(path.join(repoRoot, source), 'utf8');
      for (const [from, to] of replacements) content = content.replaceAll(from, to);
      content = content.replaceAll('srs-scheduler.js', 'srs-scheduler.mjs');
      content = content
        .replaceAll('../../features/srs-review/srs-review-policy.mjs', './srs-review-policy.mjs')
        .replaceAll('../../features/srs-review/srs-session-planner.mjs', './srs-session-planner.mjs');
      fs.writeFileSync(path.join(tempDir, replacements.get(path.basename(source))), content);
    }
    const imported = await Promise.all(sources.map((source) => import(
      `${pathToFileURL(path.join(tempDir, replacements.get(path.basename(source)))).href}?p7=1`
    )));
    return {
      models: imported[0],
      acquisition: imported[1],
      events: imported[3],
      uow: imported[4],
      policy: imported[5],
      planner: imported[6],
      ledger: imported[7],
      service: imported[8],
    };
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

const DAY = 24 * 60 * 60 * 1000;
const NOW = '2026-07-28T08:00:00.000Z';

function unit(id, status = 'graduated') {
  return {
    learning_unit: {
      schema_version: 'learning-unit.v1',
      learning_unit_id: id,
      word_id: `word-${id}`,
      normalized_form: `synthetic-${id}`,
      language: 'en',
      target_sense_id: `sense-${id}`,
      target_sense_key: `en\u001fnoun\u001fmeaning-${id}`,
      target_sense: {
        gloss: `meaning-${id}`,
        normalized_gloss: `meaning-${id}`,
        part_of_speech: 'noun',
        definition: null,
        language: 'en',
      },
      created_at: '2026-07-20T08:00:00.000Z',
      updated_at: '2026-07-21T08:00:00.000Z',
      archived_at: null,
      revision: 1,
      extensions: {},
    },
    acquisition_state: {
      schema_version: 'acquisition-state.v1',
      learning_unit_id: id,
      status,
      context_evidence_ids: [`context-${id}`],
      validated_anchor_id: `context-${id}`,
      last_acquisition_attempt_id: null,
      introduction_episode_id: `episode-${id}`,
      introduced_at: '2026-07-20T08:00:00.000Z',
      last_exposure_at: '2026-07-21T08:00:00.000Z',
      ready_for_check_at: '2026-07-21T07:59:00.000Z',
      graduated_at: status === 'graduated' ? '2026-07-21T08:00:00.000Z' : null,
      skipped_at: null,
      revision: 4,
      extensions: {},
    },
  };
}

function reviewState(id, overrides = {}) {
  return {
    schema_version: 'review-state.v2',
    review_state_id: `review-${id}`,
    learning_unit_id: id,
    word_id: `word-${id}`,
    state: 'review',
    due_at: '2026-07-28T07:00:00.000Z',
    stability: 3,
    difficulty: 5,
    elapsed_days: 2,
    scheduled_days: 3,
    reps: 2,
    lapses: 0,
    learning_steps: 0,
    last_review_at: '2026-07-25T08:00:00.000Z',
    scheduler_version: 'fsrs.v1',
    scheduler_parameters_version: 'fsrs-parameters.v1',
    created_at: '2026-07-21T08:00:00.000Z',
    updated_at: '2026-07-25T08:00:00.000Z',
    revision: 2,
    extensions: {},
    ...overrides,
  };
}

function deterministicScheduler() {
  const delay = { again: 15 * 60 * 1000, hard: DAY, good: 3 * DAY, easy: 7 * DAY };
  return {
    schedule(before, rating, occurredAt) {
      const due = new Date(Date.parse(occurredAt) + delay[rating]).toISOString();
      return {
        reviewState: {
          word_id: before.word_id,
          due_at: due,
          stability: before.stability + ({ again: 0, hard: 0.5, good: 2, easy: 4 }[rating]),
          difficulty: before.difficulty,
          elapsed_days: before.elapsed_days,
          scheduled_days: Math.round(delay[rating] / DAY),
          reps: before.reps + 1,
          lapses: before.lapses + (rating === 'again' ? 1 : 0),
          state: rating === 'again' ? 'relearning' : 'review',
          last_review_at: occurredAt,
          learning_steps: rating === 'again' ? 1 : 0,
        },
        schedulerLog: {
          rating,
          reviewed_at: occurredAt,
          due_at: due,
          synthetic: true,
        },
      };
    },
  };
}

function acquisitionStore(pairs) {
  return {
    schema_version: 'acquisition-store.v1',
    by_learning_unit_id: Object.fromEntries(pairs.map((pair) => [
      pair.learning_unit.learning_unit_id,
      pair,
    ])),
    acquisition_attempts_by_id: {},
  };
}

function baseRows(pairs, reviewStates) {
  return [
    {
      id: 'vocabulary.acquisition.store.v1',
      content: acquisitionStore(pairs),
      timestamp: NOW,
    },
    {
      id: 'vocabulary.review.store.v2',
      content: {
        schema_version: 'review-store.v2',
        by_learning_unit_id: Object.fromEntries(reviewStates.map((state) => [
          state.learning_unit_id,
          state,
        ])),
      },
      timestamp: NOW,
    },
  ];
}

function eventFromRows(rows, eventId) {
  for (const row of rows) {
    const event = row.content?.events?.find?.((candidate) => candidate.event_id === eventId);
    if (event) return event;
  }
  return null;
}

function harness(api, {
  pairs = [unit('one')],
  reviewStates = [reviewState('one')],
  events = [],
  ledgers = [],
  budgetMs = 60 * 60 * 1000,
  mode = 'balanced',
  useDefaultScheduler = false,
} = {}) {
  let clock = NOW;
  const runner = api.uow.createInMemoryVocabularyLearningUnitOfWorkRunner({
    rows: baseRows(pairs, reviewStates),
    now: () => clock,
  });
  const ledgerRepository = api.ledger.createInMemoryReviewSessionLedgerRepository(ledgers);
  const mutableEvents = events;
  const reviewQueries = [];
  const acquisitionRepository = {
    async loadSnapshot() {
      return structuredClone(acquisitionStore(pairs));
    },
  };
  const reviewStateRepository = {
    async getByLearningUnitId(id) {
      reviewQueries.push(id);
      return structuredClone(reviewStates.find((state) => state.learning_unit_id === id) ?? null);
    },
  };
  const learningEventRepository = {
    async query(query) {
      return structuredClone(mutableEvents.filter((event) => (
        !query.event_type || event.event_type === query.event_type
      )));
    },
  };
  const serviceOptions = {
    acquisitionRepository,
    reviewStateRepository,
    learningEventRepository,
    sessionLedgerRepository: ledgerRepository,
    scheduler: useDefaultScheduler ? undefined : deterministicScheduler(),
    schedulerVersion: useDefaultScheduler ? 'ts-fsrs.v5.4.1' : 'deterministic-scheduler.v1',
    runUnitOfWork: runner.run,
    now: () => clock,
  };
  const service = api.service.createSrsReviewServiceV2(serviceOptions);
  const start = (sessionId = 'session-one', overrides = {}) => service.startReviewSession({
    session_id: sessionId,
    now: NOW,
    local_day: '2026-07-28',
    timezone: 'Asia/Shanghai',
    policy: {
      schema_version: 'review-policy.v1',
      policy_version: `policy-${mode}.v1`,
      mode,
      budget_ms: budgetMs,
      default_attempt_ms: 36000,
      balanced_revisit_delay_ms: 15 * 60 * 1000,
      balanced_max_revisits_per_local_day: 1,
    },
    ...overrides,
  });
  return {
    service,
    start,
    runner,
    ledgerRepository,
    mutableEvents,
    reviewQueries,
    serviceOptions,
    setNow(value) {
      clock = value;
    },
  };
}

function attempt(ledger, suffix, overrides = {}) {
  const entry = ledger.entries[ledger.cursor];
  return {
    command_id: `command-${suffix}`,
    attempt_id: `attempt-${suffix}`,
    event_id: `event-${suffix}`,
    correlation_id: `correlation-${suffix}`,
    session_id: ledger.session_id,
    ledger_item_id: entry.ledger_item_id,
    occurred_at: NOW,
    event_partition: '2026-07',
    rating: 'good',
    prompt_mode: 'word_only',
    cue_level: 'none',
    answer_revealed_before_rating: false,
    duration_ms: 12000,
    active_duration_ms: 9000,
    context_evidence_id: null,
    source_kind: null,
    content_version: 'synthetic-content.v1',
    ...overrides,
  };
}

async function rejectCode(promise, code) {
  await assert.rejects(promise, (caught) => {
    assert.equal(caught?.code, code);
    assert.equal(typeof caught?.details, 'object');
    return true;
  });
}

async function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const api = await loadModules(repoRoot);
  assert.equal(typeof api.service.createSrsReviewServiceV2, 'function');
  assert.equal(typeof api.ledger.createIndexedDbReviewStateReader, 'function');
  assert.equal(typeof api.ledger.createIndexedDbReviewSessionLedgerRepository, 'function');
  assert.equal(typeof api.service.createSrsReviewServiceV2({
    acquisitionRepository: { loadSnapshot: async () => acquisitionStore([]) },
    reviewStateRepository: { getByLearningUnitId: async () => null },
    learningEventRepository: { query: async () => [] },
    sessionLedgerRepository: api.ledger.createInMemoryReviewSessionLedgerRepository(),
    runUnitOfWork: async () => {
      throw new Error('not called by scheduler import smoke test');
    },
  }).startReviewSession, 'function');
  const serviceSource = fs.readFileSync(
    path.join(repoRoot, 'src/services/vocabulary/srs-review-service-v2.js'),
    'utf8',
  );
  const ledgerSource = fs.readFileSync(
    path.join(repoRoot, 'src/services/vocabulary/srs-review-session-ledger.js'),
    'utf8',
  );
  assert.equal(
    serviceSource.includes('vocabulary.review.store.v2'),
    false,
    'P7 service must not implement a second ReviewState store',
  );
  assert.match(ledgerSource, /bindReviewRepositoryToTransaction/u);
  assert.match(ledgerSource, /indexedDBApi\.open\('SeekPlayerDB', 1\)/u);
  assert.equal(ledgerSource.includes('createObjectStore'), false);

  {
    const eligible = unit('eligible');
    const noReview = unit('no-review');
    const acquiring = unit('acquiring', 'acquiring');
    const future = unit('future');
    const test = harness(api, {
      pairs: [eligible, noReview, acquiring, future],
      reviewStates: [
        reviewState('eligible'),
        reviewState('acquiring'),
        reviewState('future', { due_at: '2026-07-29T08:00:00.000Z' }),
      ],
    });
    const ledger = await test.start('session-filter');
    assert.deepEqual(ledger.entries.map((entry) => entry.learning_unit_id), ['eligible']);
    assert.deepEqual(
      test.reviewQueries.sort(),
      ['eligible', 'future', 'no-review'],
      'ReviewState queries are made only for graduated LearningUnits',
    );
    assert.equal(ledger.entries[0].enqueue_reason, 'SCHEDULER_DUE');
    assert.equal(ledger.mode, 'balanced');
    assert.equal(ledger.policy_version, 'policy-balanced.v1');
    assert.equal(ledger.budget_ms, 3600000);
    assert.equal(ledger.estimated_attempt_ms, 36000);
  }

  {
    const states = [
      reviewState('later', { due_at: '2026-07-28T07:30:00.000Z' }),
      reviewState('earlier', { due_at: '2026-07-28T06:30:00.000Z' }),
    ];
    const test = harness(api, {
      pairs: [unit('later'), unit('earlier')],
      reviewStates: states,
      budgetMs: 36000,
    });
    const ledger = await test.start('session-fixed');
    assert.deepEqual(ledger.entries.map((entry) => entry.learning_unit_id), ['earlier']);
    assert.equal(ledger.backlog.due_review_count, 1);
    const again = await test.start('session-fixed');
    assert.deepEqual(again, ledger, 'session start is stable and does not re-plan an existing ledger');
  }

  {
    const test = harness(api, { useDefaultScheduler: true });
    const ledger = await test.start('session-invalid');
    const rowsBefore = test.runner.snapshot();
    await rejectCode(test.service.recordReviewAttempt(attempt(ledger, 'invalid', {
      rating: 'mastered',
    })), 'INVALID_ENUM_VALUE');
    assert.deepEqual(test.runner.snapshot(), rowsBefore);
  }

  {
    for (const rating of ['again', 'hard', 'good', 'easy']) {
      const production = harness(api, {
        mode: 'once_daily',
        useDefaultScheduler: true,
      });
      const ledger = await production.start(`session-production-${rating}`);
      const result = await production.service.recordReviewAttempt(attempt(
        ledger,
        `production-${rating}`,
        { rating },
      ));
      assert.equal(result.attempt.rating, rating);
      assert.equal(result.attempt.after_state.revision, 3);
      assert.equal(result.attempt.after_state.scheduler_version, 'ts-fsrs.v5.4.1');
      assert.equal(
        eventFromRows(production.runner.snapshot(), `event-production-${rating}`).rating,
        rating,
      );
    }
  }

  {
    const original = harness(api, { mode: 'once_daily' });
    const wordOnly = harness(api, { mode: 'once_daily' });
    const originalLedger = await original.start('session-original');
    const wordLedger = await wordOnly.start('session-word');
    const originalResult = await original.service.recordReviewAttempt(attempt(
      originalLedger,
      'original',
      {
        prompt_mode: 'original_context',
        cue_level: 'target_sentence',
      },
    ));
    const wordResult = await wordOnly.service.recordReviewAttempt(attempt(
      wordLedger,
      'word',
      {
        prompt_mode: 'word_only',
        cue_level: 'none',
      },
    ));
    assert.equal(originalResult.attempt.rating, 'good');
    assert.equal(wordResult.attempt.rating, 'good');
    assert.deepEqual(
      originalResult.attempt.after_state,
      wordResult.attempt.after_state,
      'good scheduling is independent of prompt/cue metadata',
    );
    const originalEvent = eventFromRows(original.runner.snapshot(), 'event-original');
    const wordEvent = eventFromRows(wordOnly.runner.snapshot(), 'event-word');
    assert.equal(originalEvent.rating, wordEvent.rating);
    assert.equal(originalEvent.prompt_mode, 'original_context');
    assert.equal(originalEvent.cue_level, 'target_sentence');
    assert.equal(wordEvent.prompt_mode, 'word_only');
    assert.equal(wordEvent.cue_level, 'none');
    assert.notEqual(originalEvent.training_eligible, undefined);
    assert.equal(originalResult.ledger.status, 'completed');

    const duplicateRows = wordOnly.runner.snapshot();
    const duplicate = await wordOnly.service.recordReviewAttempt(attempt(
      wordLedger,
      'word',
      {
        prompt_mode: 'word_only',
        cue_level: 'none',
      },
    ));
    assert.equal(duplicate.attempt.attempt_id, 'attempt-word');
    assert.deepEqual(wordOnly.runner.snapshot(), duplicateRows);
    await rejectCode(wordOnly.service.recordReviewAttempt(attempt(
      wordLedger,
      'word',
      {
        prompt_mode: 'original_context',
      },
    )), 'IDEMPOTENCY_CONFLICT');
    assert.deepEqual(wordOnly.runner.snapshot(), duplicateRows);
    await rejectCode(wordOnly.service.recordReviewAttempt(attempt(
      wordLedger,
      'word',
      {
        active_duration_reliable: false,
      },
    )), 'IDEMPOTENCY_CONFLICT');
    assert.deepEqual(wordOnly.runner.snapshot(), duplicateRows);
  }

  {
    const unreliable = harness(api, { mode: 'once_daily' });
    const ledger = await unreliable.start('session-unreliable-duration');
    await unreliable.service.recordReviewAttempt(attempt(
      ledger,
      'unreliable-duration',
      { active_duration_reliable: false },
    ));
    const event = eventFromRows(
      unreliable.runner.snapshot(),
      'event-unreliable-duration',
    );
    assert.equal(event.training_eligible, false);
    assert.equal(event.exclusion_reasons.includes('ACTIVE_DURATION_UNRELIABLE'), true);
    assert.equal(event.payload.active_duration_reliable, false);
  }

  {
    const balanced = harness(api, {
      reviewStates: [reviewState('one', { state: 'new', reps: 0, last_review_at: null })],
      budgetMs: 2 * 36000,
    });
    const ledger = await balanced.start('session-balanced');
    const result = await balanced.service.recordReviewAttempt(attempt(ledger, 'balanced'));
    assert.equal(result.revisit_decision.allowed, true);
    assert.equal(result.ledger.entries.length, 2);
    assert.equal(result.ledger.entries[1].queue_kind, 'revisit');
    assert.equal(result.ledger.entries[1].planned_due_at, '2026-07-28T08:15:00.000Z');
    assert.equal(
      result.attempt.after_state.due_at,
      '2026-07-31T08:00:00.000Z',
      'balanced ledger policy does not rewrite scheduler due_at',
    );
    await rejectCode(balanced.service.recordReviewAttempt(attempt(
      result.ledger,
      'balanced-revisit-early',
      { occurred_at: '2026-07-28T08:14:59.999Z' },
    )), 'INVALID_STATE_TRANSITION');
    balanced.setNow('2026-07-28T08:15:00.000Z');
    const revisitResult = await balanced.service.recordReviewAttempt(attempt(
      result.ledger,
      'balanced-revisit',
      { occurred_at: '2026-07-28T08:15:00.000Z', rating: 'again' },
    ));
    assert.equal(revisitResult.revisit_decision.allowed, false);
    assert.equal(revisitResult.revisit_decision.reason_code, 'BALANCED_REVISIT_LIMIT_REACHED');
    assert.equal(revisitResult.ledger.entries.length, 2);
    assert.equal(revisitResult.ledger.status, 'completed');
  }

  {
    const budgeted = harness(api, {
      reviewStates: [reviewState('one', { state: 'new', reps: 0, last_review_at: null })],
      budgetMs: 36000,
    });
    const ledger = await budgeted.start('session-budgeted-revisit');
    const result = await budgeted.service.recordReviewAttempt(attempt(ledger, 'budgeted'));
    assert.equal(result.revisit_decision.allowed, false);
    assert.equal(result.revisit_decision.reason_code, 'SESSION_BUDGET_EXHAUSTED');
    assert.equal(result.ledger.entries.length, 1);
  }

  {
    const crash = harness(api, { mode: 'once_daily' });
    const ledger = await crash.start('session-ledger-put-crash');
    let failNextUpdate = true;
    const failingLedgerRepository = {
      getBySessionId: (...args) => crash.ledgerRepository.getBySessionId(...args),
      put(value, expectedRevision) {
        if (expectedRevision !== null && failNextUpdate) {
          failNextUpdate = false;
          return Promise.reject({
            code: 'TRANSACTION_ABORTED',
            message: 'Injected post-UoW ledger failure',
            details: { operation: 'put_session_ledger' },
          });
        }
        return crash.ledgerRepository.put(value, expectedRevision);
      },
    };
    const crashingService = api.service.createSrsReviewServiceV2({
      ...crash.serviceOptions,
      sessionLedgerRepository: failingLedgerRepository,
    });
    const originalInput = attempt(ledger, 'ledger-put-crash', {
      active_duration_reliable: true,
    });
    await rejectCode(
      crashingService.recordReviewAttempt(originalInput),
      'TRANSACTION_ABORTED',
    );
    const committedRows = crash.runner.snapshot();
    const committedEvent = eventFromRows(committedRows, originalInput.event_id);
    assert.ok(committedEvent, 'UoW event commits before the injected ledger failure');
    assert.equal(
      committedEvent.payload.attempt_fingerprint,
      committedEvent.payload.first_result.attempt_fingerprint,
    );
    assert.equal(
      committedEvent.payload.first_result.attempt.extensions.active_duration_reliable,
      true,
    );
    crash.mutableEvents.push(committedEvent);
    const reviewRowBeforeRetry = committedRows.find(
      (row) => row.id === 'vocabulary.review.store.v2',
    );
    const revisionBeforeRetry =
      reviewRowBeforeRetry.content.by_learning_unit_id.one.revision;
    const eventCountBeforeRetry = committedRows
      .filter((row) => Array.isArray(row.content?.events))
      .reduce((count, row) => count + row.content.events.length, 0);
    const receiptCountBeforeRetry = committedRows.filter(
      (row) => row.id.startsWith('vocabulary.learning-command-receipt.v1:'),
    ).length;

    const refreshed = api.service.createSrsReviewServiceV2(crash.serviceOptions);
    const restored = await refreshed.resumeReviewSession(
      'session-ledger-put-crash',
      { now: NOW },
    );
    assert.equal(restored.status, 'completed');
    assert.equal(
      restored.extensions.attempt_fingerprints_by_id[originalInput.attempt_id],
      committedEvent.payload.attempt_fingerprint,
    );
    assert.deepEqual(
      restored.extensions.attempt_results_by_id[originalInput.attempt_id],
      committedEvent.payload.first_result,
    );

    const sameRetry = await refreshed.recordReviewAttempt(originalInput);
    assert.deepEqual(
      { ...sameRetry, ledger: undefined },
      { ...committedEvent.payload.first_result, ledger: undefined },
    );
    const newTransportRetry = await refreshed.recordReviewAttempt({
      ...originalInput,
      command_id: 'command-ledger-put-crash-new',
      event_id: 'event-ledger-put-crash-new',
      correlation_id: 'correlation-ledger-put-crash-new',
    });
    assert.equal(newTransportRetry.event_id, originalInput.event_id);
    assert.equal(newTransportRetry.attempt.command_id, originalInput.command_id);
    await rejectCode(refreshed.recordReviewAttempt({
      ...originalInput,
      command_id: 'command-ledger-put-crash-reliability',
      event_id: 'event-ledger-put-crash-reliability',
      correlation_id: 'correlation-ledger-put-crash-reliability',
      active_duration_reliable: false,
    }), 'IDEMPOTENCY_CONFLICT');

    const rowsAfterRetry = crash.runner.snapshot();
    assert.deepEqual(rowsAfterRetry, committedRows);
    assert.equal(
      rowsAfterRetry.find((row) => row.id === 'vocabulary.review.store.v2')
        .content.by_learning_unit_id.one.revision,
      revisionBeforeRetry,
    );
    assert.equal(
      rowsAfterRetry
        .filter((row) => Array.isArray(row.content?.events))
        .reduce((count, row) => count + row.content.events.length, 0),
      eventCountBeforeRetry,
    );
    assert.equal(
      rowsAfterRetry.filter(
        (row) => row.id.startsWith('vocabulary.learning-command-receipt.v1:'),
      ).length,
      receiptCountBeforeRetry,
    );
  }

  {
    const modes = {};
    for (const mode of ['once_daily', 'balanced', 'intensive']) {
      const test = harness(api, {
        mode,
        reviewStates: [reviewState('one', { state: 'new', reps: 0, last_review_at: null })],
        budgetMs: 2 * 36000,
      });
      const ledger = await test.start(`session-${mode}`);
      modes[mode] = await test.service.recordReviewAttempt(attempt(ledger, mode, {
        rating: 'again',
      }));
    }
    assert.equal(modes.once_daily.revisit_decision.allowed, false);
    assert.equal(modes.balanced.revisit_decision.allowed, true);
    assert.equal(modes.intensive.revisit_decision.allowed, true);
    assert.equal(modes.intensive.revisit_decision.eligible_at, '2026-07-28T08:15:00.000Z');
  }

  {
    const test = harness(api, { mode: 'once_daily' });
    const before = await test.start('session-recovery');
    const recorded = await test.service.recordReviewAttempt(attempt(before, 'recovery'));
    const event = eventFromRows(test.runner.snapshot(), 'event-recovery');
    const freshLedgerRepository = api.ledger.createInMemoryReviewSessionLedgerRepository([before]);
    const refreshed = api.service.createSrsReviewServiceV2({
      acquisitionRepository: { loadSnapshot: async () => acquisitionStore([unit('one')]) },
      reviewStateRepository: { getByLearningUnitId: async () => reviewState('one') },
      learningEventRepository: { query: async () => [structuredClone(event)] },
      sessionLedgerRepository: freshLedgerRepository,
      scheduler: deterministicScheduler(),
      runUnitOfWork: test.runner.run,
      now: () => NOW,
    });
    const restored = await refreshed.resumeReviewSession('session-recovery', { now: NOW });
    assert.equal(restored.cursor, 1);
    assert.equal(restored.status, 'completed');
    assert.deepEqual(restored.extensions.attempt_ids, ['attempt-recovery']);
    assert.equal(recorded.attempt.after_state.revision, 3);

    const nextDayRepository = api.ledger.createInMemoryReviewSessionLedgerRepository([before]);
    const nextDay = api.service.createSrsReviewServiceV2({
      acquisitionRepository: { loadSnapshot: async () => acquisitionStore([unit('one')]) },
      reviewStateRepository: { getByLearningUnitId: async () => reviewState('one') },
      learningEventRepository: { query: async () => [] },
      sessionLedgerRepository: nextDayRepository,
      scheduler: deterministicScheduler(),
      runUnitOfWork: test.runner.run,
      now: () => '2026-07-29T08:00:00.000Z',
    });
    const abandoned = await nextDay.resumeReviewSession('session-recovery', {
      now: '2026-07-29T08:00:00.000Z',
    });
    assert.equal(abandoned.status, 'abandoned');
  }

  {
    const sameDayEvent = {
      event_type: 'review_attempt_recorded',
      learning_unit_id: 'one',
      occurred_at: '2026-07-28T01:00:00.000Z',
      rating: 'good',
      payload: { is_revisit: false },
    };
    for (const mode of ['once_daily', 'balanced']) {
      const test = harness(api, { mode, events: [sameDayEvent] });
      const ledger = await test.start(`session-same-day-${mode}`);
      assert.equal(ledger.entries.length, 0, `${mode} excludes mature same-day correct cards`);
    }
    const crossDay = harness(api, {
      mode: 'once_daily',
      events: [{ ...sameDayEvent, occurred_at: '2026-07-27T01:00:00.000Z' }],
    });
    assert.equal((await crossDay.start('session-cross-day')).entries.length, 1);
  }

  console.log('P7 SRS review service V2/session ledger checks passed');
}

main().catch((caught) => {
  console.error(caught);
  process.exitCode = 1;
});
