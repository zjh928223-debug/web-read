(function attachImportExportSharedHelpers(global) {
  function getFirstFileFromEvent(event) {
    return event && event.target && event.target.files ? event.target.files[0] : null;
  }

  function readFileAsText(file, onText) {
    if (!file || typeof onText !== 'function') return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      const text = evt && evt.target ? evt.target.result : '';
      onText(text);
    };
    reader.readAsText(file);
  }

  function getCurrentAudioFilenameBase(currentAudioMeta, fallback = 'audio') {
    return (currentAudioMeta && currentAudioMeta.name)
      ? currentAudioMeta.name.replace(/\.[^.]+$/, '')
      : fallback;
  }

  function buildCurrentAudioMetaState(meta, buildAudioKey) {
    return {
      currentAudioMeta: meta,
      currentAudioKey: typeof buildAudioKey === 'function' ? buildAudioKey(meta) : 'default-audio',
      chunkNoteDraftRestoreDone: false
    };
  }

  function markFileLoaded(labelEl, text = '已加载') {
    if (!labelEl) return;
    labelEl.classList.add('loaded');
    labelEl.innerText = text;
  }

  global.ImportExportSharedHelpers = {
    getFirstFileFromEvent,
    readFileAsText,
    getCurrentAudioFilenameBase,
    buildCurrentAudioMetaState,
    markFileLoaded
  };
})(window);
