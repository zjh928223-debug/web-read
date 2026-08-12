import { initReaderInteractionRuntime } from './reader-interaction-runtime.js'
import { initReaderControlsRuntime } from './reader-controls-runtime.js'
import { initReaderKeyboardRuntime } from './reader-keyboard-runtime.js'
import { initReaderAppRuntime } from './reader-app-runtime.js'
import { initReaderImportRuntime } from './reader-import-runtime.js'

export function createReaderFeatureAdapters(deps) {
  const globalObject = deps.globalObject || globalThis
  const runtimeContext = deps.runtimeContext
  const bootstrap = deps.bootstrapRuntime
  const helpers = bootstrap.runtimeDeps
  const dom = runtimeContext.domRefs
  const shared = {
    runtimeState: deps.runtimeState,
    transcriptState: bootstrap.transcriptState,
    chunkState: bootstrap.chunkState,
    clozeState: bootstrap.clozeState,
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
      themeStore: globalObject.__themeStore,
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
      getSelection: () => globalObject.getSelection && globalObject.getSelection(),
      playbackModule: globalObject.__playbackModule,
      getWindow: () => globalObject,
      bridgeToPinia: shared.bridgeToPinia,
    })
  }

  function startKeyboard({ chunkControlsApi, interactionRuntime }) {
    return initReaderKeyboardRuntime({
      keyboardModule: globalObject.__keyboardModule,
      marksStore: globalObject.__marksStore,
      themeStore: globalObject.__themeStore,
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
      hotkeyInput: dom.hotkeyInput,
      hotkeyAnnotationBubbleInput: dom.hotkeyAnnotationBubbleInput,
      hotkeyBackwardInput: dom.hotkeyBackwardInput,
      hotkeyForwardInput: dom.hotkeyForwardInput,
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
      importAnnotationLightweightBtn: dom.importAnnotationLightweightBtn,
      importAnnotationLightweightInput: dom.importAnnotationLightweightInput,
      annotationBackfillAiBtn: dom.annotationBackfillAiBtn,
      previewVocabularyBtn: dom.previewVocabularyBtn,
      togglePreviewVocabularyBtn: dom.togglePreviewVocabularyBtn,
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
