export function startSessionRuntime(deps = {}) {
  const state = deps.state || {};
  const namespace = deps.namespace || {};
  const localStorageApi = deps.localStorageApi;
  const documentObject = deps.documentObject;
  const windowObject = deps.windowObject;

  return deps.initDB().then(async () => {
    await deps.clearPersistedReaderContentOnStartup();

    const savedManualStates = localStorageApi.getItem('st.manualChunkStates');
    if (savedManualStates) {
      try { state.manualChunkStates = JSON.parse(savedManualStates); } catch (e) {}
    }

    const savedCnMode = localStorageApi.getItem('st.chunkCnMode');
    if (savedCnMode === 'focus') {
      state.chunkCnMode = 'focus';
    }

    const savedShadowState = localStorageApi.getItem('st.isChunkShadowOn');
    if (savedShadowState !== null) {
      state.isChunkShadowOn = (savedShadowState === 'true');
      if (!state.isChunkShadowOn) documentObject.body.classList.add('hide-chunk-shadow');
    }

    if (localStorageApi.getItem('chunkEnSize')) documentObject.documentElement.style.setProperty('--chunk-en-size', localStorageApi.getItem('chunkEnSize'));
    if (localStorageApi.getItem('chunkCnSize')) documentObject.documentElement.style.setProperty('--chunk-cn-size', localStorageApi.getItem('chunkCnSize'));
    if (localStorageApi.getItem('chunkGap')) documentObject.documentElement.style.setProperty('--chunk-gap', localStorageApi.getItem('chunkGap'));
    if (localStorageApi.getItem('chunkCnColor')) documentObject.documentElement.style.setProperty('--chunk-cn-color', localStorageApi.getItem('chunkCnColor'));
    if (localStorageApi.getItem('chunkBgColor')) documentObject.documentElement.style.setProperty('--chunk-active-bg', localStorageApi.getItem('chunkBgColor'));
    deps.adjustChunkNoteArrowSizeByGap();

    if (state.chunkCnMode === 'focus') {
      const btn = documentObject.getElementById('btn-chunk-focus');
      if (btn) { btn.innerText = '聚焦'; btn.classList.add('active'); }
      if (state.isChunkMode && deps.transcriptContainer) deps.transcriptContainer.classList.add('cn-mode-focus');
    }

    const savedChunkMode = localStorageApi.getItem('st.isChunkMode') === 'true';
    const savedChunkVisible = localStorageApi.getItem('st.chunkCnVisible');
    if (savedChunkVisible !== null) state.chunkCnVisible = savedChunkVisible === 'true';
    const savedHoldMode = localStorageApi.getItem('st.chunkCnHoldMode');
    if (savedHoldMode !== null) state.chunkCnHoldMode = savedHoldMode === 'true';
    const savedNoteVisible = localStorageApi.getItem('chunkNoteVisible');
    if (savedNoteVisible !== null) namespace.chunkNoteVisible = savedNoteVisible === 'true';
    deps.setChunkNoteVisible(namespace.chunkNoteVisible, false);
    deps.updateChunkCnHoldBtn();

    await deps.restoreSession();

    if (savedChunkMode) {
      setTimeout(() => {
        if (state.chunkItems.length > 0 && state.hasAiChunkData) windowObject.toggleChunkMode(true);
      }, 500);
    }
  });
}
