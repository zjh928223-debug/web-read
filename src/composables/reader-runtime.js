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
    import { renderTranscript, renderChunkMode } from './render-runtime.js';
    import { collectReaderDomRefs } from './reader-dom-refs.js';
    import { collectReaderRuntimeDeps } from './reader-runtime-deps.js';
    import { initReaderNotesRuntime } from './reader-notes-runtime.js';
    import { initReaderSessionRuntime } from './reader-session-runtime.js';
    import { initReaderInteractionRuntime } from './reader-interaction-runtime.js';
    import { initReaderControlsRuntime } from './reader-controls-runtime.js';
    import { initReaderKeyboardRuntime } from './reader-keyboard-runtime.js';
    import { initReaderAppRuntime } from './reader-app-runtime.js';
    import { initReaderImportRuntime } from './reader-import-runtime.js';
    import { initAudioIdentity } from './audio-identity-module.js';
    import { initHotkeyState } from './hotkey-state-module.js';
    import { initMarksState } from './marks-state-module.js';
    import {
        createReaderFocusRestorer,
        createCurrentNoteToggler,
        createChunkNoteTransferDialogAccess
    } from './reader-runtime-helpers.js';
    import { showToast, showError } from './ui-facades.js';
    import { syncAnnotationGenerationEntryStatus, initAnnotationApiSettingsUi } from './session-facades.js';

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

    var sessionRuntime = initReaderSessionRuntime({
        chunkNotesApi: _cnApi,
        sentenceNotesApi: _snApi,
        audioIdentityApi: audioIdentityApi
    });
    var loadChunkNotesForCurrentAudio = sessionRuntime.loadChunkNotesForCurrentAudio;
    var setChunkNoteVisible = sessionRuntime.setChunkNoteVisible;
    var loadSentenceNotesForCurrentAudio = sessionRuntime.loadSentenceNotesForCurrentAudio;
    var switchSentenceNotesDoc = sessionRuntime.switchSentenceNotesDoc;
    var applyCurrentAudioMeta = sessionRuntime.applyCurrentAudioMeta;

    var chunkControlsApi = null;
    var importRuntime = initReaderImportRuntime({
        importModule: window.__importModule,
        runtimeState: runtimeState,
        transcriptState: _tr,
        chunkState: _ch,
        clozeState: _clz,
        playbackState: _pb,
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
        restoreReaderFocus: restoreReaderFocus,
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
        switchSentenceNotesDoc: switchSentenceNotesDoc,
        renderTranscript: renderTranscript,
        renderChunkMode: renderChunkMode,
        forceUpdateUI: forceUpdateUI,
        bridgeToPinia: bridgeToPinia,
        closeChunkNoteExportDialog: closeChunkNoteExportDialog,
        loadChunkNotesForCurrentAudio: loadChunkNotesForCurrentAudio,
        chunkNotesApi: _cnApi,
        audioPlayer: audioPlayer,
        transcriptContainer: transcriptContainer,
        notesState: _ns,
        getChunkControlsApi: function () { return chunkControlsApi; },
        toggleChunkBtn: toggleChunkBtn,
        cleanTextHelper: cleanTextHelper,
        tokenizeTextHelper: tokenizeTextHelper,
        findExactMatchRangeHelper: findExactMatchRangeHelper,
        buildVocabMatchMap: buildVocabMatchMapHelper
    });
    var visualVocabApi = importRuntime.visualVocabApi;

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

    var interactionRuntime = initReaderInteractionRuntime({
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
        getWindow: function () { return window; },
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
    var playbackRuntimeHelpersApi = interactionRuntime.playbackRuntimeHelpersApi;
    var forceUpdateUI = interactionRuntime.forceUpdateUI;
    var toggleAnnotationBubble = interactionRuntime.toggleAnnotationBubble;
    var handleBackwardClick = interactionRuntime.handleBackwardClick;
    var handleForwardClick = interactionRuntime.handleForwardClick;

    initReaderKeyboardRuntime({
        keyboardModule: window.__keyboardModule,
        marksStore: window.__marksStore,
        themeStore: window.__themeStore,
        audioPlayer: audioPlayer,
        transcriptState: _tr,
        chunkState: _ch,
        notesState: _ns,
        hotkeyStateApi: hotkeyStateApi,
        marksStateApi: marksStateApi,
        chunkControlsApi: chunkControlsApi,
        chunkNotesApi: _cnApi,
        saveToDB: saveToDB,
        syncAnnotationGenerationEntryStatus: syncAnnotationGenerationEntryStatus,
        toggleCurrentNote: toggleCurrentNote,
        toggleAnnotationBubble: toggleAnnotationBubble,
        setChunkNoteVisible: setChunkNoteVisible,
        handleBackwardClick: handleBackwardClick,
        handleForwardClick: handleForwardClick,
        closeChunkNoteContextMenu: _cnApi.closeChunkNoteContextMenu,
        closeChunkNoteExportDialog: closeChunkNoteExportDialog,
        getChunkNoteExportDialogEl: getChunkNoteExportDialogEl,
        chunkNoteCtxAddBtn: chunkNoteCtxAddBtn,
        hotkeyInput: hotkeyInput,
        hotkeyNotesInput: hotkeyNotesInput,
        hotkeyAnnotationBubbleInput: hotkeyAnnotationBubbleInput,
        hotkeyBackwardInput: hotkeyBackwardInput,
        hotkeyForwardInput: hotkeyForwardInput,
        hotkeyChunkCnInput: hotkeyChunkCnInput,
        hotkeyChunkShadowInput: hotkeyChunkShadowInput,
        hotkeyChunkNoteInput: hotkeyChunkNoteInput,
        highlightColorInput: highlightColorInput,
        sentenceColorInput: sentenceColorInput,
        themeCustomPanel: themeCustomPanel,
        themeControlsEl: themeControlsEl,
        chunkNoteCtxMenu: chunkNoteCtxMenu
    });

    // Remaining app/runtime setup is delegated to focused modules.
    var appRuntime = initReaderAppRuntime({
        annotationLightweightModule: window.__annotationLightweightModule,
        appHandlers: window.__appHandlers,
        controlsModule: window.__controlsModule,
        runtimeState: runtimeState,
        transcriptState: _tr,
        chunkState: _ch,
        marksStateApi: marksStateApi,
        chunkControlsApi: chunkControlsApi,
        chunkNotesApi: _cnApi,
        sentenceNotesApi: _snApi,
        audioIdentityApi: audioIdentityApi,
        playbackRuntimeHelpersApi: playbackRuntimeHelpersApi,
        audioPlayer: audioPlayer,
        getFirstFileFromEvent: getFirstFileFromEvent,
        readFileAsText: readFileAsText,
        validateMarksArray: validateMarksArray,
        saveToDB: saveToDB,
        setChunkNoteVisible: setChunkNoteVisible,
        loadChunkNotesForCurrentAudio: loadChunkNotesForCurrentAudio,
        loadSentenceNotesForCurrentAudio: loadSentenceNotesForCurrentAudio,
        switchSentenceNotesDoc: switchSentenceNotesDoc,
        applyCurrentAudioMeta: applyCurrentAudioMeta,
        renderTranscript: renderTranscript,
        renderChunkMode: renderChunkMode,
        forceUpdateUI: forceUpdateUI,
        bsFindActiveHelper: bsFindActiveHelper,
        getCurrentSegmentIndexHelper: getCurrentSegmentIndexHelper,
        toggleFollowBtn: toggleFollowBtn,
        mainAppArea: mainAppArea,
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
        syncAnnotationGenerationEntryStatus: syncAnnotationGenerationEntryStatus,
        showToast: showToast,
        showError: showError
    });
    chunkNoteTransferApi = appRuntime.chunkNoteTransferApi;
