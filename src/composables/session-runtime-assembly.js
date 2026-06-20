import { renderTranscript, renderChunkMode } from './render-runtime.js';
import { getAnnotationApiSettingsUiApi } from './annotation-api-settings-ui.js';
import { getSessionState } from './session-state-provider.js';
import {
    emitAnnotationDiagnostics,
    getAnnotationApiConfigHelper,
    getAnnotationGeneratedResultStore,
    getAnnotationGenerationStorage,
    getAnnotationTargetSource
} from './session-annotation-services.js';
import {
    createSessionAnnotationGeneratedIndexRuntime
} from './session-annotation-generated-index.js';
import {
    buildAnnotationContextArticleText,
    cleanMarkedTextForAnnotationContext,
    getAnnotationTargetSentenceText,
    normalizeAnnotationSentenceValue,
    normalizeAnnotationTextValue,
    resolveAnnotationContextSentence,
    splitAnnotationContextSentenceSpans
} from './session-annotation-text.js';
import {
    createSessionAnnotationMarksRuntime,
    normalizeAnnotationMark as normalizeAnnotationMarkValue
} from './session-annotation-marks.js';
import {
    createSessionAnnotationContextRuntime
} from './session-annotation-context.js';
import {
    createSessionAnnotationLightweightIoRuntime
} from './session-annotation-lightweight-io.js';
import {
    createSessionStartupCleanupRuntime
} from './session-startup-cleanup.js';
import {
    createSessionAnnotationApiSettingsRuntime
} from './session-annotation-api-settings-runtime.js';
import {
    createSessionRestoreRuntime
} from './session-restore-runtime.js';
import {
    restoreSessionUiSettings
} from './session-ui-settings-restore.js';
import {
    startSessionRuntime
} from './session-startup-runtime.js';

export function initSessionRuntimeAssembly(env = {}) {
  const window = typeof env.getWindow === 'function' ? env.getWindow() : globalThis;
  const document = typeof env.getDocument === 'function' ? env.getDocument() : window.document;
  const localStorageApi = window.localStorage;
  const urlApi = window.URL || globalThis.URL;
  const BlobCtor = window.Blob || globalThis.Blob;
  const audioPlayerEl = window.audioPlayer || document.getElementById('audio-player');
  const transcriptContainerEl = window.transcriptContainer || document.getElementById('transcript-container');
  const lblAudioEl = window.lblAudio || document.getElementById('lbl-audio');
  const lblTranscriptEl = window.lblTranscript || document.getElementById('lbl-transcript');
  const lblNotesEl = window.lblNotes || document.getElementById('lbl-notes');
  const lblVisualEl = window.lblVisual || document.getElementById('lbl-visual');
  const hotkeyInputEl = window.hotkeyInput || document.getElementById('hotkey-input');
  const hotkeyNotesInputEl = window.hotkeyNotesInput || document.getElementById('hotkey-notes-input');
  const hotkeyAnnotationBubbleInputEl = window.hotkeyAnnotationBubbleInput || document.getElementById('hotkey-annotation-bubble-input');
  const hotkeyChunkCnInputEl = window.hotkeyChunkCnInput || document.getElementById('hotkey-chunk-cn-input');
  const hotkeyChunkShadowInputEl = window.hotkeyChunkShadowInput || document.getElementById('hotkey-chunk-shadow-input');
  const hotkeyChunkNoteInputEl = window.hotkeyChunkNoteInput || document.getElementById('hotkey-chunk-note-input');
  const hotkeyBackwardInputEl = window.hotkeyBackwardInput || document.getElementById('hotkey-backward-input');
  const hotkeyForwardInputEl = window.hotkeyForwardInput || document.getElementById('hotkey-forward-input');
  const highlightColorInputEl = window.highlightColorInput || document.getElementById('highlight-color-input');
  const sentenceColorInputEl = window.sentenceColorInput || document.getElementById('sentence-color-input');
  const saveToDBFn = window.saveToDB;
  const loadFromDBFn = window.loadFromDB;
  const deleteFromDBFn = window.deleteFromDB;
  const initDBFn = window.initDB;
  const markFileLoadedFn = window.markFileLoaded;
  const applyCurrentAudioMetaFn = window.applyCurrentAudioMeta;
  const loadChunkNotesForCurrentAudioFn = window.loadChunkNotesForCurrentAudio;
  const loadSentenceNotesForCurrentAudioFn = window.loadSentenceNotesForCurrentAudio;
  const buildCurrentSentenceDocIdFn = window.buildCurrentSentenceDocId;
  const switchSentenceNotesDocFn = window.switchSentenceNotesDoc;
  const processNotesFn = window.processNotes;
  const processVisualFn = window.processVisual;
  const processChunkDataFn = window.processChunkData;
  const processTranscriptFn = window.processTranscript;
  const bridgeToPiniaFn = window.bridgeToPinia;
  const forceUpdateUIFn = window.forceUpdateUI;
  const showToastFn = window.showToast;
  const adjustChunkNoteArrowSizeByGapFn = window.adjustChunkNoteArrowSizeByGap;
  const setChunkNoteVisibleFn = window.setChunkNoteVisible;
  const updateChunkCnHoldBtnFn = window.updateChunkCnHoldBtn;
    var st = getSessionState();
    var _ns = window._ns || {};
    var annotationApiSettingsBtn = document.getElementById('btn-annotation-api-settings');
    var annotationApiSettingsPanel = document.getElementById('annotation-api-settings-panel');
    const annotationGeneratedIndexRuntime = createSessionAnnotationGeneratedIndexRuntime({
        state: st,
        namespace: _ns,
        getWindow: function () { return window; },
        consoleApi: console,
        getAnnotationGenerationStorage,
        getAnnotationGeneratedResultStore,
        emitAnnotationDiagnostics
    });
    const clearGeneratedAnnotationIndex = annotationGeneratedIndexRuntime.clearGeneratedAnnotationIndex;
    const getAnnotationGenerationScope = annotationGeneratedIndexRuntime.getAnnotationGenerationScope;
    const refreshGeneratedAnnotationIndexForCurrentDocument = annotationGeneratedIndexRuntime.refreshGeneratedAnnotationIndexForCurrentDocument;
    const scheduleGeneratedAnnotationIndexRefresh = annotationGeneratedIndexRuntime.scheduleGeneratedAnnotationIndexRefresh;
    const syncAnnotationGenerationEntryStatus = annotationGeneratedIndexRuntime.syncAnnotationGenerationEntryStatus;
    const annotationContextRuntime = createSessionAnnotationContextRuntime({
        state: st,
        namespace: _ns,
        normalizeAnnotationMark: normalizeAnnotationMarkValue,
        normalizeAnnotationTextValue,
        getAnnotationTargetSource
    });
    const buildAnnotationGenerationDocumentContext = annotationContextRuntime.buildAnnotationGenerationDocumentContext;
    const buildAnnotationTargetCollection = annotationContextRuntime.buildAnnotationTargetCollection;
    const annotationMarksRuntime = createSessionAnnotationMarksRuntime({
        state: st,
        normalizeAnnotationTextValue,
        buildAnnotationGenerationDocumentContext,
        buildAnnotationTargetCollection,
        saveToDB: saveToDBFn,
        renderTranscript,
        renderChunkMode,
        forceUpdateUI: forceUpdateUIFn,
        getAudioCurrentTime: function () { return audioPlayerEl ? audioPlayerEl.currentTime : 0; },
        syncAnnotationGenerationEntryStatus
    });
    const buildSyntheticAnnotationTargetFromEncodedId = annotationMarksRuntime.buildSyntheticAnnotationTargetFromEncodedId;
    const normalizeAnnotationMark = annotationMarksRuntime.normalizeAnnotationMark;
    const rebuildMarksFromAnnotationItems = annotationMarksRuntime.rebuildMarksFromAnnotationItems;
    const annotationLightweightIoRuntime = createSessionAnnotationLightweightIoRuntime({
        state: st,
        windowObject: window,
        documentObject: document,
        urlApi,
        BlobCtor,
        normalizeAnnotationTextValue,
        normalizeAnnotationSentenceValue,
        getAnnotationTargetSentenceText,
        buildSyntheticAnnotationTargetFromEncodedId,
        buildAnnotationTargetCollection,
        buildAnnotationContextArticleText,
        splitAnnotationContextSentenceSpans,
        resolveAnnotationContextSentence,
        cleanMarkedTextForAnnotationContext,
        getAnnotationGenerationStorage,
        getAnnotationGenerationScope,
        refreshGeneratedAnnotationIndexForCurrentDocument,
        rebuildMarksFromAnnotationItems,
        syncAnnotationGenerationEntryStatus,
        showToast: showToastFn
    });
    annotationLightweightIoRuntime.installAnnotationContextExport();
    const exportManualLightweightAnnotations = annotationLightweightIoRuntime.exportManualLightweightAnnotations;
    const importManualLightweightAnnotations = annotationLightweightIoRuntime.importManualLightweightAnnotations;
    const startupCleanupRuntime = createSessionStartupCleanupRuntime({
        state: st,
        namespace: _ns,
        localStorageApi,
        documentObject: document,
        deleteFromDB: deleteFromDBFn,
        emitAnnotationDiagnostics,
        getAnnotationGenerationScope
    });
    const clearPersistedChunkSession = startupCleanupRuntime.clearPersistedChunkSession;
    const clearPersistedReaderContentOnStartup = startupCleanupRuntime.clearPersistedReaderContentOnStartup;
    const annotationApiSettingsRuntime = createSessionAnnotationApiSettingsRuntime({
        buttonEl: annotationApiSettingsBtn,
        panelEl: annotationApiSettingsPanel,
        getAnnotationApiConfigHelper,
        getAnnotationApiSettingsUiApi,
        syncAnnotationGenerationEntryStatus
    });
    const initAnnotationApiSettingsUi = annotationApiSettingsRuntime.initAnnotationApiSettingsUi;
    const sessionRestoreRuntime = createSessionRestoreRuntime({
        state: st,
        namespace: _ns,
        urlApi,
        audioPlayer: audioPlayerEl,
        lblAudio: lblAudioEl,
        lblTranscript: lblTranscriptEl,
        lblNotes: lblNotesEl,
        lblVisual: lblVisualEl,
        loadFromDB: loadFromDBFn,
        markFileLoaded: markFileLoadedFn,
        applyCurrentAudioMeta: applyCurrentAudioMetaFn,
        loadChunkNotesForCurrentAudio: loadChunkNotesForCurrentAudioFn,
        loadSentenceNotesForCurrentAudio: loadSentenceNotesForCurrentAudioFn,
        processTranscript: processTranscriptFn,
        buildCurrentSentenceDocId: buildCurrentSentenceDocIdFn,
        switchSentenceNotesDoc: switchSentenceNotesDocFn,
        scheduleGeneratedAnnotationIndexRefresh,
        processNotes: processNotesFn,
        processVisual: processVisualFn,
        processChunkData: processChunkDataFn,
        normalizeAnnotationMark,
        renderTranscript,
        syncAnnotationGenerationEntryStatus,
        bridgeToPinia: bridgeToPiniaFn,
        getAnnotationGeneratedResultStore,
        getAnnotationGenerationScope,
        emitAnnotationDiagnostics
    });
    const restoreSession = sessionRestoreRuntime.restoreSession;

      startSessionRuntime({
        state: st,
        namespace: _ns,
        localStorageApi,
        documentObject: document,
        windowObject: window,
        transcriptContainer: transcriptContainerEl,
        initDB: initDBFn,
        clearPersistedReaderContentOnStartup,
        adjustChunkNoteArrowSizeByGap: adjustChunkNoteArrowSizeByGapFn,
        setChunkNoteVisible: setChunkNoteVisibleFn,
        updateChunkCnHoldBtn: updateChunkCnHoldBtnFn,
        restoreSession
      });

      restoreSessionUiSettings({
        state: st,
        localStorageApi,
        documentObject: document,
        windowObject: window,
        hotkeyInput: hotkeyInputEl,
        hotkeyNotesInput: hotkeyNotesInputEl,
        hotkeyAnnotationBubbleInput: hotkeyAnnotationBubbleInputEl,
        hotkeyChunkCnInput: hotkeyChunkCnInputEl,
        hotkeyChunkShadowInput: hotkeyChunkShadowInputEl,
        hotkeyChunkNoteInput: hotkeyChunkNoteInputEl,
        hotkeyBackwardInput: hotkeyBackwardInputEl,
        hotkeyForwardInput: hotkeyForwardInputEl,
        highlightColorInput: highlightColorInputEl,
        sentenceColorInput: sentenceColorInputEl
      });


      // Exports for app.js cross-references
      window.__session_clearGeneratedAnnotationIndex = clearGeneratedAnnotationIndex;
      window.__session_clearPersistedChunkSession = clearPersistedChunkSession;
      window.__session_getAnnotationGenerationScope = getAnnotationGenerationScope;
      window.__session_emitAnnotationDiagnostics = emitAnnotationDiagnostics;
      window.__session_scheduleGeneratedAnnotationIndexRefresh = scheduleGeneratedAnnotationIndexRefresh;
      window.__session_syncAnnotationGenerationEntryStatus = syncAnnotationGenerationEntryStatus;
      window.__session_exportManualLightweightAnnotations = exportManualLightweightAnnotations;
      window.__session_importManualLightweightAnnotations = importManualLightweightAnnotations;
      window.__session_initAnnotationApiSettingsUi = initAnnotationApiSettingsUi;
      initAnnotationApiSettingsUi();
}
