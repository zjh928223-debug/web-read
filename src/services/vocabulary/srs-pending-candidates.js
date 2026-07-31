import {
  cloneVocabularyValue,
  normalizeText,
  toIsoString,
} from './vocabulary-models.js';

export const VOCABULARY_PENDING_CANDIDATES_STORE_KEY = 'vocabulary-srs-pending-candidates';

const DB_NAME = 'SeekPlayerDB';
const DB_VERSION = 1;
const STORE_NAME = 'files';

function createEmptyPendingStore() {
  return {
    schemaVersion: 1,
    groups: {},
  };
}

function normalizePendingCandidate(candidate) {
  if (!candidate || typeof candidate !== 'object') return null;
  const lemma = normalizeText(candidate.lemma);
  const targetId = normalizeText(candidate.target_id || candidate.targetId);
  if (!lemma || !targetId) return null;
  return {
    ...cloneVocabularyValue(candidate),
    target_id: targetId,
    targetId,
    lemma,
  };
}

function normalizePendingExcluded(item) {
  if (!item || typeof item !== 'object') return null;
  const targetId = normalizeText(item.target_id || item.targetId);
  if (!targetId) return null;
  return {
    ...cloneVocabularyValue(item),
    target_id: targetId,
    targetId,
    reason: normalizeText(item.reason || 'excluded'),
  };
}

function normalizePendingGroup(group) {
  if (!group || typeof group !== 'object') return null;
  const scopeKey = normalizeText(group.scopeKey || group.scope_key);
  const candidates = Array.isArray(group.candidates)
    ? group.candidates.map(normalizePendingCandidate).filter(Boolean)
    : [];
  const excluded = Array.isArray(group.excluded)
    ? group.excluded.map(normalizePendingExcluded).filter(Boolean)
    : [];
  if (!scopeKey || (!candidates.length && !excluded.length)) return null;
  const createdAt = toIsoString(group.created_at || group.createdAt || new Date());
  return {
    scopeKey,
    candidates,
    excluded,
    created_at: createdAt,
    updated_at: toIsoString(group.updated_at || group.updatedAt || createdAt),
  };
}

function normalizePendingStore(store) {
  const source = store && typeof store === 'object' ? store : {};
  const groups = {};
  Object.entries(source.groups || {}).forEach(([key, group]) => {
    const normalized = normalizePendingGroup({ ...group, scopeKey: group && group.scopeKey || key });
    if (normalized) groups[normalized.scopeKey] = normalized;
  });
  return {
    schemaVersion: 1,
    groups,
  };
}

export function createInMemorySrsPendingCandidatesRepository(initialStore) {
  let store = normalizePendingStore(initialStore);
  return createSrsPendingCandidatesRepository({
    async loadStore() {
      return store;
    },
    async saveStore(nextStore) {
      store = normalizePendingStore(nextStore);
    },
  });
}

export function createIndexedDbSrsPendingCandidatesRepository(options = {}) {
  const indexedDBApi = options.indexedDBApi || (typeof globalThis !== 'undefined' ? globalThis.indexedDB : null);
  const dbName = options.dbName || DB_NAME;
  const dbVersion = options.dbVersion || DB_VERSION;
  const storeName = options.storeName || STORE_NAME;
  const storageKey = options.storageKey || VOCABULARY_PENDING_CANDIDATES_STORE_KEY;
  let dbPromise = null;

  function openDb() {
    if (!indexedDBApi) throw new Error('IndexedDB is unavailable for SRS pending candidate storage');
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDBApi.open(dbName, dbVersion);
      request.onerror = () => reject(request.error || new Error('Failed to open SRS pending IndexedDB'));
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

  async function loadStore() {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([storeName], 'readonly');
      const store = transaction.objectStore(storeName);
      const request = store.get(storageKey);
      request.onerror = () => reject(request.error || new Error('Failed to load SRS pending candidates'));
      request.onsuccess = () => {
        const row = request.result;
        resolve(row && row.content ? row.content : null);
      };
    });
  }

  async function saveStore(store) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([storeName], 'readwrite');
      const objectStore = transaction.objectStore(storeName);
      const request = objectStore.put({
        id: storageKey,
        content: normalizePendingStore(store),
        timestamp: Date.now(),
      });
      request.onerror = () => reject(request.error || new Error('Failed to save SRS pending candidates'));
      request.onsuccess = () => resolve();
    });
  }

  return createSrsPendingCandidatesRepository({ loadStore, saveStore });
}

export function createSrsPendingCandidatesRepository(storage) {
  if (!storage || typeof storage.loadStore !== 'function' || typeof storage.saveStore !== 'function') {
    throw new Error('SRS pending candidate repository requires loadStore and saveStore');
  }

  async function loadStore() {
    return cloneVocabularyValue(normalizePendingStore(await storage.loadStore()));
  }

  async function saveStore(store) {
    await storage.saveStore(normalizePendingStore(store));
  }

  async function getPendingCandidates(scopeKey) {
    const normalizedScopeKey = normalizeText(scopeKey);
    if (!normalizedScopeKey) return null;
    const store = await loadStore();
    return cloneVocabularyValue(store.groups[normalizedScopeKey] || null);
  }

  async function setPendingCandidates(scopeKey, group) {
    const normalizedScopeKey = normalizeText(scopeKey || group && group.scopeKey);
    if (!normalizedScopeKey) throw new Error('SRS pending candidates require a scope key');
    const store = await loadStore();
    const normalizedGroup = normalizePendingGroup({
      ...group,
      scopeKey: normalizedScopeKey,
      updated_at: new Date(),
    });
    if (!normalizedGroup) {
      delete store.groups[normalizedScopeKey];
    } else {
      store.groups[normalizedScopeKey] = normalizedGroup;
    }
    await saveStore(store);
    return cloneVocabularyValue(store.groups[normalizedScopeKey] || null);
  }

  async function clearPendingCandidates(scopeKey) {
    const normalizedScopeKey = normalizeText(scopeKey);
    if (!normalizedScopeKey) return;
    const store = await loadStore();
    delete store.groups[normalizedScopeKey];
    await saveStore(store);
  }

  return {
    loadStore,
    saveStore,
    getPendingCandidates,
    setPendingCandidates,
    clearPendingCandidates,
  };
}
