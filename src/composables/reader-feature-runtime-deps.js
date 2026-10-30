import { initReaderInteractionRuntime } from './reader-interaction-runtime.js'
import { initReaderControlsRuntime } from './reader-controls-runtime.js'
import { initReaderKeyboardRuntime } from './reader-keyboard-runtime.js'
import { initReaderAppRuntime } from './reader-app-runtime.js'
import { initReaderImportRuntime } from './reader-import-runtime.js'
import { requirePiniaRuntimeStores } from '../pinia-stores/runtime-registry.js'
import { watch } from 'vue'
import { createReaderWordNavigation } from './reader-word-navigation.js'
import { isReaderShortcutEventAllowed } from './reader-shortcut-scope.js'
import { getHoveredReaderWordIndex } from './reader-word-hover.js'

function createThemeStoreAdapter(themeStore) {
  return {
    init: themeStore.init.bind(themeStore),
    applyThemeMode: themeStore.applyMode.bind(themeStore),
    applyCustomTheme: themeStore.applyCustom.bind(themeStore),
    closeCustomThemePanel: themeStore.closeCustomPanel.bind(themeStore),
    openCustomThemePanel: themeStore.openCustomPanel.bind(themeStore),
    getStoredCustomThemeColors: themeStore.getStoredCustomThemeColors.bind(themeStore),
    CUSTOM_THEME_DEFAULTS: themeStore.CUSTOM_THEME_DEFAULTS,
  }
}

function createMarksStoreAdapter(marksStore) {
  return {
    toggleMark: marksStore.toggle.bind(marksStore),
    syncMarkedWordVisual: marksStore.syncVisual.bind(marksStore),
    exportMarksToArray: marksStore.exportToArray.bind(marksStore),
  }
}

export function createReaderFeatureAdapters(deps) {
  const globalObject = deps.globalObject || globalThis
  const runtimeContext = deps.runtimeContext
  const bootstrap = deps.bootstrapRuntime
  const helpers = bootstrap.runtimeDeps
  const dom = runtimeContext.domRefs
  const runtimeStores = requirePiniaRuntimeStores()
  const themeStore = createThemeStoreAdapter(runtimeStores.theme)
  const marksStore = createMarksStoreAdapter(runtimeStores.marks)
  let wordNavigationApi = null
  const shared = {
    runtimeState: deps.runtimeState,
    transcriptState: bootstrap.transcriptState,
    chunkState: bootstrap.chunkState,
    playbackState: bootstrap.playbackState,
    audioIdentityApi: bootstrap.audioIdentityApi,
    hotkeyStateApi: bootstrap.hotkeyStateApi,
    marksStateApi: bootstrap.marksStateApi,
    saveToDB: bootstrap.saveToDB,
    bridgeToPinia: bootstrap.bridgeToPinia,
  }

  function startImport({ getChunkControlsApi }) {
    return initReaderImportRuntime({
      ...shared,
      importModule: globalObject.__importModule,
      audioFileInput: dom.audioFileInput,
      transcriptFileInput: dom.transcriptFileInput,
      visualFileInput: dom.visualFileInput,
      getFirstFileFromEvent: helpers.getFirstFileFromEvent,
      readFileAsText: helpers.readFileAsText,
      applyCurrentAudioMeta: bootstrap.audioIdentityApi.applyCurrentAudioMeta,
      restoreReaderFocus: runtimeContext.restoreReaderFocus,
      showToast: deps.showToast,
      showError: deps.showError,
      markFileLoaded: helpers.markFileLoaded,
      lblAudio: dom.lblAudio,
      lblTranscript: dom.lblTranscript,
      lblVisual: dom.lblVisual,
      validateVisualData: helpers.validateVisualData,
      validateTranscriptData: helpers.validateTranscriptData,
      renderTranscript: deps.renderTranscript,
      renderChunkMode: deps.renderChunkMode,
      audioPlayer: dom.audioPlayer,
      transcriptContainer: dom.transcriptContainer,
      getChunkControlsApi,
      toggleChunkBtn: dom.toggleChunkBtn,
      cleanTextHelper: helpers.cleanTextHelper,
      tokenizeTextHelper: helpers.tokenizeTextHelper,
      findExactMatchRangeHelper: helpers.findExactMatchRangeHelper,
      buildVocabMatchMap: helpers.buildVocabMatchMapHelper,
    })
  }

  function startControls({ getForceUpdateUI }) {
    return initReaderControlsRuntime({
      transcriptState: shared.transcriptState,
      chunkState: shared.chunkState,
      playbackState: shared.playbackState,
      highlightModeBtn: dom.highlightModeBtn,
      toggleChunkBtn: dom.toggleChunkBtn,
      chunkCnHoldBtn: dom.chunkCnHoldBtn,
      audioPlayer: dom.audioPlayer,
      renderChunkMode: deps.renderChunkMode,
      renderTranscript: deps.renderTranscript,
      getForceUpdateUI,
      bridgeToPinia: shared.bridgeToPinia,
      styleEditor: globalObject.__styleEditor,
      themeStore,
      themeToggleBtn: dom.themeToggleBtn,
      themeCustomBgInput: dom.themeCustomBgInput,
      themeCustomTextInput: dom.themeCustomTextInput,
      themeCustomSubInput: dom.themeCustomSubInput,
      themeCustomBorderInput: dom.themeCustomBorderInput,
      themeCustomButtonInput: dom.themeCustomButtonInput,
      themeCustomResetBtn: dom.themeCustomResetBtn,
    })
  }

  function startInteraction({ visualVocabApi }) {
    return initReaderInteractionRuntime({
      runtimeState: shared.runtimeState,
      transcriptState: shared.transcriptState,
      chunkState: shared.chunkState,
      playbackState: shared.playbackState,
      audioPlayer: dom.audioPlayer,
      mainAppArea: dom.mainAppArea,
      transcriptContainer: dom.transcriptContainer,
      findChunkIndexByTimeHelper: helpers.findChunkIndexByTimeHelper,
      getCurrentSegmentIndexHelper: helpers.getCurrentSegmentIndexHelper,
      getSegmentCheckpointsHelper: helpers.getSegmentCheckpointsHelper,
      bsFindActiveHelper: helpers.bsFindActiveHelper,
      markedMap: shared.marksStateApi.markedMap,
      vocabMatchMap: visualVocabApi.vocabMatchMap,
      onAnnotationTargetSelected: span => wordNavigationApi?.selectSpan(span),
      onAnnotationBubbleClose: () => wordNavigationApi?.clearSelection(),
      getSelection: () => globalObject.getSelection && globalObject.getSelection(),
      playbackModule: globalObject.__playbackModule,
      getWindow: () => globalObject,
      bridgeToPinia: shared.bridgeToPinia,
    })
  }

  function startKeyboard({ chunkControlsApi, interactionRuntime }) {
    const resolver = interactionRuntime.playbackRuntime.annotationBubbleResolverApi
    wordNavigationApi = createReaderWordNavigation({
      documentObject: globalObject.document,
      selectionStore: runtimeStores.transcript,
      getWords: () => shared.transcriptState.words,
      getPlaybackWordIndex: () => shared.transcriptState.currentWordIndex,
      isChunkMode: () => shared.chunkState.isChunkMode,
      getNavigableWordIndices: resolver.getNavigableWordIndices,
      notifyAnnotationBubbleWordClick: resolver.notifyAnnotationBubbleWordClick,
      closeBubble: () => resolver.getAnnotationBubble()?.hide(),
    })
    const stopWatching = watch(
      () => [runtimeStores.transcript.words, resolver.getScopeKey()],
      () => { wordNavigationApi.clearSelection(); resolver.clear() },
      { flush: 'sync' }
    )
    return initReaderKeyboardRuntime({
      keyboardModule: globalObject.__keyboardModule,
      getHoveredWordIndex: () => getHoveredReaderWordIndex(globalObject.document),
      isReaderShortcutEventAllowed,
      marksStore,
      themeStore,
      audioPlayer: dom.audioPlayer,
      transcriptState: shared.transcriptState,
      chunkState: shared.chunkState,
      hotkeyStateApi: shared.hotkeyStateApi,
      marksStateApi: shared.marksStateApi,
      chunkControlsApi,
      saveToDB: shared.saveToDB,
      syncAnnotationGenerationEntryStatus: deps.syncAnnotationGenerationEntryStatus,
      showError: deps.showError,
      toggleAnnotationBubble: interactionRuntime.toggleAnnotationBubble,
      handleBackwardClick: interactionRuntime.handleBackwardClick,
      handleForwardClick: interactionRuntime.handleForwardClick,
      wordNavigationApi,
      disposeNavigation() {
        stopWatching()
        wordNavigationApi.dispose()
        resolver.clear()
        resolver.dispose()
      },
      hotkeyInput: dom.hotkeyInput,
      hotkeyAnnotationBubbleInput: dom.hotkeyAnnotationBubbleInput,
      hotkeyBackwardInput: dom.hotkeyBackwardInput,
      hotkeyForwardInput: dom.hotkeyForwardInput,
      hotkeyPrevAnnotationWordInput: dom.hotkeyPrevAnnotationWordInput,
      hotkeyNextAnnotationWordInput: dom.hotkeyNextAnnotationWordInput,
      hotkeyChunkCnInput: dom.hotkeyChunkCnInput,
      hotkeyChunkShadowInput: dom.hotkeyChunkShadowInput,
      highlightColorInput: dom.highlightColorInput,
      sentenceColorInput: dom.sentenceColorInput,
      themeCustomPanel: dom.themeCustomPanel,
      themeControlsEl: dom.themeControlsEl,
    })
  }

  function startApp({ chunkControlsApi, interactionRuntime }) {
    return initReaderAppRuntime({
      annotationLightweightModule: globalObject.__annotationLightweightModule,
      appHandlers: globalObject.__appHandlers,
      controlsModule: globalObject.__controlsModule,
      runtimeState: shared.runtimeState,
      transcriptState: shared.transcriptState,
      chunkState: shared.chunkState,
      marksStateApi: shared.marksStateApi,
      chunkControlsApi,
      audioIdentityApi: shared.audioIdentityApi,
      playbackRuntimeHelpersApi: interactionRuntime.playbackRuntimeHelpersApi,
      audioPlayer: dom.audioPlayer,
      getFirstFileFromEvent: helpers.getFirstFileFromEvent,
      readFileAsText: helpers.readFileAsText,
      validateMarksArray: helpers.validateMarksArray,
      saveToDB: shared.saveToDB,
      applyCurrentAudioMeta: bootstrap.audioIdentityApi.applyCurrentAudioMeta,
      renderTranscript: deps.renderTranscript,
      renderChunkMode: deps.renderChunkMode,
      forceUpdateUI: interactionRuntime.forceUpdateUI,
      bsFindActiveHelper: helpers.bsFindActiveHelper,
      getCurrentSegmentIndexHelper: helpers.getCurrentSegmentIndexHelper,
      toggleFollowBtn: dom.toggleFollowBtn,
      mainAppArea: dom.mainAppArea,
      exportAnnotationLightweightBtn: dom.exportAnnotationLightweightBtn,
      annotationBackfillAiBtn: dom.annotationBackfillAiBtn,
      settleArticleVocabularyBtn: dom.settleArticleVocabularyBtn,
      exportJsonBtn: dom.exportJsonBtn,
      exportMdAllBtn: dom.exportMdAllBtn,
      importMarksBtn: dom.importMarksBtn,
      importMarksInput: dom.importMarksInput,
      syncAnnotationGenerationEntryStatus: deps.syncAnnotationGenerationEntryStatus,
      showToast: deps.showToast,
      showError: deps.showError,
    })
  }

  return Object.freeze({ startImport, startControls, startInteraction, startKeyboard, startApp })
}
