import { initReaderInteractionRuntime } from './reader-interaction-runtime.js';
import { initReaderControlsRuntime } from './reader-controls-runtime.js';
import { initReaderKeyboardRuntime } from './reader-keyboard-runtime.js';
import { initReaderAppRuntime } from './reader-app-runtime.js';
import { initReaderImportRuntime } from './reader-import-runtime.js';
import { createLifecycleScope } from '../services/runtime/lifecycle-scope.js';

export function initReaderFeatureRuntime(deps = {}) {
  var lifecycle = createLifecycleScope();
  function own(runtime) {
    if (runtime && typeof runtime.dispose === 'function') {
      lifecycle.add(function () { runtime.dispose(); });
    }
    return runtime;
  }
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
    renderTranscript: deps.renderTranscript,
    renderChunkMode: deps.renderChunkMode,
    forceUpdateUI: forceUpdateUI,
    bridgeToPinia: deps.bridgeToPinia,
    audioPlayer: deps.audioPlayer,
    transcriptContainer: deps.transcriptContainer,
    getChunkControlsApi: function () { return chunkControlsApi; },
    toggleChunkBtn: deps.toggleChunkBtn,
    cleanTextHelper: deps.cleanTextHelper,
    tokenizeTextHelper: deps.tokenizeTextHelper,
    findExactMatchRangeHelper: deps.findExactMatchRangeHelper,
    buildVocabMatchMap: deps.buildVocabMatchMap
  });
  own(importRuntime);
  var visualVocabApi = importRuntime.visualVocabApi;

  var controlsRuntime = initReaderControlsRuntime({
    transcriptState: deps.transcriptState,
    chunkState: deps.chunkState,
    playbackState: deps.playbackState,
    highlightModeBtn: deps.highlightModeBtn,
    toggleChunkBtn: deps.toggleChunkBtn,
    chunkCnHoldBtn: deps.chunkCnHoldBtn,
    audioPlayer: deps.audioPlayer,
    renderChunkMode: deps.renderChunkMode,
    renderTranscript: deps.renderTranscript,
    getForceUpdateUI: function () { return forceUpdateUI; },
    bridgeToPinia: deps.bridgeToPinia,
    styleEditor: globalObject.__styleEditor,
    themeStore: globalObject.__themeStore,
    themeToggleBtn: deps.themeToggleBtn,
    themeCustomBgInput: deps.themeCustomBgInput,
    themeCustomTextInput: deps.themeCustomTextInput,
    themeCustomSubInput: deps.themeCustomSubInput,
    themeCustomBorderInput: deps.themeCustomBorderInput,
    themeCustomButtonInput: deps.themeCustomButtonInput,
    themeCustomResetBtn: deps.themeCustomResetBtn
  });
  own(controlsRuntime);
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
    getSelection: function () { return globalObject.getSelection && globalObject.getSelection(); },
    playbackModule: globalObject.__playbackModule,
    getWindow: function () { return globalObject; },
    bridgeToPinia: deps.bridgeToPinia,
  });
  own(interactionRuntime);
  var playbackRuntimeHelpersApi = interactionRuntime.playbackRuntimeHelpersApi;
  forceUpdateUI = interactionRuntime.forceUpdateUI;
  var toggleAnnotationBubble = interactionRuntime.toggleAnnotationBubble;
  var handleBackwardClick = interactionRuntime.handleBackwardClick;
  var handleForwardClick = interactionRuntime.handleForwardClick;

  var keyboardRuntime = initReaderKeyboardRuntime({
    keyboardModule: globalObject.__keyboardModule,
    marksStore: globalObject.__marksStore,
    themeStore: globalObject.__themeStore,
    audioPlayer: deps.audioPlayer,
    transcriptState: deps.transcriptState,
    chunkState: deps.chunkState,
    hotkeyStateApi: deps.hotkeyStateApi,
    marksStateApi: deps.marksStateApi,
    chunkControlsApi: chunkControlsApi,
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
  own(keyboardRuntime);

  var appRuntime = initReaderAppRuntime({
    annotationLightweightModule: globalObject.__annotationLightweightModule,
    appHandlers: globalObject.__appHandlers,
    controlsModule: globalObject.__controlsModule,
    runtimeState: deps.runtimeState,
    transcriptState: deps.transcriptState,
    chunkState: deps.chunkState,
    marksStateApi: deps.marksStateApi,
    chunkControlsApi: chunkControlsApi,
    audioIdentityApi: deps.audioIdentityApi,
    playbackRuntimeHelpersApi: playbackRuntimeHelpersApi,
    audioPlayer: deps.audioPlayer,
    getFirstFileFromEvent: deps.getFirstFileFromEvent,
    readFileAsText: deps.readFileAsText,
    validateMarksArray: deps.validateMarksArray,
    saveToDB: deps.saveToDB,
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
    previewVocabularyBtn: deps.previewVocabularyBtn,
    togglePreviewVocabularyBtn: deps.togglePreviewVocabularyBtn,
    settleArticleVocabularyBtn: deps.settleArticleVocabularyBtn,
    exportJsonBtn: deps.exportJsonBtn,
    exportMdAllBtn: deps.exportMdAllBtn,
    importMarksBtn: deps.importMarksBtn,
    importMarksInput: deps.importMarksInput,
    syncAnnotationGenerationEntryStatus: deps.syncAnnotationGenerationEntryStatus,
    showToast: deps.showToast,
    showError: deps.showError
  });
  own(appRuntime);

  return {
    importRuntime: importRuntime,
    visualVocabApi: visualVocabApi,
    controlsRuntime: controlsRuntime,
    chunkControlsApi: chunkControlsApi,
    interactionRuntime: interactionRuntime,
    playbackRuntimeHelpersApi: playbackRuntimeHelpersApi,
    forceUpdateUI: forceUpdateUI,
    keyboardRuntime: keyboardRuntime,
    appRuntime: appRuntime,
    dispose: lifecycle.dispose
  };
}
