export function createSessionRuntimeDeps(env = {}) {
  const windowObject = typeof env.getWindow === 'function' ? env.getWindow() : globalThis;
  const documentObject = typeof env.getDocument === 'function' ? env.getDocument() : windowObject.document;

  function getElement(id) {
    return documentObject && typeof documentObject.getElementById === 'function'
      ? documentObject.getElementById(id)
      : null;
  }

  return {
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
      annotationApiSettingsBtn: getElement('btn-annotation-api-settings'),
      annotationApiSettingsPanel: getElement('annotation-api-settings-panel'),
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
      saveToDB: windowObject.saveToDB,
      loadFromDB: windowObject.loadFromDB,
      deleteFromDB: windowObject.deleteFromDB,
      initDB: windowObject.initDB,
      markFileLoaded: windowObject.markFileLoaded,
      applyCurrentAudioMeta: windowObject.applyCurrentAudioMeta,
      loadChunkNotesForCurrentAudio: windowObject.loadChunkNotesForCurrentAudio,
      loadSentenceNotesForCurrentAudio: windowObject.loadSentenceNotesForCurrentAudio,
      buildCurrentSentenceDocId: windowObject.buildCurrentSentenceDocId,
      switchSentenceNotesDoc: windowObject.switchSentenceNotesDoc,
      processVisual: windowObject.processVisual,
      processChunkData: windowObject.processChunkData,
      processTranscript: windowObject.processTranscript,
      bridgeToPinia: windowObject.bridgeToPinia,
      forceUpdateUI: windowObject.forceUpdateUI,
      showToast: windowObject.showToast,
      adjustChunkNoteArrowSizeByGap: windowObject.adjustChunkNoteArrowSizeByGap,
      setChunkNoteVisible: windowObject.setChunkNoteVisible,
      updateChunkCnHoldBtn: windowObject.updateChunkCnHoldBtn,
      annotationLightweightModule: windowObject.__annotationLightweightModule
    }
  };
}
