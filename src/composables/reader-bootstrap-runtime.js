import { collectReaderRuntimeDeps } from './reader-runtime-deps.js';
import { initAudioIdentity } from './audio-identity-module.js';
import { initHotkeyState } from './hotkey-state-module.js';
import { initMarksState } from './marks-state-module.js';
import { initPiniaBridge } from './pinia-bridge-module.js';
import { requirePiniaRuntimeStores } from '../pinia-stores/runtime-registry.js';

export function initReaderBootstrapRuntime(deps = {}) {
  var getWindow = typeof deps.getWindow === 'function' ? deps.getWindow : function () { return globalThis; };
  var globalObject = getWindow();

  var transcriptState = globalObject.__transcriptState;
  var chunkState = globalObject.__chunkState;
  var playbackState = globalObject.__playbackState;
  var audioStore = requirePiniaRuntimeStores().audio;

  var saveToDB = function (id, data) {
    return audioStore.saveToDB(id, data);
  };
  var loadFromDB = function (id) {
    return audioStore.loadFromDB(id);
  };

  var runtimeDeps = collectReaderRuntimeDeps({
    transcriptState: transcriptState,
    getWindow: getWindow
  });

  var audioIdentityApi = initAudioIdentity({
    buildAudioKey: runtimeDeps.buildAudioKey,
    buildCurrentAudioMetaState: runtimeDeps.buildCurrentAudioMetaState,
    getCurrentAudioFilenameBase: runtimeDeps.getCurrentAudioFilenameBase,
    buildCurrentSentenceDocId: runtimeDeps.buildCurrentSentenceDocId,
    getSegments: function () { return transcriptState.segments; },
    onCurrentAudioMetaChange: function (meta) {
      audioStore.currentAudioMeta = meta;
      var controller = globalObject.__annotationBackfillAiController;
      if (controller && typeof controller.refreshAvailability === 'function') {
        controller.refreshAvailability();
      }
      var previewController = globalObject.__vocabularyPreviewController;
      if (previewController && typeof previewController.refreshAvailability === 'function') {
        previewController.refreshAvailability();
      }
    }
  });

  var bridgeToPinia = initPiniaBridge({
    transcriptState: transcriptState,
    chunkState: chunkState
  });

  return {
    transcriptState: transcriptState,
    chunkState: chunkState,
    playbackState: playbackState,
    saveToDB: saveToDB,
    loadFromDB: loadFromDB,
    runtimeDeps: runtimeDeps,
    audioIdentityApi: audioIdentityApi,
    bridgeToPinia: bridgeToPinia,
    hotkeyStateApi: initHotkeyState(),
    marksStateApi: initMarksState()
  };
}
