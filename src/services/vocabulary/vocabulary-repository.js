import {
  VOCABULARY_STORE_KEY,
  cloneVocabularyValue,
  normalizeLanguage,
  normalizeLookupKey,
  normalizeVocabularySnapshot,
} from './vocabulary-models.js';
import {
  backupRowId,
  checksumFor,
  clonePersistenceValue,
  hasValidChecksum,
  makeQuarantineRow,
} from './vocabulary-persistence.js';

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

function normalizeIndexedDbError(error, operation) {
  if (error?.name === 'VocabularyPersistenceError') return error;
  if (error?.name === 'QuotaExceededError' || error?.code === 'QUOTA_EXCEEDED') {
    return vocabularyPersistenceError('QUOTA_EXCEEDED', 'Vocabulary persistence quota was exceeded', { operation });
  }
  if (error?.name === 'InvalidStateError' || error?.name === 'TransactionInactiveError') {
    return vocabularyPersistenceError('CONNECTION_CLOSED', 'Vocabulary persistence connection was closed', { operation });
  }
  if (error?.name === 'VersionError' || error?.name === 'NotFoundError') {
    return vocabularyPersistenceError('UNKNOWN_SCHEMA', 'Vocabulary persistence schema is unsupported', { operation });
  }
  if (error?.name === 'AbortError') {
    return vocabularyPersistenceError('TRANSACTION_ABORTED', 'Vocabulary transaction was aborted', { operation });
  }
  return vocabularyPersistenceError('TRANSACTION_ABORTED', `Vocabulary ${operation} failed`, { operation });
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isCurrentSnapshotShape(snapshot) {
  return isPlainObject(snapshot)
    && snapshot.schemaVersion === CURRENT_SCHEMA_VERSION
    && Array.isArray(snapshot.words)
    && Array.isArray(snapshot.contexts)
    && Array.isArray(snapshot.reviewStates)
    && Array.isArray(snapshot.reviewLogs);
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
  let highestObservedRevision = 0;

  function rememberRevision(revision) {
    if (Number.isInteger(revision) && revision >= 0) {
      highestObservedRevision = Math.max(highestObservedRevision, revision);
    }
  }

  function openDb() {
    if (!indexedDBApi) throw new Error('IndexedDB is unavailable for vocabulary storage');
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      let request;
      try {
        request = indexedDBApi.open(dbName, dbVersion);
      } catch (error) {
        reject(normalizeIndexedDbError(error, 'open_database'));
        return;
      }
      request.onerror = () => reject(normalizeIndexedDbError(request.error, 'open_database'));
      request.onblocked = () => reject(vocabularyPersistenceError('CONNECTION_BLOCKED', 'Vocabulary database open was blocked', {
        operation: 'open_database',
      }));
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(storeName)) {
          try { request.transaction?.abort(); } catch { /* Existing schema is required. */ }
          reject(vocabularyPersistenceError('UNKNOWN_SCHEMA', 'Vocabulary database schema is not initialized', {
            operation: 'open_database',
          }));
        }
      };
      request.onsuccess = (event) => {
        const db = event.target.result;
        try {
          if (db.version !== dbVersion || !db.objectStoreNames.contains(storeName)) {
            throw vocabularyPersistenceError('UNKNOWN_SCHEMA', 'Vocabulary database schema is unsupported', {
              operation: 'validate_database',
            });
          }
          const probe = db.transaction([storeName], 'readonly').objectStore(storeName);
          if (probe.keyPath !== 'id') throw vocabularyPersistenceError('UNKNOWN_SCHEMA', 'Vocabulary files key path is unsupported', {
            operation: 'validate_database',
          });
          db.onversionchange = () => {
            db.close?.();
            dbPromise = null;
          };
          resolve(db);
        } catch (error) {
          db.close?.();
          reject(normalizeIndexedDbError(error, 'validate_database'));
        }
      };
    });
    dbPromise.catch(() => { dbPromise = null; });
    return dbPromise;
  }

  function isValidSnapshotBackup(candidate) {
    if (!candidate?.content
      || candidate.content.schema_version !== 'vocabulary-backup.v1'
      || candidate.content.sourceId !== storageKey
      || !hasValidChecksum(candidate)) return false;
    const sourceRow = candidate.content.sourceRow;
    if (!sourceRow || sourceRow.id !== storageKey || !Object.prototype.hasOwnProperty.call(sourceRow, 'content')) {
      return false;
    }
    if (sourceRow.checksum !== undefined && !hasValidChecksum(sourceRow)) return false;
    const sourceVersion = sourceRow.content && typeof sourceRow.content === 'object'
      ? sourceRow.content.schemaVersion
      : undefined;
    if (sourceVersion !== undefined && sourceVersion !== 0 && sourceVersion !== CURRENT_SCHEMA_VERSION) {
      return false;
    }
    if (sourceVersion === CURRENT_SCHEMA_VERSION && !isCurrentSnapshotShape(sourceRow.content)) return false;
    try {
      normalizeVocabularySnapshot(sourceRow.content);
      return true;
    } catch {
      return false;
    }
  }

  async function loadRecord(migrationAttempt = 0) {
    const db = await openDb();
    const row = await readRow(db, 'readonly', storageKey);
    const record = {
      snapshot: row && row.content ? row.content : null,
      revision: Number.isInteger(row?.revision) && row.revision >= 0 ? row.revision : 0,
      row,
    };
    rememberRevision(record.revision);
    const snapshot = record.snapshot;
    const sourceVersion = snapshot && typeof snapshot === 'object' && snapshot.schemaVersion !== undefined
      ? snapshot.schemaVersion
      : 0;
    if (snapshot === null) return record;
    if (sourceVersion === CURRENT_SCHEMA_VERSION) {
      if (record.row?.checksum && !hasValidChecksum(record.row)) {
        return recoverCorruptRecord(record.row, 'checksum-mismatch');
      }
      if (!isCurrentSnapshotShape(snapshot)) {
        return recoverCorruptRecord(record.row, 'invalid-content');
      }
      try {
        normalizeVocabularySnapshot(snapshot);
      } catch {
        return recoverCorruptRecord(record.row, 'invalid-content');
      }
      return record;
    }
    if (!migrationRegistry.has(sourceVersion)) {
      throw vocabularyPersistenceError('UNKNOWN_SCHEMA', 'Vocabulary snapshot schema is unsupported', {
        schemaVersion: sourceVersion,
      });
    }
    if (record.row?.checksum && !hasValidChecksum(record.row)) {
      return recoverCorruptRecord(record.row, 'checksum-mismatch');
    }
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
    if (!isCurrentSnapshotShape(migrated)) {
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
        const backupId = backupRowId(storageKey, currentRevision);
        const migratedContent = normalizeVocabularySnapshot(migrated);
        const backupContent = {
          schema_version: 'vocabulary-backup.v1',
          sourceId: storageKey,
          sourceRow: cloneVocabularyValue(sourceRow),
          createdAt: migratedAt,
          fromSchemaVersion: sourceVersion,
          toSchemaVersion: CURRENT_SCHEMA_VERSION,
          migratedAt,
        };
        const backupRequest = store.put({
          id: backupId,
          content: backupContent,
          revision: currentRevision,
          timestamp: new Date(migratedAt).toISOString(),
          checksum: checksumFor(backupContent),
        });
        backupRequest.onerror = () => rejectOnce(backupRequest.error || new Error('Failed to back up vocabulary migration source'));
        backupRequest.onsuccess = () => {
          migratedRecord = {
            snapshot: migratedContent,
            revision: Math.max(currentRevision, highestObservedRevision) + 1,
          };
          rememberRevision(migratedRecord.revision);
          const writeRequest = store.put({
            id: storageKey,
            content: migratedRecord.snapshot,
            revision: migratedRecord.revision,
            timestamp: new Date(migratedAt).toISOString(),
            checksum: checksumFor(migratedRecord.snapshot),
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
        rememberRevision(currentRevision);
        if (row?.checksum && !hasValidChecksum(row)) {
          rejectOnce(vocabularyPersistenceError('CORRUPT', 'Vocabulary snapshot checksum does not match its content', {
            sourceId: storageKey,
            revision: row.revision ?? null,
          }));
          try { transaction.abort(); } catch { /* Corrupt data is already classified. */ }
          return;
        }
        if (currentRevision !== expectedRevision) {
          rejectOnce(vocabularyPersistenceError('REVISION_CONFLICT', 'Vocabulary snapshot revision changed', {
            expectedRevision,
            actualRevision: currentRevision,
          }));
          try { transaction.abort(); } catch { /* Conflict is already reported. */ }
          return;
        }
        nextRevision = Math.max(currentRevision, highestObservedRevision) + 1;
        rememberRevision(nextRevision);
        const nextContent = normalizeVocabularySnapshot(snapshot);
        const timestamp = new Date(Number(now())).toISOString();
        const writes = [];
        if (row && row.content && (row.checksum === undefined || hasValidChecksum(row))) {
          const backupContent = {
            schema_version: 'vocabulary-backup.v1',
            sourceId: storageKey,
            sourceRow: cloneVocabularyValue(row),
            createdAt: Number(now()),
          };
          writes.push(store.put({
            id: backupRowId(storageKey, currentRevision),
            content: backupContent,
            revision: currentRevision,
            timestamp,
            checksum: checksumFor(backupContent),
          }));
        }
        writes.push(store.put({
          id: storageKey,
          content: nextContent,
          revision: nextRevision,
          timestamp,
          checksum: checksumFor(nextContent),
        }));
        writes.forEach((writeRequest) => {
          writeRequest.onerror = () => rejectOnce(normalizeIndexedDbError(writeRequest.error, 'write_snapshot'));
        });
      };
      transaction.oncomplete = () => {
        if (settled) return;
        settled = true;
        resolve(nextRevision);
      };
      transaction.onerror = () => rejectOnce(normalizeIndexedDbError(transaction.error, 'transaction'));
      transaction.onabort = () => {
        if (!settled) rejectOnce(normalizeIndexedDbError(transaction.error, 'transaction'));
      };

      function rejectOnce(error) {
        if (settled) return;
        settled = true;
        reject(error);
      }
    });
  }

  async function readRow(db, mode, id) {
    return new Promise((resolve, reject) => {
      let row;
      let settled = false;
      let transaction;
      try {
        transaction = db.transaction([storeName], mode);
        const store = transaction.objectStore(storeName);
        const request = store.get(id);
        request.onerror = () => rejectOnce(normalizeIndexedDbError(request.error, 'read_snapshot'));
        request.onsuccess = () => { row = request.result; };
        transaction.oncomplete = () => {
          if (settled) return;
          settled = true;
          resolve(row || null);
        };
        transaction.onerror = () => rejectOnce(normalizeIndexedDbError(transaction.error, 'read_snapshot'));
        transaction.onabort = () => rejectOnce(normalizeIndexedDbError(transaction.error, 'read_snapshot'));
      } catch (error) {
        rejectOnce(normalizeIndexedDbError(error, 'read_snapshot'));
      }
      function rejectOnce(error) {
        if (settled) return;
        settled = true;
        reject(error);
      }
    });
  }

  async function recoverCorruptRecord(row, reason) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      let settled = false;
      let recovered = null;
      let recoveryError = null;
      try {
        const transaction = db.transaction([storeName], 'readwrite');
        const store = transaction.objectStore(storeName);
        const allRequest = store.getAll();
        allRequest.onerror = () => rejectOnce(normalizeIndexedDbError(allRequest.error, 'recover_snapshot'));
        allRequest.onsuccess = () => {
          const rows = Array.isArray(allRequest.result) ? allRequest.result : [];
          const backups = rows
            .filter((candidate) => candidate?.id?.startsWith(`${storageKey}.backup:`))
            .filter(isValidSnapshotBackup)
            .sort((left, right) => {
              const rightRevision = Math.max(
                Number.isInteger(right.revision) ? right.revision : 0,
                Number.isInteger(right.content?.sourceRow?.revision) ? right.content.sourceRow.revision : 0,
              );
              const leftRevision = Math.max(
                Number.isInteger(left.revision) ? left.revision : 0,
                Number.isInteger(left.content?.sourceRow?.revision) ? left.content.sourceRow.revision : 0,
              );
              return rightRevision - leftRevision;
            });
          const backup = backups[0];
          const quarantine = makeQuarantineRow({
            sourceId: storageKey,
            sourceRow: row,
            reason,
            detectedAt: new Date(Number(now())).toISOString(),
            details: { revision: row?.revision ?? null },
          });
          const quarantineRequest = store.put(quarantine);
          quarantineRequest.onerror = () => rejectOnce(normalizeIndexedDbError(quarantineRequest.error, 'quarantine_snapshot'));
          if (!backup) {
            recoveryError = vocabularyPersistenceError('CORRUPT', 'Vocabulary snapshot is corrupt and has no valid backup', {
              sourceId: storageKey,
              quarantineId: quarantine.id,
              reason,
            });
            return;
          }
          const sourceRow = backup.content.sourceRow;
          const backupRevision = Number.isInteger(backup.revision) && backup.revision >= 0
            ? backup.revision
            : 0;
          const sourceRevision = Number.isInteger(sourceRow.revision) && sourceRow.revision >= 0
            ? sourceRow.revision
            : 0;
          const damagedRevision = Number.isInteger(row?.revision) && row.revision >= 0
            ? row.revision
            : 0;
          const recoveryRevision = Math.max(
            highestObservedRevision,
            damagedRevision,
            backupRevision,
            sourceRevision,
          ) + 1;
          rememberRevision(recoveryRevision);
          const recoveryTimestamp = new Date(Number(now())).toISOString();
          const recoveredRow = {
            ...clonePersistenceValue(sourceRow),
            revision: recoveryRevision,
            timestamp: recoveryTimestamp,
            checksum: checksumFor(sourceRow.content),
          };
          recovered = {
            snapshot: cloneVocabularyValue(sourceRow.content),
            revision: recoveryRevision,
            row: recoveredRow,
          };
          const restoreRequest = store.put(recoveredRow);
          restoreRequest.onerror = () => rejectOnce(normalizeIndexedDbError(restoreRequest.error, 'restore_snapshot'));
        };
        transaction.oncomplete = () => {
          if (settled) return;
          settled = true;
          if (recoveryError) reject(recoveryError);
          else resolve(recovered);
        };
        transaction.onerror = () => rejectOnce(normalizeIndexedDbError(transaction.error, 'recover_snapshot'));
        transaction.onabort = () => rejectOnce(normalizeIndexedDbError(transaction.error, 'recover_snapshot'));
      } catch (error) {
        rejectOnce(normalizeIndexedDbError(error, 'recover_snapshot'));
      }
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

  async function compareAndSwapSnapshot(nextSnapshot, expectedRevision) {
    if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
      throw vocabularyPersistenceError('INVALID_FIELD_TYPE', 'Vocabulary expected revision is invalid', {
        expectedRevision,
      });
    }
    return storage.compareAndSwap(normalizeKnownSnapshot(nextSnapshot), expectedRevision);
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
    compareAndSwap: compareAndSwapSnapshot,
    findWordByLemma,
    getWord,
    getReviewState,
    getContextsForWord,
    getReviewLogs,
    getReviewLogsForWord,
  };
}
