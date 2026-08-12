import {
  VOCABULARY_STORE_KEY,
  cloneVocabularyValue,
  normalizeLanguage,
  normalizeLookupKey,
  normalizeVocabularySnapshot,
} from './vocabulary-models.js';

const DB_NAME = 'SeekPlayerDB';
const DB_VERSION = 1;
const STORE_NAME = 'files';
const MAX_CAS_ATTEMPTS = 8;
const CURRENT_SCHEMA_VERSION = 1;
const DEFAULT_MIGRATIONS = new Map([
  [0, (snapshot) => ({ ...snapshot, schemaVersion: CURRENT_SCHEMA_VERSION })],
]);

function vocabularyPersistenceError(code, message, details = {}) {
  const error = new Error(message);
  error.name = 'VocabularyPersistenceError';
  error.code = code;
  error.details = details;
  return error;
}

export function createInMemoryVocabularyRepository(initialSnapshot) {
  let snapshot = normalizeVocabularySnapshot(initialSnapshot);
  let revision = 0;
  return createVocabularyRepository({
    async loadRecord() {
      return { snapshot, revision };
    },
    async compareAndSwap(nextSnapshot, expectedRevision) {
      if (revision !== expectedRevision) {
        throw vocabularyPersistenceError('REVISION_CONFLICT', 'Vocabulary snapshot revision changed', {
          expectedRevision,
          actualRevision: revision,
        });
      }
      snapshot = normalizeVocabularySnapshot(nextSnapshot);
      revision += 1;
      return revision;
    },
  });
}

export function createIndexedDbVocabularyRepository(options = {}) {
  const indexedDBApi = options.indexedDBApi || (typeof globalThis !== 'undefined' ? globalThis.indexedDB : null);
  const dbName = options.dbName || DB_NAME;
  const dbVersion = options.dbVersion || DB_VERSION;
  const storeName = options.storeName || STORE_NAME;
  const storageKey = options.storageKey || VOCABULARY_STORE_KEY;
  const migrationRegistry = options.migrationRegistry || DEFAULT_MIGRATIONS;
  const now = options.now || Date.now;
  let dbPromise = null;

  function openDb() {
    if (!indexedDBApi) throw new Error('IndexedDB is unavailable for vocabulary storage');
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDBApi.open(dbName, dbVersion);
      request.onerror = () => reject(request.error || new Error('Failed to open vocabulary IndexedDB'));
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(storeName)) {
          db.createObjectStore(storeName, { keyPath: 'id' });
        }
      };
      request.onsuccess = (event) => resolve(event.target.result);
    });
    return dbPromise;
  }

  async function loadRecord(migrationAttempt = 0) {
    const db = await openDb();
    const record = await new Promise((resolve, reject) => {
      const transaction = db.transaction([storeName], 'readonly');
      const store = transaction.objectStore(storeName);
      const request = store.get(storageKey);
      request.onerror = () => reject(request.error || new Error('Failed to load vocabulary snapshot'));
      request.onsuccess = () => {
        const row = request.result;
        resolve({
          snapshot: row && row.content ? row.content : null,
          revision: Number.isInteger(row?.revision) && row.revision >= 0 ? row.revision : 0,
        });
      };
    });
    const snapshot = record.snapshot;
    const sourceVersion = snapshot && typeof snapshot === 'object' && snapshot.schemaVersion !== undefined
      ? snapshot.schemaVersion
      : 0;
    if (sourceVersion === CURRENT_SCHEMA_VERSION || snapshot === null) return record;
    if (!migrationRegistry.has(sourceVersion)) return record;
    try {
      return await migrateRecord(record, sourceVersion);
    } catch (error) {
      if (error?.code === 'REVISION_CONFLICT' && migrationAttempt < MAX_CAS_ATTEMPTS - 1) {
        return loadRecord(migrationAttempt + 1);
      }
      throw error;
    }
  }

  async function migrateRecord(record, sourceVersion) {
    const migrate = migrationRegistry.get(sourceVersion);
    if (typeof migrate !== 'function') {
      throw vocabularyPersistenceError('MIGRATION_NOT_REGISTERED', 'Vocabulary migration is not registered', {
        schemaVersion: sourceVersion,
      });
    }
    const migrated = await migrate(cloneVocabularyValue(record.snapshot));
    if (!migrated || typeof migrated !== 'object' || migrated.schemaVersion !== CURRENT_SCHEMA_VERSION) {
      throw vocabularyPersistenceError('MIGRATION_INVALID', 'Vocabulary migration did not produce the current schema', {
        fromSchemaVersion: sourceVersion,
        toSchemaVersion: migrated?.schemaVersion ?? null,
      });
    }
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([storeName], 'readwrite');
      const store = transaction.objectStore(storeName);
      let settled = false;
      let migratedRecord = null;
      const readRequest = store.get(storageKey);
      readRequest.onerror = () => rejectOnce(readRequest.error || new Error('Failed to verify vocabulary migration source'));
      readRequest.onsuccess = () => {
        const sourceRow = readRequest.result;
        const currentRevision = Number.isInteger(sourceRow?.revision) && sourceRow.revision >= 0 ? sourceRow.revision : 0;
        if (currentRevision !== record.revision) {
          rejectOnce(vocabularyPersistenceError('REVISION_CONFLICT', 'Vocabulary snapshot changed before migration', {
            expectedRevision: record.revision,
            actualRevision: currentRevision,
          }));
          try { transaction.abort(); } catch { /* Conflict is already reported. */ }
          return;
        }
        const migratedAt = Number(now());
        const backupId = `${storageKey}.backup:${sourceVersion}:${currentRevision}`;
        const backupRequest = store.put({
          id: backupId,
          content: {
            schemaVersion: 1,
            fromSchemaVersion: sourceVersion,
            toSchemaVersion: CURRENT_SCHEMA_VERSION,
            migratedAt,
            sourceRow: cloneVocabularyValue(sourceRow),
          },
          timestamp: migratedAt,
        });
        backupRequest.onerror = () => rejectOnce(backupRequest.error || new Error('Failed to back up vocabulary migration source'));
        backupRequest.onsuccess = () => {
          migratedRecord = {
            snapshot: normalizeVocabularySnapshot(migrated),
            revision: currentRevision + 1,
          };
          const writeRequest = store.put({
            id: storageKey,
            content: migratedRecord.snapshot,
            revision: migratedRecord.revision,
            timestamp: migratedAt,
            migratedFrom: sourceVersion,
            migrationBackupId: backupId,
          });
          writeRequest.onerror = () => rejectOnce(writeRequest.error || new Error('Failed to write migrated vocabulary snapshot'));
        };
      };
      transaction.oncomplete = () => {
        if (settled) return;
        settled = true;
        resolve(migratedRecord);
      };
      transaction.onerror = () => rejectOnce(transaction.error || new Error('Vocabulary migration transaction failed'));
      transaction.onabort = () => {
        if (!settled) rejectOnce(transaction.error || new Error('Vocabulary migration transaction aborted'));
      };
      function rejectOnce(error) {
        if (settled) return;
        settled = true;
        reject(error);
      }
    });
  }

  async function compareAndSwap(snapshot, expectedRevision) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([storeName], 'readwrite');
      const store = transaction.objectStore(storeName);
      let nextRevision = null;
      let settled = false;
      const readRequest = store.get(storageKey);
      readRequest.onerror = () => rejectOnce(readRequest.error || new Error('Failed to load vocabulary revision'));
      readRequest.onsuccess = () => {
        const row = readRequest.result;
        const currentRevision = Number.isInteger(row?.revision) && row.revision >= 0 ? row.revision : 0;
        if (currentRevision !== expectedRevision) {
          rejectOnce(vocabularyPersistenceError('REVISION_CONFLICT', 'Vocabulary snapshot revision changed', {
            expectedRevision,
            actualRevision: currentRevision,
          }));
          try { transaction.abort(); } catch { /* Conflict is already reported. */ }
          return;
        }
        nextRevision = currentRevision + 1;
        const writeRequest = store.put({
          id: storageKey,
          content: normalizeVocabularySnapshot(snapshot),
          revision: nextRevision,
          timestamp: Number(now()),
        });
        writeRequest.onerror = () => rejectOnce(writeRequest.error || new Error('Failed to save vocabulary snapshot'));
      };
      transaction.oncomplete = () => {
        if (settled) return;
        settled = true;
        resolve(nextRevision);
      };
      transaction.onerror = () => rejectOnce(transaction.error || new Error('Vocabulary transaction failed'));
      transaction.onabort = () => {
        if (!settled) rejectOnce(transaction.error || new Error('Vocabulary transaction aborted'));
      };

      function rejectOnce(error) {
        if (settled) return;
        settled = true;
        reject(error);
      }
    });
  }

  return createVocabularyRepository({ loadRecord, compareAndSwap });
}

export function createVocabularyRepository(storage) {
  if (!storage || typeof storage.loadRecord !== 'function' || typeof storage.compareAndSwap !== 'function') {
    throw new Error('Vocabulary repository requires revision-aware loadRecord and compareAndSwap storage methods');
  }

  async function loadSnapshot() {
    const record = await storage.loadRecord();
    return cloneVocabularyValue(normalizeKnownSnapshot(record?.snapshot));
  }

  async function updateSnapshot(mutator) {
    for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt += 1) {
      const record = await storage.loadRecord();
      const snapshot = normalizeKnownSnapshot(record?.snapshot);
      const result = await mutator(snapshot);
      try {
        await storage.compareAndSwap(snapshot, record.revision);
        return cloneVocabularyValue(result);
      } catch (error) {
        if (error?.code !== 'REVISION_CONFLICT' || attempt === MAX_CAS_ATTEMPTS - 1) throw error;
      }
    }
    throw vocabularyPersistenceError('REVISION_CONFLICT', 'Vocabulary snapshot update retry limit reached');
  }

  function normalizeKnownSnapshot(snapshot) {
    if (snapshot !== null && snapshot !== undefined) {
      const schemaVersion = snapshot && typeof snapshot === 'object' ? snapshot.schemaVersion : null;
      if (schemaVersion !== undefined && schemaVersion !== 1) {
        throw vocabularyPersistenceError('UNKNOWN_SCHEMA', 'Vocabulary snapshot schema is unsupported', {
          schemaVersion: schemaVersion ?? null,
        });
      }
    }
    return normalizeVocabularySnapshot(snapshot);
  }

  async function findWordByLemma(lemma, options = {}) {
    const lookupKey = normalizeLookupKey(lemma);
    const language = normalizeLanguage(options.language);
    const snapshot = await loadSnapshot();
    return cloneVocabularyValue(snapshot.words.find((word) => (
      word.lookup_key === lookupKey && word.language === language
    )) || null);
  }

  async function getWord(wordId) {
    const snapshot = await loadSnapshot();
    return cloneVocabularyValue(snapshot.words.find((word) => word.id === wordId) || null);
  }

  async function getReviewState(wordId) {
    const snapshot = await loadSnapshot();
    return cloneVocabularyValue(snapshot.reviewStates.find((state) => state.word_id === wordId) || null);
  }

  async function getContextsForWord(wordId) {
    const snapshot = await loadSnapshot();
    return snapshot.contexts
      .filter((context) => context.word_id === wordId)
      .map(cloneVocabularyValue);
  }

  async function getReviewLogsForWord(wordId) {
    const snapshot = await loadSnapshot();
    return snapshot.reviewLogs
      .filter((log) => log.word_id === wordId)
      .map(cloneVocabularyValue);
  }

  async function getReviewLogs() {
    const snapshot = await loadSnapshot();
    return snapshot.reviewLogs.map(cloneVocabularyValue);
  }

  return {
    loadSnapshot,
    updateSnapshot,
    findWordByLemma,
    getWord,
    getReviewState,
    getContextsForWord,
    getReviewLogs,
    getReviewLogsForWord,
  };
}
