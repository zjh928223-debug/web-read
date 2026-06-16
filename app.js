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

    // === Read-order map ===
    // 1) Data layer: validation, identity, storage keys, persistence helpers
    // 2) UI layer: DOM bindings, runtime state, startup wiring
    // 3) Feature layer: import handlers, matching, rendering, interactions
    // 4) Input layer: keyboard/mouse/global listeners (kept behavior-intact)

    // [MIGRATED] DB schema constants → window.__audioStore

    // Phase 4: Vue rendering toggle (false = old path, true = new Vue path)
    window.__USE_VUE_RENDERING = true;

    // Phase 8: Bridge — app.js data → Pinia stores (init: write __bridge; runtime: write Pinia directly)
    window.__bridge = { transcript: null, chunkItems: null, clozeItems: null };
    function bridgeToPinia() {
        var ps = window.__piniaStores;
        var b = window.__bridge;
        // Always write to bridge (for main.js init consumption)
        if (b) {
            b.transcript = { segments: segments, words: words, wordStarts: wordStarts, highlightMode: highlightMode };
            b.chunkItems = chunkItems; b.isChunkMode = isChunkMode; b.hasAiChunkData = hasAiChunkData;
            b.chunkCNVisible = chunkCnVisible; b.chunkCNHoldMode = chunkCnHoldMode;
            b.chunkFocusMode = chunkCnMode === 'focus'; b.chunkShadowVisible = isChunkShadowOn;
            b.clozeItems = clozeItems; b.hasClozeData = hasClozeData; b.clozeAnswerState = clozeAnswerState;
        }
        // If Pinia already exists, write directly for reactive updates
        if (ps) {
            if (ps.transcript) {
                ps.transcript.segments = segments; ps.transcript.words = words;
                ps.transcript.wordStarts = wordStarts; ps.transcript.highlightMode = highlightMode;
            }
            if (ps.chunk) {
                ps.chunk.chunkItems = chunkItems; ps.chunk.isChunkMode = isChunkMode; ps.chunk.hasAiChunkData = hasAiChunkData;
                ps.chunk.chunkCNVisible = chunkCnVisible; ps.chunk.chunkCNHoldMode = chunkCnHoldMode;
                ps.chunk.chunkFocusMode = chunkCnMode === 'focus'; ps.chunk.chunkShadowVisible = isChunkShadowOn;
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
    const validateTranscriptData = (json) => window.DataUtils.validateTranscriptData(json, segments);
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
    const buildTranscriptKey = (data) => window.IdentityStorageKeys.buildTranscriptKey(data, segments);
    const getChunkNotesStorageKey = () => window.IdentityStorageKeys.getChunkNotesStorageKey(currentAudioKey);
    const getChunkNoteDraftStorageKey = () => window.IdentityStorageKeys.getChunkNoteDraftStorageKey(currentAudioKey);
    const getSentenceNotesStorageKey = window.IdentityStorageKeys.getSentenceNotesStorageKey;
    const getLegacySentenceNotesStorageKey = (audioKey = currentAudioKey) => window.IdentityStorageKeys.getLegacySentenceNotesStorageKey(audioKey);
    const buildCurrentSentenceDocId = (transcriptSource = null) => window.IdentityStorageKeys.buildCurrentSentenceDocId(transcriptSource, currentAudioKey, segments);

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
        chunkNoteDraftRestoreDone = nextAudioState.chunkNoteDraftRestoreDone;
    }

    function isInputLikeTarget(target) {
        const tagName = target && target.tagName ? target.tagName : '';
        if (tagName === 'TEXTAREA') return true;
        if (tagName !== 'INPUT') return false;
        const inputType = String(target.type || '').toLowerCase();
        return !['file', 'color', 'button', 'checkbox', 'radio', 'range'].includes(inputType);
    }

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
        if (chunkNoteDeleteDialogEl) {
            chunkNoteDeleteDialogEl.remove();
            chunkNoteDeleteDialogEl = null;
        }
    }

    function openChunkNoteDeleteDialog(noteId) {
        const note = _cnApi.getChunkNote(noteId);
        const tag = getChunkNoteTagById(String(noteId || ''));
        if (!note || !tag) return;
        closeChunkNoteDeleteDialog();
        const dialog = document.createElement('div');
        dialog.className = 'chunk-note-delete-dialog';
        dialog.innerHTML = `
          <div class="chunk-note-delete-title">确认删除这个备注？</div>
          <div class="chunk-note-delete-actions">
            <button type="button" class="chunk-note-delete-btn danger">删除</button>
            <button type="button" class="chunk-note-delete-btn">取消</button>
          </div>
        `;
        document.body.appendChild(dialog);
        chunkNoteDeleteDialogEl = dialog;
        const rect = tag.getBoundingClientRect();
        dialog.style.left = `${Math.max(12, Math.min(window.innerWidth - 240, rect.left))}px`;
        dialog.style.top = `${Math.max(12, rect.bottom + 10)}px`;
        const title = dialog.querySelector('.chunk-note-delete-title');
        if (title) {
            title.addEventListener('mousedown', (e) => {
                e.preventDefault();
                const sx = e.clientX;
                const sy = e.clientY;
                const dl = parseFloat(dialog.style.left) || 0;
                const dt = parseFloat(dialog.style.top) || 0;
                const move = (ev) => {
                    dialog.style.left = `${dl + ev.clientX - sx}px`;
                    dialog.style.top = `${dt + ev.clientY - sy}px`;
                };
                const up = () => {
                    document.removeEventListener('mousemove', move);
                    document.removeEventListener('mouseup', up);
                };
                document.addEventListener('mousemove', move);
                document.addEventListener('mouseup', up);
            });
        }
        const [delBtn, cancelBtn] = dialog.querySelectorAll('.chunk-note-delete-btn');
        if (delBtn) delBtn.addEventListener('click', () => {
            _cnApi.deleteChunkNote(note.id);
            closeChunkNoteDeleteDialog();
            setSelectedChunkNote('');
            saveChunkNotesDebounced();
            refreshChunkNoteForChunkRef(note.chunkRef);
        });
        if (cancelBtn) cancelBtn.addEventListener('click', () => {
            closeChunkNoteDeleteDialog();
        });
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
        if (chunkNoteSvgLayer) chunkNoteSvgLayer.innerHTML = '';
    }

    function getChunkWordSpan(note) {
        if (!note || !note.chunkRef || !Number.isFinite(Number(note.startGlobal))) return null;
        const direct = document.getElementById(`word-${Number(note.startGlobal)}`);
        if (direct && direct.closest && direct.closest('.chunk-block')) return direct;
        const block = getChunkBlockByRef(note.chunkRef);
        if (!block) return null;
        const enDiv = block.querySelector('.chunk-en');
        if (!enDiv) return null;
        return enDiv.querySelector(`#word-${Number(note.startGlobal)}`);
    }

    function getChunkNoteTagById(noteId) {
        return _cnApi.getChunkNoteTagById(noteId);
    }

    function ensureChunkNoteOverlayLayers() {
        if (!mainAppArea) return;
        if (chunkNoteSvgLayer && chunkNoteSvgLayer.parentElement !== mainAppArea) {
            mainAppArea.appendChild(chunkNoteSvgLayer);
        }
        if (!chunkNoteLayer) {
            chunkNoteLayer = document.createElement('div');
            chunkNoteLayer.id = 'chunk-note-layer';
        }
        if (chunkNoteLayer.parentElement !== mainAppArea) {
            mainAppArea.appendChild(chunkNoteLayer);
        }
        if (chunkNoteSvgLayer && chunkNoteLayer && chunkNoteSvgLayer.nextSibling !== chunkNoteLayer) {
            mainAppArea.insertBefore(chunkNoteSvgLayer, chunkNoteLayer);
        }
        syncChunkNoteOverlaySize();
    }

    function rectToMainAreaSpace(rect) {
        if (!mainAppArea) {
            return {
                left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom,
                width: rect.width, height: rect.height
            };
        }
        const mainRect = mainAppArea.getBoundingClientRect();
        return {
            left: rect.left - mainRect.left + mainAppArea.scrollLeft,
            top: rect.top - mainRect.top + mainAppArea.scrollTop,
            right: rect.right - mainRect.left + mainAppArea.scrollLeft,
            bottom: rect.bottom - mainRect.top + mainAppArea.scrollTop,
            width: rect.width,
            height: rect.height
        };
    }

    function pointToMainAreaSpace(clientX, clientY) {
        if (!mainAppArea) return { x: clientX, y: clientY };
        const mainRect = mainAppArea.getBoundingClientRect();
        return {
            x: clientX - mainRect.left + mainAppArea.scrollLeft,
            y: clientY - mainRect.top + mainAppArea.scrollTop
        };
    }

    function syncChunkNoteOverlaySize() {
        if (!mainAppArea) return;
        const w = Math.max(mainAppArea.clientWidth, mainAppArea.scrollWidth);
        const h = Math.max(mainAppArea.clientHeight, mainAppArea.scrollHeight);
        if (chunkNoteLayer) {
            chunkNoteLayer.style.width = `${w}px`;
            chunkNoteLayer.style.height = `${h}px`;
        }
        if (chunkNoteSvgLayer) {
            chunkNoteSvgLayer.style.width = `${w}px`;
            chunkNoteSvgLayer.style.height = `${h}px`;
            chunkNoteSvgLayer.setAttribute('width', String(w));
            chunkNoteSvgLayer.setAttribute('height', String(h));
        }
    }

    function clearChunkNoteDraft() {
        return _cnApi.clearChunkNoteDraft();
    }

    function persistChunkNoteDraft(immediate = false) {
        if (!notePopoverCtx || !chunkNoteModalInputEl) return;
        const modalRect = chunkNoteModalEl ? chunkNoteModalEl.getBoundingClientRect() : null;
        return _cnApi.persistChunkNoteDraft(notePopoverCtx, chunkNoteModalInputEl.value || '', modalRect, immediate);
    }

    function getRangeAnchorRectByGlobals(chunkRef, startGlobal, endGlobal) {
        const startSpan = document.getElementById(`word-${startGlobal}`);
        const endSpan = document.getElementById(`word-${endGlobal}`);
        if (!startSpan || !endSpan) return null;
        const a = startSpan.getBoundingClientRect();
        const b = endSpan.getBoundingClientRect();
        const left = Math.min(a.left, b.left);
        const top = Math.min(a.top, b.top);
        const right = Math.max(a.right, b.right);
        const bottom = Math.max(a.bottom, b.bottom);
        return {
            left, top, right, bottom,
            width: Math.max(0, right - left),
            height: Math.max(0, bottom - top)
        };
    }

    function tryRestoreChunkNoteDraft() {
        if (chunkNoteDraftRestoreDone) return;
        if (!isChunkMode || !hasAiChunkData) return;
        chunkNoteDraftRestoreDone = true;
        const parsed = _cnApi.readChunkNoteDraft();
        if (!parsed || typeof parsed !== 'object' || !parsed.ctx) return;
        const ctxRaw = parsed.ctx || {};
        const chunkRef = String(ctxRaw.chunkRef || '');
        let noteId = String(ctxRaw.noteId || '');
        const startGlobal = Number(ctxRaw.startGlobal);
        const endGlobal = Number(ctxRaw.endGlobal);
        if (!chunkRef || !Number.isFinite(startGlobal) || !Number.isFinite(endGlobal)) {
            clearChunkNoteDraft();
            return;
        }
        const anchorRect = getRangeAnchorRectByGlobals(chunkRef, startGlobal, endGlobal);
        if (!anchorRect) return;
        if (!noteId) noteId = makeSelectionNoteBaseId(chunkRef, startGlobal, endGlobal);
        const existing = _cnApi.getChunkNote(noteId);
        const block = getChunkBlockByRef(chunkRef);
        const enDiv = block ? block.querySelector('.chunk-en') : null;
        let selectedText = String(ctxRaw.selectedText || '');
        if (!selectedText && enDiv) {
            const arr = [];
            for (let i = startGlobal; i <= endGlobal; i++) {
                const span = enDiv.querySelector(`#word-${i}`);
                if (span && span.textContent) arr.push(span.textContent.trim());
            }
            selectedText = arr.join(' ').replace(/\s+/g, ' ').trim();
        }
        const ctx = {
            chunkRef,
            noteId,
            chunkIdx: Number(block ? (block.dataset.chunkIdx || -1) : (ctxRaw.chunkIdx || -1)),
            startGlobal,
            endGlobal,
            selectedText,
            initialNote: String(parsed.text || existing?.note || ''),
            noteExists: !!existing,
            anchorRect
        };
        openChunkNotePopover(ctx);
        if (chunkNoteModalInputEl) {
            chunkNoteModalInputEl.value = String(parsed.text || '');
            chunkNoteModalInputEl.focus();
            chunkNoteModalInputEl.setSelectionRange(chunkNoteModalInputEl.value.length, chunkNoteModalInputEl.value.length);
        }
        if (chunkNoteModalEl && parsed.modal && typeof parsed.modal === 'object') {
            const left = Number(parsed.modal.left);
            const top = Number(parsed.modal.top);
            const width = Number(parsed.modal.width);
            const height = Number(parsed.modal.height);
            if (Number.isFinite(left) && Number.isFinite(top)) {
                chunkNoteModalEl.style.left = `${left}px`;
                chunkNoteModalEl.style.top = `${top}px`;
            }
            if (Number.isFinite(width) && width >= 120) chunkNoteModalEl.style.width = `${width}px`;
            if (Number.isFinite(height) && height >= 40) chunkNoteModalEl.style.height = `${height}px`;
        }
    }

    function getChunkNoteLayoutBase() {
        const minW = 40;
        const preferredW = Math.max(minW, parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--chunk-note-width')) || 260);
        const minH = Math.max(18, parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--chunk-note-min-height')) || 18);
        const margin = 12;
        return { minW, preferredW, minH, margin };
    }

    function getChunkNoteContentBoxSize(tag) {
        if (!tag) return null;
        const styles = getComputedStyle(tag);
        const width = parseFloat(styles.width);
        const height = parseFloat(styles.height);
        if (Number.isFinite(width) && Number.isFinite(height)) {
            return { width, height };
        }
        const rect = tag.getBoundingClientRect();
        const paddingX = (parseFloat(styles.paddingLeft) || 0) + (parseFloat(styles.paddingRight) || 0);
        const paddingY = (parseFloat(styles.paddingTop) || 0) + (parseFloat(styles.paddingBottom) || 0);
        const borderX = (parseFloat(styles.borderLeftWidth) || 0) + (parseFloat(styles.borderRightWidth) || 0);
        const borderY = (parseFloat(styles.borderTopWidth) || 0) + (parseFloat(styles.borderBottomWidth) || 0);
        return {
            width: Math.max(0, rect.width - paddingX - borderX),
            height: Math.max(0, rect.height - paddingY - borderY)
        };
    }

    function ensureChunkNoteLayout(note, sourceRect, tagRect = null) {
        const { minW, preferredW, minH, margin } = getChunkNoteLayoutBase();
        const areaW = mainAppArea ? Math.max(mainAppArea.clientWidth, mainAppArea.scrollWidth) : window.innerWidth;
        const areaH = mainAppArea ? Math.max(mainAppArea.clientHeight, mainAppArea.scrollHeight) : window.innerHeight;
        if (Number.isFinite(Number(note.w)) && Number(note.w) < minW) note.w = minW;
        if (Number.isFinite(Number(note.h)) && (Math.abs(Number(note.h) - 44) < 0.1 || Math.abs(Number(note.h) - 40) < 0.1 || Math.abs(Number(note.h) - 36) < 0.1)) {
            note.h = minH;
        }
        if (Number.isFinite(Number(note.h)) && Number(note.h) < minH) note.h = minH;

        const currentW = tagRect && Number.isFinite(tagRect.width) && tagRect.width > 0
            ? tagRect.width
            : (Number.isFinite(Number(note.w)) ? Number(note.w) : Math.min(preferredW, areaW - margin * 2));
        const currentH = tagRect && Number.isFinite(tagRect.height) && tagRect.height > 0
            ? tagRect.height
            : (Number.isFinite(Number(note.h)) ? Number(note.h) : minH);
        if (!Number.isFinite(Number(note.w))) note.w = currentW;
        if (!Number.isFinite(Number(note.h))) note.h = currentH;
        const defaultX = Math.min(areaW - currentW - margin, Math.max(margin, sourceRect.right + 20));
        const defaultY = Math.min(areaH - currentH - margin, Math.max(margin, sourceRect.top - 4));

        if (!Number.isFinite(Number(note.offsetX)) || !Number.isFinite(Number(note.offsetY))) {
            if (Number.isFinite(Number(note.x)) && Number.isFinite(Number(note.y))) {
                if (note.coordSpace !== 'main') {
                    const legacyPos = pointToMainAreaSpace(Number(note.x), Number(note.y));
                    note.x = legacyPos.x;
                    note.y = legacyPos.y;
                }
                note.offsetX = Number(note.x) - sourceRect.left;
                note.offsetY = Number(note.y) - sourceRect.top;
            } else {
                note.offsetX = defaultX - sourceRect.left;
                note.offsetY = defaultY - sourceRect.top;
            }
        }

        const rawX = sourceRect.left + Number(note.offsetX);
        const rawY = sourceRect.top + Number(note.offsetY);
        const nextX = Math.max(margin, Math.min(rawX, areaW - currentW - margin));
        const nextY = Math.max(margin, Math.min(rawY, areaH - currentH - margin));
        note.x = nextX;
        note.y = nextY;
        note.offsetX = nextX - sourceRect.left;
        note.offsetY = nextY - sourceRect.top;
        note.coordSpace = 'main';
    }

    function syncChunkNoteTagToAnchor(note, tag) {
        if (!note || !tag) return;
        const source = getChunkWordSpan(note);
        if (!source) return;
        const sourceRect = rectToMainAreaSpace(source.getBoundingClientRect());
        const tagRect = rectToMainAreaSpace(tag.getBoundingClientRect());
        ensureChunkNoteLayout(note, sourceRect, tagRect);
        tag.style.left = `${note.x}px`;
        tag.style.top = `${note.y}px`;
    }

    function refreshChunkNoteTagPositions() {
        if (!isChunkMode || !_ns.chunkNoteVisible) return;
        ensureChunkNoteOverlayLayers();
        syncChunkNoteOverlaySize();
        _cnApi.listChunkNotes().forEach(note => {
            if (!note || !note.id) return;
            const tag = getChunkNoteTagById(note.id);
            if (!tag) return;
            syncChunkNoteTagToAnchor(note, tag);
        });
    }

    function scheduleChunkNoteLayoutRefresh() {
        if (chunkNoteLayoutRaf) return;
        chunkNoteLayoutRaf = requestAnimationFrame(() => {
            chunkNoteLayoutRaf = 0;
            refreshChunkNoteTagPositions();
            redrawAllChunkNoteConnectors();
        });
    }

    function applyChunkNoteTextStyle(textEl, note, options = {}) {
        if (!textEl) return;
        const tag = textEl.closest('.chunk-note-tag');
        const color = (note && note.color) || getComputedStyle(document.documentElement).getPropertyValue('--chunk-note-color').trim() || '#4b5563';
        textEl.style.color = color;
        if (!tag) return;
        const layout = buildChunkNoteLayout(
            note || { note: textEl.textContent || '' },
            tag.offsetWidth || parseFloat(tag.style.width) || 0,
            tag.offsetHeight || parseFloat(tag.style.height) || 0
        );
        textEl.style.fontSize = `${layout.fontSize}px`;
        textEl.style.lineHeight = `${layout.lineHeight}px`;
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
        if (!tag) return;
        const imgEl = tag.querySelector('.chunk-note-image');
        const textEl = tag.querySelector('.chunk-note-text');
        if (!imgEl || !textEl) return;
        if (tag.classList.contains('editing')) {
            tag.classList.remove('image-mode');
            imgEl.removeAttribute('src');
            return;
        }
        const w = Math.max(1, Math.round(tag.clientWidth || parseFloat(tag.style.width) || 1));
        const h = Math.max(1, Math.round(tag.clientHeight || parseFloat(tag.style.height) || 1));
        const text = String((note && note.note) || textEl.textContent || '').trim();
        if (!text) {
            imgEl.removeAttribute('src');
            tag.classList.remove('image-mode');
            return;
        }

        const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(w * dpr));
        canvas.height = Math.max(1, Math.round(h * dpr));
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.scale(dpr, dpr);
        ctx.clearRect(0, 0, w, h);

        const color = (note && note.color) || getComputedStyle(document.documentElement).getPropertyValue('--chunk-note-color').trim() || '#4b5563';
        const layout = buildChunkNoteLayout(note || { note: text }, w, h);

        ctx.fillStyle = color;
        ctx.textBaseline = 'top';
        ctx.font = `500 ${layout.fontSize}px ${getChunkNoteMeasureFont()}`;
        const maxLines = Math.max(1, Math.floor(layout.maxTextH / layout.lineHeight));
        const drawLines = layout.lines.slice(0, maxLines);
        const hasMore = layout.lines.length > maxLines;
        if (hasMore && drawLines.length > 0) {
            drawLines[drawLines.length - 1] = truncateCanvasLine(ctx, drawLines[drawLines.length - 1], layout.maxTextW);
        }
        const usedH = drawLines.length * layout.lineHeight;
        const startY = Math.max(layout.padY, Math.floor((h - usedH) / 2));
        drawLines.forEach((ln, idx) => {
            ctx.fillText(ln, layout.padX, startY + idx * layout.lineHeight, layout.maxTextW);
        });
        imgEl.src = canvas.toDataURL('image/png');
        tag.classList.add('image-mode');
    }

    function updateChunkNoteTagCompactState(tag) {
        if (!tag) return;
        const w = tag.offsetWidth || parseFloat(tag.style.width) || 0;
        const h = tag.offsetHeight || parseFloat(tag.style.height) || 0;
        tag.classList.toggle('compact', w < 82 || h < 32);
    }

    function makeChunkNoteTagDraggable(tag, note) {
        if (!tag) return;
        tag.addEventListener('mousedown', (e) => {
            if (e.target.closest('.chunk-note-resize-handle')) return;
            if (tag.classList.contains('editing') && !e.target.closest('.chunk-note-drag-handle')) return;
            const sx = e.clientX;
            const sy = e.clientY;
            const sl = parseFloat(tag.style.left) || 0;
            const st = parseFloat(tag.style.top) || 0;
            let dragging = false;
            let lastDx = 0;
            let lastDy = 0;
            let rafId = 0;
            const paintDrag = () => {
                rafId = 0;
                tag.style.transform = `translate3d(${lastDx}px, ${lastDy}px, 0)`;
                scheduleChunkNoteConnectorRedraw();
            };
            const move = (ev) => {
                const dx = ev.clientX - sx;
                const dy = ev.clientY - sy;
                if (!dragging && Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
                dragging = true;
                document.body.style.userSelect = 'none';
                tag.classList.add('dragging');
                lastDx = dx;
                lastDy = dy;
                if (!rafId) rafId = requestAnimationFrame(paintDrag);
            };
            const up = () => {
                document.body.style.userSelect = '';
                document.removeEventListener('mousemove', move);
                document.removeEventListener('mouseup', up);
                if (rafId) {
                    cancelAnimationFrame(rafId);
                    rafId = 0;
                }
                if (dragging) {
                    const nx = sl + lastDx;
                    const ny = st + lastDy;
                    tag.style.transform = '';
                    tag.style.left = `${nx}px`;
                    tag.style.top = `${ny}px`;
                    tag.classList.remove('dragging');
                    updateChunkNoteTagCompactState(tag);
                    note.x = nx;
                    note.y = ny;
                    note.coordSpace = 'main';
                    const source = getChunkWordSpan(note);
                    if (source) {
                        const sr = rectToMainAreaSpace(source.getBoundingClientRect());
                        note.offsetX = nx - sr.left;
                        note.offsetY = ny - sr.top;
                    }
                    scheduleChunkNoteConnectorRedraw();
                    saveChunkNotesDebounced();
                } else {
                    tag.classList.remove('dragging');
                }
            };
            document.addEventListener('mousemove', move);
            document.addEventListener('mouseup', up);
        });
    }

    function makeChunkNoteTagResizable(tag, note) {
        if (!tag) return;
        const handle = tag.querySelector('.chunk-note-resize-handle');
        if (!handle) return;
        handle.addEventListener('mousedown', (e) => {
            e.preventDefault();
            e.stopPropagation();
            document.body.style.userSelect = 'none';
            const sx = e.clientX;
            const sy = e.clientY;
            const rect = tag.getBoundingClientRect();
            const sw = rect.width;
            const sh = rect.height;
            const baseLayout = getChunkNoteLayoutBase();
            const baseMinW = Math.max(44, baseLayout.minW || 40);
            const baseMinH = Math.max(20, baseLayout.minH || 18);
            let lastValidW = sw;
            let lastValidH = sh;
            let pendingW = sw;
            let pendingH = sh;
            let rafId = 0;
            const wasImageMode = tag.classList.contains('image-mode');
            if (wasImageMode) tag.classList.remove('image-mode');
            const paintResize = () => {
                rafId = 0;
                const candidateW = Math.max(baseMinW, pendingW);
                const candidateH = Math.max(baseMinH, pendingH);
                const fits = canChunkNoteTextFitMinReadable(note, candidateW, candidateH);
                if (fits) {
                    lastValidW = candidateW;
                    lastValidH = candidateH;
                }
                tag.style.width = `${lastValidW}px`;
                tag.style.height = `${lastValidH}px`;
                updateChunkNoteTagCompactState(tag);
                const textEl = tag.querySelector('.chunk-note-text');
                if (textEl && !tag.classList.contains('editing')) {
                    applyChunkNoteTextStyle(textEl, note, { forceFit: true, fastFit: true });
                }
                scheduleChunkNoteConnectorRedraw();
            };
            const move = (ev) => {
                pendingW = Math.max(baseMinW, sw + ev.clientX - sx);
                pendingH = Math.max(baseMinH, sh + ev.clientY - sy);
                if (!rafId) rafId = requestAnimationFrame(paintResize);
            };
            const up = () => {
                document.body.style.userSelect = '';
                document.removeEventListener('mousemove', move);
                document.removeEventListener('mouseup', up);
                if (rafId) {
                    cancelAnimationFrame(rafId);
                    rafId = 0;
                }
                note.w = Math.max(baseMinW, lastValidW);
                note.h = Math.max(baseMinH, lastValidH);
                note.autoSize = false;
                tag.style.width = `${note.w}px`;
                tag.style.height = `${note.h}px`;
                const textEl = tag.querySelector('.chunk-note-text');
                if (textEl && !tag.classList.contains('editing')) applyChunkNoteTextStyle(textEl, note, { forceFit: true });
                if (!tag.classList.contains('editing')) {
                    if (wasImageMode) tag.classList.add('image-mode');
                    renderChunkNoteImage(tag, note);
                }
                scheduleChunkNoteConnectorRedraw();
                saveChunkNotesDebounced();
            };
            document.addEventListener('mousemove', move);
            document.addEventListener('mouseup', up);
        });
    }

    function enableChunkNoteInlineEdit(tag, note) {
        if (!tag) return;
        const textEl = tag.querySelector('.chunk-note-text');
        const dragHandle = tag.querySelector('.chunk-note-drag-handle');
        if (!textEl) return;
        tag.addEventListener('dblclick', (e) => {
            if (e.target.closest('.chunk-note-resize-handle')) return;
            const originalText = String(note.note || '').trim();
            // Preserve the current visual size; editing should not force a larger box.
            const rect = tag.getBoundingClientRect();
            if (!Number.isFinite(Number(note.w))) note.w = Math.max(40, Math.round(rect.width));
            if (!Number.isFinite(Number(note.h))) note.h = Math.max(18, Math.round(rect.height));
            const savedW = Math.max(40, Number(note.w) || Math.round(rect.width));
            const savedH = Math.max(18, Number(note.h) || Math.round(rect.height));
            const editW = savedW;
            const editH = savedH;
            tag.style.width = `${editW}px`;
            tag.style.height = `${editH}px`;
            updateChunkNoteTagCompactState(tag);
            tag.classList.add('editing');
            tag.classList.remove('image-mode');
            textEl.contentEditable = 'true';
            applyChunkNoteTextStyle(textEl, note, { forceFit: true, fastFit: true });
            textEl.focus();
            const range = document.createRange();
            range.selectNodeContents(textEl);
            const sel = window.getSelection();
            if (sel) {
                sel.removeAllRanges();
                sel.addRange(range);
            }
            const finish = (cancel = false) => {
                if (!tag.classList.contains('editing')) return;
                if (cancel) textEl.textContent = note.note || '';
                else {
                    const nextText = (textEl.textContent || '').trim();
                    if (!nextText) {
                        _cnApi.deleteChunkNote(note.id);
                        saveChunkNotesDebounced();
                        refreshChunkNoteForChunkRef(note.chunkRef);
                        textEl.contentEditable = 'false';
                        tag.classList.remove('editing');
                        textEl.removeEventListener('input', onInput);
                        textEl.removeEventListener('blur', onBlur);
                        textEl.removeEventListener('keydown', onKeydown);
                        return;
                    }
                    const textChanged = nextText !== originalText;
                    if (textChanged) {
                        note.note = nextText;
                        if (note.autoSize !== false) applyChunkNoteAutoSize(note);
                    }
                }
                textEl.contentEditable = 'false';
                tag.classList.remove('editing');
                tag.classList.add('image-mode');
                tag.style.width = `${Math.max(40, Number(note.w) || savedW)}px`;
                tag.style.height = `${Math.max(18, Number(note.h) || savedH)}px`;
                updateChunkNoteTagCompactState(tag);
                textEl.scrollTop = 0;
                applyChunkNoteTextStyle(textEl, note, { forceFit: true, fastFit: true });
                renderChunkNoteImage(tag, note);
                saveChunkNotesDebounced();
                scheduleChunkNoteConnectorRedraw();
                textEl.removeEventListener('input', onInput);
                textEl.removeEventListener('blur', onBlur);
                textEl.removeEventListener('keydown', onKeydown);
                tag.__finishChunkNoteEdit = null;
            };
            const onInput = () => {
                if (!tag.classList.contains('editing')) return;
                const nextText = (textEl.textContent || '').trim();
                if (note.autoSize !== false) {
                    const { minW, minH } = getChunkNoteLayoutBase();
                    const maxW = Math.max(minW, parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--chunk-note-width')) || 260);
                    const box = measureChunkNoteTextBox(nextText, minW, minH, maxW);
                    tag.style.width = `${box.width}px`;
                    tag.style.height = `${box.height}px`;
                    updateChunkNoteTagCompactState(tag);
                }
                applyChunkNoteTextStyle(textEl, { ...note, note: nextText || note.note });
                scheduleChunkNoteConnectorRedraw();
            };
            const onBlur = () => finish(false);
            const onKeydown = (ev) => {
                if (ev.key === 'Enter' && !ev.shiftKey) {
                    ev.preventDefault();
                    textEl.blur();
                } else if (ev.key === 'Escape') {
                    ev.preventDefault();
                    finish(true);
                }
            };
            textEl.addEventListener('input', onInput);
            textEl.addEventListener('blur', onBlur);
            textEl.addEventListener('keydown', onKeydown);
            tag.__finishChunkNoteEdit = finish;
        });
        if (dragHandle) {
            dragHandle.title = '鎷栨嫿';
        }
    }

    function spawnChunkNoteTag(note) {
        if (!note || !note.id || !note.note) return;
        ensureChunkNoteOverlayLayers();
        const source = getChunkWordSpan(note);
        const sourceRect = source ? rectToMainAreaSpace(source.getBoundingClientRect()) : {
            left: 12, top: 12, right: 12, bottom: 12, width: 0, height: 0
        };
        if (note.autoSize !== false) applyChunkNoteAutoSize(note);
        ensureChunkNoteLayout(note, sourceRect);

        const tag = document.createElement('div');
        tag.className = 'chunk-note-tag';
        tag.id = `chunk-note-tag-${note.id}`;
        tag.dataset.noteId = note.id;
        tag.style.setProperty('--note-accent', getChunkNoteAccent(note));
        tag.style.left = `${note.x}px`;
        tag.style.top = `${note.y}px`;
        const { minW, minH } = getChunkNoteLayoutBase();
        tag.style.width = `${Math.max(minW, Number(note.w) || minW)}px`;
        tag.style.height = `${Math.max(minH, Number(note.h) || minH)}px`;
        updateChunkNoteTagCompactState(tag);
        tag.innerHTML = `
          <img class="chunk-note-image" alt="" aria-hidden="true" />
          <span class="chunk-note-drag-handle">&#x283F;</span>
          <span class="chunk-note-text"></span>
          <div class="chunk-note-resize-handle"></div>
        `;
        const textEl = tag.querySelector('.chunk-note-text');
        if (textEl) textEl.textContent = note.note || '';
        makeChunkNoteTagDraggable(tag, note);
        makeChunkNoteTagResizable(tag, note);
        enableChunkNoteInlineEdit(tag, note);
        tag.addEventListener('mousedown', (e) => {
            if (e.target.closest('.chunk-note-resize-handle')) return;
            setSelectedChunkNote(note.id);
            closeChunkNoteDeleteDialog();
        });
        tag.addEventListener('mouseenter', () => {
            setChunkNoteHoverTarget(note.id);
            scheduleChunkNoteConnectorRedraw();
        });
        tag.addEventListener('mouseleave', () => {
            setChunkNoteHoverTarget('');
            scheduleChunkNoteConnectorRedraw();
        });
        (chunkNoteLayer || mainAppArea || document.body).appendChild(tag);
        if (source) syncChunkNoteTagToAnchor(note, tag);
        if (textEl) applyChunkNoteTextStyle(textEl, note, { forceFit: true });
        renderChunkNoteImage(tag, note);
    }

    function renderAllChunkNoteTags() {
        setChunkNoteHoverTarget('');
        setSelectedChunkNote('');
        closeChunkNoteDeleteDialog();
        document.querySelectorAll('.chunk-note-tag').forEach(el => el.remove());
        if (!isChunkMode || !_ns.chunkNoteVisible) return;
        _cnApi.listChunkNotes()
            .filter(n => n && n.note && String(n.note).trim())
            .sort((a, b) => (a.chunkIdx - b.chunkIdx) || (a.startGlobal - b.startGlobal))
            .forEach(spawnChunkNoteTag);
        scheduleChunkNoteLayoutRefresh();
    }

    function drawChunkNoteConnector(note) {
        if (!chunkNoteSvgLayer || !note || !note.id || !note.chunkRef) return;
        const activeChunkNoteId = _cnApi.getActiveChunkNoteId();
        if (!activeChunkNoteId || activeChunkNoteId !== note.id) return;
        const source = getChunkWordSpan(note);
        const tag = getChunkNoteTagById(note.id);
        if (!source || !tag) return;
        const s = rectToMainAreaSpace(source.getBoundingClientRect());
        const t = rectToMainAreaSpace(tag.getBoundingClientRect());
        if (s.width <= 0 || t.width <= 0) return;

        const x1 = s.left + (s.width / 2);
        const y1 = s.bottom;
        const x2 = t.left + (t.width / 2);
        const y2 = t.top;
        const midY = (y1 + y2) / 2;
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('class', 'chunk-note-connector');
        path.style.opacity = '1';
        path.setAttribute('d', `M${x1},${y1} C${x1},${midY} ${x2},${midY} ${x2},${y2}`);
        chunkNoteSvgLayer.appendChild(path);
    }

    function redrawAllChunkNoteConnectors() {
        clearChunkNoteConnectors();
        if (!isChunkMode || !_ns.chunkNoteVisible) return;
        ensureChunkNoteOverlayLayers();
        syncChunkNoteOverlaySize();
        _cnApi.listChunkNotes().forEach(drawChunkNoteConnector);
    }

    function scheduleChunkNoteConnectorRedraw() {
        if (chunkNoteConnectorRaf) return;
        chunkNoteConnectorRaf = requestAnimationFrame(() => {
            chunkNoteConnectorRaf = 0;
            redrawAllChunkNoteConnectors();
        });
    }

    function closeChunkNotePopover() {
        if (chunkNoteModalEl) {
            chunkNoteModalEl.remove();
            chunkNoteModalEl = null;
            chunkNoteModalInputEl = null;
        }
        _cnApi.cancelChunkNoteDraftSaveTimer();
        chunkNoteModalDragging = false;
        chunkNoteModalResizing = false;
        notePopoverCtx = null;
        closeChunkNoteContextMenu();
    }

    function getChunkNoteModalPosition(anchorRect, modalEl) {
        const gap = 12;
        const margin = 8;
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const rect = modalEl.getBoundingClientRect();
        let left = anchorRect.left;
        let top = anchorRect.bottom + gap;
        if (left + rect.width > vw - margin) left = vw - rect.width - margin;
        if (left < margin) left = margin;
        if (top + rect.height > vh - margin) top = anchorRect.top - rect.height - gap;
        if (top < margin) top = margin;
        return { left, top };
    }

    function applyTempAnnotationByCtx(ctx) {
        if (!ctx || !ctx.chunkRef) return;
        const block = Number.isFinite(Number(ctx.chunkIdx))
            ? document.querySelector(`.chunk-block[data-chunk-idx="${Number(ctx.chunkIdx)}"]`)
            : getChunkBlockByRef(ctx.chunkRef);
        if (!block) return;
        const enDiv = block.querySelector('.chunk-en');
        if (!enDiv) return;
        const start = Number(ctx.startGlobal);
        const end = Number(ctx.endGlobal);
        if (!Number.isFinite(start) || !Number.isFinite(end)) return;
        const accent = getChunkNoteAccent({ id: `${ctx.chunkRef}:${start}-${end}` });
        for (let i = start; i <= end; i++) {
            const span = enDiv.querySelector(`#word-${i}`);
            if (!span) continue;
            span.classList.add('annotated');
            span.style.setProperty('--annot-accent', accent);
            if (start === end) span.classList.add('annotated-single');
            else if (i === start) span.classList.add('annotated-start');
            else if (i === end) span.classList.add('annotated-end');
            else span.classList.add('annotated-mid');
        }
    }

    function saveChunkNoteFromModal() {
        if (!notePopoverCtx || !chunkNoteModalInputEl) {
            closeChunkNotePopover();
            return;
        }
        const noteText = (chunkNoteModalInputEl.value || '').trim();
        const ctx = notePopoverCtx;
        if (noteText) {
            const savedNoteId = upsertChunkNote(ctx, noteText);
            saveChunkNotesDebounced();
            clearChunkNoteDraft();
            if (!_ns.chunkNoteVisible) setChunkNoteVisible(true, true);
            refreshChunkNoteForChunkRef(ctx.chunkRef);
            setSelectedChunkNote(savedNoteId);
        } else {
            if (ctx.noteId) _cnApi.deleteChunkNote(ctx.noteId);
            refreshChunkNoteForChunkRef(ctx.chunkRef);
            saveChunkNotesDebounced();
            clearChunkNoteDraft();
        }
        closeChunkNotePopover();
    }

    function cancelChunkNoteModal() {
        clearChunkNoteDraft();
        if (notePopoverCtx && notePopoverCtx.noteId && !notePopoverCtx.noteExists) {
            _cnApi.deleteChunkNote(notePopoverCtx.noteId);
            refreshChunkNoteForChunkRef(notePopoverCtx.chunkRef);
        }
        closeChunkNotePopover();
    }

    function openChunkNotePopover(ctx) {
        closeChunkNoteContextMenu();
        closeChunkNotePopover();
        notePopoverCtx = ctx;
        if (!_ns.chunkNoteVisible) setChunkNoteVisible(true, true);
        applyTempAnnotationByCtx(ctx);

        const modal = document.createElement('div');
        modal.className = 'chunk-note-modal-wrap';
        modal.innerHTML = `
          <span class="chunk-note-modal-handle">&#x283F;</span>
          <textarea class="chunk-note-modal-input" rows="1"></textarea>
          <div class="chunk-note-modal-resize"></div>
        `;
        document.body.appendChild(modal);
        chunkNoteModalEl = modal;
        chunkNoteModalInputEl = modal.querySelector('.chunk-note-modal-input');
        chunkNoteModalInputEl.value = ctx.initialNote || '';

        modal.style.left = '16px';
        modal.style.top = '16px';
        const pos = getChunkNoteModalPosition(ctx.anchorRect, modal);
        modal.style.left = `${pos.left}px`;
        modal.style.top = `${pos.top}px`;

        const dragHandle = modal.querySelector('.chunk-note-modal-handle');
        const resizeHandle = modal.querySelector('.chunk-note-modal-resize');
        if (dragHandle) {
            dragHandle.addEventListener('mousedown', (e) => {
                e.preventDefault();
                e.stopPropagation();
                chunkNoteModalDragging = true;
                const sx = e.clientX;
                const sy = e.clientY;
                const sl = parseFloat(modal.style.left) || 0;
                const st = parseFloat(modal.style.top) || 0;
                const move = (ev) => {
                    document.body.style.userSelect = 'none';
                    modal.style.left = `${sl + ev.clientX - sx}px`;
                    modal.style.top = `${st + ev.clientY - sy}px`;
                };
                const up = () => {
                    document.body.style.userSelect = '';
                    chunkNoteModalDragging = false;
                    document.removeEventListener('mousemove', move);
                    document.removeEventListener('mouseup', up);
                };
                document.addEventListener('mousemove', move);
                document.addEventListener('mouseup', up);
            });
        }
        if (resizeHandle) {
            resizeHandle.addEventListener('mousedown', (e) => {
                e.preventDefault();
                e.stopPropagation();
                chunkNoteModalResizing = true;
                const sx = e.clientX;
                const sy = e.clientY;
                const r = modal.getBoundingClientRect();
                const sw = r.width;
                const sh = r.height;
                const move = (ev) => {
                    const nw = Math.max(140, sw + ev.clientX - sx);
                    const nh = Math.max(44, sh + ev.clientY - sy);
                    modal.style.width = `${nw}px`;
                    modal.style.height = `${nh}px`;
                };
                const up = () => {
                    chunkNoteModalResizing = false;
                    document.removeEventListener('mousemove', move);
                    document.removeEventListener('mouseup', up);
                };
                document.addEventListener('mousemove', move);
                document.addEventListener('mouseup', up);
            });
        }

        chunkNoteModalInputEl.addEventListener('blur', () => {
            setTimeout(() => {
                if (!chunkNoteModalEl) return;
                if (chunkNoteModalDragging || chunkNoteModalResizing) return;
                saveChunkNoteFromModal();
            }, 0);
        });
        chunkNoteModalInputEl.addEventListener('input', () => {
            persistChunkNoteDraft(false);
        });
        chunkNoteModalInputEl.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                saveChunkNoteFromModal();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                cancelChunkNoteModal();
            }
        });

        chunkNoteModalInputEl.focus();
        chunkNoteModalInputEl.setSelectionRange(chunkNoteModalInputEl.value.length, chunkNoteModalInputEl.value.length);
        setTimeout(() => {
            if (!chunkNoteModalInputEl) return;
            chunkNoteModalInputEl.focus();
            chunkNoteModalInputEl.setSelectionRange(chunkNoteModalInputEl.value.length, chunkNoteModalInputEl.value.length);
        }, 0);
        persistChunkNoteDraft(true);
    }

    function upsertChunkNote(ctx, noteText) {
        let layoutContext = null;
        if (ctx && ctx.anchorRect) {
            const { minW, minH, margin } = getChunkNoteLayoutBase();
            const anchorRect = rectToMainAreaSpace(ctx.anchorRect);
            const areaW = mainAppArea ? Math.max(mainAppArea.clientWidth, mainAppArea.scrollWidth) : window.innerWidth;
            const areaH = mainAppArea ? Math.max(mainAppArea.clientHeight, mainAppArea.scrollHeight) : window.innerHeight;
            layoutContext = {
                minW,
                minH,
                margin,
                areaW,
                areaH,
                anchorRect,
                autoSize: applyChunkNoteAutoSize
            };
        }
        return _cnApi.upsertChunkNote(ctx, noteText, layoutContext);
    }

    function refreshChunkNoteForChunkRef(chunkRef) {
        const blocks = getChunkBlocksMatchingRef(chunkRef);
        if (!blocks.length) {
            renderAllChunkNoteTags();
            scheduleChunkNoteConnectorRedraw();
            return;
        }
        blocks.forEach((block) => {
            const enDiv = block.querySelector('.chunk-en');
            if (!enDiv) return;
            const notes = getChunkNotesForBlock(block);
            if (!notes.length) clearChunkWordAnnotations(enDiv);
            else markChunkWordsByNotes(enDiv, notes);
        });
        renderAllChunkNoteTags();
        scheduleChunkNoteConnectorRedraw();
    }

    function openChunkNoteStyleModal() {
        document.getElementById('modal-backdrop').style.display = 'block';
        document.getElementById('chunk-note-style-modal').style.display = 'block';
        const styles = getComputedStyle(document.documentElement);
        const sz = (styles.getPropertyValue('--chunk-note-size').trim() || '16px').replace('px', '');
        const width = (styles.getPropertyValue('--chunk-note-width').trim() || '260px').replace('px', '');
        const minH = (styles.getPropertyValue('--chunk-note-min-height').trim() || '18px').replace('px', '');
        const arrow = (styles.getPropertyValue('--chunk-note-arrow-size').trim() || '12px').replace('px', '');
        let color = localStorage.getItem('chunkNoteColor') || styles.getPropertyValue('--chunk-note-color').trim();
        if (!color.startsWith('#') || color.length !== 7) color = '#4b5563';
        document.getElementById('chunk-note-size-input').value = parseInt(sz, 10) || 14;
        document.getElementById('chunk-note-color-input').value = color;
        document.getElementById('chunk-note-width-input').value = parseInt(width, 10) || 260;
        document.getElementById('chunk-note-min-height-input').value = parseInt(minH, 10) || 18;
        document.getElementById('chunk-note-arrow-size-input').value = parseInt(arrow, 10) || 12;
    }

    function closeChunkNoteStyleModal() {
        const el = document.getElementById('chunk-note-style-modal');
        if (el) el.style.display = 'none';
    }

    function updateChunkNoteStyle() {
        const size = document.getElementById('chunk-note-size-input').value;
        const color = document.getElementById('chunk-note-color-input').value;
        const width = document.getElementById('chunk-note-width-input').value;
        const minH = document.getElementById('chunk-note-min-height-input').value;
        const arrow = document.getElementById('chunk-note-arrow-size-input').value;
        document.documentElement.style.setProperty('--chunk-note-size', `${size}px`);
        document.documentElement.style.setProperty('--chunk-note-color', color);
        document.documentElement.style.setProperty('--chunk-note-width', `${width}px`);
        document.documentElement.style.setProperty('--chunk-note-min-height', `${minH}px`);
        document.documentElement.style.setProperty('--chunk-note-arrow-size', `${arrow}px`);
        localStorage.setItem('chunkNoteSize', `${size}px`);
        localStorage.setItem('chunkNoteColor', color);
        localStorage.setItem('chunkNoteWidth', `${width}px`);
        localStorage.setItem('chunkNoteMinHeight', `${minH}px`);
        localStorage.setItem('chunkNoteArrowSize', `${arrow}px`);
        adjustChunkNoteArrowSizeByGap();
        if (isChunkMode) {
            renderAllChunkNoteTags();
        }
        scheduleChunkNoteConnectorRedraw();
    }

    function adjustChunkNoteArrowSizeByGap() {
        const styles = getComputedStyle(document.documentElement);
        const gap = parseFloat(styles.getPropertyValue('--chunk-gap')) || 20;
        const desired = parseFloat(styles.getPropertyValue('--chunk-note-arrow-size')) || 12;
        const safeMax = Math.max(6, Math.floor(gap * 0.45));
        const effective = Math.max(6, Math.min(desired, safeMax));
        document.documentElement.style.setProperty('--chunk-note-arrow-size-effective', `${effective}px`);
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
    let words = [];
    let segments = [];
    let currentWordIndex = -1;
    let autoFollow = true;
    let userScrollSuppress = false;
    let suppressTimer = null;
    
    let highlightMode = 2;
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

    let wordStarts = [];
    let globalVocab = []; 
    let vocabMatchMap = new Map();

    // === AI Chunk Mode State ===
    let isChunkMode = false;
    let chunkItems = [];
    let chunkCnVisible = false; // hidden by default; hold key reveals focused Chinese
    let chunkCnHoldMode = true; // true = show Chinese only while holding shortcut
    let isHoldingChunkCn = false;
    let holdPrevChunkCnVisible = null;
    let holdPrevHadFocusClass = null;
    let isChunkShadowOn = true; 
    let chunkCnMode = 'focus'; // 'global' or 'focus'
    let manualChunkStates = {};
    let lastActiveChunkIndex = -1;
    let lastAiPrevTapChunkIndex = -1;
    let lastAiPrevTapAt = 0;
    let lastSentencePrevTapSegIndex = -1;
    let lastSentencePrevTapAt = 0;
    let hasAiChunkData = false;
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
        getIsChunkMode: function () { return isChunkMode; },
        currentAudioKeyGetter: function () { return currentAudioKey; },
        makeSelectionNoteBaseId: makeSelectionNoteBaseId,
        makeSelectionNoteId: makeSelectionNoteId,
        applyChunkNoteAutoSize: applyChunkNoteAutoSize,
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
        chunkNoteCtxMenuEl: chunkNoteCtxMenu,
        closeChunkNotePopover: closeChunkNotePopover,
        clearChunkNoteConnectors: clearChunkNoteConnectors,
        ensureChunkNoteOverlayLayers: ensureChunkNoteOverlayLayers,
        renderAllChunkNoteTags: renderAllChunkNoteTags,
        scheduleChunkNoteLayoutRefresh: scheduleChunkNoteLayoutRefresh,
        scheduleChunkNoteConnectorRedraw: scheduleChunkNoteConnectorRedraw
    });
    var _snApi = window.__notesModule.initSentenceNotes({
        state: _ns,
        loadFromDB: loadFromDB,
        saveToDB: saveToDB,
        getSentenceNotesStorageKey: getSentenceNotesStorageKey,
        getLegacySentenceNotesStorageKey: getLegacySentenceNotesStorageKey,
        buildCurrentSentenceDocId: buildCurrentSentenceDocId,
        isPlainObjectRecord: isPlainObjectRecord,
        persistSelectedSentenceNote: persistSelectedSentenceNote,
        renderNotePreviewSidebar: renderNotePreviewSidebar
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
    function exportManualLightweightAnnotations() {
        if (typeof window.__session_exportManualLightweightAnnotations === 'function') {
            return window.__session_exportManualLightweightAnnotations();
        }
        throw new Error('Annotation lightweight export module is not ready');
    }
    async function importManualLightweightAnnotations(file) {
        if (typeof window.__session_importManualLightweightAnnotations === 'function') {
            return window.__session_importManualLightweightAnnotations(file);
        }
        throw new Error('Annotation lightweight import module is not ready');
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
    Object.defineProperty(window.__state, 'segments', { get: function() { return segments; }, set: function(v) { segments = v; }, enumerable: true, configurable: true });
    Object.defineProperty(window.__state, 'words', { get: function() { return words; }, set: function(v) { words = v; }, enumerable: true, configurable: true });
    Object.defineProperty(window.__state, 'wordStarts', { get: function() { return wordStarts; }, set: function(v) { wordStarts = v; }, enumerable: true, configurable: true });
    Object.defineProperty(window.__state, 'chunkItems', { get: function() { return chunkItems; }, set: function(v) { chunkItems = v; }, enumerable: true, configurable: true });
    Object.defineProperty(window.__state, 'hasAiChunkData', { get: function() { return hasAiChunkData; }, set: function(v) { hasAiChunkData = v; }, enumerable: true, configurable: true });
    Object.defineProperty(window.__state, 'hasClozeData', { get: function() { return hasClozeData; }, set: function(v) { hasClozeData = v; }, enumerable: true, configurable: true });
    Object.defineProperty(window.__state, 'clozeItems', { get: function() { return clozeItems; }, set: function(v) { clozeItems = v; }, enumerable: true, configurable: true });
    Object.defineProperty(window.__state, 'clozeAnswerState', { get: function() { return clozeAnswerState; }, set: function(v) { clozeAnswerState = v; }, enumerable: true, configurable: true });
    Object.defineProperty(window.__state, 'manualChunkStates', { get: function() { return manualChunkStates; }, set: function(v) { manualChunkStates = v; }, enumerable: true, configurable: true });
    Object.defineProperty(window.__state, 'currentAudioMeta', { get: function() { return currentAudioMeta; }, set: function(v) { currentAudioMeta = v; }, enumerable: true, configurable: true });
    Object.defineProperty(window.__state, 'chunkNotesFileHandle', { get: function() { return _cnApi.getChunkNotesFileState().handle; }, set: function(v) { _cnApi.setChunkNotesFileState({ handle: v }); }, enumerable: true, configurable: true });
    Object.defineProperty(window.__state, 'chunkNotesFileHandleAudioKey', { get: function() { return _cnApi.getChunkNotesFileState().audioKey; }, set: function(v) { _cnApi.setChunkNotesFileState({ audioKey: v }); }, enumerable: true, configurable: true });
    Object.defineProperty(window.__state, 'chunkNotesFileName', { get: function() { return _cnApi.getChunkNotesFileState().fileName; }, set: function(v) { _cnApi.setChunkNotesFileState({ fileName: v }); }, enumerable: true, configurable: true });
    var __cak = 'default-audio';
    Object.defineProperty(window.__state, 'isChunkMode', { get: function() { return isChunkMode; }, set: function(v) { isChunkMode = !!v; }, enumerable: true, configurable: true });
    Object.defineProperty(window.__state, 'currentAudioKey', { get: function() { return __cak; }, set: function(v) { __cak = v; }, enumerable: true, configurable: true });
    Object.defineProperty(window.__state, 'currentWordIndex', { get: function() { return currentWordIndex; }, set: function(v) { currentWordIndex = v; }, enumerable: true, configurable: true });
    Object.defineProperty(window.__state, 'autoFollow', { get: function() { return autoFollow; }, set: function(v) { autoFollow = v; }, enumerable: true, configurable: true });
    Object.defineProperty(window.__state, 'userScrollSuppress', { get: function() { return userScrollSuppress; }, set: function(v) { userScrollSuppress = v; }, enumerable: true, configurable: true });
    Object.defineProperty(window.__state, 'suppressTimer', { get: function() { return suppressTimer; }, set: function(v) { suppressTimer = v; }, enumerable: true, configurable: true });
    Object.defineProperty(window.__state, 'highlightMode', { get: function() { return highlightMode; }, set: function(v) { highlightMode = v; }, enumerable: true, configurable: true });
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
    Object.defineProperty(window.__state, 'chunkCnVisible', { get: function() { return chunkCnVisible; }, set: function(v) { chunkCnVisible = v; }, enumerable: true, configurable: true });
    Object.defineProperty(window.__state, 'chunkCnHoldMode', { get: function() { return chunkCnHoldMode; }, set: function(v) { chunkCnHoldMode = v; }, enumerable: true, configurable: true });
    Object.defineProperty(window.__state, 'isHoldingChunkCn', { get: function() { return isHoldingChunkCn; }, set: function(v) { isHoldingChunkCn = v; }, enumerable: true, configurable: true });
    Object.defineProperty(window.__state, 'holdPrevChunkCnVisible', { get: function() { return holdPrevChunkCnVisible; }, set: function(v) { holdPrevChunkCnVisible = v; }, enumerable: true, configurable: true });
    Object.defineProperty(window.__state, 'holdPrevHadFocusClass', { get: function() { return holdPrevHadFocusClass; }, set: function(v) { holdPrevHadFocusClass = v; }, enumerable: true, configurable: true });
    Object.defineProperty(window.__state, 'isChunkShadowOn', { get: function() { return isChunkShadowOn; }, set: function(v) { isChunkShadowOn = v; }, enumerable: true, configurable: true });
    Object.defineProperty(window.__state, 'chunkCnMode', { get: function() { return chunkCnMode; }, set: function(v) { chunkCnMode = v; }, enumerable: true, configurable: true });
    Object.defineProperty(window.__state, 'lastActiveChunkIndex', { get: function() { return lastActiveChunkIndex; }, set: function(v) { lastActiveChunkIndex = v; }, enumerable: true, configurable: true });
    Object.defineProperty(window.__state, 'lastAiPrevTapChunkIndex', { get: function() { return lastAiPrevTapChunkIndex; }, set: function(v) { lastAiPrevTapChunkIndex = v; }, enumerable: true, configurable: true });
    Object.defineProperty(window.__state, 'lastAiPrevTapAt', { get: function() { return lastAiPrevTapAt; }, set: function(v) { lastAiPrevTapAt = v; }, enumerable: true, configurable: true });
    Object.defineProperty(window.__state, 'lastSentencePrevTapSegIndex', { get: function() { return lastSentencePrevTapSegIndex; }, set: function(v) { lastSentencePrevTapSegIndex = v; }, enumerable: true, configurable: true });
    Object.defineProperty(window.__state, 'lastSentencePrevTapAt', { get: function() { return lastSentencePrevTapAt; }, set: function(v) { lastSentencePrevTapAt = v; }, enumerable: true, configurable: true });
    Object.defineProperty(window.__state, 'chunkPointerDown', { get: function() { return chunkPointerDown; }, set: function(v) { chunkPointerDown = v; }, enumerable: true, configurable: true });

    var _cpApi = window.__importModule.initChunkPipeline({
        state: window.__state,
        getIsChunkMode: function() { return isChunkMode; },
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

    let notePopoverCtx = null;
    let chunkNoteModalEl = null;
    let chunkNoteModalInputEl = null;
    let chunkNoteModalDragging = false;
    let chunkNoteModalResizing = false;
    let chunkNoteConnectorRaf = 0;
    let chunkNoteLayoutRaf = 0;
    let chunkNoteDraftRestoreDone = false;
    let chunkNoteDeleteDialogEl = null;
    let chunkNoteExportDialogEl = null;
    let chunkNoteExportDialogKeydownHandler = null;
    let chunkNotesFileHandle = null;
    let chunkNotesFileHandleAudioKey = '';
    let chunkNotesFileName = '';
    let currentAudioMeta = null;
    let currentAudioKey = 'default-audio';
    let notePreviewVisible = true;
    let notePreviewWidth = 340;
    let notePreviewHeight = 640;
    let notePreviewResizeRaf = 0;
    let notePreviewSavedHintTimer = 0;
    let notePreviewPendingScrollItemId = '';
    let notePreviewListScrollTop = 0;
    let chunkPointerDown = null;
    ensureChunkNoteOverlayLayers();

    // [MIGRATED] style editor → src/composables/style-editor.js
    window.__styleEditor.init({
        safeParseLocalJSON: safeParseLocalJSON,
        adjustChunkNoteArrowSizeByGap: adjustChunkNoteArrowSizeByGap,
        renderAllChunkNoteTags: renderAllChunkNoteTags,
        scheduleChunkNoteConnectorRedraw: scheduleChunkNoteConnectorRedraw,
        getIsChunkMode: function () { return isChunkMode; },
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
        if (!segments.length || !globalVocab.length) return;
        const nextMap = buildVocabMatchMapHelper(words, globalVocab);
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
        const ref = String(chunkRef || '');
        return Array.from(document.querySelectorAll('.chunk-block')).filter(block => {
            return String(block.dataset.chunkRef || '') === ref || String(block.dataset.legacyChunkRef || '') === ref;
        });
    }

    function getChunkNotesForBlock(block) {
        if (!block) return [];
        const refs = [
            String(block.dataset.chunkRef || ''),
            String(block.dataset.legacyChunkRef || '')
        ].filter(Boolean);
        return _cnApi.getChunkNotesForBlockRefs(refs);
    }

    function refreshAllChunkNoteVisuals() {
        if (!isChunkMode || !hasAiChunkData) return;
        document.querySelectorAll('.chunk-block').forEach(block => {
            const enDiv = block.querySelector('.chunk-en');
            if (!enDiv) return;
            const notes = getChunkNotesForBlock(block);
            if (notes.length > 0) markChunkWordsByNotes(enDiv, notes);
            else clearChunkWordAnnotations(enDiv);
        });
        renderAllChunkNoteTags();
        scheduleChunkNoteConnectorRedraw();
    }

    function findNearestChunkBlock(clientX, clientY) {
        const blocks = Array.from(document.querySelectorAll('.chunk-block'));
        if (!blocks.length) return null;
        let best = null;
        let bestScore = Infinity;
        blocks.forEach((block) => {
            const rect = block.getBoundingClientRect();
            const dx = clientX < rect.left ? rect.left - clientX : (clientX > rect.right ? clientX - rect.right : 0);
            const dy = clientY < rect.top ? rect.top - clientY : (clientY > rect.bottom ? clientY - rect.bottom : 0);
            const score = (dy * dy) + (dx * dx * 0.2);
            if (score < bestScore) {
                bestScore = score;
                best = block;
            }
        });
        return best;
    }

    function handleChunkSelectionContextMenu(e) {
        if (!isChunkMode || !hasAiChunkData) return false;
        if (chunkNoteModalEl) saveChunkNoteFromModal();
        let chunkBlock = e.target && e.target.closest ? e.target.closest('.chunk-block') : null;
        if (!chunkBlock && e.target && e.target.closest && (e.target.closest('#chunk-vue-container') || e.target.closest('#transcript-container'))) {
            chunkBlock = findNearestChunkBlock(e.clientX, e.clientY);
        }
        if (!chunkBlock) {
            closeChunkNoteContextMenu();
            return false;
        }
        const enDiv = chunkBlock.querySelector('.chunk-en');
        if (!enDiv) {
            closeChunkNoteContextMenu();
            return false;
        }
        const selection = window.getSelection();
        let startGlobal = NaN;
        let endGlobal = NaN;
        let selectedText = '';
        let anchorRect = null;
        if (selection && selection.rangeCount > 0 && !selection.isCollapsed) {
            const range = selection.getRangeAt(0);
            if (enDiv.contains(range.commonAncestorContainer)) {
                const selectedSpans = Array.from(enDiv.querySelectorAll('span[id^="word-"]')).filter(span => {
                    try { return range.intersectsNode(span); } catch (err) { return false; }
                });
                if (selectedSpans.length) {
                    const indices = selectedSpans.map(span => parseInt(span.id.replace('word-', ''), 10)).filter(Number.isFinite);
                    if (indices.length) {
                        startGlobal = Math.min(...indices);
                        endGlobal = Math.max(...indices);
                        selectedText = selectedSpans.map(s => s.textContent.trim()).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
                        anchorRect = range.getBoundingClientRect();
                    }
                }
            }
        }
        if (!Number.isFinite(startGlobal) || !Number.isFinite(endGlobal)) {
            const nearest = findNearestChunkWord(enDiv, e.clientX, e.clientY);
            if (!nearest) {
                closeChunkNoteContextMenu();
                return false;
            }
            const idx = parseInt(String(nearest.id || '').replace('word-', ''), 10);
            if (!Number.isFinite(idx)) {
                closeChunkNoteContextMenu();
                return false;
            }
            startGlobal = idx;
            endGlobal = idx;
            selectedText = (nearest.textContent || '').trim();
            anchorRect = nearest.getBoundingClientRect();
        }
        e.preventDefault();
        const chunkRef = chunkBlock.dataset.chunkRef || '';
        const chunkIdx = Number(chunkBlock.dataset.chunkIdx || -1);
        openChunkNoteContextMenu(e.clientX, e.clientY, {
            noteId: makeSelectionNoteId(chunkRef, startGlobal, endGlobal),
            chunkRef,
            chunkIdx,
            startGlobal,
            endGlobal,
            selectedText,
            initialNote: '',
            noteExists: false,
            anchorRect
        });
        return true;
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
        const word = Number.isFinite(wordIndex) ? words[wordIndex] : null;
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
            words,
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
        if (isChunkMode && hasActiveTextSelectionWithinChunk()) return;
        audioPlayer.currentTime = start;
        forceUpdateUI(start);
        if (isChunkMode) {
            try { selectSentenceFromChunkTarget(span); } catch (err) {}
        }
        notifyAnnotationBubbleWordClick(span);
    }, true);

    function selectSentenceFromChunkTarget(target) {
        if (!isChunkMode || !hasAiChunkData) return false;
        const chunkBlock = target && target.closest ? target.closest('.chunk-block') : null;
        if (!chunkBlock) return false;
        const chunkRef = String(chunkBlock.dataset.chunkRef || '');
        const idx = Number(chunkBlock.dataset.chunkIdx || '-1');
        if (!chunkRef || idx < 0) return false;
        const enDiv = chunkBlock.querySelector('.chunk-en');
        const text = ((enDiv && enDiv.textContent) || '').replace(/\s+/g, ' ').trim();
        setSelectedSentence({
            index: idx,
            sentenceId: chunkRef,
            chunkRef,
            text
        });
        return true;
    }

    function hasActiveTextSelectionWithinChunk() {
        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return false;
        const text = selection.toString().replace(/\s+/g, ' ').trim();
        if (!text) return false;
        const range = selection.getRangeAt(0);
        const element = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
            ? range.commonAncestorContainer
            : range.commonAncestorContainer.parentElement;
        return !!(element && element.closest && element.closest('.chunk-en'));
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
        document.documentElement.style.setProperty('--note-preview-width', `${notePreviewWidth}px`);
        document.documentElement.style.setProperty('--note-preview-height', `${notePreviewHeight}px`);
    }

    // Sentence notebook: item metadata + save feedback
    function formatSentenceNoteItemMeta(item, itemId, isEditing = false) {
        if (isEditing) return 'Editing note...';
        if (_ns.notePreviewSavedItemId && _ns.notePreviewSavedItemId === itemId) return 'Saved just now';
        if (item && item.updatedAt) return `Last saved ${new Date(item.updatedAt).toLocaleString()}`;
        return 'Draft item';
    }

    function triggerSentenceNoteSavedFeedback(itemId = '') {
        _ns.notePreviewSavedItemId = String(itemId || '');
        if (notePreviewSavedHintTimer) clearTimeout(notePreviewSavedHintTimer);
        notePreviewSavedHintTimer = setTimeout(() => {
            _ns.notePreviewSavedItemId = '';
            renderNotePreviewSidebar();
        }, 1400);
    }

    // Sentence notebook: draft/commit/persist core
    function findSentenceNoteItem(sentenceId, itemId) {
        const record = getSentenceNoteRecord(sentenceId);
        if (!record) return { record: null, item: null, index: -1 };
        const index = record.items.findIndex(item => String(item.itemId || '') === String(itemId || ''));
        return {
            record,
            item: index >= 0 ? record.items[index] : null,
            index
        };
    }

    function discardSentenceNoteDraft(shouldRender = true) {
        if (!_ns.sentenceNoteDraft) return;
        if (_ns.notePreviewEditingItemId === _ns.sentenceNoteDraft.itemId) _ns.notePreviewEditingItemId = '';
        _ns.sentenceNoteDraft = null;
        if (shouldRender) renderNotePreviewSidebar();
    }

    function commitSentenceNoteDraft(shouldRender = true) {
        if (!_ns.sentenceNoteDraft) return false;
        const noteBody = String(_ns.sentenceNoteDraft.noteBody || '');
        if (!noteBody.trim()) {
            discardSentenceNoteDraft(shouldRender);
            return false;
        }
        const sentenceId = String(_ns.sentenceNoteDraft.sentenceId || '');
        const record = getSentenceNoteRecord(sentenceId);
        if (!record) {
            discardSentenceNoteDraft(shouldRender);
            return false;
        }
        const now = Date.now();
        const committed = normalizeSentenceNoteItem(sentenceId, {
            itemId: _ns.sentenceNoteDraft.itemId,
            selectedText: _ns.sentenceNoteDraft.selectedText,
            noteBody,
            createdAt: _ns.sentenceNoteDraft.createdAt || now,
            updatedAt: now
        }, _ns.sentenceNoteDraft.itemId);
        record.items.push(committed);
        _ns.sentenceNotesMap[sentenceId] = record;
        const committedItemId = committed.itemId;
        _ns.sentenceNoteDraft = null;
        _ns.notePreviewEditingItemId = '';
        saveSentenceNotesDebounced();
        triggerSentenceNoteSavedFeedback(committedItemId);
        if (shouldRender) renderNotePreviewSidebar();
        return true;
    }

    function persistSentenceNoteItem(sentenceId, itemId, shouldRender = true) {
        const { record, item, index } = findSentenceNoteItem(sentenceId, itemId);
        if (!record || !item || index < 0) return false;
        const nextBody = String(item.noteBody || '');
        if (!nextBody.trim()) {
            if (notePreviewList) notePreviewListScrollTop = notePreviewList.scrollTop;
            record.items.splice(index, 1);
            if (!record.items.length) delete _ns.sentenceNotesMap[sentenceId];
            else _ns.sentenceNotesMap[sentenceId] = record;
            _ns.notePreviewEditingItemId = '';
            saveSentenceNotesDebounced();
            if (shouldRender) renderNotePreviewSidebar();
            return false;
        }
        item.updatedAt = Date.now();
        _ns.sentenceNotesMap[sentenceId] = record;
        _ns.notePreviewEditingItemId = '';
        saveSentenceNotesDebounced();
        triggerSentenceNoteSavedFeedback(itemId);
        if (shouldRender) renderNotePreviewSidebar();
        return true;
    }

    function persistSelectedSentenceNote() {
        if (!_ns.selectedSentence) return;
        if (_ns.sentenceNoteDraft && _ns.sentenceNoteDraft.sentenceId === _ns.selectedSentence.sentenceId) {
            commitSentenceNoteDraft(false);
        }
        if (_ns.notePreviewEditingItemId) {
            persistSentenceNoteItem(String(_ns.selectedSentence.sentenceId || ''), _ns.notePreviewEditingItemId, false);
        }
        persistSentenceNotesForCurrentDoc();
        renderNotePreviewSidebar();
    }

    // Sentence notebook: rendering + interaction wiring
    function buildSentenceNoteItemElement(sentenceId, item, { isDraft = false } = {}) {
        const wrapper = document.createElement('article');
        wrapper.className = 'sentence-note-item';
        wrapper.dataset.itemId = String(item.itemId || '');
        if (isDraft) wrapper.classList.add('is-draft');
        if (_ns.notePreviewEditingItemId && _ns.notePreviewEditingItemId === item.itemId) wrapper.classList.add('is-editing');

        const selectedTextEl = document.createElement('p');
        selectedTextEl.className = 'sentence-note-item-text';
        selectedTextEl.textContent = String(item.selectedText || '').trim() || 'Selected text';
        wrapper.appendChild(selectedTextEl);

        const textarea = document.createElement('textarea');
        textarea.className = 'sentence-note-item-body';
        textarea.placeholder = 'Write note for this selected text...';
        textarea.value = String(item.noteBody || '');
        textarea.dataset.itemId = String(item.itemId || '');
        textarea.dataset.sentenceId = String(sentenceId || '');
        textarea.dataset.isDraft = isDraft ? 'true' : 'false';
        wrapper.appendChild(textarea);

        const meta = document.createElement('div');
        meta.className = 'sentence-note-item-meta';
        if (_ns.notePreviewEditingItemId && _ns.notePreviewEditingItemId === item.itemId) meta.classList.add('is-editing');
        if (_ns.notePreviewSavedItemId && _ns.notePreviewSavedItemId === item.itemId) meta.classList.add('is-saved');
        meta.textContent = formatSentenceNoteItemMeta(item, item.itemId, _ns.notePreviewEditingItemId === item.itemId);
        wrapper.appendChild(meta);

        textarea.addEventListener('focus', () => {
            _ns.notePreviewSavedItemId = '';
            _ns.notePreviewEditingItemId = String(item.itemId || '');
            if (notePreviewSidebar) notePreviewSidebar.classList.add('note-editing');
            wrapper.classList.add('is-editing');
            meta.classList.remove('is-saved');
            meta.classList.add('is-editing');
            meta.textContent = 'Editing note...';
            textarea.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        });
        textarea.addEventListener('input', (e) => {
            const value = String(e.target.value || '');
            _ns.notePreviewSavedItemId = '';
            _ns.notePreviewEditingItemId = String(item.itemId || '');
            if (isDraft && _ns.sentenceNoteDraft && _ns.sentenceNoteDraft.itemId === item.itemId) {
                _ns.sentenceNoteDraft.noteBody = value;
                _ns.sentenceNoteDraft.updatedAt = Date.now();
            } else {
                const found = findSentenceNoteItem(sentenceId, item.itemId);
                if (found.item) {
                    found.item.noteBody = value;
                    _ns.sentenceNotesMap[String(sentenceId || '')] = found.record;
                }
            }
            wrapper.classList.add('is-editing');
            meta.classList.remove('is-saved');
            meta.classList.add('is-editing');
            meta.textContent = 'Editing note...';
        });
        textarea.addEventListener('blur', () => {
            if (isDraft) commitSentenceNoteDraft();
            else persistSentenceNoteItem(String(sentenceId || ''), String(item.itemId || ''));
        });
        return wrapper;
    }

    function renderNotePreviewSidebar() {
        if (!notePreviewSidebar || !notePreviewEmpty || !notePreviewList) return;
        const previousScrollTop = notePreviewList.scrollTop;
        applyNotePreviewWidth();
        document.body.classList.toggle('note-preview-open', !!notePreviewVisible);
        if (toggleNotePreviewBtn) toggleNotePreviewBtn.classList.toggle('active', !!notePreviewVisible);
        notePreviewSidebar.classList.toggle('note-editing', !!_ns.notePreviewEditingItemId);
        notePreviewSidebar.classList.toggle('note-has-selection', !!_ns.selectedSentence);
        if (!_ns.selectedSentence) {
            showNotePreviewEmptyState('No sentence selected\nClick a sentence to view its note here.');
            return;
        }
        const sentenceId = String(_ns.selectedSentence.sentenceId || '');
        const items = getSortedSentenceNoteItems(sentenceId);
        const hasDraft = !!(_ns.sentenceNoteDraft && _ns.sentenceNoteDraft.sentenceId === sentenceId);
        const renderItems = hasDraft ? [...items, _ns.sentenceNoteDraft] : items;
        if (!renderItems.length) {
            showNotePreviewEmptyState('No note items yet.\nSelect a word or phrase in this sentence to start a note.');
            return;
        }
        notePreviewEmpty.hidden = true;
        notePreviewList.hidden = false;
        notePreviewList.innerHTML = '';
        const frag = document.createDocumentFragment();
        renderItems.forEach(item => {
            frag.appendChild(buildSentenceNoteItemElement(sentenceId, item, {
                isDraft: !!(_ns.sentenceNoteDraft && _ns.sentenceNoteDraft.itemId === item.itemId)
            }));
        });
        notePreviewList.appendChild(frag);
        if (notePreviewPendingScrollItemId) {
            const target = notePreviewList.querySelector(`.sentence-note-item[data-item-id="${CSS.escape(notePreviewPendingScrollItemId)}"]`);
            if (target) {
                requestAnimationFrame(() => {
                    target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
                });
            }
            notePreviewPendingScrollItemId = '';
            notePreviewListScrollTop = notePreviewList.scrollTop;
            return;
        }
        notePreviewList.scrollTop = Number.isFinite(notePreviewListScrollTop) ? notePreviewListScrollTop : previousScrollTop;
        notePreviewListScrollTop = notePreviewList.scrollTop;
    }

    function showNotePreviewEmptyState(message) {
        notePreviewEmpty.hidden = false;
        notePreviewEmpty.textContent = message;
        notePreviewList.hidden = true;
        notePreviewList.innerHTML = '';
        notePreviewListScrollTop = 0;
    }

    // Sentence notebook: panel visibility + sentence selection
    function toggleNotePreviewSidebar(forceState = null) {
        notePreviewVisible = forceState === null ? !notePreviewVisible : !!forceState;
        try { localStorage.setItem('notePreviewVisible', notePreviewVisible ? 'true' : 'false'); } catch (err) {}
        renderNotePreviewSidebar();
        setTimeout(() => window.dispatchEvent(new Event('resize')), 50);
    }

    function setSelectedSentence(nextSentence) {
        persistSelectedSentenceNote();
        _ns.notePreviewSavedItemId = '';
        _ns.notePreviewEditingItemId = '';
        _ns.selectedSentence = nextSentence ? { ...nextSentence } : null;
        renderNotePreviewSidebar();
    }

    function updateSentenceFocusPhrase(sentence, focusPhrase) {
        if (!sentence) return;
        const sentenceId = String(sentence.sentenceId || '');
        const nextSelectedText = String(focusPhrase || '').replace(/\s+/g, ' ').trim();
        if (!sentenceId || !nextSelectedText) return;
        persistSelectedSentenceNote();
        _ns.notePreviewSavedItemId = '';
        _ns.notePreviewEditingItemId = '';
        _ns.selectedSentence = { ...sentence };
        _ns.sentenceNoteDraft = {
            sentenceId,
            itemId: makeSentenceNoteItemId(sentenceId),
            selectedText: nextSelectedText,
            noteBody: '',
            createdAt: Date.now(),
            updatedAt: Date.now()
        };
        _ns.notePreviewEditingItemId = _ns.sentenceNoteDraft.itemId;
        notePreviewPendingScrollItemId = _ns.sentenceNoteDraft.itemId;
        renderNotePreviewSidebar();
    }

    // Sentence notebook: selection capture + import/export integration
    function getSelectionChunkSentence() {
        if (!isChunkMode || !hasAiChunkData) return null;
        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
        const selectedText = selection.toString().replace(/\s+/g, ' ').trim();
        if (!selectedText) return null;
        const range = selection.getRangeAt(0);
        const startElement = range.startContainer.nodeType === Node.ELEMENT_NODE
            ? range.startContainer
            : range.startContainer.parentElement;
        const endElement = range.endContainer.nodeType === Node.ELEMENT_NODE
            ? range.endContainer
            : range.endContainer.parentElement;
        const startBlock = startElement && startElement.closest ? startElement.closest('.chunk-block') : null;
        const endBlock = endElement && endElement.closest ? endElement.closest('.chunk-block') : null;
        if (!startBlock || !endBlock || startBlock !== endBlock) return null;
        const enDiv = startBlock.querySelector('.chunk-en');
        if (!enDiv || !enDiv.contains(range.commonAncestorContainer)) return null;
        const sentenceId = String(startBlock.dataset.chunkRef || '');
        const index = Number(startBlock.dataset.chunkIdx || '-1');
        const text = (enDiv.textContent || '').replace(/\s+/g, ' ').trim();
        if (!sentenceId || index < 0) return null;
        return {
            sentenceId,
            chunkRef: sentenceId,
            index,
            text,
            focusPhrase: selectedText
        };
    }

    function maybeCaptureSentenceFocusPhrase() {
        const selected = getSelectionChunkSentence();
        if (!selected) return false;
        updateSentenceFocusPhrase(selected, selected.focusPhrase);
        return true;
    }

    function applyImportedSentenceNotesSnapshot(data) {
        if (!isPlainObjectRecord(data)) {
            throw new Error('invalid sentence notebook json');
        }
        const importDocId = String(data.docId || '');
        if (!importDocId) {
            throw new Error('missing docId');
        }
        if (importDocId !== _ns.currentDocId) {
            throw new Error('docId mismatch');
        }
        if (!isPlainObjectRecord(data.notes)) {
            throw new Error('missing notes payload');
        }
        _ns.sentenceNotesMap = normalizeSentenceNotesScope(data.notes);
        _ns.allSentenceNotesByDoc[_ns.currentDocId] = normalizeSentenceNotesScope(_ns.sentenceNotesMap);
        _ns.sentenceNoteDraft = null;
        _ns.notePreviewEditingItemId = '';
        _ns.notePreviewSavedItemId = '';
        saveToDB(getSentenceNotesStorageKey(), _ns.allSentenceNotesByDoc);
        renderNotePreviewSidebar();
    }

    function initNotePreviewResize() {
        if (notePreviewResizeHandle && notePreviewSidebar) {
            notePreviewResizeHandle.addEventListener('mousedown', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const startX = e.clientX;
                const startWidth = notePreviewWidth;
                const move = (ev) => {
                    const delta = startX - ev.clientX;
                    notePreviewWidth = Math.max(280, Math.min(520, startWidth + delta));
                    if (!notePreviewResizeRaf) {
                        notePreviewResizeRaf = requestAnimationFrame(() => {
                            notePreviewResizeRaf = 0;
                            applyNotePreviewWidth();
                        });
                    }
                };
                const up = () => {
                    document.removeEventListener('mousemove', move);
                    document.removeEventListener('mouseup', up);
                    document.body.classList.remove('note-preview-resizing');
                    if (notePreviewResizeRaf) {
                        cancelAnimationFrame(notePreviewResizeRaf);
                        notePreviewResizeRaf = 0;
                    }
                    applyNotePreviewWidth();
                    try { localStorage.setItem('notePreviewWidth', String(notePreviewWidth)); } catch (err) {}
                };
                document.body.classList.add('note-preview-resizing');
                document.addEventListener('mousemove', move);
                document.addEventListener('mouseup', up);
            });
        }
        if (notePreviewResizeHandleY && notePreviewSidebar) {
            notePreviewResizeHandleY.addEventListener('mousedown', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const startY = e.clientY;
                const startHeight = notePreviewHeight;
                const move = (ev) => {
                    const delta = ev.clientY - startY;
                    notePreviewHeight = Math.max(420, Math.min(window.innerHeight - 28, startHeight + delta));
                    if (!notePreviewResizeRaf) {
                        notePreviewResizeRaf = requestAnimationFrame(() => {
                            notePreviewResizeRaf = 0;
                            applyNotePreviewWidth();
                        });
                    }
                };
                const up = () => {
                    document.removeEventListener('mousemove', move);
                    document.removeEventListener('mouseup', up);
                    document.body.classList.remove('note-preview-resizing-y');
                    if (notePreviewResizeRaf) {
                        cancelAnimationFrame(notePreviewResizeRaf);
                        notePreviewResizeRaf = 0;
                    }
                    applyNotePreviewWidth();
                    try { localStorage.setItem('notePreviewHeight', String(notePreviewHeight)); } catch (err) {}
                };
                document.body.classList.add('note-preview-resizing-y');
                document.addEventListener('mousemove', move);
                document.addEventListener('mouseup', up);
            });
        }
    }

    function toggleChunkMode(forceState = null) {
        if (!chunkItems || chunkItems.length === 0 || !hasAiChunkData) {
            chunkFileInput.click(); 
            return;
        }

        const newState = forceState !== null ? forceState : !isChunkMode;
        if (newState === isChunkMode) return;
        
        // Scroll Anchoring
        let anchorRatio = 0;
        const container = document.getElementById('main-app-area');
        let anchorEl = null;
        if (isChunkMode) {
             anchorEl = document.querySelector('.chunk-active') || document.querySelector('.chunk-block');
        } else {
             anchorEl = document.querySelector('.sentence-active') || document.querySelector('.transcript-line');
        }

        if (anchorEl) {
            const rect = anchorEl.getBoundingClientRect();
            const containerRect = container.getBoundingClientRect();
            anchorRatio = (rect.top - containerRect.top);
        }

        isChunkMode = newState;
        if (!isChunkMode) {
            lastAiPrevTapChunkIndex = -1;
            lastAiPrevTapAt = 0;
        }
        localStorage.setItem('isChunkMode', isChunkMode);
        toggleChunkBtn.classList.toggle('active', isChunkMode);
        updateHighlightModeUI();
        closeChunkNoteContextMenu();
        closeChunkNotePopover();
        
        if (isChunkMode) {
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
             if (isChunkMode) {
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
        if (!isChunkMode) return;
        chunkCnVisible = !!value;
        if (persist) localStorage.setItem('st.chunkCnVisible', String(chunkCnVisible));
        const els = document.querySelectorAll('.chunk-cn');
        els.forEach(el => {
            if (chunkCnVisible) el.classList.remove('hidden-cn');
            else el.classList.add('hidden-cn');
        });
        bridgeToPinia();
    }

    function toggleChunkCn() {
        if (!isChunkMode) return;
        setChunkCnVisible(!chunkCnVisible, true);
    }

    function updateChunkCnHoldBtn() {
        const btn = document.getElementById('btn-chunk-cn-hold');
        if (!btn) return;
        btn.classList.toggle('active', chunkCnHoldMode);
        btn.innerText = chunkCnHoldMode ? '按住' : '持续';
        bridgeToPinia();
    }

    function toggleChunkCnHoldMode() {
        chunkCnHoldMode = !chunkCnHoldMode;
        localStorage.setItem('st.chunkCnHoldMode', String(chunkCnHoldMode));
        updateChunkCnHoldBtn();
    }

    function beginHoldChunkCn() {
        if (!isChunkMode) return;
        if (isHoldingChunkCn) return;
        isHoldingChunkCn = true;
        holdPrevChunkCnVisible = chunkCnVisible;
        const container = document.getElementById('transcript-container');
        holdPrevHadFocusClass = container.classList.contains('cn-mode-focus');
        // 涓存椂寮哄埗鑱氱劍锛屽彧鏄剧ず褰撳墠鍙ュ潡鐨勪腑鏂?
        if (!holdPrevHadFocusClass) container.classList.add('cn-mode-focus');
        // 涓存椂鏄剧ず涓枃锛堜笉鍐欏叆鏈湴瀛樺偍锛?
        if (!chunkCnVisible) setChunkCnVisible(true, false);
    }

    function endHoldChunkCn() {
        if (!isChunkMode) return;
        if (!isHoldingChunkCn) return;
        isHoldingChunkCn = false;
        const container = document.getElementById('transcript-container');
        if (holdPrevHadFocusClass === false) container.classList.remove('cn-mode-focus');
        if (holdPrevChunkCnVisible === false) setChunkCnVisible(false, false);
        holdPrevChunkCnVisible = null;
        holdPrevHadFocusClass = null;
        bridgeToPinia();
    }

    // Toggle Focus Mode

    function updateChunkFocusModeUI() {
        const btn = document.getElementById('btn-chunk-focus');
        const legacyContainer = document.getElementById('transcript-container');
        const vueContainer = document.getElementById('chunk-vue-container');
        const isFocus = chunkCnMode === 'focus';
        if (btn) {
            btn.innerText = isFocus ? '聚焦' : '全局';
            btn.classList.toggle('active', isFocus);
        }
        if (legacyContainer) legacyContainer.classList.toggle('cn-mode-focus', isFocus);
        if (vueContainer) vueContainer.classList.toggle('cn-mode-focus', isFocus);
        bridgeToPinia();
    }

    function toggleChunkFocusMode() {
        if (!isChunkMode) return;
        chunkCnMode = chunkCnMode === 'global' ? 'focus' : 'global';
        localStorage.setItem('st.chunkCnMode', chunkCnMode);
        updateChunkFocusModeUI();
    }

    // Shadow Toggle Logic
    function toggleChunkShadow() {
        isChunkShadowOn = !isChunkShadowOn;
        localStorage.setItem('isChunkShadowOn', isChunkShadowOn);
        
        if (isChunkShadowOn) {
            document.body.classList.remove('hide-chunk-shadow');
        } else {
            document.body.classList.add('hide-chunk-shadow');
        }
        updateShadowBtnText();
    }
    
    function updateShadowBtnText() {
        const btn = document.getElementById('btn-toggle-shadow-manual');
        if(btn) btn.innerText = isChunkShadowOn ? "开关 S" : "开关 S";
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
        highlightMode = (highlightMode + 1) % 3;
        lastActiveSegIndex = -1; 
        updateHighlightModeUI();
        forceUpdateUI(audioPlayer.currentTime);
    }

    function updateHighlightModeUI() {
        const txt = ['高亮:关', '高亮:词', '高亮:句'][highlightMode];
        if (!highlightModeBtn) return;
        highlightModeBtn.textContent = txt;
        highlightModeBtn.classList.toggle('active', highlightMode !== 0);
        document.body.classList.toggle('highlight-sentence-mode', highlightMode === 2 && !isChunkMode);
    }
    updateHighlightModeUI();

    function findChunkIndexByTime(t) {
        return findChunkIndexByTimeHelper(chunkItems, t);
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
        isInputLikeTarget: isInputLikeTarget,
        isChunkMode: function () { return isChunkMode; },
        chunkCnHoldMode: function () { return chunkCnHoldMode; },
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
        chunkNoteDeleteDialogEl: chunkNoteDeleteDialogEl,
        chunkNoteExportDialogEl: chunkNoteExportDialogEl,
        chunkNoteModalEl: chunkNoteModalEl,
        saveChunkNoteFromModal: saveChunkNoteFromModal
    });

    // Functions called by keyboard-module (defined here to avoid circular deps)
    function toggleCurrentNote() {
        if (isChunkMode) return;
        var targetIdx = -1;
        if (currentWordIndex !== -1) {
            var w = words[currentWordIndex];
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
        var sIdx = getCurrentSegmentIndexHelper(segments, words, wordStarts, cur);
        var targetTime = 0;
        if (sIdx !== -1) {
            var now = Date.now();
            if (lastSentencePrevTapSegIndex === sIdx && (now - lastSentencePrevTapAt) <= 600) {
                targetTime = sIdx > 0 ? segments[sIdx - 1].start : segments[sIdx].start;
                lastSentencePrevTapSegIndex = -1; lastSentencePrevTapAt = 0;
            } else {
                targetTime = segments[sIdx].start;
                lastSentencePrevTapSegIndex = sIdx; lastSentencePrevTapAt = now;
            }
        } else { lastSentencePrevTapSegIndex = -1; lastSentencePrevTapAt = 0; }
        audioPlayer.currentTime = targetTime;
        forceUpdateUI(targetTime);
    }

    function jumpNextSentence() {
        var cur = audioPlayer.currentTime;
        var sIdx = getCurrentSegmentIndexHelper(segments, words, wordStarts, cur);
        var next = (sIdx >= 0 && sIdx < segments.length - 1) ? segments[sIdx + 1] : null;
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
        window.__marksStore.toggleMark(markedMap, currentWordIndex, words, saveToDB, syncAnnotationGenerationEntryStatus);
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
                    if (hasAiChunkData) {
                        if (!isChunkMode) toggleChunkMode(true);
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

    if (exportAnnotationLightweightBtn) {
        exportAnnotationLightweightBtn.addEventListener('click', () => {
            try {
                exportManualLightweightAnnotations();
            } catch (error) {
                showError('ANNOTATION_LIGHT_EXPORT', error && error.message ? error.message : 'Export failed');
            }
        });
    }

    if (importAnnotationLightweightBtn && importAnnotationLightweightInput) {
        importAnnotationLightweightBtn.addEventListener('click', () => importAnnotationLightweightInput.click());
        importAnnotationLightweightInput.addEventListener('change', async (event) => {
            const file = getFirstFileFromEvent(event);
                importAnnotationLightweightInput.value = '';
            if (!file) return;
            try {
                const result = await importManualLightweightAnnotations(file);
                if (isChunkMode) renderChunkMode(); else renderTranscript();
                forceUpdateUI(audioPlayer.currentTime);
                const mismatchSuffix = result.markedTextMismatchTargetIds.length
                    ? `，markedText 校验不一致 ${result.markedTextMismatchTargetIds.length} 条`
                    : '';
                const ambiguousSuffix = result.ambiguousItems.length
                    ? `，歧义未导入 ${result.ambiguousItems.length} 条`
                    : '';
                const skippedSuffix = result.skippedCount
                    ? `，跳过 ${result.skippedCount} 条`
                    : '';
                showToast(`轻量回填完成 ${result.importedCount} 条${skippedSuffix}${ambiguousSuffix}${mismatchSuffix}`, 'success');
            } catch (error) {
                showError('ANNOTATION_LIGHT_IMPORT', error && error.message ? error.message : 'Import failed');
            }
        });
    }

    // Annotation prompt handlers → controls-module
    
    importMarksInput.addEventListener('change', e => {
        const f = getFirstFileFromEvent(e);
        if(!f) return;
        readFileAsText(f, (rawText) => {
            try {
                const arr = validateMarksArray(JSON.parse(rawText), words.length);
                markedMap.clear();
                arr.forEach(mark => {
                    if (mark.globalIndex < words.length) {
                        markedMap.set(mark.globalIndex, {
                            ...mark,
                            sourceType: String(mark.sourceType || mark.source || 'marks-json')
                        });
                    }
                });
                saveToDB('marks', Array.from(markedMap.values())); 
                if(isChunkMode) renderChunkMode(); else renderTranscript();
                forceUpdateUI(audioPlayer.currentTime);
                syncAnnotationGenerationEntryStatus();
                showToast('Marks imported', 'success');
            } catch(x){ showError('MARKS_IMPORT', x && x.message ? x.message : 'Invalid marks file'); }
        });
    });

    // [MIGRATED] exports → src/composables/app-handlers.js
    window.__appHandlers.initExports({
        exportJsonBtn: exportJsonBtn, exportMdAllBtn: exportMdAllBtn,
        markedMap: markedMap, segments: segments,
        showError: showError, showToast: showToast
    });

    window.__appHandlers.initMarksImport({
        importMarksBtn: importMarksBtn, importMarksInput: importMarksInput,
        getFirstFileFromEvent: getFirstFileFromEvent,
        readFileAsText: readFileAsText,
        validateMarksArray: validateMarksArray,
        words: words, markedMap: markedMap,
        saveToDB: saveToDB,
        isChunkModeFn: function () { return isChunkMode; },
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
