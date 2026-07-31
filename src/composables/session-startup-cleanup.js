export function createSessionStartupCleanupRuntime(deps = {}) {
  const state = deps.state || {};
  const namespace = deps.namespace || {};
  const localStorageApi = deps.localStorageApi;
  const documentObject = deps.documentObject;

  async function clearPersistedChunkSession() {
    state.chunkItems = [];
    state.hasAiChunkData = false;
    state.manualChunkStates = {};
    namespace.selectedSentence = null;
    state.lastActiveChunkIndex = -1;
    state.lastAiPrevTapChunkIndex = -1;
    state.lastAiPrevTapAt = 0;
    try {
      localStorageApi.removeItem('st.manualChunkStates');
      localStorageApi.removeItem('st.isChunkMode');
    } catch (e) {}
    await deps.deleteFromDB('chunkData');
    await deps.deleteFromDB('marks');
    const toggleChunkBtn = documentObject.getElementById('toggle-chunk-btn');
    if (toggleChunkBtn) toggleChunkBtn.innerText = 'AI切分';
    if (state.isChunkMode) {
      state.isChunkMode = false;
    }
  }

  async function clearPersistedReaderContentOnStartup() {
    deps.emitAnnotationDiagnostics('app.startup_clear_reader_skipped', {
      scope: deps.getAnnotationGenerationScope(),
      currentAudioKey: state.currentAudioKey,
      currentDocId: namespace.currentDocId,
      skippedKeys: ['transcript', 'marks', 'notes', 'visual', 'chunkData']
    });
    try {
      localStorageApi.removeItem('st.manualChunkStates');
      localStorageApi.removeItem('st.isChunkMode');
      localStorageApi.removeItem('st.chunkCnVisible');
      localStorageApi.removeItem('st.chunkCnHoldMode');
    } catch (e) {}
  }

  return {
    clearPersistedChunkSession,
    clearPersistedReaderContentOnStartup
  };
}
