import { collectReaderRuntimeDeps } from './reader-runtime-deps.js';
import { initAudioIdentity } from './audio-identity-module.js';
import { initHotkeyState } from './hotkey-state-module.js';
import { initMarksState } from './marks-state-module.js';

export function initReaderBootstrapRuntime(deps = {}) {
  var getWindow = typeof deps.getWindow === 'function' ? deps.getWindow : function () { return globalThis; };
  var globalObject = getWindow();

  var transcriptState = globalObject.__transcriptState;
  var chunkState = globalObject.__chunkState;
  var clozeState = globalObject.__clozeState;
  var playbackState = globalObject.__playbackState;

  var saveToDB = function (id, data) {
    return getWindow().__audioStore.saveToDB(id, data);
  };
  var loadFromDB = function (id) {
    return getWindow().__audioStore.loadFromDB(id);
  };

  var runtimeDeps = collectReaderRuntimeDeps({
    transcriptState: transcriptState,
    getWindow: getWindow
  });

  var audioIdentityApi = initAudioIdentity({
    buildAudioKey: runtimeDeps.buildAudioKey,
    buildCurrentAudioMetaState: runtimeDeps.buildCurrentAudioMetaState,
    getCurrentAudioFilenameBase: runtimeDeps.getCurrentAudioFilenameBase,
    getChunkNotesStorageKey: runtimeDeps.getChunkNotesStorageKey,
    getChunkNoteDraftStorageKey: runtimeDeps.getChunkNoteDraftStorageKey,
    getSentenceNotesStorageKey: runtimeDeps.getSentenceNotesStorageKey,
    getLegacySentenceNotesStorageKey: runtimeDeps.getLegacySentenceNotesStorageKey,
    buildCurrentSentenceDocId: runtimeDeps.buildCurrentSentenceDocId,
    getSegments: function () { return transcriptState.segments; }
  });

  return {
    transcriptState: transcriptState,
    chunkState: chunkState,
    clozeState: clozeState,
    playbackState: playbackState,
    saveToDB: saveToDB,
    loadFromDB: loadFromDB,
    runtimeDeps: runtimeDeps,
    audioIdentityApi: audioIdentityApi,
    hotkeyStateApi: initHotkeyState(),
    marksStateApi: initMarksState()
  };
}
