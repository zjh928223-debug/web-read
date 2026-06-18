import { initGlassEffects } from './glass-effects.js'
import { initChunkNoteTransfer } from './chunk-note-transfer-module.js'
import { configureReaderPublicFacades } from './reader-public-facades.js'

export function initReaderAppRuntime(deps = {}) {
  var chunkNoteTransferApi = initChunkNoteTransfer({
    importButton: deps.importChunkNotesBtn,
    importInput: deps.importChunkNotesInput,
    exportButton: deps.exportChunkNotesBtn,
    getFirstFileFromEvent: deps.getFirstFileFromEvent,
    readFileAsText: deps.readFileAsText,
    applyImportedChunkNotes: function (data) { return deps.chunkNotesApi.applyImportedChunkNotes(data) },
    saveChunkNotesNow: deps.chunkNotesApi.saveChunkNotesNow,
    getHasAiChunkData: function () { return deps.chunkState.hasAiChunkData },
    getIsChunkMode: function () { return deps.chunkState.isChunkMode },
    enterChunkMode: function () { return deps.chunkControlsApi.toggleChunkMode(true) },
    setChunkNoteVisible: deps.setChunkNoteVisible,
    renderChunkMode: deps.renderChunkMode,
    buildChunkNotesSnapshot: deps.chunkNotesApi.buildChunkNotesSnapshot,
    getCurrentAudioFilenameBase: deps.audioIdentityApi.getCurrentAudioFilenameBase,
    getChunkNotesFileState: function () { return deps.chunkNotesApi.getChunkNotesFileState() },
    setChunkNotesFileState: function (fileState) { return deps.chunkNotesApi.setChunkNotesFileState(fileState) },
    getCurrentAudioKey: function () { return deps.audioIdentityApi.currentAudioKey },
    showToast: deps.showToast,
    showError: deps.showError
  })

  deps.annotationLightweightModule.initManualLightweightAnnotationControls({
    exportButton: deps.exportAnnotationLightweightBtn,
    importButton: deps.importAnnotationLightweightBtn,
    importInput: deps.importAnnotationLightweightInput,
    getFirstFileFromEvent: deps.getFirstFileFromEvent,
    refreshAfterImport: function () {
      if (deps.chunkState.isChunkMode) deps.renderChunkMode()
      else deps.renderTranscript()
      deps.forceUpdateUI(deps.audioPlayer.currentTime)
    },
    showToast: deps.showToast,
    showError: deps.showError
  })

  deps.appHandlers.initExports({
    exportJsonBtn: deps.exportJsonBtn,
    exportMdAllBtn: deps.exportMdAllBtn,
    markedMap: deps.marksStateApi.markedMap,
    getSegments: function () { return deps.transcriptState.segments },
    showError: deps.showError,
    showToast: deps.showToast
  })

  deps.appHandlers.initMarksImport({
    importMarksBtn: deps.importMarksBtn,
    importMarksInput: deps.importMarksInput,
    getFirstFileFromEvent: deps.getFirstFileFromEvent,
    readFileAsText: deps.readFileAsText,
    validateMarksArray: deps.validateMarksArray,
    getWords: function () { return deps.transcriptState.words },
    markedMap: deps.marksStateApi.markedMap,
    saveToDB: deps.saveToDB,
    isChunkModeFn: function () { return deps.chunkState.isChunkMode },
    renderTranscript: deps.renderTranscript,
    renderChunkMode: deps.renderChunkMode,
    forceUpdateUI: deps.forceUpdateUI,
    audioPlayer: deps.audioPlayer,
    syncAnnotationGenerationEntryStatus: deps.syncAnnotationGenerationEntryStatus,
    showToast: deps.showToast,
    showError: deps.showError
  })

  deps.controlsModule.init({
    state: deps.runtimeState,
    audioPlayer: deps.audioPlayer,
    bsFindActiveHelper: deps.bsFindActiveHelper,
    findChunkIndexByTime: deps.playbackRuntimeHelpersApi.findChunkIndexByTime,
    getCurrentSegmentIndexHelper: deps.getCurrentSegmentIndexHelper,
    toggleFollowBtn: deps.toggleFollowBtn,
    mainAppArea: deps.mainAppArea
  })

  initGlassEffects({
    listChunkNotes: function () { return deps.chunkNotesApi.listChunkNotes() },
    getChunkNoteTagById: deps.chunkNotesApi.getChunkNoteTagById,
    getChunkNoteContentBoxSize: deps.chunkNotesApi.getChunkNoteContentBoxSize
  })

  configureReaderPublicFacades({
    selectSentenceFromChunkTarget: deps.sentenceNotesApi.selectSentenceFromChunkTarget,
    buildCurrentSentenceDocId: deps.audioIdentityApi.buildCurrentSentenceDocId,
    loadChunkNotesForCurrentAudio: deps.loadChunkNotesForCurrentAudio,
    setChunkNoteVisible: deps.setChunkNoteVisible,
    loadSentenceNotesForCurrentAudio: deps.loadSentenceNotesForCurrentAudio,
    switchSentenceNotesDoc: deps.switchSentenceNotesDoc,
    applyCurrentAudioMeta: deps.applyCurrentAudioMeta,
    openChunkNoteContextFromEvent: function (event) { return deps.chunkNotesApi.handleChunkSelectionContextMenu(event) }
  })

  return { chunkNoteTransferApi }
}
