    // === ES Module imports: utility modules that set window globals ===
    import '../utils/data-utils.js';
    import '../utils/identity-storage-keys.js';
    import '../utils/import-export-helpers.js';
    import '../utils/sentence-notes-persistence.js';
    import '../utils/cloze-utils.js';
    import '../utils/cloze-view-model.js';
    import '../utils/playback-index.js';
    import '../utils/chunk-matching.js';
    import '../utils/vocab-matching.js';
    import '../utils/chunk-note-layout-helpers.js';
    import '../utils/chunk-note-layout-core.js';
    import './transcript-state.js';
    import './chunk-state.js';
    import './cloze-state.js';
    import './playback-state.js';
    import { runtimeState } from './runtime-state-facade.js';
    import './render-mode.js';
    import './annotation-lightweight-module.js';
    import { initGlassEffects } from './glass-effects.js';
    import { configureRenderRuntime, renderTranscript, renderChunkMode } from './render-runtime.js';
    import { configureSessionStateProvider } from './session-state-provider.js';
    import { collectReaderDomRefs } from './reader-dom-refs.js';
    import { collectReaderRuntimeDeps } from './reader-runtime-deps.js';
    import { initReaderNotesRuntime } from './reader-notes-runtime.js';
    import { initReaderPlaybackRuntime } from './reader-playback-runtime.js';
    import { initReaderControlsRuntime } from './reader-controls-runtime.js';
    import { initChunkNoteTransfer } from './chunk-note-transfer-module.js';
    import { initVisualVocab } from './visual-vocab-module.js';
    import { initAudioIdentity } from './audio-identity-module.js';
    import { initHotkeyState } from './hotkey-state-module.js';
    import { initMarksState } from './marks-state-module.js';
    import {
        createReaderFocusRestorer,
        createCurrentNoteToggler,
        createChunkNoteTransferDialogAccess
    } from './reader-runtime-helpers.js';
    import { configureRuntimeStateBindings } from './runtime-state-bindings.js';
    import { configureReaderPublicFacades } from './reader-public-facades.js';
    import { showToast, showError } from './ui-facades.js';
    import {
        configureSessionFacades,
        clearGeneratedAnnotationIndex,
        clearPersistedChunkSession,
        getAnnotationGenerationScope,
        emitAnnotationDiagnostics,
        scheduleGeneratedAnnotationIndexRefresh,
        syncAnnotationGenerationEntryStatus,
        initAnnotationApiSettingsUi
    } from './session-facades.js';

    // === Read-order map ===
    // 1) Data layer: validation, identity, storage keys, persistence helpers
    // 2) UI layer: DOM bindings, runtime state, startup wiring
    // 3) Feature layer: import handlers, matching, rendering, interactions
    // 4) Input layer: keyboard/mouse/global listeners (kept behavior-intact)

    // [MIGRATED] DB schema constants → window.__audioStore

    // Phase 4: Vue rendering default lives in src/composables/render-mode.js.
    const _tr = window.__transcriptState;
    const _ch = window.__chunkState;
    const _clz = window.__clozeState;
    const _pb = window.__playbackState;
    // [MIGRATED] DB operations → window.__audioStore
    var saveToDB = function (id, data) { return window.__audioStore.saveToDB(id, data); };
    var loadFromDB = function (id) { return window.__audioStore.loadFromDB(id); };

    // === Validation/parsing utilities (extracted to data-utils.js) ===
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
        buildAudioKey,
        buildCurrentAudioMetaState,
        getCurrentAudioFilenameBase,
        getChunkNotesStorageKey,
        getChunkNoteDraftStorageKey,
        getSentenceNotesStorageKey,
        getLegacySentenceNotesStorageKey,
        buildCurrentSentenceDocId,
        getFirstFileFromEvent,
        markFileLoaded,
        readFileAsText
    } = collectReaderRuntimeDeps({
        transcriptState: _tr,
        getWindow: function () { return window; }
    });

    // === Identity/storage key helpers (extracted to identity-and-storage-keys.js) ===
    var audioIdentityApi = initAudioIdentity({
        buildAudioKey: buildAudioKey,
        buildCurrentAudioMetaState: buildCurrentAudioMetaState,
        getCurrentAudioFilenameBase: getCurrentAudioFilenameBase,
        getChunkNotesStorageKey: getChunkNotesStorageKey,
        getChunkNoteDraftStorageKey: getChunkNoteDraftStorageKey,
        getSentenceNotesStorageKey: getSentenceNotesStorageKey,
        getLegacySentenceNotesStorageKey: getLegacySentenceNotesStorageKey,
        buildCurrentSentenceDocId: buildCurrentSentenceDocId,
        getSegments: function () { return _tr.segments; }
    });
    // [MIGRATED] chunk-note layout functions → src/composables/chunk-note-layout.js

    // [MIGRATED] chunk-notes + sentence-notes → src/composables/notes-module.js
    // State bridge (var _ns, _cnApi, _snApi) + API init happens in startup block

    // === Chunk-note persistence lifecycle ===
    async function loadChunkNotesForCurrentAudio() { return _cnApi.loadChunkNotesForCurrentAudio(); }
    function setChunkNoteVisible(next, persist) { return _cnApi.setChunkNoteVisible(next, persist); }

    // === Sentence notebook persistence lifecycle ===
    async function loadSentenceNotesForCurrentAudio() { return _snApi.loadSentenceNotesForCurrentAudio(); }
    async function switchSentenceNotesDoc(transcriptSource) { return _snApi.switchSentenceNotesDoc(transcriptSource); }

    function applyCurrentAudioMeta(meta) {
        const nextAudioState = audioIdentityApi.applyCurrentAudioMeta(meta);
        if (_cnApi && typeof _cnApi.setChunkNoteDraftRestoreDone === 'function') {
            _cnApi.setChunkNoteDraftRestoreDone(nextAudioState.chunkNoteDraftRestoreDone);
        }
        return nextAudioState;
    }

    var chunkNoteTransferApi = null;

    // === UI layer entrypoint: DOM bindings ===
    const {
        audioPlayer, transcriptContainer, toggleFollowBtn, highlightModeBtn,
        themeControlsEl, themeToggleBtn, themeCustomPanel,
        themeCustomBgInput, themeCustomTextInput, themeCustomSubInput,
        themeCustomBorderInput, themeCustomButtonInput, themeCustomResetBtn,
        toggleChunkBtn, chunkCnHoldBtn,
        audioFileInput, transcriptFileInput, visualFileInput, chunkFileInput, clozeFileInput,
        lblAudio, lblTranscript, lblVisual,
        highlightColorInput, sentenceColorInput,
        hotkeyInput, hotkeyNotesInput, hotkeyAnnotationBubbleInput,
        hotkeyBackwardInput, hotkeyForwardInput, hotkeyChunkCnInput,
        hotkeyChunkShadowInput, hotkeyChunkNoteInput,
        importChunkNotesBtn, importChunkNotesInput, exportChunkNotesBtn,
        chunkNoteSvgLayer, chunkNoteLayer, chunkNoteProbe, chunkNoteCtxMenu,
        chunkNoteCtxAddBtn, mainAppArea,
        toggleNotePreviewBtn, notePreviewSidebar, notePreviewResizeHandle,
        notePreviewResizeHandleY, notePreviewEmpty, notePreviewList,
        importMarksBtn, importMarksInput, exportJsonBtn, exportMdAllBtn,
        exportAnnotationLightweightBtn, importAnnotationLightweightInput,
        importAnnotationLightweightBtn
    } = collectReaderDomRefs();
    const restoreReaderFocus = createReaderFocusRestorer({
        getDocument: function () { return document; },
        getFocusTarget: function () { return mainAppArea; }
    });
    const toggleCurrentNote = createCurrentNoteToggler({
        chunkState: _ch,
        transcriptState: _tr,
        playbackState: _pb,
        getDocument: function () { return document; }
    });
    const chunkNoteTransferDialogAccess = createChunkNoteTransferDialogAccess({
        getTransferApi: function () { return chunkNoteTransferApi; }
    });
    const closeChunkNoteExportDialog = chunkNoteTransferDialogAccess.closeChunkNoteExportDialog;
    const getChunkNoteExportDialogEl = chunkNoteTransferDialogAccess.getChunkNoteExportDialogEl;

    // === Runtime state ===
    // Playback transient state is owned by src/composables/playback-state.js.

    var hotkeyStateApi = initHotkeyState();
    var marksStateApi = initMarksState();

    // === AI Chunk Mode State ===
    // Owned by src/composables/chunk-state.js + src/pinia-stores/chunk.js.
    // Sentence prev-tap state is part of playback transient state.
    // Cloze state is owned by src/composables/cloze-state.js + src/pinia-stores/cloze.js.
    // [MIGRATED] shared notes state → src/composables/notes-module.js
    var notesRuntime = initReaderNotesRuntime({
        notesModule: window.__notesModule,
        chunkNoteLayout: window.__chunkNoteLayout,
        transcriptState: _tr,
        chunkState: _ch,
        clozeState: _clz,
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
    var _ns = notesRuntime.notesState;
    var bridgeToPinia = notesRuntime.bridgeToPinia;
    var _cnApi = notesRuntime.chunkNotesApi;
    var _snApi = notesRuntime.sentenceNotesApi;

    // === Import module delegation (M4+M5 extracted → src/composables/import-module.js) ===
    configureSessionFacades({
        getRuntimeState: function () { return runtimeState; }
    });
    configureSessionStateProvider(runtimeState);
    var visualVocabApi = initVisualVocab({
        visualFileInput: visualFileInput,
        validateVisualData: validateVisualData,
        buildVocabMatchMap: buildVocabMatchMapHelper,
        hasTranscriptData: function () { return _tr.segments.length > 0; },
        getWords: function () { return _tr.words; },
        saveToDB: saveToDB,
        getFirstFileFromEvent: getFirstFileFromEvent,
        readFileAsText: readFileAsText,
        markFileLoaded: markFileLoaded,
        lblVisual: lblVisual,
        showToast: showToast,
        showError: showError,
        restoreReaderFocus: restoreReaderFocus,
        bridgeToPinia: bridgeToPinia
    });
    configureRuntimeStateBindings({
        runtimeState: runtimeState,
        transcriptState: _tr,
        chunkState: _ch,
        clozeState: _clz,
        playbackState: _pb,
        audioIdentityApi: audioIdentityApi,
        hotkeyStateApi: hotkeyStateApi,
        marksStateApi: marksStateApi,
        visualVocabApi: visualVocabApi
    });

    var chunkControlsApi = null;
    var _cpApi = window.__importModule.initChunkPipeline({
        state: runtimeState,
        getIsChunkMode: function() { return _ch.isChunkMode; },
        renderChunkMode: renderChunkMode,
        bridgeToPinia: bridgeToPinia,
        toggleChunkBtn: toggleChunkBtn,
        enterChunkMode: function () { if (chunkControlsApi) chunkControlsApi.toggleChunkMode(true); },
        cleanTextHelper: cleanTextHelper,
        tokenizeTextHelper: tokenizeTextHelper,
        findExactMatchRangeHelper: findExactMatchRangeHelper
    });

    var _ihApi = window.__importModule.initImportHandlers({
        state: runtimeState,
        audioFileInput: audioFileInput,
        transcriptFileInput: transcriptFileInput,
        chunkFileInput: chunkFileInput,
        clozeFileInput: clozeFileInput,
        getFirstFileFromEvent: getFirstFileFromEvent,
        readFileAsText: readFileAsText,
        saveToDB: saveToDB,
        applyCurrentAudioMeta: applyCurrentAudioMeta,
        clearGeneratedAnnotationIndex: clearGeneratedAnnotationIndex,
        restoreReaderFocus: restoreReaderFocus,
        showToast: showToast,
        showError: showError,
        markFileLoaded: markFileLoaded,
        lblAudio: lblAudio,
        lblTranscript: lblTranscript,
        validateTranscriptData: validateTranscriptData,
        validateChunkData: validateChunkData,
        validateClozeData: validateClozeData,
        clearPersistedChunkSession: clearPersistedChunkSession,
        switchSentenceNotesDoc: switchSentenceNotesDoc,
        getAnnotationGenerationScope: getAnnotationGenerationScope,
        emitAnnotationDiagnostics: emitAnnotationDiagnostics,
        buildCurrentSentenceDocId: audioIdentityApi.buildCurrentSentenceDocId,
        scheduleGeneratedAnnotationIndexRefresh: scheduleGeneratedAnnotationIndexRefresh,
        renderTranscript: renderTranscript,
        renderChunkMode: renderChunkMode,
        forceUpdateUI: forceUpdateUI,
        syncAnnotationGenerationEntryStatus: syncAnnotationGenerationEntryStatus,
        bridgeToPinia: bridgeToPinia,
        rebuildVocabMatching: visualVocabApi.rebuildVocabMatching,
        closeChunkNoteExportDialog: closeChunkNoteExportDialog,
        loadChunkNotesForCurrentAudio: loadChunkNotesForCurrentAudio,
        clearChunkNotesFileState: function () { return _cnApi.clearChunkNotesFileState(); },
        processChunkData: _cpApi.processChunkData,
        audioPlayer: audioPlayer,
        transcriptContainer: transcriptContainer,
        _ns: _ns,
        markedMap: marksStateApi.markedMap
    });

    _cnApi.ensureChunkNoteOverlayLayers();

    var controlsRuntime = initReaderControlsRuntime({
        transcriptState: _tr,
        chunkState: _ch,
        playbackState: _pb,
        highlightModeBtn: highlightModeBtn,
        chunkFileInput: chunkFileInput,
        toggleChunkBtn: toggleChunkBtn,
        chunkCnHoldBtn: chunkCnHoldBtn,
        audioPlayer: audioPlayer,
        closeChunkNoteContextMenu: _cnApi.closeChunkNoteContextMenu,
        closeChunkNotePopover: _cnApi.closeChunkNotePopover,
        renderChunkMode: renderChunkMode,
        renderTranscript: renderTranscript,
        clearChunkNoteConnectors: _cnApi.clearChunkNoteConnectors,
        getForceUpdateUI: function () { return forceUpdateUI; },
        bridgeToPinia: bridgeToPinia,
        styleEditor: window.__styleEditor,
        adjustChunkNoteArrowSizeByGap: _cnApi.adjustChunkNoteArrowSizeByGap,
        renderAllChunkNoteTags: _cnApi.renderAllChunkNoteTags,
        scheduleChunkNoteConnectorRedraw: _cnApi.scheduleChunkNoteConnectorRedraw,
        themeStore: window.__themeStore,
        themeToggleBtn: themeToggleBtn,
        themeCustomBgInput: themeCustomBgInput,
        themeCustomTextInput: themeCustomTextInput,
        themeCustomSubInput: themeCustomSubInput,
        themeCustomBorderInput: themeCustomBorderInput,
        themeCustomButtonInput: themeCustomButtonInput,
        themeCustomResetBtn: themeCustomResetBtn,
        refreshAllChunkNoteVisuals: _cnApi.refreshAllChunkNoteVisuals,
        getLockChunkNoteDimensionsForTheme: function () { return window.__lockChunkNoteDimensionsForTheme; },
        initAnnotationApiSettingsUi: initAnnotationApiSettingsUi
    });
    chunkControlsApi = controlsRuntime.chunkControlsApi;

    // M4+M5 delegated → src/composables/import-module.js

    configureRenderRuntime({
        bridgeToPinia: bridgeToPinia,
        getTranscriptContainer: function () { return transcriptContainer; },
        getClozeMarkup: function () {
            return window.__buildClozeQuizMarkup ? window.__buildClozeQuizMarkup() : '';
        },
        checkCloze: function (index) {
            if (window.__clozeCheck) return window.__clozeCheck(index);
            return undefined;
        },
        tryRestoreChunkNoteDraft: _cnApi.tryRestoreChunkNoteDraft
    });

    var playbackRuntime = initReaderPlaybackRuntime({
        runtimeState: runtimeState,
        transcriptState: _tr,
        chunkState: _ch,
        playbackState: _pb,
        audioPlayer: audioPlayer,
        mainAppArea: mainAppArea,
        transcriptContainer: transcriptContainer,
        findChunkIndexByTimeHelper: findChunkIndexByTimeHelper,
        getCurrentSegmentIndexHelper: getCurrentSegmentIndexHelper,
        getSegmentCheckpointsHelper: getSegmentCheckpointsHelper,
        bsFindActiveHelper: bsFindActiveHelper,
        markedMap: marksStateApi.markedMap,
        vocabMatchMap: visualVocabApi.vocabMatchMap,
        hasActiveTextSelectionWithinChunk: _snApi.hasActiveTextSelectionWithinChunk,
        selectSentenceFromChunkTarget: _snApi.selectSentenceFromChunkTarget,
        openChunkNoteContextFromEvent: function (event) { return _cnApi.handleChunkSelectionContextMenu(event); },
        getSelection: function () { return window.getSelection && window.getSelection(); },
        playbackModule: window.__playbackModule,
        getWindow: function () { return window; }
    });
    var playbackRuntimeHelpersApi = playbackRuntime.playbackRuntimeHelpersApi;
    var forceUpdateUI = playbackRuntime.forceUpdateUI;
    var toggleAnnotationBubble = playbackRuntime.toggleAnnotationBubble;
    var handleBackwardClick = playbackRuntime.handleBackwardClick;
    var handleForwardClick = playbackRuntime.handleForwardClick;

    // [MIGRATED] keyboard + event handlers → src/composables/keyboard-module.js
    window.__keyboardModule.init({
        audioPlayer: audioPlayer,
        isChunkMode: function () { return _ch.isChunkMode; },
        chunkCnHoldMode: function () { return _ch.chunkCnHoldMode; },
        chunkNoteVisible: function () { return _ns.chunkNoteVisible; },
        markKey: hotkeyStateApi.markKey, notesKey: hotkeyStateApi.notesKey, annotationBubbleKey: hotkeyStateApi.annotationBubbleKey,
        chunkCnKey: hotkeyStateApi.chunkCnKey, chunkShadowKey: hotkeyStateApi.chunkShadowKey, chunkNoteKey: hotkeyStateApi.chunkNoteKey,
        backwardKey: hotkeyStateApi.backwardKey, forwardKey: hotkeyStateApi.forwardKey,
        getMarkKey: function () { return hotkeyStateApi.markKey; },
        getNotesKey: function () { return hotkeyStateApi.notesKey; },
        getAnnotationBubbleKey: function () { return hotkeyStateApi.annotationBubbleKey; },
        getChunkCnKey: function () { return hotkeyStateApi.chunkCnKey; },
        getChunkShadowKey: function () { return hotkeyStateApi.chunkShadowKey; },
        getChunkNoteKey: function () { return hotkeyStateApi.chunkNoteKey; },
        getBackwardKey: function () { return hotkeyStateApi.backwardKey; },
        getForwardKey: function () { return hotkeyStateApi.forwardKey; },
        toggleMarkCurrent: function () {
            window.__marksStore.toggleMark(marksStateApi.markedMap, _tr.currentWordIndex, _tr.words, saveToDB, syncAnnotationGenerationEntryStatus);
        },
        toggleCurrentNote: toggleCurrentNote,
        toggleAnnotationBubble: toggleAnnotationBubble,
        beginHoldChunkCn: chunkControlsApi.beginHoldChunkCn, endHoldChunkCn: chunkControlsApi.endHoldChunkCn,
        toggleChunkCn: chunkControlsApi.toggleChunkCn, toggleChunkShadow: chunkControlsApi.toggleChunkShadow,
        setChunkNoteVisible: setChunkNoteVisible,
        handleBackwardClick: handleBackwardClick, handleForwardClick: handleForwardClick,
        closeCustomThemePanel: function () { window.__themeStore.closeCustomThemePanel(); },
        cancelChunkNoteModal: _cnApi.cancelChunkNoteModal,
        closeChunkNoteContextMenu: typeof closeChunkNoteContextMenuRN !== 'undefined' ? closeChunkNoteContextMenuRN : _cnApi.closeChunkNoteContextMenu,
        closeChunkNoteDeleteDialog: _cnApi.closeChunkNoteDeleteDialog,
        closeChunkNoteExportDialog: closeChunkNoteExportDialog,
        setSelectedChunkNote: _cnApi.setSelectedChunkNote,
        openChunkNoteDeleteDialog: _cnApi.openChunkNoteDeleteDialog,
        getChunkNoteDeleteDialogEl: function () { return _cnApi.getChunkNoteDeleteDialogEl(); },
        selectedChunkNoteId: function () { return _cnApi.getSelectedChunkNoteId(); },
        handleChunkSelectionContextMenu: _cnApi.handleChunkSelectionContextMenu,
        chunkNoteCtxAddBtn: chunkNoteCtxAddBtn,
        pendingChunkSelectionCtx: function () { return _cnApi.getPendingChunkSelectionCtx(); },
        consumePendingChunkSelectionCtx: function () { return _cnApi.consumePendingChunkSelectionCtx(); },
        openChunkNotePopover: _cnApi.openChunkNotePopover,
        hotkeyInput: hotkeyInput, hotkeyNotesInput: hotkeyNotesInput,
        hotkeyAnnotationBubbleInput: hotkeyAnnotationBubbleInput,
        hotkeyBackwardInput: hotkeyBackwardInput, hotkeyForwardInput: hotkeyForwardInput,
        hotkeyChunkCnInput: hotkeyChunkCnInput, hotkeyChunkShadowInput: hotkeyChunkShadowInput,
        hotkeyChunkNoteInput: hotkeyChunkNoteInput,
        highlightColorInput: highlightColorInput, sentenceColorInput: sentenceColorInput,
        themeCustomPanel: themeCustomPanel, themeControlsEl: themeControlsEl,
        setMarkKey: hotkeyStateApi.setMarkKey,
        setNotesKey: hotkeyStateApi.setNotesKey,
        setAnnotationBubbleKey: hotkeyStateApi.setAnnotationBubbleKey,
        setChunkCnKey: hotkeyStateApi.setChunkCnKey,
        setChunkShadowKey: hotkeyStateApi.setChunkShadowKey,
        setChunkNoteKey: hotkeyStateApi.setChunkNoteKey,
        setBackwardKey: hotkeyStateApi.setBackwardKey,
        setForwardKey: hotkeyStateApi.setForwardKey,
        chunkNoteCtxMenu: chunkNoteCtxMenu,
        getChunkNoteExportDialogEl: getChunkNoteExportDialogEl,
        getChunkNoteModalEl: function () { return _cnApi.getChunkNoteModalEl(); },
        saveChunkNoteFromModal: _cnApi.saveChunkNoteFromModal
    });

    // Highlight colors + hotkey bindings → keyboard-module

    chunkNoteTransferApi = initChunkNoteTransfer({
        importButton: importChunkNotesBtn,
        importInput: importChunkNotesInput,
        exportButton: exportChunkNotesBtn,
        getFirstFileFromEvent: getFirstFileFromEvent,
        readFileAsText: readFileAsText,
        applyImportedChunkNotes: function (data) { return _cnApi.applyImportedChunkNotes(data); },
        saveChunkNotesNow: _cnApi.saveChunkNotesNow,
        getHasAiChunkData: function () { return _ch.hasAiChunkData; },
        getIsChunkMode: function () { return _ch.isChunkMode; },
        enterChunkMode: function () { return chunkControlsApi.toggleChunkMode(true); },
        setChunkNoteVisible: setChunkNoteVisible,
        renderChunkMode: renderChunkMode,
        buildChunkNotesSnapshot: _cnApi.buildChunkNotesSnapshot,
        getCurrentAudioFilenameBase: audioIdentityApi.getCurrentAudioFilenameBase,
        getChunkNotesFileState: function () { return _cnApi.getChunkNotesFileState(); },
        setChunkNotesFileState: function (fileState) { return _cnApi.setChunkNotesFileState(fileState); },
        getCurrentAudioKey: function () { return audioIdentityApi.currentAudioKey; },
        showToast: showToast,
        showError: showError
    });

    window.__annotationLightweightModule.initManualLightweightAnnotationControls({
        exportButton: exportAnnotationLightweightBtn,
        importButton: importAnnotationLightweightBtn,
        importInput: importAnnotationLightweightInput,
        getFirstFileFromEvent,
        refreshAfterImport: function () {
            if (_ch.isChunkMode) renderChunkMode(); else renderTranscript();
            forceUpdateUI(audioPlayer.currentTime);
        },
        showToast,
        showError
    });

    // [MIGRATED] exports → src/composables/app-handlers.js
    window.__appHandlers.initExports({
        exportJsonBtn: exportJsonBtn, exportMdAllBtn: exportMdAllBtn,
        markedMap: marksStateApi.markedMap, getSegments: function () { return _tr.segments; },
        showError: showError, showToast: showToast
    });

    window.__appHandlers.initMarksImport({
        importMarksBtn: importMarksBtn, importMarksInput: importMarksInput,
        getFirstFileFromEvent: getFirstFileFromEvent,
        readFileAsText: readFileAsText,
        validateMarksArray: validateMarksArray,
        getWords: function () { return _tr.words; }, markedMap: marksStateApi.markedMap,
        saveToDB: saveToDB,
        isChunkModeFn: function () { return _ch.isChunkMode; },
        renderTranscript: renderTranscript, renderChunkMode: renderChunkMode,
        forceUpdateUI: forceUpdateUI, audioPlayer: audioPlayer,
        syncAnnotationGenerationEntryStatus: syncAnnotationGenerationEntryStatus,
        showToast: showToast, showError: showError
    });

    // [MIGRATED] controls + rAF loop → src/composables/controls-module.js
    window.__controlsModule.init({
        state: runtimeState,
        audioPlayer: audioPlayer,
        bsFindActiveHelper: bsFindActiveHelper,
        findChunkIndexByTime: playbackRuntimeHelpersApi.findChunkIndexByTime,
        getCurrentSegmentIndexHelper: getCurrentSegmentIndexHelper,
        toggleFollowBtn: toggleFollowBtn,
        mainAppArea: mainAppArea
    });

    initGlassEffects({
        listChunkNotes: function () { return _cnApi.listChunkNotes(); },
        getChunkNoteTagById: _cnApi.getChunkNoteTagById,
        getChunkNoteContentBoxSize: _cnApi.getChunkNoteContentBoxSize
    });
  
    // === Temporary compatibility exports for cross-module access ===
    configureReaderPublicFacades({
        selectSentenceFromChunkTarget: _snApi.selectSentenceFromChunkTarget,
        buildCurrentSentenceDocId: audioIdentityApi.buildCurrentSentenceDocId,
        loadChunkNotesForCurrentAudio: loadChunkNotesForCurrentAudio,
        setChunkNoteVisible: setChunkNoteVisible,
        loadSentenceNotesForCurrentAudio: loadSentenceNotesForCurrentAudio,
        switchSentenceNotesDoc: switchSentenceNotesDoc,
        applyCurrentAudioMeta: applyCurrentAudioMeta,
        openChunkNoteContextFromEvent: function (event) { return _cnApi.handleChunkSelectionContextMenu(event); }
    });
