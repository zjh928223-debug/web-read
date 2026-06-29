export function createSessionRestoreRuntime(deps = {}) {
  const state = deps.state || {};
  const namespace = deps.namespace || {};

  async function restoreSession() {
    deps.emitAnnotationDiagnostics('app.restore_session_start', {
      scope: deps.getAnnotationGenerationScope(),
      currentAudioKey: state.currentAudioKey,
      currentDocId: namespace.currentDocId
    });
    const audioBlob = await deps.loadFromDB('audio');
    if (audioBlob) {
      deps.audioPlayer.src = deps.urlApi.createObjectURL(audioBlob);
      deps.markFileLoaded(deps.lblAudio, 'Audio restored');
    }
    const audioMeta = await deps.loadFromDB('audioMeta');
    if (audioMeta && typeof audioMeta === 'object') {
      deps.applyCurrentAudioMeta(audioMeta);
    } else if (audioBlob) {
      deps.applyCurrentAudioMeta({
        name: audioBlob.name || 'audio',
        size: audioBlob.size || 0,
        lastModified: audioBlob.lastModified || 0,
        type: audioBlob.type || ''
      });
    }
    await deps.loadChunkNotesForCurrentAudio();
    await deps.loadSentenceNotesForCurrentAudio();

    const transcriptData = await deps.loadFromDB('transcript');
    if (transcriptData) {
      deps.processTranscript(transcriptData);
      deps.emitAnnotationDiagnostics('app.restore_transcript_processed', {
        scope: deps.getAnnotationGenerationScope(),
        currentAudioKey: state.currentAudioKey,
        currentDocId: namespace.currentDocId,
        derivedDocId: deps.buildCurrentSentenceDocId(transcriptData),
        segmentCount: Array.isArray(transcriptData && transcriptData.segments) ? transcriptData.segments.length : 0
      });
      await deps.switchSentenceNotesDoc(transcriptData);
      deps.emitAnnotationDiagnostics('app.restore_scope_updated', {
        scope: deps.getAnnotationGenerationScope(),
        currentAudioKey: state.currentAudioKey,
        currentDocId: namespace.currentDocId
      });
      deps.scheduleGeneratedAnnotationIndexRefresh();
      deps.markFileLoaded(deps.lblTranscript, 'Transcript restored');
    } else {
      await deps.switchSentenceNotesDoc();
    }

    const visualData = await deps.loadFromDB('visual');
    if (visualData) {
      deps.processVisual(visualData);
      deps.markFileLoaded(deps.lblVisual, 'Visual restored');
    }

    const chunkData = await deps.loadFromDB('chunkData');
    if (chunkData) {
      deps.processChunkData(chunkData);
    }

    const marksData = await deps.loadFromDB('marks');
    if (marksData && Array.isArray(marksData)) {
      marksData.forEach(mark => {
        const normalizedMark = deps.normalizeAnnotationMark(mark);
        if (normalizedMark) state.markedMap.set(normalizedMark.globalIndex, normalizedMark);
      });
      if (!state.isChunkMode) deps.renderTranscript();
      deps.syncAnnotationGenerationEntryStatus();
      deps.bridgeToPinia();
    }
    const generatedStore = deps.getAnnotationGeneratedResultStore();
    deps.emitAnnotationDiagnostics('app.restore_session_complete', {
      scope: deps.getAnnotationGenerationScope(),
      currentAudioKey: state.currentAudioKey,
      currentDocId: namespace.currentDocId,
      markedCount: state.markedMap.size,
      generatedItemCount: generatedStore && typeof generatedStore.getItems === 'function'
        ? generatedStore.getItems().length
        : 0
    });
  }

  return {
    restoreSession
  };
}
