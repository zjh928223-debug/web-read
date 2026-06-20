export function restoreSessionUiSettings(deps = {}) {
  const state = deps.state || {};
  const localStorageApi = deps.localStorageApi;
  const documentObject = deps.documentObject;
  const windowObject = deps.windowObject;

  try {
    const readStoredHotkey = (key, legacyKey) => localStorageApi.getItem(key) || localStorageApi.getItem(legacyKey);
    const savedMarkKey = readStoredHotkey('st.markKey', 'markKey');
    const savedNotesKey = readStoredHotkey('st.notesKey', 'notesKey');
    const savedAnnotationBubbleKey = readStoredHotkey('st.annotationBubbleKey', 'annotationBubbleKey');
    const savedChunkCnKey = readStoredHotkey('st.chunkCnKey', 'chunkCnKey');
    const savedChunkShadowKey = readStoredHotkey('st.chunkShadowKey', 'chunkShadowKey');
    const savedChunkNoteKey = readStoredHotkey('st.chunkNoteKey', 'chunkNoteKey');
    const savedBackwardKey = readStoredHotkey('st.backwardKey', 'backwardKey');
    const savedForwardKey = readStoredHotkey('st.forwardKey', 'forwardKey');
    if (savedMarkKey) { state.markKey = savedMarkKey.toLowerCase(); deps.hotkeyInput.value = state.markKey; }
    if (savedNotesKey) { state.notesKey = savedNotesKey.toLowerCase(); deps.hotkeyNotesInput.value = state.notesKey; }
    if (savedAnnotationBubbleKey) { state.annotationBubbleKey = savedAnnotationBubbleKey.toLowerCase(); if (deps.hotkeyAnnotationBubbleInput) deps.hotkeyAnnotationBubbleInput.value = state.annotationBubbleKey; }
    if (savedChunkCnKey) { state.chunkCnKey = savedChunkCnKey.toLowerCase(); deps.hotkeyChunkCnInput.value = state.chunkCnKey; }
    if (savedChunkShadowKey) { state.chunkShadowKey = savedChunkShadowKey.toLowerCase(); deps.hotkeyChunkShadowInput.value = state.chunkShadowKey; }
    if (savedChunkNoteKey) { state.chunkNoteKey = savedChunkNoteKey.toLowerCase(); if (deps.hotkeyChunkNoteInput) deps.hotkeyChunkNoteInput.value = state.chunkNoteKey; }
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
    if (localStorageApi.getItem('chunkNoteSize')) documentObject.documentElement.style.setProperty('--chunk-note-size', localStorageApi.getItem('chunkNoteSize'));
    if (localStorageApi.getItem('chunkNoteColor')) documentObject.documentElement.style.setProperty('--chunk-note-color', localStorageApi.getItem('chunkNoteColor'));
    const storedNoteWidthRaw = localStorageApi.getItem('chunkNoteWidth');
    if (storedNoteWidthRaw) {
      const parsedW = parseFloat(storedNoteWidthRaw);
      if (Number.isFinite(parsedW)) {
        const migratedW = Math.abs(parsedW - 620) < 0.1 ? 260 : parsedW;
        const safeW = Math.max(140, Math.min(1200, migratedW));
        const nextW = `${safeW}px`;
        documentObject.documentElement.style.setProperty('--chunk-note-width', nextW);
        if (storedNoteWidthRaw !== nextW) localStorageApi.setItem('chunkNoteWidth', nextW);
      }
    }
    const storedNoteMinHRaw = localStorageApi.getItem('chunkNoteMinHeight');
    if (storedNoteMinHRaw) {
      const parsedH = parseFloat(storedNoteMinHRaw);
      if (Number.isFinite(parsedH)) {
        const migratedH = (Math.abs(parsedH - 56) < 0.1 || Math.abs(parsedH - 44) < 0.1 || Math.abs(parsedH - 36) < 0.1 || Math.abs(parsedH - 30) < 0.1) ? 18 : parsedH;
        const safeH = Math.max(18, Math.min(360, migratedH));
        const nextH = `${safeH}px`;
        documentObject.documentElement.style.setProperty('--chunk-note-min-height', nextH);
        if (storedNoteMinHRaw !== nextH) localStorageApi.setItem('chunkNoteMinHeight', nextH);
      }
    }
    if (localStorageApi.getItem('chunkNoteArrowSize')) documentObject.documentElement.style.setProperty('--chunk-note-arrow-size', localStorageApi.getItem('chunkNoteArrowSize'));
    const storedPreviewVisible = localStorageApi.getItem('st.notePreviewVisible');
    if (storedPreviewVisible !== null) state.notePreviewVisible = storedPreviewVisible === 'true';
    const storedPreviewWidth = parseFloat(localStorageApi.getItem('st.notePreviewWidth') || '');
    if (Number.isFinite(storedPreviewWidth)) {
      state.notePreviewWidth = Math.max(280, Math.min(520, storedPreviewWidth));
    }
    const storedPreviewHeight = parseFloat(localStorageApi.getItem('st.notePreviewHeight') || '');
    if (Number.isFinite(storedPreviewHeight)) {
      state.notePreviewHeight = Math.max(420, Math.min(windowObject.innerHeight - 28, storedPreviewHeight));
    }
  } catch (e) {}
}
