function defineRuntimeStateBinding(runtimeState, field, getValue, setValue) {
  Object.defineProperty(runtimeState, field, {
    get: getValue,
    set: setValue,
    enumerable: true,
    configurable: true
  });
}

export function configureRuntimeStateBindings(options) {
  const {
    runtimeState,
    transcriptState,
    chunkState,
    clozeState,
    playbackState,
    audioIdentityApi,
    hotkeyStateApi,
    marksStateApi,
    visualVocabApi
  } = options;

  defineRuntimeStateBinding(runtimeState, 'segments', () => transcriptState.segments, (value) => { transcriptState.segments = value; });
  defineRuntimeStateBinding(runtimeState, 'words', () => transcriptState.words, (value) => { transcriptState.words = value; });
  defineRuntimeStateBinding(runtimeState, 'wordStarts', () => transcriptState.wordStarts, (value) => { transcriptState.wordStarts = value; });
  defineRuntimeStateBinding(runtimeState, 'currentWordIndex', () => transcriptState.currentWordIndex, (value) => { transcriptState.currentWordIndex = value; });
  defineRuntimeStateBinding(runtimeState, 'highlightMode', () => transcriptState.highlightMode, (value) => { transcriptState.highlightMode = value; });

  defineRuntimeStateBinding(runtimeState, 'chunkItems', () => chunkState.chunkItems, (value) => { chunkState.chunkItems = value; });
  defineRuntimeStateBinding(runtimeState, 'hasAiChunkData', () => chunkState.hasAiChunkData, (value) => { chunkState.hasAiChunkData = value; });
  defineRuntimeStateBinding(runtimeState, 'manualChunkStates', () => chunkState.manualChunkStates, (value) => { chunkState.manualChunkStates = value; });
  defineRuntimeStateBinding(runtimeState, 'isChunkMode', () => chunkState.isChunkMode, (value) => { chunkState.isChunkMode = value; });
  defineRuntimeStateBinding(runtimeState, 'chunkCnVisible', () => chunkState.chunkCnVisible, (value) => { chunkState.chunkCnVisible = value; });
  defineRuntimeStateBinding(runtimeState, 'chunkCnHoldMode', () => chunkState.chunkCnHoldMode, (value) => { chunkState.chunkCnHoldMode = value; });
  defineRuntimeStateBinding(runtimeState, 'isChunkShadowOn', () => chunkState.isChunkShadowOn, (value) => { chunkState.isChunkShadowOn = value; });
  defineRuntimeStateBinding(runtimeState, 'chunkCnMode', () => chunkState.chunkCnMode, (value) => { chunkState.chunkCnMode = value; });
  defineRuntimeStateBinding(runtimeState, 'lastActiveChunkIndex', () => chunkState.lastActiveChunkIndex, (value) => { chunkState.lastActiveChunkIndex = value; });
  defineRuntimeStateBinding(runtimeState, 'lastAiPrevTapChunkIndex', () => chunkState.lastAiPrevTapChunkIndex, (value) => { chunkState.lastAiPrevTapChunkIndex = value; });
  defineRuntimeStateBinding(runtimeState, 'lastAiPrevTapAt', () => chunkState.lastAiPrevTapAt, (value) => { chunkState.lastAiPrevTapAt = value; });

  defineRuntimeStateBinding(runtimeState, 'hasClozeData', () => clozeState.hasClozeData, (value) => { clozeState.hasClozeData = value; });
  defineRuntimeStateBinding(runtimeState, 'clozeItems', () => clozeState.clozeItems, (value) => { clozeState.clozeItems = value; });
  defineRuntimeStateBinding(runtimeState, 'clozeAnswerState', () => clozeState.clozeAnswerState, (value) => { clozeState.clozeAnswerState = value; });

  defineRuntimeStateBinding(runtimeState, 'autoFollow', () => playbackState.autoFollow, (value) => { playbackState.autoFollow = value; });
  defineRuntimeStateBinding(runtimeState, 'userScrollSuppress', () => playbackState.userScrollSuppress, (value) => { playbackState.userScrollSuppress = value; });
  defineRuntimeStateBinding(runtimeState, 'suppressTimer', () => playbackState.suppressTimer, (value) => { playbackState.suppressTimer = value; });
  defineRuntimeStateBinding(runtimeState, 'lastActiveSegIndex', () => playbackState.lastActiveSegIndex, (value) => { playbackState.lastActiveSegIndex = value; });
  defineRuntimeStateBinding(runtimeState, 'activeWordHighlightEl', () => playbackState.activeWordHighlightEl, (value) => { playbackState.activeWordHighlightEl = value; });
  defineRuntimeStateBinding(runtimeState, 'activeSentenceEl', () => playbackState.activeSentenceEl, (value) => { playbackState.activeSentenceEl = value; });
  defineRuntimeStateBinding(runtimeState, 'activeChunkEl', () => playbackState.activeChunkEl, (value) => { playbackState.activeChunkEl = value; });
  defineRuntimeStateBinding(runtimeState, 'playbackUiSignature', () => playbackState.playbackUiSignature, (value) => { playbackState.playbackUiSignature = value; });

  defineRuntimeStateBinding(runtimeState, 'currentAudioMeta', () => audioIdentityApi.currentAudioMeta, (value) => { audioIdentityApi.setCurrentAudioMeta(value); });
  defineRuntimeStateBinding(runtimeState, 'currentAudioKey', () => audioIdentityApi.currentAudioKey, (value) => { audioIdentityApi.setCurrentAudioKey(value); });

  defineRuntimeStateBinding(runtimeState, 'markKey', () => hotkeyStateApi.markKey, (value) => { hotkeyStateApi.setMarkKey(value); });
  defineRuntimeStateBinding(runtimeState, 'annotationBubbleKey', () => hotkeyStateApi.annotationBubbleKey, (value) => { hotkeyStateApi.setAnnotationBubbleKey(value); });
  defineRuntimeStateBinding(runtimeState, 'chunkCnKey', () => hotkeyStateApi.chunkCnKey, (value) => { hotkeyStateApi.setChunkCnKey(value); });
  defineRuntimeStateBinding(runtimeState, 'chunkShadowKey', () => hotkeyStateApi.chunkShadowKey, (value) => { hotkeyStateApi.setChunkShadowKey(value); });
  defineRuntimeStateBinding(runtimeState, 'backwardKey', () => hotkeyStateApi.backwardKey, (value) => { hotkeyStateApi.setBackwardKey(value); });
  defineRuntimeStateBinding(runtimeState, 'forwardKey', () => hotkeyStateApi.forwardKey, (value) => { hotkeyStateApi.setForwardKey(value); });

  defineRuntimeStateBinding(runtimeState, 'markedMap', () => marksStateApi.markedMap, (value) => { marksStateApi.setMarkedMap(value); });

  defineRuntimeStateBinding(runtimeState, 'globalVocab', () => visualVocabApi.globalVocab, (value) => { visualVocabApi.setGlobalVocab(value); });
  defineRuntimeStateBinding(runtimeState, 'vocabMatchMap', () => visualVocabApi.vocabMatchMap, (value) => { visualVocabApi.setVocabMatchMap(value); });

  return runtimeState;
}
