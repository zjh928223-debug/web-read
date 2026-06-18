import { configureSessionStateProvider } from './session-state-provider.js'
import { initVisualVocab } from './visual-vocab-module.js'
import { configureRuntimeStateBindings } from './runtime-state-bindings.js'
import {
  configureSessionFacades,
  clearGeneratedAnnotationIndex,
  clearPersistedChunkSession,
  getAnnotationGenerationScope,
  emitAnnotationDiagnostics,
  scheduleGeneratedAnnotationIndexRefresh,
  syncAnnotationGenerationEntryStatus
} from './session-facades.js'

export function initReaderImportRuntime(deps = {}) {
  configureSessionFacades({
    getRuntimeState: function () { return deps.runtimeState }
  })
  configureSessionStateProvider(deps.runtimeState)

  var visualVocabApi = initVisualVocab({
    visualFileInput: deps.visualFileInput,
    validateVisualData: deps.validateVisualData,
    buildVocabMatchMap: deps.buildVocabMatchMap,
    hasTranscriptData: function () { return deps.transcriptState.segments.length > 0 },
    getWords: function () { return deps.transcriptState.words },
    saveToDB: deps.saveToDB,
    getFirstFileFromEvent: deps.getFirstFileFromEvent,
    readFileAsText: deps.readFileAsText,
    markFileLoaded: deps.markFileLoaded,
    lblVisual: deps.lblVisual,
    showToast: deps.showToast,
    showError: deps.showError,
    restoreReaderFocus: deps.restoreReaderFocus,
    bridgeToPinia: deps.bridgeToPinia
  })

  configureRuntimeStateBindings({
    runtimeState: deps.runtimeState,
    transcriptState: deps.transcriptState,
    chunkState: deps.chunkState,
    clozeState: deps.clozeState,
    playbackState: deps.playbackState,
    audioIdentityApi: deps.audioIdentityApi,
    hotkeyStateApi: deps.hotkeyStateApi,
    marksStateApi: deps.marksStateApi,
    visualVocabApi: visualVocabApi
  })

  var chunkPipelineApi = deps.importModule.initChunkPipeline({
    state: deps.runtimeState,
    getIsChunkMode: function () { return deps.chunkState.isChunkMode },
    renderChunkMode: deps.renderChunkMode,
    bridgeToPinia: deps.bridgeToPinia,
    toggleChunkBtn: deps.toggleChunkBtn,
    enterChunkMode: function () {
      var chunkControlsApi = deps.getChunkControlsApi()
      if (chunkControlsApi) chunkControlsApi.toggleChunkMode(true)
    },
    cleanTextHelper: deps.cleanTextHelper,
    tokenizeTextHelper: deps.tokenizeTextHelper,
    findExactMatchRangeHelper: deps.findExactMatchRangeHelper
  })

  var importHandlersApi = deps.importModule.initImportHandlers({
    state: deps.runtimeState,
    audioFileInput: deps.audioFileInput,
    transcriptFileInput: deps.transcriptFileInput,
    chunkFileInput: deps.chunkFileInput,
    clozeFileInput: deps.clozeFileInput,
    getFirstFileFromEvent: deps.getFirstFileFromEvent,
    readFileAsText: deps.readFileAsText,
    saveToDB: deps.saveToDB,
    applyCurrentAudioMeta: deps.applyCurrentAudioMeta,
    clearGeneratedAnnotationIndex: clearGeneratedAnnotationIndex,
    restoreReaderFocus: deps.restoreReaderFocus,
    showToast: deps.showToast,
    showError: deps.showError,
    markFileLoaded: deps.markFileLoaded,
    lblAudio: deps.lblAudio,
    lblTranscript: deps.lblTranscript,
    validateTranscriptData: deps.validateTranscriptData,
    validateChunkData: deps.validateChunkData,
    validateClozeData: deps.validateClozeData,
    clearPersistedChunkSession: clearPersistedChunkSession,
    switchSentenceNotesDoc: deps.switchSentenceNotesDoc,
    getAnnotationGenerationScope: getAnnotationGenerationScope,
    emitAnnotationDiagnostics: emitAnnotationDiagnostics,
    buildCurrentSentenceDocId: deps.audioIdentityApi.buildCurrentSentenceDocId,
    scheduleGeneratedAnnotationIndexRefresh: scheduleGeneratedAnnotationIndexRefresh,
    renderTranscript: deps.renderTranscript,
    renderChunkMode: deps.renderChunkMode,
    forceUpdateUI: deps.forceUpdateUI,
    syncAnnotationGenerationEntryStatus: syncAnnotationGenerationEntryStatus,
    bridgeToPinia: deps.bridgeToPinia,
    rebuildVocabMatching: visualVocabApi.rebuildVocabMatching,
    closeChunkNoteExportDialog: deps.closeChunkNoteExportDialog,
    loadChunkNotesForCurrentAudio: deps.loadChunkNotesForCurrentAudio,
    clearChunkNotesFileState: function () { return deps.chunkNotesApi.clearChunkNotesFileState() },
    processChunkData: chunkPipelineApi.processChunkData,
    audioPlayer: deps.audioPlayer,
    transcriptContainer: deps.transcriptContainer,
    _ns: deps.notesState,
    markedMap: deps.marksStateApi.markedMap
  })

  return {
    visualVocabApi: visualVocabApi,
    chunkPipelineApi: chunkPipelineApi,
    importHandlersApi: importHandlersApi
  }
}
