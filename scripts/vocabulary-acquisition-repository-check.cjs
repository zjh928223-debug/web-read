const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

async function importP1Modules(repoRoot) {
  const sourceDir = path.join(repoRoot, 'src', 'services', 'vocabulary');
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'read-web-p1-acquisition-'));
  try {
    const modelsSource = fs.readFileSync(path.join(sourceDir, 'vocabulary-learning-models.js'), 'utf8');
    const repositorySource = fs.readFileSync(
      path.join(sourceDir, 'vocabulary-acquisition-repository.js'),
      'utf8',
    ).replace("from './vocabulary-learning-models.js'", "from './vocabulary-learning-models.mjs'");
    fs.writeFileSync(path.join(tempDir, 'vocabulary-learning-models.mjs'), modelsSource);
    fs.writeFileSync(path.join(tempDir, 'vocabulary-acquisition-repository.mjs'), repositorySource);
    const models = await import(`${pathToFileURL(path.join(tempDir, 'vocabulary-learning-models.mjs')).href}?v=1`);
    const repository = await import(
      `${pathToFileURL(path.join(tempDir, 'vocabulary-acquisition-repository.mjs')).href}?v=1`,
    );
    return { models, repository };
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function expectContractError(error, code) {
  assert.equal(error?.code, code);
  assert.equal(typeof error?.message, 'string');
  assert.equal(typeof error?.details, 'object');
  return true;
}

function targetSense(gloss, partOfSpeech = 'noun') {
  return {
    gloss,
    normalized_gloss: gloss,
    part_of_speech: partOfSpeech,
    definition: null,
    language: 'en',
  };
}

function learningUnit(models, overrides = {}) {
  const sense = overrides.target_sense === undefined ? targetSense('a fee') : overrides.target_sense;
  const targetSenseId = sense === null ? null : (overrides.target_sense_id || 'sense-charge-fee');
  return models.normalizeLearningUnit({
    learning_unit_id: 'unit-charge-fee',
    word_id: 'word-charge',
    normalized_form: 'charge',
    language: 'en',
    target_sense_id: targetSenseId,
    target_sense: sense,
    created_at: '2026-07-01T00:00:00.000Z',
    updated_at: '2026-07-01T00:00:00.000Z',
    ...overrides,
  });
}

function introducedState(models, overrides = {}) {
  return models.normalizeAcquisitionState({
    learning_unit_id: 'unit-charge-fee',
    status: 'introduced',
    context_evidence_ids: ['context-charge-fee'],
    validated_anchor_id: 'context-charge-fee',
    introduction_episode_id: 'episode-intro',
    introduced_at: '2026-07-01T00:00:00.000Z',
    ...overrides,
  });
}

function delayedAttempt(models, eligibility, overrides = {}) {
  return models.normalizeAcquisitionAttempt({
    attempt_id: 'attempt-charge-fee',
    command_id: 'command-charge-fee',
    correlation_id: 'correlation-charge-fee',
    learning_unit_id: 'unit-charge-fee',
    target_sense_id: 'sense-charge-fee',
    attempt_kind: 'delayed_check',
    episode_id: 'episode-check',
    session_id: null,
    session_position: null,
    occurred_at: '2026-07-02T00:00:00.000Z',
    recorded_at: '2026-07-02T00:00:01.000Z',
    prompt_mode: 'original_context',
    cue_level: 'target_sentence',
    rating: 'good',
    answer_revealed_before_rating: false,
    context_evidence_id: 'context-charge-fee',
    duration_ms: 20_000,
    active_duration_ms: 18_000,
    graduation_eligibility: eligibility,
    ...overrides,
  });
}

function createFakeIndexedDb(options = {}) {
  const rows = new Map();
  const openCalls = [];
  const transactionModes = [];

  function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  }

  function makeTransaction(mode) {
    transactionModes.push(mode);
    let pending = 0;
    let completionScheduled = false;
    let aborted = false;
    const transaction = {
      error: null,
      oncomplete: null,
      onabort: null,
      onerror: null,
      abort() {
        if (aborted) return;
        aborted = true;
        queueMicrotask(() => transaction.onabort?.());
      },
      objectStore(name) {
        assert.equal(name, 'files');
        return {
          keyPath: 'id',
          get(id) {
            return makeRequest(() => {
              if (options.failGet) throw new Error('sensitive-request-diagnostic');
              return clone(rows.get(id));
            });
          },
          put(row) {
            assert.equal(mode, 'readwrite');
            return makeRequest(() => {
              rows.set(row.id, clone(row));
              return row.id;
            });
          },
        };
      },
    };

    function scheduleCompletion() {
      if (completionScheduled || pending !== 0 || aborted) return;
      completionScheduled = true;
      setTimeout(() => {
        if (!aborted) transaction.oncomplete?.();
      }, 0);
    }

    function makeRequest(operation) {
      pending += 1;
      const request = { result: undefined, error: null, onsuccess: null, onerror: null };
      queueMicrotask(() => {
        if (aborted) return;
        try {
          request.result = operation();
          request.onsuccess?.();
        } catch (error) {
          request.error = error;
          request.onerror?.();
        } finally {
          pending -= 1;
          scheduleCompletion();
        }
      });
      return request;
    }

    return transaction;
  }

  const database = {
    objectStoreNames: {
      contains(name) {
        return name === 'files';
      },
    },
    transaction(storeNames, mode) {
      assert.deepEqual(storeNames, ['files']);
      return makeTransaction(mode);
    },
    close() {},
  };
  return {
    rows,
    openCalls,
    transactionModes,
    indexedDBApi: {
      open(name, version) {
        openCalls.push([name, version]);
        const request = {
          result: database,
          error: null,
          transaction: null,
          onsuccess: null,
          onerror: null,
          onupgradeneeded: null,
        };
        queueMicrotask(() => request.onsuccess?.());
        return request;
      },
    },
  };
}

async function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const { models, repository } = await importP1Modules(repoRoot);

  assert.deepEqual(Object.values(models.ACQUISITION_STATUSES), [
    'candidate',
    'introduced',
    'acquiring',
    'ready_for_check',
    'graduated',
    'skipped',
  ]);

  const unit = learningUnit(models);
  assert.equal(unit.schema_version, 'learning-unit.v1');
  assert.equal(unit.revision, 0);
  assert.deepEqual(unit.extensions, {});
  assert.equal(
    unit.target_sense_key,
    ['en', 'noun', 'a fee'].join('\u001f'),
    'target-sense-key.v1 must use language, part of speech, and normalized gloss',
  );
  models.assertLearningUnit(unit);
  assert.throws(
    () => models.normalizeLearningUnit({ ...unit, legacyStatus: 'new' }),
    (error) => expectContractError(error, 'INVALID_FIELD_TYPE'),
  );
  assert.throws(
    () => models.assertLearningUnit({ ...unit, extensions: undefined }),
    (error) => expectContractError(error, 'MISSING_REQUIRED_FIELD'),
  );
  assert.throws(
    () => models.normalizeLearningUnit({ ...unit, schema_version: 'learning-unit.v0' }),
    (error) => expectContractError(error, 'UNSUPPORTED_SCHEMA_VERSION'),
  );

  const state = introducedState(models);
  const anchor = {
    context_evidence_id: 'context-charge-fee',
    learning_unit_id: unit.learning_unit_id,
    quality_status: 'validated',
  };
  const eligibilityInput = {
    learning_unit: unit,
    acquisition_state: state,
    validated_anchor: anchor,
    attempt: {
      attempt_id: 'attempt-charge-fee',
      learning_unit_id: unit.learning_unit_id,
      target_sense_id: unit.target_sense_id,
      episode_id: 'episode-check',
      occurred_at: '2026-07-02T00:00:00.000Z',
      rating: 'good',
      answer_revealed_before_rating: false,
      context_evidence_id: anchor.context_evidence_id,
    },
    evaluated_at: '2026-07-02T00:00:01.000Z',
  };
  const eligible = models.evaluateGraduationEligibility(eligibilityInput);
  assert.equal(eligible.eligible, true);
  assert.equal(eligible.delayed_from_introduction, true);
  assert.equal(eligible.elapsed_ms, 86_400_000);
  assert.deepEqual(eligible.reason_codes, []);

  const missingIntroductionEpisodeState = models.normalizeAcquisitionState({
    learning_unit_id: unit.learning_unit_id,
    status: 'candidate',
    context_evidence_ids: [anchor.context_evidence_id],
    validated_anchor_id: anchor.context_evidence_id,
    introduction_episode_id: null,
    introduced_at: '2026-07-01T00:00:00.000Z',
  });
  const missingIntroductionEpisode = models.evaluateGraduationEligibility({
    ...eligibilityInput,
    acquisition_state: missingIntroductionEpisodeState,
  });
  assert.equal(missingIntroductionEpisode.eligible, false);
  assert.equal(missingIntroductionEpisode.delayed_from_introduction, false);
  assert.deepEqual(missingIntroductionEpisode.reason_codes, ['INTRODUCTION_EPISODE_MISSING']);
  const missingEpisodeAttempt = delayedAttempt(models, missingIntroductionEpisode, {
    attempt_id: 'attempt-missing-introduction-episode',
  });
  models.assertAcquisitionAttempt(missingEpisodeAttempt);
  assert.deepEqual(
    models.normalizeAcquisitionAttempt(missingEpisodeAttempt),
    missingEpisodeAttempt,
    'evaluator output must round-trip through AcquisitionAttempt normalization',
  );

  const tooSoon = models.evaluateGraduationEligibility({
    ...eligibilityInput,
    attempt: {
      ...eligibilityInput.attempt,
      occurred_at: '2026-07-01T23:59:59.999Z',
    },
  });
  assert.equal(tooSoon.eligible, false);
  assert.equal(tooSoon.delayed_from_introduction, false);
  assert.deepEqual(tooSoon.reason_codes, ['MINIMUM_DELAY_NOT_REACHED']);

  const sameEpisode = models.evaluateGraduationEligibility({
    ...eligibilityInput,
    attempt: { ...eligibilityInput.attempt, episode_id: 'episode-intro' },
  });
  assert.equal(sameEpisode.eligible, false);
  assert.deepEqual(sameEpisode.reason_codes, ['SAME_ACQUISITION_EPISODE']);

  const revealedAgain = models.evaluateGraduationEligibility({
    ...eligibilityInput,
    attempt: {
      ...eligibilityInput.attempt,
      answer_revealed_before_rating: true,
      rating: 'again',
    },
  });
  assert.deepEqual(revealedAgain.reason_codes, [
    'ANSWER_REVEALED_BEFORE_RATING',
    'RATING_AGAIN',
  ]);

  const memory = repository.createInMemoryAcquisitionRepository();
  const created = await memory.putLearningUnit(unit, null);
  assert.equal(created.revision, 0);
  const candidateState = await memory.getState(unit.learning_unit_id);
  assert.equal(candidateState.status, 'candidate');
  const candidateSnapshot = await memory.loadSnapshot();
  assert.equal(candidateSnapshot.schema_version, 'acquisition-store.v1');
  assert.equal(Object.prototype.hasOwnProperty.call(candidateSnapshot, 'reviewStates'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(candidateSnapshot, 'review_states'), false);
  const clonedRepository = repository.createInMemoryAcquisitionRepository({
    store: candidateSnapshot,
  });
  candidateSnapshot.by_learning_unit_id[unit.learning_unit_id].learning_unit.normalized_form = 'mutated';
  assert.equal(
    (await clonedRepository.getLearningUnit(unit.learning_unit_id)).normalized_form,
    'charge',
    'repository seeds and reads must be deep-cloned',
  );
  assert.throws(
    () => repository.createInMemoryAcquisitionRepository({
      store: {
        schemaVersion: 1,
        by_learning_unit_id: {},
        acquisition_attempts_by_id: {},
      },
    }),
    (error) => expectContractError(error, 'INVALID_FIELD_TYPE'),
  );
  assert.throws(
    () => repository.createInMemoryAcquisitionRepository({
      store: {
        schema_version: 'acquisition-store.v1',
        by_learning_unit_id: {
          'wrong-map-key': {
            learning_unit: unit,
            acquisition_state: models.normalizeAcquisitionState({
              learning_unit_id: unit.learning_unit_id,
              status: 'candidate',
            }),
          },
        },
        acquisition_attempts_by_id: {},
      },
    }),
    (error) => expectContractError(error, 'INVALID_CONTEXT_REFERENCE'),
  );
  assert.throws(
    () => models.normalizeAcquisitionState({
      learning_unit_id: unit.learning_unit_id,
      status: 'candidate',
      context_evidence_ids: [],
      validated_anchor_id: 'missing-context',
    }),
    (error) => expectContractError(error, 'INVALID_CONTEXT_REFERENCE'),
  );

  const differentSense = learningUnit(models, {
    learning_unit_id: 'unit-charge-accuse',
    target_sense_id: 'sense-charge-accuse',
    target_sense: targetSense('accuse formally', 'verb'),
  });
  await memory.putLearningUnit(differentSense, null);
  assert.equal(
    (await memory.findActiveByWordAndSense(differentSense.word_id, differentSense.target_sense_key))
      .learning_unit_id,
    differentSense.learning_unit_id,
  );

  const duplicateSense = learningUnit(models, {
    learning_unit_id: 'unit-charge-fee-duplicate',
  });
  await assert.rejects(
    () => memory.putLearningUnit(duplicateSense, null),
    (error) => expectContractError(error, 'DUPLICATE_TARGET_SENSE'),
  );

  const updatedUnit = {
    ...created,
    updated_at: '2026-07-01T00:01:00.000Z',
    extensions: { source: 'exam-candidate' },
  };
  const updated = await memory.putLearningUnit(updatedUnit, 0);
  assert.equal(updated.revision, 1);
  assert.deepEqual(await memory.putLearningUnit(updatedUnit, 0), updated, 'a retried update must be idempotent');
  await assert.rejects(
    () => memory.putLearningUnit({
      ...updated,
      updated_at: '2026-07-01T00:02:00.000Z',
    }, 0),
    (error) => expectContractError(error, 'CONCURRENT_MODIFICATION'),
  );
  const concurrentResults = await Promise.allSettled([
    memory.putLearningUnit({
      ...updated,
      updated_at: '2026-07-01T00:03:00.000Z',
      extensions: { writer: 'a' },
    }, 1),
    memory.putLearningUnit({
      ...updated,
      updated_at: '2026-07-01T00:04:00.000Z',
      extensions: { writer: 'b' },
    }, 1),
  ]);
  assert.equal(concurrentResults.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(concurrentResults.filter((result) => result.status === 'rejected').length, 1);
  expectContractError(
    concurrentResults.find((result) => result.status === 'rejected').reason,
    'CONCURRENT_MODIFICATION',
  );

  const introduced = await memory.putState(state, 0);
  assert.equal(introduced.status, 'introduced');
  assert.equal(introduced.revision, 1);
  await assert.rejects(
    () => memory.putState(models.normalizeAcquisitionState({
      ...introduced,
      status: 'graduated',
      graduated_at: '2026-07-02T00:00:00.000Z',
    }), 1),
    (error) => expectContractError(error, 'INVALID_STATE_TRANSITION'),
  );

  const attempt = delayedAttempt(models, eligible);
  assert.throws(
    () => delayedAttempt(models, { ...eligible, attempt_episode_id: 'tampered-episode' }),
    (error) => expectContractError(error, 'INVALID_CONTEXT_REFERENCE'),
  );
  assert.deepEqual(await memory.putAttempt(attempt), attempt);
  assert.deepEqual(await memory.putAttempt(attempt), attempt);
  await assert.rejects(
    () => memory.putAttempt({ ...attempt, duration_ms: 21_000 }),
    (error) => expectContractError(error, 'IDEMPOTENCY_CONFLICT'),
  );

  const rowMap = new Map();
  let rowPortWrites = 0;
  const bound = repository.bindAcquisitionRepositoryToTransaction({
    transaction_id: 'test-transaction',
    async getRow(rowId) {
      return rowMap.get(rowId) || null;
    },
    async putRow(row) {
      rowPortWrites += 1;
      rowMap.set(row.id, JSON.parse(JSON.stringify(row)));
    },
    abort(error) {
      throw error;
    },
  });
  assert.equal(Object.prototype.hasOwnProperty.call(bound, 'loadSnapshot'), false);
  await bound.putLearningUnit(learningUnit(models, {
    learning_unit_id: 'unit-bound',
    word_id: 'word-bound',
    target_sense_id: null,
    target_sense: null,
  }), null);
  assert.equal(rowPortWrites, 1);
  assert.equal((await bound.getState('unit-bound')).status, 'candidate');
  assert.equal(rowMap.has('vocabulary.acquisition.store.v1'), true);

  assert.throws(
    () => repository.createIndexedDbAcquisitionRepository({ dbName: 'unsafe' }),
    (error) => expectContractError(error, 'INVALID_FIELD_TYPE'),
  );
  const openFailureRepository = repository.createIndexedDbAcquisitionRepository({
    indexedDBApi: {
      open() {
        const request = {
          result: null,
          error: null,
          transaction: null,
          onsuccess: null,
          onerror: null,
          onupgradeneeded: null,
        };
        queueMicrotask(() => {
          request.error = new Error('sensitive-open-diagnostic');
          request.onerror?.();
        });
        return request;
      },
    },
  });
  await assert.rejects(
    () => openFailureRepository.loadSnapshot(),
    (error) => {
      expectContractError(error, 'TRANSACTION_ABORTED');
      assert.deepEqual(error.details, { operation: 'open_database' });
      assert.equal(JSON.stringify({
        message: error.message,
        details: error.details,
      }).includes('sensitive-open-diagnostic'), false);
      return true;
    },
  );

  const requestFailureFake = createFakeIndexedDb({ failGet: true });
  const requestFailureRepository = repository.createIndexedDbAcquisitionRepository({
    indexedDBApi: requestFailureFake.indexedDBApi,
  });
  await assert.rejects(
    () => requestFailureRepository.loadSnapshot(),
    (error) => {
      expectContractError(error, 'TRANSACTION_ABORTED');
      assert.deepEqual(error.details, { operation: 'read_acquisition_row' });
      assert.equal(JSON.stringify({
        message: error.message,
        details: error.details,
      }).includes('sensitive-request-diagnostic'), false);
      return true;
    },
  );

  const fake = createFakeIndexedDb();
  const indexed = repository.createIndexedDbAcquisitionRepository({
    indexedDBApi: fake.indexedDBApi,
  });
  const indexedUnit = learningUnit(models, {
    learning_unit_id: 'unit-indexed',
    word_id: 'word-indexed',
    target_sense_id: null,
    target_sense: null,
  });
  await indexed.putLearningUnit(indexedUnit, null);
  assert.equal((await indexed.getLearningUnit(indexedUnit.learning_unit_id)).word_id, 'word-indexed');
  assert.deepEqual(fake.openCalls, [['SeekPlayerDB', 1]]);
  assert.deepEqual(fake.transactionModes, ['readwrite', 'readonly']);
  assert.equal(fake.rows.has('vocabulary.acquisition.store.v1'), true);

  console.log('vocabulary acquisition repository check passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
