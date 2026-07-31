import { initReaderNotesRuntime } from './reader-notes-runtime.js';
import { initReaderSessionRuntime } from './reader-session-runtime.js';

export function initReaderNotesSessionRuntime(deps = {}) {
  var notesRuntime = initReaderNotesRuntime({
    transcriptState: deps.transcriptState,
    chunkState: deps.chunkState,
    clozeState: deps.clozeState,
    loadFromDB: deps.loadFromDB,
    saveToDB: deps.saveToDB,
    audioIdentityApi: deps.audioIdentityApi,
    isPlainObjectRecord: deps.isPlainObjectRecord,
    mainAppArea: deps.mainAppArea
  });

  var sessionRuntime = initReaderSessionRuntime({
    chunkNotesApi: notesRuntime.chunkNotesApi,
    sentenceNotesApi: notesRuntime.sentenceNotesApi,
    audioIdentityApi: deps.audioIdentityApi
  });

  return {
    notesState: notesRuntime.notesState,
    bridgeToPinia: notesRuntime.bridgeToPinia,
    chunkNotesApi: notesRuntime.chunkNotesApi,
    sentenceNotesApi: notesRuntime.sentenceNotesApi,
    loadChunkNotesForCurrentAudio: sessionRuntime.loadChunkNotesForCurrentAudio,
    setChunkNoteVisible: sessionRuntime.setChunkNoteVisible,
    loadSentenceNotesForCurrentAudio: sessionRuntime.loadSentenceNotesForCurrentAudio,
    switchSentenceNotesDoc: sessionRuntime.switchSentenceNotesDoc,
    applyCurrentAudioMeta: sessionRuntime.applyCurrentAudioMeta
  };
}
