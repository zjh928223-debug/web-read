import { createSessionAnnotationRuntime } from './session-annotation-runtime.js';
import { startSessionLifecycleRuntime } from './session-lifecycle-runtime.js';
import { requirePiniaRuntimeStores } from '../pinia-stores/runtime-registry.js';
import { initPiniaBridge } from './pinia-bridge-module.js';

export function createSessionRuntimeAdapters(env = {}) {
  const windowObject = typeof env.getWindow === 'function' ? env.getWindow() : globalThis;
  const documentObject = typeof env.getDocument === 'function' ? env.getDocument() : windowObject.document;
  const audioStore = requirePiniaRuntimeStores().audio;
  const bridgeToPinia = initPiniaBridge({
    transcriptState: windowObject.__transcriptState,
    chunkState: windowObject.__chunkState,
    clozeState: windowObject.__clozeState
  });

  function getElement(id) {
    return documentObject && typeof documentObject.getElementById === 'function'
      ? documentObject.getElementById(id)
      : null;
  }

  const runtimeDeps = {
    windowObject,
    documentObject,
    namespace: windowObject._ns || {},
    localStorageApi: windowObject.localStorage,
    urlApi: windowObject.URL || globalThis.URL,
    BlobCtor: windowObject.Blob || globalThis.Blob,
    domRefs: {
      audioPlayer: windowObject.audioPlayer || getElement('audio-player'),
      transcriptContainer: windowObject.transcriptContainer || getElement('transcript-container'),
      lblAudio: windowObject.lblAudio || getElement('lbl-audio'),
      lblTranscript: windowObject.lblTranscript || getElement('lbl-transcript'),
      lblVisual: windowObject.lblVisual || getElement('lbl-visual'),
      annotationMarkCountEl: getElement('annotation-mark-count'),
      hotkeyInput: windowObject.hotkeyInput || getElement('hotkey-input'),
      hotkeyAnnotationBubbleInput: windowObject.hotkeyAnnotationBubbleInput || getElement('hotkey-annotation-bubble-input'),
      hotkeyChunkCnInput: windowObject.hotkeyChunkCnInput || getElement('hotkey-chunk-cn-input'),
      hotkeyChunkShadowInput: windowObject.hotkeyChunkShadowInput || getElement('hotkey-chunk-shadow-input'),
      hotkeyBackwardInput: windowObject.hotkeyBackwardInput || getElement('hotkey-backward-input'),
      hotkeyForwardInput: windowObject.hotkeyForwardInput || getElement('hotkey-forward-input'),
      highlightColorInput: windowObject.highlightColorInput || getElement('highlight-color-input'),
      sentenceColorInput: windowObject.sentenceColorInput || getElement('sentence-color-input')
    },
    globals: {
      saveToDB: audioStore.saveToDB.bind(audioStore),
      loadFromDB: audioStore.loadFromDB.bind(audioStore),
      deleteFromDB: audioStore.deleteFromDB.bind(audioStore),
      initDB: audioStore.initDB.bind(audioStore),
      markFileLoaded: windowObject.markFileLoaded,
      applyCurrentAudioMeta: windowObject.applyCurrentAudioMeta,
      buildCurrentSentenceDocId: windowObject.buildCurrentSentenceDocId,
      processVisual: windowObject.processVisual,
      processChunkData: windowObject.processChunkData,
      processTranscript: windowObject.processTranscript,
      bridgeToPinia,
      forceUpdateUI: windowObject.forceUpdateUI,
      showToast: windowObject.showToast,
      updateChunkCnHoldBtn: windowObject.updateChunkCnHoldBtn,
      annotationLightweightModule: windowObject.__annotationLightweightModule
    }
  };

  return {
    getWindow: function () { return windowObject; },
    annotation: {
      start: function (state) {
        return createSessionAnnotationRuntime({
          state,
          namespace: runtimeDeps.namespace,
          windowObject,
          documentObject,
          runtimeDeps,
          domRefs: runtimeDeps.domRefs,
          globals: runtimeDeps.globals
        });
      }
    },
    lifecycle: {
      start: function (state, annotationRuntime) {
        return startSessionLifecycleRuntime({
          state,
          namespace: runtimeDeps.namespace,
          runtimeDeps,
          documentObject,
          windowObject,
          domRefs: runtimeDeps.domRefs,
          globals: runtimeDeps.globals,
          annotationRuntime
        });
      }
    }
  };
}
