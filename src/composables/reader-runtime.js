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
    import { initChunkControls } from './chunk-controls-module.js';
    import { initHighlightControls } from './highlight-controls-module.js';
    import { initThemeControls } from './theme-controls-module.js';
    import { initChunkNoteTransfer } from './chunk-note-transfer-module.js';
    import { initVisualVocab } from './visual-vocab-module.js';
    import { initAudioIdentity } from './audio-identity-module.js';
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
    const getChunkNotesStorageKey = audioIdentityApi.getChunkNotesStorageKey;
    const getChunkNoteDraftStorageKey = audioIdentityApi.getChunkNoteDraftStorageKey;
    const getSentenceNotesStorageKey = audioIdentityApi.getSentenceNotesStorageKey;
    const getLegacySentenceNotesStorageKey = audioIdentityApi.getLegacySentenceNotesStorageKey;
    const buildCurrentSentenceDocId = audioIdentityApi.buildCurrentSentenceDocId;

    // [MIGRATED] chunk-note layout functions → src/composables/chunk-note-layout.js
    const findNearestChunkWord = (enDiv, clientX, clientY) => window.__chunkNoteLayout.findNearestChunkWord(enDiv, clientX, clientY);
    const getChunkNoteMeasureFont = () => window.__chunkNoteLayout.getChunkNoteMeasureFont();
    const measureChunkNoteTextBox = (text, minW, minH, maxW) => window.__chunkNoteLayout.measureChunkNoteTextBox(text, minW, minH, maxW);
    const applyChunkNoteAutoSize = (note) => window.__chunkNoteLayout.applyChunkNoteAutoSize(note);
    const buildChunkNoteLayout = (note, width, height) => window.__chunkNoteLayout.buildChunkNoteLayout(note, width, height);
    const canChunkNoteTextFitMinReadable = (note, width, height) => window.__chunkNoteLayout.canChunkNoteTextFitMinReadable(note, width, height);
    const sanitizeChunkNoteFontSize = (rawSize) => window.__chunkNoteLayout.sanitizeChunkNoteFontSize(rawSize);
    const makeSelectionNoteBaseId = (chunkRef, startGlobal, endGlobal) => window.__chunkNoteLayout.makeSelectionNoteBaseId(chunkRef, startGlobal, endGlobal);
    const makeSelectionNoteId = (chunkRef, startGlobal, endGlobal) => window.__chunkNoteLayout.makeSelectionNoteId(chunkRef, startGlobal, endGlobal);

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
    const getCurrentAudioFilenameBase = audioIdentityApi.getCurrentAudioFilenameBase;
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

    function setSelectedChunkNote(noteId) {
        return _cnApi.setSelectedChunkNote(noteId);
    }

    function closeChunkNoteDeleteDialog() {
        return _cnApi.closeChunkNoteDeleteDialog();
    }

    function openChunkNoteDeleteDialog(noteId) {
        return _cnApi.openChunkNoteDeleteDialog(noteId);
    }

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

    function clearChunkNoteConnectors() {
        return _cnApi.clearChunkNoteConnectors();
    }

    function getChunkWordSpan(note) {
        return _cnApi.getChunkWordSpan(note);
    }

    function getChunkNoteTagById(noteId) {
        return _cnApi.getChunkNoteTagById(noteId);
    }

    function ensureChunkNoteOverlayLayers() {
        return _cnApi.ensureChunkNoteOverlayLayers();
    }

    function rectToMainAreaSpace(rect) {
        return _cnApi.rectToMainAreaSpace(rect);
    }

    function pointToMainAreaSpace(clientX, clientY) {
        return _cnApi.pointToMainAreaSpace(clientX, clientY);
    }

    function syncChunkNoteOverlaySize() {
        return _cnApi.syncChunkNoteOverlaySize();
    }

    function clearChunkNoteDraft() {
        return _cnApi.clearChunkNoteDraft();
    }

    function getRangeAnchorRectByGlobals(chunkRef, startGlobal, endGlobal) {
        return _cnApi.getRangeAnchorRectByGlobals(chunkRef, startGlobal, endGlobal);
    }

    function tryRestoreChunkNoteDraft() {
        return _cnApi.tryRestoreChunkNoteDraft();
    }

    function getChunkNoteLayoutBase() {
        return _cnApi.getChunkNoteLayoutBase();
    }

    function getChunkNoteContentBoxSize(tag) {
        return _cnApi.getChunkNoteContentBoxSize(tag);
    }

    function ensureChunkNoteLayout(note, sourceRect, tagRect = null) {
        return _cnApi.ensureChunkNoteLayout(note, sourceRect, tagRect);
    }

    function syncChunkNoteTagToAnchor(note, tag) {
        return _cnApi.syncChunkNoteTagToAnchor(note, tag);
    }

    function refreshChunkNoteTagPositions() {
        return _cnApi.refreshChunkNoteTagPositions();
    }

    function scheduleChunkNoteLayoutRefresh() {
        return _cnApi.scheduleChunkNoteLayoutRefresh();
    }

    function applyChunkNoteTextStyle(textEl, note, options = {}) {
        return _cnApi.applyChunkNoteTextStyle(textEl, note, options);
    }

    function renderChunkNoteImage(tag, note) {
        return _cnApi.renderChunkNoteImage(tag, note);
    }

    function updateChunkNoteTagCompactState(tag) {
        return _cnApi.updateChunkNoteTagCompactState(tag);
    }

    function makeChunkNoteTagDraggable(tag, note) {
        return _cnApi.makeChunkNoteTagDraggable(tag, note);
    }

    function makeChunkNoteTagResizable(tag, note) {
        return _cnApi.makeChunkNoteTagResizable(tag, note);
    }

    function enableChunkNoteInlineEdit(tag, note) {
        return _cnApi.enableChunkNoteInlineEdit(tag, note);
    }

    function spawnChunkNoteTag(note) {
        return _cnApi.spawnChunkNoteTag(note);
    }

    function renderAllChunkNoteTags() {
        return _cnApi.renderAllChunkNoteTags();
    }

    function drawChunkNoteConnector(note) {
        return _cnApi.drawChunkNoteConnector(note);
    }

    function redrawAllChunkNoteConnectors() {
        return _cnApi.redrawAllChunkNoteConnectors();
    }

    function scheduleChunkNoteConnectorRedraw() {
        return _cnApi.scheduleChunkNoteConnectorRedraw();
    }

    function closeChunkNotePopover() {
        return _cnApi.closeChunkNotePopover();
    }

    function saveChunkNoteFromModal() {
        return _cnApi.saveChunkNoteFromModal();
    }

    function cancelChunkNoteModal() {
        return _cnApi.cancelChunkNoteModal();
    }

    function openChunkNotePopover(ctx) {
        return _cnApi.openChunkNotePopover(ctx);
    }

    function upsertChunkNote(ctx, noteText) {
        return _cnApi.upsertChunkNoteFromModal(ctx, noteText);
    }

    function refreshChunkNoteForChunkRef(chunkRef) {
        return _cnApi.refreshChunkNoteForChunkRef(chunkRef);
    }

    // === UI layer entrypoint: DOM bindings ===
    const audioPlayer = document.getElementById('audio-player');
    const transcriptContainer = document.getElementById('transcript-container');
    const toggleFollowBtn = document.getElementById('toggle-follow');
    const highlightModeBtn = document.getElementById('highlight-mode-btn');
const themeControlsEl = document.getElementById('theme-controls');
const themeToggleBtn = document.getElementById('theme-toggle');
const themeCustomPanel = document.getElementById('theme-custom-panel');
    const themeCustomBgInput = document.getElementById('theme-custom-bg');
    const themeCustomTextInput = document.getElementById('theme-custom-text');
    const themeCustomSubInput = document.getElementById('theme-custom-sub');
    const themeCustomBorderInput = document.getElementById('theme-custom-border');
    const themeCustomButtonInput = document.getElementById('theme-custom-button');
    const themeCustomResetBtn = document.getElementById('theme-custom-reset');
    const toggleChunkBtn = document.getElementById('toggle-chunk-btn'); 
    const chunkCnHoldBtn = document.getElementById('btn-chunk-cn-hold');
    
    // Inputs & Labels
    const audioFileInput = document.getElementById('audio-file');
    const transcriptFileInput = document.getElementById('transcript-file');
    const visualFileInput = document.getElementById('visual-file');
    const chunkFileInput = document.getElementById('chunk-file'); 
    const clozeFileInput = document.getElementById('cloze-file');
    
    const lblAudio = document.getElementById('lbl-audio');
    const lblTranscript = document.getElementById('lbl-transcript');
    const lblVisual = document.getElementById('lbl-visual');

    const highlightColorInput = document.getElementById('highlight-color-input');
    const sentenceColorInput = document.getElementById('sentence-color-input');
    
    const hotkeyInput = document.getElementById('hotkey-input');
    const hotkeyNotesInput = document.getElementById('hotkey-notes-input');
    const hotkeyAnnotationBubbleInput = document.getElementById('hotkey-annotation-bubble-input');
    const hotkeyBackwardInput = document.getElementById('hotkey-backward-input');
    const hotkeyForwardInput = document.getElementById('hotkey-forward-input');
    const hotkeyChunkCnInput = document.getElementById('hotkey-chunk-cn-input'); 
    const hotkeyChunkShadowInput = document.getElementById('hotkey-chunk-shadow-input');
    const hotkeyChunkNoteInput = document.getElementById('hotkey-chunk-note-input');
    const importChunkNotesBtn = document.getElementById('btn-import-chunk-notes');
    const importChunkNotesInput = document.getElementById('import-chunk-notes-file');
    const exportChunkNotesBtn = document.getElementById('btn-export-chunk-notes');
    const importSentenceNotesBtn = document.getElementById('btn-import-sentence-notes');
    const importSentenceNotesInput = document.getElementById('import-sentence-notes-file');
    const exportSentenceNotesBtn = document.getElementById('btn-export-sentence-notes');
    const chunkNoteSvgLayer = document.getElementById('chunk-note-svg-layer');
    let chunkNoteLayer = document.getElementById('chunk-note-layer');
    const chunkNoteProbe = document.getElementById('chunk-note-probe');
    const chunkNoteCtxMenu = document.getElementById('chunk-note-ctx-menu');
    const chunkNoteCtxAddBtn = document.getElementById('chunk-note-ctx-add');
    const mainAppArea = document.getElementById('main-app-area');
    if (mainAppArea && !mainAppArea.hasAttribute('tabindex')) {
        mainAppArea.setAttribute('tabindex', '-1');
    }
    const toggleNotePreviewBtn = document.getElementById('toggle-note-preview-btn');
    const notePreviewSidebar = document.getElementById('note-preview-sidebar');
    const notePreviewResizeHandle = document.getElementById('note-preview-resize-handle');
    const notePreviewResizeHandleY = document.getElementById('note-preview-resize-handle-y');
    const notePreviewEmpty = document.getElementById('note-preview-empty');
    const notePreviewList = document.getElementById('note-preview-list');
    const importMarksBtn = document.getElementById('import-marks-btn');
    const importMarksInput = document.getElementById('import-marks-file');
    const exportJsonBtn = document.getElementById('export-json');
    const exportMdAllBtn = document.getElementById('export-md-all');
    const exportAnnotationLightweightBtn = document.getElementById('btn-export-annotation-lightweight');
    const importAnnotationLightweightInput = document.getElementById('import-annotation-lightweight-file');
    const importAnnotationLightweightBtn = document.getElementById('btn-import-annotation-lightweight');
    const annotationApiSettingsBtn = document.getElementById('btn-annotation-api-settings');
    const annotationApiSettingsPanel = document.getElementById('annotation-api-settings-panel');
    const modalBackdrop = document.getElementById('modal-backdrop');

    // === Runtime state ===
    // Playback transient state is owned by src/composables/playback-state.js.

    let markKey = 'm';
    let notesKey = 'n';
    let annotationBubbleKey = 'b';
    let chunkCnKey = 'c'; 
    let chunkShadowKey = 's'; 
    let chunkNoteKey = 'x';
    let backwardKey = 'ArrowLeft';
    let forwardKey = 'ArrowRight';
    const markedMap = new Map();

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
        getChunkNotesStorageKey: getChunkNotesStorageKey,
        getChunkNoteDraftStorageKey: getChunkNoteDraftStorageKey,
        sanitizeChunkNoteFontSize: window.__chunkNoteLayout.sanitizeChunkNoteFontSize,
        getIsChunkMode: function () { return _ch.isChunkMode; },
        currentAudioKeyGetter: function () { return audioIdentityApi.currentAudioKey; },
        getHasAiChunkData: function () { return _ch.hasAiChunkData; },
        mainAppArea: mainAppArea,
        chunkNoteSvgLayer: chunkNoteSvgLayer,
        chunkNoteLayer: chunkNoteLayer,
        getChunkNoteMeasureFont: getChunkNoteMeasureFont,
        measureChunkNoteTextBox: measureChunkNoteTextBox,
        applyChunkNoteAutoSize: applyChunkNoteAutoSize,
        buildChunkNoteLayout: buildChunkNoteLayout,
        canChunkNoteTextFitMinReadable: canChunkNoteTextFitMinReadable,
        makeSelectionNoteBaseId: makeSelectionNoteBaseId,
        makeSelectionNoteId: makeSelectionNoteId,
        findNearestChunkWord: findNearestChunkWord,
        saveOpenChunkNotePopover: function () {
            if (_cnApi.getChunkNoteModalEl()) saveChunkNoteFromModal();
        },
        chunkNoteCtxMenuEl: chunkNoteCtxMenu
    });
    var _snApi = window.__notesModule.initSentenceNotes({
        state: _ns,
        loadFromDB: loadFromDB,
        saveToDB: saveToDB,
        getSentenceNotesStorageKey: getSentenceNotesStorageKey,
        getLegacySentenceNotesStorageKey: getLegacySentenceNotesStorageKey,
        buildCurrentSentenceDocId: buildCurrentSentenceDocId,
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
    // chunkNoteModalEl: use independent storage to avoid let TDZ
    var __chunkNoteModalEl = null;
    Object.defineProperty(runtimeState, 'chunkNoteModalEl', { get: function() { return __chunkNoteModalEl; }, set: function(v) { __chunkNoteModalEl = v; }, enumerable: true, configurable: true });
    Object.defineProperty(runtimeState, 'segments', { get: function() { return _tr.segments; }, set: function(v) { _tr.segments = v; }, enumerable: true, configurable: true });
    Object.defineProperty(runtimeState, 'words', { get: function() { return _tr.words; }, set: function(v) { _tr.words = v; }, enumerable: true, configurable: true });
    Object.defineProperty(runtimeState, 'wordStarts', { get: function() { return _tr.wordStarts; }, set: function(v) { _tr.wordStarts = v; }, enumerable: true, configurable: true });
    Object.defineProperty(runtimeState, 'chunkItems', { get: function() { return _ch.chunkItems; }, set: function(v) { _ch.chunkItems = v; }, enumerable: true, configurable: true });
    Object.defineProperty(runtimeState, 'hasAiChunkData', { get: function() { return _ch.hasAiChunkData; }, set: function(v) { _ch.hasAiChunkData = v; }, enumerable: true, configurable: true });
    Object.defineProperty(runtimeState, 'hasClozeData', { get: function() { return _clz.hasClozeData; }, set: function(v) { _clz.hasClozeData = v; }, enumerable: true, configurable: true });
    Object.defineProperty(runtimeState, 'clozeItems', { get: function() { return _clz.clozeItems; }, set: function(v) { _clz.clozeItems = v; }, enumerable: true, configurable: true });
    Object.defineProperty(runtimeState, 'clozeAnswerState', { get: function() { return _clz.clozeAnswerState; }, set: function(v) { _clz.clozeAnswerState = v; }, enumerable: true, configurable: true });
    Object.defineProperty(runtimeState, 'manualChunkStates', { get: function() { return _ch.manualChunkStates; }, set: function(v) { _ch.manualChunkStates = v; }, enumerable: true, configurable: true });
    Object.defineProperty(runtimeState, 'currentAudioMeta', { get: function() { return audioIdentityApi.currentAudioMeta; }, set: function(v) { audioIdentityApi.setCurrentAudioMeta(v); }, enumerable: true, configurable: true });
    Object.defineProperty(runtimeState, 'isChunkMode', { get: function() { return _ch.isChunkMode; }, set: function(v) { _ch.isChunkMode = v; }, enumerable: true, configurable: true });
    Object.defineProperty(runtimeState, 'currentAudioKey', { get: function() { return audioIdentityApi.currentAudioKey; }, set: function(v) { audioIdentityApi.setCurrentAudioKey(v); }, enumerable: true, configurable: true });
    Object.defineProperty(runtimeState, 'currentWordIndex', { get: function() { return _tr.currentWordIndex; }, set: function(v) { _tr.currentWordIndex = v; }, enumerable: true, configurable: true });
    Object.defineProperty(runtimeState, 'autoFollow', { get: function() { return _pb.autoFollow; }, set: function(v) { _pb.autoFollow = v; }, enumerable: true, configurable: true });
    Object.defineProperty(runtimeState, 'userScrollSuppress', { get: function() { return _pb.userScrollSuppress; }, set: function(v) { _pb.userScrollSuppress = v; }, enumerable: true, configurable: true });
    Object.defineProperty(runtimeState, 'suppressTimer', { get: function() { return _pb.suppressTimer; }, set: function(v) { _pb.suppressTimer = v; }, enumerable: true, configurable: true });
    Object.defineProperty(runtimeState, 'highlightMode', { get: function() { return _tr.highlightMode; }, set: function(v) { _tr.highlightMode = v; }, enumerable: true, configurable: true });
    Object.defineProperty(runtimeState, 'lastActiveSegIndex', { get: function() { return _pb.lastActiveSegIndex; }, set: function(v) { _pb.lastActiveSegIndex = v; }, enumerable: true, configurable: true });
    Object.defineProperty(runtimeState, 'activeWordHighlightEl', { get: function() { return _pb.activeWordHighlightEl; }, set: function(v) { _pb.activeWordHighlightEl = v; }, enumerable: true, configurable: true });
    Object.defineProperty(runtimeState, 'activeSentenceEl', { get: function() { return _pb.activeSentenceEl; }, set: function(v) { _pb.activeSentenceEl = v; }, enumerable: true, configurable: true });
    Object.defineProperty(runtimeState, 'activeChunkEl', { get: function() { return _pb.activeChunkEl; }, set: function(v) { _pb.activeChunkEl = v; }, enumerable: true, configurable: true });
    Object.defineProperty(runtimeState, 'playbackUiSignature', { get: function() { return _pb.playbackUiSignature; }, set: function(v) { _pb.playbackUiSignature = v; }, enumerable: true, configurable: true });
    Object.defineProperty(runtimeState, 'markKey', { get: function() { return markKey; }, set: function(v) { markKey = v; }, enumerable: true, configurable: true });
    Object.defineProperty(runtimeState, 'notesKey', { get: function() { return notesKey; }, set: function(v) { notesKey = v; }, enumerable: true, configurable: true });
    Object.defineProperty(runtimeState, 'annotationBubbleKey', { get: function() { return annotationBubbleKey; }, set: function(v) { annotationBubbleKey = v; }, enumerable: true, configurable: true });
    Object.defineProperty(runtimeState, 'chunkCnKey', { get: function() { return chunkCnKey; }, set: function(v) { chunkCnKey = v; }, enumerable: true, configurable: true });
    Object.defineProperty(runtimeState, 'chunkShadowKey', { get: function() { return chunkShadowKey; }, set: function(v) { chunkShadowKey = v; }, enumerable: true, configurable: true });
    Object.defineProperty(runtimeState, 'chunkNoteKey', { get: function() { return chunkNoteKey; }, set: function(v) { chunkNoteKey = v; }, enumerable: true, configurable: true });
    Object.defineProperty(runtimeState, 'backwardKey', { get: function() { return backwardKey; }, set: function(v) { backwardKey = v; }, enumerable: true, configurable: true });
    Object.defineProperty(runtimeState, 'forwardKey', { get: function() { return forwardKey; }, set: function(v) { forwardKey = v; }, enumerable: true, configurable: true });
    Object.defineProperty(runtimeState, 'markedMap', { get: function() { return markedMap; }, set: function(v) { markedMap.clear(); if (v instanceof Map) v.forEach(function(value, key) { markedMap.set(key, value); }); }, enumerable: true, configurable: true });
    Object.defineProperty(runtimeState, 'globalVocab', { get: function() { return visualVocabApi.globalVocab; }, set: function(v) { visualVocabApi.setGlobalVocab(v); }, enumerable: true, configurable: true });
    Object.defineProperty(runtimeState, 'vocabMatchMap', { get: function() { return visualVocabApi.vocabMatchMap; }, set: function(v) { visualVocabApi.setVocabMatchMap(v); }, enumerable: true, configurable: true });
    Object.defineProperty(runtimeState, 'chunkCnVisible', { get: function() { return _ch.chunkCnVisible; }, set: function(v) { _ch.chunkCnVisible = v; }, enumerable: true, configurable: true });
    Object.defineProperty(runtimeState, 'chunkCnHoldMode', { get: function() { return _ch.chunkCnHoldMode; }, set: function(v) { _ch.chunkCnHoldMode = v; }, enumerable: true, configurable: true });
    Object.defineProperty(runtimeState, 'isChunkShadowOn', { get: function() { return _ch.isChunkShadowOn; }, set: function(v) { _ch.isChunkShadowOn = v; }, enumerable: true, configurable: true });
    Object.defineProperty(runtimeState, 'chunkCnMode', { get: function() { return _ch.chunkCnMode; }, set: function(v) { _ch.chunkCnMode = v; }, enumerable: true, configurable: true });
    Object.defineProperty(runtimeState, 'lastActiveChunkIndex', { get: function() { return _ch.lastActiveChunkIndex; }, set: function(v) { _ch.lastActiveChunkIndex = v; }, enumerable: true, configurable: true });
    Object.defineProperty(runtimeState, 'lastAiPrevTapChunkIndex', { get: function() { return _ch.lastAiPrevTapChunkIndex; }, set: function(v) { _ch.lastAiPrevTapChunkIndex = v; }, enumerable: true, configurable: true });
    Object.defineProperty(runtimeState, 'lastAiPrevTapAt', { get: function() { return _ch.lastAiPrevTapAt; }, set: function(v) { _ch.lastAiPrevTapAt = v; }, enumerable: true, configurable: true });
    Object.defineProperty(runtimeState, 'chunkPointerDown', { get: function() { return chunkPointerDown; }, set: function(v) { chunkPointerDown = v; }, enumerable: true, configurable: true });

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
        buildCurrentSentenceDocId: buildCurrentSentenceDocId,
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
        markedMap: markedMap
    });

    let chunkPointerDown = null;
    ensureChunkNoteOverlayLayers();

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
        closeChunkNotePopover: closeChunkNotePopover,
        renderChunkMode: renderChunkMode,
        renderTranscript: renderTranscript,
        clearChunkNoteConnectors: clearChunkNoteConnectors,
        getForceUpdateUI: function () { return forceUpdateUI; },
        bridgeToPinia: bridgeToPinia
    });

    // [MIGRATED] style editor → src/composables/style-editor.js
    window.__styleEditor.init({
        adjustChunkNoteArrowSizeByGap: _cnApi.adjustChunkNoteArrowSizeByGap,
        renderAllChunkNoteTags: renderAllChunkNoteTags,
        scheduleChunkNoteConnectorRedraw: scheduleChunkNoteConnectorRedraw,
        getIsChunkMode: function () { return _ch.isChunkMode; },
        closeChunkNotePopover: closeChunkNotePopover,
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
        refreshAllChunkNoteVisuals: refreshAllChunkNoteVisuals,
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
        tryRestoreChunkNoteDraft();
    }

    configureRenderRuntime({
        renderTranscript: renderTranscript,
        renderChunkMode: renderChunkMode
    });

    function getChunkNotesForRef(chunkRef) {
        return _cnApi.getChunkNotesForRef(chunkRef);
    }

    function getChunkBlocksMatchingRef(chunkRef) {
        return _cnApi.getChunkBlocksMatchingRef(chunkRef);
    }

    function getChunkNotesForBlock(block) {
        return _cnApi.getChunkNotesForBlock(block);
    }

    function refreshAllChunkNoteVisuals() {
        return _cnApi.refreshAllChunkNoteVisuals();
    }

    function handleChunkSelectionContextMenu(e) {
        return _cnApi.handleChunkSelectionContextMenu(e);
    }

    function openChunkNoteContextFromEvent(event) {
        return handleChunkSelectionContextMenu(event);
    }

    var annotationBubbleResolverApi = initAnnotationBubbleResolver({
        getWords: function () { return _tr.words; },
        markedMap: markedMap,
        vocabMatchMap: visualVocabApi.vocabMatchMap
    });
    var notifyAnnotationBubbleWordClick = annotationBubbleResolverApi.notifyAnnotationBubbleWordClick;

    function selectSentenceFromChunkTarget(target) {
        return _snApi.selectSentenceFromChunkTarget(target);
    }

    function hasActiveTextSelectionWithinChunk() {
        return _snApi.hasActiveTextSelectionWithinChunk();
    }

    function findChunkIndexByTime(t) {
        return findChunkIndexByTimeHelper(_ch.chunkItems, t);
    }

    function swapActiveClass(nextEl, prevEl, className) {
        if (prevEl && prevEl !== nextEl) prevEl.classList.remove(className);
        if (nextEl && nextEl !== prevEl) nextEl.classList.add(className);
        return nextEl || null;
    }

    function followPlaybackTarget(el) {
        if (!el || !_pb.autoFollow || _pb.userScrollSuppress) return;
        const container = mainAppArea || transcriptContainer;
        if (!container || typeof container.getBoundingClientRect !== 'function') {
            el.scrollIntoView({ behavior: 'auto', block: 'nearest' });
            return;
        }
        const containerRect = container.getBoundingClientRect();
        const elRect = el.getBoundingClientRect();
        const viewportHeight = Math.max(1, containerRect.height || container.clientHeight || window.innerHeight || 1);
        const topGuard = Math.max(24, Math.min(96, viewportHeight * 0.08));
        const bottomTrigger = Math.max(96, Math.min(220, viewportHeight * 0.18));
        const safeTop = containerRect.top + topGuard;
        const safeBottom = containerRect.bottom - bottomTrigger;
        const needsPageForward = elRect.bottom > safeBottom;
        const needsPageBack = elRect.top < safeTop;
        if (!needsPageForward && !needsPageBack) return;
        const offsetTop = elRect.top - containerRect.top + container.scrollTop;
        const targetTop = offsetTop - topGuard;
        container.scrollTo({ top: Math.max(0, targetTop), behavior: 'auto' });
    }

    // [MIGRATED] playback navigation → src/composables/playback-module.js
    window.__playbackModule.init({
        state: runtimeState,
        audioPlayer: audioPlayer,
        getCurrentSegmentIndexHelper: getCurrentSegmentIndexHelper,
        getSegmentCheckpointsHelper: getSegmentCheckpointsHelper,
        bsFindActiveHelper: bsFindActiveHelper,
        findChunkIndexByTime: findChunkIndexByTime,
        swapActiveClass: swapActiveClass,
        followPlaybackTarget: followPlaybackTarget,
        getAnnotationBubble: annotationBubbleResolverApi.getAnnotationBubble,
        jumpPrevSentence: jumpPrevSentence,
        jumpNextSentence: jumpNextSentence
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
        hasActiveTextSelectionWithinChunk: hasActiveTextSelectionWithinChunk,
        selectSentenceFromChunkTarget: selectSentenceFromChunkTarget,
        legacyTranscriptContainer: transcriptContainer
    });

    configureChunkInteractions({
        getAudioPlayer: function () { return audioPlayer; },
        getSelection: function () { return window.getSelection && window.getSelection(); },
        forceUpdateUI: forceUpdateUI,
        notifyAnnotationBubbleWordClick: notifyAnnotationBubbleWordClick,
        selectSentenceFromChunkTarget: selectSentenceFromChunkTarget,
        openChunkNoteContextFromEvent: openChunkNoteContextFromEvent
    });

    // [MIGRATED] keyboard + event handlers → src/composables/keyboard-module.js
    window.__keyboardModule.init({
        audioPlayer: audioPlayer,
        isChunkMode: function () { return _ch.isChunkMode; },
        chunkCnHoldMode: function () { return _ch.chunkCnHoldMode; },
        chunkNoteVisible: function () { return _ns.chunkNoteVisible; },
        markKey: markKey, notesKey: notesKey, annotationBubbleKey: annotationBubbleKey,
        chunkCnKey: chunkCnKey, chunkShadowKey: chunkShadowKey, chunkNoteKey: chunkNoteKey,
        backwardKey: backwardKey, forwardKey: forwardKey,
        toggleMarkCurrent: function () {
            window.__marksStore.toggleMark(markedMap, _tr.currentWordIndex, _tr.words, saveToDB, syncAnnotationGenerationEntryStatus);
        },
        toggleCurrentNote: toggleCurrentNote,
        toggleAnnotationBubble: toggleAnnotationBubble,
        beginHoldChunkCn: chunkControlsApi.beginHoldChunkCn, endHoldChunkCn: chunkControlsApi.endHoldChunkCn,
        toggleChunkCn: chunkControlsApi.toggleChunkCn, toggleChunkShadow: chunkControlsApi.toggleChunkShadow,
        setChunkNoteVisible: setChunkNoteVisible,
        handleBackwardClick: handleBackwardClick, handleForwardClick: handleForwardClick,
        closeCustomThemePanel: function () { window.__themeStore.closeCustomThemePanel(); },
        cancelChunkNoteModal: cancelChunkNoteModal,
        closeChunkNoteContextMenu: typeof closeChunkNoteContextMenuRN !== 'undefined' ? closeChunkNoteContextMenuRN : closeChunkNoteContextMenu,
        closeChunkNoteDeleteDialog: closeChunkNoteDeleteDialog,
        closeChunkNoteExportDialog: closeChunkNoteExportDialog,
        setSelectedChunkNote: setSelectedChunkNote,
        openChunkNoteDeleteDialog: openChunkNoteDeleteDialog,
        getChunkNoteDeleteDialogEl: function () { return _cnApi.getChunkNoteDeleteDialogEl(); },
        selectedChunkNoteId: function () { return _cnApi.getSelectedChunkNoteId(); },
        handleChunkSelectionContextMenu: handleChunkSelectionContextMenu,
        chunkNoteCtxAddBtn: chunkNoteCtxAddBtn,
        pendingChunkSelectionCtx: function () { return _cnApi.getPendingChunkSelectionCtx(); },
        consumePendingChunkSelectionCtx: function () { return _cnApi.consumePendingChunkSelectionCtx(); },
        openChunkNotePopover: openChunkNotePopover,
        hotkeyInput: hotkeyInput, hotkeyNotesInput: hotkeyNotesInput,
        hotkeyAnnotationBubbleInput: hotkeyAnnotationBubbleInput,
        hotkeyBackwardInput: hotkeyBackwardInput, hotkeyForwardInput: hotkeyForwardInput,
        hotkeyChunkCnInput: hotkeyChunkCnInput, hotkeyChunkShadowInput: hotkeyChunkShadowInput,
        hotkeyChunkNoteInput: hotkeyChunkNoteInput,
        highlightColorInput: highlightColorInput, sentenceColorInput: sentenceColorInput,
        themeCustomPanel: themeCustomPanel, themeControlsEl: themeControlsEl,
        setMarkKey: function (v) { markKey = v; },
        setNotesKey: function (v) { notesKey = v; },
        setAnnotationBubbleKey: function (v) { annotationBubbleKey = v; },
        setChunkCnKey: function (v) { chunkCnKey = v; },
        setChunkShadowKey: function (v) { chunkShadowKey = v; },
        setChunkNoteKey: function (v) { chunkNoteKey = v; },
        setBackwardKey: function (v) { backwardKey = v; },
        setForwardKey: function (v) { forwardKey = v; },
        chunkNoteCtxMenu: chunkNoteCtxMenu,
        getChunkNoteExportDialogEl: getChunkNoteExportDialogEl,
        getChunkNoteModalEl: function () { return _cnApi.getChunkNoteModalEl(); },
        saveChunkNoteFromModal: saveChunkNoteFromModal
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

    function jumpPrevSentence() {
        var cur = audioPlayer.currentTime;
        var sIdx = getCurrentSegmentIndexHelper(_tr.segments, _tr.words, _tr.wordStarts, cur);
        var targetTime = 0;
        if (sIdx !== -1) {
            var now = Date.now();
            if (_pb.lastSentencePrevTapSegIndex === sIdx && (now - _pb.lastSentencePrevTapAt) <= 600) {
                targetTime = sIdx > 0 ? _tr.segments[sIdx - 1].start : _tr.segments[sIdx].start;
                _pb.lastSentencePrevTapSegIndex = -1; _pb.lastSentencePrevTapAt = 0;
            } else {
                targetTime = _tr.segments[sIdx].start;
                _pb.lastSentencePrevTapSegIndex = sIdx; _pb.lastSentencePrevTapAt = now;
            }
        } else { _pb.lastSentencePrevTapSegIndex = -1; _pb.lastSentencePrevTapAt = 0; }
        audioPlayer.currentTime = targetTime;
        forceUpdateUI(targetTime);
    }

    function jumpNextSentence() {
        var cur = audioPlayer.currentTime;
        var sIdx = getCurrentSegmentIndexHelper(_tr.segments, _tr.words, _tr.wordStarts, cur);
        var next = (sIdx >= 0 && sIdx < _tr.segments.length - 1) ? _tr.segments[sIdx + 1] : null;
        _pb.lastSentencePrevTapSegIndex = -1; _pb.lastSentencePrevTapAt = 0;
        if (next && Number.isFinite(next.start)) {
            audioPlayer.currentTime = next.start;
            forceUpdateUI(next.start);
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
        getCurrentAudioFilenameBase: getCurrentAudioFilenameBase,
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
        markedMap: markedMap, getSegments: function () { return _tr.segments; },
        showError: showError, showToast: showToast
    });

    window.__appHandlers.initMarksImport({
        importMarksBtn: importMarksBtn, importMarksInput: importMarksInput,
        getFirstFileFromEvent: getFirstFileFromEvent,
        readFileAsText: readFileAsText,
        validateMarksArray: validateMarksArray,
        getWords: function () { return _tr.words; }, markedMap: markedMap,
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
        findChunkIndexByTime: findChunkIndexByTime,
        getCurrentSegmentIndexHelper: getCurrentSegmentIndexHelper,
        toggleFollowBtn: toggleFollowBtn,
        mainAppArea: mainAppArea
    });

    initGlassEffects({
        listChunkNotes: function () { return _cnApi.listChunkNotes(); },
        getChunkNoteTagById: getChunkNoteTagById,
        getChunkNoteContentBoxSize: getChunkNoteContentBoxSize
    });
  
    // === Temporary compatibility exports for cross-module access ===
    configureReaderPublicFacades({
        selectSentenceFromChunkTarget: selectSentenceFromChunkTarget,
        openChunkNoteContextFromEvent: openChunkNoteContextFromEvent,
        buildCurrentSentenceDocId: buildCurrentSentenceDocId,
        loadChunkNotesForCurrentAudio: loadChunkNotesForCurrentAudio,
        setChunkNoteVisible: setChunkNoteVisible,
        loadSentenceNotesForCurrentAudio: loadSentenceNotesForCurrentAudio,
        switchSentenceNotesDoc: switchSentenceNotesDoc,
        applyCurrentAudioMeta: applyCurrentAudioMeta
    });
