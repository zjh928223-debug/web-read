const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

async function loadP6Modules(repoRoot) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'read-web-p6-check-'));
  const sources = [
    ['src/services/vocabulary/vocabulary-learning-models.js', 'vocabulary-learning-models.mjs'],
    ['src/services/vocabulary/vocabulary-persistence.js', 'vocabulary-persistence.mjs'],
    ['src/services/vocabulary/vocabulary-acquisition-repository.js', 'vocabulary-acquisition-repository.mjs'],
    ['src/services/vocabulary/vocabulary-context-evidence.js', 'vocabulary-context-evidence.mjs'],
    ['src/services/vocabulary/vocabulary-learning-events.js', 'vocabulary-learning-events.mjs'],
    ['src/services/vocabulary/vocabulary-learning-uow.js', 'vocabulary-learning-uow.mjs'],
    ['src/services/vocabulary/vocabulary-acquisition-service.js', 'vocabulary-acquisition-service.mjs'],
  ];
  try {
    for (const [relativePath, stagedName] of sources) {
      let source = fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
      source = source
        .replaceAll("from './vocabulary-learning-models.js'", "from './vocabulary-learning-models.mjs'")
        .replaceAll("from './vocabulary-persistence.js'", "from './vocabulary-persistence.mjs'")
        .replaceAll("from './vocabulary-acquisition-repository.js'", "from './vocabulary-acquisition-repository.mjs'")
        .replaceAll("from './vocabulary-context-evidence.js'", "from './vocabulary-context-evidence.mjs'")
        .replaceAll("from './vocabulary-learning-events.js'", "from './vocabulary-learning-events.mjs'")
        .replaceAll("from './vocabulary-learning-uow.js'", "from './vocabulary-learning-uow.mjs'");
      fs.writeFileSync(path.join(tempDir, stagedName), source);
    }
    const modules = await Promise.all(sources.map(([, stagedName]) => import(
      `${pathToFileURL(path.join(tempDir, stagedName)).href}?p6=1`
    )));
    return {
      models: modules[0],
      contexts: modules[3],
      uow: modules[5],
      service: modules[6],
    };
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

async function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const api = await loadP6Modules(repoRoot);
  assert.equal(typeof api.uow.createVocabularyLearningTransactionRowPort, 'function');
  assert.equal(typeof api.uow.bindReviewRepositoryToTransaction, 'function');
  assert.equal(typeof api.uow.assembleVocabularyLearningUnitOfWork, 'function');
  assert.equal(typeof api.uow.runVocabularyLearningUnitOfWork, 'function');
  assert.equal(typeof api.service.createVocabularyAcquisitionService, 'function');

  const fixture = JSON.parse(fs.readFileSync(
    path.join(repoRoot, 'scripts', 'fixtures', 'vocabulary-command-receipt-fingerprint-vectors.v1.json'),
    'utf8',
  ));
  for (const vector of Object.values(fixture.valid_vectors)) {
    assert.equal(
      api.uow.fingerprintVocabularyLearningCommand(vector.command_type, vector.payload),
      vector.expected_fingerprint,
      'P6 fingerprint must reuse every frozen P0 vector',
    );
  }
  const fixedNow = '2026-07-21T08:00:02.000Z';
  for (const invalid of [undefined, Number.NaN, Number.POSITIVE_INFINITY, new Date(0)]) {
    assert.throws(
      () => api.uow.canonicalJson({ invalid }),
      (error) => error?.code === 'INVALID_FIELD_TYPE',
    );
  }

  {
    const rows = new Map();
    const request = (action) => {
      const value = {};
      queueMicrotask(() => {
        try {
          value.result = action();
          value.onsuccess?.();
        } catch {
          value.onerror?.();
        }
      });
      return value;
    };
    let aborted = false;
    const fakeTransaction = {
      objectStore(name) {
        assert.equal(name, 'files');
        return {
          get(rowId) {
            return request(() => rows.get(rowId));
          },
          put(row) {
            return request(() => {
              rows.set(row.id, JSON.parse(JSON.stringify(row)));
              return row.id;
            });
          },
        };
      },
      abort() {
        aborted = true;
      },
    };
    const port = api.uow.createVocabularyLearningTransactionRowPort(
      fakeTransaction,
      'fake-transaction',
    );
    await port.putRow({
      id: 'synthetic.row',
      content: { value: 1 },
      timestamp: fixedNow,
    });
    assert.deepEqual(await port.getRow('synthetic.row'), {
      id: 'synthetic.row',
      content: { value: 1 },
      timestamp: fixedNow,
    });
    assert.throws(
      () => port.abort(Object.assign(new Error('synthetic'), {
        name: 'VocabularyLearningContractError',
        code: 'TRANSACTION_ABORTED',
        details: { operation: 'synthetic' },
      })),
      (error) => error?.code === 'TRANSACTION_ABORTED',
    );
    assert.equal(aborted, true);
  }

  let sequence = 0;
  const command = (payload, prefix = 'command') => ({
    command_id: `${prefix}-${++sequence}`,
    correlation_id: `correlation-${sequence}`,
    event_partition: '2026-07',
    payload,
  });
  const targetSense = (gloss, partOfSpeech = 'noun') => ({
    gloss,
    normalized_gloss: gloss,
    part_of_speech: partOfSpeech,
    definition: `synthetic definition for ${gloss}`,
    language: 'en',
  });
  const candidateUnit = (suffix, wordId = `word-${suffix}`) => ({
    learning_unit_id: `unit-${suffix}`,
    word_id: wordId,
    normalized_form: `synthetic-${suffix}`,
    language: 'en',
    target_sense_id: null,
    target_sense_key: null,
    target_sense: null,
    created_at: '2026-07-20T08:00:00.000Z',
    updated_at: '2026-07-20T08:00:00.000Z',
  });
  const contextEvidence = (suffix, learningUnitId, quality = 'validated') => (
    api.contexts.normalizeContextEvidence({
      context_evidence_id: `context-${suffix}`,
      learning_unit_id: learningUnitId,
      sentence: `A synthetic sentence contains synthetic-${suffix}.`,
      surrounding_text: null,
      source_kind: 'article',
      source_id: `article-${suffix}`,
      source_title: 'Synthetic fixture',
      source_locator: {
        locator_version: 'source-locator.v1',
        paragraph_index: 0,
        sentence_index: 0,
      },
      license_kind: 'user_owned',
      ownership: 'user',
      quality_status: quality,
      quality_reason: quality === 'validated' ? 'synthetic_confirmation' : null,
      created_at: '2026-07-20T08:01:00.000Z',
      validated_at: quality === 'validated' ? '2026-07-20T08:02:00.000Z' : null,
      extensions: {},
    })
  );
  const createHarness = (options = {}) => {
    const { serviceNow, ...runnerOptions } = options;
    const runner = api.uow.createInMemoryVocabularyLearningUnitOfWorkRunner({
      now: () => fixedNow,
      ...runnerOptions,
    });
    const service = api.service.createVocabularyAcquisitionService({
      enabled: true,
      now: serviceNow ?? (() => fixedNow),
      runUnitOfWork: runner.run,
    });
    return { runner, service };
  };
  const rejectCode = async (promise, code) => {
    await assert.rejects(promise, (error) => {
      assert.equal(error?.code, code);
      assert.equal(typeof error?.message, 'string');
      assert.equal(typeof error?.details, 'object');
      return true;
    });
  };
  {
    const basePayload = {
      learning_unit: candidateUnit('invalid-payload'),
      event_id: 'event-invalid-payload',
    };
    const invalidPayloadCases = [
      { name: 'nan', invalid: Number.NaN, valid: null },
      { name: 'infinity', invalid: Number.POSITIVE_INFINITY, valid: null },
      { name: 'negative-infinity', invalid: Number.NEGATIVE_INFINITY, valid: null },
      { name: 'date', invalid: new Date(0), valid: '1970-01-01T00:00:00.000Z' },
      {
        name: 'object-undefined',
        invalidPayload: { ...basePayload, probe: undefined },
        validPayload: { ...basePayload },
      },
      {
        name: 'array-undefined',
        invalid: [undefined],
        valid: [null],
      },
      {
        name: 'custom-prototype',
        invalid: Object.assign(Object.create({ inherited: true }), { own: 'same' }),
        valid: { own: 'same' },
      },
    ];
    for (const testCase of invalidPayloadCases) {
      let unitOfWorkCalls = 0;
      let callbackCalls = 0;
      const service = api.service.createVocabularyAcquisitionService({
        enabled: true,
        runUnitOfWork: async (...args) => {
          unitOfWorkCalls += 1;
          callbackCalls += typeof args[2] === 'function' ? 1 : 0;
          return null;
        },
      });
      const invalidPayload = testCase.invalidPayload ?? {
        ...basePayload,
        probe: testCase.invalid,
      };
      const validPayload = testCase.validPayload ?? {
        ...basePayload,
        probe: testCase.valid,
      };
      assert.equal(
        JSON.stringify(invalidPayload),
        JSON.stringify(validPayload),
        `${testCase.name} demonstrates the pre-fix JSON-roundtrip collision`,
      );
      await rejectCode(service.queueCandidate({
        command_id: `command-invalid-${testCase.name}`,
        correlation_id: `correlation-invalid-${testCase.name}`,
        event_partition: '2026-07',
        payload: invalidPayload,
      }), 'INVALID_FIELD_TYPE');
      assert.equal(unitOfWorkCalls, 0, `${testCase.name} must fail before UoW`);
      assert.equal(callbackCalls, 0, `${testCase.name} must fail before callback`);
    }
  }
  {
    let unitOfWorkCalls = 0;
    const service = api.service.createVocabularyAcquisitionService({
      enabled: true,
      runUnitOfWork: async () => {
        unitOfWorkCalls += 1;
        return null;
      },
    });
    await rejectCode(service.queueCandidate({
      command_id: 'command-wrong-partition-event',
      correlation_id: 'correlation-wrong-partition-event',
      event_partition: '2026-08',
      payload: {
        learning_unit: candidateUnit('wrong-partition-event'),
        event_id: 'event-wrong-partition-event',
      },
    }), 'INVALID_EVENT_PARTITION');
    assert.equal(unitOfWorkCalls, 0, 'event command partition fails before UoW');
  }
  const queueAndSelect = async (service, suffix, {
    wordId = `word-${suffix}`,
    gloss = `gloss-${suffix}`,
  } = {}) => {
    await service.queueCandidate(command({
      learning_unit: candidateUnit(suffix, wordId),
      event_id: `event-${suffix}-candidate`,
    }, `queue-${suffix}`));
    await service.selectTargetSense(command({
      learning_unit_id: `unit-${suffix}`,
      target_sense_id: `sense-${suffix}`,
      target_sense: targetSense(gloss),
      occurred_at: '2026-07-20T08:00:10.000Z',
      event_id: `event-${suffix}-sense`,
    }, `sense-${suffix}`));
  };
  const prepareReadyUnit = async (service, suffix, attemptOverrides = {}) => {
    await queueAndSelect(service, suffix);
    await service.introduceCandidate(command({
      learning_unit_id: `unit-${suffix}`,
      episode_id: `episode-${suffix}-intro`,
      occurred_at: '2026-07-20T08:00:00.000Z',
    }, `introduce-${suffix}`));
    const evidence = contextEvidence(suffix, `unit-${suffix}`);
    await service.attachContextEvidence(command({
      context_evidence: evidence,
      occurred_at: '2026-07-20T08:02:00.000Z',
      event_id: `event-${suffix}-context`,
    }, `context-${suffix}`));
    const attemptCommand = command({
      event_id: `event-${suffix}-attempt`,
      attempt: {
        schema_version: 'acquisition-attempt.v1',
        attempt_id: `attempt-${suffix}`,
        learning_unit_id: `unit-${suffix}`,
        target_sense_id: `sense-${suffix}`,
        attempt_kind: 'delayed_check',
        episode_id: `episode-${suffix}-check`,
        session_id: null,
        session_position: null,
        occurred_at: '2026-07-21T08:00:00.000Z',
        prompt_mode: 'original_context',
        cue_level: 'target_sentence',
        rating: 'good',
        answer_revealed_before_rating: false,
        context_evidence_id: evidence.context_evidence_id,
        duration_ms: 12000,
        active_duration_ms: 9000,
        extensions: {},
        ...attemptOverrides,
      },
    }, `attempt-${suffix}`);
    const attemptResult = await service.recordAcquisitionAttempt(attemptCommand);
    await service.markReadyForCheck(command({
      learning_unit_id: `unit-${suffix}`,
      occurred_at: '2026-07-21T08:00:01.000Z',
    }, `ready-${suffix}`));
    return { attemptCommand, attemptResult, evidence };
  };
  const graduationCommand = (suffix, overrides = {}) => command({
    learning_unit_id: `unit-${suffix}`,
    attempt_id: `attempt-${suffix}`,
    review_state_id: `review-${suffix}`,
    event_id: `event-${suffix}-graduated`,
    graduated_at: '2026-07-21T08:00:02.000Z',
    scheduler_version: 'fsrs.v1',
    scheduler_parameters_version: 'fsrs-parameters.v1',
    ...overrides,
  }, `graduate-${suffix}`);

  {
    let nowCalls = 0;
    const { runner, service } = createHarness({
      serviceNow: () => {
        nowCalls += 1;
        return fixedNow;
      },
    });
    const prepared = await prepareReadyUnit(service, 'success');
    assert.equal(prepared.attemptResult.graduation_eligibility.eligible, true);
    assert.equal(prepared.attemptResult.graduation_eligibility.elapsed_ms, 86400000);
    assert.equal(
      prepared.attemptResult.graduation_eligibility.evaluated_at,
      fixedNow,
      'evaluator uses explicit injected now once',
    );
    const graduate = graduationCommand('success');
    const result = await service.graduateLearningUnit(graduate);
    assert.equal(nowCalls, 7, 'each command calls its memoized UoW clock exactly once');
    assert.deepEqual(result, {
      schema_version: 'graduation-result.v1',
      learning_unit_id: 'unit-success',
      review_state_id: 'review-success',
      event_id: 'event-success-graduated',
    });
    const snapshotAfterGraduation = runner.snapshot();
    const reviewRow = snapshotAfterGraduation.find((row) => row.id === 'vocabulary.review.store.v2');
    assert.deepEqual(Object.keys(reviewRow.content.by_learning_unit_id), ['unit-success']);
    assert.equal(reviewRow.content.by_learning_unit_id['unit-success'].state, 'new');
    const receiptId = `vocabulary.learning-command-receipt.v1:${graduate.command_id}`;
    const receiptRow = snapshotAfterGraduation.find((row) => row.id === receiptId);
    assert.deepEqual(Object.keys(receiptRow).sort(), ['content', 'id', 'timestamp']);
    assert.equal(
      receiptRow.content.result_sha256,
      api.uow.sha256Utf8(api.uow.canonicalJson(receiptRow.content.result)),
    );
    assert.deepEqual(receiptRow.content.event_ids, ['event-success-graduated']);
    assert.deepEqual(
      receiptRow.content.touched_row_ids,
      [...new Set(receiptRow.content.touched_row_ids)].sort(),
    );
    assert.equal(
      receiptRow.content.touched_row_ids.includes('vocabulary.context-evidence.store.v1'),
      true,
      'graduation re-reads the anchor in the same transaction',
    );

    result.learning_unit_id = 'consumer-mutation';
    const refreshedService = api.service.createVocabularyAcquisitionService({
      enabled: true,
      now: () => '2030-01-01T00:00:00.000Z',
      runUnitOfWork: runner.run,
    });
    const retry = await refreshedService.graduateLearningUnit(graduate);
    assert.equal(retry.learning_unit_id, 'unit-success');
    assert.deepEqual(runner.snapshot(), snapshotAfterGraduation);

    const conflictSnapshot = runner.snapshot();
    await rejectCode(refreshedService.graduateLearningUnit({
      ...graduate,
      payload: { ...graduate.payload, review_state_id: 'review-conflict' },
    }), 'IDEMPOTENCY_CONFLICT');
    assert.deepEqual(runner.snapshot(), conflictSnapshot);
    await rejectCode(
      service.markReadyForCheck(command({
        learning_unit_id: 'unit-success',
        occurred_at: fixedNow,
      }, 'illegal-after-graduation')),
      'INVALID_STATE_TRANSITION',
    );

    const disabled = api.service.createVocabularyAcquisitionService({
      enabled: false,
      runUnitOfWork: runner.run,
    });
    const beforeDisabledWrite = runner.snapshot();
    await rejectCode(disabled.queueCandidate(command({
      learning_unit: candidateUnit('disabled-after-data'),
      event_id: 'event-disabled-after-data',
    }, 'disabled-after-data')), 'INVALID_STATE_TRANSITION');
    assert.deepEqual(runner.snapshot(), beforeDisabledWrite);
  }

  {
    const { service } = createHarness();
    await queueAndSelect(service, 'jump');
    await rejectCode(service.markReadyForCheck(command({
      learning_unit_id: 'unit-jump',
      occurred_at: fixedNow,
    }, 'jump')), 'INVALID_STATE_TRANSITION');
    await service.skipLearningUnit(command({
      learning_unit_id: 'unit-jump',
      occurred_at: fixedNow,
    }, 'skip'));
    await rejectCode(service.introduceCandidate(command({
      learning_unit_id: 'unit-jump',
      episode_id: 'episode-after-skip',
      occurred_at: fixedNow,
    }, 'after-skip')), 'INVALID_STATE_TRANSITION');
  }

  {
    const { runner, service } = createHarness();
    await queueAndSelect(service, 'partition-introduce');
    const beforeIntroduce = runner.snapshot();
    await rejectCode(service.introduceCandidate({
      ...command({
        learning_unit_id: 'unit-partition-introduce',
        episode_id: 'episode-partition-introduce',
        occurred_at: '2026-07-20T08:00:00.000Z',
      }, 'partition-introduce'),
      event_partition: '2026-08',
    }), 'INVALID_EVENT_PARTITION');
    assert.deepEqual(runner.snapshot(), beforeIntroduce);

    await service.introduceCandidate(command({
      learning_unit_id: 'unit-partition-introduce',
      episode_id: 'episode-partition-introduce',
      occurred_at: '2026-07-20T08:00:00.000Z',
    }, 'partition-introduce-valid'));
    const evidence = contextEvidence(
      'partition-introduce',
      'unit-partition-introduce',
    );
    await service.attachContextEvidence(command({
      context_evidence: evidence,
      occurred_at: '2026-07-20T08:02:00.000Z',
      event_id: 'event-partition-introduce-context',
    }, 'partition-introduce-context'));
    const beforeReady = runner.snapshot();
    await rejectCode(service.markReadyForCheck({
      ...command({
        learning_unit_id: 'unit-partition-introduce',
        occurred_at: '2026-07-21T08:00:01.000Z',
      }, 'partition-ready'),
      event_partition: '2026-08',
    }), 'INVALID_EVENT_PARTITION');
    assert.deepEqual(runner.snapshot(), beforeReady);
  }

  {
    const { runner, service } = createHarness();
    await service.queueCandidate(command({
      learning_unit: candidateUnit('partition-skip'),
      event_id: 'event-partition-skip-candidate',
    }, 'partition-skip-candidate'));
    const beforeSkip = runner.snapshot();
    await rejectCode(service.skipLearningUnit({
      ...command({
        learning_unit_id: 'unit-partition-skip',
        occurred_at: '2026-07-20T09:00:00.000Z',
      }, 'partition-skip'),
      event_partition: '2026-08',
    }), 'INVALID_EVENT_PARTITION');
    assert.deepEqual(runner.snapshot(), beforeSkip);
  }

  {
    const { service } = createHarness();
    await queueAndSelect(service, 'sense-a', { wordId: 'word-polysemy', gloss: 'sense one' });
    await queueAndSelect(service, 'sense-b', { wordId: 'word-polysemy', gloss: 'sense two' });
    await service.queueCandidate(command({
      learning_unit: candidateUnit('sense-duplicate', 'word-polysemy'),
      event_id: 'event-sense-duplicate-candidate',
    }, 'queue-sense-duplicate'));
    await rejectCode(service.selectTargetSense(command({
      learning_unit_id: 'unit-sense-duplicate',
      target_sense_id: 'sense-sense-duplicate',
      target_sense: targetSense('sense one'),
      occurred_at: fixedNow,
      event_id: 'event-sense-duplicate',
    }, 'sense-duplicate')), 'DUPLICATE_TARGET_SENSE');
  }

  const ineligibleCases = [
    {
      suffix: 'too-soon',
      overrides: { occurred_at: '2026-07-21T07:59:59.999Z' },
      reason: 'MINIMUM_DELAY_NOT_REACHED',
      error: 'DELAY_POLICY_NOT_SATISFIED',
    },
    {
      suffix: 'same-episode',
      overrides: { episode_id: 'episode-same-episode-intro' },
      reason: 'SAME_ACQUISITION_EPISODE',
      error: 'DELAY_POLICY_NOT_SATISFIED',
    },
    {
      suffix: 'revealed',
      overrides: { answer_revealed_before_rating: true },
      reason: 'ANSWER_REVEALED_BEFORE_RATING',
      error: 'ANSWER_REVEALED',
    },
    {
      suffix: 'again',
      overrides: { rating: 'again' },
      reason: 'RATING_AGAIN',
      error: 'RATING_NOT_ELIGIBLE',
    },
  ];
  for (const testCase of ineligibleCases) {
    const { runner, service } = createHarness();
    const prepared = await prepareReadyUnit(service, testCase.suffix, testCase.overrides);
    assert.equal(prepared.attemptResult.graduation_eligibility.eligible, false);
    assert.equal(
      prepared.attemptResult.graduation_eligibility.reason_codes.includes(testCase.reason),
      true,
    );
    const before = runner.snapshot();
    await rejectCode(
      service.graduateLearningUnit(graduationCommand(testCase.suffix)),
      testCase.error,
    );
    assert.deepEqual(runner.snapshot(), before);
  }

  for (const attemptKind of ['exposure', 'reassessment']) {
    const { runner, service } = createHarness();
    const prepared = await prepareReadyUnit(service, `${attemptKind}-good`, {
      attempt_kind: attemptKind,
      rating: 'good',
    });
    assert.equal(prepared.attemptResult.graduation_eligibility, null);
    assert.equal(prepared.attemptResult.event_id, null);
    const before = runner.snapshot();
    await rejectCode(
      service.graduateLearningUnit(graduationCommand(`${attemptKind}-good`)),
      'RATING_NOT_ELIGIBLE',
    );
    assert.deepEqual(runner.snapshot(), before);
  }

  {
    const { runner, service } = createHarness();
    await queueAndSelect(service, 'no-anchor');
    await service.introduceCandidate(command({
      learning_unit_id: 'unit-no-anchor',
      episode_id: 'episode-no-anchor-intro',
      occurred_at: '2026-07-20T08:00:00.000Z',
    }, 'introduce-no-anchor'));
    const pending = contextEvidence('no-anchor', 'unit-no-anchor', 'pending');
    await service.attachContextEvidence(command({
      context_evidence: pending,
      occurred_at: '2026-07-20T08:02:00.000Z',
      event_id: 'event-no-anchor-context',
    }, 'context-no-anchor'));
    const attempt = await service.recordAcquisitionAttempt(command({
      event_id: 'event-no-anchor-attempt',
      attempt: {
        schema_version: 'acquisition-attempt.v1',
        attempt_id: 'attempt-no-anchor',
        learning_unit_id: 'unit-no-anchor',
        target_sense_id: 'sense-no-anchor',
        attempt_kind: 'delayed_check',
        episode_id: 'episode-no-anchor-check',
        session_id: null,
        session_position: null,
        occurred_at: '2026-07-21T08:00:00.000Z',
        prompt_mode: 'original_context',
        cue_level: 'target_sentence',
        rating: 'good',
        answer_revealed_before_rating: false,
        context_evidence_id: pending.context_evidence_id,
        duration_ms: 1000,
        active_duration_ms: 1000,
        extensions: {},
      },
    }, 'attempt-no-anchor'));
    assert.equal(
      attempt.graduation_eligibility.reason_codes.includes('VALIDATED_ANCHOR_MISSING'),
      true,
    );
    await service.markReadyForCheck(command({
      learning_unit_id: 'unit-no-anchor',
      occurred_at: fixedNow,
    }, 'ready-no-anchor'));
    const before = runner.snapshot();
    await rejectCode(
      service.graduateLearningUnit(graduationCommand('no-anchor')),
      'NO_VALIDATED_ANCHOR',
    );
    assert.deepEqual(runner.snapshot(), before);
  }

  {
    const { runner, service } = createHarness();
    const prepared = await prepareReadyUnit(service, 'attempt-retry');
    const beforeRetry = runner.snapshot();
    const refreshed = api.service.createVocabularyAcquisitionService({
      enabled: true,
      now: () => '2031-01-01T00:00:00.000Z',
      runUnitOfWork: runner.run,
    });
    const retry = await refreshed.recordAcquisitionAttempt(prepared.attemptCommand);
    assert.deepEqual(retry, prepared.attemptResult);
    assert.deepEqual(runner.snapshot(), beforeRetry);
    await rejectCode(refreshed.recordAcquisitionAttempt({
      ...prepared.attemptCommand,
      payload: {
        ...prepared.attemptCommand.payload,
        attempt: {
          ...prepared.attemptCommand.payload.attempt,
          rating: 'hard',
        },
      },
    }), 'IDEMPOTENCY_CONFLICT');
    assert.deepEqual(runner.snapshot(), beforeRetry);
  }

  const injectedTargets = [
    { name: 'anchor-read', get: 'vocabulary.context-evidence.store.v1' },
    { name: 'review-write', put: 'vocabulary.review.store.v2' },
    { name: 'acquisition-write', put: 'vocabulary.acquisition.store.v1' },
    { name: 'event-shard-write', put: 'vocabulary.learning-events.v1.2026-07.0001' },
    { name: 'event-manifest-write', put: 'vocabulary.learning-events.manifest.v1' },
    { name: 'receipt-write', putPrefix: 'vocabulary.learning-command-receipt.v1:' },
  ];
  for (const target of injectedTargets) {
    const controller = { armed: false };
    const { runner, service } = createHarness({
      failGet: ({ row_id: rowId, command: activeCommand }) => (
        controller.armed
        && activeCommand.command_type === 'graduate_learning_unit'
        && target.get === rowId
      ),
      failPut: ({ row, command: activeCommand }) => (
        controller.armed
        && activeCommand.command_type === 'graduate_learning_unit'
        && (
          target.put === row.id
          || (target.putPrefix && row.id.startsWith(target.putPrefix))
        )
      ),
    });
    await prepareReadyUnit(service, `failure-${target.name}`);
    const before = runner.snapshot();
    controller.armed = true;
    await rejectCode(
      service.graduateLearningUnit(graduationCommand(`failure-${target.name}`)),
      'TRANSACTION_ABORTED',
    );
    assert.deepEqual(runner.snapshot(), before, `${target.name} must be all-or-nothing`);
  }

  {
    let indexedDbAccessed = false;
    const runner = api.uow.createInMemoryVocabularyLearningUnitOfWorkRunner();
    const disabled = api.service.createVocabularyAcquisitionService({
      runUnitOfWork: (...args) => {
        indexedDbAccessed = true;
        return runner.run(...args);
      },
    });
    const before = runner.snapshot();
    await rejectCode(disabled.queueCandidate(command({
      learning_unit: candidateUnit('flag-off'),
      event_id: 'event-flag-off',
    }, 'flag-off')), 'INVALID_STATE_TRANSITION');
    assert.equal(indexedDbAccessed, false);
    assert.deepEqual(runner.snapshot(), before);
  }

  const uowSource = fs.readFileSync(
    path.join(repoRoot, 'src', 'services', 'vocabulary', 'vocabulary-learning-uow.js'),
    'utf8',
  );
  assert.match(uowSource, /indexedDBApi\.open\('SeekPlayerDB', 1\)/);
  assert.doesNotMatch(uowSource, /createObjectStore\s*\(/);
  assert.doesNotMatch(uowSource, /vocabulary\.srs\.store\.v1/);
  console.log('Vocabulary acquisition service verification passed.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
