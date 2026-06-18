import { runtimeState } from './runtime-state-facade.js';
import { renderTranscript, renderChunkMode } from './render-runtime.js';
import { initReaderRuntimeContext } from './reader-runtime-context.js';
import { initReaderNotesSessionRuntime } from './reader-notes-session-runtime.js';
import { initReaderFeatureRuntime } from './reader-feature-runtime.js';
import { showToast, showError } from './ui-facades.js';
import { syncAnnotationGenerationEntryStatus, initAnnotationApiSettingsUi } from './session-facades.js';

export function initReaderRuntimeShell(deps = {}) {
  var getWindow = typeof deps.getWindow === 'function' ? deps.getWindow : function () { return globalThis; };
  var getDocument = typeof deps.getDocument === 'function' ? deps.getDocument : function () {
    return getWindow().document;
  };
  var globalObject = getWindow();

  var runtimeContext = initReaderRuntimeContext({
    getWindow: getWindow,
    getDocument: getDocument
  });
  var bootstrapRuntime = runtimeContext.bootstrapRuntime;
  const transcriptState = bootstrapRuntime.transcriptState;
  const chunkState = bootstrapRuntime.chunkState;
  const clozeState = bootstrapRuntime.clozeState;
  const playbackState = bootstrapRuntime.playbackState;
  var saveToDB = bootstrapRuntime.saveToDB;
  var loadFromDB = bootstrapRuntime.loadFromDB;

  const {
    isPlainObjectRecord,
    validateVisualData,
    validateChunkData,
    validateMarksArray,
    validateTranscriptData,
    validateClozeData,
    findChunkIndexByTimeHelper,
    bsFindActiveHelper,
    getCurrentSegmentIndexHelper,
    getSegmentCheckpointsHelper,
    cleanTextHelper,
    tokenizeTextHelper,
    findExactMatchRangeHelper,
    buildVocabMatchMapHelper,
    getFirstFileFromEvent,
    markFileLoaded,
    readFileAsText
  } = bootstrapRuntime.runtimeDeps;

  var audioIdentityApi = bootstrapRuntime.audioIdentityApi;
  var hotkeyStateApi = bootstrapRuntime.hotkeyStateApi;
  var marksStateApi = bootstrapRuntime.marksStateApi;

  const {
    audioPlayer,
    transcriptContainer,
    toggleFollowBtn,
    highlightModeBtn,
    themeControlsEl,
    themeToggleBtn,
    themeCustomPanel,
    themeCustomBgInput,
    themeCustomTextInput,
    themeCustomSubInput,
    themeCustomBorderInput,
    themeCustomButtonInput,
    themeCustomResetBtn,
    toggleChunkBtn,
    chunkCnHoldBtn,
    audioFileInput,
    transcriptFileInput,
    visualFileInput,
    chunkFileInput,
    clozeFileInput,
    lblAudio,
    lblTranscript,
    lblVisual,
    highlightColorInput,
    sentenceColorInput,
    hotkeyInput,
    hotkeyNotesInput,
    hotkeyAnnotationBubbleInput,
    hotkeyBackwardInput,
    hotkeyForwardInput,
    hotkeyChunkCnInput,
    hotkeyChunkShadowInput,
    hotkeyChunkNoteInput,
    importChunkNotesBtn,
    importChunkNotesInput,
    exportChunkNotesBtn,
    chunkNoteSvgLayer,
    chunkNoteLayer,
    chunkNoteCtxMenu,
    chunkNoteCtxAddBtn,
    mainAppArea,
    toggleNotePreviewBtn,
    notePreviewSidebar,
    notePreviewResizeHandle,
    notePreviewResizeHandleY,
    notePreviewEmpty,
    notePreviewList,
    importMarksBtn,
    importMarksInput,
    exportJsonBtn,
    exportMdAllBtn,
    exportAnnotationLightweightBtn,
    importAnnotationLightweightInput,
    importAnnotationLightweightBtn
  } = runtimeContext.domRefs;

  var notesSessionRuntime = initReaderNotesSessionRuntime({
    notesModule: globalObject.__notesModule,
    chunkNoteLayout: globalObject.__chunkNoteLayout,
    transcriptState: transcriptState,
    chunkState: chunkState,
    clozeState: clozeState,
    loadFromDB: loadFromDB,
    saveToDB: saveToDB,
    audioIdentityApi: audioIdentityApi,
    isPlainObjectRecord: isPlainObjectRecord,
    mainAppArea: mainAppArea,
    chunkNoteSvgLayer: chunkNoteSvgLayer,
    chunkNoteLayer: chunkNoteLayer,
    chunkNoteCtxMenu: chunkNoteCtxMenu,
    notePreviewSidebar: notePreviewSidebar,
    notePreviewEmpty: notePreviewEmpty,
    notePreviewList: notePreviewList,
    toggleNotePreviewBtn: toggleNotePreviewBtn,
    notePreviewResizeHandle: notePreviewResizeHandle,
    notePreviewResizeHandleY: notePreviewResizeHandleY
  });

  var notesState = notesSessionRuntime.notesState;
  var bridgeToPinia = notesSessionRuntime.bridgeToPinia;
  var chunkNotesApi = notesSessionRuntime.chunkNotesApi;
  var sentenceNotesApi = notesSessionRuntime.sentenceNotesApi;
  var loadChunkNotesForCurrentAudio = notesSessionRuntime.loadChunkNotesForCurrentAudio;
  var setChunkNoteVisible = notesSessionRuntime.setChunkNoteVisible;
  var loadSentenceNotesForCurrentAudio = notesSessionRuntime.loadSentenceNotesForCurrentAudio;
  var switchSentenceNotesDoc = notesSessionRuntime.switchSentenceNotesDoc;
  var applyCurrentAudioMeta = notesSessionRuntime.applyCurrentAudioMeta;

  var featureRuntime = initReaderFeatureRuntime({
    globalObject: globalObject,
    runtimeState: runtimeState,
    transcriptState: transcriptState,
    chunkState: chunkState,
    clozeState: clozeState,
    playbackState: playbackState,
    audioIdentityApi: audioIdentityApi,
    hotkeyStateApi: hotkeyStateApi,
    marksStateApi: marksStateApi,
    audioFileInput: audioFileInput,
    transcriptFileInput: transcriptFileInput,
    chunkFileInput: chunkFileInput,
    clozeFileInput: clozeFileInput,
    visualFileInput: visualFileInput,
    getFirstFileFromEvent: getFirstFileFromEvent,
    readFileAsText: readFileAsText,
    saveToDB: saveToDB,
    applyCurrentAudioMeta: applyCurrentAudioMeta,
    restoreReaderFocus: runtimeContext.restoreReaderFocus,
    showToast: showToast,
    showError: showError,
    markFileLoaded: markFileLoaded,
    lblAudio: lblAudio,
    lblTranscript: lblTranscript,
    lblVisual: lblVisual,
    validateVisualData: validateVisualData,
    validateTranscriptData: validateTranscriptData,
    validateChunkData: validateChunkData,
    validateClozeData: validateClozeData,
    validateMarksArray: validateMarksArray,
    switchSentenceNotesDoc: switchSentenceNotesDoc,
    renderTranscript: renderTranscript,
    renderChunkMode: renderChunkMode,
    bridgeToPinia: bridgeToPinia,
    closeChunkNoteExportDialog: runtimeContext.closeChunkNoteExportDialog,
    getChunkNoteExportDialogEl: runtimeContext.getChunkNoteExportDialogEl,
    loadChunkNotesForCurrentAudio: loadChunkNotesForCurrentAudio,
    loadSentenceNotesForCurrentAudio: loadSentenceNotesForCurrentAudio,
    chunkNotesApi: chunkNotesApi,
    sentenceNotesApi: sentenceNotesApi,
    notesState: notesState,
    toggleCurrentNote: runtimeContext.toggleCurrentNote,
    syncAnnotationGenerationEntryStatus: syncAnnotationGenerationEntryStatus,
    initAnnotationApiSettingsUi: initAnnotationApiSettingsUi,
    findChunkIndexByTimeHelper: findChunkIndexByTimeHelper,
    bsFindActiveHelper: bsFindActiveHelper,
    getCurrentSegmentIndexHelper: getCurrentSegmentIndexHelper,
    getSegmentCheckpointsHelper: getSegmentCheckpointsHelper,
    cleanTextHelper: cleanTextHelper,
    tokenizeTextHelper: tokenizeTextHelper,
    findExactMatchRangeHelper: findExactMatchRangeHelper,
    buildVocabMatchMap: buildVocabMatchMapHelper,
    mainAppArea: mainAppArea,
    transcriptContainer: transcriptContainer,
    audioPlayer: audioPlayer,
    toggleChunkBtn: toggleChunkBtn,
    chunkCnHoldBtn: chunkCnHoldBtn,
    highlightModeBtn: highlightModeBtn,
    themeControlsEl: themeControlsEl,
    themeToggleBtn: themeToggleBtn,
    themeCustomPanel: themeCustomPanel,
    themeCustomBgInput: themeCustomBgInput,
    themeCustomTextInput: themeCustomTextInput,
    themeCustomSubInput: themeCustomSubInput,
    themeCustomBorderInput: themeCustomBorderInput,
    themeCustomButtonInput: themeCustomButtonInput,
    themeCustomResetBtn: themeCustomResetBtn,
    highlightColorInput: highlightColorInput,
    sentenceColorInput: sentenceColorInput,
    hotkeyInput: hotkeyInput,
    hotkeyNotesInput: hotkeyNotesInput,
    hotkeyAnnotationBubbleInput: hotkeyAnnotationBubbleInput,
    hotkeyBackwardInput: hotkeyBackwardInput,
    hotkeyForwardInput: hotkeyForwardInput,
    hotkeyChunkCnInput: hotkeyChunkCnInput,
    hotkeyChunkShadowInput: hotkeyChunkShadowInput,
    hotkeyChunkNoteInput: hotkeyChunkNoteInput,
    chunkNoteCtxAddBtn: chunkNoteCtxAddBtn,
    chunkNoteCtxMenu: chunkNoteCtxMenu,
    toggleFollowBtn: toggleFollowBtn,
    importChunkNotesBtn: importChunkNotesBtn,
    importChunkNotesInput: importChunkNotesInput,
    exportChunkNotesBtn: exportChunkNotesBtn,
    exportAnnotationLightweightBtn: exportAnnotationLightweightBtn,
    importAnnotationLightweightBtn: importAnnotationLightweightBtn,
    importAnnotationLightweightInput: importAnnotationLightweightInput,
    exportJsonBtn: exportJsonBtn,
    exportMdAllBtn: exportMdAllBtn,
    importMarksBtn: importMarksBtn,
    importMarksInput: importMarksInput,
    setChunkNoteTransferApi: runtimeContext.setChunkNoteTransferApi
  });

  return {
    runtimeContext: runtimeContext,
    bootstrapRuntime: bootstrapRuntime,
    notesSessionRuntime: notesSessionRuntime,
    featureRuntime: featureRuntime
  };
}
