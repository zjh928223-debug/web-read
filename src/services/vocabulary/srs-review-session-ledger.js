import { bindReviewRepositoryToTransaction } from './vocabulary-learning-uow.js';

export const SRS_REVIEW_SESSION_LEDGER_ROW_ID = 'vocabulary.review-session-ledgers.v1';
export const SRS_REVIEW_SESSION_LEDGER_STORE_SCHEMA = 'review-session-ledger-store.v1';

const LEDGER_SCHEMA = 'session-ledger.v1';
const LEDGER_STATUSES = new Set(['planned', 'active', 'paused', 'completed', 'abandoned']);
const QUEUE_KINDS = new Set([
  'due_review',
  'relearning',
  'revisit',
  'reassessment',
  'acquisition',
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

function id(value, field) {
  if (typeof value !== 'string' || value.length === 0) {
    fail('INVALID_FIELD_TYPE', `${field} must be a non-empty string`, { field });
  }
  return value;
}

function timestamp(value, field, nullable = false) {
  if (nullable && value === null) return null;
  if (typeof value !== 'string' || !UTC_TIMESTAMP.test(value) || !Number.isFinite(Date.parse(value))) {
    fail('INVALID_TIMESTAMP', `${field} must be a UTC timestamp`, { field });
  }
  return value;
}

function integer(value, field, { positive = false } = {}) {
  if (!Number.isInteger(value) || (positive ? value <= 0 : value < 0)) {
    fail('INVALID_FIELD_TYPE', `${field} must be an integer`, { field });
  }
  return value;
}

function object(value, field) {
  if (!isObject(value)) {
    fail('INVALID_FIELD_TYPE', `${field} must be an object`, { field });
  }
  return clone(value);
}

function localDay(value, field) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    fail('INVALID_FIELD_TYPE', `${field} must use YYYY-MM-DD`, { field });
  }
  const [year, month, day] = value.split('-').map(Number);
  const roundTrip = new Date(Date.UTC(year, month - 1, day));
  if (roundTrip.getUTCFullYear() !== year
    || roundTrip.getUTCMonth() + 1 !== month
    || roundTrip.getUTCDate() !== day) {
    fail('INVALID_FIELD_TYPE', `${field} must be a real calendar day`, { field });
  }
  return value;
}

function timezone(value, field) {
  id(value, field);
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(0);
  } catch {
    fail('INVALID_FIELD_TYPE', `${field} must be an IANA timezone`, { field });
  }
  return value;
}

function exactKeys(value, keys, field) {
  const expected = new Set(keys);
  const missing = keys.find((key) => !Object.prototype.hasOwnProperty.call(value, key));
  if (missing) fail('MISSING_REQUIRED_FIELD', `${field}.${missing} is required`, { field: `${field}.${missing}` });
  const unknown = Object.keys(value).find((key) => !expected.has(key));
  if (unknown) fail('INVALID_FIELD_TYPE', `${field}.${unknown} is unsupported`, { field: `${field}.${unknown}` });
}

function normalizeEntry(input, index) {
  if (!isObject(input)) fail('INVALID_FIELD_TYPE', 'Ledger entry must be an object', { field: `entries[${index}]` });
  const keys = [
    'ledger_item_id',
    'position',
    'queue_kind',
    'learning_unit_id',
    'enqueue_reason',
    'estimated_duration_ms',
    'planned_due_at',
    'revisit_ordinal',
    'extensions',
  ];
  exactKeys(input, keys, `entries[${index}]`);
  if (!QUEUE_KINDS.has(input.queue_kind)) {
    fail('INVALID_ENUM_VALUE', 'Invalid ledger queue kind', { field: `entries[${index}].queue_kind` });
  }
  const position = integer(input.position, `entries[${index}].position`);
  if (position !== index) {
    fail('INVALID_FIELD_TYPE', 'Ledger positions must be contiguous', { field: `entries[${index}].position` });
  }
  return {
    ledger_item_id: id(input.ledger_item_id, `entries[${index}].ledger_item_id`),
    position,
    queue_kind: input.queue_kind,
    learning_unit_id: id(input.learning_unit_id, `entries[${index}].learning_unit_id`),
    enqueue_reason: id(input.enqueue_reason, `entries[${index}].enqueue_reason`),
    estimated_duration_ms: integer(
      input.estimated_duration_ms,
      `entries[${index}].estimated_duration_ms`,
      { positive: true },
    ),
    planned_due_at: timestamp(input.planned_due_at, `entries[${index}].planned_due_at`, true),
    revisit_ordinal: integer(input.revisit_ordinal, `entries[${index}].revisit_ordinal`),
    extensions: object(input.extensions, `entries[${index}].extensions`),
  };
}

function normalizeBacklog(input) {
  if (!isObject(input)) fail('INVALID_FIELD_TYPE', 'Session backlog must be an object', { field: 'backlog' });
  const keys = [
    'due_review_count',
    'relearning_count',
    'reassessment_count',
    'acquisition_count',
    'estimated_ms',
    'extensions',
  ];
  exactKeys(input, keys, 'backlog');
  return {
    due_review_count: integer(input.due_review_count, 'backlog.due_review_count'),
    relearning_count: integer(input.relearning_count, 'backlog.relearning_count'),
    reassessment_count: integer(input.reassessment_count, 'backlog.reassessment_count'),
    acquisition_count: integer(input.acquisition_count, 'backlog.acquisition_count'),
    estimated_ms: integer(input.estimated_ms, 'backlog.estimated_ms'),
    extensions: object(input.extensions, 'backlog.extensions'),
  };
}

export function normalizeReviewSessionLedger(input) {
  if (!isObject(input)) fail('INVALID_FIELD_TYPE', 'SessionLedger must be an object', { field: 'ledger' });
  const keys = [
    'schema_version',
    'session_id',
    'created_at',
    'local_day',
    'timezone',
    'policy_version',
    'mode',
    'budget_ms',
    'estimated_attempt_ms',
    'entries',
    'cursor',
    'status',
    'backlog',
    'revision',
    'extensions',
  ];
  exactKeys(input, keys, 'ledger');
  if (input.schema_version !== LEDGER_SCHEMA) {
    fail('UNSUPPORTED_SCHEMA_VERSION', 'Unsupported SessionLedger schema', {
      schema_version: input.schema_version ?? null,
    });
  }
  if (!['once_daily', 'balanced', 'intensive'].includes(input.mode)) {
    fail('INVALID_ENUM_VALUE', 'Invalid review mode', { field: 'ledger.mode' });
  }
  if (!LEDGER_STATUSES.has(input.status)) {
    fail('INVALID_ENUM_VALUE', 'Invalid ledger status', { field: 'ledger.status' });
  }
  if (!Array.isArray(input.entries)) {
    fail('INVALID_FIELD_TYPE', 'ledger.entries must be an array', { field: 'ledger.entries' });
  }
  const entries = input.entries.map(normalizeEntry);
  if (new Set(entries.map((entry) => entry.ledger_item_id)).size !== entries.length) {
    fail('INVALID_FIELD_TYPE', 'Ledger item IDs must be unique', { field: 'ledger.entries' });
  }
  const cursor = integer(input.cursor, 'ledger.cursor');
  if (cursor > entries.length) fail('INVALID_FIELD_TYPE', 'ledger.cursor exceeds entries', { field: 'ledger.cursor' });
  if (input.status === 'completed' && cursor !== entries.length) {
    fail('INVALID_STATE_TRANSITION', 'Completed ledger has unfinished entries', {
      session_id: input.session_id ?? null,
    });
  }
  const extensions = object(input.extensions, 'ledger.extensions');
  for (const field of ['completed_item_ids', 'attempt_ids']) {
    if (extensions[field] !== undefined
      && (!Array.isArray(extensions[field])
        || extensions[field].some((value) => typeof value !== 'string' || value.length === 0))) {
      fail('INVALID_FIELD_TYPE', `ledger.extensions.${field} must be an ID array`, {
        field: `ledger.extensions.${field}`,
      });
    }
  }
  return {
    schema_version: LEDGER_SCHEMA,
    session_id: id(input.session_id, 'ledger.session_id'),
    created_at: timestamp(input.created_at, 'ledger.created_at'),
    local_day: localDay(input.local_day, 'ledger.local_day'),
    timezone: timezone(input.timezone, 'ledger.timezone'),
    policy_version: id(input.policy_version, 'ledger.policy_version'),
    mode: input.mode,
    budget_ms: integer(input.budget_ms, 'ledger.budget_ms'),
    estimated_attempt_ms: integer(input.estimated_attempt_ms, 'ledger.estimated_attempt_ms', {
      positive: true,
    }),
    entries,
    cursor,
    status: input.status,
    backlog: normalizeBacklog(input.backlog),
    revision: integer(input.revision, 'ledger.revision'),
    extensions,
  };
}

function emptyStore() {
  return {
    schema_version: SRS_REVIEW_SESSION_LEDGER_STORE_SCHEMA,
    by_session_id: {},
  };
}

function normalizeStore(input) {
  if (input == null) return emptyStore();
  if (!isObject(input)
    || input.schema_version !== SRS_REVIEW_SESSION_LEDGER_STORE_SCHEMA
    || !isObject(input.by_session_id)
    || Object.keys(input).some((key) => !['schema_version', 'by_session_id'].includes(key))) {
    fail('TRANSACTION_ABORTED', 'Invalid review session ledger store', {
      row_id: SRS_REVIEW_SESSION_LEDGER_ROW_ID,
    });
  }
  const store = emptyStore();
  for (const [sessionId, value] of Object.entries(input.by_session_id)) {
    const ledger = normalizeReviewSessionLedger(value);
    if (ledger.session_id !== sessionId) {
      fail('INVALID_CONTEXT_REFERENCE', 'Session ledger key mismatch', { session_id: sessionId });
    }
    store.by_session_id[sessionId] = ledger;
  }
  return store;
}

function createRepository({ load, save }) {
  return {
    async getBySessionId(sessionId) {
      id(sessionId, 'session_id');
      return clone((await load()).by_session_id[sessionId] ?? null);
    },
    async put(input, expectedRevision = null) {
      const next = normalizeReviewSessionLedger(input);
      const store = await load();
      const current = store.by_session_id[next.session_id] ?? null;
      if (current === null) {
        if (expectedRevision !== null || next.revision !== 0) {
          fail('CONCURRENT_MODIFICATION', 'Session ledger create revision mismatch', {
            session_id: next.session_id,
          });
        }
      } else {
        if (expectedRevision !== current.revision || next.revision !== current.revision) {
          fail('CONCURRENT_MODIFICATION', 'Session ledger revision mismatch', {
            session_id: next.session_id,
            expected_revision: expectedRevision,
            actual_revision: current.revision,
          });
        }
        if (current.created_at !== next.created_at
          || current.local_day !== next.local_day
          || current.timezone !== next.timezone
          || current.policy_version !== next.policy_version
          || current.mode !== next.mode
          || current.budget_ms !== next.budget_ms
          || current.estimated_attempt_ms !== next.estimated_attempt_ms) {
          fail('INVALID_STATE_TRANSITION', 'Frozen session fields changed', {
            session_id: next.session_id,
          });
        }
        next.revision += 1;
      }
      store.by_session_id[next.session_id] = next;
      await save(store, next.created_at);
      return clone(next);
    },
  };
}

export function createInMemoryReviewSessionLedgerRepository(seed = []) {
  let store = emptyStore();
  for (const ledger of seed) {
    const normalized = normalizeReviewSessionLedger(ledger);
    store.by_session_id[normalized.session_id] = normalized;
  }
  let queue = Promise.resolve();
  const core = createRepository({
    async load() {
      return clone(store);
    },
    async save(next) {
      store = clone(next);
    },
  });
  return {
    getBySessionId: core.getBySessionId,
    put(...args) {
      const operation = queue.then(() => core.put(...args), () => core.put(...args));
      queue = operation.catch(() => undefined);
      return operation;
    },
    snapshot() {
      return clone(store);
    },
  };
}

function requestResult(request, operation) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(error('TRANSACTION_ABORTED', 'IndexedDB request failed', { operation }));
  });
}

function transactionCompletion(transaction, operation) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(error('TRANSACTION_ABORTED', 'IndexedDB transaction aborted', { operation }));
    transaction.onerror = () => reject(error('TRANSACTION_ABORTED', 'IndexedDB transaction failed', { operation }));
  });
}

function createDatabaseAccessor(indexedDBApi) {
  let databasePromise = null;
  return async () => {
    if (!indexedDBApi || typeof indexedDBApi.open !== 'function') {
      fail('INVALID_FIELD_TYPE', 'IndexedDB is unavailable', { field: 'indexedDBApi' });
    }
    if (databasePromise) return databasePromise;
    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDBApi.open('SeekPlayerDB', 1);
      request.onupgradeneeded = () => {
        try { request.transaction?.abort(); } catch { /* fixed schema only */ }
        reject(error('TRANSACTION_ABORTED', 'Existing SeekPlayerDB schema is required', {
          operation: 'open_database',
        }));
      };
      request.onerror = () => reject(error('TRANSACTION_ABORTED', 'Could not open SeekPlayerDB', {
        operation: 'open_database',
      }));
      request.onsuccess = () => {
        const database = request.result;
        try {
          const probe = database.transaction(['files'], 'readonly').objectStore('files');
          if (database.version !== 1 || probe.keyPath !== 'id') throw new Error('schema');
          resolve(database);
        } catch {
          database.close?.();
          reject(error('TRANSACTION_ABORTED', 'SeekPlayerDB schema is incompatible', {
            operation: 'validate_schema',
          }));
        }
      };
    });
    return databasePromise;
  };
}

export function createIndexedDbReviewSessionLedgerRepository(options = {}) {
  if (!isObject(options) || Object.keys(options).some((key) => key !== 'indexedDBApi')) {
    fail('INVALID_FIELD_TYPE', 'Only indexedDBApi may be configured', { field: 'options' });
  }
  const indexedDBApi = options.indexedDBApi ?? globalThis.indexedDB;
  const database = createDatabaseAccessor(indexedDBApi);
  const run = async (mode, execute) => {
    const db = await database();
    const transaction = db.transaction(['files'], mode);
    const completion = transactionCompletion(transaction, 'review_session_ledger');
    const result = await execute(transaction.objectStore('files'));
    await completion;
    return result;
  };
  const repositoryForStore = (store) => createRepository({
    async load() {
      const row = await requestResult(store.get(SRS_REVIEW_SESSION_LEDGER_ROW_ID), 'get_session_ledgers');
      return normalizeStore(row?.content ?? null);
    },
    async save(content, rowTimestamp) {
      await requestResult(store.put({
        id: SRS_REVIEW_SESSION_LEDGER_ROW_ID,
        content,
        timestamp: rowTimestamp,
      }), 'put_session_ledgers');
    },
  });
  return {
    getBySessionId(sessionId) {
      return run('readonly', (store) => repositoryForStore(store).getBySessionId(sessionId));
    },
    put(ledger, expectedRevision = null) {
      return run(
        'readwrite',
        (store) => repositoryForStore(store).put(ledger, expectedRevision),
      );
    },
  };
}

export function createIndexedDbReviewStateReader(options = {}) {
  if (!isObject(options) || Object.keys(options).some((key) => key !== 'indexedDBApi')) {
    fail('INVALID_FIELD_TYPE', 'Only indexedDBApi may be configured', { field: 'options' });
  }
  const indexedDBApi = options.indexedDBApi ?? globalThis.indexedDB;
  const database = createDatabaseAccessor(indexedDBApi);
  return {
    async getByLearningUnitId(learningUnitId) {
      const db = await database();
      const transaction = db.transaction(['files'], 'readonly');
      const completion = transactionCompletion(transaction, 'read_review_state');
      const store = transaction.objectStore('files');
      const rowPort = {
        transaction_id: `review-state-read:${learningUnitId}`,
        async getRow(rowId) {
          const row = await requestResult(store.get(rowId), 'get_review_state');
          return row === undefined ? null : clone(row);
        },
        async putRow() {
          fail('TRANSACTION_ABORTED', 'Readonly review state reader cannot write', {
            operation: 'put_review_state',
          });
        },
        abort(reason) {
          try { transaction.abort(); } catch { /* preserve reason */ }
          throw reason;
        },
      };
      const result = await bindReviewRepositoryToTransaction(rowPort)
        .getByLearningUnitId(learningUnitId);
      await completion;
      return result;
    },
  };
}
