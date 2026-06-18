export function initReaderSessionRuntime(deps = {}) {
  var chunkNotesApi = deps.chunkNotesApi;
  var sentenceNotesApi = deps.sentenceNotesApi;
  var audioIdentityApi = deps.audioIdentityApi;

  async function loadChunkNotesForCurrentAudio() {
    return chunkNotesApi.loadChunkNotesForCurrentAudio();
  }

  function setChunkNoteVisible(next, persist) {
    return chunkNotesApi.setChunkNoteVisible(next, persist);
  }

  async function loadSentenceNotesForCurrentAudio() {
    return sentenceNotesApi.loadSentenceNotesForCurrentAudio();
  }

  async function switchSentenceNotesDoc(transcriptSource) {
    return sentenceNotesApi.switchSentenceNotesDoc(transcriptSource);
  }

  function applyCurrentAudioMeta(meta) {
    const nextAudioState = audioIdentityApi.applyCurrentAudioMeta(meta);
    if (chunkNotesApi && typeof chunkNotesApi.setChunkNoteDraftRestoreDone === 'function') {
      chunkNotesApi.setChunkNoteDraftRestoreDone(nextAudioState.chunkNoteDraftRestoreDone);
    }
    return nextAudioState;
  }

  return {
    loadChunkNotesForCurrentAudio: loadChunkNotesForCurrentAudio,
    setChunkNoteVisible: setChunkNoteVisible,
    loadSentenceNotesForCurrentAudio: loadSentenceNotesForCurrentAudio,
    switchSentenceNotesDoc: switchSentenceNotesDoc,
    applyCurrentAudioMeta: applyCurrentAudioMeta
  };
}
