(function attachSentenceNotesPersistenceUtils(global) {
  function ensureLegacySentenceNotesForDoc(docId, deps) {
    const {
      allSentenceNotesByDoc,
      loadFromDB,
      getLegacySentenceNotesStorageKey,
      isPlainObjectRecord,
      normalizeSentenceNotesScope,
      setAllSentenceNotesByDocEntry
    } = deps;
    if (!docId || allSentenceNotesByDoc[docId]) return;
    return loadFromDB(getLegacySentenceNotesStorageKey()).then((legacy) => {
      if (isPlainObjectRecord(legacy)) {
        setAllSentenceNotesByDocEntry(docId, normalizeSentenceNotesScope(legacy));
      }
    });
  }

  function getCurrentSentenceDocIdForExport(currentDocId, buildCurrentSentenceDocId) {
    return currentDocId || buildCurrentSentenceDocId();
  }

  global.SentenceNotesPersistenceUtils = {
    ensureLegacySentenceNotesForDoc,
    getCurrentSentenceDocIdForExport
  };
})(window);
