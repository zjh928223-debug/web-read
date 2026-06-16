    // === ES Module imports: utility modules that set window globals ===
    import './src/utils/data-utils.js';
    import './src/utils/identity-storage-keys.js';
    import './src/utils/import-export-helpers.js';
    import './src/utils/sentence-notes-persistence.js';
    import './src/utils/cloze-utils.js';
    import './src/utils/cloze-view-model.js';
    import './src/utils/playback-index.js';
    import './src/utils/chunk-matching.js';
    import './src/utils/vocab-matching.js';
    import './src/composables/transcript-state.js';
    import './src/composables/chunk-state.js';
    import './src/composables/annotation-lightweight-module.js';

    // === Read-order map ===
    // 1) Data layer: validation, identity, storage keys, persistence helpers
    // 2) UI layer: DOM bindings, runtime state, startup wiring
    // 3) Feature layer: import handlers, matching, rendering, interactions
    // 4) Input layer: keyboard/mouse/global listeners (kept behavior-intact)

    // [MIGRATED] DB schema constants → window.__audioStore

    // Phase 4: Vue rendering toggle (false = old path, true = new Vue path)
    window.__USE_VUE_RENDERING = true;
    const _tr = window.__transcriptState;
    const _ch = window.__chunkState;

    // Phase 8: Bridge — app.js data → Pinia stores (init: write __bridge; runtime: write Pinia directly)
    window.__bridge = { transcript: null, chunkItems: null, clozeItems: null };
    function bridgeToPinia() {
        var ps = window.__piniaStores;
        var b = window.__bridge;
        var chunkSnapshot = _ch.getSnapshot();
        // Always write to bridge (for main.js init consumption)
        if (b) {
            b.transcript = { segments: _tr.segments, words: _tr.words, wordStarts: _tr.wordStarts, highlightMode: _tr.highlightMode };
            b.chunkItems = chunkSnapshot.chunkItems; b.isChunkMode = chunkSnapshot.isChunkMode; b.hasAiChunkData = chunkSnapshot.hasAiChunkData;
            b.chunkCNVisible = chunkSnapshot.chunkCnVisible; b.chunkCNHoldMode = chunkSnapshot.chunkCnHoldMode;
            b.chunkFocusMode = chunkSnapshot.chunkCnMode === 'focus'; b.chunkShadowVisible = chunkSnapshot.isChunkShadowOn;
            b.clozeItems = clozeItems; b.hasClozeData = hasClozeData; b.clozeAnswerState = clozeAnswerState;
        }
        // If Pinia already exists, write directly for reactive updates
        if (ps) {
            if (ps.transcript) {
                ps.transcript.segments = _tr.segments; ps.transcript.words = _tr.words;
                ps.transcript.wordStarts = _tr.wordStarts; ps.transcript.highlightMode = _tr.highlightMode;
            }
            if (ps.chunk) {
                ps.chunk.chunkItems = chunkSnapshot.chunkItems; ps.chunk.isChunkMode = chunkSnapshot.isChunkMode; ps.chunk.hasAiChunkData = chunkSnapshot.hasAiChunkData;
                ps.chunk.chunkCNVisible = chunkSnapshot.chunkCnVisible; ps.chunk.chunkCNHoldMode = chunkSnapshot.chunkCnHoldMode;
                ps.chunk.chunkFocusMode = chunkSnapshot.chunkCnMode === 'focus'; ps.chunk.chunkShadowVisible = chunkSnapshot.isChunkShadowOn;
                ps.chunk.chunkNoteVisible = !!(_ns && _ns.chunkNoteVisible);
            }
            if (ps.cloze) { ps.cloze.items = clozeItems; ps.cloze.hasData = hasClozeData; ps.cloze.answerState = clozeAnswerState; }
        }
    }

    // [MIGRATED] DB operations → window.__audioStore
    var initDB = function () { return window.__audioStore.initDB(); };
    var saveToDB = function (id, data) { return window.__audioStore.saveToDB(id, data); };
    var loadFromDB = function (id) { return window.__audioStore.loadFromDB(id); };
    var deleteFromDB = function (id) { return window.__audioStore.deleteFromDB(id); };
    var clearDBStore = function () { return window.__audioStore.clearDBStore(); };

    function safeParseLocalJSON(key, fallbackValue) {
        try {
            const raw = localStorage.getItem(key);
            if (!raw) return fallbackValue;
            const parsed = JSON.parse(raw);
            return parsed ?? fallbackValue;
        } catch (e) {
            return fallbackValue;
        }
    }

    // [MIGRATED] toast → window.__uiStore (wrappers kept for ~29 internal call sites)
    function showToast(message, type, timeoutMs) {
        return window.__uiStore.showToast(message, type, timeoutMs);
    }
    function showError(code, detail) {
        return window.__uiStore.showError(code, detail);
    }

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
        getChunkNoteWrapTokens: getChunkNoteWrapTokensHelper,
        splitTokenToFitWidth: splitTokenToFitWidthHelper,
        wrapChunkNoteTextForCanvas: wrapChunkNoteTextForCanvasHelper,
        truncateCanvasLine: truncateCanvasLineHelper
    } = window.ChunkNoteLayoutHelpers;
    const {
        buildEmptyChunkNoteLayoutResult,
        buildChunkNoteLayoutResult
    } = window.ChunkNoteLayoutCore;
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
    const buildAudioKey = window.IdentityStorageKeys.buildAudioKey;
    const buildTranscriptKey = (data) => window.IdentityStorageKeys.buildTranscriptKey(data, _tr.segments);
    const getChunkNotesStorageKey = () => window.IdentityStorageKeys.getChunkNotesStorageKey(currentAudioKey);
    const getChunkNoteDraftStorageKey = () => window.IdentityStorageKeys.getChunkNoteDraftStorageKey(currentAudioKey);
    const getSentenceNotesStorageKey = window.IdentityStorageKeys.getSentenceNotesStorageKey;
    const getLegacySentenceNotesStorageKey = (audioKey = currentAudioKey) => window.IdentityStorageKeys.getLegacySentenceNotesStorageKey(audioKey);
    const buildCurrentSentenceDocId = (transcriptSource = null) => window.IdentityStorageKeys.buildCurrentSentenceDocId(transcriptSource, currentAudioKey, _tr.segments);

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
    function saveChunkNotesDebounced() { return _cnApi.saveChunkNotesDebounced(); }
    // === Chunk-note persistence lifecycle ===
    async function loadChunkNotesForCurrentAudio() { return _cnApi.loadChunkNotesForCurrentAudio(); }
    function saveChunkNotesNow() { return _cnApi.saveChunkNotesNow(); }
    function setChunkNoteVisible(next, persist) { return _cnApi.setChunkNoteVisible(next, persist); }
    function getChunkBlockByRef(chunkRef) { return _cnApi.getChunkBlockByRef(chunkRef); }
    function closeChunkNoteContextMenu() { return _cnApi.closeChunkNoteContextMenu(); }
    function openChunkNoteContextMenu(clientX, clientY, ctx) { return _cnApi.openChunkNoteContextMenu(clientX, clientY, ctx); }
    function getChunkNoteAccent(note, indexHint) { return _cnApi.getChunkNoteAccent(note, indexHint); }
    function clearChunkWordAnnotations(enDiv) { return _cnApi.clearChunkWordAnnotations(enDiv); }
    function markChunkWordsByNotes(enDiv, notes) { return _cnApi.markChunkWordsByNotes(enDiv, notes); }
    function setChunkNoteHoverTarget(noteId) { return _cnApi.setChunkNoteHoverTarget(noteId); }

    // === Sentence notebook persistence lifecycle ===
    async function loadSentenceNotesForCurrentAudio() { return _snApi.loadSentenceNotesForCurrentAudio(); }
    function saveSentenceNotesDebounced() { return _snApi.saveSentenceNotesDebounced(); }
    // Sentence notebook: data normalization + doc-scoped persistence
    function normalizeSentenceNoteRecord(sentenceId, note) { return _snApi.normalizeSentenceNoteRecord(sentenceId, note); }
    function normalizeSentenceNotesScope(scope) { return _snApi.normalizeSentenceNotesScope(scope); }
    function getSentenceNoteRecord(sentenceId) { return _snApi.getSentenceNoteRecord(sentenceId); }
    function getSortedSentenceNoteItems(sentenceId) { return _snApi.getSortedSentenceNoteItems(sentenceId); }
    function ensureLegacySentenceNotesForDoc(docId) { return _snApi.ensureLegacySentenceNotesForDoc(docId); }
    function persistSentenceNotebookNow() { return _snApi.persistSentenceNotebookNow(); }
    function persistSentenceNotesForCurrentDoc() { return _snApi.persistSentenceNotesForCurrentDoc(); }
    async function switchSentenceNotesDoc(transcriptSource) { return _snApi.switchSentenceNotesDoc(transcriptSource); }
    function getCurrentSentenceDocIdForExport() { return _snApi.getCurrentSentenceDocIdForExport(); }
    function buildSentenceNotesExportSnapshot() { return _snApi.buildSentenceNotesExportSnapshot(); }
    function triggerSentenceNotesDownload(snapshot, filename) { return _snApi.triggerSentenceNotesDownload(snapshot, filename); }

    // === Import / export / restore shared helpers ===
    function persistSentenceNotebookBeforeContentSwitch() {
        persistSentenceNotebookNow();
    }

    const getFirstFileFromEvent = window.ImportExportSharedHelpers.getFirstFileFromEvent;
    const getCurrentAudioFilenameBase = (fallback = 'audio') => window.ImportExportSharedHelpers.getCurrentAudioFilenameBase(currentAudioMeta, fallback);
    const markFileLoaded = window.ImportExportSharedHelpers.markFileLoaded;

    function applyCurrentAudioMeta(meta) {
        const nextAudioState = window.ImportExportSharedHelpers.buildCurrentAudioMetaState(meta, buildAudioKey);
        currentAudioMeta = nextAudioState.currentAudioMeta;
        currentAudioKey = nextAudioState.currentAudioKey;
        if (_cnApi && typeof _cnApi.setChunkNoteDraftRestoreDone === 'function') {
            _cnApi.setChunkNoteDraftRestoreDone(nextAudioState.chunkNoteDraftRestoreDone);
        }
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

    function scheduleSentenceFocusCapture() {
        setTimeout(() => { maybeCaptureSentenceFocusPhrase(); }, 0);
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

    function closeChunkNoteExportDialog() {
        if (chunkNoteExportDialogKeydownHandler) {
            document.removeEventListener('keydown', chunkNoteExportDialogKeydownHandler, true);
            chunkNoteExportDialogKeydownHandler = null;
        }
        if (chunkNoteExportDialogEl) {
            chunkNoteExportDialogEl.remove();
            chunkNoteExportDialogEl = null;
        }
    }

    function supportsChunkNotesDirectOverwrite() {
        return typeof window.showSaveFilePicker === 'function';
    }

    function triggerChunkNotesDownload(snapshot, filename) {
        const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    }

    async function writeChunkNotesToHandle(handle, snapshot) {
        const writable = await handle.createWritable();
        await writable.write(JSON.stringify(snapshot, null, 2));
        await writable.close();
    }

    async function saveChunkNotesAs(snapshot, suggestedName) {
        if (!supportsChunkNotesDirectOverwrite()) {
            triggerChunkNotesDownload(snapshot, suggestedName);
            _cnApi.setChunkNotesFileState({ handle: null, audioKey: '', fileName: suggestedName });
            return;
        }
        const handle = await window.showSaveFilePicker({
            suggestedName,
            types: [{ description: 'JSON Files', accept: { 'application/json': ['.json'] } }]
        });
        await writeChunkNotesToHandle(handle, snapshot);
        _cnApi.setChunkNotesFileState({
            handle,
            audioKey: currentAudioKey || 'default-audio',
            fileName: handle.name || suggestedName
        });
    }

    function openChunkNotesExportConfirmDialog(fileName, onSaveAs, onOverwrite) {
        closeChunkNoteExportDialog();
        const dialog = document.createElement('div');
        dialog.className = 'chunk-note-delete-dialog';
        dialog.innerHTML = `
          <div class="chunk-note-delete-title">检测到已保存文件，是否覆盖？</div>
          <div class="chunk-note-export-hint">${fileName || 'chunk_notes.json'}</div>
          <div class="chunk-note-delete-actions">
            <button type="button" class="chunk-note-delete-btn">另存为</button>
            <button type="button" class="chunk-note-delete-btn primary">确认覆盖</button>
          </div>
        `;
        document.body.appendChild(dialog);
        chunkNoteExportDialogEl = dialog;

        const left = Math.max(12, Math.min(window.innerWidth - 280, (window.innerWidth - 280) / 2));
        const top = Math.max(12, Math.min(window.innerHeight - 140, (window.innerHeight - 140) / 2));
        dialog.style.left = `${left}px`;
        dialog.style.top = `${top}px`;

        const [saveAsBtn, overwriteBtn] = dialog.querySelectorAll('.chunk-note-delete-btn');
        if (saveAsBtn) {
            saveAsBtn.addEventListener('click', async () => {
                closeChunkNoteExportDialog();
                await onSaveAs();
            });
        }
        if (overwriteBtn) {
            overwriteBtn.addEventListener('click', async () => {
                closeChunkNoteExportDialog();
                await onOverwrite();
            });
            overwriteBtn.focus();
        }

        chunkNoteExportDialogKeydownHandler = (e) => {
            if (!chunkNoteExportDialogEl) return;
            if (e.key === 'Enter') {
                e.preventDefault();
                if (overwriteBtn) overwriteBtn.click();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                closeChunkNoteExportDialog();
            }
        };
        document.addEventListener('keydown', chunkNoteExportDialogKeydownHandler, true);
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

    function persistChunkNoteDraft(immediate = false) {
        return _cnApi.persistCurrentChunkNoteDraft(immediate);
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

    function getChunkNoteWrapTokens(text) {
        return getChunkNoteWrapTokensHelper(text);
    }

    function splitTokenToFitWidth(ctx, token, maxWidth) {
        return splitTokenToFitWidthHelper(ctx, token, maxWidth);
    }

    function wrapChunkNoteTextForCanvas(ctx, text, maxWidth) {
        return wrapChunkNoteTextForCanvasHelper(ctx, text, maxWidth);
    }

    function truncateCanvasLine(ctx, text, maxWidth) {
        return truncateCanvasLineHelper(ctx, text, maxWidth);
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

    function getChunkNoteModalPosition(anchorRect, modalEl) {
        return _cnApi.getChunkNoteModalPosition(anchorRect, modalEl);
    }

    function applyTempAnnotationByCtx(ctx) {
        return _cnApi.applyTempAnnotationByCtx(ctx);
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

    function openChunkNoteStyleModal() {
        return _cnApi.openChunkNoteStyleModal();
    }

    function closeChunkNoteStyleModal() {
        return _cnApi.closeChunkNoteStyleModal();
    }

    function updateChunkNoteStyle() {
        return _cnApi.updateChunkNoteStyle();
    }

    function adjustChunkNoteArrowSizeByGap() {
        return _cnApi.adjustChunkNoteArrowSizeByGap();
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
    const toggleSidebarBtn = document.getElementById('toggle-sidebar-btn');
    const toggleChunkBtn = document.getElementById('toggle-chunk-btn'); 
    const chunkCnHoldBtn = document.getElementById('btn-chunk-cn-hold');
    if (chunkCnHoldBtn) {
        chunkCnHoldBtn.addEventListener('click', (e)=>{ e.preventDefault(); e.stopPropagation(); toggleChunkCnHoldMode(); });
    }
    
    // Inputs & Labels
    const audioFileInput = document.getElementById('audio-file');
    const transcriptFileInput = document.getElementById('transcript-file');
    const notesFileInput = document.getElementById('notes-file');
    const visualFileInput = document.getElementById('visual-file');
    const chunkFileInput = document.getElementById('chunk-file'); 
    const clozeFileInput = document.getElementById('cloze-file');
    
    const lblAudio = document.getElementById('lbl-audio');
    const lblTranscript = document.getElementById('lbl-transcript');
    const lblNotes = document.getElementById('lbl-notes');
    const lblVisual = document.getElementById('lbl-visual');

    const highlightColorInput = document.getElementById('highlight-color-input');
    const sentenceColorInput = document.getElementById('sentence-color-input');
    
    const hotkeyInput = document.getElementById('hotkey-input');
    const hotkeyNotesInput = document.getElementById('hotkey-notes-input');
    const hotkeyAnnotationBubbleInput = document.getElementById('hotkey-annotation-bubble-input');
    const hotkeyBackwardInput = document.getElementById('hotkey-backward-input');
    const hotkeyForwardInput = document.getElementById('hotkey-forward-input');
    const hotkeySidebarInput = document.getElementById('hotkey-sidebar-input');
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
    const loadClozeBtn = document.getElementById('btn-load-cloze');

    // === Runtime state ===
    let autoFollow = true;
    let userScrollSuppress = false;
    let suppressTimer = null;
    
    let lastActiveSegIndex = -1;
    let activeWordHighlightEl = null;
    let activeSentenceEl = null;
    let activeChunkEl = null;
    let playbackUiSignature = '';

    let markKey = 'm';
    let notesKey = 'n';
    let annotationBubbleKey = 'b';
    let sidebarKey = 'v';
    let chunkCnKey = 'c'; 
    let chunkShadowKey = 's'; 
    let chunkNoteKey = 'x';
    let backwardKey = 'ArrowLeft';
    let forwardKey = 'ArrowRight';
    const markedMap = new Map();

    let globalVocab = []; 
    let vocabMatchMap = new Map();

    // === AI Chunk Mode State ===
    // Owned by src/composables/chunk-state.js + src/pinia-stores/chunk.js.
    let holdPrevHadFocusClass = null;
    let lastSentencePrevTapSegIndex = -1;
    let lastSentencePrevTapAt = 0;
    let clozeItems = [];
    let hasClozeData = false;
    let clozeAnswerState = [];
    // [MIGRATED] shared notes state → src/composables/notes-module.js
    var _ns = {
        chunkNotesMap: {},
        chunkNoteVisible: false,
        chunkNoteSaveTimer: null,
        activeChunkNoteId: '',
        selectedChunkNoteId: '',
        pendingChunkSelectionCtx: null,
        sentenceNotesMap: {},
        allSentenceNotesByDoc: {},
        currentDocId: 'default-audio::0__0__0.000__0.000__0',
        sentenceNoteDraft: null,
        notePreviewEditingItemId: '',
        notePreviewSavedItemId: '',
        selectedSentence: null
    };
    var _cnApi = window.__notesModule.initChunkNotes({
        state: _ns,
        loadFromDB: loadFromDB,
        saveToDB: saveToDB,
        getChunkNotesStorageKey: getChunkNotesStorageKey,
        getChunkNoteDraftStorageKey: getChunkNoteDraftStorageKey,
        sanitizeChunkNoteFontSize: window.__chunkNoteLayout.sanitizeChunkNoteFontSize,
        getIsChunkMode: function () { return _ch.isChunkMode; },
        currentAudioKeyGetter: function () { return currentAudioKey; },
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
        getChunkNotesFileState: function () {
            return {
                handle: chunkNotesFileHandle,
                audioKey: chunkNotesFileHandleAudioKey,
                fileName: chunkNotesFileName
            };
        },
        setChunkNotesFileState: function (next) {
            next = next || {};
            if (Object.prototype.hasOwnProperty.call(next, 'handle')) chunkNotesFileHandle = next.handle || null;
            if (Object.prototype.hasOwnProperty.call(next, 'audioKey')) chunkNotesFileHandleAudioKey = String(next.audioKey || '');
            if (Object.prototype.hasOwnProperty.call(next, 'fileName')) chunkNotesFileName = String(next.fileName || '');
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
    // Stubs for functions now in session-init.js (needed at app.js init time)
    function clearGeneratedAnnotationIndex() {
        if (typeof window.__session_clearGeneratedAnnotationIndex === 'function') {
            window.__session_clearGeneratedAnnotationIndex();
        }
    }
    function clearPersistedChunkSession() {
        if (typeof window.__session_clearPersistedChunkSession === 'function') {
            return window.__session_clearPersistedChunkSession();
        }
        return Promise.resolve();
    }
    function getAnnotationGenerationScope() {
        if (typeof window.__session_getAnnotationGenerationScope === 'function') {
            return window.__session_getAnnotationGenerationScope();
        }
        return { audioKey: 'default-audio', documentId: 'default-document' };
    }
    function getAnnotationGenerationScopeKey(scope) {
        const rawScope = scope || getAnnotationGenerationScope();
        const audioKey = rawScope && rawScope.audioKey ? String(rawScope.audioKey) : 'default-audio';
        const documentId = rawScope && rawScope.documentId ? String(rawScope.documentId) : 'default-document';
        return `${audioKey}::${documentId}`;
    }
    function getAnnotationGeneratedIndexScopeKey() {
        return window.__state && window.__state.annotationGeneratedIndexScopeKey
            ? String(window.__state.annotationGeneratedIndexScopeKey)
            : '';
    }
    function emitAnnotationDiagnostics() {
        if (typeof window.__session_emitAnnotationDiagnostics === 'function') {
            return window.__session_emitAnnotationDiagnostics.apply(null, arguments);
        }
    }
    function emitAnnotationDebug(step, payload) {
        try {
            if (window.ANNOTATION_DEBUG === true || localStorage.getItem('annotationDebug') === '1') {
                console.debug(`[annotation-debug] ${step}`, payload || {});
            }
        } catch (error) {}
    }
    function scheduleGeneratedAnnotationIndexRefresh() {
        if (typeof window.__session_scheduleGeneratedAnnotationIndexRefresh === 'function') {
            return window.__session_scheduleGeneratedAnnotationIndexRefresh();
        }
        return Promise.resolve();
    }
    function syncAnnotationGenerationEntryStatus() {
        if (typeof window.__session_syncAnnotationGenerationEntryStatus === 'function') {
            return window.__session_syncAnnotationGenerationEntryStatus();
        }
    }
    function getAnnotationGeneratedResultStore() {
        return window.AnnotationGeneratedResultStore || null;
    }
    function getAnnotationClickResolver() {
        return window.AnnotationClickResolver || null;
    }
    function initAnnotationApiSettingsUi() {
        if (typeof window.__session_initAnnotationApiSettingsUi === 'function') {
            return window.__session_initAnnotationApiSettingsUi();
        }
    }
    window.__state = {};
    // chunkNoteModalEl: use independent storage to avoid let TDZ
    var __chunkNoteModalEl = null;
    Object.defineProperty(window.__state, 'chunkNoteModalEl', { get: function() { return __chunkNoteModalEl; }, set: function(v) { __chunkNoteModalEl = v; }, enumerable: true, configurable: true });
    Object.defineProperty(window.__state, 'segments', { get: function() { return _tr.segments; }, set: function(v) { _tr.segments = v; }, enumerable: true, configurable: true });
    Object.defineProperty(window.__state, 'words', { get: function() { return _tr.words; }, set: function(v) { _tr.words = v; }, enumerable: true, configurable: true });
    Object.defineProperty(window.__state, 'wordStarts', { get: function() { return _tr.wordStarts; }, set: function(v) { _tr.wordStarts = v; }, enumerable: true, configurable: true });
    Object.defineProperty(window.__state, 'chunkItems', { get: function() { return _ch.chunkItems; }, set: function(v) { _ch.chunkItems = v; }, enumerable: true, configurable: true });
    Object.defineProperty(window.__state, 'hasAiChunkData', { get: function() { return _ch.hasAiChunkData; }, set: function(v) { _ch.hasAiChunkData = v; }, enumerable: true, configurable: true });
    Object.defineProperty(window.__state, 'hasClozeData', { get: function() { return hasClozeData; }, set: function(v) { hasClozeData = v; }, enumerable: true, configurable: true });
    Object.defineProperty(window.__state, 'clozeItems', { get: function() { return clozeItems; }, set: function(v) { clozeItems = v; }, enumerable: true, configurable: true });
    Object.defineProperty(window.__state, 'clozeAnswerState', { get: function() { return clozeAnswerState; }, set: function(v) { clozeAnswerState = v; }, enumerable: true, configurable: true });
    Object.defineProperty(window.__state, 'manualChunkStates', { get: function() { return _ch.manualChunkStates; }, set: function(v) { _ch.manualChunkStates = v; }, enumerable: true, configurable: true });
    Object.defineProperty(window.__state, 'currentAudioMeta', { get: function() { return currentAudioMeta; }, set: function(v) { currentAudioMeta = v; }, enumerable: true, configurable: true });
    Object.defineProperty(window.__state, 'chunkNotesFileHandle', { get: function() { return _cnApi.getChunkNotesFileState().handle; }, set: function(v) { _cnApi.setChunkNotesFileState({ handle: v }); }, enumerable: true, configurable: true });
    Object.defineProperty(window.__state, 'chunkNotesFileHandleAudioKey', { get: function() { return _cnApi.getChunkNotesFileState().audioKey; }, set: function(v) { _cnApi.setChunkNotesFileState({ audioKey: v }); }, enumerable: true, configurable: true });
    Object.defineProperty(window.__state, 'chunkNotesFileName', { get: function() { return _cnApi.getChunkNotesFileState().fileName; }, set: function(v) { _cnApi.setChunkNotesFileState({ fileName: v }); }, enumerable: true, configurable: true });
    var __cak = 'default-audio';
    Object.defineProperty(window.__state, 'isChunkMode', { get: function() { return _ch.isChunkMode; }, set: function(v) { _ch.isChunkMode = v; }, enumerable: true, configurable: true });
    Object.defineProperty(window.__state, 'currentAudioKey', { get: function() { return __cak; }, set: function(v) { __cak = v; }, enumerable: true, configurable: true });
    Object.defineProperty(window.__state, 'currentWordIndex', { get: function() { return _tr.currentWordIndex; }, set: function(v) { _tr.currentWordIndex = v; }, enumerable: true, configurable: true });
    Object.defineProperty(window.__state, 'autoFollow', { get: function() { return autoFollow; }, set: function(v) { autoFollow = v; }, enumerable: true, configurable: true });
    Object.defineProperty(window.__state, 'userScrollSuppress', { get: function() { return userScrollSuppress; }, set: function(v) { userScrollSuppress = v; }, enumerable: true, configurable: true });
    Object.defineProperty(window.__state, 'suppressTimer', { get: function() { return suppressTimer; }, set: function(v) { suppressTimer = v; }, enumerable: true, configurable: true });
    Object.defineProperty(window.__state, 'highlightMode', { get: function() { return _tr.highlightMode; }, set: function(v) { _tr.highlightMode = v; }, enumerable: true, configurable: true });
    Object.defineProperty(window.__state, 'lastActiveSegIndex', { get: function() { return lastActiveSegIndex; }, set: function(v) { lastActiveSegIndex = v; }, enumerable: true, configurable: true });
    Object.defineProperty(window.__state, 'activeWordHighlightEl', { get: function() { return activeWordHighlightEl; }, set: function(v) { activeWordHighlightEl = v; }, enumerable: true, configurable: true });
    Object.defineProperty(window.__state, 'activeSentenceEl', { get: function() { return activeSentenceEl; }, set: function(v) { activeSentenceEl = v; }, enumerable: true, configurable: true });
    Object.defineProperty(window.__state, 'activeChunkEl', { get: function() { return activeChunkEl; }, set: function(v) { activeChunkEl = v; }, enumerable: true, configurable: true });
    Object.defineProperty(window.__state, 'playbackUiSignature', { get: function() { return playbackUiSignature; }, set: function(v) { playbackUiSignature = v; }, enumerable: true, configurable: true });
    Object.defineProperty(window.__state, 'markKey', { get: function() { return markKey; }, set: function(v) { markKey = v; }, enumerable: true, configurable: true });
    Object.defineProperty(window.__state, 'notesKey', { get: function() { return notesKey; }, set: function(v) { notesKey = v; }, enumerable: true, configurable: true });
    Object.defineProperty(window.__state, 'annotationBubbleKey', { get: function() { return annotationBubbleKey; }, set: function(v) { annotationBubbleKey = v; }, enumerable: true, configurable: true });
    Object.defineProperty(window.__state, 'chunkCnKey', { get: function() { return chunkCnKey; }, set: function(v) { chunkCnKey = v; }, enumerable: true, configurable: true });
    Object.defineProperty(window.__state, 'chunkShadowKey', { get: function() { return chunkShadowKey; }, set: function(v) { chunkShadowKey = v; }, enumerable: true, configurable: true });
    Object.defineProperty(window.__state, 'chunkNoteKey', { get: function() { return chunkNoteKey; }, set: function(v) { chunkNoteKey = v; }, enumerable: true, configurable: true });
    Object.defineProperty(window.__state, 'backwardKey', { get: function() { return backwardKey; }, set: function(v) { backwardKey = v; }, enumerable: true, configurable: true });
    Object.defineProperty(window.__state, 'forwardKey', { get: function() { return forwardKey; }, set: function(v) { forwardKey = v; }, enumerable: true, configurable: true });
    Object.defineProperty(window.__state, 'markedMap', { get: function() { return markedMap; }, set: function(v) { markedMap.clear(); if (v instanceof Map) v.forEach(function(value, key) { markedMap.set(key, value); }); }, enumerable: true, configurable: true });
    Object.defineProperty(window.__state, 'globalVocab', { get: function() { return globalVocab; }, set: function(v) { globalVocab = v; }, enumerable: true, configurable: true });
    Object.defineProperty(window.__state, 'vocabMatchMap', { get: function() { return vocabMatchMap; }, set: function(v) { vocabMatchMap.clear(); if (v instanceof Map) v.forEach(function(value, key) { vocabMatchMap.set(key, value); }); }, enumerable: true, configurable: true });
    Object.defineProperty(window.__state, 'chunkCnVisible', { get: function() { return _ch.chunkCnVisible; }, set: function(v) { _ch.chunkCnVisible = v; }, enumerable: true, configurable: true });
    Object.defineProperty(window.__state, 'chunkCnHoldMode', { get: function() { return _ch.chunkCnHoldMode; }, set: function(v) { _ch.chunkCnHoldMode = v; }, enumerable: true, configurable: true });
    Object.defineProperty(window.__state, 'isHoldingChunkCn', { get: function() { return _ch.isHoldingChunkCn; }, set: function(v) { _ch.isHoldingChunkCn = v; }, enumerable: true, configurable: true });
    Object.defineProperty(window.__state, 'holdPrevChunkCnVisible', { get: function() { return _ch.holdPrevChunkCnVisible; }, set: function(v) { _ch.holdPrevChunkCnVisible = v; }, enumerable: true, configurable: true });
    Object.defineProperty(window.__state, 'holdPrevHadFocusClass', { get: function() { return holdPrevHadFocusClass; }, set: function(v) { holdPrevHadFocusClass = v; }, enumerable: true, configurable: true });
    Object.defineProperty(window.__state, 'isChunkShadowOn', { get: function() { return _ch.isChunkShadowOn; }, set: function(v) { _ch.isChunkShadowOn = v; }, enumerable: true, configurable: true });
    Object.defineProperty(window.__state, 'chunkCnMode', { get: function() { return _ch.chunkCnMode; }, set: function(v) { _ch.chunkCnMode = v; }, enumerable: true, configurable: true });
    Object.defineProperty(window.__state, 'lastActiveChunkIndex', { get: function() { return _ch.lastActiveChunkIndex; }, set: function(v) { _ch.lastActiveChunkIndex = v; }, enumerable: true, configurable: true });
    Object.defineProperty(window.__state, 'lastAiPrevTapChunkIndex', { get: function() { return _ch.lastAiPrevTapChunkIndex; }, set: function(v) { _ch.lastAiPrevTapChunkIndex = v; }, enumerable: true, configurable: true });
    Object.defineProperty(window.__state, 'lastAiPrevTapAt', { get: function() { return _ch.lastAiPrevTapAt; }, set: function(v) { _ch.lastAiPrevTapAt = v; }, enumerable: true, configurable: true });
    Object.defineProperty(window.__state, 'lastSentencePrevTapSegIndex', { get: function() { return lastSentencePrevTapSegIndex; }, set: function(v) { lastSentencePrevTapSegIndex = v; }, enumerable: true, configurable: true });
    Object.defineProperty(window.__state, 'lastSentencePrevTapAt', { get: function() { return lastSentencePrevTapAt; }, set: function(v) { lastSentencePrevTapAt = v; }, enumerable: true, configurable: true });
    Object.defineProperty(window.__state, 'chunkPointerDown', { get: function() { return chunkPointerDown; }, set: function(v) { chunkPointerDown = v; }, enumerable: true, configurable: true });

    var _cpApi = window.__importModule.initChunkPipeline({
        state: window.__state,
        getIsChunkMode: function() { return _ch.isChunkMode; },
        renderChunkMode: renderChunkMode,
        bridgeToPinia: bridgeToPinia,
        toggleChunkBtn: toggleChunkBtn,
        enterChunkMode: function () { toggleChunkMode(true); },
        cleanTextHelper: cleanTextHelper,
        tokenizeTextHelper: tokenizeTextHelper,
        findExactMatchRangeHelper: findExactMatchRangeHelper
    });

    var _ihApi = window.__importModule.initImportHandlers({
        state: window.__state,
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
        rebuildVocabMatching: rebuildVocabMatching,
        closeChunkNoteExportDialog: closeChunkNoteExportDialog,
        loadChunkNotesForCurrentAudio: loadChunkNotesForCurrentAudio,
        processChunkData: _cpApi.processChunkData,
        audioPlayer: audioPlayer,
        transcriptContainer: transcriptContainer,
        loadClozeBtn: loadClozeBtn,
        _ns: _ns,
        markedMap: markedMap
    });

    var _importApi = {
        processTranscript: _ihApi.processTranscript,
        processChunkData: _cpApi.processChunkData,
        setClozeData: _ihApi.setClozeData,
        resetClozeState: _ihApi.resetClozeState,
        buildClozeQuizMarkup: _ihApi.buildClozeQuizMarkup,
        handleClozeCheck: _ihApi.handleClozeCheck
    };

    function processTranscript(json) {
        return _importApi.processTranscript(json);
    }
    function processChunkData(data) {
        return _importApi.processChunkData(data);
    }

    let chunkNoteExportDialogEl = null;
    let chunkNoteExportDialogKeydownHandler = null;
    let chunkNotesFileHandle = null;
    let chunkNotesFileHandleAudioKey = '';
    let chunkNotesFileName = '';
    let currentAudioMeta = null;
    let currentAudioKey = 'default-audio';
    let chunkPointerDown = null;
    ensureChunkNoteOverlayLayers();

    // [MIGRATED] style editor → src/composables/style-editor.js
    window.__styleEditor.init({
        safeParseLocalJSON: safeParseLocalJSON,
        adjustChunkNoteArrowSizeByGap: adjustChunkNoteArrowSizeByGap,
        renderAllChunkNoteTags: renderAllChunkNoteTags,
        scheduleChunkNoteConnectorRedraw: scheduleChunkNoteConnectorRedraw,
        getIsChunkMode: function () { return _ch.isChunkMode; },
        closeChunkNotePopover: closeChunkNotePopover,
        updateShadowBtnText: updateShadowBtnText
    });

    // [MIGRATED] session init → src/composables/session-init.js
    // === Startup wiring: theme ===
    // [MIGRATED] → window.__themeStore
    const themeStore = window.__themeStore;

    themeStore.init();

    themeToggleBtn.addEventListener('click', function () {
        if (typeof window.__lockChunkNoteDimensionsForTheme === 'function') {
            window.__lockChunkNoteDimensionsForTheme();
        }
        var currentTheme = localStorage.getItem('theme') || 'light';
        var nextTheme = currentTheme === 'light' ? 'dark' : (currentTheme === 'dark' ? 'custom' : 'light');
        themeStore.applyThemeMode(nextTheme);
        if (nextTheme === 'custom') {
            themeStore.openCustomThemePanel();
        } else {
            themeStore.closeCustomThemePanel();
        }
        refreshAllChunkNoteVisuals();
    });
    [
        ['bg', themeCustomBgInput],
        ['text', themeCustomTextInput],
        ['sub', themeCustomSubInput],
        ['border', themeCustomBorderInput],
        ['button', themeCustomButtonInput]
    ].forEach(function (pair) {
        var key = pair[0];
        var input = pair[1];
        if (!input) return;
        input.addEventListener('input', function () {
            var colors = themeStore.getStoredCustomThemeColors();
            colors[key] = input.value;
            themeStore.applyCustomTheme(colors);
            refreshAllChunkNoteVisuals();
        });
        input.addEventListener('change', function () {
            themeStore.closeCustomThemePanel();
        });
    });
    if (themeCustomResetBtn) {
        themeCustomResetBtn.addEventListener('click', function () {
            themeStore.applyCustomTheme(themeStore.CUSTOM_THEME_DEFAULTS);
            themeStore.closeCustomThemePanel();
            refreshAllChunkNoteVisuals();
        });
    }
    initAnnotationApiSettingsUi();

    // M4+M5 delegated → src/composables/import-module.js

    // === Transcript/chunk context matching logic ===
    function rebuildVocabMatching() {
        vocabMatchMap.clear();
        if (!_tr.segments.length || !globalVocab.length) return;
        const nextMap = buildVocabMatchMapHelper(_tr.words, globalVocab);
        nextMap.forEach((value, key) => vocabMatchMap.set(key, value));
    }

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

    function getAnnotationBubble() {
        const bubble = window.AnnotationBubble || null;
        if (!bubble) return null;
        if (typeof bubble.init === 'function') {
            try {
                bubble.init();
            } catch (error) {}
        }
        return bubble;
    }

    function pickAnnotationValue(source, keys) {
        if (!source || typeof source !== 'object') return '';
        for (const key of keys) {
            const value = source[key];
            if (value != null && String(value).trim()) return String(value).trim();
        }
        return '';
    }

    function normalizeAnnotationBubbleHit(match, wordIndex, span) {
        const data = match && match.data ? match.data : match;
        if (!data || typeof data !== 'object') return null;
        const word = Number.isFinite(wordIndex) ? _tr.words[wordIndex] : null;
        const clickedText = ((span && span.textContent) || (word && (word.word || word.text)) || '').trim();
        return {
            markedText: pickAnnotationValue(data, ['markedText', 'marked_text', 'word', 'text']) || clickedText,
            boundary: pickAnnotationValue(data, ['boundary', 'match_context', 'context', 'phrase']) || clickedText,
            type: pickAnnotationValue(data, ['type', 'category', 'label', 'tag']),
            meaning: pickAnnotationValue(data, ['meaning', 'means', 'explanation', 'definition', 'cn', 'zh']),
            memoryHint: pickAnnotationValue(data, ['memoryHint', 'memory_hint', 'remember', 'note', 'not_meaning', 'hint'])
        };
    }

    function resolveGeneratedAnnotationBubbleForSpan(span, wordIndex) {
        const resolver = getAnnotationClickResolver();
        const store = getAnnotationGeneratedResultStore();
        if (!resolver || typeof resolver.resolveClick !== 'function' || !store) return null;
        const currentScopeKey = getAnnotationGenerationScopeKey();
        const indexedScopeKey = getAnnotationGeneratedIndexScopeKey();
        if (indexedScopeKey && indexedScopeKey !== currentScopeKey) {
            emitAnnotationDebug('app.generated_click_scope_mismatch', {
                scope: getAnnotationGenerationScope(),
                indexedScopeKey,
                currentScopeKey,
                wordIndex
            });
            emitAnnotationDiagnostics('app.generated_click_scope_mismatch', {
                scope: getAnnotationGenerationScope(),
                indexedScopeKey,
                currentScopeKey,
                wordIndex
            });
            return null;
        }
        const result = resolver.resolveClick({
            span,
            wordIndex,
            words: _tr.words,
            generatedStore: store
        });
        emitAnnotationDebug('app.generated_click_resolve', {
            scope: getAnnotationGenerationScope(),
            wordIndex,
            clickedText: String((span && span.textContent) || '').trim(),
            hit: !!result,
            targetId: result && result.targetId || '',
            occurrenceKey: result && result.occurrenceKey || '',
            hasMeaning: !!(result && String(result.meaning || '').trim()),
            hasMemoryHint: !!(result && String(result.memoryHint || '').trim()),
            indexedItemCount: typeof store.getItems === 'function' ? store.getItems().length : 0
        });
        emitAnnotationDiagnostics('app.generated_click_resolved', {
            scope: getAnnotationGenerationScope(),
            wordIndex,
            hit: !!result,
            indexedScopeKey,
            generatedItemCount: typeof store.getItems === 'function' ? store.getItems().length : 0,
            occurrenceKey: result && result.occurrenceKey || ''
        });
        return result;
    }

    function resolveAnnotationBubbleForSpan(span) {
        const wordIndex = Number(span && span.dataset ? span.dataset.wordIndex : NaN);
        if (!Number.isFinite(wordIndex) || wordIndex < 0) return null;
        const generated = resolveGeneratedAnnotationBubbleForSpan(span, wordIndex);
        if (generated) return generated;
        if (!markedMap.has(wordIndex)) return null;
        const match = vocabMatchMap.get(wordIndex);
        if (!match) return null;
        return normalizeAnnotationBubbleHit(match, wordIndex, span);
    }

    function notifyAnnotationBubbleWordClick(span, options = {}) {
        const bubble = getAnnotationBubble();
        if (!bubble) {
            emitAnnotationDiagnostics('app.generated_bubble_click_skipped', {
                scope: getAnnotationGenerationScope(),
                reason: 'bubble-missing'
            });
            return false;
        }
        const annotation = resolveAnnotationBubbleForSpan(span);
        const bubbleVisible = typeof bubble.isVisible === 'function' ? bubble.isVisible() : false;
        emitAnnotationDiagnostics('app.generated_bubble_annotation', {
            scope: getAnnotationGenerationScope(),
            wordIndex: Number(span && span.dataset ? span.dataset.wordIndex : NaN),
            hit: !!annotation,
            occurrenceKey: annotation && annotation.occurrenceKey || '',
            bubbleVisible,
            hasMeaning: !!(annotation && String(annotation.meaning || '').trim()),
            hasMemoryHint: !!(annotation && String(annotation.memoryHint || '').trim())
        });
        if (annotation && typeof bubble.setAnnotation === 'function') {
            bubble.setAnnotation(annotation);
            if ((!bubbleVisible || options.forceShow) && typeof bubble.show === 'function') {
                bubble.show();
            }
            return true;
        }
        if (typeof bubble.clearAnnotation === 'function') {
            bubble.clearAnnotation();
        }
        if (typeof bubble.hide === 'function') {
            bubble.hide();
        }
        return false;
    }

    transcriptContainer.addEventListener('click', (event) => {
        const span = event.target && event.target.closest ? event.target.closest('span[data-word-start]') : null;
        if (!span || !transcriptContainer.contains(span)) return;
        const start = Number(span.dataset.wordStart);
        if (!Number.isFinite(start)) return;
        if (_ch.isChunkMode && hasActiveTextSelectionWithinChunk()) return;
        audioPlayer.currentTime = start;
        forceUpdateUI(start);
        if (_ch.isChunkMode) {
            try { selectSentenceFromChunkTarget(span); } catch (err) {}
        }
        notifyAnnotationBubbleWordClick(span);
    }, true);

    function selectSentenceFromChunkTarget(target) {
        return _snApi.selectSentenceFromChunkTarget(target);
    }

    function hasActiveTextSelectionWithinChunk() {
        return _snApi.hasActiveTextSelectionWithinChunk();
    }

    // === UI toggles + sentence notebook view layer ===
    function toggleSidebar() {
        document.body.classList.toggle('sidebar-open');
        if (toggleSidebarBtn) {
            toggleSidebarBtn.classList.toggle('active', document.body.classList.contains('sidebar-open'));
        }
        setTimeout(() => window.dispatchEvent(new Event('resize')), 300);
    }

    function applyNotePreviewWidth() {
        return _snApi.applyNotePreviewSize();
    }

    // Sentence notebook: item metadata + save feedback
    function formatSentenceNoteItemMeta(item, itemId, isEditing = false) {
        return _snApi.formatSentenceNoteItemMeta(item, itemId, isEditing);
    }

    function triggerSentenceNoteSavedFeedback(itemId = '') {
        return _snApi.triggerSentenceNoteSavedFeedback(itemId);
    }

    // Sentence notebook: draft/commit/persist core
    function findSentenceNoteItem(sentenceId, itemId) {
        return _snApi.findSentenceNoteItem(sentenceId, itemId);
    }

    function discardSentenceNoteDraft(shouldRender = true) {
        return _snApi.discardSentenceNoteDraft(shouldRender);
    }

    function commitSentenceNoteDraft(shouldRender = true) {
        return _snApi.commitSentenceNoteDraft(shouldRender);
    }

    function persistSentenceNoteItem(sentenceId, itemId, shouldRender = true) {
        return _snApi.persistSentenceNoteItem(sentenceId, itemId, shouldRender);
    }

    function persistSelectedSentenceNote() {
        return _snApi.persistSelectedSentenceNote();
    }

    // Sentence notebook: rendering + interaction wiring
    function buildSentenceNoteItemElement(sentenceId, item, { isDraft = false } = {}) {
        return _snApi.buildSentenceNoteItemElement(sentenceId, item, { isDraft });
    }

    function renderNotePreviewSidebar() {
        return _snApi.renderNotePreviewSidebar();
    }

    function showNotePreviewEmptyState(message) {
        return _snApi.showNotePreviewEmptyState(message);
    }

    // Sentence notebook: panel visibility + sentence selection
    function toggleNotePreviewSidebar(forceState = null) {
        return _snApi.toggleNotePreviewSidebar(forceState);
    }

    function setSelectedSentence(nextSentence) {
        return _snApi.setSelectedSentence(nextSentence);
    }

    function updateSentenceFocusPhrase(sentence, focusPhrase) {
        return _snApi.updateSentenceFocusPhrase(sentence, focusPhrase);
    }

    // Sentence notebook: selection capture + import/export integration
    function getSelectionChunkSentence() {
        return _snApi.getSelectionChunkSentence();
    }

    function maybeCaptureSentenceFocusPhrase() {
        return _snApi.maybeCaptureSentenceFocusPhrase();
    }

    function applyImportedSentenceNotesSnapshot(data) {
        return _snApi.applyImportedSentenceNotesSnapshot(data);
    }

    function initNotePreviewResize() {
        return _snApi.initNotePreviewResize();
    }

    function toggleChunkMode(forceState = null) {
        if (!_ch.chunkItems || _ch.chunkItems.length === 0 || !_ch.hasAiChunkData) {
            chunkFileInput.click(); 
            return;
        }

        const newState = forceState !== null ? forceState : !_ch.isChunkMode;
        if (newState === _ch.isChunkMode) return;
        
        // Scroll Anchoring
        let anchorRatio = 0;
        const container = document.getElementById('main-app-area');
        let anchorEl = null;
        if (_ch.isChunkMode) {
             anchorEl = document.querySelector('.chunk-active') || document.querySelector('.chunk-block');
        } else {
             anchorEl = document.querySelector('.sentence-active') || document.querySelector('.transcript-line');
        }

        if (anchorEl) {
            const rect = anchorEl.getBoundingClientRect();
            const containerRect = container.getBoundingClientRect();
            anchorRatio = (rect.top - containerRect.top);
        }

        _ch.isChunkMode = newState;
        if (!_ch.isChunkMode) {
            _ch.lastAiPrevTapChunkIndex = -1;
            _ch.lastAiPrevTapAt = 0;
        }
        localStorage.setItem('isChunkMode', _ch.isChunkMode);
        toggleChunkBtn.classList.toggle('active', _ch.isChunkMode);
        updateHighlightModeUI();
        closeChunkNoteContextMenu();
        closeChunkNotePopover();
        
        if (_ch.isChunkMode) {
            renderChunkMode();
        } else {
            renderTranscript();
            document.querySelectorAll('.chunk-note-tag').forEach(el => el.remove());
            clearChunkNoteConnectors();
        }
        updateChunkFocusModeUI();
        
        requestAnimationFrame(() => {
            updateChunkFocusModeUI();
            forceUpdateUI(audioPlayer.currentTime);
            
            let newAnchor = null;
             if (_ch.isChunkMode) {
                 newAnchor = document.querySelector('.chunk-active');
            } else {
                 newAnchor = document.querySelector('.sentence-active');
            }
            
            if (newAnchor) {
                 const rect = newAnchor.getBoundingClientRect();
                 const currentTop = rect.top - container.getBoundingClientRect().top;
                 container.scrollTop += (currentTop - anchorRatio);
            }
        });
    }

    function setChunkCnVisible(value, persist=true) {
        if (!_ch.isChunkMode) return;
        _ch.chunkCnVisible = !!value;
        if (persist) localStorage.setItem('st.chunkCnVisible', String(_ch.chunkCnVisible));
        const els = document.querySelectorAll('.chunk-cn');
        els.forEach(el => {
            if (_ch.chunkCnVisible) el.classList.remove('hidden-cn');
            else el.classList.add('hidden-cn');
        });
        bridgeToPinia();
    }

    function toggleChunkCn() {
        if (!_ch.isChunkMode) return;
        setChunkCnVisible(!_ch.chunkCnVisible, true);
    }

    function updateChunkCnHoldBtn() {
        const btn = document.getElementById('btn-chunk-cn-hold');
        if (!btn) return;
        btn.classList.toggle('active', _ch.chunkCnHoldMode);
        btn.innerText = _ch.chunkCnHoldMode ? '按住' : '持续';
        bridgeToPinia();
    }

    function toggleChunkCnHoldMode() {
        _ch.chunkCnHoldMode = !_ch.chunkCnHoldMode;
        localStorage.setItem('st.chunkCnHoldMode', String(_ch.chunkCnHoldMode));
        updateChunkCnHoldBtn();
    }

    function beginHoldChunkCn() {
        if (!_ch.isChunkMode) return;
        if (_ch.isHoldingChunkCn) return;
        _ch.isHoldingChunkCn = true;
        _ch.holdPrevChunkCnVisible = _ch.chunkCnVisible;
        const container = document.getElementById('transcript-container');
        holdPrevHadFocusClass = container.classList.contains('cn-mode-focus');
        // 涓存椂寮哄埗鑱氱劍锛屽彧鏄剧ず褰撳墠鍙ュ潡鐨勪腑鏂?
        if (!holdPrevHadFocusClass) container.classList.add('cn-mode-focus');
        // 涓存椂鏄剧ず涓枃锛堜笉鍐欏叆鏈湴瀛樺偍锛?
        if (!_ch.chunkCnVisible) setChunkCnVisible(true, false);
    }

    function endHoldChunkCn() {
        if (!_ch.isChunkMode) return;
        if (!_ch.isHoldingChunkCn) return;
        _ch.isHoldingChunkCn = false;
        const container = document.getElementById('transcript-container');
        if (holdPrevHadFocusClass === false) container.classList.remove('cn-mode-focus');
        if (_ch.holdPrevChunkCnVisible === false) setChunkCnVisible(false, false);
        _ch.holdPrevChunkCnVisible = null;
        holdPrevHadFocusClass = null;
        bridgeToPinia();
    }

    // Toggle Focus Mode

    function updateChunkFocusModeUI() {
        const btn = document.getElementById('btn-chunk-focus');
        const legacyContainer = document.getElementById('transcript-container');
        const vueContainer = document.getElementById('chunk-vue-container');
        const isFocus = _ch.chunkCnMode === 'focus';
        if (btn) {
            btn.innerText = isFocus ? '聚焦' : '全局';
            btn.classList.toggle('active', isFocus);
        }
        if (legacyContainer) legacyContainer.classList.toggle('cn-mode-focus', isFocus);
        if (vueContainer) vueContainer.classList.toggle('cn-mode-focus', isFocus);
        bridgeToPinia();
    }

    function toggleChunkFocusMode() {
        if (!_ch.isChunkMode) return;
        _ch.chunkCnMode = _ch.chunkCnMode === 'global' ? 'focus' : 'global';
        localStorage.setItem('st.chunkCnMode', _ch.chunkCnMode);
        updateChunkFocusModeUI();
    }

    // Shadow Toggle Logic
    function toggleChunkShadow() {
        _ch.isChunkShadowOn = !_ch.isChunkShadowOn;
        localStorage.setItem('isChunkShadowOn', _ch.isChunkShadowOn);
        
        if (_ch.isChunkShadowOn) {
            document.body.classList.remove('hide-chunk-shadow');
        } else {
            document.body.classList.add('hide-chunk-shadow');
        }
        updateShadowBtnText();
    }
    
    function updateShadowBtnText() {
        const btn = document.getElementById('btn-toggle-shadow-manual');
        if(btn) btn.innerText = _ch.isChunkShadowOn ? "开关 S" : "开关 S";
    }
    
    function toggleChunkShadowManual() {
        toggleChunkShadow();
    }

    function updateVisualHelper(target) {
        if (!target) return;

        document.getElementById('placeholder').style.display = 'none';
        document.getElementById('info-card').style.display = 'flex'; 

        const wordEl = document.getElementById('show-word');
        const ctxEl  = document.getElementById('show-context');
        const wordTxt = (target.word || '').trim();
        const ctxTxt  = (target.match_context || '').trim();
        wordEl.innerText = wordTxt;
        if (!ctxTxt || ctxTxt === wordTxt) {
            ctxEl.innerText = '';
            ctxEl.hidden = true;
        } else {
            ctxEl.innerText = ctxTxt;
            ctxEl.hidden = false;
        }
        document.getElementById('show-meaning').innerText = target.meaning;
        document.getElementById('show-not').innerText = target.not_meaning || ""; 

        const sceneList = document.getElementById('scene-list');
        sceneList.innerHTML = ''; 

        if (target.visual_scenes && target.visual_scenes.length > 0) {
            target.visual_scenes.forEach((scene, index) => {
                const btn = document.createElement('div');
                btn.className = 'scene-btn';
                btn.innerText = scene.desc; 
                
                btn.onclick = function() {
                    document.querySelectorAll('.scene-btn').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    activateSearch(target.word, index, scene.query);
                };
                sceneList.appendChild(btn);
            });
            sceneList.firstChild.click();
        }
    }

    function activateSearch(word, sceneIndex, query) {
        const safeKey = word.replace(/[^a-zA-Z0-9]/g, '_') + '_' + sceneIndex;
        const pool = document.getElementById('search-pool');
        Array.from(pool.children).forEach(child => child.style.display = 'none');

        let targetDiv = document.getElementById('wrapper_' + safeKey);

        if (targetDiv) {
            targetDiv.style.display = 'block';
        } else {
            targetDiv = document.createElement('div');
            targetDiv.id = 'wrapper_' + safeKey;
            targetDiv.className = 'search-instance';
            targetDiv.style.display = 'block';
            pool.appendChild(targetDiv);

            if (window.google && google.search && google.search.cse && google.search.cse.element) {
                google.search.cse.element.render({
                    div: targetDiv.id,
                    tag: 'searchresults-only',
                    gname: safeKey, 
                    attributes: { defaultToImageSearch: "true", disableWebSearch: "true" }
                });
                
                var element = google.search.cse.element.getElement(safeKey);
                if (element) element.execute(query);
            }
        }
    }

    function cycleHighlightMode() {
        _tr.highlightMode = (_tr.highlightMode + 1) % 3;
        lastActiveSegIndex = -1; 
        updateHighlightModeUI();
        forceUpdateUI(audioPlayer.currentTime);
    }

    function updateHighlightModeUI() {
        const txt = ['高亮:关', '高亮:词', '高亮:句'][_tr.highlightMode];
        if (!highlightModeBtn) return;
        highlightModeBtn.textContent = txt;
        highlightModeBtn.classList.toggle('active', _tr.highlightMode !== 0);
        document.body.classList.toggle('highlight-sentence-mode', _tr.highlightMode === 2 && !_ch.isChunkMode);
    }
    updateHighlightModeUI();

    function findChunkIndexByTime(t) {
        return findChunkIndexByTimeHelper(_ch.chunkItems, t);
    }

    function swapActiveClass(nextEl, prevEl, className) {
        if (prevEl && prevEl !== nextEl) prevEl.classList.remove(className);
        if (nextEl && nextEl !== prevEl) nextEl.classList.add(className);
        return nextEl || null;
    }

    function followPlaybackTarget(el) {
        if (!el || !autoFollow || userScrollSuppress) return;
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
        audioPlayer: audioPlayer,
        getCurrentSegmentIndexHelper: getCurrentSegmentIndexHelper,
        getSegmentCheckpointsHelper: getSegmentCheckpointsHelper,
        bsFindActiveHelper: bsFindActiveHelper,
        findChunkIndexByTime: findChunkIndexByTime,
        swapActiveClass: swapActiveClass,
        followPlaybackTarget: followPlaybackTarget,
        getAnnotationBubble: getAnnotationBubble,
        jumpPrevSentence: jumpPrevSentence,
        jumpNextSentence: jumpNextSentence
    });

    // Re-bind local references to functions now in playback-module
    var forceUpdateUI = window.forceUpdateUI;
    var mainUpdateHighlight = window.mainUpdateHighlight;
    var toggleAnnotationBubble = window.toggleAnnotationBubble;
    var handleBackwardClick = window.handleBackwardClick;
    var handleForwardClick = window.handleForwardClick;

    // [MIGRATED] keyboard + event handlers → src/composables/keyboard-module.js
    window.__keyboardModule.init({
        audioPlayer: audioPlayer,
        isChunkMode: function () { return _ch.isChunkMode; },
        chunkCnHoldMode: function () { return _ch.chunkCnHoldMode; },
        chunkNoteVisible: function () { return _ns.chunkNoteVisible; },
        markKey: markKey, notesKey: notesKey, annotationBubbleKey: annotationBubbleKey,
        chunkCnKey: chunkCnKey, chunkShadowKey: chunkShadowKey, chunkNoteKey: chunkNoteKey,
        backwardKey: backwardKey, forwardKey: forwardKey,
        toggleMarkCurrent: toggleMarkCurrent,
        toggleCurrentNote: toggleCurrentNote,
        toggleAnnotationBubble: toggleAnnotationBubble,
        beginHoldChunkCn: beginHoldChunkCn, endHoldChunkCn: endHoldChunkCn,
        toggleChunkCn: toggleChunkCn, toggleChunkShadow: toggleChunkShadow,
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
        chunkNoteExportDialogEl: chunkNoteExportDialogEl,
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
        } else if (lastActiveSegIndex !== -1) {
            targetIdx = lastActiveSegIndex;
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
            if (lastSentencePrevTapSegIndex === sIdx && (now - lastSentencePrevTapAt) <= 600) {
                targetTime = sIdx > 0 ? _tr.segments[sIdx - 1].start : _tr.segments[sIdx].start;
                lastSentencePrevTapSegIndex = -1; lastSentencePrevTapAt = 0;
            } else {
                targetTime = _tr.segments[sIdx].start;
                lastSentencePrevTapSegIndex = sIdx; lastSentencePrevTapAt = now;
            }
        } else { lastSentencePrevTapSegIndex = -1; lastSentencePrevTapAt = 0; }
        audioPlayer.currentTime = targetTime;
        forceUpdateUI(targetTime);
    }

    function jumpNextSentence() {
        var cur = audioPlayer.currentTime;
        var sIdx = getCurrentSegmentIndexHelper(_tr.segments, _tr.words, _tr.wordStarts, cur);
        var next = (sIdx >= 0 && sIdx < _tr.segments.length - 1) ? _tr.segments[sIdx + 1] : null;
        lastSentencePrevTapSegIndex = -1; lastSentencePrevTapAt = 0;
        if (next && Number.isFinite(next.start)) {
            audioPlayer.currentTime = next.start;
            forceUpdateUI(next.start);
        }
    }

    // [MIGRATED] mark ops → window.__marksStore
    function syncMarkedWordVisual(globalIndex, isMarked) {
        window.__marksStore.syncMarkedWordVisual(globalIndex, isMarked);
    }

    function toggleMarkCurrent() {
        window.__marksStore.toggleMark(markedMap, _tr.currentWordIndex, _tr.words, saveToDB, syncAnnotationGenerationEntryStatus);
    }

    // Highlight colors + hotkey bindings → keyboard-module

    function applyImportedChunkNotes(data) {
        return _cnApi.applyImportedChunkNotes(data);
    }

    if (importChunkNotesBtn && importChunkNotesInput) {
        importChunkNotesBtn.addEventListener('click', () => importChunkNotesInput.click());
        importChunkNotesInput.addEventListener('change', e => {
            const f = getFirstFileFromEvent(e);
            if (!f) return;
            readFileAsText(f, (rawText) => {
                try {
                    const data = JSON.parse(rawText);
                    applyImportedChunkNotes(data);
                    saveChunkNotesNow();
                    if (_ch.hasAiChunkData) {
                        if (!_ch.isChunkMode) toggleChunkMode(true);
                        setChunkNoteVisible(true, true);
                        renderChunkMode();
                    }
                    showToast('Chunk notes imported', 'success');
                } catch (err) {
                    showError('CHUNK_NOTE_IMPORT', err && err.message ? err.message : 'Invalid notes json');
                }
            });
            e.target.value = '';
        });
    }

    if (exportChunkNotesBtn) {
        exportChunkNotesBtn.addEventListener('click', async () => {
            const snapshot = buildChunkNotesSnapshot();
            const filenameBase = getCurrentAudioFilenameBase('audio');
            const suggestedName = `${filenameBase}_chunk_notes.json`;
            const fileState = _cnApi.getChunkNotesFileState();
            const sameAudioHandle = !!fileState.handle && (fileState.audioKey === (currentAudioKey || 'default-audio'));
            try {
                if (!sameAudioHandle) {
                    await saveChunkNotesAs(snapshot, suggestedName);
                    showToast('Chunk notes saved', 'success');
                    return;
                }
                openChunkNotesExportConfirmDialog(
                    fileState.fileName || suggestedName,
                    async () => {
                        await saveChunkNotesAs(snapshot, suggestedName);
                        showToast('Chunk notes saved as new file', 'success');
                    },
                    async () => {
                        const currentFileState = _cnApi.getChunkNotesFileState();
                        if (!currentFileState.handle) {
                            await saveChunkNotesAs(snapshot, suggestedName);
                        } else {
                            await writeChunkNotesToHandle(currentFileState.handle, snapshot);
                        }
                        showToast('Chunk notes overwritten', 'success');
                    }
                );
            } catch (err) {
                if (err && err.name === 'AbortError') return;
                showError('CHUNK_NOTE_EXPORT', err && err.message ? err.message : 'Export failed');
            }
        });
    }

    importMarksBtn.addEventListener('click', () => importMarksInput.click());

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

    // Annotation prompt handlers → controls-module
    
    importMarksInput.addEventListener('change', e => {
        const f = getFirstFileFromEvent(e);
        if(!f) return;
        readFileAsText(f, (rawText) => {
            try {
                const arr = validateMarksArray(JSON.parse(rawText), _tr.words.length);
                markedMap.clear();
                arr.forEach(mark => {
                    if (mark.globalIndex < _tr.words.length) {
                        markedMap.set(mark.globalIndex, {
                            ...mark,
                            sourceType: String(mark.sourceType || mark.source || 'marks-json')
                        });
                    }
                });
                saveToDB('marks', Array.from(markedMap.values())); 
                if(_ch.isChunkMode) renderChunkMode(); else renderTranscript();
                forceUpdateUI(audioPlayer.currentTime);
                syncAnnotationGenerationEntryStatus();
                showToast('Marks imported', 'success');
            } catch(x){ showError('MARKS_IMPORT', x && x.message ? x.message : 'Invalid marks file'); }
        });
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
        audioPlayer: audioPlayer,
        bsFindActiveHelper: bsFindActiveHelper,
        findChunkIndexByTime: findChunkIndexByTime,
        getCurrentSegmentIndexHelper: getCurrentSegmentIndexHelper,
        toggleFollowBtn: toggleFollowBtn,
        mainAppArea: mainAppArea
    });

    // [MIGRATED] glass effects → src/composables/glass-effects.js
    (function () {
      function lockChunkNoteDimensions() {
        _cnApi.listChunkNotes().forEach(function (note) {
          if (!note || !note.id) return;
          var tag = getChunkNoteTagById(note.id);
          if (tag) {
            var contentBox = getChunkNoteContentBoxSize(tag);
            var w = Math.max(40, Math.round(contentBox && Number.isFinite(contentBox.width) ? contentBox.width : 0));
            var h = Math.max(18, Math.round(contentBox && Number.isFinite(contentBox.height) ? contentBox.height : 0));
            note.w = w;
            note.h = h;
          }
          if (Number.isFinite(Number(note.w)) && Number.isFinite(Number(note.h))) {
            note.autoSize = false;
          }
        });
      }
      window.__glassEffects.init(lockChunkNoteDimensions);
    })();
  
    // Init hold button label
  
    // Init hold button label
    setTimeout(()=>{ try{updateChunkCnHoldBtn();}catch(e){} }, 0);

    // === ES Module exports for HTML onclick + cross-module access ===
    window.handleBackwardClick = handleBackwardClick;
    window.handleForwardClick = handleForwardClick;
    window.changeSpeed = changeSpeed;
    window.cycleHighlightMode = cycleHighlightMode;
    window.toggleChunkMode = toggleChunkMode;
    window.toggleChunkFocusMode = toggleChunkFocusMode;
    window.openChunkStyleModal = openChunkStyleModal;
    window.closeChunkStyleModal = closeChunkStyleModal;
    window.openChunkNoteStyleModal = openChunkNoteStyleModal;
    window.closeChunkNoteStyleModal = closeChunkNoteStyleModal;
    window.toggleChunkShadowManual = toggleChunkShadowManual;
    window.updateChunkStyle = updateChunkStyle;
    window.updateChunkNoteStyle = updateChunkNoteStyle;
    window.toggleChunkBtn = toggleChunkBtn;
    window.forceUpdateUI = forceUpdateUI;
    window.mainUpdateHighlight = mainUpdateHighlight;
    window.initDB = initDB; window.saveToDB = saveToDB; window.loadFromDB = loadFromDB;
    window.deleteFromDB = deleteFromDB; window.clearDBStore = clearDBStore;
    window.showToast = showToast; window.showError = showError;
    window.bridgeToPinia = bridgeToPinia;
    window.renderTranscript = renderTranscript; window.renderChunkMode = renderChunkMode;
    window.processTranscript = processTranscript;
    window.selectSentenceFromChunkTarget = selectSentenceFromChunkTarget;
    window.openChunkNoteContextFromEvent = openChunkNoteContextFromEvent;
    window.notifyAnnotationBubbleWordClick = notifyAnnotationBubbleWordClick;
    window.isInputLikeTarget = isInputLikeTarget;
    window.adjustChunkNoteArrowSizeByGap = adjustChunkNoteArrowSizeByGap;
    window.getAnnotationGenerationScope = getAnnotationGenerationScope;
    window.buildCurrentSentenceDocId = buildCurrentSentenceDocId;
    window.clearGeneratedAnnotationIndex = clearGeneratedAnnotationIndex;
    window.loadChunkNotesForCurrentAudio = loadChunkNotesForCurrentAudio;
    window.setChunkNoteVisible = setChunkNoteVisible;
    window.loadSentenceNotesForCurrentAudio = loadSentenceNotesForCurrentAudio;
    window.switchSentenceNotesDoc = switchSentenceNotesDoc;
    window.applyCurrentAudioMeta = applyCurrentAudioMeta;
    window.clearPersistedChunkSession = clearPersistedChunkSession;
    window.emitAnnotationDiagnostics = emitAnnotationDiagnostics;
    window.scheduleGeneratedAnnotationIndexRefresh = scheduleGeneratedAnnotationIndexRefresh;
    window.syncAnnotationGenerationEntryStatus = syncAnnotationGenerationEntryStatus;
    window.initAnnotationApiSettingsUi = initAnnotationApiSettingsUi;
    window.processChunkData = processChunkData;
    window.updateChunkCnHoldBtn = updateChunkCnHoldBtn;
