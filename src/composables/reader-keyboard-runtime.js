import { bsFindActive } from '../utils/playback-index.js';

export function initReaderKeyboardRuntime(deps = {}) {
  const keyboardController = deps.keyboardModule.init({
    audioPlayer: deps.audioPlayer,
    isReaderShortcutEventAllowed: deps.isReaderShortcutEventAllowed,
    isChunkMode: function () { return deps.chunkState.isChunkMode },
    chunkCnHoldMode: function () { return deps.chunkState.chunkCnHoldMode },
    markKey: deps.hotkeyStateApi.markKey,
    annotationBubbleKey: deps.hotkeyStateApi.annotationBubbleKey,
    chunkCnKey: deps.hotkeyStateApi.chunkCnKey,
    chunkShadowKey: deps.hotkeyStateApi.chunkShadowKey,
    backwardKey: deps.hotkeyStateApi.backwardKey,
    forwardKey: deps.hotkeyStateApi.forwardKey,
    getMarkKey: function () { return deps.hotkeyStateApi.markKey },
    getAnnotationBubbleKey: function () { return deps.hotkeyStateApi.annotationBubbleKey },
    getChunkCnKey: function () { return deps.hotkeyStateApi.chunkCnKey },
    getChunkShadowKey: function () { return deps.hotkeyStateApi.chunkShadowKey },
    getBackwardKey: function () { return deps.hotkeyStateApi.backwardKey },
    getForwardKey: function () { return deps.hotkeyStateApi.forwardKey },
    getPrevAnnotationWordKey: function () { return deps.hotkeyStateApi.prevAnnotationWordKey },
    getNextAnnotationWordKey: function () { return deps.hotkeyStateApi.nextAnnotationWordKey },
    navigateAnnotationWord: direction => deps.wordNavigationApi?.navigate(direction),
    closeAnnotationNavigation: () => deps.wordNavigationApi?.close(),
    toggleMarkCurrent: function (activeMedia = deps.audioPlayer) {
      // Hover takes priority without seeking or replacing the playback/click position.
      const hoveredIndex = deps.getHoveredWordIndex?.();
      const wordIndex = Number.isInteger(hoveredIndex) && hoveredIndex >= 0
        && hoveredIndex < deps.transcriptState.words.length
        ? hoveredIndex
        : activeMedia?.paused === false
          ? bsFindActive(deps.transcriptState.wordStarts, deps.transcriptState.words, activeMedia.currentTime)
          : deps.transcriptState.currentWordIndex;
      return deps.marksStore.toggleMark(
        deps.marksStateApi.markedMap,
        wordIndex,
        deps.transcriptState.words,
        deps.saveToDB,
        deps.syncAnnotationGenerationEntryStatus
      )
    },
    onMarkError: function (error) {
      deps.showError('MARKS_SAVE', error && error.message ? error.message : 'Mark could not be saved')
    },
    toggleAnnotationBubble: deps.toggleAnnotationBubble,
    beginHoldChunkCn: deps.chunkControlsApi.beginHoldChunkCn,
    endHoldChunkCn: deps.chunkControlsApi.endHoldChunkCn,
    toggleChunkCn: deps.chunkControlsApi.toggleChunkCn,
    toggleChunkShadow: deps.chunkControlsApi.toggleChunkShadow,
    handleBackwardClick: deps.handleBackwardClick,
    handleForwardClick: deps.handleForwardClick,
    closeCustomThemePanel: function () { deps.themeStore.closeCustomThemePanel() },
    hotkeyInput: deps.hotkeyInput,
    hotkeyAnnotationBubbleInput: deps.hotkeyAnnotationBubbleInput,
    hotkeyBackwardInput: deps.hotkeyBackwardInput,
    hotkeyForwardInput: deps.hotkeyForwardInput,
    hotkeyPrevAnnotationWordInput: deps.hotkeyPrevAnnotationWordInput,
    hotkeyNextAnnotationWordInput: deps.hotkeyNextAnnotationWordInput,
    hotkeyChunkCnInput: deps.hotkeyChunkCnInput,
    hotkeyChunkShadowInput: deps.hotkeyChunkShadowInput,
    highlightColorInput: deps.highlightColorInput,
    sentenceColorInput: deps.sentenceColorInput,
    themeCustomPanel: deps.themeCustomPanel,
    themeControlsEl: deps.themeControlsEl,
    setMarkKey: deps.hotkeyStateApi.setMarkKey,
    setAnnotationBubbleKey: deps.hotkeyStateApi.setAnnotationBubbleKey,
    setChunkCnKey: deps.hotkeyStateApi.setChunkCnKey,
    setChunkShadowKey: deps.hotkeyStateApi.setChunkShadowKey,
    setBackwardKey: deps.hotkeyStateApi.setBackwardKey,
    setForwardKey: deps.hotkeyStateApi.setForwardKey,
    setPrevAnnotationWordKey: deps.hotkeyStateApi.setPrevAnnotationWordKey,
    setNextAnnotationWordKey: deps.hotkeyStateApi.setNextAnnotationWordKey
  })
  return {
    dispose() {
      keyboardController?.dispose()
      deps.disposeNavigation?.()
    }
  }
}
