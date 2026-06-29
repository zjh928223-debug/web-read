import { initChunkControls } from './chunk-controls-module.js'
import { initHighlightControls } from './highlight-controls-module.js'
import { initThemeControls } from './theme-controls-module.js'

export function initReaderControlsRuntime(deps = {}) {
  var highlightControlsApi = initHighlightControls({
    transcriptState: deps.transcriptState,
    chunkState: deps.chunkState,
    playbackState: deps.playbackState,
    highlightModeBtn: deps.highlightModeBtn,
    audioPlayer: deps.audioPlayer,
    getForceUpdateUI: deps.getForceUpdateUI
  })

  var chunkControlsApi = initChunkControls({
    state: deps.chunkState,
    toggleChunkBtn: deps.toggleChunkBtn,
    chunkCnHoldBtn: deps.chunkCnHoldBtn,
    audioPlayer: deps.audioPlayer,
    updateHighlightModeUI: highlightControlsApi.updateHighlightModeUI,
    closeChunkNoteContextMenu: deps.closeChunkNoteContextMenu,
    closeChunkNotePopover: deps.closeChunkNotePopover,
    renderChunkMode: deps.renderChunkMode,
    renderTranscript: deps.renderTranscript,
    clearChunkNoteConnectors: deps.clearChunkNoteConnectors,
    getForceUpdateUI: deps.getForceUpdateUI,
    bridgeToPinia: deps.bridgeToPinia
  })

  deps.styleEditor.init({
    adjustChunkNoteArrowSizeByGap: deps.adjustChunkNoteArrowSizeByGap,
    renderAllChunkNoteTags: deps.renderAllChunkNoteTags,
    scheduleChunkNoteConnectorRedraw: deps.scheduleChunkNoteConnectorRedraw,
    getIsChunkMode() { return deps.chunkState.isChunkMode },
    closeChunkNotePopover: deps.closeChunkNotePopover,
    updateShadowBtnText: chunkControlsApi.updateShadowBtnText
  })

  initThemeControls({
    themeStore: deps.themeStore,
    themeToggleBtn: deps.themeToggleBtn,
    themeCustomBgInput: deps.themeCustomBgInput,
    themeCustomTextInput: deps.themeCustomTextInput,
    themeCustomSubInput: deps.themeCustomSubInput,
    themeCustomBorderInput: deps.themeCustomBorderInput,
    themeCustomButtonInput: deps.themeCustomButtonInput,
    themeCustomResetBtn: deps.themeCustomResetBtn,
    refreshAllChunkNoteVisuals: deps.refreshAllChunkNoteVisuals,
    getLockChunkNoteDimensionsForTheme: deps.getLockChunkNoteDimensionsForTheme
  })

  return {
    highlightControlsApi,
    chunkControlsApi
  }
}
