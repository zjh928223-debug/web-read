import { initPiniaBridge } from './pinia-bridge-module.js'

function createDisabledChunkNotesApi() {
  return {
    ensureChunkNoteOverlayLayers() {},
    closeChunkNoteContextMenu() {},
    closeChunkNotePopover() {},
    clearChunkNoteConnectors() {},
    adjustChunkNoteArrowSizeByGap() {},
    renderAllChunkNoteTags() {},
    scheduleChunkNoteConnectorRedraw() {},
    refreshAllChunkNoteVisuals() {},
    listChunkNotes() { return [] },
    getChunkNoteTagById() { return null },
    getChunkNoteContentBoxSize() { return null },
    handleChunkSelectionContextMenu() { return false },
    cancelChunkNoteModal() {},
    closeChunkNoteDeleteDialog() {},
    setSelectedChunkNote() { return '' },
    openChunkNoteDeleteDialog() {},
    getChunkNoteDeleteDialogEl() { return null },
    getSelectedChunkNoteId() { return '' },
    getPendingChunkSelectionCtx() { return null },
    consumePendingChunkSelectionCtx() { return null },
    openChunkNotePopover() {},
    getChunkNoteModalEl() { return null },
    saveChunkNoteFromModal() {},
    applyImportedChunkNotes() { return Promise.resolve(false) },
    saveChunkNotesNow() { return Promise.resolve(false) },
    buildChunkNotesSnapshot() { return { version: 1, audioKey: '', notes: [] } },
    getChunkNotesFileState() { return { handle: null, audioKey: '', fileName: '' } },
    setChunkNotesFileState() {},
    clearChunkNotesFileState() {},
    loadChunkNotesForCurrentAudio() { return Promise.resolve({}) },
    setChunkNoteVisible() { return false },
    setChunkNoteDraftRestoreDone() {},
    tryRestoreChunkNoteDraft() {}
  }
}

function createDisabledSentenceNotesApi() {
  return {
    loadSentenceNotesForCurrentAudio() { return Promise.resolve({}) },
    switchSentenceNotesDoc() { return Promise.resolve({}) },
    hasActiveTextSelectionWithinChunk() { return false }
  }
}

export function initReaderNotesRuntime(deps = {}) {
  var notesState = {
    chunkNotesMap: {},
    chunkNoteVisible: false,
    sentenceNotesMap: {},
    allSentenceNotesByDoc: {},
    currentDocId: '',
    selectedSentence: null
  }

  var bridgeToPinia = initPiniaBridge({
    transcriptState: deps.transcriptState,
    chunkState: deps.chunkState,
    clozeState: deps.clozeState,
    getNotesState() { return notesState }
  })

  return {
    notesState,
    bridgeToPinia,
    chunkNotesApi: createDisabledChunkNotesApi(),
    sentenceNotesApi: createDisabledSentenceNotesApi()
  }
}
