
export function startSessionRuntime(deps = {}) {
  const state = deps.state || {};
  const localStorageApi = deps.localStorageApi;
  const documentObject = deps.documentObject;

  let disposed = false;
  const ready = deps.initDB().then(async () => {
    if (disposed) return;
    await deps.clearPersistedReaderContentOnStartup();
    if (disposed) return;

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

    if (state.chunkCnMode === 'focus') {
      const btn = documentObject.getElementById('btn-chunk-focus');
      if (btn) { btn.innerText = '聚焦'; btn.classList.add('active'); }
      if (state.isChunkMode && deps.transcriptContainer) deps.transcriptContainer.classList.add('cn-mode-focus');
    }

    const savedChunkVisible = localStorageApi.getItem('st.chunkCnVisible');
    if (savedChunkVisible !== null) state.chunkCnVisible = savedChunkVisible === 'true';
    const savedHoldMode = localStorageApi.getItem('st.chunkCnHoldMode');
    if (savedHoldMode !== null) state.chunkCnHoldMode = savedHoldMode === 'true';
    deps.updateChunkCnHoldBtn();

    // Restore personal settings only. Saved material is opened by an explicit user action.
    if (typeof deps.emitAnnotationDiagnostics === 'function') {
      deps.emitAnnotationDiagnostics('app.startup_complete', { contentRestored: false });
    }
  });

  return {
    ready,
    dispose() {
      if (disposed) return;
      disposed = true;
    }
  };
}
