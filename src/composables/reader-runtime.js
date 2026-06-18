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
    import { configureTranscriptInteractions } from './transcript-interactions.js';
    import { configureChunkInteractions } from './chunk-interactions.js';
    import { configureRenderRuntime } from './render-runtime.js';
    import { initAnnotationBubbleResolver } from './annotation-bubble-resolver.js';
    import { configureSessionStateProvider } from './session-state-provider.js';
    import { collectReaderDomRefs } from './reader-dom-refs.js';
    import { initChunkControls } from './chunk-controls-module.js';
    import { initHighlightControls } from './highlight-controls-module.js';
    import { initThemeControls } from './theme-controls-module.js';
    import { initChunkNoteTransfer } from './chunk-note-transfer-module.js';
    import { initVisualVocab } from './visual-vocab-module.js';
    import { initAudioIdentity } from './audio-identity-module.js';
    import { initHotkeyState } from './hotkey-state-module.js';
    import { initMarksState } from './marks-state-module.js';
    import { initPlaybackRuntimeHelpers } from './playback-runtime-helpers.js';
    import { configureRuntimeStateBindings } from './runtime-state-bindings.js';
    import { initPiniaBridge } from './pinia-bridge-module.js';
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
        isFiniteNum,
        normalizeLooseKey,
        getLooseProp,
        looksLikeSegmentArray,
        validateVisualData,
        validateChunkData,
        validateMarksArray
    } = window.DataUtils;
    const validateTranscriptData = (json) => window.DataUtils.validateTranscriptData(json, _tr.segments);
    const {
        validateClozeData,
        normalizeClozeAnswer,
        escapeHtml
    } = window.ClozeUtils;
    const {
        createInitialClozeAnswerState,
        buildClozeQuizViewModel
    } = window.ClozeViewModelHelpers;
    const {
        findChunkIndexByTime: findChunkIndexByTimeHelper,
        bsFindActive: bsFindActiveHelper,
        getCurrentSegmentIndex: getCurrentSegmentIndexHelper,
        getSegmentCheckpoints: getSegmentCheckpointsHelper
    } = window.PlaybackIndexHelpers;
    const {
        clamp: clampHelper,
        cleanText: cleanTextHelper,
        tokenizeText: tokenizeTextHelper,
        findExactMatchRange: findExactMatchRangeHelper,
        findExactMatch: findExactMatchHelper,
        adjustIndex: adjustIndexHelper,
        scoreMatchCandidate: scoreMatchCandidateHelper,
        normalizeChunkCandidateBounds: normalizeChunkCandidateBoundsHelper,
        buildChunkCandidateVariants: buildChunkCandidateVariantsHelper,
        buildChunkMatchWindow: buildChunkMatchWindowHelper,
        clampChunkMatchCandidate: clampChunkMatchCandidateHelper,
        buildChunkCandidateEndWindow: buildChunkCandidateEndWindowHelper,
        getChunkCandidateBoundaryWords: getChunkCandidateBoundaryWordsHelper,
        normalizeChunkMatchCandidate: normalizeChunkMatchCandidateHelper
    } = window.ChunkMatchingHelpers;
    const {
        buildVocabMatchMap: buildVocabMatchMapHelper
    } = window.VocabMatchingHelpers;

    // === Identity/storage key helpers (extracted to identity-and-storage-keys.js) ===
    var audioIdentityApi = initAudioIdentity({
        buildAudioKey: window.IdentityStorageKeys.buildAudioKey,
        buildCurrentAudioMetaState: window.ImportExportSharedHelpers.buildCurrentAudioMetaState,
        getCurrentAudioFilenameBase: window.ImportExportSharedHelpers.getCurrentAudioFilenameBase,
        getChunkNotesStorageKey: window.IdentityStorageKeys.getChunkNotesStorageKey,
        getChunkNoteDraftStorageKey: window.IdentityStorageKeys.getChunkNoteDraftStorageKey,
        getSentenceNotesStorageKey: window.IdentityStorageKeys.getSentenceNotesStorageKey,
        getLegacySentenceNotesStorageKey: window.IdentityStorageKeys.getLegacySentenceNotesStorageKey,
        buildCurrentSentenceDocId: window.IdentityStorageKeys.buildCurrentSentenceDocId,
        getSegments: function () { return _tr.segments; }
    });
    // [MIGRATED] chunk-note layout functions → src/composables/chunk-note-layout.js

    // [MIGRATED] chunk-notes + sentence-notes → src/composables/notes-module.js
    // State bridge (var _ns, _cnApi, _snApi) + API init happens in startup block

    function buildChunkNotesSnapshot() { return _cnApi.buildChunkNotesSnapshot(); }
    // === Chunk-note persistence lifecycle ===
    async function loadChunkNotesForCurrentAudio() { return _cnApi.loadChunkNotesForCurrentAudio(); }
    function saveChunkNotesNow() { return _cnApi.saveChunkNotesNow(); }
    function setChunkNoteVisible(next, persist) { return _cnApi.setChunkNoteVisible(next, persist); }
    function closeChunkNoteContextMenu() { return _cnApi.closeChunkNoteContextMenu(); }

    // === Sentence notebook persistence lifecycle ===
    async function loadSentenceNotesForCurrentAudio() { return _snApi.loadSentenceNotesForCurrentAudio(); }
    async function switchSentenceNotesDoc(transcriptSource) { return _snApi.switchSentenceNotesDoc(transcriptSource); }

    // === Import / export / restore shared helpers ===
    const getFirstFileFromEvent = window.ImportExportSharedHelpers.getFirstFileFromEvent;
    const markFileLoaded = window.ImportExportSharedHelpers.markFileLoaded;

    function applyCurrentAudioMeta(meta) {
        const nextAudioState = audioIdentityApi.applyCurrentAudioMeta(meta);
        if (_cnApi && typeof _cnApi.setChunkNoteDraftRestoreDone === 'function') {
            _cnApi.setChunkNoteDraftRestoreDone(nextAudioState.chunkNoteDraftRestoreDone);
        }
        return nextAudioState;
    }

    const isInputLikeTarget = window.__keyboardModule.isInputLikeTarget;

    function restoreReaderFocus() {
        const focusTarget = mainAppArea || document.body;
        if (document.activeElement && typeof document.activeElement.blur === 'function') {
            try { document.activeElement.blur(); } catch (err) {}
        }
        if (focusTarget && typeof focusTarget.focus === 'function') {
            try { focusTarget.focus({ preventScroll: true }); } catch (err) {}
        }
    }

    const readFileAsText = window.ImportExportSharedHelpers.readFileAsText;

    var chunkNoteTransferApi = null;

    function closeChunkNoteExportDialog() {
        if (chunkNoteTransferApi && typeof chunkNoteTransferApi.closeExportDialog === 'function') {
            return chunkNoteTransferApi.closeExportDialog();
        }
    }

    function getChunkNoteExportDialogEl() {
        return chunkNoteTransferApi && typeof chunkNoteTransferApi.getExportDialogEl === 'function'
            ? chunkNoteTransferApi.getExportDialogEl()
            : null;
    }

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

    // === Runtime state ===
    // Playback transient state is owned by src/composables/playback-state.js.

    var hotkeyStateApi = initHotkeyState();
    var marksStateApi = initMarksState();

    // === AI Chunk Mode State ===
    // Owned by src/composables/chunk-state.js + src/pinia-stores/chunk.js.
    // Sentence prev-tap state is part of playback transient state.
    // Cloze state is owned by src/composables/cloze-state.js + src/pinia-stores/cloze.js.
    // [MIGRATED] shared notes state → src/composables/notes-module.js
    var _ns = window.__notesModule.getNotesState();
    var bridgeToPinia = initPiniaBridge({
        transcriptState: _tr,
        chunkState: _ch,
        clozeState: _clz,
        getNotesState: function () { return _ns; }
    });
    var _cnApi = window.__notesModule.initChunkNotes({
        state: _ns,
        loadFromDB: loadFromDB,
        saveToDB: saveToDB,
        getChunkNotesStorageKey: audioIdentityApi.getChunkNotesStorageKey,
        getChunkNoteDraftStorageKey: audioIdentityApi.getChunkNoteDraftStorageKey,
        sanitizeChunkNoteFontSize: window.__chunkNoteLayout.sanitizeChunkNoteFontSize,
        getIsChunkMode: function () { return _ch.isChunkMode; },
        currentAudioKeyGetter: function () { return audioIdentityApi.currentAudioKey; },
        getHasAiChunkData: function () { return _ch.hasAiChunkData; },
        mainAppArea: mainAppArea,
        chunkNoteSvgLayer: chunkNoteSvgLayer,
        chunkNoteLayer: chunkNoteLayer,
        getChunkNoteMeasureFont: window.__chunkNoteLayout.getChunkNoteMeasureFont,
        measureChunkNoteTextBox: window.__chunkNoteLayout.measureChunkNoteTextBox,
        applyChunkNoteAutoSize: window.__chunkNoteLayout.applyChunkNoteAutoSize,
        buildChunkNoteLayout: window.__chunkNoteLayout.buildChunkNoteLayout,
        canChunkNoteTextFitMinReadable: window.__chunkNoteLayout.canChunkNoteTextFitMinReadable,
        makeSelectionNoteBaseId: window.__chunkNoteLayout.makeSelectionNoteBaseId,
        makeSelectionNoteId: window.__chunkNoteLayout.makeSelectionNoteId,
        findNearestChunkWord: window.__chunkNoteLayout.findNearestChunkWord,
        saveOpenChunkNotePopover: function () {
            if (_cnApi.getChunkNoteModalEl()) _cnApi.saveChunkNoteFromModal();
        },
        chunkNoteCtxMenuEl: chunkNoteCtxMenu
    });
    var _snApi = window.__notesModule.initSentenceNotes({
        state: _ns,
        loadFromDB: loadFromDB,
        saveToDB: saveToDB,
        getSentenceNotesStorageKey: audioIdentityApi.getSentenceNotesStorageKey,
        getLegacySentenceNotesStorageKey: audioIdentityApi.getLegacySentenceNotesStorageKey,
        buildCurrentSentenceDocId: audioIdentityApi.buildCurrentSentenceDocId,
        isPlainObjectRecord: isPlainObjectRecord,
        getIsChunkMode: function () { return _ch.isChunkMode; },
        getHasAiChunkData: function () { return _ch.hasAiChunkData; },
        notePreviewSidebar: notePreviewSidebar,
        notePreviewEmpty: notePreviewEmpty,
        notePreviewList: notePreviewList,
        toggleNotePreviewBtn: toggleNotePreviewBtn,
        notePreviewResizeHandle: notePreviewResizeHandle,
        notePreviewResizeHandleY: notePreviewResizeHandleY,
        initialNotePreviewVisible: true,
        initialNotePreviewWidth: 340,
        initialNotePreviewHeight: 640
    });

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

    var highlightControlsApi = initHighlightControls({
        transcriptState: _tr,
        chunkState: _ch,
        playbackState: _pb,
        highlightModeBtn: highlightModeBtn,
        audioPlayer: audioPlayer,
        getForceUpdateUI: function () { return forceUpdateUI; }
    });

    chunkControlsApi = initChunkControls({
        state: _ch,
        chunkFileInput: chunkFileInput,
        toggleChunkBtn: toggleChunkBtn,
        chunkCnHoldBtn: chunkCnHoldBtn,
        audioPlayer: audioPlayer,
        updateHighlightModeUI: highlightControlsApi.updateHighlightModeUI,
        closeChunkNoteContextMenu: closeChunkNoteContextMenu,
        closeChunkNotePopover: _cnApi.closeChunkNotePopover,
        renderChunkMode: renderChunkMode,
        renderTranscript: renderTranscript,
        clearChunkNoteConnectors: _cnApi.clearChunkNoteConnectors,
        getForceUpdateUI: function () { return forceUpdateUI; },
        bridgeToPinia: bridgeToPinia
    });

    // [MIGRATED] style editor → src/composables/style-editor.js
    window.__styleEditor.init({
        adjustChunkNoteArrowSizeByGap: _cnApi.adjustChunkNoteArrowSizeByGap,
        renderAllChunkNoteTags: _cnApi.renderAllChunkNoteTags,
        scheduleChunkNoteConnectorRedraw: _cnApi.scheduleChunkNoteConnectorRedraw,
        getIsChunkMode: function () { return _ch.isChunkMode; },
        closeChunkNotePopover: _cnApi.closeChunkNotePopover,
        updateShadowBtnText: chunkControlsApi.updateShadowBtnText
    });

    // [MIGRATED] session init → src/composables/session-init.js
    // [MIGRATED] theme control bindings → src/composables/theme-controls-module.js
    initThemeControls({
        themeStore: window.__themeStore,
        themeToggleBtn: themeToggleBtn,
        themeCustomBgInput: themeCustomBgInput,
        themeCustomTextInput: themeCustomTextInput,
        themeCustomSubInput: themeCustomSubInput,
        themeCustomBorderInput: themeCustomBorderInput,
        themeCustomButtonInput: themeCustomButtonInput,
        themeCustomResetBtn: themeCustomResetBtn,
        refreshAllChunkNoteVisuals: _cnApi.refreshAllChunkNoteVisuals,
        getLockChunkNoteDimensionsForTheme: function () { return window.__lockChunkNoteDimensionsForTheme; }
    });
    initAnnotationApiSettingsUi();

    // M4+M5 delegated → src/composables/import-module.js

    // === Main transcript/chunk rendering ===
    // [PHASE 9] Body replaced — Vue renders. Old logic preserved in git history.
    
    // 1. Normal Mode Render (gutted — Vue handles rendering)
    function renderTranscript() {
        bridgeToPinia();
    }

    // 2. AI Chunk Mode Render (gutted — Vue handles rendering)
    function renderChunkMode() {
        bridgeToPinia();
        const clozeMarkup = window.__buildClozeQuizMarkup ? window.__buildClozeQuizMarkup() : '';
        if (clozeMarkup) {
            transcriptContainer.insertAdjacentHTML('beforeend', clozeMarkup);
            transcriptContainer.querySelectorAll('[data-cloze-check]').forEach((btn) => {
                btn.addEventListener('click', () => window.__clozeCheck(Number(btn.dataset.clozeCheck)));
            });
            transcriptContainer.querySelectorAll('[data-cloze-input]').forEach((input) => {
                input.addEventListener('keydown', (event) => {
                    if (event.key === 'Enter') {
                        event.preventDefault();
                        window.__clozeCheck(Number(input.dataset.clozeInput));
                    }
                });
            });
        }
        _cnApi.tryRestoreChunkNoteDraft();
    }

    configureRenderRuntime({
        renderTranscript: renderTranscript,
        renderChunkMode: renderChunkMode
    });

    var annotationBubbleResolverApi = initAnnotationBubbleResolver({
        getWords: function () { return _tr.words; },
        markedMap: marksStateApi.markedMap,
        vocabMatchMap: visualVocabApi.vocabMatchMap
    });
    var notifyAnnotationBubbleWordClick = annotationBubbleResolverApi.notifyAnnotationBubbleWordClick;
    var playbackRuntimeHelpersApi = initPlaybackRuntimeHelpers({
        chunkState: _ch,
        transcriptState: _tr,
        playbackState: _pb,
        audioPlayer: audioPlayer,
        mainAppArea: mainAppArea,
        transcriptContainer: transcriptContainer,
        findChunkIndexByTimeHelper: findChunkIndexByTimeHelper,
        getCurrentSegmentIndexHelper: getCurrentSegmentIndexHelper,
        getForceUpdateUI: function () { return forceUpdateUI; },
        getWindow: function () { return window; }
    });

    // [MIGRATED] playback navigation → src/composables/playback-module.js
    window.__playbackModule.init({
        state: runtimeState,
        audioPlayer: audioPlayer,
        getCurrentSegmentIndexHelper: getCurrentSegmentIndexHelper,
        getSegmentCheckpointsHelper: getSegmentCheckpointsHelper,
        bsFindActiveHelper: bsFindActiveHelper,
        findChunkIndexByTime: playbackRuntimeHelpersApi.findChunkIndexByTime,
        swapActiveClass: playbackRuntimeHelpersApi.swapActiveClass,
        followPlaybackTarget: playbackRuntimeHelpersApi.followPlaybackTarget,
        getAnnotationBubble: annotationBubbleResolverApi.getAnnotationBubble,
        jumpPrevSentence: playbackRuntimeHelpersApi.jumpPrevSentence,
        jumpNextSentence: playbackRuntimeHelpersApi.jumpNextSentence
    });

    // Re-bind local references to functions now in playback-module
    var forceUpdateUI = window.forceUpdateUI;
    var mainUpdateHighlight = window.mainUpdateHighlight;
    var toggleAnnotationBubble = window.toggleAnnotationBubble;
    var handleBackwardClick = window.handleBackwardClick;
    var handleForwardClick = window.handleForwardClick;

    configureTranscriptInteractions({
        getAudioPlayer: function () { return audioPlayer; },
        forceUpdateUI: forceUpdateUI,
        notifyAnnotationBubbleWordClick: notifyAnnotationBubbleWordClick,
        isChunkMode: function () { return _ch.isChunkMode; },
        hasActiveTextSelectionWithinChunk: _snApi.hasActiveTextSelectionWithinChunk,
        selectSentenceFromChunkTarget: _snApi.selectSentenceFromChunkTarget,
        legacyTranscriptContainer: transcriptContainer
    });

    configureChunkInteractions({
        getAudioPlayer: function () { return audioPlayer; },
        getSelection: function () { return window.getSelection && window.getSelection(); },
        forceUpdateUI: forceUpdateUI,
        notifyAnnotationBubbleWordClick: notifyAnnotationBubbleWordClick,
        selectSentenceFromChunkTarget: _snApi.selectSentenceFromChunkTarget,
        openChunkNoteContextFromEvent: function (event) { return _cnApi.handleChunkSelectionContextMenu(event); }
    });

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
        closeChunkNoteContextMenu: typeof closeChunkNoteContextMenuRN !== 'undefined' ? closeChunkNoteContextMenuRN : closeChunkNoteContextMenu,
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

    // Functions called by keyboard-module (defined here to avoid circular deps)
    function toggleCurrentNote() {
        if (_ch.isChunkMode) return;
        var targetIdx = -1;
        if (_tr.currentWordIndex !== -1) {
            var w = _tr.words[_tr.currentWordIndex];
            if (w) targetIdx = w.segIndex;
        } else if (_pb.lastActiveSegIndex !== -1) {
            targetIdx = _pb.lastActiveSegIndex;
        }
        if (targetIdx !== -1) {
            var noteEl = document.getElementById('note-' + targetIdx);
            if (noteEl) noteEl.open = !noteEl.open;
        }
    }

    // Highlight colors + hotkey bindings → keyboard-module

    chunkNoteTransferApi = initChunkNoteTransfer({
        importButton: importChunkNotesBtn,
        importInput: importChunkNotesInput,
        exportButton: exportChunkNotesBtn,
        getFirstFileFromEvent: getFirstFileFromEvent,
        readFileAsText: readFileAsText,
        applyImportedChunkNotes: function (data) { return _cnApi.applyImportedChunkNotes(data); },
        saveChunkNotesNow: saveChunkNotesNow,
        getHasAiChunkData: function () { return _ch.hasAiChunkData; },
        getIsChunkMode: function () { return _ch.isChunkMode; },
        enterChunkMode: function () { return chunkControlsApi.toggleChunkMode(true); },
        setChunkNoteVisible: setChunkNoteVisible,
        renderChunkMode: renderChunkMode,
        buildChunkNotesSnapshot: buildChunkNotesSnapshot,
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
