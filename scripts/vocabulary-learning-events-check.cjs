const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

async function importModule(repoRoot) {
  const sourcePath = path.join(
    repoRoot,
    'src',
    'services',
    'vocabulary',
    'vocabulary-learning-events.js',
  );
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'read-web-learning-events-'));
  const modulePath = path.join(tempDir, 'vocabulary-learning-events.mjs');
  fs.copyFileSync(sourcePath, modulePath);
  try {
    return await import(`${pathToFileURL(modulePath).href}?t=${Date.now()}`);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function createRowPort() {
  const rows = new Map();
  return {
    rows,
    port: {
      transaction_id: 'test-row-port',
      async getRow(rowId) {
        return rows.has(rowId) ? clone(rows.get(rowId)) : null;
      },
      async putRow(row) {
        rows.set(row.id, clone(row));
      },
    },
  };
}

class FakeRequest {
  constructor() {
    this.result = undefined;
    this.error = null;
    this.onsuccess = null;
    this.onerror = null;
    this.onupgradeneeded = null;
  }
}

class FakeTransaction {
  constructor(rows, mode, database) {
    this.rows = rows;
    this.mode = mode;
    this.database = database;
    this.pending = 0;
    this.finished = false;
    this.aborted = false;
    this.error = null;
    this.oncomplete = null;
    this.onerror = null;
    this.onabort = null;
  }

  objectStore(name) {
    assert.equal(name, 'files');
    return new FakeObjectStore(this);
  }

  schedule(operation, request) {
    this.pending += 1;
    queueMicrotask(() => {
      if (this.aborted) return;
      try {
        request.result = operation();
        if (typeof request.onsuccess === 'function') request.onsuccess({ target: request });
      } catch (error) {
        request.error = error;
        this.error = error;
        if (typeof request.onerror === 'function') request.onerror({ target: request });
        if (typeof this.onerror === 'function') this.onerror({ target: this });
      } finally {
        this.pending -= 1;
        this.scheduleCompletion();
      }
    });
  }

  scheduleCompletion() {
    queueMicrotask(() => {
      if (this.finished || this.aborted || this.pending !== 0) return;
      this.finished = true;
      if (typeof this.oncomplete === 'function') this.oncomplete({ target: this });
    });
  }

  abort() {
    if (this.finished) throw new Error('Transaction already finished');
    this.aborted = true;
    this.error ||= new Error('Transaction aborted');
    if (typeof this.onabort === 'function') this.onabort({ target: this });
  }
}

class FakeObjectStore {
  constructor(transaction) {
    this.transaction = transaction;
    this.keyPath = transaction.database.keyPath;
  }

  get(key) {
    this.transaction.database.storeOperationCalls.push({ operation: 'get', key });
    const request = new FakeRequest();
    this.transaction.schedule(
      () => clone(this.transaction.rows.get(key)),
      request,
    );
    return request;
  }

  put(row) {
    this.transaction.database.storeOperationCalls.push({ operation: 'put', key: row.id });
    assert.equal(this.transaction.mode, 'readwrite');
    const request = new FakeRequest();
    this.transaction.schedule(() => {
      this.transaction.rows.set(row.id, clone(row));
      return row.id;
    }, request);
    return request;
  }

  openCursor() {
    this.transaction.database.storeOperationCalls.push({ operation: 'openCursor' });
    const request = new FakeRequest();
    const values = [...this.transaction.rows.values()]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map(clone);
    const transaction = this.transaction;
    let index = 0;
    transaction.pending += 1;
    const emit = () => {
      queueMicrotask(() => {
        if (transaction.aborted) return;
        if (index >= values.length) {
          request.result = null;
          if (typeof request.onsuccess === 'function') request.onsuccess({ target: request });
          transaction.pending -= 1;
          transaction.scheduleCompletion();
          return;
        }
        const value = values[index];
        request.result = {
          value,
          continue() {
            index += 1;
            emit();
          },
        };
        if (typeof request.onsuccess === 'function') request.onsuccess({ target: request });
      });
    };
    emit();
    return request;
  }
}

class FakeDatabase {
  constructor(rows, { hasFilesStore = true, keyPath = 'id' } = {}) {
    this.rows = rows;
    this.hasFilesStore = hasFilesStore;
    this.keyPath = keyPath;
    this.createObjectStoreCalls = [];
    this.storeOperationCalls = [];
    this.closed = false;
    this.objectStoreNames = {
      contains: (name) => name === 'files' && this.hasFilesStore,
    };
  }

  createObjectStore(name, options) {
    this.createObjectStoreCalls.push({ name, options: clone(options) });
    this.hasFilesStore = true;
  }

  transaction(storeNames, mode) {
    assert.deepEqual(storeNames, ['files']);
    if (!this.hasFilesStore) {
      const error = new Error('files object store is missing');
      error.name = 'NotFoundError';
      throw error;
    }
    const transaction = new FakeTransaction(this.rows, mode, this);
    transaction.scheduleCompletion();
    return transaction;
  }

  close() {
    this.closed = true;
  }
}

class FakeIndexedDbFactory {
  constructor({
    triggerUpgrade = false,
    hasFilesStore = true,
    keyPath = 'id',
    openError = null,
  } = {}) {
    this.rows = new Map();
    this.database = new FakeDatabase(this.rows, { hasFilesStore, keyPath });
    this.opens = [];
    this.triggerUpgrade = triggerUpgrade;
    this.openError = openError;
    this.upgradeAbortCalled = false;
  }

  open(name, version) {
    this.opens.push({ name, version });
    const request = new FakeRequest();
    queueMicrotask(() => {
      if (this.openError) {
        request.error = this.openError;
        if (typeof request.onerror === 'function') request.onerror({ target: request });
        return;
      }
      request.result = this.database;
      if (this.triggerUpgrade && typeof request.onupgradeneeded === 'function') {
        const upgradeTransaction = {
          abort: () => {
            this.upgradeAbortCalled = true;
          },
        };
        request.transaction = upgradeTransaction;
        request.onupgradeneeded({
          target: {
            result: this.database,
            transaction: upgradeTransaction,
          },
        });
      }
      if (typeof request.onsuccess === 'function') {
        request.onsuccess({ target: request });
      }
    });
    return request;
  }
}

function expectContractError(error, code) {
  assert.equal(error.code, code);
  assert.equal(typeof error.message, 'string');
  assert.equal(typeof error.details, 'object');
  return true;
}

async function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const api = await importModule(repoRoot);
  const fixture = JSON.parse(fs.readFileSync(
    path.join(__dirname, 'fixtures', 'vocabulary-learning-events.fixture.json'),
    'utf8',
  ));

  assert.deepEqual(api.LEARNING_EVENT_TYPES, [
    'candidate_queued',
    'target_sense_selected',
    'context_attached',
    'context_validated',
    'acquisition_attempt_recorded',
    'acquisition_graduated',
    'article_learning_completed',
    'review_attempt_recorded',
    'legacy_reassessed',
    'policy_changed',
    'event_corrected',
  ]);
  api.assertLearningEvent(fixture.review_attempt);
  api.assertLearningEvent(fixture.candidate_event);
  api.assertLearningEvent(fixture.acquisition_attempt);
  const validAcquisitionAttempt = api.normalizeLearningEvent(
    fixture.acquisition_attempt,
  );
  assert.equal(validAcquisitionAttempt.training_eligible, true);
  assert.deepEqual(validAcquisitionAttempt.exclusion_reasons, []);

  for (const field of ['answer_revealed_before_rating', 'context_evidence_id']) {
    const missingFieldEvent = clone(fixture.acquisition_attempt);
    delete missingFieldEvent[field];
    assert.throws(
      () => api.normalizeLearningEvent(missingFieldEvent),
      (error) => {
        expectContractError(error, 'MISSING_REQUIRED_FIELD');
        assert.equal(error.details.field, field);
        assert.equal(error.details.event_type, 'acquisition_attempt_recorded');
        assert.doesNotMatch(JSON.stringify(error.details), /attempt_kind|delayed_check/);
        return true;
      },
    );

    const nullFieldEvent = clone(fixture.acquisition_attempt);
    nullFieldEvent[field] = null;
    assert.throws(
      () => api.normalizeLearningEvent(nullFieldEvent),
      (error) => {
        expectContractError(error, 'MISSING_REQUIRED_FIELD');
        assert.equal(error.details.field, field);
        assert.equal(error.details.event_type, 'acquisition_attempt_recorded');
        return true;
      },
    );
  }

  api.assertLearningEvent(fixture.acquisition_graduation);
  const validAcquisitionGraduation = api.normalizeLearningEvent(
    fixture.acquisition_graduation,
  );
  assert.equal(validAcquisitionGraduation.training_eligible, false);
  assert.deepEqual(validAcquisitionGraduation.exclusion_reasons, []);
  assert.equal(
    validAcquisitionGraduation.answer_revealed_before_rating,
    fixture.acquisition_attempt.answer_revealed_before_rating,
  );
  assert.equal(
    validAcquisitionGraduation.context_evidence_id,
    fixture.acquisition_attempt.context_evidence_id,
  );
  assert.deepEqual(
    validAcquisitionGraduation.graduation_eligibility,
    fixture.acquisition_attempt.graduation_eligibility,
  );

  for (const field of ['answer_revealed_before_rating', 'context_evidence_id']) {
    const missingFieldEvent = clone(fixture.acquisition_graduation);
    delete missingFieldEvent[field];
    assert.throws(
      () => api.normalizeLearningEvent(missingFieldEvent),
      (error) => {
        expectContractError(error, 'MISSING_REQUIRED_FIELD');
        assert.equal(error.details.field, field);
        assert.equal(error.details.event_type, 'acquisition_graduated');
        assert.doesNotMatch(JSON.stringify(error.details), /attempt_kind|delayed_check/);
        return true;
      },
    );

    const nullFieldEvent = clone(fixture.acquisition_graduation);
    nullFieldEvent[field] = null;
    assert.throws(
      () => api.normalizeLearningEvent(nullFieldEvent),
      (error) => {
        expectContractError(error, 'MISSING_REQUIRED_FIELD');
        assert.equal(error.details.field, field);
        assert.equal(error.details.event_type, 'acquisition_graduated');
        return true;
      },
    );
  }

  const normalizedPartial = api.normalizeLearningEvent({
    event_id: 'event-candidate-partial',
    command_id: 'command-candidate-partial',
    correlation_id: 'correlation-candidate-partial',
    event_type: 'candidate_queued',
    occurred_at: '2026-07-26T08:00:00.000Z',
    recorded_at: '2026-07-26T08:00:00.000Z',
    learning_unit_id: 'unit-2',
    word_id: 'word-2',
  });
  assert.equal(normalizedPartial.schema_version, 'learning-event.v1');
  assert.equal(normalizedPartial.training_eligible, false);
  assert.deepEqual(normalizedPartial.exclusion_reasons, []);
  assert.equal(normalizedPartial.attempt_id, null);

  const qualityFailure = api.normalizeLearningEvent({
    ...fixture.review_attempt,
    event_id: 'event-review-quality-failure',
    is_legacy: true,
    policy_version: null,
    prompt_mode: null,
    cue_level: null,
    active_duration_ms: 0,
    answer_revealed_before_rating: true,
    payload: {
      duplicate_submission: true,
      imported_event: true,
      active_duration_reliable: false,
    },
  });
  assert.equal(qualityFailure.training_eligible, false);
  assert.deepEqual(qualityFailure.exclusion_reasons, [
    'LEGACY_EVENT',
    'DUPLICATE_SUBMISSION',
    'IMPORTED_EVENT',
    'PROMPT_MODE_MISSING',
    'CUE_LEVEL_MISSING',
    'POLICY_VERSION_MISSING',
    'ACTIVE_DURATION_UNRELIABLE',
    'ANSWER_REVEALED_BEFORE_RATING',
  ]);
  assert.equal(api.TRAINING_ACTIVE_DURATION_MAX_MS, 30 * 60 * 1000);
  const durationAtTrainingLimit = api.normalizeLearningEvent({
    ...fixture.review_attempt,
    event_id: 'event-duration-at-limit',
    command_id: 'command-duration-at-limit',
    correlation_id: 'correlation-duration-at-limit',
    duration_ms: api.TRAINING_ACTIVE_DURATION_MAX_MS,
    active_duration_ms: api.TRAINING_ACTIVE_DURATION_MAX_MS,
  });
  assert.equal(durationAtTrainingLimit.training_eligible, true);
  assert.deepEqual(durationAtTrainingLimit.exclusion_reasons, []);

  const durationAboveTrainingLimit = api.normalizeLearningEvent({
    ...fixture.review_attempt,
    event_id: 'event-duration-above-limit',
    command_id: 'command-duration-above-limit',
    correlation_id: 'correlation-duration-above-limit',
    duration_ms: api.TRAINING_ACTIVE_DURATION_MAX_MS + 1,
    active_duration_ms: api.TRAINING_ACTIVE_DURATION_MAX_MS + 1,
  });
  assert.equal(durationAboveTrainingLimit.training_eligible, false);
  assert.deepEqual(
    durationAboveTrainingLimit.exclusion_reasons,
    ['ACTIVE_DURATION_UNRELIABLE'],
  );

  const tenHourDuration = api.normalizeLearningEvent({
    ...fixture.review_attempt,
    event_id: 'event-duration-ten-hours',
    command_id: 'command-duration-ten-hours',
    correlation_id: 'correlation-duration-ten-hours',
    duration_ms: 10 * 60 * 60 * 1000,
    active_duration_ms: 10 * 60 * 60 * 1000,
    payload: { active_duration_reliable: true },
  });
  assert.equal(tenHourDuration.training_eligible, false);
  assert.deepEqual(tenHourDuration.exclusion_reasons, ['ACTIVE_DURATION_UNRELIABLE']);

  const memory = api.createInMemoryLearningEventRepository();
  const concurrentMemory = api.createInMemoryLearningEventRepository();
  const concurrentDifferentEvents = [
    {
      ...fixture.candidate_event,
      event_id: 'event-concurrent-a',
      command_id: 'command-concurrent-a',
      correlation_id: 'correlation-concurrent-a',
    },
    {
      ...fixture.candidate_event,
      event_id: 'event-concurrent-b',
      command_id: 'command-concurrent-b',
      correlation_id: 'correlation-concurrent-b',
    },
  ];
  await Promise.all(concurrentDifferentEvents.map((event) => concurrentMemory.append(event)));
  assert.deepEqual(
    (await concurrentMemory.query({})).map((event) => event.event_id).sort(),
    ['event-concurrent-a', 'event-concurrent-b'],
    'successful concurrent appends with different ids must both remain durable',
  );

  const concurrentSameMemory = api.createInMemoryLearningEventRepository();
  const sameResults = await Promise.all([
    concurrentSameMemory.append(fixture.candidate_event),
    concurrentSameMemory.append(clone(fixture.candidate_event)),
  ]);
  assert.deepEqual(sameResults[0], sameResults[1]);
  assert.equal(
    (await concurrentSameMemory.query({})).length,
    1,
    'concurrent identical event ids must remain idempotent',
  );

  const concurrentConflictMemory = api.createInMemoryLearningEventRepository();
  const conflictResults = await Promise.allSettled([
    concurrentConflictMemory.append(fixture.candidate_event),
    concurrentConflictMemory.append({
      ...fixture.candidate_event,
      payload: { candidate_source: 'conflicting-concurrent-payload' },
    }),
  ]);
  assert.equal(
    conflictResults.filter((result) => result.status === 'fulfilled').length,
    1,
    'only one concurrent conflicting append may succeed',
  );
  const conflictRejection = conflictResults.find((result) => result.status === 'rejected');
  assert.ok(conflictRejection);
  expectContractError(conflictRejection.reason, 'IDEMPOTENCY_CONFLICT');
  assert.equal((await concurrentConflictMemory.query({})).length, 1);

  const candidate = await memory.append(fixture.candidate_event);
  assert.deepEqual(await memory.append(fixture.candidate_event), candidate);
  await assert.rejects(
    () => memory.append({
      ...fixture.candidate_event,
      payload: { candidate_source: 'different' },
    }),
    (error) => expectContractError(error, 'IDEMPOTENCY_CONFLICT'),
  );
  const correction = api.normalizeLearningEvent({
    ...fixture.candidate_event,
    event_id: 'event-correction-1',
    command_id: 'command-correction-1',
    correlation_id: 'correlation-correction-1',
    event_type: 'event_corrected',
    payload: {
      corrects_event_id: fixture.candidate_event.event_id,
      corrected_fields: ['content_version'],
    },
  });
  await memory.append(correction);
  await assert.rejects(
    () => memory.append({
      ...correction,
      event_id: 'event-correction-missing',
      payload: { corrects_event_id: 'event-missing' },
    }),
    (error) => expectContractError(error, 'INVALID_STATE_TRANSITION'),
  );
  await memory.append(fixture.review_attempt);
  await memory.append({
    ...fixture.candidate_event,
    event_id: 'event-candidate-august',
    command_id: 'command-candidate-august',
    correlation_id: 'correlation-candidate-august',
    occurred_at: '2026-08-01T00:00:00.000Z',
    recorded_at: '2026-08-01T00:00:00.000Z',
  });
  assert.equal((await memory.query({ learning_unit_id: 'unit-1' })).length, 4);
  assert.equal((await memory.query({ event_type: 'review_attempt_recorded' })).length, 1);
  assert.equal((await memory.query({
    occurred_from: '2026-08-01T00:00:00.000Z',
    occurred_to: '2026-08-31T23:59:59.999Z',
  })).length, 1, 'new UTC month should use a separate partition');

  const defaultExport = JSON.parse(await memory.export({ format: 'json' }));
  assert.equal(defaultExport.schema_version, 'learning-event-export.v1');
  assert.equal(defaultExport.field_dictionary.schema_version, 'learning-event-field-dictionary.v1');
  assert.equal(
    defaultExport.training_active_duration_max_ms,
    api.TRAINING_ACTIVE_DURATION_MAX_MS,
  );
  assert.deepEqual(defaultExport.policy_versions, ['review-policy.v1']);
  assert.deepEqual(defaultExport.scheduler_versions, ['fsrs.v1']);
  assert.equal(
    Object.keys(defaultExport.field_dictionary.fields).length,
    32,
    'field dictionary must cover the complete LearningEvent envelope',
  );
  const exportedReview = defaultExport.events.find(
    (event) => event.event_id === fixture.review_attempt.event_id,
  );
  assert.equal(exportedReview.payload.sentence, undefined);
  assert.equal(exportedReview.payload.surrounding_text, undefined);
  assert.equal(exportedReview.payload.copyright_excerpt, undefined);
  assert.equal(exportedReview.payload.arbitrary_unknown_text, undefined);
  assert.equal(exportedReview.payload.source_id, 'local-source-1');
  assert.equal(exportedReview.payload.content_sha256, 'a'.repeat(64));
  assert.deepEqual(exportedReview.payload.source_locator, {
    locator_version: 'source-locator.v1',
    line: 14,
  });
  assert.doesNotMatch(JSON.stringify(defaultExport), /Copyright key blacklist bypass/);
  assert.doesNotMatch(JSON.stringify(defaultExport), /Unknown payload text bypass/);
  assert.doesNotMatch(JSON.stringify(defaultExport), /Nested locator leak/);
  assert.doesNotMatch(JSON.stringify(defaultExport), /P3_SECRET_EXTENSION_TEXT/);
  assert.doesNotMatch(JSON.stringify(defaultExport), /P3_SECRET_BEFORE_STATE_TEXT/);
  assert.doesNotMatch(JSON.stringify(defaultExport), /P3_SECRET_AFTER_STATE_TEXT/);
  assert.deepEqual(exportedReview.extensions, {});
  assert.deepEqual(exportedReview.before_state.extensions, {});
  assert.deepEqual(exportedReview.after_state.extensions, {});
  const sensitiveExport = JSON.parse(await memory.export({
    format: 'json',
    includeSensitiveText: true,
  }));
  assert.equal(
    sensitiveExport.events.find(
      (event) => event.event_id === fixture.review_attempt.event_id,
    ).payload.sentence,
    'Copyrighted personal sentence.',
  );
  assert.equal(
    sensitiveExport.events.find(
      (event) => event.event_id === fixture.review_attempt.event_id,
    ).payload.copyright_excerpt,
    'Copyright key blacklist bypass.',
  );
  const sensitiveReview = sensitiveExport.events.find(
    (event) => event.event_id === fixture.review_attempt.event_id,
  );
  assert.equal(
    sensitiveReview.extensions.copyright_excerpt,
    'P3_SECRET_EXTENSION_TEXT',
  );
  assert.equal(
    sensitiveReview.before_state.extensions.private_quote,
    'P3_SECRET_BEFORE_STATE_TEXT',
  );
  assert.equal(
    sensitiveReview.after_state.extensions.private_quote,
    'P3_SECRET_AFTER_STATE_TEXT',
  );
  const jsonl = (await memory.export({ format: 'jsonl' })).split('\n').map(JSON.parse);
  assert.equal(jsonl[0].record_type, 'metadata');
  assert.equal(jsonl.filter((row) => row.record_type === 'event').length, 4);

  const { rows, port } = createRowPort();
  const bound = api.bindLearningEventRepositoryToTransaction(port, '2026-07');
  for (let index = 0; index <= api.LEARNING_EVENT_SHARD_MAX_EVENTS; index += 1) {
    await bound.append(api.normalizeLearningEvent({
      ...fixture.candidate_event,
      event_id: `event-rollover-${String(index).padStart(4, '0')}`,
      command_id: `command-rollover-${String(index).padStart(4, '0')}`,
      correlation_id: `correlation-rollover-${String(index).padStart(4, '0')}`,
    }));
  }
  const manifest = rows.get(api.LEARNING_EVENT_MANIFEST_ROW_ID).content;
  assert.equal(manifest.partitions['2026-07'].shard_ids.length, 2);
  assert.equal(manifest.partitions['2026-07'].event_count, 257);
  assert.equal(
    rows.get(manifest.partitions['2026-07'].shard_ids[0]).content.events.length,
    api.LEARNING_EVENT_SHARD_MAX_EVENTS,
  );
  assert.equal(
    rows.get(manifest.partitions['2026-07'].shard_ids[1]).content.events.length,
    1,
  );

  const bufferedRows = new Map();
  const bufferedManifestContents = [];
  const bufferedPort = {
    transaction_id: 'buffered-learning-events',
    buffered: true,
    async getRow(rowId) {
      return bufferedRows.get(rowId) || null;
    },
    async putRow(row) {
      bufferedRows.set(row.id, row);
      if (row.id === api.LEARNING_EVENT_MANIFEST_ROW_ID) {
        bufferedManifestContents.push(row.content);
      }
    },
  };
  const bufferedEvents = api.bindLearningEventRepositoryToTransaction(bufferedPort, '2026-07');
  await bufferedEvents.append(api.normalizeLearningEvent({
    ...fixture.candidate_event,
    event_id: 'event-buffered-0001',
    command_id: 'command-buffered-0001',
    correlation_id: 'correlation-buffered-0001',
  }));
  await api.bindLearningEventRepositoryToTransaction(bufferedPort, '2026-07').append(
    api.normalizeLearningEvent({
      ...fixture.candidate_event,
      event_id: 'event-buffered-0002',
      command_id: 'command-buffered-0002',
      correlation_id: 'correlation-buffered-0002',
    }),
  );
  assert.strictEqual(
    bufferedManifestContents[1],
    bufferedManifestContents[0],
    'buffered event writes must reuse one manifest instead of cloning the full event index per event',
  );
  await assert.rejects(
    () => api.bindLearningEventRepositoryToTransaction(port, '2026-08').append(
      fixture.candidate_event,
    ),
    (error) => expectContractError(error, 'INVALID_EVENT_PARTITION'),
  );
  assert.throws(
    () => api.bindLearningEventRepositoryToTransaction(
      { events: {}, acquisition: {} },
      '2026-07',
    ),
    (error) => expectContractError(error, 'INVALID_FIELD_TYPE'),
  );
  assert.throws(
    () => api.createIndexedDbLearningEventRepository({
      indexedDBApi: new FakeIndexedDbFactory(),
      dbVersion: 2,
    }),
    (error) => expectContractError(error, 'INVALID_FIELD_TYPE'),
  );

  const upgradeIndexedDBApi = new FakeIndexedDbFactory({ triggerUpgrade: true });
  const upgradeRepository = api.createIndexedDbLearningEventRepository({
    indexedDBApi: upgradeIndexedDBApi,
  });
  await assert.rejects(
    () => upgradeRepository.append(fixture.candidate_event),
    (error) => (
      expectContractError(error, 'TRANSACTION_ABORTED')
      && error.details.reason === 'INDEXEDDB_SCHEMA_UPGRADE_FORBIDDEN'
    ),
  );
  assert.equal(upgradeIndexedDBApi.upgradeAbortCalled, true);
  assert.deepEqual(
    upgradeIndexedDBApi.database.createObjectStoreCalls,
    [],
    'P3 must never create the files object store',
  );

  const missingStoreIndexedDBApi = new FakeIndexedDbFactory({ hasFilesStore: false });
  const missingStoreRepository = api.createIndexedDbLearningEventRepository({
    indexedDBApi: missingStoreIndexedDBApi,
  });
  await assert.rejects(
    () => missingStoreRepository.query({}),
    (error) => (
      expectContractError(error, 'TRANSACTION_ABORTED')
      && error.details.reason === 'INDEXEDDB_SCHEMA_MISSING'
    ),
  );
  assert.deepEqual(missingStoreIndexedDBApi.database.createObjectStoreCalls, []);

  for (const operation of ['query', 'append']) {
    const wrongKeyPathIndexedDBApi = new FakeIndexedDbFactory({ keyPath: 'WRONG' });
    const wrongKeyPathRepository = api.createIndexedDbLearningEventRepository({
      indexedDBApi: wrongKeyPathIndexedDBApi,
    });
    const runOperation = operation === 'query'
      ? () => wrongKeyPathRepository.query({})
      : () => wrongKeyPathRepository.append(fixture.candidate_event);
    await assert.rejects(
      runOperation,
      (error) => (
        expectContractError(error, 'TRANSACTION_ABORTED')
        && error.details.reason === 'INDEXEDDB_KEY_PATH_MISMATCH'
      ),
    );
    assert.equal(wrongKeyPathIndexedDBApi.database.closed, true);
    assert.deepEqual(
      wrongKeyPathIndexedDBApi.database.storeOperationCalls,
      [],
      `${operation} must reject the wrong keyPath before any manifest read or write`,
    );
  }

  const secretError = new Error('database failed near Copyrighted personal sentence.');
  secretError.name = 'AbortError';
  const failedIndexedRepository = api.createIndexedDbLearningEventRepository({
    indexedDBApi: new FakeIndexedDbFactory({ openError: secretError }),
  });
  const publicFailureOperations = [
    () => failedIndexedRepository.append(fixture.candidate_event),
    () => failedIndexedRepository.getById('event-any'),
    () => failedIndexedRepository.query({}),
    () => failedIndexedRepository.export({ format: 'json' }),
  ];
  for (const runOperation of publicFailureOperations) {
    await assert.rejects(
      runOperation,
      (error) => {
        expectContractError(error, 'TRANSACTION_ABORTED');
        assert.equal(error.details.reason, 'INDEXEDDB_OPERATION_FAILED');
        assert.equal(error.details.error_name, 'AbortError');
        assert.doesNotMatch(error.message, /Copyrighted personal sentence/);
        assert.doesNotMatch(JSON.stringify(error.details), /Copyrighted personal sentence/);
        return true;
      },
    );
  }

  const indexedDBApi = new FakeIndexedDbFactory();
  const indexedRepository = api.createIndexedDbLearningEventRepository({ indexedDBApi });
  await indexedRepository.append(fixture.candidate_event);
  await indexedRepository.append(fixture.review_attempt);
  assert.deepEqual(indexedDBApi.opens, [{ name: 'SeekPlayerDB', version: 1 }]);
  indexedDBApi.database.storeOperationCalls.length = 0;
  assert.equal((await indexedRepository.query({})).length, 2);
  assert.equal(
    indexedDBApi.database.storeOperationCalls.some(({ operation }) => operation === 'openCursor'),
    false,
    'a valid event manifest should read only its event shard rows, not scan the full files store',
  );
  indexedDBApi.rows.delete(api.LEARNING_EVENT_MANIFEST_ROW_ID);
  assert.equal(
    (await indexedRepository.query({})).length,
    2,
    'missing manifest should be rebuilt from valid shards',
  );
  assert.ok(indexedDBApi.rows.has(api.LEARNING_EVENT_MANIFEST_ROW_ID));
  indexedDBApi.rows.get(api.LEARNING_EVENT_MANIFEST_ROW_ID).content = {
    schema_version: 'broken-manifest.v9',
  };
  assert.equal(
    (await indexedRepository.query({})).length,
    2,
    'invalid manifest should be rebuilt from valid shards',
  );

  const shardId = [...indexedDBApi.rows.keys()].find(
    (rowId) => rowId.startsWith('vocabulary.learning-events.v1.'),
  );
  indexedDBApi.rows.get(shardId).content.schema_version = 'broken-shard.v9';
  indexedDBApi.rows.delete(api.LEARNING_EVENT_MANIFEST_ROW_ID);
  await assert.rejects(
    () => indexedRepository.query({}),
    (error) => (
      expectContractError(error, 'TRANSACTION_ABORTED')
      && error.details.reason === 'BAD_EVENT_SHARD'
    ),
  );

  const moduleSource = fs.readFileSync(path.join(
    repoRoot,
    'src',
    'services',
    'vocabulary',
    'vocabulary-learning-events.js',
  ), 'utf8');
  assert.match(moduleSource, /indexedDBApi\.open\('SeekPlayerDB', 1\)/);
  assert.doesNotMatch(moduleSource, /createObjectStore/);
  assert.doesNotMatch(
    moduleSource,
    /options\.(?:dbName|dbVersion|storeName|keyPath)|\.\.\.options/,
  );
  assert.doesNotMatch(moduleSource, /fetch\(|XMLHttpRequest|WebSocket/);

  console.log('Vocabulary learning events verification passed.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
