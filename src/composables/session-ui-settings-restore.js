export function restoreSessionUiSettings(deps = {}) {
  const state = deps.state || {};
  const localStorageApi = deps.localStorageApi;
  const documentObject = deps.documentObject;
  try {
    const readStoredHotkey = (key, legacyKey) => localStorageApi.getItem(key) || localStorageApi.getItem(legacyKey);
    const savedMarkKey = readStoredHotkey('st.markKey', 'markKey');
    const savedAnnotationBubbleKey = readStoredHotkey('st.annotationBubbleKey', 'annotationBubbleKey');
    const savedChunkCnKey = readStoredHotkey('st.chunkCnKey', 'chunkCnKey');
    const savedChunkShadowKey = readStoredHotkey('st.chunkShadowKey', 'chunkShadowKey');
    const savedBackwardKey = readStoredHotkey('st.backwardKey', 'backwardKey');
    const savedForwardKey = readStoredHotkey('st.forwardKey', 'forwardKey');
    if (savedMarkKey) { state.markKey = savedMarkKey.toLowerCase(); deps.hotkeyInput.value = state.markKey; }
    if (savedAnnotationBubbleKey) { state.annotationBubbleKey = savedAnnotationBubbleKey.toLowerCase(); if (deps.hotkeyAnnotationBubbleInput) deps.hotkeyAnnotationBubbleInput.value = state.annotationBubbleKey; }
    if (savedChunkCnKey) { state.chunkCnKey = savedChunkCnKey.toLowerCase(); deps.hotkeyChunkCnInput.value = state.chunkCnKey; }
    if (savedChunkShadowKey) { state.chunkShadowKey = savedChunkShadowKey.toLowerCase(); deps.hotkeyChunkShadowInput.value = state.chunkShadowKey; }
    if (savedBackwardKey) { state.backwardKey = savedBackwardKey; deps.hotkeyBackwardInput.value = state.backwardKey; }
    if (savedForwardKey) { state.forwardKey = savedForwardKey; deps.hotkeyForwardInput.value = state.forwardKey; }
    if (localStorageApi.getItem('highlightColor')) {
      documentObject.documentElement.style.setProperty('--word-highlight-bg', localStorageApi.getItem('highlightColor'));
      deps.highlightColorInput.value = localStorageApi.getItem('highlightColor');
    }
    if (localStorageApi.getItem('sentenceColor')) {
      documentObject.documentElement.style.setProperty('--sentence-highlight-bg', localStorageApi.getItem('sentenceColor'));
      deps.sentenceColorInput.value = localStorageApi.getItem('sentenceColor');
    }
  } catch (e) {}
}
