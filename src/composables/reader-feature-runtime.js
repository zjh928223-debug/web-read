import { initReaderInteractionRuntime } from './reader-interaction-runtime.js';
import { initReaderControlsRuntime } from './reader-controls-runtime.js';
import { initReaderKeyboardRuntime } from './reader-keyboard-runtime.js';
import { initReaderAppRuntime } from './reader-app-runtime.js';
import { initReaderImportRuntime } from './reader-import-runtime.js';

export function initReaderFeatureRuntime(deps = {}) {
  var globalObject = deps.globalObject || globalThis;
  var chunkControlsApi = null;
  var forceUpdateUI;

  var importRuntime = initReaderImportRuntime({
    importModule: globalObject.__importModule,
    runtimeState: deps.runtimeState,
    transcriptState: deps.transcriptState,
    chunkState: deps.chunkState,
    clozeState: deps.clozeState,
    playbackState: deps.playbackState,
    audioIdentityApi: deps.audioIdentityApi,
    hotkeyStateApi: deps.hotkeyStateApi,
    marksStateApi: deps.marksStateApi,
    audioFileInput: deps.audioFileInput,
    transcriptFileInput: deps.transcriptFileInput,
    visualFileInput: deps.visualFileInput,
    getFirstFileFromEvent: deps.getFirstFileFromEvent,
    readFileAsText: deps.readFileAsText,
    saveToDB: deps.saveToDB,
    applyCurrentAudioMeta: deps.applyCurrentAudioMeta,
    restoreReaderFocus: deps.restoreReaderFocus,
    showToast: deps.showToast,
    showError: deps.showError,
    markFileLoaded: deps.markFileLoaded,
    lblAudio: deps.lblAudio,
    lblTranscript: deps.lblTranscript,
    lblVisual: deps.lblVisual,
    validateVisualData: deps.validateVisualData,
    validateTranscriptData: deps.validateTranscriptData,
    switchSentenceNotesDoc: deps.switchSentenceNotesDoc,
    renderTranscript: deps.renderTranscript,
    renderChunkMode: deps.renderChunkMode,
    forceUpdateUI: forceUpdateUI,
    bridgeToPinia: deps.bridgeToPinia,
    loadChunkNotesForCurrentAudio: deps.loadChunkNotesForCurrentAudio,
    chunkNotesApi: deps.chunkNotesApi,
    audioPlayer: deps.audioPlayer,
    transcriptContainer: deps.transcriptContainer,
    notesState: deps.notesState,
    getChunkControlsApi: function () { return chunkControlsApi; },
    toggleChunkBtn: deps.toggleChunkBtn,
    cleanTextHelper: deps.cleanTextHelper,
    tokenizeTextHelper: deps.tokenizeTextHelper,
    findExactMatchRangeHelper: deps.findExactMatchRangeHelper,
    buildVocabMatchMap: deps.buildVocabMatchMap
  });
  var visualVocabApi = importRuntime.visualVocabApi;

  deps.chunkNotesApi.ensureChunkNoteOverlayLayers();

  var controlsRuntime = initReaderControlsRuntime({
    transcriptState: deps.transcriptState,
    chunkState: deps.chunkState,
    playbackState: deps.playbackState,
    highlightModeBtn: deps.highlightModeBtn,
    toggleChunkBtn: deps.toggleChunkBtn,
    chunkCnHoldBtn: deps.chunkCnHoldBtn,
    audioPlayer: deps.audioPlayer,
    closeChunkNoteContextMenu: deps.chunkNotesApi.closeChunkNoteContextMenu,
    closeChunkNotePopover: deps.chunkNotesApi.closeChunkNotePopover,
    renderChunkMode: deps.renderChunkMode,
    renderTranscript: deps.renderTranscript,
    clearChunkNoteConnectors: deps.chunkNotesApi.clearChunkNoteConnectors,
    getForceUpdateUI: function () { return forceUpdateUI; },
    bridgeToPinia: deps.bridgeToPinia,
    styleEditor: globalObject.__styleEditor,
    adjustChunkNoteArrowSizeByGap: deps.chunkNotesApi.adjustChunkNoteArrowSizeByGap,
    renderAllChunkNoteTags: deps.chunkNotesApi.renderAllChunkNoteTags,
    scheduleChunkNoteConnectorRedraw: deps.chunkNotesApi.scheduleChunkNoteConnectorRedraw,
    themeStore: globalObject.__themeStore,
    themeToggleBtn: deps.themeToggleBtn,
    themeCustomBgInput: deps.themeCustomBgInput,
    themeCustomTextInput: deps.themeCustomTextInput,
    themeCustomSubInput: deps.themeCustomSubInput,
    themeCustomBorderInput: deps.themeCustomBorderInput,
    themeCustomButtonInput: deps.themeCustomButtonInput,
    themeCustomResetBtn: deps.themeCustomResetBtn,
    refreshAllChunkNoteVisuals: deps.chunkNotesApi.refreshAllChunkNoteVisuals,
    getLockChunkNoteDimensionsForTheme: function () { return globalObject.__lockChunkNoteDimensionsForTheme; }
  });
  chunkControlsApi = controlsRuntime.chunkControlsApi;

  var interactionRuntime = initReaderInteractionRuntime({
    runtimeState: deps.runtimeState,
    transcriptState: deps.transcriptState,
    chunkState: deps.chunkState,
    playbackState: deps.playbackState,
    audioPlayer: deps.audioPlayer,
    mainAppArea: deps.mainAppArea,
    transcriptContainer: deps.transcriptContainer,
    findChunkIndexByTimeHelper: deps.findChunkIndexByTimeHelper,
    getCurrentSegmentIndexHelper: deps.getCurrentSegmentIndexHelper,
    getSegmentCheckpointsHelper: deps.getSegmentCheckpointsHelper,
    bsFindActiveHelper: deps.bsFindActiveHelper,
    markedMap: deps.marksStateApi.markedMap,
    vocabMatchMap: visualVocabApi.vocabMatchMap,
    hasActiveTextSelectionWithinChunk: deps.sentenceNotesApi.hasActiveTextSelectionWithinChunk,
    getSelection: function () { return globalObject.getSelection && globalObject.getSelection(); },
    playbackModule: globalObject.__playbackModule,
    getWindow: function () { return globalObject; },
    bridgeToPinia: deps.bridgeToPinia,
    tryRestoreChunkNoteDraft: deps.chunkNotesApi.tryRestoreChunkNoteDraft
  });
  var playbackRuntimeHelpersApi = interactionRuntime.playbackRuntimeHelpersApi;
  forceUpdateUI = interactionRuntime.forceUpdateUI;
  var toggleAnnotationBubble = interactionRuntime.toggleAnnotationBubble;
  var handleBackwardClick = interactionRuntime.handleBackwardClick;
  var handleForwardClick = interactionRuntime.handleForwardClick;

  initReaderKeyboardRuntime({
    keyboardModule: globalObject.__keyboardModule,
    marksStore: globalObject.__marksStore,
    themeStore: globalObject.__themeStore,
    audioPlayer: deps.audioPlayer,
    transcriptState: deps.transcriptState,
    chunkState: deps.chunkState,
    notesState: deps.notesState,
    hotkeyStateApi: deps.hotkeyStateApi,
    marksStateApi: deps.marksStateApi,
    chunkControlsApi: chunkControlsApi,
    chunkNotesApi: deps.chunkNotesApi,
    saveToDB: deps.saveToDB,
    syncAnnotationGenerationEntryStatus: deps.syncAnnotationGenerationEntryStatus,
    toggleAnnotationBubble: toggleAnnotationBubble,
    handleBackwardClick: handleBackwardClick,
    handleForwardClick: handleForwardClick,
    hotkeyInput: deps.hotkeyInput,
    hotkeyAnnotationBubbleInput: deps.hotkeyAnnotationBubbleInput,
    hotkeyBackwardInput: deps.hotkeyBackwardInput,
    hotkeyForwardInput: deps.hotkeyForwardInput,
    hotkeyChunkCnInput: deps.hotkeyChunkCnInput,
    hotkeyChunkShadowInput: deps.hotkeyChunkShadowInput,
    highlightColorInput: deps.highlightColorInput,
    sentenceColorInput: deps.sentenceColorInput,
    themeCustomPanel: deps.themeCustomPanel,
    themeControlsEl: deps.themeControlsEl
  });

  var appRuntime = initReaderAppRuntime({
    annotationLightweightModule: globalObject.__annotationLightweightModule,
    appHandlers: globalObject.__appHandlers,
    controlsModule: globalObject.__controlsModule,
    runtimeState: deps.runtimeState,
    transcriptState: deps.transcriptState,
    chunkState: deps.chunkState,
    marksStateApi: deps.marksStateApi,
    chunkControlsApi: chunkControlsApi,
    chunkNotesApi: deps.chunkNotesApi,
    sentenceNotesApi: deps.sentenceNotesApi,
    audioIdentityApi: deps.audioIdentityApi,
    playbackRuntimeHelpersApi: playbackRuntimeHelpersApi,
    audioPlayer: deps.audioPlayer,
    getFirstFileFromEvent: deps.getFirstFileFromEvent,
    readFileAsText: deps.readFileAsText,
    validateMarksArray: deps.validateMarksArray,
    saveToDB: deps.saveToDB,
    setChunkNoteVisible: deps.setChunkNoteVisible,
    loadChunkNotesForCurrentAudio: deps.loadChunkNotesForCurrentAudio,
    loadSentenceNotesForCurrentAudio: deps.loadSentenceNotesForCurrentAudio,
    switchSentenceNotesDoc: deps.switchSentenceNotesDoc,
    applyCurrentAudioMeta: deps.applyCurrentAudioMeta,
    renderTranscript: deps.renderTranscript,
    renderChunkMode: deps.renderChunkMode,
    forceUpdateUI: forceUpdateUI,
    bsFindActiveHelper: deps.bsFindActiveHelper,
    getCurrentSegmentIndexHelper: deps.getCurrentSegmentIndexHelper,
    toggleFollowBtn: deps.toggleFollowBtn,
    mainAppArea: deps.mainAppArea,
    exportAnnotationLightweightBtn: deps.exportAnnotationLightweightBtn,
    importAnnotationLightweightBtn: deps.importAnnotationLightweightBtn,
    importAnnotationLightweightInput: deps.importAnnotationLightweightInput,
    annotationBackfillAiBtn: deps.annotationBackfillAiBtn,
    exportJsonBtn: deps.exportJsonBtn,
    exportMdAllBtn: deps.exportMdAllBtn,
    importMarksBtn: deps.importMarksBtn,
    importMarksInput: deps.importMarksInput,
    syncAnnotationGenerationEntryStatus: deps.syncAnnotationGenerationEntryStatus,
    showToast: deps.showToast,
    showError: deps.showError
  });

  return {
    importRuntime: importRuntime,
    visualVocabApi: visualVocabApi,
    controlsRuntime: controlsRuntime,
    chunkControlsApi: chunkControlsApi,
    interactionRuntime: interactionRuntime,
    playbackRuntimeHelpersApi: playbackRuntimeHelpersApi,
    forceUpdateUI: forceUpdateUI,
    appRuntime: appRuntime
  };
}
