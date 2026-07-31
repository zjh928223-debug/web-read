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

export function createInMemoryVocabularyRepository(initialSnapshot) {
  let snapshot = normalizeVocabularySnapshot(initialSnapshot);
  return createVocabularyRepository({
    async loadSnapshot() {
      return snapshot;
    },
    async saveSnapshot(nextSnapshot) {
      snapshot = normalizeVocabularySnapshot(nextSnapshot);
    },
  });
}

export function createIndexedDbVocabularyRepository(options = {}) {
  const indexedDBApi = options.indexedDBApi || (typeof globalThis !== 'undefined' ? globalThis.indexedDB : null);
  const dbName = options.dbName || DB_NAME;
  const dbVersion = options.dbVersion || DB_VERSION;
  const storeName = options.storeName || STORE_NAME;
  const storageKey = options.storageKey || VOCABULARY_STORE_KEY;
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

  async function loadSnapshot() {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([storeName], 'readonly');
      const store = transaction.objectStore(storeName);
      const request = store.get(storageKey);
      request.onerror = () => reject(request.error || new Error('Failed to load vocabulary snapshot'));
      request.onsuccess = () => {
        const row = request.result;
        resolve(row && row.content ? row.content : null);
      };
    });
  }

  async function saveSnapshot(snapshot) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([storeName], 'readwrite');
      const store = transaction.objectStore(storeName);
      const request = store.put({
        id: storageKey,
        content: normalizeVocabularySnapshot(snapshot),
        timestamp: Date.now(),
      });
      request.onerror = () => reject(request.error || new Error('Failed to save vocabulary snapshot'));
      request.onsuccess = () => resolve();
    });
  }

  return createVocabularyRepository({ loadSnapshot, saveSnapshot });
}

export function createVocabularyRepository(storage) {
  if (!storage || typeof storage.loadSnapshot !== 'function' || typeof storage.saveSnapshot !== 'function') {
    throw new Error('Vocabulary repository requires loadSnapshot and saveSnapshot storage methods');
  }

  async function loadSnapshot() {
    return cloneVocabularyValue(normalizeVocabularySnapshot(await storage.loadSnapshot()));
  }

  async function saveSnapshot(snapshot) {
    await storage.saveSnapshot(normalizeVocabularySnapshot(snapshot));
  }

  async function updateSnapshot(mutator) {
    const snapshot = normalizeVocabularySnapshot(await storage.loadSnapshot());
    const result = await mutator(snapshot);
    await storage.saveSnapshot(snapshot);
    return cloneVocabularyValue(result);
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
    saveSnapshot,
    updateSnapshot,
    findWordByLemma,
    getWord,
    getReviewState,
    getContextsForWord,
    getReviewLogs,
    getReviewLogsForWord,
  };
}
