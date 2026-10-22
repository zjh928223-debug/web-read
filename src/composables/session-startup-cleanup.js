import { recordBestEffortFailure } from '../services/runtime/best-effort.js';

export function createSessionStartupCleanupRuntime(deps = {}) {
  const state = deps.state || {};
  const namespace = deps.namespace || {};
  const localStorageApi = deps.localStorageApi;
  const documentObject = deps.documentObject;

  async function clearPersistedChunkSession() {
    state.chunkItems = [];
    state.hasAiChunkData = false;
    namespace.selectedSentence = null;
    state.lastActiveChunkIndex = -1;
    state.lastAiPrevTapChunkIndex = -1;
    state.lastAiPrevTapAt = 0;
    try {
      // Retain the existing cleanup of the retired manual-chunk preference.
      localStorageApi.removeItem('st.manualChunkStates');
      localStorageApi.removeItem('st.isChunkMode');
    } catch (error) {
      recordBestEffortFailure(error, {
        operationId: 'session-startup-setting-cleanup',
        reason: 'domain database cleanup remains authoritative when legacy local preferences are unavailable'
      });
    }
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
      // Retain the existing cleanup of the retired manual-chunk preference.
      localStorageApi.removeItem('st.manualChunkStates');
      localStorageApi.removeItem('st.isChunkMode');
      localStorageApi.removeItem('st.chunkCnVisible');
      // The hold/toggle interaction is a user preference, independent of loaded content.
    } catch (error) {
      recordBestEffortFailure(error, {
        operationId: 'session-startup-setting-cleanup',
        reason: 'startup continues with in-memory defaults when legacy local preferences cannot be removed'
      });
    }
  }

  return {
    clearPersistedChunkSession,
    clearPersistedReaderContentOnStartup
  };
}
