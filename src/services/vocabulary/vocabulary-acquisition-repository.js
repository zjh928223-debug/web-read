import {
  ACQUISITION_STATUSES,
  normalizeAcquisitionAttempt,
  normalizeAcquisitionState,
  normalizeLearningUnit,
} from './vocabulary-learning-models.js';

const DB_NAME = 'SeekPlayerDB';
const DB_VERSION = 1;
const STORE_NAME = 'files';
const STORE_KEY_PATH = 'id';
const ACQUISITION_ROW_ID = 'vocabulary.acquisition.store.v1';
const ACQUISITION_STORE_SCHEMA = 'acquisition-store.v1';

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

function stableStorageError(operation) {
  return contractError('TRANSACTION_ABORTED', 'IndexedDB operation failed', { operation });
}

function normalizeStorageError(error, operation) {
  if (error?.name === 'VocabularyLearningContractError'
    && error.code
    && typeof error.message === 'string'
    && isPlainObject(error.details)) {
    return error;
  }
  return stableStorageError(operation);
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function clone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function createEmptyStore() {
  return {
    schema_version: ACQUISITION_STORE_SCHEMA,
    by_learning_unit_id: {},
    acquisition_attempts_by_id: {},
  };
}

function normalizeExpectedRevision(value) {
  if (value === null) return null;
  if (!Number.isInteger(value) || value < 0) {
    fail('INVALID_FIELD_TYPE', 'expected_revision must be null or a non-negative integer', {
      field: 'expected_revision',
    });
  }
  return value;
}

function normalizeRepositoryId(value, field) {
  if (typeof value !== 'string' || value.length === 0) {
    fail('INVALID_FIELD_TYPE', 'Expected a non-empty ID', { field });
  }
  return value;
}

function normalizeStore(input) {
  if (input === null || input === undefined) return createEmptyStore();
  if (!isPlainObject(input)) {
    fail('INVALID_FIELD_TYPE', 'Acquisition store must be a plain object', { field: 'store' });
  }
  for (const key of Object.keys(input)) {
    if (!['schema_version', 'by_learning_unit_id', 'acquisition_attempts_by_id'].includes(key)) {
      fail('INVALID_FIELD_TYPE', 'Unknown acquisition store field', { field: `store.${key}` });
    }
  }
  if (input.schema_version !== ACQUISITION_STORE_SCHEMA) {
    fail('UNSUPPORTED_SCHEMA_VERSION', 'Unsupported acquisition store schema', {
      field: 'store.schema_version',
      expected: ACQUISITION_STORE_SCHEMA,
      actual: typeof input.schema_version === 'string' ? input.schema_version : null,
    });
  }
  if (!isPlainObject(input.by_learning_unit_id)) {
    fail('INVALID_FIELD_TYPE', 'by_learning_unit_id must be an object map', {
      field: 'store.by_learning_unit_id',
    });
  }
  if (!isPlainObject(input.acquisition_attempts_by_id)) {
    fail('INVALID_FIELD_TYPE', 'acquisition_attempts_by_id must be an object map', {
      field: 'store.acquisition_attempts_by_id',
    });
  }

  const store = createEmptyStore();
  for (const [learningUnitId, pair] of Object.entries(input.by_learning_unit_id)) {
    if (!isPlainObject(pair)
      || !Object.prototype.hasOwnProperty.call(pair, 'learning_unit')
      || !Object.prototype.hasOwnProperty.call(pair, 'acquisition_state')
      || Object.keys(pair).some((key) => !['learning_unit', 'acquisition_state'].includes(key))) {
      fail('INVALID_FIELD_TYPE', 'Learning unit store entries must contain only unit and state', {
        field: `store.by_learning_unit_id.${learningUnitId}`,
      });
    }
    const learningUnit = normalizeLearningUnit(pair.learning_unit);
    const acquisitionState = normalizeAcquisitionState(pair.acquisition_state);
    if (learningUnit.learning_unit_id !== learningUnitId
      || acquisitionState.learning_unit_id !== learningUnitId) {
      fail('INVALID_CONTEXT_REFERENCE', 'Acquisition store map keys must match contained IDs', {
        learning_unit_id: learningUnitId,
      });
    }
    if (![ACQUISITION_STATUSES.CANDIDATE, ACQUISITION_STATUSES.SKIPPED].includes(acquisitionState.status)
      && learningUnit.target_sense_id === null) {
      fail('INVALID_CONTEXT_REFERENCE', 'Introduced acquisition state requires a target sense', {
        learning_unit_id: learningUnitId,
      });
    }
    store.by_learning_unit_id[learningUnitId] = {
      learning_unit: learningUnit,
      acquisition_state: acquisitionState,
    };
  }

  assertNoDuplicateActiveTargetSenses(store);

  for (const [attemptId, rawAttempt] of Object.entries(input.acquisition_attempts_by_id)) {
    const attempt = normalizeAcquisitionAttempt(rawAttempt);
    if (attempt.attempt_id !== attemptId) {
      fail('INVALID_CONTEXT_REFERENCE', 'Acquisition attempt map key must match attempt_id', {
        attempt_id: attemptId,
      });
    }
    if (!store.by_learning_unit_id[attempt.learning_unit_id]) {
      fail('INVALID_CONTEXT_REFERENCE', 'Acquisition attempt references an unknown learning unit', {
        attempt_id: attemptId,
        learning_unit_id: attempt.learning_unit_id,
      });
    }
    const attemptUnit = store.by_learning_unit_id[attempt.learning_unit_id].learning_unit;
    if (attemptUnit.target_sense_id === null || attemptUnit.target_sense_id !== attempt.target_sense_id) {
      fail('INVALID_CONTEXT_REFERENCE', 'Acquisition attempt target sense does not match its learning unit', {
        attempt_id: attemptId,
        learning_unit_id: attempt.learning_unit_id,
      });
    }
    store.acquisition_attempts_by_id[attemptId] = attempt;
  }
  for (const [learningUnitId, pair] of Object.entries(store.by_learning_unit_id)) {
    const lastAttemptId = pair.acquisition_state.last_acquisition_attempt_id;
    if (lastAttemptId === null) continue;
    const attempt = store.acquisition_attempts_by_id[lastAttemptId];
    if (!attempt || attempt.learning_unit_id !== learningUnitId) {
      fail('INVALID_CONTEXT_REFERENCE', 'last_acquisition_attempt_id is missing or belongs to another unit', {
        learning_unit_id: learningUnitId,
        attempt_id: lastAttemptId,
      });
    }
  }
  return store;
}

function normalizeSeed(seed) {
  if (seed === undefined) return createEmptyStore();
  if (!isPlainObject(seed)
    || Object.keys(seed).some((key) => key !== 'store')
    || !Object.prototype.hasOwnProperty.call(seed, 'store')) {
    fail('INVALID_FIELD_TYPE', 'Acquisition repository seed must be { store }', { field: 'seed' });
  }
  return normalizeStore(seed.store);
}

function createCandidateState(learningUnitId) {
  return normalizeAcquisitionState({
    learning_unit_id: learningUnitId,
    status: ACQUISITION_STATUSES.CANDIDATE,
  });
}

function assertNoDuplicateActiveTargetSenses(store, excludedLearningUnitId = null) {
  const seen = new Map();
  for (const [learningUnitId, pair] of Object.entries(store.by_learning_unit_id)) {
    if (learningUnitId === excludedLearningUnitId) continue;
    const unit = pair.learning_unit;
    if (unit.archived_at !== null || unit.target_sense_key === null) continue;
    const compositeKey = `${unit.word_id}\u001f${unit.target_sense_key}`;
    if (seen.has(compositeKey)) {
      fail('DUPLICATE_TARGET_SENSE', 'Duplicate active word and target sense', {
        learning_unit_id: learningUnitId,
        conflicting_learning_unit_id: seen.get(compositeKey),
        word_id: unit.word_id,
      });
    }
    seen.set(compositeKey, learningUnitId);
  }
}

function findDuplicateActiveTargetSense(store, candidate) {
  if (candidate.archived_at !== null || candidate.target_sense_key === null) return null;
  return Object.values(store.by_learning_unit_id)
    .map((pair) => pair.learning_unit)
    .find((unit) => (
      unit.learning_unit_id !== candidate.learning_unit_id
      && unit.archived_at === null
      && unit.word_id === candidate.word_id
      && unit.target_sense_key === candidate.target_sense_key
    )) || null;
}

function withoutRevision(value) {
  const copy = clone(value);
  delete copy.revision;
  return copy;
}

function equivalentIgnoringRevision(left, right) {
  return JSON.stringify(withoutRevision(left)) === JSON.stringify(withoutRevision(right));
}

function assertImmutableLearningUnitFields(current, next) {
  for (const field of ['learning_unit_id', 'word_id', 'created_at']) {
    if (current[field] !== next[field]) {
      fail('INVALID_STATE_TRANSITION', 'Immutable learning unit field changed', { field });
    }
  }
}

function assertStateTransition(currentStatus, nextStatus) {
  if (currentStatus === nextStatus) {
    if (currentStatus === ACQUISITION_STATUSES.GRADUATED
      || currentStatus === ACQUISITION_STATUSES.SKIPPED) {
      fail('INVALID_STATE_TRANSITION', 'Terminal acquisition states cannot be modified', {
        from_status: currentStatus,
        to_status: nextStatus,
      });
    }
    return;
  }
  const allowed = {
    candidate: new Set(['introduced', 'skipped']),
    introduced: new Set(['acquiring', 'skipped']),
    acquiring: new Set(['ready_for_check', 'skipped']),
    ready_for_check: new Set(['graduated', 'skipped']),
    graduated: new Set(),
    skipped: new Set(),
  };
  if (!allowed[currentStatus]?.has(nextStatus)) {
    fail('INVALID_STATE_TRANSITION', 'Invalid acquisition status transition', {
      from_status: currentStatus,
      to_status: nextStatus,
    });
  }
}

function validateRowPort(rowPort) {
  if (!rowPort
    || typeof rowPort.transaction_id !== 'string'
    || !rowPort.transaction_id
    || typeof rowPort.getRow !== 'function'
    || typeof rowPort.putRow !== 'function'
    || typeof rowPort.abort !== 'function') {
    fail('INVALID_FIELD_TYPE', 'Expected a VocabularyLearningTransactionRowPort', {
      field: 'row_port',
    });
  }
}

function createRepositoryCore(storage) {
  async function loadStore() {
    return normalizeStore(await storage.loadStore());
  }

  async function saveStore(store) {
    await storage.saveStore(normalizeStore(store));
  }

  async function loadSnapshot() {
    return clone(await loadStore());
  }

  async function getLearningUnit(learningUnitId) {
    const id = normalizeRepositoryId(learningUnitId, 'learning_unit_id');
    const store = await loadStore();
    return clone(store.by_learning_unit_id[id]?.learning_unit || null);
  }

  async function findActiveByWordAndSense(wordId, targetSenseKey) {
    const normalizedWordId = normalizeRepositoryId(wordId, 'word_id');
    const normalizedTargetSenseKey = normalizeRepositoryId(targetSenseKey, 'target_sense_key');
    const store = await loadStore();
    const match = Object.values(store.by_learning_unit_id)
      .map((pair) => pair.learning_unit)
      .find((unit) => (
        unit.archived_at === null
        && unit.word_id === normalizedWordId
        && unit.target_sense_key === normalizedTargetSenseKey
      ));
    return clone(match || null);
  }

  async function putLearningUnit(input, expectedRevision) {
    const next = normalizeLearningUnit(input);
    const expected = normalizeExpectedRevision(expectedRevision);
    const store = await loadStore();
    const pair = store.by_learning_unit_id[next.learning_unit_id] || null;
    const duplicate = findDuplicateActiveTargetSense(store, next);
    if (duplicate) {
      fail('DUPLICATE_TARGET_SENSE', 'Duplicate active word and target sense', {
        learning_unit_id: next.learning_unit_id,
        conflicting_learning_unit_id: duplicate.learning_unit_id,
        word_id: next.word_id,
      });
    }

    if (!pair) {
      if (expected !== null) {
        fail('CONCURRENT_MODIFICATION', 'Cannot update a missing learning unit', {
          learning_unit_id: next.learning_unit_id,
          expected_revision: expected,
          actual_revision: null,
        });
      }
      if (next.revision !== 0) {
        fail('CONCURRENT_MODIFICATION', 'New learning units must start at revision 0', {
          learning_unit_id: next.learning_unit_id,
          expected_revision: 0,
          actual_revision: next.revision,
        });
      }
      next.revision = 0;
      store.by_learning_unit_id[next.learning_unit_id] = {
        learning_unit: next,
        acquisition_state: createCandidateState(next.learning_unit_id),
      };
      await saveStore(store);
      return clone(next);
    }

    const current = pair.learning_unit;
    assertImmutableLearningUnitFields(current, next);
    if (equivalentIgnoringRevision(current, next)) return clone(current);
    if (expected !== current.revision) {
      fail('CONCURRENT_MODIFICATION', 'Learning unit revision did not match', {
        learning_unit_id: next.learning_unit_id,
        expected_revision: expected,
        actual_revision: current.revision,
      });
    }
    if (next.revision !== expected) {
      fail('CONCURRENT_MODIFICATION', 'Learning unit payload revision did not match expected_revision', {
        learning_unit_id: next.learning_unit_id,
        expected_revision: expected,
        actual_revision: next.revision,
      });
    }
    next.revision = current.revision + 1;
    pair.learning_unit = next;
    await saveStore(store);
    return clone(next);
  }

  async function getState(learningUnitId) {
    const id = normalizeRepositoryId(learningUnitId, 'learning_unit_id');
    const store = await loadStore();
    return clone(store.by_learning_unit_id[id]?.acquisition_state || null);
  }

  async function putState(input, expectedRevision) {
    const next = normalizeAcquisitionState(input);
    const expected = normalizeExpectedRevision(expectedRevision);
    const store = await loadStore();
    const pair = store.by_learning_unit_id[next.learning_unit_id];
    if (!pair) {
      fail('INVALID_CONTEXT_REFERENCE', 'Acquisition state references an unknown learning unit', {
        learning_unit_id: next.learning_unit_id,
      });
    }
    const current = pair.acquisition_state;
    if (equivalentIgnoringRevision(current, next)) return clone(current);
    if (expected !== current.revision) {
      fail('CONCURRENT_MODIFICATION', 'Acquisition state revision did not match', {
        learning_unit_id: next.learning_unit_id,
        expected_revision: expected,
        actual_revision: current.revision,
      });
    }
    if (next.revision !== expected) {
      fail('CONCURRENT_MODIFICATION', 'Acquisition state payload revision did not match expected_revision', {
        learning_unit_id: next.learning_unit_id,
        expected_revision: expected,
        actual_revision: next.revision,
      });
    }
    assertStateTransition(current.status, next.status);
    next.revision = current.revision + 1;
    pair.acquisition_state = next;
    await saveStore(store);
    return clone(next);
  }

  async function getAttempt(attemptId) {
    const id = normalizeRepositoryId(attemptId, 'attempt_id');
    const store = await loadStore();
    return clone(store.acquisition_attempts_by_id[id] || null);
  }

  async function putAttempt(input) {
    const attempt = normalizeAcquisitionAttempt(input);
    const store = await loadStore();
    const pair = store.by_learning_unit_id[attempt.learning_unit_id];
    if (!pair) {
      fail('INVALID_CONTEXT_REFERENCE', 'Acquisition attempt references an unknown learning unit', {
        attempt_id: attempt.attempt_id,
        learning_unit_id: attempt.learning_unit_id,
      });
    }
    if (pair.learning_unit.target_sense_id === null
      || attempt.target_sense_id !== pair.learning_unit.target_sense_id) {
      fail('INVALID_CONTEXT_REFERENCE', 'Acquisition attempt target sense does not match the learning unit', {
        attempt_id: attempt.attempt_id,
        learning_unit_id: attempt.learning_unit_id,
      });
    }
    const current = store.acquisition_attempts_by_id[attempt.attempt_id] || null;
    if (current) {
      if (JSON.stringify(current) === JSON.stringify(attempt)) return clone(current);
      fail('IDEMPOTENCY_CONFLICT', 'Attempt ID was reused with different content', {
        attempt_id: attempt.attempt_id,
      });
    }
    store.acquisition_attempts_by_id[attempt.attempt_id] = attempt;
    await saveStore(store);
    return clone(attempt);
  }

  return {
    loadSnapshot,
    getLearningUnit,
    findActiveByWordAndSense,
    putLearningUnit,
    getState,
    putState,
    getAttempt,
    putAttempt,
  };
}

function serializeWrites(repository) {
  let writeQueue = Promise.resolve();
  function serialize(method) {
    return (...args) => {
      const operation = writeQueue.then(() => method(...args), () => method(...args));
      writeQueue = operation.catch(() => undefined);
      return operation;
    };
  }
  return {
    ...repository,
    putLearningUnit: serialize(repository.putLearningUnit),
    putState: serialize(repository.putState),
    putAttempt: serialize(repository.putAttempt),
  };
}

export function createInMemoryAcquisitionRepository(seed) {
  let store = normalizeSeed(seed);
  const repository = createRepositoryCore({
    async loadStore() {
      return clone(store);
    },
    async saveStore(nextStore) {
      store = clone(nextStore);
    },
  });
  return serializeWrites(repository);
}

export function bindAcquisitionRepositoryToTransaction(rowPort) {
  return bindAcquisitionRepositoryToTransactionInternal(rowPort, false);
}

function bindAcquisitionRepositoryToTransactionInternal(rowPort, includeSnapshot) {
  validateRowPort(rowPort);
  const repository = createRepositoryCore({
    async loadStore() {
      const row = await rowPort.getRow(ACQUISITION_ROW_ID);
      if (row === null || row === undefined) return createEmptyStore();
      if (!isPlainObject(row) || row.id !== ACQUISITION_ROW_ID || !Object.prototype.hasOwnProperty.call(row, 'content')) {
        rowPort.abort(contractError('INVALID_FIELD_TYPE', 'Invalid acquisition FileRow', {
          row_id: ACQUISITION_ROW_ID,
        }));
      }
      return row.content;
    },
    async saveStore(store) {
      await rowPort.putRow({
        id: ACQUISITION_ROW_ID,
        content: clone(store),
        timestamp: new Date().toISOString(),
      });
    },
  });
  if (includeSnapshot) return repository;
  return {
    getLearningUnit: repository.getLearningUnit,
    findActiveByWordAndSense: repository.findActiveByWordAndSense,
    putLearningUnit: repository.putLearningUnit,
    getState: repository.getState,
    putState: repository.putState,
    getAttempt: repository.getAttempt,
    putAttempt: repository.putAttempt,
  };
}

function requestAsPromise(request, operation) {
  return new Promise((resolve, reject) => {
    try {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(stableStorageError(operation));
    } catch (error) {
      reject(normalizeStorageError(error, operation));
    }
  });
}

function transactionCompletion(transaction, operation) {
  return new Promise((resolve, reject) => {
    try {
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(stableStorageError(operation));
      transaction.onerror = () => reject(stableStorageError(operation));
    } catch (error) {
      reject(normalizeStorageError(error, operation));
    }
  });
}

export function createIndexedDbAcquisitionRepository(options = {}) {
  if (!isPlainObject(options) || Object.keys(options).some((key) => key !== 'indexedDBApi')) {
    fail('INVALID_FIELD_TYPE', 'IndexedDB repository options only allow indexedDBApi', {
      field: 'options',
    });
  }
  const indexedDBApi = options.indexedDBApi
    || (typeof globalThis !== 'undefined' ? globalThis.indexedDB : null);
  let databasePromise = null;

  function openDatabase() {
    if (!indexedDBApi || typeof indexedDBApi.open !== 'function') {
      return Promise.reject(stableStorageError('open_database'));
    }
    if (databasePromise) return databasePromise;
    databasePromise = new Promise((resolve, reject) => {
      let request;
      try {
        request = indexedDBApi.open('SeekPlayerDB', 1);
      } catch (error) {
        reject(normalizeStorageError(error, 'open_database'));
        return;
      }
      let rejectedUpgrade = false;
      try {
        request.onupgradeneeded = () => {
          rejectedUpgrade = true;
          try {
            if (request.transaction && typeof request.transaction.abort === 'function') {
              request.transaction.abort();
            }
          } catch {
            reject(stableStorageError('validate_database_schema'));
          }
        };
        request.onerror = () => {
          reject(stableStorageError(rejectedUpgrade ? 'validate_database_schema' : 'open_database'));
        };
        request.onsuccess = () => {
          try {
            const database = request.result;
            if (!database.objectStoreNames || !database.objectStoreNames.contains('files')) {
              try {
                if (typeof database.close === 'function') database.close();
              } catch {
                // Schema failure below is the stable public result.
              }
              reject(stableStorageError('validate_database_schema'));
              return;
            }
            resolve(database);
          } catch {
            reject(stableStorageError('validate_database_schema'));
          }
        };
      } catch (error) {
        reject(normalizeStorageError(error, 'open_database'));
      }
    });
    return databasePromise;
  }

  async function runTransaction(mode, operation) {
    const database = await openDatabase();
    let transaction;
    try {
      transaction = database.transaction(['files'], mode);
    } catch (error) {
      throw normalizeStorageError(error, 'start_transaction');
    }
    const completion = transactionCompletion(transaction, 'complete_transaction');
    let objectStore;
    try {
      objectStore = transaction.objectStore('files');
    } catch (error) {
      try {
        transaction.abort();
      } catch {
        // Return the stable object-store error below.
      }
      await completion.catch(() => undefined);
      throw normalizeStorageError(error, 'open_object_store');
    }
    if (objectStore.keyPath !== 'id') {
      try {
        transaction.abort();
      } catch {
        // Report the stable schema failure below.
      }
      await completion.catch(() => undefined);
      throw contractError('TRANSACTION_ABORTED', 'Existing files object store must use keyPath "id"', {});
    }
    const rowPort = {
      transaction_id: `acquisition-${mode}`,
      getRow(rowId) {
        let request;
        try {
          request = objectStore.get(rowId);
        } catch (error) {
          return Promise.reject(normalizeStorageError(error, 'read_acquisition_row'));
        }
        return requestAsPromise(request, 'read_acquisition_row')
          .then((row) => row || null);
      },
      putRow(row) {
        if (mode !== 'readwrite') {
          throw contractError('TRANSACTION_ABORTED', 'Cannot write in a readonly transaction', {});
        }
        let request;
        try {
          request = objectStore.put(row);
        } catch (error) {
          return Promise.reject(normalizeStorageError(error, 'write_acquisition_row'));
        }
        return requestAsPromise(request, 'write_acquisition_row').then(() => undefined);
      },
      abort(error) {
        try {
          transaction.abort();
        } catch {
          // Preserve the contract error even if the transaction already stopped.
        }
        throw error;
      },
    };
    const boundRepository = bindAcquisitionRepositoryToTransactionInternal(rowPort, true);
    let result;
    try {
      result = await operation(boundRepository);
    } catch (error) {
      try {
        transaction.abort();
      } catch {
        // The original operation error is the useful failure.
      }
      await completion.catch(() => undefined);
      throw error;
    }
    await completion;
    return result;
  }

  return {
    loadSnapshot() {
      return runTransaction('readonly', (repository) => repository.loadSnapshot());
    },
    getLearningUnit(learningUnitId) {
      return runTransaction('readonly', (repository) => repository.getLearningUnit(learningUnitId));
    },
    findActiveByWordAndSense(wordId, targetSenseKey) {
      return runTransaction(
        'readonly',
        (repository) => repository.findActiveByWordAndSense(wordId, targetSenseKey),
      );
    },
    putLearningUnit(unit, expectedRevision) {
      return runTransaction(
        'readwrite',
        (repository) => repository.putLearningUnit(unit, expectedRevision),
      );
    },
    getState(learningUnitId) {
      return runTransaction('readonly', (repository) => repository.getState(learningUnitId));
    },
    putState(state, expectedRevision) {
      return runTransaction('readwrite', (repository) => repository.putState(state, expectedRevision));
    },
    getAttempt(attemptId) {
      return runTransaction('readonly', (repository) => repository.getAttempt(attemptId));
    },
    putAttempt(attempt) {
      return runTransaction('readwrite', (repository) => repository.putAttempt(attempt));
    },
  };
}
