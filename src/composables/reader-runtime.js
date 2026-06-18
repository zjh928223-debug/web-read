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
    import { initReaderRuntimeContext } from './reader-runtime-context.js';
    import { initReaderNotesSessionRuntime } from './reader-notes-session-runtime.js';
    import { initReaderFeatureRuntime } from './reader-feature-runtime.js';
    import { showToast, showError } from './ui-facades.js';
    import { syncAnnotationGenerationEntryStatus, initAnnotationApiSettingsUi } from './session-facades.js';

    // === Read-order map ===
    // 1) Data layer: validation, identity, storage keys, persistence helpers
    // 2) UI layer: DOM bindings, runtime state, startup wiring
    // 3) Feature layer: import handlers, matching, rendering, interactions
    // 4) Input layer: keyboard/mouse/global listeners (kept behavior-intact)

    // [MIGRATED] DB schema constants → window.__audioStore

    // Phase 4: Vue rendering default lives in src/composables/render-mode.js.
    var runtimeContext = initReaderRuntimeContext({
        getWindow: function () { return window; },
        getDocument: function () { return document; }
    });
    var bootstrapRuntime = runtimeContext.bootstrapRuntime;
    const _tr = bootstrapRuntime.transcriptState;
    const _ch = bootstrapRuntime.chunkState;
    const _clz = bootstrapRuntime.clozeState;
    const _pb = bootstrapRuntime.playbackState;
    var saveToDB = bootstrapRuntime.saveToDB;
    var loadFromDB = bootstrapRuntime.loadFromDB;

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
        getFirstFileFromEvent,
        markFileLoaded,
        readFileAsText
    } = bootstrapRuntime.runtimeDeps;

    // === Identity/storage key helpers (extracted to identity-and-storage-keys.js) ===
    var audioIdentityApi = bootstrapRuntime.audioIdentityApi;
    // [MIGRATED] chunk-note layout functions → src/composables/chunk-note-layout.js

    // [MIGRATED] chunk-notes + sentence-notes → src/composables/notes-module.js

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
    } = runtimeContext.domRefs;
    const restoreReaderFocus = runtimeContext.restoreReaderFocus;
    const toggleCurrentNote = runtimeContext.toggleCurrentNote;
    const closeChunkNoteExportDialog = runtimeContext.closeChunkNoteExportDialog;
    const getChunkNoteExportDialogEl = runtimeContext.getChunkNoteExportDialogEl;

    // === Runtime state ===
    // Playback transient state is owned by src/composables/playback-state.js.

    var hotkeyStateApi = bootstrapRuntime.hotkeyStateApi;
    var marksStateApi = bootstrapRuntime.marksStateApi;

    // === AI Chunk Mode State ===
    // Owned by src/composables/chunk-state.js + src/pinia-stores/chunk.js.
    // Sentence prev-tap state is part of playback transient state.
    // Cloze state is owned by src/composables/cloze-state.js + src/pinia-stores/cloze.js.
    // [MIGRATED] shared notes state → src/composables/notes-module.js
    var notesSessionRuntime = initReaderNotesSessionRuntime({
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
    var _ns = notesSessionRuntime.notesState;
    var bridgeToPinia = notesSessionRuntime.bridgeToPinia;
    var _cnApi = notesSessionRuntime.chunkNotesApi;
    var _snApi = notesSessionRuntime.sentenceNotesApi;
    var loadChunkNotesForCurrentAudio = notesSessionRuntime.loadChunkNotesForCurrentAudio;
    var setChunkNoteVisible = notesSessionRuntime.setChunkNoteVisible;
    var loadSentenceNotesForCurrentAudio = notesSessionRuntime.loadSentenceNotesForCurrentAudio;
    var switchSentenceNotesDoc = notesSessionRuntime.switchSentenceNotesDoc;
    var applyCurrentAudioMeta = notesSessionRuntime.applyCurrentAudioMeta;

    initReaderFeatureRuntime({
        globalObject: window,
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
        validateMarksArray: validateMarksArray,
        switchSentenceNotesDoc: switchSentenceNotesDoc,
        renderTranscript: renderTranscript,
        renderChunkMode: renderChunkMode,
        bridgeToPinia: bridgeToPinia,
        closeChunkNoteExportDialog: closeChunkNoteExportDialog,
        getChunkNoteExportDialogEl: getChunkNoteExportDialogEl,
        loadChunkNotesForCurrentAudio: loadChunkNotesForCurrentAudio,
        loadSentenceNotesForCurrentAudio: loadSentenceNotesForCurrentAudio,
        chunkNotesApi: _cnApi,
        sentenceNotesApi: _snApi,
        notesState: _ns,
        toggleCurrentNote: toggleCurrentNote,
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
