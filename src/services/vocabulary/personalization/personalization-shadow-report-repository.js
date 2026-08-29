export const PERSONALIZATION_SHADOW_REPORT_SCHEMA_VERSION = 'personalization-shadow-report.v1';
export const PERSONALIZATION_SHADOW_REPORT_STORE_SCHEMA_VERSION = 'personalization-shadow-report-store.v1';
export const PERSONALIZATION_SHADOW_REPORT_ROW_ID = 'vocabulary.personalization.shadow-reports.v1';

function assertVocabularyBrowserWriterAllowed(operation) {
  globalThis?.__windowsOwnerDomainCutover?.assertBrowserWriterAllowed?.('vocabulary-srs', operation);
}

export class PersonalizationShadowReportError extends TypeError {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'PersonalizationShadowReportError';
    this.code = code;
    this.details = clone(details);
  }
}

function fail(code, message, details = {}) {
  throw new PersonalizationShadowReportError(code, message, details);
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function requiredText(value, field) {
  if (typeof value !== 'string' || !value.trim()) {
    fail('INVALID_FIELD_TYPE', `${field} must be a non-empty string`, { field });
  }
  return value.trim();
}

function utcTimestamp(value, field) {
  const normalized = requiredText(value, field);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/u.test(normalized)
    || !Number.isFinite(Date.parse(normalized))) {
    fail('INVALID_TIMESTAMP', `${field} must be a UTC timestamp`, { field });
  }
  return normalized;
}

export function normalizePersonalizationShadowReport(input) {
  if (!isPlainObject(input)) {
    fail('INVALID_FIELD_TYPE', 'shadow report must be a plain object', { field: 'report' });
  }
  if (input.schema_version !== PERSONALIZATION_SHADOW_REPORT_SCHEMA_VERSION) {
    fail('UNSUPPORTED_SCHEMA_VERSION', 'Unsupported shadow report schema', {
      expected: PERSONALIZATION_SHADOW_REPORT_SCHEMA_VERSION,
      actual: input.schema_version ?? null,
    });
  }
  if (!isPlainObject(input.comparison) || !isPlainObject(input.shadow_plan)) {
    fail('INVALID_FIELD_TYPE', 'shadow report requires comparison and shadow_plan objects', {
      field: 'report',
    });
  }
  return {
    schema_version: PERSONALIZATION_SHADOW_REPORT_SCHEMA_VERSION,
    session_id: requiredText(input.session_id, 'session_id'),
    generated_at: utcTimestamp(input.generated_at, 'generated_at'),
    source_event_count: Number.isInteger(input.source_event_count) && input.source_event_count >= 0
      ? input.source_event_count
      : 0,
    adapter_version: requiredText(input.adapter_version, 'adapter_version'),
    skill_estimator_version: requiredText(input.skill_estimator_version, 'skill_estimator_version'),
    preference_estimator_version: requiredText(
      input.preference_estimator_version,
      'preference_estimator_version',
    ),
    curriculum_planner_version: requiredText(
      input.curriculum_planner_version,
      'curriculum_planner_version',
    ),
    diagnostics: clone(isPlainObject(input.diagnostics) ? input.diagnostics : {}),
    comparison: clone(input.comparison),
    shadow_plan: clone(input.shadow_plan),
    model_snapshot: clone(isPlainObject(input.model_snapshot) ? input.model_snapshot : {
      schema_version: 'personalization-shadow-model-snapshot.v1',
      skill_profile: null,
      presentation_preference: null,
      presentation_rankings: null,
      unit_labels: {},
      recent_presentations: {},
    }),
  };
}

function emptyStore() {
  return {
    schema_version: PERSONALIZATION_SHADOW_REPORT_STORE_SCHEMA_VERSION,
    by_session_id: {},
  };
}

function normalizeStore(input) {
  if (input == null) return emptyStore();
  if (!isPlainObject(input)
    || input.schema_version !== PERSONALIZATION_SHADOW_REPORT_STORE_SCHEMA_VERSION
    || !isPlainObject(input.by_session_id)) {
    fail('INVALID_FIELD_TYPE', 'Invalid personalization shadow report store', {
      row_id: PERSONALIZATION_SHADOW_REPORT_ROW_ID,
    });
  }
  const store = emptyStore();
  for (const [sessionId, report] of Object.entries(input.by_session_id)) {
    const normalized = normalizePersonalizationShadowReport(report);
    if (normalized.session_id !== sessionId) {
      fail('INVALID_FIELD_TYPE', 'Shadow report session key mismatch', { session_id: sessionId });
    }
    store.by_session_id[sessionId] = normalized;
  }
  return store;
}

function createRepository(load, save) {
  return {
    async getBySessionId(sessionId) {
      const id = requiredText(sessionId, 'session_id');
      return clone((await load()).by_session_id[id] ?? null);
    },
    async list(options = {}) {
      if (!isPlainObject(options)
        || Object.keys(options).some((key) => key !== 'limit')) {
        fail('INVALID_FIELD_TYPE', 'Only limit may be configured', { field: 'options' });
      }
      const limit = options.limit === undefined ? 50 : options.limit;
      if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
        fail('INVALID_FIELD_TYPE', 'limit must be an integer between 1 and 200', {
          field: 'options.limit',
        });
      }
      return Object.values((await load()).by_session_id)
        .sort((left, right) => right.generated_at.localeCompare(left.generated_at)
          || left.session_id.localeCompare(right.session_id))
        .slice(0, limit)
        .map(clone);
    },
    async put(report) {
      const normalized = normalizePersonalizationShadowReport(report);
      const store = await load();
      store.by_session_id[normalized.session_id] = normalized;
      await save(store, normalized.generated_at);
      return clone(normalized);
    },
    async clear() {
      await save(emptyStore(), new Date(0).toISOString());
    },
  };
}

export function createInMemoryPersonalizationShadowReportRepository(seed = []) {
  let store = emptyStore();
  for (const report of seed) {
    const normalized = normalizePersonalizationShadowReport(report);
    store.by_session_id[normalized.session_id] = normalized;
  }
  let queue = Promise.resolve();
  const repository = createRepository(
    async () => clone(store),
    async (next) => { store = clone(next); },
  );
  return {
    getBySessionId(sessionId) {
      return queue.then(
        () => repository.getBySessionId(sessionId),
        () => repository.getBySessionId(sessionId),
      );
    },
    list(options) {
      return queue.then(() => repository.list(options), () => repository.list(options));
    },
    put(report) {
      const operation = queue.then(() => repository.put(report), () => repository.put(report));
      queue = operation.catch(() => undefined);
      return operation;
    },
    clear() {
      const operation = queue.then(() => repository.clear(), () => repository.clear());
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
    request.onerror = () => reject(new PersonalizationShadowReportError(
      'TRANSACTION_ABORTED',
      'IndexedDB request failed',
      { operation },
    ));
  });
}

function transactionCompletion(transaction, operation) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(new PersonalizationShadowReportError(
      'TRANSACTION_ABORTED',
      'IndexedDB transaction aborted',
      { operation },
    ));
    transaction.onerror = () => reject(new PersonalizationShadowReportError(
      'TRANSACTION_ABORTED',
      'IndexedDB transaction failed',
      { operation },
    ));
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
        reject(new PersonalizationShadowReportError(
          'TRANSACTION_ABORTED',
          'Existing SeekPlayerDB schema is required',
          { operation: 'open_database' },
        ));
      };
      request.onerror = () => reject(new PersonalizationShadowReportError(
        'TRANSACTION_ABORTED',
        'Could not open SeekPlayerDB',
        { operation: 'open_database' },
      ));
      request.onsuccess = () => {
        const database = request.result;
        try {
          const probe = database.transaction(['files'], 'readonly').objectStore('files');
          if (database.version !== 1 || probe.keyPath !== 'id') throw new Error('schema');
          resolve(database);
        } catch {
          database.close?.();
          reject(new PersonalizationShadowReportError(
            'TRANSACTION_ABORTED',
            'SeekPlayerDB schema is incompatible',
            { operation: 'validate_schema' },
          ));
        }
      };
    });
    return databasePromise;
  };
}

export function createIndexedDbPersonalizationShadowReportRepository(options = {}) {
  if (!isPlainObject(options)
    || Object.keys(options).some((key) => key !== 'indexedDBApi')) {
    fail('INVALID_FIELD_TYPE', 'Only indexedDBApi may be configured', { field: 'options' });
  }
  const database = createDatabaseAccessor(options.indexedDBApi ?? globalThis.indexedDB);
  const run = async (mode, execute) => {
    if (mode === 'readwrite') assertVocabularyBrowserWriterAllowed('personalization_shadow_report');
    const db = await database();
    const transaction = db.transaction(['files'], mode);
    const completion = transactionCompletion(transaction, 'personalization_shadow_report');
    const result = await execute(transaction.objectStore('files'));
    await completion;
    return result;
  };
  const repositoryForStore = (store) => createRepository(
    async () => {
      const row = await requestResult(store.get(PERSONALIZATION_SHADOW_REPORT_ROW_ID), 'get_shadow_reports');
      return normalizeStore(row?.content ?? null);
    },
    async (content, timestamp) => requestResult(store.put({
      id: PERSONALIZATION_SHADOW_REPORT_ROW_ID,
      content,
      timestamp,
    }), 'put_shadow_reports'),
  );
  return {
    getBySessionId(sessionId) {
      return run('readonly', (store) => repositoryForStore(store).getBySessionId(sessionId));
    },
    list(options) {
      return run('readonly', (store) => repositoryForStore(store).list(options));
    },
    put(report) {
      return run('readwrite', (store) => repositoryForStore(store).put(report));
    },
    clear() {
      return run('readwrite', (store) => repositoryForStore(store).clear());
    },
  };
}
