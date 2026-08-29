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
    if (deps.readerSessionOwner && typeof deps.readerSessionOwner.load === 'function') {
      try {
        const result = await deps.readerSessionOwner.load({ fallbackSession: null });
        if (result?.status === 'loaded' && result.session) {
          return { status: 'committed', source: 'owner', session: result.session };
        }
        if (result?.status === 'empty') {
          return { status: 'empty-owner', source: 'owner', session: null };
        }
        return {
          status: 'rejected',
          source: 'owner',
          error: normalizeRestoreError(result?.error)
        };
      } catch (error) {
        return {
          status: 'rejected',
          source: 'owner',
          error: normalizeRestoreError(error)
        };
      }
    }
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
    if (candidate.status === 'empty-owner') {
      deps.emitAnnotationDiagnostics('app.restore_session_complete', {
        scope: deps.getAnnotationGenerationScope(),
        currentAudioKey: state.currentAudioKey,
        currentDocId: namespace.currentDocId,
        markedCount: state.markedMap.size,
        source: 'owner',
        contentId: null,
        revision: null,
        generatedItemCount: 0
      });
      return { status: 'empty', source: 'owner' };
    }
    if (candidate.status === 'rejected') {
      deps.emitAnnotationDiagnostics('app.restore_session_rejected', {
        scope: deps.getAnnotationGenerationScope(),
        currentAudioKey: state.currentAudioKey,
        currentDocId: namespace.currentDocId,
        source: candidate.source || 'committed',
        code: candidate.error.code
      });
      return {
        status: 'rejected',
        source: candidate.source || 'committed',
        error: candidate.error
      };
    }

    const committedSource = candidate.status === 'committed';
    const source = committedSource ? (candidate.source || 'committed') : 'legacy';
    const committedSession = candidate.session;
    const ownerSource = source === 'owner';
    const audioMeta = committedSource
      ? committedSession.audioMeta
      : await deps.loadFromDB('audioMeta');
    const streamUrl = audioMeta && typeof audioMeta === 'object' && typeof audioMeta.streamUrl === 'string'
      ? audioMeta.streamUrl
      : '';
    const audioBlob = ownerSource || streamUrl ? null : await deps.loadFromDB('audio');
    const transcriptData = committedSource
      ? committedSession.transcript
      : await deps.loadFromDB('transcript');
    const chunkData = committedSource
      ? committedSession.chunkData
      : await deps.loadFromDB('chunkData');
    const visualData = ownerSource ? null : await deps.loadFromDB('visual');
    const marksData = committedSource && Array.isArray(committedSession.marks)
      ? committedSession.marks
      : ownerSource ? null : await deps.loadFromDB('marks');

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
