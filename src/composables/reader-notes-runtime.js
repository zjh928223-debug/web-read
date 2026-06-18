import { initPiniaBridge } from './pinia-bridge-module.js'

export function initReaderNotesRuntime(deps = {}) {
  var notesModule = deps.notesModule
  var chunkNoteLayout = deps.chunkNoteLayout
  var transcriptState = deps.transcriptState
  var chunkState = deps.chunkState
  var clozeState = deps.clozeState
  var notesState = notesModule.getNotesState()

  var bridgeToPinia = initPiniaBridge({
    transcriptState,
    chunkState,
    clozeState,
    getNotesState() { return notesState }
  })

  var chunkNotesApi = null
  chunkNotesApi = notesModule.initChunkNotes({
    state: notesState,
    loadFromDB: deps.loadFromDB,
    saveToDB: deps.saveToDB,
    getChunkNotesStorageKey: deps.audioIdentityApi.getChunkNotesStorageKey,
    getChunkNoteDraftStorageKey: deps.audioIdentityApi.getChunkNoteDraftStorageKey,
    sanitizeChunkNoteFontSize: chunkNoteLayout.sanitizeChunkNoteFontSize,
    getIsChunkMode() { return chunkState.isChunkMode },
    currentAudioKeyGetter() { return deps.audioIdentityApi.currentAudioKey },
    getHasAiChunkData() { return chunkState.hasAiChunkData },
    mainAppArea: deps.mainAppArea,
    chunkNoteSvgLayer: deps.chunkNoteSvgLayer,
    chunkNoteLayer: deps.chunkNoteLayer,
    getChunkNoteMeasureFont: chunkNoteLayout.getChunkNoteMeasureFont,
    measureChunkNoteTextBox: chunkNoteLayout.measureChunkNoteTextBox,
    applyChunkNoteAutoSize: chunkNoteLayout.applyChunkNoteAutoSize,
    buildChunkNoteLayout: chunkNoteLayout.buildChunkNoteLayout,
    canChunkNoteTextFitMinReadable: chunkNoteLayout.canChunkNoteTextFitMinReadable,
    makeSelectionNoteBaseId: chunkNoteLayout.makeSelectionNoteBaseId,
    makeSelectionNoteId: chunkNoteLayout.makeSelectionNoteId,
    findNearestChunkWord: chunkNoteLayout.findNearestChunkWord,
    saveOpenChunkNotePopover() {
      if (chunkNotesApi.getChunkNoteModalEl()) chunkNotesApi.saveChunkNoteFromModal()
    },
    chunkNoteCtxMenuEl: deps.chunkNoteCtxMenu
  })

  var sentenceNotesApi = notesModule.initSentenceNotes({
    state: notesState,
    loadFromDB: deps.loadFromDB,
    saveToDB: deps.saveToDB,
    getSentenceNotesStorageKey: deps.audioIdentityApi.getSentenceNotesStorageKey,
    getLegacySentenceNotesStorageKey: deps.audioIdentityApi.getLegacySentenceNotesStorageKey,
    buildCurrentSentenceDocId: deps.audioIdentityApi.buildCurrentSentenceDocId,
    isPlainObjectRecord: deps.isPlainObjectRecord,
    getIsChunkMode() { return chunkState.isChunkMode },
    getHasAiChunkData() { return chunkState.hasAiChunkData },
    notePreviewSidebar: deps.notePreviewSidebar,
    notePreviewEmpty: deps.notePreviewEmpty,
    notePreviewList: deps.notePreviewList,
    toggleNotePreviewBtn: deps.toggleNotePreviewBtn,
    notePreviewResizeHandle: deps.notePreviewResizeHandle,
    notePreviewResizeHandleY: deps.notePreviewResizeHandleY,
    initialNotePreviewVisible: true,
    initialNotePreviewWidth: 340,
    initialNotePreviewHeight: 640
  })

  return {
    notesState,
    bridgeToPinia,
    chunkNotesApi,
    sentenceNotesApi
  }
}
