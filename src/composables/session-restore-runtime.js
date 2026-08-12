export function createSessionRestoreRuntime(deps = {}) {
  const state = deps.state || {};
  const namespace = deps.namespace || {};

  function normalizeRestoreError(error) {
    return {
      code: typeof error?.code === 'string' && error.code
        ? error.code
        : 'READER_SESSION_RESTORE_FAILED',
      message: typeof error?.message === 'string' && error.message
        ? error.message
        : 'Stored reader session could not be restored'
    };
  }

  async function readSessionCandidate() {
    if (!deps.readerSessionPersistence
      || typeof deps.readerSessionPersistence.loadCommitted !== 'function') {
      return { status: 'legacy', session: null };
    }
    try {
      const result = await deps.readerSessionPersistence.loadCommitted();
      if (result?.status === 'legacy') return { status: 'legacy', session: null };
      if (result?.status === 'committed' && result.session) return result;
      return {
        status: 'rejected',
        error: normalizeRestoreError(result?.error)
      };
    } catch (error) {
      return {
        status: 'rejected',
        error: normalizeRestoreError(error)
      };
    }
  }

  async function restoreSession() {
    deps.emitAnnotationDiagnostics('app.restore_session_start', {
      scope: deps.getAnnotationGenerationScope(),
      currentAudioKey: state.currentAudioKey,
      currentDocId: namespace.currentDocId
    });
    const candidate = await readSessionCandidate();
    if (candidate.status === 'rejected') {
      deps.emitAnnotationDiagnostics('app.restore_session_rejected', {
        scope: deps.getAnnotationGenerationScope(),
        currentAudioKey: state.currentAudioKey,
        currentDocId: namespace.currentDocId,
        source: 'committed',
        code: candidate.error.code
      });
      return {
        status: 'rejected',
        source: 'committed',
        error: candidate.error
      };
    }

    const source = candidate.status === 'committed' ? 'committed' : 'legacy';
    const committedSession = candidate.session;
    const audioMeta = source === 'committed'
      ? committedSession.audioMeta
      : await deps.loadFromDB('audioMeta');
    const streamUrl = audioMeta && typeof audioMeta === 'object' && typeof audioMeta.streamUrl === 'string'
      ? audioMeta.streamUrl
      : '';
    const audioBlob = streamUrl ? null : await deps.loadFromDB('audio');
    const transcriptData = source === 'committed'
      ? committedSession.transcript
      : await deps.loadFromDB('transcript');
    const chunkData = source === 'committed'
      ? committedSession.chunkData
      : await deps.loadFromDB('chunkData');
    const visualData = await deps.loadFromDB('visual');
    const marksData = source === 'committed' && Array.isArray(committedSession.marks)
      ? committedSession.marks
      : await deps.loadFromDB('marks');

    if (streamUrl) {
      deps.audioPlayer.src = streamUrl;
      deps.markFileLoaded(deps.lblAudio, 'Audio stream restored');
    } else if (audioBlob) {
      deps.audioPlayer.src = deps.urlApi.createObjectURL(audioBlob);
      deps.markFileLoaded(deps.lblAudio, 'Audio restored');
    }
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
    if (transcriptData) {
      deps.processTranscript(transcriptData);
      deps.emitAnnotationDiagnostics('app.restore_transcript_processed', {
        scope: deps.getAnnotationGenerationScope(),
        currentAudioKey: state.currentAudioKey,
        currentDocId: namespace.currentDocId,
        derivedDocId: deps.buildCurrentSentenceDocId(transcriptData),
        segmentCount: Array.isArray(transcriptData && transcriptData.segments) ? transcriptData.segments.length : 0
      });
      deps.emitAnnotationDiagnostics('app.restore_scope_updated', {
        scope: deps.getAnnotationGenerationScope(),
        currentAudioKey: state.currentAudioKey,
        currentDocId: namespace.currentDocId
      });
      deps.scheduleGeneratedAnnotationIndexRefresh();
      deps.markFileLoaded(deps.lblTranscript, 'Transcript restored');
    }

    if (visualData) {
      deps.processVisual(visualData);
      deps.markFileLoaded(deps.lblVisual, 'Visual restored');
    }

    if (chunkData) {
      deps.processChunkData(chunkData);
    }

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
      source,
      contentId: committedSession?.contentId || null,
      revision: committedSession?.revision || null,
      generatedItemCount: generatedStore && typeof generatedStore.getItems === 'function'
        ? generatedStore.getItems().length
        : 0
    });
    return {
      status: 'restored',
      source,
      ...(committedSession ? {
        contentId: committedSession.contentId,
        revision: committedSession.revision
      } : {})
    };
  }

  return {
    restoreSession
  };
}
