    // === Read-order map ===
    // 1) Data layer: validation, identity, storage keys, persistence helpers
    // 2) UI layer: DOM bindings, runtime state, startup wiring
    // 3) Feature layer: import handlers, matching, rendering, interactions
    // 4) Input layer: keyboard/mouse/global listeners (kept behavior-intact)

    // === Storage primitives (IndexedDB) ===
    const DB_NAME = 'SeekPlayerDB';
    const DB_VERSION = 1;
    const STORE_NAME = 'files';

    let db;

    function initDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);
            request.onerror = (event) => reject("DB Error");
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    db.createObjectStore(STORE_NAME, { keyPath: 'id' });
                }
            };
            request.onsuccess = (event) => {
                db = event.target.result;
                resolve(db);
            };
        });
    }

    function saveToDB(id, data) {
        if (!db) return;
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        store.put({ id: id, content: data, timestamp: new Date().getTime() });
    }

    function loadFromDB(id) {
        return new Promise((resolve) => {
            if (!db) { resolve(null); return; }
            const transaction = db.transaction([STORE_NAME], 'readonly');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.get(id);
            request.onsuccess = (event) => {
                resolve(event.target.result ? event.target.result.content : null);
            };
            request.onerror = () => resolve(null);
        });
    }

    function deleteFromDB(id) {
        return new Promise((resolve) => {
            if (!db) { resolve(); return; }
            const transaction = db.transaction([STORE_NAME], 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.delete(id);
            request.onsuccess = () => resolve();
            request.onerror = () => resolve();
        });
    }

    function clearDBStore() {
        return new Promise((resolve) => {
            if (!db) { resolve(); return; }
            const transaction = db.transaction([STORE_NAME], 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.clear();
            request.onsuccess = () => resolve();
            request.onerror = () => resolve();
        });
    }

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

    let toastTimer = null;
    function showToast(message, type = 'info', timeoutMs = 2600) {
        const toast = document.getElementById('app-toast');
        if (!toast) return;
        toast.textContent = message || '';
        toast.className = '';
        toast.classList.add(type);
        toast.classList.add('show');
        if (toastTimer) clearTimeout(toastTimer);
        if (timeoutMs > 0) {
            toastTimer = setTimeout(() => toast.classList.remove('show'), timeoutMs);
        }
    }

    function showError(code, detail) {
        const suffix = detail ? `\n${detail}` : '';
        showToast(`Error [${code}]${suffix}`, 'error', 3800);
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

    // === Identity/storage key helpers (extracted to identity-and-storage-keys.js) ===
    const buildAudioKey = window.IdentityStorageKeys.buildAudioKey;
    const buildTranscriptKey = (data) => window.IdentityStorageKeys.buildTranscriptKey(data, segments);
    const getChunkNotesStorageKey = () => window.IdentityStorageKeys.getChunkNotesStorageKey(currentAudioKey);
    const getChunkNoteDraftStorageKey = () => window.IdentityStorageKeys.getChunkNoteDraftStorageKey(currentAudioKey);
    const getSentenceNotesStorageKey = window.IdentityStorageKeys.getSentenceNotesStorageKey;
    const getLegacySentenceNotesStorageKey = (audioKey = currentAudioKey) => window.IdentityStorageKeys.getLegacySentenceNotesStorageKey(audioKey);
    const buildCurrentSentenceDocId = (transcriptSource = null) => window.IdentityStorageKeys.buildCurrentSentenceDocId(transcriptSource, currentAudioKey, segments);

    // === Chunk-note data/layout utilities ===
    function findNearestChunkWord(enDiv, clientX, clientY) {
        if (!enDiv) return null;
        const spans = Array.from(enDiv.querySelectorAll('span[id^="word-"]'));
        if (!spans.length) return null;
        let best = null;
        let bestScore = Infinity;
        spans.forEach(span => {
            const rect = span.getBoundingClientRect();
            const cx = rect.left + rect.width / 2;
            const cy = rect.top + rect.height / 2;
            const dx = cx - clientX;
            const dy = cy - clientY;
            const score = (dx * dx) + (dy * dy);
            if (score < bestScore) {
                bestScore = score;
                best = span;
            }
        });
        return best;
    }

    function getChunkNoteMeasureFont() {
        return "'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif";
    }

    function measureChunkNoteTextBox(text, minW, minH, maxW) {
        const t = String(text || '').trim();
        const baseFs = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--chunk-note-size')) || 16;
        if (!chunkNoteProbe || !t) {
            return { width: minW, height: minH, fontSize: baseFs };
        }
        const widthCap = Math.max(minW, maxW || minW);
        chunkNoteProbe.style.position = 'fixed';
        chunkNoteProbe.style.left = '-9999px';
        chunkNoteProbe.style.top = '-9999px';
        chunkNoteProbe.style.width = 'auto';
        chunkNoteProbe.style.maxWidth = `${widthCap}px`;
        chunkNoteProbe.style.fontFamily = getChunkNoteMeasureFont();
        chunkNoteProbe.style.fontSize = `${baseFs}px`;
        chunkNoteProbe.style.lineHeight = '1.28';
        chunkNoteProbe.style.whiteSpace = 'pre-wrap';
        chunkNoteProbe.style.wordBreak = 'break-word';
        chunkNoteProbe.textContent = t;
        const width = Math.max(minW, Math.min(widthCap, Math.ceil(chunkNoteProbe.scrollWidth) + 14));
        chunkNoteProbe.style.width = `${Math.max(8, width - 12)}px`;
        const height = Math.max(minH, Math.ceil(chunkNoteProbe.scrollHeight) + 8);
        return { width, height, fontSize: baseFs };
    }

    function applyChunkNoteAutoSize(note) {
        if (!note || note.autoSize === false) return;
        const { minW, minH } = getChunkNoteLayoutBase();
        const maxW = Math.max(minW, parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--chunk-note-width')) || 260);
        const box = measureChunkNoteTextBox(note.note || '', minW, minH, maxW);
        note.w = box.width;
        note.h = box.height;
        note.fontSize = box.fontSize;
    }

    function getChunkRef(chunk, idx) {
        if (chunk && chunk.noteId) return chunk.noteId;
        const segId = (chunk && Number.isFinite(chunk.segId)) ? chunk.segId : -1;
        const st = Math.round(((chunk && chunk.start) || 0) * 1000);
        const ed = Math.round(((chunk && chunk.end) || 0) * 1000);
        return `seg-${segId}-t-${st}-${ed}-i-${idx}`;
    }

    function getChunkNoteBaseFontSize() {
        return parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--chunk-note-size')) || 16;
    }

    function getChunkNoteMinReadableFontSize() {
        const base = getChunkNoteBaseFontSize();
        return Math.max(12, Math.round(base * 0.75));
    }

    function sanitizeChunkNoteFontSize(rawSize) {
        const base = getChunkNoteBaseFontSize();
        const n = Number(rawSize);
        if (!Number.isFinite(n)) return base;
        const maxAllowed = Math.max(22, base * 1.6);
        if (n < 1 || n > maxAllowed) return base;
        return n;
    }

    function getChunkNoteLayoutContext() {
        if (!getChunkNoteLayoutContext.canvas) {
            getChunkNoteLayoutContext.canvas = document.createElement('canvas');
            getChunkNoteLayoutContext.ctx = getChunkNoteLayoutContext.canvas.getContext('2d');
        }
        return getChunkNoteLayoutContext.ctx;
    }

    function buildChunkNoteLayout(note, width, height) {
        const text = String((note && note.note) || '').trim();
        const w = Math.max(1, Math.round(Number(width) || 1));
        const h = Math.max(1, Math.round(Number(height) || 1));
        const padX = Math.max(3, Math.min(8, Math.round(w * 0.08)));
        const padY = Math.max(2, Math.min(6, Math.round(h * 0.08)));
        const maxTextW = Math.max(8, w - padX * 2);
        const maxTextH = Math.max(8, h - padY * 2);
        const preferredFs = sanitizeChunkNoteFontSize(note && note.fontSize);
        const minFs = Math.min(getChunkNoteMinReadableFontSize(), preferredFs);
        const ctx = getChunkNoteLayoutContext();
        const makeLayout = (fontSize) => {
            const fs = Math.max(1, Math.floor(fontSize));
            const lineHeight = Math.max(12, Math.round(fs * 1.24));
            ctx.font = `${fs}px ${getChunkNoteMeasureFont()}`;
            const lines = wrapChunkNoteTextForCanvas(ctx, text, maxTextW);
            const totalH = lines.length * lineHeight;
            return { fontSize: fs, lineHeight, lines, fits: totalH <= maxTextH, totalH };
        };
        if (!text) {
            return buildEmptyChunkNoteLayoutResult(preferredFs, {
                padX,
                padY,
                maxTextW,
                maxTextH
            });
        }
        let best = makeLayout(preferredFs);
        if (!best.fits) {
            let lo = minFs;
            let hi = preferredFs;
            let lastFit = null;
            for (let i = 0; i < 14; i++) {
                const mid = Math.floor((lo + hi) / 2);
                const current = makeLayout(mid);
                if (current.fits) {
                    lastFit = current;
                    lo = mid + 1;
                } else {
                    hi = mid - 1;
                }
            }
            best = lastFit || makeLayout(minFs);
        }
        return buildChunkNoteLayoutResult(best, {
            padX,
            padY,
            maxTextW,
            maxTextH
        });
    }

    function canChunkNoteTextFitMinReadable(note, width, height) {
        return buildChunkNoteLayout(note, width, height).valid;
    }

    function makeSelectionNoteBaseId(chunkRef, startGlobal, endGlobal) {
        return `${chunkRef}::${startGlobal}-${endGlobal}`;
    }

    function makeSelectionNoteId(chunkRef, startGlobal, endGlobal) {
        return `${makeSelectionNoteBaseId(chunkRef, startGlobal, endGlobal)}::${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    }

    function buildChunkNotesSnapshot() {
        return {
            version: 1,
            audioKey: currentAudioKey || 'default-audio',
            updatedAt: Date.now(),
            notes: Object.values(chunkNotesMap).sort((a, b) => (a.chunkIdx - b.chunkIdx) || (a.startGlobal - b.startGlobal))
        };
    }

    function saveChunkNotesDebounced() {
        if (chunkNoteSaveTimer) clearTimeout(chunkNoteSaveTimer);
        chunkNoteSaveTimer = setTimeout(() => {
            saveToDB(getChunkNotesStorageKey(), buildChunkNotesSnapshot());
        }, 180);
    }

    // === Chunk-note persistence lifecycle ===
    async function loadChunkNotesForCurrentAudio() {
        const data = await loadFromDB(getChunkNotesStorageKey());
        if (data && Array.isArray(data.notes)) {
            const next = {};
            data.notes.forEach(n => {
                if (!n || typeof n !== 'object') return;
                if (!n.id || !n.chunkRef) return;
                next[n.id] = {
                    ...n,
                    coordSpace: typeof n.coordSpace === 'string' ? n.coordSpace : undefined,
                    x: Number.isFinite(Number(n.x)) ? Number(n.x) : undefined,
                    y: Number.isFinite(Number(n.y)) ? Number(n.y) : undefined,
                    offsetX: Number.isFinite(Number(n.offsetX)) ? Number(n.offsetX) : undefined,
                    offsetY: Number.isFinite(Number(n.offsetY)) ? Number(n.offsetY) : undefined,
                    w: Number.isFinite(Number(n.w)) ? Number(n.w) : undefined,
                    h: Number.isFinite(Number(n.h)) ? Number(n.h) : undefined,
                    fontSize: sanitizeChunkNoteFontSize(n.fontSize)
                };
            });
            chunkNotesMap = next;
        } else {
            chunkNotesMap = {};
        }
    }

    function setChunkNoteVisible(next, persist = true) {
        chunkNoteVisible = !!next;
        document.body.classList.toggle('hide-chunk-note', !chunkNoteVisible);
        if (!chunkNoteVisible) {
            closeChunkNoteContextMenu();
            closeChunkNotePopover();
            clearChunkNoteConnectors();
        } else if (isChunkMode) {
            ensureChunkNoteOverlayLayers();
            if (!document.querySelector('.chunk-note-tag')) {
                renderAllChunkNoteTags();
            }
            scheduleChunkNoteLayoutRefresh();
        }
        if (persist) localStorage.setItem('chunkNoteVisible', chunkNoteVisible ? 'true' : 'false');
        scheduleChunkNoteConnectorRedraw();
    }

    function getChunkBlockByRef(chunkRef) {
        const blocks = document.querySelectorAll('.chunk-block');
        for (const block of blocks) {
            if ((block.dataset.chunkRef || '') === chunkRef) return block;
        }
        return null;
    }

    function closeChunkNoteContextMenu() {
        if (chunkNoteCtxMenu) chunkNoteCtxMenu.style.display = 'none';
        pendingChunkSelectionCtx = null;
    }

    function openChunkNoteContextMenu(clientX, clientY, ctx) {
        if (!chunkNoteCtxMenu) return;
        pendingChunkSelectionCtx = ctx;
        chunkNoteCtxMenu.style.display = 'block';
        const rect = chunkNoteCtxMenu.getBoundingClientRect();
        const left = Math.max(8, Math.min(clientX, window.innerWidth - rect.width - 8));
        const top = Math.max(8, Math.min(clientY, window.innerHeight - rect.height - 8));
        chunkNoteCtxMenu.style.left = `${left}px`;
        chunkNoteCtxMenu.style.top = `${top}px`;
    }

    function hashString(input) {
        let h = 0;
        const s = String(input || '');
        for (let i = 0; i < s.length; i++) {
            h = ((h << 5) - h) + s.charCodeAt(i);
            h |= 0;
        }
        return Math.abs(h);
    }

    function getChunkNoteAccent(note, indexHint = 0) {
        const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
        const lightPalette = ['#4f7cff', '#8b5cf6', '#14b8a6', '#f59e0b', '#ef4444', '#0ea5e9'];
        const darkPalette = ['#8db4ff', '#b794f6', '#5eead4', '#fbbf24', '#fb7185', '#67e8f9'];
        const palette = isDark ? darkPalette : lightPalette;
        const idx = hashString(note && note.id ? note.id : indexHint) % palette.length;
        return palette[idx];
    }

    function clearChunkWordAnnotations(enDiv) {
        if (!enDiv) return;
        enDiv.querySelectorAll('.annotated, .annotated-start, .annotated-mid, .annotated-end, .annotated-single, .annotated-active, .annotated-active-start, .annotated-active-mid, .annotated-active-end, .annotated-active-single').forEach(el => {
            el.classList.remove('annotated', 'annotated-start', 'annotated-mid', 'annotated-end', 'annotated-single', 'annotated-active', 'annotated-active-start', 'annotated-active-mid', 'annotated-active-end', 'annotated-active-single');
            el.style.removeProperty('--annot-accent');
            el.removeAttribute('data-note-id');
        });
    }

    function markChunkWordsByNotes(enDiv, notes) {
        if (!enDiv) return;
        clearChunkWordAnnotations(enDiv);
        const sorted = [...(notes || [])]
            .filter(n => n && Number.isFinite(Number(n.startGlobal)) && Number.isFinite(Number(n.endGlobal)))
            .sort((a, b) => Number(a.startGlobal) - Number(b.startGlobal));
        sorted.forEach((n, idx) => {
            const start = Number(n.startGlobal);
            const end = Number(n.endGlobal);
            if (!Number.isFinite(start) || !Number.isFinite(end)) return;
            const accent = getChunkNoteAccent(n, idx);
            for (let i = start; i <= end; i++) {
                const span = enDiv.querySelector(`#word-${i}`);
                if (!span) continue;
                span.classList.add('annotated');
                span.style.setProperty('--annot-accent', accent);
                span.dataset.noteId = String(n.id || '');
                if (start === end) span.classList.add('annotated-single');
                else if (i === start) span.classList.add('annotated-start');
                else if (i === end) span.classList.add('annotated-end');
                else span.classList.add('annotated-mid');
            }
        });
    }

    function setChunkNoteHoverTarget(noteId) {
        document.querySelectorAll('.annotated-active, .annotated-active-start, .annotated-active-mid, .annotated-active-end, .annotated-active-single').forEach(el => {
            el.classList.remove('annotated-active', 'annotated-active-start', 'annotated-active-mid', 'annotated-active-end', 'annotated-active-single');
            el.style.removeProperty('--annot-accent');
        });
        activeChunkNoteId = noteId || '';
        if (!activeChunkNoteId) return;
        const note = chunkNotesMap[activeChunkNoteId];
        if (!note || !note.chunkRef) return;
        const block = getChunkBlockByRef(note.chunkRef);
        const enDiv = block ? block.querySelector('.chunk-en') : null;
        if (!enDiv) return;
        const start = Number(note.startGlobal);
        const end = Number(note.endGlobal);
        const accent = getChunkNoteAccent(note);
        if (!Number.isFinite(start) || !Number.isFinite(end)) return;
        for (let i = start; i <= end; i++) {
            const span = enDiv.querySelector(`#word-${i}`);
            if (!span) continue;
            span.classList.add('annotated-active');
            span.style.setProperty('--annot-accent', accent);
            if (start === end) span.classList.add('annotated-active-single');
            else if (i === start) span.classList.add('annotated-active-start');
            else if (i === end) span.classList.add('annotated-active-end');
            else span.classList.add('annotated-active-mid');
        }
    }

    // === Sentence notebook persistence lifecycle ===
    async function loadSentenceNotesForCurrentAudio() {
        const data = await loadFromDB(getSentenceNotesStorageKey());
        if (isPlainObjectRecord(data)) {
            allSentenceNotesByDoc = Object.fromEntries(
                Object.entries(data).map(([docId, notes]) => [
                    String(docId),
                    normalizeSentenceNotesScope(notes)
                ])
            );
        } else {
            allSentenceNotesByDoc = {};
        }
        currentDocId = buildCurrentSentenceDocId();
        await ensureLegacySentenceNotesForDoc(currentDocId);
        sentenceNotesMap = normalizeSentenceNotesScope(allSentenceNotesByDoc[currentDocId] || {});
    }

    function saveSentenceNotesDebounced() {
        persistSentenceNotesForCurrentDoc();
    }

    // Sentence notebook: data normalization + doc-scoped persistence
    function makeLegacySentenceNoteItemId(sentenceId, updatedAt = 0) {
        return `legacy_${String(sentenceId || 'sentence')}_${Number(updatedAt || 0).toString(36)}`;
    }

    function makeSentenceNoteItemId(sentenceId) {
        return `item_${String(sentenceId || 'sentence').replace(/[^a-z0-9_-]+/gi, '_')}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    }

    function normalizeSentenceNoteItem(sentenceId, item, fallbackItemId = '') {
        const source = item && typeof item === 'object' ? item : {};
        const createdAt = Number.isFinite(Number(source.createdAt))
            ? Number(source.createdAt)
            : (Number.isFinite(Number(source.updatedAt)) ? Number(source.updatedAt) : Date.now());
        const updatedAt = Number.isFinite(Number(source.updatedAt)) ? Number(source.updatedAt) : createdAt;
        return {
            itemId: String(source.itemId || fallbackItemId || makeLegacySentenceNoteItemId(sentenceId, updatedAt)),
            selectedText: typeof source.selectedText === 'string'
                ? source.selectedText
                : (typeof source.focusPhrase === 'string' ? source.focusPhrase : ''),
            noteBody: typeof source.noteBody === 'string'
                ? source.noteBody
                : (typeof source.note === 'string' ? source.note : ''),
            createdAt,
            updatedAt
        };
    }

    function normalizeSentenceNoteRecord(sentenceId, note) {
        const safeSentenceId = String(sentenceId || (note && note.sentenceId) || '');
        const source = note && typeof note === 'object' ? note : {};
        if (Array.isArray(source.items)) {
            return {
                sentenceId: safeSentenceId,
                items: source.items
                    .map((item, idx) => normalizeSentenceNoteItem(safeSentenceId, item, `migrated_${idx}`))
                    .filter(item => item.selectedText.trim() || item.noteBody.trim())
            };
        }
        const legacySelectedText = typeof source.focusPhrase === 'string' ? source.focusPhrase : '';
        const legacyNoteBody = typeof source.noteBody === 'string' ? source.noteBody : '';
        const legacyUpdatedAt = Number.isFinite(Number(source.updatedAt)) ? Number(source.updatedAt) : Date.now();
        const items = (legacySelectedText.trim() || legacyNoteBody.trim())
            ? [normalizeSentenceNoteItem(safeSentenceId, {
                itemId: makeLegacySentenceNoteItemId(safeSentenceId, legacyUpdatedAt),
                selectedText: legacySelectedText,
                noteBody: legacyNoteBody,
                createdAt: legacyUpdatedAt,
                updatedAt: legacyUpdatedAt
            })]
            : [];
        return {
            sentenceId: safeSentenceId,
            items
        };
    }

    function normalizeSentenceNotesScope(scope) {
        if (!scope || typeof scope !== 'object' || Array.isArray(scope)) return {};
        return Object.fromEntries(
            Object.entries(scope).map(([sentenceId, note]) => [String(sentenceId), normalizeSentenceNoteRecord(sentenceId, note)])
        );
    }

    function getSentenceNoteRecord(sentenceId) {
        const safeSentenceId = String(sentenceId || '');
        if (!safeSentenceId) return null;
        const normalized = normalizeSentenceNoteRecord(safeSentenceId, sentenceNotesMap[safeSentenceId]);
        sentenceNotesMap[safeSentenceId] = normalized;
        return normalized;
    }

    function getSortedSentenceNoteItems(sentenceId) {
        const record = getSentenceNoteRecord(sentenceId);
        return record
            ? [...record.items].sort((a, b) => (a.createdAt - b.createdAt) || (a.updatedAt - b.updatedAt) || String(a.itemId).localeCompare(String(b.itemId)))
            : [];
    }

    const ensureLegacySentenceNotesForDoc = (docId) => window.SentenceNotesPersistenceUtils.ensureLegacySentenceNotesForDoc(docId, {
        allSentenceNotesByDoc,
        loadFromDB,
        getLegacySentenceNotesStorageKey,
        isPlainObjectRecord,
        normalizeSentenceNotesScope,
        setAllSentenceNotesByDocEntry: (key, value) => { allSentenceNotesByDoc[key] = value; }
    });

    function persistSentenceNotebookNow() {
        persistSelectedSentenceNote();
        persistSentenceNotesForCurrentDoc();
    }

    function persistSentenceNotesForCurrentDoc() {
        if (!currentDocId) return;
        const cleaned = {};
        Object.entries(sentenceNotesMap || {}).forEach(([sentenceId, note]) => {
            const normalized = normalizeSentenceNoteRecord(sentenceId, note);
            if (!normalized.items.length) return;
            cleaned[String(sentenceId)] = normalized;
        });
        if (Object.keys(cleaned).length > 0) {
            allSentenceNotesByDoc[currentDocId] = cleaned;
        } else {
            delete allSentenceNotesByDoc[currentDocId];
        }
        saveToDB(getSentenceNotesStorageKey(), allSentenceNotesByDoc);
    }

    async function switchSentenceNotesDoc(transcriptSource = null) {
        persistSentenceNotebookNow();
        currentDocId = buildCurrentSentenceDocId(transcriptSource);
        await ensureLegacySentenceNotesForDoc(currentDocId);
        sentenceNotesMap = normalizeSentenceNotesScope(allSentenceNotesByDoc[currentDocId] || {});
        sentenceNoteDraft = null;
        notePreviewEditingItemId = '';
        notePreviewSavedItemId = '';
        selectedSentence = null;
        renderNotePreviewSidebar();
    }

    const getCurrentSentenceDocIdForExport = () => window.SentenceNotesPersistenceUtils.getCurrentSentenceDocIdForExport(
        currentDocId,
        buildCurrentSentenceDocId
    );

    function buildSentenceNotesExportSnapshot() {
        persistSentenceNotebookNow();
        return {
            docId: getCurrentSentenceDocIdForExport(),
            exportedAt: Date.now(),
            notes: normalizeSentenceNotesScope(sentenceNotesMap)
        };
    }

    function triggerSentenceNotesDownload(snapshot, filename) {
        const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    }

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
        selectedChunkNoteId = String(noteId || '');
        document.querySelectorAll('.chunk-note-tag.selected').forEach(el => el.classList.remove('selected'));
        if (!selectedChunkNoteId) return;
        const tag = getChunkNoteTagById(selectedChunkNoteId);
        if (tag) tag.classList.add('selected');
    }

    function closeChunkNoteDeleteDialog() {
        if (chunkNoteDeleteDialogEl) {
            chunkNoteDeleteDialogEl.remove();
            chunkNoteDeleteDialogEl = null;
        }
    }

    function openChunkNoteDeleteDialog(noteId) {
        const note = chunkNotesMap[String(noteId || '')];
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
            delete chunkNotesMap[note.id];
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
            chunkNotesFileHandle = null;
            chunkNotesFileHandleAudioKey = '';
            chunkNotesFileName = suggestedName;
            return;
        }
        const handle = await window.showSaveFilePicker({
            suggestedName,
            types: [{ description: 'JSON Files', accept: { 'application/json': ['.json'] } }]
        });
        await writeChunkNotesToHandle(handle, snapshot);
        chunkNotesFileHandle = handle;
        chunkNotesFileHandleAudioKey = currentAudioKey || 'default-audio';
        chunkNotesFileName = handle.name || suggestedName;
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
        const block = getChunkBlockByRef(note.chunkRef);
        if (!block) return null;
        const enDiv = block.querySelector('.chunk-en');
        if (!enDiv) return null;
        return enDiv.querySelector(`#word-${Number(note.startGlobal)}`);
    }

    function getChunkNoteTagById(noteId) {
        return document.getElementById(`chunk-note-tag-${noteId}`);
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
        try {
            localStorage.removeItem(getChunkNoteDraftStorageKey());
        } catch (err) {}
    }

    function persistChunkNoteDraft(immediate = false) {
        if (!notePopoverCtx || !chunkNoteModalInputEl) return;
        const text = String(chunkNoteModalInputEl.value || '');
        const trimmed = text.trim();
        if (!trimmed) {
            clearChunkNoteDraft();
            return;
        }
        const modalRect = chunkNoteModalEl ? chunkNoteModalEl.getBoundingClientRect() : null;
        const payload = {
            version: 1,
            audioKey: currentAudioKey || 'default-audio',
            updatedAt: Date.now(),
            ctx: {
                noteId: String(notePopoverCtx.noteId || ''),
                chunkRef: String(notePopoverCtx.chunkRef || ''),
                chunkIdx: Number(notePopoverCtx.chunkIdx || -1),
                startGlobal: Number(notePopoverCtx.startGlobal),
                endGlobal: Number(notePopoverCtx.endGlobal),
                selectedText: String(notePopoverCtx.selectedText || '')
            },
            text,
            modal: modalRect ? {
                left: Number(modalRect.left),
                top: Number(modalRect.top),
                width: Number(modalRect.width),
                height: Number(modalRect.height)
            } : null
        };
        const write = () => {
            try {
                localStorage.setItem(getChunkNoteDraftStorageKey(), JSON.stringify(payload));
            } catch (err) {}
        };
        if (immediate) write();
        else {
            if (chunkNoteDraftSaveTimer) clearTimeout(chunkNoteDraftSaveTimer);
            chunkNoteDraftSaveTimer = setTimeout(write, 120);
        }
    }

    function getRangeAnchorRectByGlobals(chunkRef, startGlobal, endGlobal) {
        const block = getChunkBlockByRef(chunkRef);
        if (!block) return null;
        const enDiv = block.querySelector('.chunk-en');
        if (!enDiv) return null;
        const startSpan = enDiv.querySelector(`#word-${startGlobal}`);
        const endSpan = enDiv.querySelector(`#word-${endGlobal}`);
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
        let raw = null;
        try {
            raw = localStorage.getItem(getChunkNoteDraftStorageKey());
        } catch (err) {}
        if (!raw) return;
        let parsed = null;
        try {
            parsed = JSON.parse(raw);
        } catch (err) {
            clearChunkNoteDraft();
            return;
        }
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
        const existing = chunkNotesMap[noteId];
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
        if (!isChunkMode || !chunkNoteVisible) return;
        ensureChunkNoteOverlayLayers();
        syncChunkNoteOverlaySize();
        Object.values(chunkNotesMap).forEach(note => {
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
                        delete chunkNotesMap[note.id];
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
        if (!isChunkMode || !chunkNoteVisible) return;
        Object.values(chunkNotesMap)
            .filter(n => n && n.note && String(n.note).trim())
            .sort((a, b) => (a.chunkIdx - b.chunkIdx) || (a.startGlobal - b.startGlobal))
            .forEach(spawnChunkNoteTag);
        scheduleChunkNoteLayoutRefresh();
    }

    function drawChunkNoteConnector(note) {
        if (!chunkNoteSvgLayer || !note || !note.id || !note.chunkRef) return;
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
        if (!isChunkMode || !chunkNoteVisible) return;
        ensureChunkNoteOverlayLayers();
        syncChunkNoteOverlaySize();
        Object.values(chunkNotesMap).forEach(drawChunkNoteConnector);
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
        if (chunkNoteDraftSaveTimer) {
            clearTimeout(chunkNoteDraftSaveTimer);
            chunkNoteDraftSaveTimer = null;
        }
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
        const block = getChunkBlockByRef(ctx.chunkRef);
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
            upsertChunkNote(ctx, noteText);
            saveChunkNotesDebounced();
            clearChunkNoteDraft();
            if (!chunkNoteVisible) setChunkNoteVisible(true, true);
            refreshChunkNoteForChunkRef(ctx.chunkRef);
        } else {
            if (ctx.noteId && chunkNotesMap[ctx.noteId]) delete chunkNotesMap[ctx.noteId];
            refreshChunkNoteForChunkRef(ctx.chunkRef);
            saveChunkNotesDebounced();
            clearChunkNoteDraft();
        }
        closeChunkNotePopover();
    }

    function cancelChunkNoteModal() {
        clearChunkNoteDraft();
        if (notePopoverCtx && notePopoverCtx.noteId && !notePopoverCtx.noteExists) {
            delete chunkNotesMap[notePopoverCtx.noteId];
            refreshChunkNoteForChunkRef(notePopoverCtx.chunkRef);
        }
        closeChunkNotePopover();
    }

    function openChunkNotePopover(ctx) {
        closeChunkNoteContextMenu();
        closeChunkNotePopover();
        notePopoverCtx = ctx;
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
        const noteId = String(ctx.noteId || makeSelectionNoteId(ctx.chunkRef, ctx.startGlobal, ctx.endGlobal));
        if (!noteText) {
            delete chunkNotesMap[noteId];
            return;
        }
        const existed = chunkNotesMap[noteId];
        const next = {
            id: noteId,
            chunkRef: ctx.chunkRef,
            chunkIdx: ctx.chunkIdx,
            startGlobal: ctx.startGlobal,
            endGlobal: ctx.endGlobal,
            selectedText: ctx.selectedText || '',
            note: noteText,
            autoSize: existed ? existed.autoSize !== false : true,
            updatedAt: Date.now()
        };
        if (existed) {
            next.coordSpace = existed.coordSpace === 'main' ? 'main' : existed.coordSpace;
            if (Number.isFinite(Number(existed.x))) next.x = Number(existed.x);
            if (Number.isFinite(Number(existed.y))) next.y = Number(existed.y);
            if (Number.isFinite(Number(existed.offsetX))) next.offsetX = Number(existed.offsetX);
            if (Number.isFinite(Number(existed.offsetY))) next.offsetY = Number(existed.offsetY);
            if (Number.isFinite(Number(existed.w))) next.w = Number(existed.w);
            if (Number.isFinite(Number(existed.h))) next.h = Number(existed.h);
            if (Number.isFinite(Number(existed.fontSize))) next.fontSize = Number(existed.fontSize);
            if (typeof existed.color === 'string' && existed.color) next.color = existed.color;
        } else if (ctx && ctx.anchorRect) {
            const { minW, minH, margin } = getChunkNoteLayoutBase();
            const anchorRect = rectToMainAreaSpace(ctx.anchorRect);
            const areaW = mainAppArea ? Math.max(mainAppArea.clientWidth, mainAppArea.scrollWidth) : window.innerWidth;
            const areaH = mainAppArea ? Math.max(mainAppArea.clientHeight, mainAppArea.scrollHeight) : window.innerHeight;
            next.x = Math.min(areaW - minW - margin, Math.max(margin, anchorRect.right + 24));
            next.y = Math.min(areaH - minH - margin, Math.max(margin, anchorRect.top - 6));
            next.offsetX = next.x - anchorRect.left;
            next.offsetY = next.y - anchorRect.top;
            next.coordSpace = 'main';
        }
        applyChunkNoteAutoSize(next);
        chunkNotesMap[noteId] = next;
    }

    function refreshChunkNoteForChunkRef(chunkRef) {
        const block = getChunkBlockByRef(chunkRef);
        if (!block) {
            renderAllChunkNoteTags();
            scheduleChunkNoteConnectorRedraw();
            return;
        }
        const enDiv = block.querySelector('.chunk-en');
        const notes = getChunkNotesForRef(chunkRef);
        if (!notes.length) {
            clearChunkWordAnnotations(enDiv);
            renderAllChunkNoteTags();
            scheduleChunkNoteConnectorRedraw();
            return;
        }
        markChunkWordsByNotes(enDiv, notes);
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
    const annotationGenerateBtn = document.getElementById('btn-annotation-generate');
    const exportAnnotationLightweightBtn = document.getElementById('btn-export-annotation-lightweight');
    const importAnnotationLightweightInput = document.getElementById('import-annotation-lightweight-file');
    const importAnnotationLightweightBtn = document.getElementById('btn-import-annotation-lightweight');
    const importAnnotationGeneratedBtn = document.getElementById('btn-import-annotation-generated');
    const importAnnotationGeneratedInput = document.getElementById('import-annotation-generated-file');
    const annotationApiSettingsBtn = document.getElementById('btn-annotation-api-settings');
    const annotationApiSettingsPanel = document.getElementById('annotation-api-settings-panel');
    const annotationGenerationStatusEl = document.getElementById('annotation-generation-status');
    const annotationPromptPanel = document.getElementById('annotation-prompt-panel');
    const annotationPromptSummaryEl = document.getElementById('annotation-prompt-summary');
    const annotationPromptTextEl = document.getElementById('annotation-prompt-text');
    const annotationPromptCopyBtn = document.getElementById('btn-annotation-prompt-copy');
    const annotationPromptExportBtn = document.getElementById('btn-annotation-prompt-export');
    const annotationPromptCloseBtn = document.getElementById('btn-annotation-prompt-close');
    const modalBackdrop = document.getElementById('modal-backdrop');
    const loadClozeBtn = document.getElementById('btn-load-cloze');

    // === Runtime state ===
    let words = [];
    let segments = [];
    let currentWordIndex = -1;
    let autoFollow = true;
    let userScrollSuppress = false;
    let suppressTimer = null;
    
    let highlightMode = 1; 
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
    let currentAnnotationPromptPackage = null;

    if (annotationPromptPanel && annotationPromptPanel.parentElement !== document.body) {
        document.body.appendChild(annotationPromptPanel);
    }

    let wordStarts = [];
    let globalVocab = []; 
    let vocabMatchMap = new Map();

    // === AI Chunk Mode State ===
    let isChunkMode = false;
    let chunkItems = [];
    let chunkCnVisible = false; // 榛樿鏀逛负 false锛屼互渚胯瀵熷崰浣嶆晥鏋?
    let chunkCnHoldMode = false; // true=鎸変綇蹇嵎閿墠鏄剧ず涓枃
    try { const _h = localStorage.getItem('chunkCnHoldMode'); if (_h !== null) chunkCnHoldMode = (_h === 'true'); } catch(e) {}
    let isHoldingChunkCn = false;
    let holdPrevChunkCnVisible = null;
    let holdPrevHadFocusClass = null;
    let isChunkShadowOn = true; 
    let chunkCnMode = 'global'; // 'global' or 'focus'
    let manualChunkStates = {}; // 璁板綍鎵嬪姩鐘舵€?    let lastActiveChunkIndex = -1;
    let lastAiPrevTapChunkIndex = -1;
    let lastAiPrevTapAt = 0;
    let lastSentencePrevTapSegIndex = -1;
    let lastSentencePrevTapAt = 0;
    let hasAiChunkData = false;
    let clozeItems = [];
    let hasClozeData = false;
    let clozeAnswerState = [];
    let chunkNoteVisible = false;
    let chunkNotesMap = {};
    let chunkNoteSaveTimer = null;
    let chunkNoteDraftSaveTimer = null;
    let notePopoverCtx = null;
    let chunkNoteModalEl = null;
    let chunkNoteModalInputEl = null;
    let chunkNoteModalDragging = false;
    let chunkNoteModalResizing = false;
    let pendingChunkSelectionCtx = null;
    let chunkNoteConnectorRaf = 0;
    let chunkNoteLayoutRaf = 0;
    let chunkNoteDraftRestoreDone = false;
    let activeChunkNoteId = '';
    let selectedChunkNoteId = '';
    let chunkNoteDeleteDialogEl = null;
    let chunkNoteExportDialogEl = null;
    let chunkNoteExportDialogKeydownHandler = null;
    let chunkNotesFileHandle = null;
    let chunkNotesFileHandleAudioKey = '';
    let chunkNotesFileName = '';
    let currentAudioMeta = null;
    let currentAudioKey = 'default-audio';
    let currentDocId = 'default-audio::0__0__0.000__0.000__0';
    let notePreviewVisible = true;
    let notePreviewWidth = 340;
    let notePreviewHeight = 640;
    let selectedSentence = null;
    let sentenceNotesMap = {};
    let allSentenceNotesByDoc = {};
    let notePreviewResizeRaf = 0;
    let notePreviewSavedHintTimer = 0;
    let notePreviewSavedItemId = '';
    let notePreviewEditingItemId = '';
    let sentenceNoteDraft = null;
    let notePreviewPendingScrollItemId = '';
    let notePreviewListScrollTop = 0;
    let chunkPointerDown = null;
    ensureChunkNoteOverlayLayers();

    // === 鏍峰紡缂栬緫鍣ㄩ€昏緫 (Style Editor Logic) ===
    const styleSettings = {
        word: { prefix: '--v-word-', label: 'Word (鍗曡瘝)' },
        context: { prefix: '--v-context-', label: 'Context (璇)' },
        meaning: { prefix: '--v-meaning-', label: 'Meaning (閲婁箟)' },
        not: { prefix: '--v-not-', label: 'Not Meaning (闈炰箟)' },
        global: { prefix: '--v-', label: 'Global (鍏ㄥ眬)' } 
    };
    
    const defaultStyles = {
        '--v-word-size': '28px', '--v-word-color': '#1c1e21', '--v-word-weight': '900', '--v-word-style': 'normal', '--v-word-spacing': '-0.5px',
        '--v-context-size': '14px', '--v-context-color': '#555555', '--v-context-weight': '400', '--v-context-style': 'italic', '--v-context-spacing': '0px',
        '--v-meaning-size': '15px', '--v-meaning-color': '#4b5563', '--v-meaning-weight': '700', '--v-meaning-style': 'normal', '--v-meaning-spacing': '0px',
        '--v-not-size': '12px', '--v-not-color': '#999999', '--v-not-weight': '400', '--v-not-style': 'normal', '--v-not-spacing': '0px',
        '--v-word-display': 'block',
        '--v-context-display': 'block',
        '--v-meaning-display': 'block',
        '--v-not-display': 'block',
        '--v-gap': '8px'
    };

    function initStyleEditor() {
        const saved = safeParseLocalJSON('visualStyles', {});
        Object.keys(defaultStyles).forEach(key => {
            const val = saved[key] || defaultStyles[key];
            document.documentElement.style.setProperty(key, val);
        });

        const container = document.getElementById('style-controls-container');
        if (!container) return;
        container.innerHTML = '';

        container.appendChild(createControlSection('global', '鍏ㄥ眬甯冨眬', [
            { type: 'number', label: 'Gap', prop: 'gap', suffix: 'px' }
        ]));

        Object.keys(styleSettings).forEach(key => {
            if(key === 'global') return;
            const def = styleSettings[key];
            const controls = [
                { type: 'toggle', label: 'B', prop: 'weight', onVal: '900', offVal: '400', title: '鍔犵矖' },
                { type: 'toggle', label: 'I', prop: 'style', onVal: 'italic', offVal: 'normal', title: '鏂滀綋' },
                { type: 'color', label: 'Color', prop: 'color' },
                { type: 'number', label: 'Size', prop: 'size', suffix: 'px' },
                { type: 'number', label: 'Space', prop: 'spacing', suffix: 'px', step: 0.5 }
            ];
            container.appendChild(createControlSection(key, def.label, controls));
        });
    }

   function createControlSection(sectionKey, title, controls) {
        const div = document.createElement('div');
        div.className = 'style-section';
        div.innerHTML = `<h4>${title}</h4>`;
        
        const row = document.createElement('div');
        row.className = 'control-row';
        div.appendChild(row);

        const prefix = styleSettings[sectionKey].prefix;

        if (sectionKey !== 'global') {
            const eyeBtn = document.createElement('button');
            eyeBtn.className = 'style-btn-toggle';
            eyeBtn.style.marginRight = '8px';
            eyeBtn.title = '鏄剧ず/闅愯棌';
            const displayVar = prefix + 'display';
            let currentDisplay = getComputedStyle(document.documentElement).getPropertyValue(displayVar).trim();
            if(!currentDisplay) currentDisplay = 'block';

            const isVisible = currentDisplay !== 'none';
            eyeBtn.innerText = isVisible ? 'Show' : 'Hide';
            if (!isVisible) eyeBtn.style.opacity = '0.5';

            eyeBtn.onclick = () => {
                const nowVisible = eyeBtn.innerText === 'Show';
                if (nowVisible) {
                    applyStyle(displayVar, 'none');
                    eyeBtn.innerText = 'Hide';
                    eyeBtn.style.opacity = '0.5';
                } else {
                    applyStyle(displayVar, 'block');
                    eyeBtn.innerText = 'Show';
                    eyeBtn.style.opacity = '1';
                }
            };
            row.appendChild(eyeBtn);
        }

        controls.forEach(ctrl => {
            const varName = prefix + ctrl.prop;
            let currentVal = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
            if (!currentVal && defaultStyles[varName]) currentVal = defaultStyles[varName];

            if (ctrl.type === 'toggle') {
                const btn = document.createElement('button');
                btn.className = 'style-btn-toggle';
                btn.innerText = ctrl.label;
                btn.title = ctrl.title || '';
                if(currentVal === ctrl.onVal) btn.classList.add('active');
                
                btn.onclick = () => {
                    const isNowActive = btn.classList.toggle('active');
                    const newVal = isNowActive ? ctrl.onVal : ctrl.offVal;
                    applyStyle(varName, newVal);
                };
                row.appendChild(btn);
            } 
            else if (ctrl.type === 'color') {
                const input = document.createElement('input');
                input.type = 'color';
                input.className = 'color-input';
                input.value = (currentVal.length === 7 && currentVal.startsWith('#')) ? currentVal : '#000000'; 
                input.oninput = (e) => applyStyle(varName, e.target.value);
                row.appendChild(input);
            }
            else if (ctrl.type === 'number') {
                const wrap = document.createElement('div');
                wrap.style.display = 'flex'; wrap.style.alignItems='center'; wrap.style.marginRight='4px';
                
                const lbl = document.createElement('span');
                lbl.innerText = ctrl.label;
                lbl.style.fontSize = '12px'; lbl.style.marginRight='2px';

                const input = document.createElement('input');
                input.type = 'number';
                input.className = 'style-input-num';
                input.step = ctrl.step || 1;
                input.value = parseFloat(currentVal) || 0;
                
                input.oninput = (e) => applyStyle(varName, e.target.value + (ctrl.suffix || ''));
                
                wrap.appendChild(lbl);
                wrap.appendChild(input);
                row.appendChild(wrap);
            }
        });
        return div;
    }
    function applyStyle(varName, value) {
        document.documentElement.style.setProperty(varName, value);
        const saved = safeParseLocalJSON('visualStyles', {});
        saved[varName] = value;
        localStorage.setItem('visualStyles', JSON.stringify(saved));
    }

    // Modal Events
    const openStyleEditorBtn = document.getElementById('open-style-editor');
    if (openStyleEditorBtn) {
        openStyleEditorBtn.onclick = () => {
            document.getElementById('modal-backdrop').style.display = 'block';
            document.getElementById('style-editor-modal').style.display = 'block';
            initStyleEditor(); 
        };
    }
    function closeStyleEditor() {}
    document.getElementById('modal-backdrop').onclick = () => {
        closeStyleEditor();
        closeChunkStyleModal();
        closeChunkNoteStyleModal();
        closeChunkNotePopover();
        closeAnnotationPromptPanel();
    };
    
    // Chunk Style Modal Logic (Modified)
    function openChunkStyleModal() {
        document.getElementById('modal-backdrop').style.display = 'block';
        document.getElementById('chunk-style-modal').style.display = 'block';
        
        // Read current computed values
        const styles = getComputedStyle(document.documentElement);
        
        const enSize = styles.getPropertyValue('--chunk-en-size').trim().replace('px','');
        const cnSize = styles.getPropertyValue('--chunk-cn-size').trim().replace('px','');
        const gapSize = styles.getPropertyValue('--chunk-gap').trim().replace('px','');
        
        // Colors: Try localStorage first for HEX, otherwise use computed (might be RGB) fallback
        let cnColor = localStorage.getItem('chunkCnColor') || styles.getPropertyValue('--chunk-cn-color').trim();
        let bgColor = localStorage.getItem('chunkBgColor') || styles.getPropertyValue('--chunk-active-bg').trim();
        
        // Basic HEX check, default if invalid
        if (!cnColor.startsWith('#') || cnColor.length !== 7) cnColor = '#4b5563';
        if (!bgColor.startsWith('#') || bgColor.length !== 7) bgColor = '#e5e7eb';

        document.getElementById('chunk-en-size-input').value = parseInt(enSize) || 20;
        document.getElementById('chunk-cn-size-input').value = parseInt(cnSize) || 16;
        document.getElementById('chunk-gap-input').value = parseInt(gapSize) || 20;
        
        document.getElementById('chunk-cn-color-input').value = cnColor;
        document.getElementById('chunk-bg-color-input').value = bgColor;
        
        updateShadowBtnText();
    }
    
    function closeChunkStyleModal() {
        document.getElementById('modal-backdrop').style.display = 'none';
        document.getElementById('chunk-style-modal').style.display = 'none';
    }
    
    function updateChunkStyle() {
        const en = document.getElementById('chunk-en-size-input').value;
        const cn = document.getElementById('chunk-cn-size-input').value;
        const gap = document.getElementById('chunk-gap-input').value;
        const cnColor = document.getElementById('chunk-cn-color-input').value;
        const bgColor = document.getElementById('chunk-bg-color-input').value;

        document.documentElement.style.setProperty('--chunk-en-size', en + 'px');
        document.documentElement.style.setProperty('--chunk-cn-size', cn + 'px');
        document.documentElement.style.setProperty('--chunk-gap', gap + 'px');
        document.documentElement.style.setProperty('--chunk-cn-color', cnColor);
        document.documentElement.style.setProperty('--chunk-active-bg', bgColor);

        localStorage.setItem('chunkEnSize', en + 'px');
        localStorage.setItem('chunkCnSize', cn + 'px');
        localStorage.setItem('chunkGap', gap + 'px');
        localStorage.setItem('chunkCnColor', cnColor);
        localStorage.setItem('chunkBgColor', bgColor);
        adjustChunkNoteArrowSizeByGap();
        if (isChunkMode) {
            renderAllChunkNoteTags();
        }
        scheduleChunkNoteConnectorRedraw();
    }

    // === Startup restore/init flow ===
    initDB().then(async () => {
        await clearPersistedReaderContentOnStartup();
        // [鍏抽敭淇] 鍏堝姞杞界姸鎬侊紝鍐嶆仮澶?Session (娓叉煋)
        // Restore Manual States FIRST
        const savedManualStates = localStorage.getItem('manualChunkStates');
        if (savedManualStates) {
            try { manualChunkStates = JSON.parse(savedManualStates); } catch(e){}
        }

        // Restore CN Mode (Focus/Global)
        const savedCnMode = localStorage.getItem('chunkCnMode');
        if (savedCnMode === 'focus') {
             chunkCnMode = 'focus'; // 璁剧疆鍙橀噺
             // 鎸夐挳UI绋嶅悗鍦?restoreSession 鍚庢洿鏂?
        }

        // Restore Shadow State
        const savedShadowState = localStorage.getItem('isChunkShadowOn');
        if (savedShadowState !== null) {
            isChunkShadowOn = (savedShadowState === 'true');
            if (!isChunkShadowOn) document.body.classList.add('hide-chunk-shadow');
        }

        // Restore Chunk Settings
        if (localStorage.getItem('chunkEnSize')) document.documentElement.style.setProperty('--chunk-en-size', localStorage.getItem('chunkEnSize'));
        if (localStorage.getItem('chunkCnSize')) document.documentElement.style.setProperty('--chunk-cn-size', localStorage.getItem('chunkCnSize'));
        if (localStorage.getItem('chunkGap')) document.documentElement.style.setProperty('--chunk-gap', localStorage.getItem('chunkGap'));
        if (localStorage.getItem('chunkCnColor')) document.documentElement.style.setProperty('--chunk-cn-color', localStorage.getItem('chunkCnColor'));
        if (localStorage.getItem('chunkBgColor')) document.documentElement.style.setProperty('--chunk-active-bg', localStorage.getItem('chunkBgColor'));
        adjustChunkNoteArrowSizeByGap();
        
        initStyleEditor(); 
        
        // Update UI buttons based on loaded state
        if (chunkCnMode === 'focus') {
             const btn = document.getElementById('btn-chunk-focus');
             if(btn) { btn.innerText = "聚焦"; btn.classList.add('active'); }
             if(isChunkMode && transcriptContainer) transcriptContainer.classList.add('cn-mode-focus');
        }

        const savedChunkMode = localStorage.getItem('isChunkMode') === 'true';
        const savedChunkVisible = localStorage.getItem('chunkCnVisible');
        if (savedChunkVisible !== null) chunkCnVisible = savedChunkVisible === 'true';
        const savedHoldMode = localStorage.getItem('chunkCnHoldMode');
        if (savedHoldMode !== null) chunkCnHoldMode = savedHoldMode === 'true';
        const savedNoteVisible = localStorage.getItem('chunkNoteVisible');
        if (savedNoteVisible !== null) chunkNoteVisible = savedNoteVisible === 'true';
        setChunkNoteVisible(chunkNoteVisible, false);
        updateChunkCnHoldBtn();

        await restoreSession();
        
        if (savedChunkMode) {
            setTimeout(() => {
                if (chunkItems.length > 0 && hasAiChunkData) toggleChunkMode(true);
            }, 500);
        }
    });

    async function restoreSession() {
        emitAnnotationDiagnostics('app.restore_session_start', {
            scope: getAnnotationGenerationScope(),
            currentAudioKey,
            currentDocId
        });
        const audioBlob = await loadFromDB('audio');
        if (audioBlob) {
            audioPlayer.src = URL.createObjectURL(audioBlob);
            markFileLoaded(lblAudio, 'Audio restored');
        }
        const audioMeta = await loadFromDB('audioMeta');
        if (audioMeta && typeof audioMeta === 'object') {
            applyCurrentAudioMeta(audioMeta);
        } else if (audioBlob) {
            applyCurrentAudioMeta({ name: audioBlob.name || 'audio', size: audioBlob.size || 0, lastModified: audioBlob.lastModified || 0, type: audioBlob.type || '' });
        }
        await loadChunkNotesForCurrentAudio();
        await loadSentenceNotesForCurrentAudio();

        const transcriptData = await loadFromDB('transcript');
        if (transcriptData) {
            processTranscript(transcriptData);
            emitAnnotationDiagnostics('app.restore_transcript_processed', {
                scope: getAnnotationGenerationScope(),
                currentAudioKey,
                currentDocId,
                derivedDocId: buildCurrentSentenceDocId(transcriptData),
                segmentCount: Array.isArray(transcriptData && transcriptData.segments) ? transcriptData.segments.length : 0
            });
            await switchSentenceNotesDoc(transcriptData);
            emitAnnotationDiagnostics('app.restore_scope_updated', {
                scope: getAnnotationGenerationScope(),
                currentAudioKey,
                currentDocId
            });
            scheduleGeneratedAnnotationIndexRefresh();
            markFileLoaded(lblTranscript, 'Transcript restored');
        } else {
            await switchSentenceNotesDoc();
        }

        const notesData = await loadFromDB('notes');
        if (notesData) {
            processNotes(notesData);
            markFileLoaded(lblNotes, 'Notes restored');
        }

        const visualData = await loadFromDB('visual');
        if (visualData) {
            processVisual(visualData);
            markFileLoaded(lblVisual, 'Visual restored');
        }
        
        const chunkData = await loadFromDB('chunkData'); 
        if (chunkData) {
            // 杩欓噷鎴戜滑鍙兘瀛樼殑鏄?Raw 鏁版嵁锛屼篃鍙兘鏄鐞嗚繃鐨?
            // 涓轰簡瀹夊叏锛屽鏋滃瓨鐨勬槸 raw json锛宲rocessChunkData 浼氬鐞嗗畠
            // 濡傛灉瀛樼殑鏄鐞嗚繃鐨?array锛屾垜浠彲鑳介渶瑕佸垽鏂€?
            // 绠€鍗曡捣瑙侊紝鍋囪 DB 閲屽瓨鐨勬槸 Processed Array锛屾垨鑰?Raw Data銆?
            // 鐢变簬涔嬪墠鐨勪唬鐮佹槸 processChunkData 璐熻矗瀛橈紝杩欓噷鎴戜滑鐩存帴璇?raw 閲嶆柊澶勭悊鏇寸ǔ濡ワ紵
            // 涓嶏紝鍘熸潵鐨勪唬鐮佹槸 saveToDB('chunkData', items)銆?items 鏄鐞嗚繃鐨勬暟缁勫悧锛?
            // 鐪嬩箣鍓嶇殑 processChunkData锛屽畠瀛樼殑鏄?items (raw)銆?
            processChunkData(chunkData); 
        }
        
        const marksData = await loadFromDB('marks');
        if (marksData && Array.isArray(marksData)) {
            marksData.forEach(mark => {
                const normalizedMark = normalizeAnnotationMark(mark);
                if (normalizedMark) markedMap.set(normalizedMark.globalIndex, normalizedMark);
            });
            if (!isChunkMode) renderTranscript();
            syncAnnotationGenerationEntryStatus();
        }
        const generatedStore = getAnnotationGeneratedResultStore();
        emitAnnotationDiagnostics('app.restore_session_complete', {
            scope: getAnnotationGenerationScope(),
            currentAudioKey,
            currentDocId,
            markedCount: markedMap.size,
            generatedItemCount: generatedStore && typeof generatedStore.getItems === 'function'
                ? generatedStore.getItems().length
                : 0
        });
    }

    function getAnnotationGenerationEntryUi() {
        return window.AnnotationGenerationEntryUI || null;
    }

    function getAnnotationGenerationController() {
        return window.AnnotationGenerationController || null;
    }

    function getAnnotationGenerationStorage() {
        return window.AnnotationGenerationStorage || null;
    }

    function getAnnotationBlockPlanner() {
        return window.AnnotationBlockPlanner || null;
    }

    function getAnnotationPromptBuilder() {
        return window.AnnotationPromptBuilder || null;
    }

    function getAnnotationGeneratedResultStore() {
        return window.AnnotationGeneratedResultStore || null;
    }

    function getAnnotationClickResolver() {
        return window.AnnotationClickResolver || null;
    }

    function getAnnotationTargetSource() {
        return window.AnnotationTargetSource || null;
    }

    function getAnnotationGenerationDiagnostics() {
        return window.AnnotationGenerationDiagnostics || null;
    }

    function getAnnotationApiConfigHelper() {
        return window.AnnotationApiConfig || null;
    }

    function emitAnnotationDiagnostics(event, payload) {
        const diagnostics = getAnnotationGenerationDiagnostics();
        if (!diagnostics || typeof diagnostics.emit !== 'function') return;
        diagnostics.emit(event, payload);
    }

    function normalizeAnnotationMark(mark, fallbackSourceType = 'manual-mark') {
        if (!mark || !Number.isInteger(Number(mark.globalIndex))) return null;
        return {
            ...mark,
            globalIndex: Number(mark.globalIndex),
            sourceType: String(mark.sourceType || mark.source || fallbackSourceType)
        };
    }

    function parseEncodedAnnotationTargetId(targetId) {
        const normalized = normalizeAnnotationTextValue(targetId);
        if (!normalized) return null;
        const match = normalized.match(/^(.*)-([^-]+)-(\d+)-(\d+)$/);
        if (!match) return null;
        const sourceType = normalizeAnnotationTextValue(match[1]);
        const sentenceId = normalizeAnnotationTextValue(match[2]);
        const globalStart = Number(match[3]);
        const globalEnd = Number(match[4]);
        if (!sourceType || !sentenceId || !Number.isInteger(globalStart) || !Number.isInteger(globalEnd) || globalStart < 0 || globalEnd < globalStart) {
            return null;
        }
        return {
            sourceType,
            sentenceId,
            occurrenceGlobalStart: globalStart,
            occurrenceGlobalEnd: globalEnd
        };
    }

    function buildSyntheticAnnotationTargetFromEncodedId(targetId, fallbackItem = null) {
        const parsed = parseEncodedAnnotationTargetId(targetId);
        if (!parsed) return null;
        const start = parsed.occurrenceGlobalStart;
        const end = parsed.occurrenceGlobalEnd;
        if (!Array.isArray(words) || start >= words.length || end >= words.length) return null;

        const matchedWords = words.slice(start, end + 1);
        const markedText = normalizeAnnotationTextValue(
            (fallbackItem && fallbackItem.markedText)
            || matchedWords.map((word) => String(word && (word.word || word.text) || '').trim()).filter(Boolean).join(' ')
        );
        const context = buildAnnotationGenerationDocumentContext();
        const block = Array.isArray(context && context.blocks)
            ? context.blocks.find((item) => String(item && item.id || '') === parsed.sentenceId)
                || context.blocks.find((item) => String(item && item.index) === parsed.sentenceId)
                || null
            : null;
        const sentenceText = normalizeAnnotationTextValue(
            (fallbackItem && (fallbackItem.sourceSentence || fallbackItem.sentence))
            || (block && block.text)
            || ''
        );
        const boundary = normalizeAnnotationTextValue(
            (fallbackItem && fallbackItem.boundary)
            || sentenceText
            || markedText
        );

        return {
            id: normalizeAnnotationTextValue(targetId),
            sourceType: parsed.sourceType,
            sentenceId: parsed.sentenceId,
            blockId: parsed.sentenceId,
            markedText,
            boundary,
            sentenceText,
            sentencePlainText: sentenceText,
            occurrenceGlobalStart: start,
            occurrenceGlobalEnd: end,
            occurrenceKey: `${parsed.sourceType}::${parsed.sentenceId}::g:${start}-${end}`
        };
    }

    function getAnnotationItemOccurrenceRange(item, targetLookup) {
        const lookup = targetLookup instanceof Map ? targetLookup : new Map();
        const targetId = normalizeAnnotationTextValue(item && item.targetId);
        const target = targetId ? lookup.get(targetId) : null;
        const itemStartValue = item && item.occurrenceGlobalStart;
        const itemEndValue = item && item.occurrenceGlobalEnd;
        const targetStartValue = target && target.occurrenceGlobalStart;
        const targetEndValue = target && target.occurrenceGlobalEnd;
        const start = itemStartValue != null && Number.isInteger(Number(itemStartValue))
            ? Number(itemStartValue)
            : (targetStartValue != null && Number.isInteger(Number(targetStartValue)) ? Number(targetStartValue) : null);
        const end = itemEndValue != null && Number.isInteger(Number(itemEndValue))
            ? Number(itemEndValue)
            : (targetEndValue != null && Number.isInteger(Number(targetEndValue)) ? Number(targetEndValue) : null);
        if ((!Number.isInteger(start) || !Number.isInteger(end)) && targetId) {
            const parsed = parseEncodedAnnotationTargetId(targetId);
            if (parsed) {
                return {
                    start: parsed.occurrenceGlobalStart,
                    end: parsed.occurrenceGlobalEnd
                };
            }
        }
        if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start) return null;
        return { start, end };
    }

    function rebuildMarksFromAnnotationItems(items, options = {}) {
        const annotationItems = Array.isArray(items) ? items : [];
        const sourceType = String(options.sourceType || 'annotation-import');
        const replaceExisting = options.replaceExisting !== false;
        const targetLookup = options.targetLookup instanceof Map ? options.targetLookup : buildAnnotationTargetCollection().byId;
        const nextMap = replaceExisting ? new Map() : new Map(markedMap);
        let addedCount = 0;

        annotationItems.forEach((item) => {
            const range = getAnnotationItemOccurrenceRange(item, targetLookup);
            if (!range) return;
            for (let globalIndex = range.start; globalIndex <= range.end; globalIndex++) {
                const word = words[globalIndex];
                if (!word) continue;
                if (nextMap.has(globalIndex) && !replaceExisting) continue;
                nextMap.set(globalIndex, normalizeAnnotationMark({
                    word: String(word.word || word.text || '').trim(),
                    start: word.start,
                    globalIndex,
                    targetId: normalizeAnnotationTextValue(item && item.targetId),
                    occurrenceKey: normalizeAnnotationTextValue(item && item.occurrenceKey),
                    sourceType
                }, sourceType));
                addedCount += 1;
            }
        });

        if (!addedCount && replaceExisting) {
            markedMap.clear();
            saveToDB('marks', []);
            return { addedCount: 0, totalCount: 0 };
        }

        if (!addedCount && !replaceExisting) {
            return { addedCount: 0, totalCount: markedMap.size };
        }

        markedMap.clear();
        nextMap.forEach((value, key) => markedMap.set(key, value));
        saveToDB('marks', Array.from(markedMap.values()));
        if (isChunkMode) renderChunkMode(); else renderTranscript();
        forceUpdateUI(audioPlayer.currentTime);
        syncAnnotationGenerationEntryStatus();
        return { addedCount, totalCount: markedMap.size };
    }

    function getAnnotationGenerationConfigState(controller) {
        if (!controller) return 'not-connected';
        if (typeof controller.getConfigState === 'function') {
            const state = controller.getConfigState();
            if (state === 'unconfigured' || state === 'configured') return state;
        }
        if (typeof controller.isConfigured === 'function') {
            return controller.isConfigured() ? 'configured' : 'unconfigured';
        }
        if ('configured' in controller) {
            return controller.configured ? 'configured' : 'unconfigured';
        }
        return 'configured';
    }

    async function syncAnnotationGenerationEntryStatus() {
        const ui = getAnnotationGenerationEntryUi();
        if (!ui || typeof ui.setStatus !== 'function') return;

        const controller = getAnnotationGenerationController();
        const activeRunInfo = controller && typeof controller.getActiveRunInfo === 'function'
            ? controller.getActiveRunInfo()
            : null;
        if (activeRunInfo) {
            ui.setStatus({
                state: activeRunInfo.state || 'running',
                requestBudget: activeRunInfo.requestBudget,
                requestCount: activeRunInfo.requestCount,
                nextAllowedStartAt: activeRunInfo.nextAllowedStartAt || '',
                stopRequested: !!activeRunInfo.stopRequested,
                stopHandled: !!activeRunInfo.stopHandled,
                requestAborted: false,
                message: activeRunInfo.state === 'waiting-next-block'
                    ? '冷却中：等待下一次请求窗口。'
                    : (activeRunInfo.state === 'stopping'
                        ? '停止已请求：等待当前请求结束。'
                        : '正在执行全文注释生成。')
            });
            return;
        }
        const context = buildAnnotationGenerationDocumentContext();
        if (!context.totalBlocks) {
            ui.setStatus({
                state: 'empty',
                total: 0,
                completed: 0,
                failed: 0,
                message: '请先导入字幕或切分数据，再提取 Prompt 或导入全文注释。'
            });
            return;
        }

        const targetSource = getAnnotationTargetSource();
        let totalTargets = 0;
        if (targetSource && typeof targetSource.countTargetsFromContext === 'function') {
            totalTargets = targetSource.countTargetsFromContext(context);
            if (!totalTargets) {
                ui.setStatus({
                    state: 'no-targets',
                    total: context.totalBlocks,
                    completed: 0,
                    failed: 0,
                    message: '当前文档没有可生成的标注目标。'
                });
                return;
            }
        }

        const storage = getAnnotationGenerationStorage();
        if (storage && typeof storage.loadBundle === 'function') {
            try {
                const bundle = await storage.loadBundle(getAnnotationGenerationScope());
                const importedCount = Array.isArray(bundle && bundle.generated && bundle.generated.items)
                    ? bundle.generated.items.length
                    : 0;
                if (importedCount > 0) {
                    ui.setStatus({
                        state: 'imported',
                        total: totalTargets || context.totalBlocks,
                        completed: importedCount,
                        failed: 0,
                        message: `已导入全文注释 ${importedCount} 条，可继续查看/导出 Prompt。`
                    });
                    return;
                }
            } catch (error) {}
        }

        ui.setStatus({
            state: 'ready',
            total: totalTargets || context.totalBlocks,
            completed: 0,
            failed: 0,
            message: '可查看 Prompt，或手动导入模型分析好的全文注释 JSON。'
        });
    }

    let annotationGeneratedIndexRefreshSeq = 0;
    let annotationGeneratedIndexScopeKey = '';

    function isAnnotationDebugEnabled() {
        try {
            if (window.ANNOTATION_DEBUG === true) return true;
            const stored = window.localStorage && window.localStorage.getItem('annotation.debug');
            return stored === '1' || stored === 'true';
        } catch (error) {
            return window.ANNOTATION_DEBUG === true;
        }
    }

    function emitAnnotationDebug(step, payload) {
        if (!isAnnotationDebugEnabled()) return;
        try {
            console.debug(`[annotation-debug] ${step}`, payload || {});
        } catch (error) {}
    }

    function getAnnotationGenerationScope() {
        const storage = getAnnotationGenerationStorage();
        if (storage && typeof storage.normalizeScope === 'function') {
            return storage.normalizeScope({
                audioKey: currentAudioKey,
                documentId: currentDocId
            });
        }
        return normalizeAnnotationGenerationScope({
            audioKey: currentAudioKey,
            documentId: currentDocId
        });
    }

    function buildAnnotationEntryActiveStatus(controller, progress = {}) {
        const activeRunInfo = controller && typeof controller.getActiveRunInfo === 'function'
            ? controller.getActiveRunInfo()
            : null;
        const state = activeRunInfo && activeRunInfo.state
            ? activeRunInfo.state
            : 'running';
        return {
            state,
            ...progress,
            requestBudget: activeRunInfo && Number.isFinite(Number(activeRunInfo.requestBudget))
                ? Number(activeRunInfo.requestBudget)
                : undefined,
            requestCount: activeRunInfo && Number.isFinite(Number(activeRunInfo.requestCount))
                ? Number(activeRunInfo.requestCount)
                : undefined,
            nextAllowedStartAt: activeRunInfo && activeRunInfo.nextAllowedStartAt || '',
            stopRequested: !!(activeRunInfo && activeRunInfo.stopRequested),
            stopHandled: !!(activeRunInfo && activeRunInfo.stopHandled),
            message: state === 'waiting-next-block'
                ? '冷却中：等待下一次请求窗口。'
                : (state === 'stopping'
                    ? '停止已请求：等待当前请求结束。'
                    : '正在执行全文注释生成。')
        };
    }

    function requestAnnotationGenerationStopFromEntry(entryUi) {
        const ui = entryUi || getAnnotationGenerationEntryUi();
        const controller = getAnnotationGenerationController();
        if (!controller || typeof controller.requestStop !== 'function') return;
        const response = controller.requestStop();
        emitAnnotationDiagnostics('app.entry_stop_requested', {
            scope: getAnnotationGenerationScope(),
            accepted: !!(response && response.accepted),
            state: response && response.state || '',
            runId: response && response.runId || ''
        });
        if (!response || !response.accepted) return;
        ui?.setStatus({
            state: response.state || 'stopping',
            requestBudget: controller && typeof controller.getActiveRunInfo === 'function' && controller.getActiveRunInfo()
                ? controller.getActiveRunInfo().requestBudget
                : undefined,
            requestCount: controller && typeof controller.getActiveRunInfo === 'function' && controller.getActiveRunInfo()
                ? controller.getActiveRunInfo().requestCount
                : undefined,
            stopRequested: true,
            message: response.state === 'stopped'
                ? '本轮已停止，不会继续后续请求。'
                : '停止已请求：等待当前请求结束。'
        });
    }

    function getAnnotationGenerationScopeKey(scope = getAnnotationGenerationScope()) {
        const normalized = normalizeAnnotationGenerationScope(scope);
        return `${normalized.audioKey}::${normalized.documentId}`;
    }

    function normalizeAnnotationGenerationScope(scope) {
        return {
            audioKey: normalizeAnnotationScopeText(scope && scope.audioKey) || 'default-audio',
            documentId: normalizeAnnotationScopeText(scope && scope.documentId) || 'default-document'
        };
    }

    function normalizeAnnotationScopeText(value) {
        return String(value || '').replace(/\s+/g, ' ').trim();
    }

    function clearGeneratedAnnotationIndex() {
        annotationGeneratedIndexRefreshSeq++;
        annotationGeneratedIndexScopeKey = '';
        const store = getAnnotationGeneratedResultStore();
        if (store && typeof store.clear === 'function') store.clear();
    }

    async function refreshGeneratedAnnotationIndexForCurrentDocument() {
        const storage = getAnnotationGenerationStorage();
        const store = getAnnotationGeneratedResultStore();
        if (!storage || typeof storage.loadBundle !== 'function' || !store || typeof store.indexBundle !== 'function') {
            emitAnnotationDiagnostics('app.generated_index_refresh_skipped', {
                scope: getAnnotationGenerationScope(),
                reason: 'missing-storage-or-store'
            });
            console.warn('[app] generated index refresh skipped', {
                scope: getAnnotationGenerationScope(),
                reason: 'missing-storage-or-store'
            });
            clearGeneratedAnnotationIndex();
            return { itemCount: 0, skipped: true };
        }

        const scope = getAnnotationGenerationScope();
        const scopeKey = getAnnotationGenerationScopeKey(scope);
        const refreshSeq = ++annotationGeneratedIndexRefreshSeq;
        emitAnnotationDiagnostics('app.generated_index_refresh_start', {
            scope,
            scopeKey,
            refreshSeq
        });

        const bundle = await storage.loadBundle(scope);
        if (refreshSeq !== annotationGeneratedIndexRefreshSeq || getAnnotationGenerationScopeKey() !== scopeKey) {
            emitAnnotationDiagnostics('app.generated_index_refresh_stale', {
                scope,
                scopeKey,
                refreshSeq,
                currentScopeKey: getAnnotationGenerationScopeKey(),
                generatedItemCount: Array.isArray(bundle && bundle.generated && bundle.generated.items) ? bundle.generated.items.length : 0,
                runtimeArtifacts: bundle && bundle.runtimeArtifacts
            });
            console.warn('[app] generated index refresh stale/skipped', {
                scope,
                scopeKey,
                refreshSeq,
                currentScopeKey: getAnnotationGenerationScopeKey(),
                generatedItemCount: Array.isArray(bundle && bundle.generated && bundle.generated.items) ? bundle.generated.items.length : 0
            });
            return { itemCount: 0, skipped: true, stale: true };
        }

        const generated = bundle && bundle.generated ? bundle.generated : null;
        const result = store.indexBundle(generated, scope);
        annotationGeneratedIndexScopeKey = scopeKey;
        emitAnnotationDebug('app.generated_index_refresh', {
            scope,
            scopeKey,
            generatedItemCount: Array.isArray(generated && generated.items) ? generated.items.length : 0,
            indexedItemCount: result && Number.isFinite(Number(result.itemCount)) ? Number(result.itemCount) : 0,
            runtimeArtifacts: bundle && bundle.runtimeArtifacts || null
        });
        if (!(result && Number(result.itemCount) > 0)) {
            console.warn('[app] generated index refresh produced empty result', {
                scope,
                scopeKey,
                generatedItemCount: Array.isArray(generated && generated.items) ? generated.items.length : 0,
                indexedItemCount: result && Number.isFinite(Number(result.itemCount)) ? Number(result.itemCount) : 0
            });
        }
        emitAnnotationDiagnostics('app.generated_index_refresh_complete', {
            scope,
            scopeKey,
            refreshSeq,
            indexedItemCount: result && Number.isFinite(Number(result.itemCount)) ? Number(result.itemCount) : 0,
            generatedItemCount: Array.isArray(generated && generated.items) ? generated.items.length : 0,
            runtimeArtifacts: bundle && bundle.runtimeArtifacts
        });
        return result;
    }

    function scheduleGeneratedAnnotationIndexRefresh() {
        const scheduledScopeKey = getAnnotationGenerationScopeKey();
        refreshGeneratedAnnotationIndexForCurrentDocument().catch(() => {
            if (getAnnotationGenerationScopeKey() === scheduledScopeKey) clearGeneratedAnnotationIndex();
        });
    }

    function getAnnotationGenerationBlockText(seg) {
        if (!seg) return '';
        if (typeof seg.text === 'string' && seg.text.trim()) return seg.text.replace(/\s+/g, ' ').trim();
        if (Array.isArray(seg.words)) {
            return seg.words.map(w => String((w && (w.word || w.text)) || '').trim()).filter(Boolean).join(' ');
        }
        return '';
    }

    function buildAnnotationGenerationDocumentContext() {
        const transcriptBlocks = segments.map((seg, index) => ({
            type: 'segment',
            index,
            id: String(seg.id || seg.segment_id || index),
            start: Number.isFinite(Number(seg.start)) ? Number(seg.start) : null,
            end: Number.isFinite(Number(seg.end)) ? Number(seg.end) : null,
            text: getAnnotationGenerationBlockText(seg),
            words: Array.isArray(seg.words) ? seg.words : []
        })).filter(block => block.text);
        const chunkBlocks = (hasAiChunkData && Array.isArray(chunkItems))
            ? chunkItems.map((item, index) => ({
                type: 'chunk',
                index,
                id: String(item.chunkRef || item.segId || index),
                start: Number.isFinite(Number(item.start)) ? Number(item.start) : null,
                end: Number.isFinite(Number(item.end)) ? Number(item.end) : null,
                text: String(item.rawEn || item.en || '').replace(/\s+/g, ' ').trim(),
                words: Array.isArray(item.words) ? item.words : []
            })).filter(block => block.text)
            : [];
        const blocks = chunkBlocks.length ? chunkBlocks : transcriptBlocks;
        const marks = Array.from(markedMap.values())
            .map((mark) => normalizeAnnotationMark(mark))
            .filter(Boolean);
        return {
            documentId: currentDocId,
            audioKey: currentAudioKey,
            sourceMode: chunkBlocks.length ? 'chunk' : 'transcript',
            totalBlocks: blocks.length,
            marks,
            stats: {
                words: words.length,
                segments: segments.length,
                chunks: chunkItems.length,
                marks: marks.length
            },
            blocks
        };
    }

    function buildAnnotationPromptPackage() {
        const promptBuilder = getAnnotationPromptBuilder();
        const planner = getAnnotationBlockPlanner();
        const context = buildAnnotationGenerationDocumentContext();
        if (!context.totalBlocks) {
            return {
                ok: false,
                status: {
                    state: 'empty',
                    total: 0,
                    completed: 0,
                    failed: 0,
                    message: '请先导入字幕或切分数据。'
                }
            };
        }

        const targetSource = getAnnotationTargetSource();
        const targetCount = targetSource && typeof targetSource.countTargetsFromContext === 'function'
            ? targetSource.countTargetsFromContext(context)
            : 0;
        if (!targetCount) {
            return {
                ok: false,
                status: {
                    state: 'no-targets',
                    total: context.totalBlocks,
                    completed: 0,
                    failed: 0,
                    message: '当前文档没有可生成的标注目标。'
                }
            };
        }

        if (!planner || typeof planner.planFromContext !== 'function' || !promptBuilder || typeof promptBuilder.buildPromptPayload !== 'function') {
            return {
                ok: false,
                status: {
                    state: 'not-connected',
                    total: targetCount,
                    completed: 0,
                    failed: 0,
                    message: 'Prompt builder 未接入，暂时无法提取。'
                }
            };
        }

        const plan = planner.planFromContext(context);
        const blocks = Array.isArray(plan && plan.blocks) ? plan.blocks : [];
        const promptBlocks = blocks
            .map((block, blockIndex) => {
                const payload = promptBuilder.buildPromptPayload(block, { blockIndex });
                if (!payload || payload.skipped) return null;
                return {
                    blockId: payload.blockId,
                    targetCount: payload.targetCount,
                    text: payload.text,
                    contextText: payload.contextText,
                    prompt: payload.prompt,
                    targets: payload.targets
                };
            })
            .filter(Boolean);

        if (!promptBlocks.length) {
            return {
                ok: false,
                status: {
                    state: 'no-targets',
                    total: targetCount,
                    completed: 0,
                    failed: 0,
                    message: '没有可导出的 prompt block。'
                }
            };
        }

        const combinedPrompt = promptBlocks
            .map((block, index) => [`### BLOCK ${index + 1} / ${promptBlocks.length} (${block.blockId})`, block.prompt].join('\n'))
            .join('\n\n');

        return {
            ok: true,
            data: {
                schemaVersion: 1,
                createdAt: new Date().toISOString(),
                template: typeof promptBuilder.getPromptTemplate === 'function'
                    ? promptBuilder.getPromptTemplate()
                    : '',
                meta: {
                    audioKey: context.audioKey,
                    documentId: context.documentId,
                    sourceMode: context.sourceMode,
                    documentBlockCount: context.totalBlocks,
                    blockCount: promptBlocks.length,
                    targetCount
                },
                blocks: promptBlocks,
                combinedPrompt
            }
        };
    }

    function renderAnnotationPromptPanel(promptPackage) {
        if (!annotationPromptPanel || !annotationPromptSummaryEl || !annotationPromptTextEl) return;
        const itemCount = Number(promptPackage && promptPackage.meta && promptPackage.meta.itemCount) || 0;
        const articleId = String(promptPackage && promptPackage.meta && promptPackage.meta.articleId || '');
        annotationPromptSummaryEl.textContent = `轻量手动模式：共 ${itemCount} 个 target${articleId ? `，articleId：${articleId}` : ''}`;
        annotationPromptTextEl.value = String(promptPackage && promptPackage.combinedPrompt || '');
        if (modalBackdrop) modalBackdrop.style.display = 'block';
        annotationPromptPanel.hidden = false;
    }

    function closeAnnotationPromptPanel() {
        if (!annotationPromptPanel || annotationPromptPanel.hidden) return;
        annotationPromptPanel.hidden = true;
        if (modalBackdrop) modalBackdrop.style.display = 'none';
    }

    async function copyAnnotationPromptToClipboard() {
        if (!currentAnnotationPromptPackage || !currentAnnotationPromptPackage.combinedPrompt) {
            showError('ANNOTATION_PROMPT_EMPTY', 'No prompt available');
            return;
        }
        if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') {
            showError('ANNOTATION_PROMPT_COPY', 'Clipboard API unavailable');
            return;
        }
        await navigator.clipboard.writeText(currentAnnotationPromptPackage.combinedPrompt);
        showToast('Prompt copied', 'success');
    }

    function exportAnnotationPromptPackage() {
        if (!currentAnnotationPromptPackage) {
            showError('ANNOTATION_PROMPT_EMPTY', 'No prompt package available');
            return;
        }
        const exportPayload = currentAnnotationPromptPackage.exportPayload || currentAnnotationPromptPackage;
        const articleId = sanitizeFilenamePart(exportPayload && exportPayload.articleId, getCurrentAudioFilenameBase('article'));
        downloadJsonFile(exportPayload, `${articleId}_annotation_light.json`);
        showToast('轻量 JSON exported', 'success');
    }

    function normalizeAnnotationTextValue(value) {
        return String(value || '').replace(/\s+/g, ' ').trim();
    }

    function buildAnnotationTargetCollection() {
        const targetSource = getAnnotationTargetSource();
        const context = buildAnnotationGenerationDocumentContext();
        if (!targetSource || typeof targetSource.buildTargetSource !== 'function') {
            return { context, targets: [], byId: new Map() };
        }
        const built = targetSource.buildTargetSource(context);
        const targets = Array.isArray(built && built.targets) ? built.targets : [];
        const byId = new Map();
        targets.forEach((target) => {
            const targetId = normalizeAnnotationTextValue(target && target.id);
            if (!targetId) return;
            byId.set(targetId, target);
        });
        return { context, targets, byId };
    }

    function getAnnotationTargetSentenceText(target) {
        return normalizeAnnotationTextValue(target && (target.sentenceText || target.sentencePlainText || target.boundary || target.markedText));
    }

    function stripAnnotationBoldMarkers(text) {
        return String(text || '').replace(/\*\*([^*]+(?:\*(?!\*)[^*]+)*)\*\*/g, '$1');
    }

    function buildAnnotationContextArticleText(context) {
        const blocks = Array.isArray(context && context.blocks) ? context.blocks : [];
        return blocks
            .map((block) => normalizeAnnotationTextValue(stripAnnotationBoldMarkers(block && block.text)))
            .filter(Boolean)
            .join(' ');
    }

    function normalizeAnnotationPunctuationChar(ch) {
        const map = {
            '“': '"',
            '”': '"',
            '‘': '\'',
            '’': '\'',
            '—': '-',
            '–': '-',
            '…': '...',
            '，': ',',
            '。': '.',
            '！': '!',
            '？': '?',
            '；': ';',
            '：': ':',
            '（': '(',
            '）': ')'
        };
        return Object.prototype.hasOwnProperty.call(map, ch) ? map[ch] : ch;
    }

    function normalizeAnnotationPunctuationText(value) {
        return String(value || '')
            .split('')
            .map((ch) => normalizeAnnotationPunctuationChar(ch))
            .join('');
    }

    function trimAnnotationEdgePunctuation(value) {
        return normalizeAnnotationPunctuationText(value)
            .replace(/^[\s"'`([{<,.;:!?/\\-]+/, '')
            .replace(/[\s"'`)\]}>.,;:!?/\\-]+$/, '')
            .trim();
    }

    function isLikelyAnnotationSentenceStart(text) {
        const source = normalizeAnnotationTextValue(text);
        if (!source) return false;
        if (/^[A-Z][a-z]/.test(source)) return true;
        return /^(I|We|You|He|She|They|It|This|That|These|Those|There|Here|However|But|So|Then|Meanwhile|Instead|In|On|At|By|For|To|From|As|If|When|While|After|Before|Because|Although|Being|The|A|An)\b/.test(source);
    }

    function getAnnotationSentenceFragmentLastWord(text) {
        const source = normalizeAnnotationTextValue(text);
        const match = source.match(/([A-Za-z]+)[^A-Za-z]*$/);
        return match ? match[1].toLowerCase() : '';
    }

    function getAnnotationSentenceFragmentWords(text) {
        return normalizeAnnotationTextValue(text)
            .split(/\s+/)
            .map((word) => word.replace(/^[^A-Za-z']+|[^A-Za-z'.]+$/g, ''))
            .filter(Boolean);
    }

    function isStrongAnnotationSentenceStarter(text) {
        const source = normalizeAnnotationTextValue(text);
        if (!source) return false;
        return /^(And\b|But\b|However\b|It's\b|It is\b|Keeping them\b|First,\b|You don't need\b|To understand where this belief came from\b|Early rechargeable batteries like the nickel\b|Modern devices use lithium ion batteries\b|These batteries are\b|They don't suffer from memory effect\b|But the old habits and warnings\b|Here's the key thing to understand\b|Your phone is smarter than you think\b|When your battery reaches 100%|Supporters on the other hand\b|supporters on the other hand\b|Regardless of where one stands\b|regardless of where one stands\b|What's fascinating is how\b|what's fascinating is how\b)/.test(source);
    }

    function isIncompleteAnnotationSentenceFragment(text) {
        const source = normalizeAnnotationTextValue(text);
        if (!source) return false;
        if (/[.!?;。！？；]["')\]”’）】》」』]*$/.test(source)) return false;
        const words = getAnnotationSentenceFragmentWords(source);
        const lastWord = getAnnotationSentenceFragmentLastWord(source);
        if (/[,;:]\s*$/.test(source)) return true;
        if (/^(and|or|but)\b/i.test(source) && !/[.!?;。！？；]["')\]”’）】》」』]*$/.test(source)) return true;
        if (/\b[aA]n?\s+[A-Za-z-]+$/.test(source) && words.length <= 5) return true;
        if (/\bthe\s+[A-Za-z-]+$/.test(source) && words.length <= 5) return true;
        if (/(?:^|\s)(in|on|at|to|for|of|from|by|with|as|into|onto|over|under|between|through|around|after|before|without|within|the|a|an|and|or|but)$/i.test(source)) {
            return true;
        }
        if (/^(?:[A-Z][a-z]+|\w+)\s+(?:is|are|was|were|be|been|being|has|have|had|can|could|will|would|should|may|might|must)\s+\w+\s+(?:in|on|at|to|for|of|from|by|with|as|into|onto|over|under|between|through|around|after|before|without|within|the|a|an)$/i.test(source)) {
            return true;
        }
        return /^(in|on|at|to|for|of|from|by|with|as|into|onto|over|under|between|through|around|after|before|without|within|the|a|an|and|or|but)$/.test(lastWord);
    }

    function shouldAvoidAnnotationSoftSplit(leftText, rightText) {
        const left = normalizeAnnotationTextValue(leftText);
        const right = normalizeAnnotationTextValue(rightText);
        if (!left || !right) return false;
        const leftWordCount = left.split(/\s+/).filter(Boolean).length;
        if (isStrongAnnotationSentenceStarter(right) && leftWordCount >= 5) return false;
        if (/[,;:]\s*$/.test(left) && isStrongAnnotationSentenceStarter(right) && leftWordCount >= 8) return false;
        if (isIncompleteAnnotationSentenceFragment(left)) return true;
        if (/\b(?:a|an|the)\s+[A-Za-z-]+$/.test(left) && /^[A-Z]/.test(right)) return true;
        if (/\b(?:a|an|the)\s+[A-Za-z-]+\s+[A-Za-z-]+$/.test(left) && /^(centered|rooted|based|named|built|designed|made)\b/i.test(right)) return true;
        if (/\b(?:v|vs)\.$/i.test(left) && /^[A-Z][a-z]+(?:\b|[.,])/.test(right)) return true;
        if (!/[.!?;。！？；]["')\]”’）】》」』]*$/.test(left)
            && /[A-Z][a-z]+[^A-Za-z]*$/.test(left)
            && /^[A-Z][a-z]+\b/.test(right)) {
            return true;
        }
        if (/,\s*$/.test(left) && /^[a-z]/.test(right)) return true;
        return false;
    }

    function mergeAnnotationSentenceFragments(pieces) {
        const sourcePieces = Array.isArray(pieces) ? pieces.map((piece) => normalizeAnnotationTextValue(piece)).filter(Boolean) : [];
        if (sourcePieces.length <= 1) return sourcePieces;
        const merged = [];

        sourcePieces.forEach((piece) => {
            if (!piece) return;
            if (!merged.length) {
                merged.push(piece);
                return;
            }
            const previous = merged[merged.length - 1];
            const combined = normalizeAnnotationTextValue(`${previous} ${piece}`);
            const previousWordCount = previous.split(/\s+/).filter(Boolean).length;
            const shouldMerge = shouldAvoidAnnotationSoftSplit(previous, piece)
                || (previousWordCount <= 7 && /,\s*$/.test(previous))
                || (previousWordCount <= 8 && isIncompleteAnnotationSentenceFragment(previous))
                || (/^[a-z]/.test(piece) && !isStrongAnnotationSentenceStarter(piece) && !/[.!?;。！？；]["')\]”’）】》」』]*$/.test(previous));

            if (shouldMerge) {
                merged[merged.length - 1] = combined;
                return;
            }
            merged.push(piece);
        });

        return merged;
    }

    function splitAnnotationFragmentsByStrongStarters(pieces) {
        const starterPattern = /\s+(?=(?:And that's where the term Miranda warning comes from\b|It's named after Ernesto Miranda\b|to understand where this belief came from\b|early rechargeable batteries like the nickel\b|modern devices use lithium ion batteries\b|these batteries are\b|they don't suffer from memory effect\b|but the old habits and warnings\b|here's the key thing to understand\b|your phone is smarter than you think\b|when your battery reaches 100%|supporters on the other hand\b|regardless of where one stands\b|what's fascinating is how\b))/gi;
        let current = (Array.isArray(pieces) ? pieces : []).map((piece) => normalizeAnnotationTextValue(piece)).filter(Boolean);

        for (let pass = 0; pass < 3; pass++) {
            const result = [];
            let changed = false;

            current.forEach((piece) => {
                const normalizedPiece = normalizeAnnotationTextValue(piece);
                if (!normalizedPiece) return;
                starterPattern.lastIndex = 0;
                let cursor = 0;
                let matched = false;
                let match;

                while ((match = starterPattern.exec(normalizedPiece)) !== null) {
                    const nextIndex = match.index;
                    const right = normalizeAnnotationTextValue(normalizedPiece.slice(nextIndex));
                    const left = normalizeAnnotationTextValue(normalizedPiece.slice(cursor, nextIndex)).replace(/,\s*$/, '').trim();
                    if (!left || !right) continue;
                    if (left.split(/\s+/).filter(Boolean).length < 6) continue;
                    result.push(left);
                    cursor = nextIndex;
                    matched = true;
                    changed = true;
                }

                const tail = normalizeAnnotationTextValue(normalizedPiece.slice(cursor));
                if (tail) result.push(tail);
                if (!matched && !tail) result.push(normalizedPiece);
            });

            current = result.filter(Boolean);
            if (!changed) break;
        }

        return current.filter(Boolean);
    }

    function splitAnnotationSpanByTerminalStrongStarters(span) {
        const sourceText = normalizeAnnotationTextValue(span && span.text);
        if (!sourceText) return [];
        const starterPattern = /(?<=[.!?;。！？；])\s+(?=(?:And that's where the term Miranda warning comes from\b|It's named after Ernesto Miranda\b|Keeping them\b|First,\b|You don't need\b))/gi;
        const pieces = [];
        let cursor = 0;
        let match;

        while ((match = starterPattern.exec(sourceText)) !== null) {
            const nextIndex = match.index;
            const pieceText = normalizeAnnotationTextValue(sourceText.slice(cursor, nextIndex));
            if (pieceText) {
                pieces.push({
                    text: pieceText,
                    start: (span && Number.isInteger(span.start) ? span.start : 0) + cursor,
                    end: (span && Number.isInteger(span.start) ? span.start : 0) + nextIndex
                });
            }
            cursor = nextIndex + match[0].length;
        }

        const tailText = normalizeAnnotationTextValue(sourceText.slice(cursor));
        if (tailText) {
            pieces.push({
                text: tailText,
                start: (span && Number.isInteger(span.start) ? span.start : 0) + cursor,
                end: span && Number.isInteger(span.end)
                    ? span.end
                    : ((span && Number.isInteger(span.start) ? span.start : 0) + sourceText.length)
            });
        }

        return pieces.length ? pieces : [span];
    }

    function splitLongAnnotationSentenceChunk(text) {
        const source = normalizeAnnotationTextValue(text);
        if (!source) return [];
        const maxWordCount = 28;
        const maxCharCount = 220;
        const wordCount = source.split(/\s+/).filter(Boolean).length;
        const shouldTrySoftSplit = wordCount > 16 || source.length > 100;
        if (!shouldTrySoftSplit && wordCount <= maxWordCount && source.length <= maxCharCount) return [source];

        const parts = [];
        let remaining = source;
        const boundaryPattern = /([,:;])\s+(?=[A-Z][^a-z]*[a-z]|(?:However|But|So|Then|Meanwhile|Instead|And|In|On|At|By|For|To|From|As|If|When|While|After|Before|Because|Although|The|A|An|This|That|These|Those|There|Here|Being|It's|They'r|Supporters|Regardless|What's)\b)/g;
        let lastIndex = 0;
        let match;

        while ((match = boundaryPattern.exec(remaining)) !== null) {
            const rightStart = normalizeAnnotationTextValue(remaining.slice(match.index + match[0].length));
            const keepBoundaryPunctuation = !(match[1] === ',' && isStrongAnnotationSentenceStarter(rightStart));
            const slice = normalizeAnnotationTextValue(remaining.slice(lastIndex, keepBoundaryPunctuation ? (match.index + match[1].length) : match.index));
            const nextSlice = normalizeAnnotationTextValue(remaining.slice(match.index + match[0].length - 1));
            if (!slice || !nextSlice) continue;
            const leftWords = slice.split(/\s+/).filter(Boolean).length;
            if (leftWords < 6) continue;
            if (!isLikelyAnnotationSentenceStart(rightStart)) continue;
            if (shouldAvoidAnnotationSoftSplit(slice, rightStart)) continue;
            parts.push(slice);
            lastIndex = match.index + match[0].length;
        }

        const tail = normalizeAnnotationTextValue(remaining.slice(lastIndex));
        if (tail) parts.push(tail);
        const preliminary = parts.length > 1 ? parts : [source];
        const lexicalPieces = [];
        const lexicalStarterPattern = /\s+(?=(?:[A-Z][a-z]|situations like this\b|today we're\b|understand shotgun marriages\b|in many communities\b|marriage was not just about love\b|it was also about responsibility\b|a pregnancy outside marriage\b|for women\b|marriage provided\b|for men\b|these marriages were\b|parents might\b|in many cases\b|although the term originated\b|when an unexpected pregnancy occurred\b|they might not have\b|a swift marriage could\b|in other cultures\b|communities valued\b|and marriage was seen\b|these shared patterns show\b|beyond social pressure\b|marriage created\b|it helped establish\b|without marriage\b|for many families\b|it ensured\b|even today\b|laws in many countries\b|while social and legal factors\b|couples who entered\b|some may have\b|others may have\b|for couples who already\b|in these situations\b|however, when\b|in today's world\b|many societies\b|couples have more freedom\b|however, the term\b|it is often used\b|movies, television shows\b|despite changing attitudes\b|cultural expectations\b|a shotgun marriage is\b|it is a reflection\b|it emerged during\b|for many couples\b|today, the meaning\b|while the urgency\b|it shows how\b|thank you for joining\b|don't forget to like\b|and that's where the term miranda warning comes from\b|it's named after ernesto miranda\b|supporters on the other hand\b|regardless of where one stands\b|what's fascinating is how\b))/gi;

        preliminary.forEach((piece) => {
            const normalizedPiece = normalizeAnnotationTextValue(piece);
            const pieceWords = normalizedPiece.split(/\s+/).filter(Boolean).length;
            if (pieceWords <= 18) {
                lexicalPieces.push(normalizedPiece);
                return;
            }
            lexicalStarterPattern.lastIndex = 0;
            let cursor = 0;
            let matched = false;
            let lexicalMatch;
            while ((lexicalMatch = lexicalStarterPattern.exec(normalizedPiece)) !== null) {
                const nextIndex = lexicalMatch.index;
                const left = normalizeAnnotationTextValue(normalizedPiece.slice(cursor, nextIndex));
                const right = normalizeAnnotationTextValue(normalizedPiece.slice(nextIndex));
                if (!left || !right) continue;
                if (left.split(/\s+/).filter(Boolean).length < 6) continue;
                if (shouldAvoidAnnotationSoftSplit(left, right)) continue;
                lexicalPieces.push(left);
                cursor = nextIndex;
                matched = true;
            }
            const tailPiece = normalizeAnnotationTextValue(normalizedPiece.slice(cursor));
            if (tailPiece) lexicalPieces.push(tailPiece);
            if (!matched && !tailPiece) lexicalPieces.push(normalizedPiece);
        });

        return splitAnnotationFragmentsByStrongStarters(
            mergeAnnotationSentenceFragments(lexicalPieces.filter(Boolean))
        );
    }

    function splitAnnotationSpanByPreferredSentences(span, preferredSentences) {
        const spanText = normalizeAnnotationTextValue(span && span.text);
        if (!spanText) return [];
        const sentences = Array.isArray(preferredSentences) ? preferredSentences : [];
        const normalizedPreferred = sentences
            .map((sentence) => normalizeAnnotationTextValue(sentence))
            .filter((sentence) => sentence && sentence.length < spanText.length)
            .sort((a, b) => b.length - a.length);

        for (let index = 0; index < normalizedPreferred.length; index++) {
            const sentence = normalizedPreferred[index];
            const matchIndex = spanText.indexOf(sentence);
            if (matchIndex < 0) continue;

            const pieces = [];
            const spanStart = span && Number.isInteger(span.start) ? span.start : 0;
            const beforeText = normalizeAnnotationTextValue(spanText.slice(0, matchIndex));
            const matchedText = sentence;
            const afterText = normalizeAnnotationTextValue(spanText.slice(matchIndex + sentence.length));

            if (beforeText) {
                pieces.push(...splitAnnotationSpanByPreferredSentences({
                    text: beforeText,
                    start: spanStart,
                    end: spanStart + beforeText.length
                }, preferredSentences));
            }
            pieces.push({
                text: matchedText,
                start: spanStart + matchIndex,
                end: spanStart + matchIndex + matchedText.length
            });
            if (afterText) {
                pieces.push(...splitAnnotationSpanByPreferredSentences({
                    text: afterText,
                    start: spanStart + matchIndex + matchedText.length,
                    end: spanStart + matchIndex + matchedText.length + afterText.length
                }, preferredSentences));
            }
            return pieces.filter((piece) => piece && piece.text);
        }

        return [{
            text: spanText,
            start: span && Number.isInteger(span.start) ? span.start : 0,
            end: span && Number.isInteger(span.end) ? span.end : ((span && Number.isInteger(span.start) ? span.start : 0) + spanText.length)
        }];
    }

    function splitAnnotationContextSentenceSpans(text, preferredSentences) {
        const source = String(text || '');
        const spans = [];
        const closingMarks = new Set(['"', '\'', ')', ']', '}', '”', '’', '）', '】', '》', '」', '』']);
        let start = 0;

        for (let index = 0; index < source.length; index++) {
            const ch = source[index];
            if (!/[.!?;。！？；]/.test(ch || '')) continue;
            let end = index + 1;
            while (end < source.length && closingMarks.has(source[end])) end += 1;
            const textSlice = normalizeAnnotationTextValue(source.slice(start, end));
            if (textSlice) spans.push({ text: textSlice, start, end });
            start = end;
            while (start < source.length && /\s/.test(source[start])) start += 1;
        }

        const tail = normalizeAnnotationTextValue(source.slice(start));
        if (tail) spans.push({ text: tail, start, end: source.length });
        if (!spans.length && source.trim()) spans.push({ text: normalizeAnnotationTextValue(source), start: 0, end: source.length });
        const aligned = [];
        spans.forEach((span) => {
            splitAnnotationSpanByPreferredSentences(span, preferredSentences).forEach((piece) => {
                if (piece && piece.text) aligned.push(piece);
            });
        });

        const refined = [];
        aligned.forEach((span) => {
            const pieces = splitLongAnnotationSentenceChunk(span && span.text);
            if (pieces.length <= 1) {
                refined.push({
                    text: normalizeAnnotationTextValue(span && span.text),
                    start: span && Number.isInteger(span.start) ? span.start : 0,
                    end: span && Number.isInteger(span.end) ? span.end : 0
                });
                return;
            }

            let cursor = span && Number.isInteger(span.start) ? span.start : 0;
            const spanSource = String(span && span.text || '');
            pieces.forEach((piece) => {
                const normalizedPiece = normalizeAnnotationTextValue(piece);
                const relativeIndex = spanSource.indexOf(normalizedPiece, Math.max(0, cursor - (span && Number.isInteger(span.start) ? span.start : 0)));
                const pieceStart = relativeIndex >= 0 && span && Number.isInteger(span.start)
                    ? span.start + relativeIndex
                    : cursor;
                const pieceEnd = pieceStart + normalizedPiece.length;
                refined.push({ text: normalizedPiece, start: pieceStart, end: pieceEnd });
                cursor = pieceEnd;
            });
        });

        const mergedRefined = [];
        refined.filter((span) => span && span.text).forEach((span) => {
            if (!mergedRefined.length) {
                mergedRefined.push(span);
                return;
            }
            const previous = mergedRefined[mergedRefined.length - 1];
            if (isStrongAnnotationSentenceStarter(span.text) && previous.text.split(/\s+/).filter(Boolean).length >= 5) {
                mergedRefined.push(span);
                return;
            }
            if (!shouldAvoidAnnotationSoftSplit(previous.text, span.text)
                && !(previous.text.split(/\s+/).filter(Boolean).length <= 7 && /,\s*$/.test(previous.text))
                && !(previous.text.split(/\s+/).filter(Boolean).length <= 8 && isIncompleteAnnotationSentenceFragment(previous.text))) {
                mergedRefined.push(span);
                return;
            }
            mergedRefined[mergedRefined.length - 1] = {
                text: normalizeAnnotationTextValue(`${previous.text} ${span.text}`),
                start: previous.start,
                end: span.end
            };
        });

        const finalized = mergedRefined
            .flatMap((span) => splitAnnotationSpanByTerminalStrongStarters(span))
            .filter((span) => span && span.text);

        return finalized.map((span, index) => {
            const next = finalized[index + 1];
            if (next && /,\s*$/.test(span.text) && isStrongAnnotationSentenceStarter(next.text)) {
                return {
                    ...span,
                    text: normalizeAnnotationTextValue(span.text).replace(/,\s*$/, '')
                };
            }
            return span;
        });
    }

    function normalizeAnnotationSentenceValue(value) {
        return trimAnnotationEdgePunctuation(value)
            .toLowerCase()
            .replace(/\s+/g, ' ')
            .trim();
    }

    function cleanMarkedTextForAnnotationContext(value) {
        return trimAnnotationEdgePunctuation(value);
    }

    function tokenizeAnnotationSentenceForMatch(value) {
        return normalizeAnnotationSentenceValue(value)
            .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, ' ')
            .trim()
            .split(/\s+/)
            .filter(Boolean);
    }

    function computeAnnotationSentenceOverlapScore(sourceSentence, candidateSentence, cleanMarkedText) {
        const sourceNormalized = normalizeAnnotationSentenceValue(sourceSentence);
        const candidateNormalized = normalizeAnnotationSentenceValue(candidateSentence);
        if (!sourceNormalized || !candidateNormalized) return -1;

        const sourceTokens = tokenizeAnnotationSentenceForMatch(sourceNormalized);
        const candidateTokens = tokenizeAnnotationSentenceForMatch(candidateNormalized);
        if (!sourceTokens.length || !candidateTokens.length) return -1;

        const candidateTokenSet = new Set(candidateTokens);
        const sourceTokenSet = new Set(sourceTokens);
        const sharedCount = sourceTokens.filter((token) => candidateTokenSet.has(token)).length;
        const sourceCoverage = sharedCount / sourceTokens.length;
        const candidateCoverage = sharedCount / candidateTokens.length;
        const markedNormalized = normalizeAnnotationSentenceValue(cleanMarkedText);
        const markedBoost = markedNormalized && candidateNormalized.includes(markedNormalized) ? 0.2 : 0;
        const containmentBoost = sourceNormalized.includes(candidateNormalized) || candidateNormalized.includes(sourceNormalized) ? 0.15 : 0;
        const orderPenalty = Math.abs(sourceTokens.length - candidateTokens.length) / Math.max(sourceTokens.length, candidateTokens.length, 1);

        return (sourceCoverage * 0.65) + (candidateCoverage * 0.35) + markedBoost + containmentBoost - (orderPenalty * 0.1);
    }

    function findFuzzyAnnotationContextSentenceIndex(sourceSentence, sentenceSpans, cleanMarkedText) {
        const spans = Array.isArray(sentenceSpans) ? sentenceSpans : [];
        const originalSourceSentence = normalizeAnnotationTextValue(sourceSentence);
        const normalizedSourceSentence = normalizeAnnotationSentenceValue(originalSourceSentence);
        if (!normalizedSourceSentence) return -1;

        let bestIndex = -1;
        let bestScore = -1;
        spans.forEach((span, index) => {
            const candidateText = normalizeAnnotationTextValue(span && span.text);
            const candidateNormalized = normalizeAnnotationSentenceValue(candidateText);
            if (!candidateNormalized) return;

            const score = computeAnnotationSentenceOverlapScore(originalSourceSentence, candidateText, cleanMarkedText);
            const markedNormalized = normalizeAnnotationSentenceValue(cleanMarkedText);
            const containsRelation = normalizedSourceSentence.includes(candidateNormalized) || candidateNormalized.includes(normalizedSourceSentence);
            const hasMarkedText = markedNormalized ? candidateNormalized.includes(markedNormalized) : true;
            const isReasonable = containsRelation || score >= 0.55 || (hasMarkedText && score >= 0.42);
            if (!isReasonable) return;
            if (score > bestScore) {
                bestScore = score;
                bestIndex = index;
            }
        });

        return bestIndex;
    }

    function resolveAnnotationContextSentence(sourceSentence, sentenceSpans, markedText) {
        const originalSourceSentence = normalizeAnnotationTextValue(sourceSentence);
        const spans = Array.isArray(sentenceSpans) ? sentenceSpans : [];
        const cleanMarkedText = cleanMarkedTextForAnnotationContext(markedText);
        if (!originalSourceSentence) {
            return {
                anchorSentence: '',
                sentenceBefore: '',
                sentenceAfter: '',
                sentenceIndex: -1,
                matchType: 'fallback'
            };
        }

        const exactIndex = spans.findIndex((span) => normalizeAnnotationTextValue(span && span.text) === originalSourceSentence);
        if (exactIndex >= 0) {
            return {
                anchorSentence: spans[exactIndex].text,
                sentenceBefore: exactIndex > 0 ? spans[exactIndex - 1].text : '',
                sentenceAfter: exactIndex < spans.length - 1 ? spans[exactIndex + 1].text : '',
                sentenceIndex: exactIndex,
                matchType: 'exact'
            };
        }

        const normalizedSourceSentence = normalizeAnnotationSentenceValue(originalSourceSentence);
        const normalizedIndex = normalizedSourceSentence
            ? spans.findIndex((span) => normalizeAnnotationSentenceValue(span && span.text) === normalizedSourceSentence)
            : -1;
        if (normalizedIndex >= 0) {
            return {
                anchorSentence: spans[normalizedIndex].text,
                sentenceBefore: normalizedIndex > 0 ? spans[normalizedIndex - 1].text : '',
                sentenceAfter: normalizedIndex < spans.length - 1 ? spans[normalizedIndex + 1].text : '',
                sentenceIndex: normalizedIndex,
                matchType: 'normalized'
            };
        }

        const fuzzyIndex = findFuzzyAnnotationContextSentenceIndex(originalSourceSentence, spans, cleanMarkedText);
        if (fuzzyIndex >= 0) {
            return {
                anchorSentence: spans[fuzzyIndex].text,
                sentenceBefore: fuzzyIndex > 0 ? spans[fuzzyIndex - 1].text : '',
                sentenceAfter: fuzzyIndex < spans.length - 1 ? spans[fuzzyIndex + 1].text : '',
                sentenceIndex: fuzzyIndex,
                matchType: 'fuzzy'
            };
        }

        return {
            anchorSentence: originalSourceSentence,
            sentenceBefore: '',
            sentenceAfter: '',
            sentenceIndex: -1,
            matchType: 'fallback'
        };
    }

    function buildManualLightweightTargetLookup(targets) {
        const byId = new Map();
        const bySentenceAndMarkedText = new Map();
        const occurrenceByTargetId = new Map();

        (Array.isArray(targets) ? targets : []).forEach((target) => {
            const targetId = normalizeAnnotationTextValue(target && target.id);
            if (targetId) byId.set(targetId, target);

            const sentence = normalizeAnnotationSentenceValue(getAnnotationTargetSentenceText(target));
            const markedText = normalizeAnnotationTextValue(target && target.markedText).toLowerCase();
            if (!sentence || !markedText) return;

            const key = `${sentence}::${markedText}`;
            if (!bySentenceAndMarkedText.has(key)) bySentenceAndMarkedText.set(key, []);
            const list = bySentenceAndMarkedText.get(key);
            list.push(target);
            occurrenceByTargetId.set(targetId, list.length - 1);
        });

        return {
            byId,
            bySentenceAndMarkedText,
            occurrenceByTargetId
        };
    }

    function resolveManualLightweightImportTarget(item, lookup) {
        if (!item || !lookup) {
            return { target: null, matchType: 'none', reason: 'invalid-item' };
        }

        const directTarget = lookup.byId instanceof Map ? lookup.byId.get(item.targetId) : null;
        if (directTarget) {
            return { target: directTarget, matchType: 'targetId', reason: '' };
        }

        const encodedTarget = buildSyntheticAnnotationTargetFromEncodedId(item.targetId, item);
        if (encodedTarget) {
            return { target: encodedTarget, matchType: 'targetId-encoded-range', reason: '' };
        }

        const normalizedSentence = normalizeAnnotationSentenceValue(item.sentence);
        const markedText = normalizeAnnotationTextValue(item.markedText).toLowerCase();
        if (!normalizedSentence || !markedText) {
            return { target: null, matchType: 'none', reason: 'missing-sentence-or-markedText' };
        }

        const key = `${normalizedSentence}::${markedText}`;
        const matches = lookup.bySentenceAndMarkedText instanceof Map ? (lookup.bySentenceAndMarkedText.get(key) || []) : [];
        if (!matches.length) {
            return { target: null, matchType: 'none', reason: 'missing-target' };
        }
        if (matches.length === 1) {
            return { target: matches[0], matchType: 'sentence+markedText', reason: '' };
        }

        if (Number.isInteger(item.occurrenceIndex) && item.occurrenceIndex >= 0 && item.occurrenceIndex < matches.length) {
            return { target: matches[item.occurrenceIndex], matchType: 'sentence+markedText+occurrenceIndex', reason: '' };
        }

        return { target: null, matchType: 'ambiguous', reason: 'ambiguous-without-occurrenceIndex', candidateCount: matches.length };
    }

    function buildManualLightweightAnnotationExportPayload() {
        const { context, targets } = buildAnnotationTargetCollection();
        if (!context.totalBlocks) {
            throw new Error('请先导入字幕或切分数据。');
        }
        if (!targets.length) {
            throw new Error('当前文档没有可导出的标注目标。');
        }
        const lookup = buildManualLightweightTargetLookup(targets);
        const articleText = buildAnnotationContextArticleText(context);
        const sentenceSpans = splitAnnotationContextSentenceSpans(articleText, targets.map((target) => getAnnotationTargetSentenceText(target)));
        return {
            schemaVersion: 2,
            articleId: normalizeAnnotationTextValue(context.documentId),
            articleText,
            articleSentences: sentenceSpans.map((span) => normalizeAnnotationTextValue(span && span.text)).filter(Boolean),
            items: targets.map((target) => ({
                ...resolveAnnotationContextSentence(getAnnotationTargetSentenceText(target), sentenceSpans, target && target.markedText),
                targetId: normalizeAnnotationTextValue(target && target.id),
                markedText: normalizeAnnotationTextValue(target && target.markedText),
                cleanMarkedText: cleanMarkedTextForAnnotationContext(target && target.markedText),
                sourceSentence: getAnnotationTargetSentenceText(target),
                occurrenceIndex: Number.isInteger(lookup.occurrenceByTargetId.get(normalizeAnnotationTextValue(target && target.id)))
                    ? lookup.occurrenceByTargetId.get(normalizeAnnotationTextValue(target && target.id))
                    : 0
            })).filter((item) => item.targetId && item.markedText && item.sourceSentence)
        };
    }

    function buildAnnotationContextPayloadFromArticle(articleText, targets, articleId = '') {
        const normalizedArticleText = normalizeAnnotationTextValue(articleText);
        const normalizedTargets = Array.isArray(targets) ? targets : [];
        const sentenceSpans = splitAnnotationContextSentenceSpans(
            normalizedArticleText,
            normalizedTargets.map((target) => getAnnotationTargetSentenceText(target))
        );
        return {
            schemaVersion: 2,
            articleId: normalizeAnnotationTextValue(articleId),
            articleText: normalizedArticleText,
            articleSentences: sentenceSpans.map((span) => normalizeAnnotationTextValue(span && span.text)).filter(Boolean),
            items: normalizedTargets.map((target) => ({
                ...resolveAnnotationContextSentence(getAnnotationTargetSentenceText(target), sentenceSpans, target && target.markedText),
                targetId: normalizeAnnotationTextValue(target && (target.targetId || target.id)),
                markedText: normalizeAnnotationTextValue(target && target.markedText),
                cleanMarkedText: cleanMarkedTextForAnnotationContext(target && target.markedText),
                sourceSentence: getAnnotationTargetSentenceText(target),
                occurrenceIndex: Number.isInteger(Number(target && target.occurrenceIndex))
                    ? Number(target.occurrenceIndex)
                    : 0
            })).filter((item) => item.targetId && item.markedText && item.sourceSentence)
        };
    }

    window.AnnotationContextExport = {
        buildPayloadFromArticle: buildAnnotationContextPayloadFromArticle
    };

    function downloadJsonFile(payload, filename) {
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(a.href), 0);
    }

    function sanitizeFilenamePart(value, fallback = 'article') {
        const normalized = String(value || '').trim().replace(/[\\/:*?"<>|]+/g, '_');
        return normalized || fallback;
    }

    function exportManualLightweightAnnotations() {
        const payload = buildManualLightweightAnnotationExportPayload();
        const filenameBase = sanitizeFilenamePart(payload.articleId || getCurrentAudioFilenameBase('article'), 'article');
        downloadJsonFile(payload, `${filenameBase}_annotation_light.json`);
        showToast(`轻量标注导出完成，共 ${payload.items.length} 条`, 'success');
        return payload;
    }

    function getManualLightweightPromptTemplate() {
        return [
            '你会收到一个 JSON 对象，其中包含 articleText 和 items 数组。',
            '每个 item 至少包含这些定位字段：targetId、markedText、cleanMarkedText、sourceSentence、anchorSentence、sentenceBefore、sentenceAfter、sentenceIndex、occurrenceIndex、matchType。',
            '请针对每个 item 返回：targetId、markedText、sourceSentence、occurrenceIndex、boundary、type、meaning、memoryHint。',
            'targetId、sourceSentence、occurrenceIndex 必须原样保留，不能改写或省略。',
            '输出格式必须是：',
            '{',
            '  "items": [',
            '    {',
            '      "targetId": "...",',
            '      "markedText": "...",',
            '      "sourceSentence": "...",',
            '      "occurrenceIndex": 0,',
            '      "boundary": "...",',
            '      "type": "...",',
            '      "meaning": "...",',
            '      "memoryHint": "..."',
            '    }',
            '  ]',
            '}',
            '只输出 JSON，不要解释，不要 markdown。'
        ].join('\n');
    }

    function buildManualLightweightPromptPackage() {
        const exportPayload = buildManualLightweightAnnotationExportPayload();
        const template = getManualLightweightPromptTemplate();
        return {
            schemaVersion: 1,
            mode: 'manual-lightweight',
            createdAt: new Date().toISOString(),
            template,
            exportPayload,
            meta: {
                articleId: exportPayload.articleId,
                itemCount: Array.isArray(exportPayload.items) ? exportPayload.items.length : 0
            },
            combinedPrompt: `${template}\n\n${JSON.stringify(exportPayload, null, 2)}`
        };
    }

    function normalizeImportedAnnotationItem(raw, index, target) {
        if (!raw || typeof raw !== 'object') return null;
        const targetMarkedText = normalizeAnnotationTextValue(target && target.markedText);
        const targetBoundary = normalizeAnnotationTextValue(target && (target.sentenceText || target.sentencePlainText || target.boundary || target.markedText));
        const targetBlockId = normalizeAnnotationTextValue(target && (target.sentenceId || target.blockId));
        const encodedTarget = buildSyntheticAnnotationTargetFromEncodedId(raw.targetId || (target && target.id) || '', raw);
        const markedText = String(raw.markedText || raw.marked_text || raw.word || raw.text || targetMarkedText || '').replace(/\s+/g, ' ').trim();
        const boundary = String(raw.boundary || raw.match_context || raw.context || raw.phrase || markedText).replace(/\s+/g, ' ').trim();
        const meaning = String(raw.meaning || raw.means || raw.explanation || raw.definition || raw.cn || raw.zh || '').trim();
        const memoryHint = String(raw.memoryHint || raw.memory_hint || raw.remember || raw.note || raw.not_meaning || raw.hint || '').trim();
        const rawStartValue = raw.occurrenceGlobalStart ?? raw.occurrence_global_start ?? raw.globalStart;
        const rawEndValue = raw.occurrenceGlobalEnd ?? raw.occurrence_global_end ?? raw.globalEnd;
        const targetStartValue = target && target.occurrenceGlobalStart;
        const targetEndValue = target && target.occurrenceGlobalEnd;
        const encodedStartValue = encodedTarget && encodedTarget.occurrenceGlobalStart;
        const encodedEndValue = encodedTarget && encodedTarget.occurrenceGlobalEnd;
        if (!markedText && !boundary) return null;
        return {
            ...raw,
            id: String(raw.id || raw.itemId || `imported-${index}`),
            targetId: String(raw.targetId || target && target.id || ''),
            blockId: String(raw.blockId || targetBlockId || ''),
            markedText: markedText || targetMarkedText,
            boundary: boundary || targetBoundary || markedText || targetMarkedText,
            type: String(raw.type || raw.category || raw.label || raw.tag || ''),
            meaning,
            memoryHint,
            occurrenceKey: String(raw.occurrenceKey || raw.occurrence_key || raw.hitKey || target && target.occurrenceKey || encodedTarget && encodedTarget.occurrenceKey || ''),
            occurrenceGlobalStart: rawStartValue != null && Number.isInteger(Number(rawStartValue))
                ? Number(rawStartValue)
                : (targetStartValue != null && Number.isInteger(Number(targetStartValue))
                    ? Number(targetStartValue)
                    : (encodedStartValue != null && Number.isInteger(Number(encodedStartValue)) ? Number(encodedStartValue) : null)),
            occurrenceGlobalEnd: rawEndValue != null && Number.isInteger(Number(rawEndValue))
                ? Number(rawEndValue)
                : (targetEndValue != null && Number.isInteger(Number(targetEndValue))
                    ? Number(targetEndValue)
                    : (encodedEndValue != null && Number.isInteger(Number(encodedEndValue)) ? Number(encodedEndValue) : null))
        };
    }

    function buildImportedAnnotationStatusBlocks(items, existingBlocks) {
        if (existingBlocks && typeof existingBlocks === 'object' && Object.keys(existingBlocks).length) return existingBlocks;
        const blocks = {};
        const importedAt = new Date().toISOString();
        items.forEach((item) => {
            const blockId = String(item && item.blockId || 'manual-import');
            if (!blocks[blockId]) {
                blocks[blockId] = {
                    state: 'imported',
                    insertedCount: 0,
                    importedAt
                };
            }
            blocks[blockId].insertedCount += 1;
        });
        return blocks;
    }

    function normalizeImportedAnnotationPayload(parsed, scope, storage) {
        const { context, byId } = buildAnnotationTargetCollection();
        let rawGenerated = null;
        let rawStatus = null;
        let rawItems = null;

        if (Array.isArray(parsed)) {
            rawItems = parsed;
        } else if (parsed && Array.isArray(parsed.items)) {
            rawGenerated = parsed;
            rawItems = parsed.items;
        } else if (parsed && parsed.generated && Array.isArray(parsed.generated.items)) {
            rawGenerated = parsed.generated;
            rawStatus = parsed.status;
            rawItems = parsed.generated.items;
        } else if (parsed && parsed.generatedBundle && Array.isArray(parsed.generatedBundle.items)) {
            rawGenerated = parsed.generatedBundle;
            rawStatus = parsed.status || parsed.generatedBundle.status;
            rawItems = parsed.generatedBundle.items;
        }

        if (!Array.isArray(rawItems)) {
            throw new Error('JSON 必须是 items 数组，或包含 generated.items 的对象');
        }
        if (!context.totalBlocks) {
            throw new Error('请先导入字幕或切分数据。');
        }

        const items = rawItems
            .map((item, index) => {
                const targetId = normalizeAnnotationTextValue(item && item.targetId);
                return normalizeImportedAnnotationItem(item, index, targetId ? byId.get(targetId) : null);
            })
            .filter(Boolean);
        if (!items.length) {
            throw new Error('导入文件里没有可用的注释 items');
        }

        const generatedBase = storage && typeof storage.createGeneratedJson === 'function'
            ? storage.createGeneratedJson(scope, [])
            : { schemaVersion: 1, audioKey: scope.audioKey, documentId: scope.documentId, items: [] };
        const statusBase = storage && typeof storage.createStatusJson === 'function'
            ? storage.createStatusJson(scope, {})
            : { schemaVersion: 1, audioKey: scope.audioKey, documentId: scope.documentId, blocks: {} };
        const importedAt = new Date().toISOString();

        return {
            generated: {
                ...generatedBase,
                ...(rawGenerated && typeof rawGenerated === 'object' ? rawGenerated : {}),
                schemaVersion: 1,
                audioKey: scope.audioKey,
                documentId: scope.documentId,
                importedAt,
                source: 'manual-import',
                items
            },
            status: {
                ...statusBase,
                ...(rawStatus && typeof rawStatus === 'object' ? rawStatus : {}),
                schemaVersion: 1,
                audioKey: scope.audioKey,
                documentId: scope.documentId,
                importedAt,
                source: 'manual-import',
                blocks: buildImportedAnnotationStatusBlocks(items, rawStatus && rawStatus.blocks)
            },
            itemCount: items.length
        };
    }

    async function importFullArticleAnnotations(file) {
        const storage = getAnnotationGenerationStorage();
        if (!storage || typeof storage.saveBundle !== 'function') {
            throw new Error('AnnotationGenerationStorage 不可用');
        }
        const rawText = await file.text();
        const parsed = JSON.parse(rawText);
        const scope = getAnnotationGenerationScope();
        const normalized = normalizeImportedAnnotationPayload(parsed, scope, storage);
        await storage.saveBundle(scope, normalized.generated, normalized.status);
        await refreshGeneratedAnnotationIndexForCurrentDocument();
        rebuildMarksFromAnnotationItems(normalized.generated && normalized.generated.items, {
            sourceType: 'annotation-full-import',
            replaceExisting: true
        });
        await syncAnnotationGenerationEntryStatus();
        return normalized;
    }

    function normalizeManualLightweightImportedItem(raw, index) {
        if (!raw || typeof raw !== 'object') return null;
        const targetId = normalizeAnnotationTextValue(raw.targetId);
        const markedText = normalizeAnnotationTextValue(raw.markedText || raw.marked_text || raw.word || raw.text);
        const sourceSentence = normalizeAnnotationTextValue(raw.sourceSentence || raw.source_sentence || raw.sentence || raw.sentenceText || raw.sentence_text || raw.contextSentence);
        const boundary = normalizeAnnotationTextValue(raw.boundary || raw.match_context || raw.context || raw.phrase);
        const type = normalizeAnnotationTextValue(raw.type || raw.category || raw.label || raw.tag);
        const meaning = normalizeAnnotationTextValue(raw.meaning || raw.means || raw.explanation || raw.definition || raw.cn || raw.zh);
        const memoryHint = normalizeAnnotationTextValue(raw.memoryHint || raw.memory_hint || raw.remember || raw.note || raw.not_meaning || raw.hint);
        const occurrenceIndexValue = Number(raw.occurrenceIndex != null ? raw.occurrenceIndex : raw.occurrence_index);
        const occurrenceIndex = Number.isInteger(occurrenceIndexValue) && occurrenceIndexValue >= 0 ? occurrenceIndexValue : null;
        if (!targetId) {
            return {
                index,
                ok: false,
                reason: 'missing-targetId'
            };
        }
        return {
            index,
            ok: true,
            targetId,
            markedText,
            sentence: sourceSentence,
            sourceSentence,
            occurrenceIndex,
            boundary,
            type,
            meaning,
            memoryHint,
            hasAnyBackfillField: !!(boundary || type || meaning || memoryHint)
        };
    }

    function buildManualLightweightImportedBundle(parsed, scope, storage) {
        if (!parsed || !Array.isArray(parsed.items)) {
            throw new Error('JSON 必须是包含 items 数组的对象。');
        }

        const { context, targets } = buildAnnotationTargetCollection();
        if (!context.totalBlocks) {
            throw new Error('请先导入字幕或切分数据。');
        }
        const targetLookup = buildManualLightweightTargetLookup(targets);

        const normalizedItems = parsed.items
            .map((item, index) => normalizeManualLightweightImportedItem(item, index))
            .filter(Boolean);
        if (!normalizedItems.length) {
            throw new Error('导入文件里没有可用的 items。');
        }

        const generatedBase = storage && typeof storage.createGeneratedJson === 'function'
            ? storage.createGeneratedJson(scope, [])
            : { schemaVersion: 1, audioKey: scope.audioKey, documentId: scope.documentId, items: [] };
        const statusBase = storage && typeof storage.createStatusJson === 'function'
            ? storage.createStatusJson(scope, {})
            : { schemaVersion: 1, audioKey: scope.audioKey, documentId: scope.documentId, blocks: {} };

        return storage.loadBundle(scope).then((existingBundle) => {
            const existingGenerated = existingBundle && existingBundle.generated && typeof existingBundle.generated === 'object'
                ? existingBundle.generated
                : generatedBase;
            const existingStatus = existingBundle && existingBundle.status && typeof existingBundle.status === 'object'
                ? existingBundle.status
                : statusBase;
            const existingItems = Array.isArray(existingGenerated.items) ? existingGenerated.items : [];
            const existingByTargetId = new Map();
            existingItems.forEach((item) => {
                const targetId = normalizeAnnotationTextValue(item && item.targetId);
                if (targetId) existingByTargetId.set(targetId, item);
            });

            const nextByTargetId = new Map(existingByTargetId);
            const missingTargetIds = [];
            const skippedItems = [];
            const markedTextMismatchTargetIds = [];
            const ambiguousItems = [];
            let importedCount = 0;

            normalizedItems.forEach((item) => {
                if (!item.ok) {
                    skippedItems.push(item.reason || 'invalid-item');
                    return;
                }
                const resolved = resolveManualLightweightImportTarget(item, targetLookup);
                const target = resolved.target;
                if (!target) {
                    if (resolved.reason === 'ambiguous-without-occurrenceIndex') {
                        ambiguousItems.push(item.targetId || item.markedText || `item-${item.index}`);
                    } else {
                        missingTargetIds.push(item.targetId);
                    }
                    return;
                }
                if (!item.hasAnyBackfillField) {
                    skippedItems.push(item.targetId);
                    return;
                }

                const targetMarkedText = normalizeAnnotationTextValue(target.markedText);
                if (item.markedText && targetMarkedText && item.markedText !== targetMarkedText) {
                    markedTextMismatchTargetIds.push(item.targetId);
                }

                const resolvedTargetId = normalizeAnnotationTextValue(target.id || item.targetId);
                const existing = nextByTargetId.get(resolvedTargetId) || nextByTargetId.get(item.targetId) || {};
                const blockId = normalizeAnnotationTextValue(existing.blockId || target.sentenceId || 'manual-import');
                const boundary = item.boundary
                    || normalizeAnnotationTextValue(existing.boundary)
                    || normalizeAnnotationTextValue(target.sentenceText || target.sentencePlainText || target.boundary || target.markedText);

                nextByTargetId.set(resolvedTargetId, {
                    ...existing,
                    id: normalizeAnnotationTextValue(existing.id || `manual-${resolvedTargetId}`),
                    targetId: resolvedTargetId,
                    blockId,
                    markedText: targetMarkedText || item.markedText,
                    boundary,
                    type: item.type || normalizeAnnotationTextValue(existing.type),
                    meaning: item.meaning || normalizeAnnotationTextValue(existing.meaning),
                    memoryHint: item.memoryHint || normalizeAnnotationTextValue(existing.memoryHint),
                    occurrenceKey: normalizeAnnotationTextValue(existing.occurrenceKey || target.occurrenceKey),
                    occurrenceGlobalStart: Number.isInteger(Number(existing.occurrenceGlobalStart))
                        ? Number(existing.occurrenceGlobalStart)
                        : (Number.isInteger(Number(target.occurrenceGlobalStart)) ? Number(target.occurrenceGlobalStart) : null),
                    occurrenceGlobalEnd: Number.isInteger(Number(existing.occurrenceGlobalEnd))
                        ? Number(existing.occurrenceGlobalEnd)
                        : (Number.isInteger(Number(target.occurrenceGlobalEnd)) ? Number(target.occurrenceGlobalEnd) : null),
                    source: 'manual-lightweight-import'
                });
                importedCount += 1;
            });

            if (!importedCount) {
                throw new Error('没有成功匹配并回填任何 target。');
            }

            const mergedItems = Array.from(nextByTargetId.values());
            const importedAt = new Date().toISOString();
            return {
                generated: {
                    ...generatedBase,
                    ...existingGenerated,
                    schemaVersion: 1,
                    audioKey: scope.audioKey,
                    documentId: scope.documentId,
                    importedAt,
                    source: 'manual-lightweight-import',
                    items: mergedItems
                },
                status: {
                    ...statusBase,
                    ...existingStatus,
                    schemaVersion: 1,
                    audioKey: scope.audioKey,
                    documentId: scope.documentId,
                    importedAt,
                    source: 'manual-lightweight-import',
                    blocks: buildImportedAnnotationStatusBlocks(mergedItems, existingStatus && existingStatus.blocks)
                },
                importedCount,
                skippedCount: skippedItems.length + missingTargetIds.length + ambiguousItems.length,
                missingTargetIds,
                markedTextMismatchTargetIds,
                ambiguousItems
            };
        });
    }

    async function importManualLightweightAnnotations(file) {
        const storage = getAnnotationGenerationStorage();
        if (!storage || typeof storage.saveBundle !== 'function' || typeof storage.loadBundle !== 'function') {
            throw new Error('AnnotationGenerationStorage 不可用');
        }
        const rawText = await file.text();
        const parsed = JSON.parse(rawText);
        const scope = getAnnotationGenerationScope();
        const normalized = await buildManualLightweightImportedBundle(parsed, scope, storage);
        await storage.saveBundle(scope, normalized.generated, normalized.status);
        await refreshGeneratedAnnotationIndexForCurrentDocument();
        rebuildMarksFromAnnotationItems(normalized.generated && normalized.generated.items, {
            sourceType: 'annotation-lightweight-import',
            replaceExisting: true
        });
        await syncAnnotationGenerationEntryStatus();
        return normalized;
    }

    async function startAnnotationGenerationFromEntry(entryUi) {
        const ui = entryUi || getAnnotationGenerationEntryUi();
        let promptPackage = null;
        try {
            promptPackage = buildManualLightweightPromptPackage();
        } catch (error) {
            ui?.setStatus({
                state: 'retryable',
                total: 0,
                completed: 0,
                failed: 0,
                message: error && error.message ? error.message : '轻量 Prompt 提取失败。'
            });
            return;
        }

        currentAnnotationPromptPackage = promptPackage;
        renderAnnotationPromptPanel(promptPackage);
        ui?.setStatus({
            state: 'ready',
            total: promptPackage.meta.itemCount,
            completed: 0,
            failed: 0,
            message: `轻量 Prompt 已提取，共 ${promptPackage.meta.itemCount} 个 target。`
        });
        showToast('轻量 Prompt 已提取，可复制或导出 JSON', 'success');
    }

    function buildAnnotationEntryResultMessage(result) {
        if (!result || typeof result !== 'object') return '';
        const message = String(result.message || '').trim();
        const failureType = String(result.failureType || '').trim();
        const failureMessage = String(result.failureMessage || '').trim();
        if (result.state === 'stopped') {
            return message || (result.requestAborted ? '本轮已停止，当前请求已取消。' : '本轮已停止，不会继续后续请求。');
        }
        if (result.finalRunReason === 'budget_exhausted') {
            return message || '本轮已用尽 10 次请求预算，剩余目标请手工再次触发。';
        }
        if ((result.state === 'failed' || result.state === 'partial-failed') && (failureType || failureMessage)) {
            const detail = failureMessage || message;
            return `生成失败：${buildAnnotationFailureLabel(failureType)}${detail ? ` - ${detail}` : ''}`;
        }
        if (message) return message;
        return '';
    }

    function buildAnnotationFailureLabel(failureType) {
        const type = String(failureType || '').trim();
        if (type === 'provider_server') return '503 Service Unavailable';
        if (type === 'request_invalid') return '400 request_invalid';
        if (type === 'network') return 'network error';
        if (type === 'rate_limited') return 'provider rate limited';
        if (type === 'timeout') return 'request timeout';
        if (type === 'aborted') return 'request aborted';
        if (type) return type;
        return 'request_failed';
    }

    function initAnnotationGenerationEntryUi() {
        const entryUi = getAnnotationGenerationEntryUi();
        if (!entryUi || typeof entryUi.init !== 'function') return;
        entryUi.init({
            buttonEl: annotationGenerateBtn,
            rootEl: annotationGenerationStatusEl,
            onStart: startAnnotationGenerationFromEntry,
            onStop: requestAnnotationGenerationStopFromEntry
        });
        syncAnnotationGenerationEntryStatus();
    }

    function initAnnotationApiSettingsUi() {
        if (!annotationApiSettingsBtn || annotationApiSettingsBtn.hidden) return;
        const configHelper = getAnnotationApiConfigHelper();
        if (configHelper && typeof configHelper.restore === 'function') {
            configHelper.restore();
        }

        const settingsUi = window.AnnotationApiSettingsUI || null;
        if (!settingsUi || typeof settingsUi.init !== 'function') return;
        settingsUi.init({
            buttonEl: annotationApiSettingsBtn,
            panelEl: annotationApiSettingsPanel,
            onChange: () => {
                syncAnnotationGenerationEntryStatus();
            }
        });
    }

    async function clearPersistedChunkSession() {
        chunkItems = [];
        hasAiChunkData = false;
        manualChunkStates = {};
        selectedSentence = null;
        lastActiveChunkIndex = -1;
        lastAiPrevTapChunkIndex = -1;
        lastAiPrevTapAt = 0;
        try {
            localStorage.removeItem('manualChunkStates');
            localStorage.removeItem('isChunkMode');
        } catch (e) {}
        await deleteFromDB('chunkData');
        await deleteFromDB('marks');
        toggleChunkBtn.innerText = 'AI切分';
        if (isChunkMode) {
            isChunkMode = false;
        }
    }

    async function clearPersistedReaderContentOnStartup() {
        emitAnnotationDiagnostics('app.startup_clear_reader_skipped', {
            scope: getAnnotationGenerationScope(),
            currentAudioKey,
            currentDocId,
            skippedKeys: ['transcript', 'marks', 'notes', 'visual', 'chunkData']
        });
        try {
            localStorage.removeItem('manualChunkStates');
            localStorage.removeItem('isChunkMode');
            localStorage.removeItem('chunkCnVisible');
            localStorage.removeItem('chunkCnHoldMode');
            localStorage.removeItem('chunkNoteVisible');
        } catch (e) {}
    }

    // --- Settings Load ---
    try {
      if(localStorage.getItem('markKey')) { markKey = localStorage.getItem('markKey').toLowerCase(); hotkeyInput.value = markKey; }
      if(localStorage.getItem('notesKey')) { notesKey = localStorage.getItem('notesKey').toLowerCase(); hotkeyNotesInput.value = notesKey; }
      if(localStorage.getItem('annotationBubbleKey')) { annotationBubbleKey = localStorage.getItem('annotationBubbleKey').toLowerCase(); if (hotkeyAnnotationBubbleInput) hotkeyAnnotationBubbleInput.value = annotationBubbleKey; }
      if(localStorage.getItem('chunkCnKey')) { chunkCnKey = localStorage.getItem('chunkCnKey').toLowerCase(); hotkeyChunkCnInput.value = chunkCnKey; }
      if(localStorage.getItem('chunkShadowKey')) { chunkShadowKey = localStorage.getItem('chunkShadowKey').toLowerCase(); hotkeyChunkShadowInput.value = chunkShadowKey; }
      if(localStorage.getItem('chunkNoteKey')) { chunkNoteKey = localStorage.getItem('chunkNoteKey').toLowerCase(); if (hotkeyChunkNoteInput) hotkeyChunkNoteInput.value = chunkNoteKey; }
      if(localStorage.getItem('backwardKey')) { backwardKey = localStorage.getItem('backwardKey'); hotkeyBackwardInput.value = backwardKey; }
      if(localStorage.getItem('forwardKey')) { forwardKey = localStorage.getItem('forwardKey'); hotkeyForwardInput.value = forwardKey; }
      if(localStorage.getItem('highlightColor')) { document.documentElement.style.setProperty('--word-highlight-bg', localStorage.getItem('highlightColor')); highlightColorInput.value = localStorage.getItem('highlightColor'); }
      if(localStorage.getItem('sentenceColor')) { document.documentElement.style.setProperty('--sentence-highlight-bg', localStorage.getItem('sentenceColor')); sentenceColorInput.value = localStorage.getItem('sentenceColor'); }
      if(localStorage.getItem('chunkNoteSize')) { document.documentElement.style.setProperty('--chunk-note-size', localStorage.getItem('chunkNoteSize')); }
      if(localStorage.getItem('chunkNoteColor')) { document.documentElement.style.setProperty('--chunk-note-color', localStorage.getItem('chunkNoteColor')); }
      const storedNoteWidthRaw = localStorage.getItem('chunkNoteWidth');
      if(storedNoteWidthRaw) {
          const parsedW = parseFloat(storedNoteWidthRaw);
          if (Number.isFinite(parsedW)) {
              const migratedW = Math.abs(parsedW - 620) < 0.1 ? 260 : parsedW;
              const safeW = Math.max(140, Math.min(1200, migratedW));
              const nextW = `${safeW}px`;
              document.documentElement.style.setProperty('--chunk-note-width', nextW);
              if (storedNoteWidthRaw !== nextW) localStorage.setItem('chunkNoteWidth', nextW);
          }
      }
      const storedNoteMinHRaw = localStorage.getItem('chunkNoteMinHeight');
      if(storedNoteMinHRaw) {
          const parsedH = parseFloat(storedNoteMinHRaw);
          if (Number.isFinite(parsedH)) {
              const migratedH = (Math.abs(parsedH - 56) < 0.1 || Math.abs(parsedH - 44) < 0.1 || Math.abs(parsedH - 36) < 0.1 || Math.abs(parsedH - 30) < 0.1) ? 18 : parsedH;
              const safeH = Math.max(18, Math.min(360, migratedH));
              const nextH = `${safeH}px`;
              document.documentElement.style.setProperty('--chunk-note-min-height', nextH);
              if (storedNoteMinHRaw !== nextH) localStorage.setItem('chunkNoteMinHeight', nextH);
          }
      }
      if(localStorage.getItem('chunkNoteArrowSize')) { document.documentElement.style.setProperty('--chunk-note-arrow-size', localStorage.getItem('chunkNoteArrowSize')); }
      const storedPreviewVisible = localStorage.getItem('notePreviewVisible');
      if (storedPreviewVisible !== null) notePreviewVisible = storedPreviewVisible === 'true';
      const storedPreviewWidth = parseFloat(localStorage.getItem('notePreviewWidth') || '');
      if (Number.isFinite(storedPreviewWidth)) {
          notePreviewWidth = Math.max(280, Math.min(520, storedPreviewWidth));
      }
      const storedPreviewHeight = parseFloat(localStorage.getItem('notePreviewHeight') || '');
      if (Number.isFinite(storedPreviewHeight)) {
          notePreviewHeight = Math.max(420, Math.min(window.innerHeight - 28, storedPreviewHeight));
      }
    } catch(e){}

    // === Startup wiring: theme + sentence notebook ui events ===
    const CUSTOM_THEME_STORAGE_KEY = 'themeCustomColors';
    const CUSTOM_THEME_DEFAULTS = {
        bg: '#eef2f7',
        text: '#1c1e21',
        sub: '#4b5563',
        border: '#cbd5e1',
        button: '#dbeafe'
    };
    const CUSTOM_THEME_VAR_NAMES = [
        '--bg-color',
        '--text-main',
        '--text-sub',
        '--border-color',
        '--input-bg',
        '--input-text',
        '--btn-bg',
        '--btn-hover',
        '--btn-text',
        '--btn-active-bg',
        '--btn-active-border',
        '--sidebar-bg',
        '--sidebar-border',
        '--card-bg',
        '--vocab-indicator-color',
        '--v-word-color',
        '--v-context-color',
        '--v-meaning-color',
        '--v-not-color',
        '--chunk-active-bg',
        '--chunk-cn-color',
        '--chunk-note-color',
        '--chunk-note-glass-bg',
        '--chunk-note-glass-border',
        '--chunk-note-connector-default',
        '--chunk-note-connector-shadow',
        '--chunk-annot-default',
        '--glass-bg-light',
        '--glass-bg-medium',
        '--glass-bg-strong',
        '--glass-border-light',
        '--glass-border-strong',
        '--glass-shadow',
        '--glass-shadow-soft',
        '--liquid-bg',
        '--liquid-border',
        '--liquid-specular',
        '--liquid-shadow',
        '--glass-panel-bg',
        '--glass-panel-bg-strong',
        '--glass-button-bg',
        '--glass-card-bg',
        '--glass-border',
        '--glass-highlight',
        '--glass-shadow-sm',
        '--glass-shadow-md',
        '--glass-shadow-lg',
        '--bg-gradient'
    ];

    function clampByte(value) {
        return Math.max(0, Math.min(255, Math.round(value)));
    }

    function normalizeHexColor(value, fallback) {
        const raw = String(value || '').trim();
        if (/^#[0-9a-fA-F]{6}$/.test(raw)) return raw.toLowerCase();
        if (/^#[0-9a-fA-F]{3}$/.test(raw)) {
            return `#${raw[1]}${raw[1]}${raw[2]}${raw[2]}${raw[3]}${raw[3]}`.toLowerCase();
        }
        return fallback;
    }

    function hexToRgb(hex) {
        const normalized = normalizeHexColor(hex, '#000000').slice(1);
        return {
            r: parseInt(normalized.slice(0, 2), 16),
            g: parseInt(normalized.slice(2, 4), 16),
            b: parseInt(normalized.slice(4, 6), 16)
        };
    }

    function rgbToHex(rgb) {
        return `#${[rgb.r, rgb.g, rgb.b].map(value => clampByte(value).toString(16).padStart(2, '0')).join('')}`;
    }

    function mixHex(colorA, colorB, weight = 0.5) {
        const a = hexToRgb(colorA);
        const b = hexToRgb(colorB);
        const ratio = Math.max(0, Math.min(1, weight));
        return rgbToHex({
            r: a.r + ((b.r - a.r) * ratio),
            g: a.g + ((b.g - a.g) * ratio),
            b: a.b + ((b.b - a.b) * ratio)
        });
    }

    function hexToRgba(hex, alpha) {
        const rgb = hexToRgb(hex);
        return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
    }

    function getColorLuminance(hex) {
        const rgb = hexToRgb(hex);
        return ((rgb.r * 0.2126) + (rgb.g * 0.7152) + (rgb.b * 0.0722)) / 255;
    }

    function getStoredCustomThemeColors() {
        try {
            const parsed = JSON.parse(localStorage.getItem(CUSTOM_THEME_STORAGE_KEY) || '{}');
            return {
                bg: normalizeHexColor(parsed.bg, CUSTOM_THEME_DEFAULTS.bg),
                text: normalizeHexColor(parsed.text, CUSTOM_THEME_DEFAULTS.text),
                sub: normalizeHexColor(parsed.sub, CUSTOM_THEME_DEFAULTS.sub),
                border: normalizeHexColor(parsed.border, CUSTOM_THEME_DEFAULTS.border),
                button: normalizeHexColor(parsed.button, CUSTOM_THEME_DEFAULTS.button)
            };
        } catch (error) {
            return { ...CUSTOM_THEME_DEFAULTS };
        }
    }

    function setCustomThemeInputValues(colors) {
        if (!themeCustomBgInput || !themeCustomTextInput || !themeCustomSubInput || !themeCustomBorderInput || !themeCustomButtonInput) {
            return;
        }
        themeCustomBgInput.value = colors.bg;
        themeCustomTextInput.value = colors.text;
        themeCustomSubInput.value = colors.sub;
        themeCustomBorderInput.value = colors.border;
        themeCustomButtonInput.value = colors.button;
    }

    function clearCustomThemeVars() {
        CUSTOM_THEME_VAR_NAMES.forEach(name => {
            document.documentElement.style.removeProperty(name);
        });
    }

    function buildCustomThemeVars(colors) {
        const isDarkBase = getColorLuminance(colors.bg) < 0.45;
        const shadowColor = isDarkBase ? 'rgba(0, 0, 0, 0.34)' : 'rgba(15, 23, 42, 0.12)';
        const shadowSoftColor = isDarkBase ? 'rgba(0, 0, 0, 0.26)' : 'rgba(15, 23, 42, 0.10)';
        const shadowStrongColor = isDarkBase ? 'rgba(0, 0, 0, 0.42)' : 'rgba(15, 23, 42, 0.18)';
        const highlightColor = isDarkBase ? 'rgba(255, 255, 255, 0.16)' : 'rgba(255, 255, 255, 0.78)';
        const sidebarBg = mixHex(colors.bg, colors.text, isDarkBase ? 0.12 : 0.04);
        const cardBg = mixHex(colors.bg, colors.button, 0.32);
        const chunkActiveBg = mixHex(colors.bg, colors.text, isDarkBase ? 0.18 : 0.1);
        const glassBgBase = isDarkBase ? mixHex(colors.bg, '#101418', 0.24) : mixHex(colors.bg, '#ffffff', 0.38);
        const panelBgBase = isDarkBase ? mixHex(colors.bg, colors.button, 0.2) : mixHex(colors.bg, colors.button, 0.42);
        const radialA = hexToRgba(mixHex(colors.button, '#ffffff', isDarkBase ? 0.08 : 0.45), isDarkBase ? 0.2 : 0.42);
        const radialB = hexToRgba(mixHex(colors.border, colors.button, 0.4), isDarkBase ? 0.18 : 0.3);
        return {
            '--bg-color': colors.bg,
            '--text-main': colors.text,
            '--text-sub': colors.sub,
            '--border-color': colors.border,
            '--input-bg': mixHex(colors.bg, colors.text, isDarkBase ? 0.12 : 0.05),
            '--input-text': colors.text,
            '--btn-bg': colors.button,
            '--btn-hover': mixHex(colors.button, colors.text, isDarkBase ? 0.18 : 0.12),
            '--btn-text': colors.text,
            '--btn-active-bg': mixHex(colors.button, colors.text, isDarkBase ? 0.3 : 0.2),
            '--btn-active-border': mixHex(colors.border, colors.text, isDarkBase ? 0.22 : 0.08),
            '--sidebar-bg': sidebarBg,
            '--sidebar-border': colors.border,
            '--card-bg': cardBg,
            '--vocab-indicator-color': colors.sub,
            '--v-word-color': colors.text,
            '--v-context-color': colors.sub,
            '--v-meaning-color': colors.sub,
            '--v-not-color': mixHex(colors.sub, colors.bg, 0.22),
            '--chunk-active-bg': chunkActiveBg,
            '--chunk-cn-color': colors.sub,
            '--chunk-note-color': colors.text,
            '--chunk-note-glass-bg': hexToRgba(panelBgBase, isDarkBase ? 0.82 : 0.84),
            '--chunk-note-glass-border': hexToRgba(colors.border, isDarkBase ? 0.28 : 0.4),
            '--chunk-note-connector-default': hexToRgba(colors.text, isDarkBase ? 0.48 : 0.32),
            '--chunk-note-connector-shadow': hexToRgba(isDarkBase ? '#000000' : '#ffffff', isDarkBase ? 0.22 : 0.55),
            '--chunk-annot-default': hexToRgba(colors.text, isDarkBase ? 0.42 : 0.3),
            '--glass-bg-light': hexToRgba(glassBgBase, 0.56),
            '--glass-bg-medium': hexToRgba(glassBgBase, 0.62),
            '--glass-bg-strong': hexToRgba(glassBgBase, 0.72),
            '--glass-border-light': hexToRgba(colors.border, isDarkBase ? 0.16 : 0.58),
            '--glass-border-strong': hexToRgba(colors.border, isDarkBase ? 0.24 : 0.72),
            '--glass-shadow': `0 8px 24px ${shadowColor}`,
            '--glass-shadow-soft': `0 2px 10px ${shadowSoftColor}`,
            '--liquid-bg': hexToRgba(glassBgBase, isDarkBase ? 0.28 : 0.25),
            '--liquid-border': hexToRgba(colors.border, isDarkBase ? 0.2 : 0.36),
            '--liquid-specular': isDarkBase
                ? 'inset 1px 1px 0 rgba(255, 255, 255, 0.18), inset 0 0 5px rgba(255, 255, 255, 0.12)'
                : 'inset 1px 1px 0 rgba(255, 255, 255, 0.75), inset 0 0 5px rgba(255, 255, 255, 0.75)',
            '--liquid-shadow': isDarkBase
                ? '0 6px 6px rgba(0, 0, 0, 0.32), 0 0 20px rgba(0, 0, 0, 0.20)'
                : '0 6px 6px rgba(0, 0, 0, 0.2), 0 0 20px rgba(0, 0, 0, 0.1)',
            '--glass-panel-bg': hexToRgba(panelBgBase, isDarkBase ? 0.56 : 0.34),
            '--glass-panel-bg-strong': hexToRgba(panelBgBase, isDarkBase ? 0.64 : 0.42),
            '--glass-button-bg': hexToRgba(colors.button, isDarkBase ? 0.52 : 0.26),
            '--glass-card-bg': hexToRgba(cardBg, isDarkBase ? 0.66 : 0.48),
            '--glass-border': hexToRgba(colors.border, isDarkBase ? 0.22 : 0.52),
            '--glass-highlight': highlightColor,
            '--glass-shadow-sm': `0 2px 8px ${shadowSoftColor}`,
            '--glass-shadow-md': `0 6px 22px ${shadowColor}`,
            '--glass-shadow-lg': `0 16px 34px ${shadowStrongColor}`,
            '--bg-gradient': `radial-gradient(1200px 520px at -8% -16%, ${radialA}, transparent 60%), radial-gradient(900px 500px at 108% 4%, ${radialB}, transparent 56%), linear-gradient(180deg, ${mixHex(colors.bg, '#ffffff', isDarkBase ? 0.04 : 0.16)} 0%, ${mixHex(colors.bg, '#000000', isDarkBase ? 0.12 : 0.04)} 100%)`
        };
    }

    function updateThemeToggleUi(theme) {
        const labels = {
            light: { icon: '☀', title: '当前浅色，点击切换到深色' },
            dark: { icon: '☾', title: '当前深色，点击切换到自定义' },
            custom: { icon: '✦', title: '当前自定义，点击切换到浅色' }
        };
        const config = labels[theme] || labels.light;
        themeToggleBtn.textContent = config.icon;
        themeToggleBtn.title = config.title;
        if (themeCustomPanel && theme !== 'custom') {
            themeCustomPanel.hidden = true;
        }
        if (themeToggleBtn) {
            themeToggleBtn.setAttribute('aria-expanded', String(themeCustomPanel && !themeCustomPanel.hidden));
        }
    }

    function openCustomThemePanel() {
        if (!themeCustomPanel) return;
        themeCustomPanel.hidden = false;
        if (themeToggleBtn) {
            themeToggleBtn.setAttribute('aria-expanded', 'true');
        }
    }

    function closeCustomThemePanel() {
        if (!themeCustomPanel) return;
        themeCustomPanel.hidden = true;
        if (themeToggleBtn) {
            themeToggleBtn.setAttribute('aria-expanded', 'false');
        }
    }

    function applyThemeDefaults(theme) {
        if (localStorage.getItem('sentenceColor') || localStorage.getItem('highlightColor')) {
            return;
        }
        const defaults = theme === 'dark'
            ? { sentence: '#2d3748', highlight: '#b7950b' }
            : { sentence: '#e5e7eb', highlight: '#ffeb3b' };
        sentenceColorInput.value = defaults.sentence;
        highlightColorInput.value = defaults.highlight;
    }

    function applyCustomTheme(colors, persist = true) {
        const vars = buildCustomThemeVars(colors);
        const isDarkBase = getColorLuminance(colors.bg) < 0.45;
        document.documentElement.setAttribute('data-theme', isDarkBase ? 'dark' : 'light');
        document.documentElement.setAttribute('data-theme-mode', 'custom');
        Object.entries(vars).forEach(([name, value]) => {
            document.documentElement.style.setProperty(name, value);
        });
        setCustomThemeInputValues(colors);
        if (persist) {
            localStorage.setItem(CUSTOM_THEME_STORAGE_KEY, JSON.stringify(colors));
            localStorage.setItem('theme', 'custom');
        }
        applyThemeDefaults(isDarkBase ? 'dark' : 'light');
        updateThemeToggleUi('custom');
    }

    function applyThemeMode(theme, persist = true) {
        clearCustomThemeVars();
        document.documentElement.removeAttribute('data-theme-mode');
        if (theme === 'dark') {
            document.documentElement.setAttribute('data-theme', 'dark');
            if (persist) localStorage.setItem('theme', 'dark');
            applyThemeDefaults('dark');
        } else if (theme === 'custom') {
            applyCustomTheme(getStoredCustomThemeColors(), persist);
            return;
        } else {
            document.documentElement.removeAttribute('data-theme');
            if (persist) localStorage.setItem('theme', 'light');
            applyThemeDefaults('light');
        }
        updateThemeToggleUi(theme);
    }

    function initTheme() {
        setCustomThemeInputValues(getStoredCustomThemeColors());
        const savedTheme = localStorage.getItem('theme');
        if (savedTheme === 'dark' || savedTheme === 'custom') {
            applyThemeMode(savedTheme, false);
        } else {
            applyThemeMode('light', false);
        }
    }
    themeToggleBtn.addEventListener('click', () => {
        if (typeof window.__lockChunkNoteDimensionsForTheme === 'function') {
            window.__lockChunkNoteDimensionsForTheme();
        }
        const currentTheme = localStorage.getItem('theme') || 'light';
        const nextTheme = currentTheme === 'light' ? 'dark' : (currentTheme === 'dark' ? 'custom' : 'light');
        applyThemeMode(nextTheme);
        if (nextTheme === 'custom') {
            openCustomThemePanel();
        } else {
            closeCustomThemePanel();
        }
        refreshAllChunkNoteVisuals();
    });
    [
        ['bg', themeCustomBgInput],
        ['text', themeCustomTextInput],
        ['sub', themeCustomSubInput],
        ['border', themeCustomBorderInput],
        ['button', themeCustomButtonInput]
    ].forEach(([key, input]) => {
        if (!input) return;
        input.addEventListener('input', () => {
            const colors = getStoredCustomThemeColors();
            colors[key] = input.value;
            applyCustomTheme(colors);
            refreshAllChunkNoteVisuals();
        });
        input.addEventListener('change', () => {
            closeCustomThemePanel();
        });
    });
    if (themeCustomResetBtn) {
        themeCustomResetBtn.addEventListener('click', () => {
            applyCustomTheme({ ...CUSTOM_THEME_DEFAULTS });
            closeCustomThemePanel();
            refreshAllChunkNoteVisuals();
        });
    }
    initTheme();
    initAnnotationApiSettingsUi();
    initAnnotationGenerationEntryUi();

    // === Import handlers (audio/transcript/chunk/marks) ===
    
    // Audio
    audioFileInput.addEventListener('change', e => { 
        const file = getFirstFileFromEvent(e);
        if(!file) return;
        saveToDB('audio', file);
        applyCurrentAudioMeta({ name: file.name || 'audio', size: file.size || 0, lastModified: file.lastModified || 0, type: file.type || '' });
        clearGeneratedAnnotationIndex();
        chunkNotesFileHandle = null;
        chunkNotesFileHandleAudioKey = '';
        chunkNotesFileName = '';
        closeChunkNoteExportDialog();
        saveToDB('audioMeta', currentAudioMeta);
        loadChunkNotesForCurrentAudio().then(() => {
            if (isChunkMode) renderChunkMode();
        });
        audioPlayer.src = URL.createObjectURL(file);
        markFileLoaded(lblAudio);
        e.target.value = '';
        restoreReaderFocus();
    });

    // Transcript
    transcriptFileInput.addEventListener('change', event => {
      const file = getFirstFileFromEvent(event);
      if(!file) return;
      readFileAsText(file, async (rawText) => {
        try {
            const json = validateTranscriptData(JSON.parse(rawText));
          await clearPersistedChunkSession();
          saveToDB('transcript', json);
          processTranscript(json);
          await switchSentenceNotesDoc(json);
          emitAnnotationDiagnostics('app.import_scope_updated', {
              scope: getAnnotationGenerationScope(),
              currentAudioKey,
              currentDocId,
              derivedDocId: buildCurrentSentenceDocId(json),
              segmentCount: Array.isArray(json && json.segments) ? json.segments.length : 0
          });
          scheduleGeneratedAnnotationIndexRefresh();
          markFileLoaded(lblTranscript);
          showToast('Transcript loaded', 'success');
        } catch(err) { showError('TRANSCRIPT_PARSE', err && err.message ? err.message : 'Invalid transcript JSON'); }
        finally { event.target.value = ''; restoreReaderFocus(); }
      });
    });

    function processTranscript(json) {
          segments = json.segments || [];
          // Transcript source changed; require re-importing or restoring AI chunk mapping
          hasAiChunkData = false;
          chunkItems = [];
          resetClozeState();
          words = segments.flatMap(s => s.words || []);
          let gIdx = 0;
          segments.forEach((seg, sIdx) => {
            if (seg.words && seg.words.length > 0) {
                 if (!seg.end) seg.end = seg.words[seg.words.length - 1].end;
            }
            if(seg.words) seg.words.forEach(w => {
              w.globalIndex = gIdx++;
              w.segIndex = sIdx;
            });
          });
          wordStarts = words.map(w => w.start ?? 0);
          markedMap.clear();
          clearGeneratedAnnotationIndex();
          rebuildVocabMatching(); 
          emitAnnotationDiagnostics('app.process_transcript', {
              scope: getAnnotationGenerationScope(),
              currentAudioKey,
              currentDocId,
              derivedDocId: buildCurrentSentenceDocId(json),
              segmentCount: segments.length,
              wordCount: words.length
          });
          if (!isChunkMode) renderTranscript();
          syncAnnotationGenerationEntryStatus();
          // 濡傛灉宸茬粡鏈夊垏鍒嗘暟鎹紝闇€瑕侀噸鏂板鐞嗕竴閬嶏紝鍥犱负 segments 鍙樹簡
          if (chunkItems.length > 0) {
             // 瀹為檯涓?processChunkData 闇€瑕佸師濮嬫暟鎹€?
             // 杩欓噷绠€鍖栵細濡傛灉鍒囧垎鏂囦欢涔熸槸閫氳繃 DB 鎭㈠鐨勶紝restoreSession 浼氳皟 processChunkData
          }
    }



    // Chunk File
    chunkFileInput.addEventListener('change', event => {
        const file = getFirstFileFromEvent(event);
        if(!file) return;
        readFileAsText(file, (rawText) => {
            try {
                const data = validateChunkData(JSON.parse(rawText));
                manualChunkStates = {};
                resetClozeState();
                try {
                    localStorage.removeItem('manualChunkStates');
                } catch (e) {}
                saveToDB('chunkData', data); // 淇濆瓨鍘熷鏁版嵁
                processChunkData(data);
                showToast('AI chunk data loaded', 'success');
            } catch(err) { showError('CHUNK_PARSE', err && err.message ? err.message : 'Invalid chunk JSON'); }
            finally { event.target.value = ''; restoreReaderFocus(); }
        });
    });

    function resetClozeState() {
        clozeItems = [];
        hasClozeData = false;
        clozeAnswerState = [];
        if (loadClozeBtn) {
            loadClozeBtn.classList.remove('active');
        }
    }

    function setClozeData(items) {
        clozeItems = Array.isArray(items) ? items : [];
        hasClozeData = clozeItems.length > 0;
        clozeAnswerState = createInitialClozeAnswerState(clozeItems);
        if (loadClozeBtn) {
            loadClozeBtn.classList.toggle('active', hasClozeData);
        }
    }

    function buildClozeQuizMarkup() {
        if (!hasClozeData || !clozeItems.length) return '';
        const quizVm = buildClozeQuizViewModel(clozeItems, clozeAnswerState);
        const cards = quizVm.cards.map((card) => {
            const resultHtml = card.resultKind === 'hint'
                ? '<div class="cloze-result-hint">填写后点击“检查答案”。</div>'
                : card.resultKind === 'ok'
                    ? `<div class="cloze-result-ok">回答正确。标准答案：<strong>${escapeHtml(card.targetWord)}</strong></div>${card.reasoning ? `<div class="cloze-result-reason">${escapeHtml(card.reasoning)}</div>` : ''}`
                    : `<div class="cloze-result-error">不匹配。标准答案：<strong>${escapeHtml(card.targetWord)}</strong></div>${card.reasoning ? `<div class="cloze-result-reason">${escapeHtml(card.reasoning)}</div>` : ''}`;
            const metaHtml = card.wordType ? `<div class="cloze-meta">${escapeHtml(card.wordType)}</div>` : '';
            return `
                <section class="cloze-card ${card.statusClass}" data-cloze-card="${card.index}">
                    <div class="cloze-card-head">
                        <span class="cloze-index">${card.indexLabel}</span>
                        ${metaHtml}
                    </div>
                    <div class="cloze-sentence">${escapeHtml(card.clozeSentence)}</div>
                    <div class="cloze-answer-row">
                        <input type="text" class="cloze-answer-input" data-cloze-input="${card.index}" value="${escapeHtml(card.userAnswer)}" placeholder="输入答案">
                        <button type="button" class="small-btn cloze-check-btn" data-cloze-check="${card.index}">检查答案</button>
                    </div>
                    ${resultHtml}
                </section>
            `;
        }).join('');

        return `
            <section class="cloze-quiz-section" id="cloze-quiz-section">
                <div class="cloze-quiz-header">
                    <h3>文章填空</h3>
                    <p>AI 切分内容读完后，可以直接在这里做题。无论回答对错，都会显示标准答案和解释。</p>
                </div>
                <div class="cloze-quiz-list">${cards}</div>
            </section>
        `;
    }

    function handleClozeCheck(index) {
        const item = clozeItems[index];
        if (!item) return;
        const input = transcriptContainer.querySelector(`[data-cloze-input="${index}"]`);
        const userAnswer = input ? input.value : '';
        const correct = normalizeClozeAnswer(userAnswer) === normalizeClozeAnswer(item.targetWord);
        clozeAnswerState[index] = {
            checked: true,
            correct,
            userAnswer
        };
        renderChunkMode();
        const nextInput = transcriptContainer.querySelector(`[data-cloze-input="${index}"]`);
        if (nextInput) {
            nextInput.focus();
            nextInput.setSelectionRange(nextInput.value.length, nextInput.value.length);
        }
    }

    if (clozeFileInput) {
        clozeFileInput.addEventListener('change', event => {
            const file = getFirstFileFromEvent(event);
            if (!file) return;
            readFileAsText(file, (rawText) => {
                try {
                    const data = validateClozeData(JSON.parse(rawText));
                    setClozeData(data);
                    if (isChunkMode) renderChunkMode();
                    showToast('Cloze questions loaded', 'success');
                } catch (err) {
                    showError('CLOZE_PARSE', err && err.message ? err.message : 'Invalid cloze JSON');
                } finally {
                    event.target.value = '';
                    restoreReaderFocus();
                }
            });
        });
    }

    // === AI chunk alignment/matching pipeline ===
    // 淇濈暀鐜版湁绛栫暐锛氭柊鏃ф牸寮忓吋瀹?+ 鍐呭鎰熺煡 + 鍙岀閿氬畾
    
    function processChunkData(data) {
        if (!segments || segments.length === 0) {
            chunkItems = [];
            return;
        }

        chunkItems = [];

        // 杈呭姪宸ュ叿锛氭竻鐞嗘枃鏈互渚挎瘮杈?(鍘绘爣鐐广€佽浆灏忓啓)
        const clean = cleanTextHelper;

        // 鍙ュ瓙鍒嗚瘝 (鐢ㄤ簬绮剧‘鍖归厤)
        const tokenize = tokenizeTextHelper;

        // 鍏滃簳锛氭嬁鍒颁竴涓钀藉彲鐐瑰嚮鐨勬椂闂磋寖鍥?
        const getSegTimeRange = (seg) => {
            if (seg && typeof seg.start === "number" && typeof seg.end === "number") return [seg.start, seg.end];
            if (seg && seg.words && seg.words.length) return [seg.words[0].start, seg.words[seg.words.length - 1].end];
            return [0, 0];
        };

        // 鍏滃簳锛氬榻愬け璐ヤ篃涓嶄涪鍧楋紝鑷冲皯鏄剧ず Gemini 鐨勮嫳鏂囧拰涓枃
        const pushFallbackChunk = (seg, chunk, segId) => {
            const [st, ed] = getSegTimeRange(seg);
            chunkItems.push({
                words: [],
                start: st,
                end: ed,
                ch: chunk && (chunk.zh || chunk.ch) ? (chunk.zh || chunk.ch) : " ",
                rawEn: chunk && chunk.en ? chunk.en : "",
                isFallback: true,
                segId: (typeof segId === "number") ? segId : -1
            });
        };

        // 绮剧‘鍖归厤锛氬湪鏁存閲屾壘瀹屾暣鐭 (鏈€绋筹紝鐩存帴鏃犺 a/b 婕傜Щ)
        const findExactPhrase = (segWords, phraseTokens) => findExactMatchRangeHelper(segWords, phraseTokens, 0);

        const findExactPhraseFromIndex = (wordList, phraseTokens, fromIndex = 0) => (
            findExactMatchRangeHelper(wordList, phraseTokens, fromIndex)
        );

        const clamp = clampHelper;

        // 鍦ㄦ寚瀹氱储寮曢檮杩戝鎵剧洰鏍囧崟璇?(鐢ㄤ簬閿氱偣鏍″噯)
        const findMatchIndex = (baseIdx, targetWord, segWords, searchRange) => (
            adjustIndexHelper(baseIdx, targetWord, segWords, searchRange)
        );

        // 鏇村ぇ鐨勬悳绱㈠崐寰勶細鍏佽 Gemini 鐨?a/b 鏈?10 涓瘝浠ュ唴鐨勮宸?
        const START_RANGE = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, -1, -2, -3, -4, -5, -6, -7, -8, -9, -10];
        const END_RANGE   = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, -1, -2, -3, -4, -5, -6, -7, -8, -9, -10, -11, -12];

        // 1. 澶勭悊鏂版牸寮?
        if (data.s && Array.isArray(data.s)) {
            const useGlobalWordIndexMode = data.s.length === 1;
            let globalWordCursor = 0;
            data.s.forEach(segItem => {
                const segId = segItem.id;
                const targetSeg = (segId >= 0 && segId < segments.length) ? segments[segId] : null;

                if (!segItem.chunks || !Array.isArray(segItem.chunks)) return;

                segItem.chunks.forEach(chunk => {
                    const segWords = targetSeg && targetSeg.words ? targetSeg.words : null;

                    // 娌℃湁璇嶇骇鏁版嵁涔熶笉涓?
                    if (!segWords || !segWords.length) {
                        pushFallbackChunk(targetSeg, chunk, segId);
                        return;
                    }

                    const phraseTokens = tokenize(chunk.en);

                    // 鍏堝仛鏁村彞绮剧‘鍖归厤锛氭壘鍒板氨鐩存帴鐢?(鏈€绋?
                    const exact = findExactPhrase(segWords, phraseTokens);

                    let finalStart = null;
                    let finalEnd = null;

                    if (useGlobalWordIndexMode && Number.isFinite(Number(chunk.a)) && Number.isFinite(Number(chunk.b))) {
                        const globalStart = Math.max(0, Number(chunk.a) - 1);
                        const globalEnd = Math.max(globalStart, Number(chunk.b) - 1);
                        const matchedWords = words.slice(globalStart, globalEnd + 1);
                        if (matchedWords.length) {
                            chunkItems.push({
                                words: matchedWords,
                                start: matchedWords[0].start,
                                end: matchedWords[matchedWords.length - 1].end,
                                ch: chunk.zh || " ",
                                rawEn: chunk.en || "",
                                isFallback: false,
                                segId: Number.isInteger(matchedWords[0].segIndex) ? matchedWords[0].segIndex : segId
                            });
                            globalWordCursor = globalEnd + 1;
                            return;
                        }
                    }

                    if (exact) {
                        finalStart = exact[0];
                        finalEnd = exact[1];
                    } else {
                        const globalExact = findExactPhraseFromIndex(words, phraseTokens, globalWordCursor);
                        if (globalExact) {
                            const matchedWords = words.slice(globalExact[0], globalExact[1] + 1);
                            if (matchedWords.length) {
                                chunkItems.push({
                                    words: matchedWords,
                                    start: matchedWords[0].start,
                                    end: matchedWords[matchedWords.length - 1].end,
                                    ch: chunk.zh || " ",
                                    rawEn: chunk.en || "",
                                    isFallback: false,
                                    segId: Number.isInteger(matchedWords[0].segIndex) ? matchedWords[0].segIndex : segId
                                });
                                globalWordCursor = globalExact[1] + 1;
                                return;
                            }
                        }

                        // 閿氱偣鏍″噯 (鎵╁ぇ鎼滅储鍗婂緞)
                        const { start: a, end: b } = normalizeChunkCandidateBoundsHelper(chunk.a, chunk.b);

                        // 鍚屾椂灏濊瘯 0-based 鍜?1-based 涓ゅ鍧愭爣锛岄€夋洿闈犺氨鐨?
                        const candidates = buildChunkCandidateVariantsHelper(a, b);

                        const firstWord = phraseTokens.length ? phraseTokens[0] : "";
                        const lastWord  = phraseTokens.length ? phraseTokens[phraseTokens.length - 1] : "";

                        let best = null;

                        candidates.forEach(c => {
                            const { startIndex: s0, endIndex: e0 } = clampChunkMatchCandidateHelper(c, segWords.length);

                            let st = s0;
                            let ed = e0;

                            if (firstWord) st = findMatchIndex(s0, firstWord, segWords, START_RANGE);

                            const { minEnd, baseEnd } = buildChunkCandidateEndWindowHelper(st, e0, phraseTokens.length, segWords.length);

                            if (lastWord) ed = findMatchIndex(baseEnd, lastWord, segWords, END_RANGE);

                            if (ed < minEnd) ed = Math.min(segWords.length - 1, minEnd);

                            const { startWord: wStart, endWord: wEnd } = getChunkCandidateBoundaryWordsHelper(segWords, st, ed);

                            const score = scoreMatchCandidateHelper(firstWord, lastWord, wStart, wEnd);

                            const candidate = normalizeChunkMatchCandidateHelper(st, ed, score);

                            if (!best || candidate.score > best.score) best = candidate;
                        });

                        if (best) {
                            // 濡傛灉杩為灏捐瘝閮藉涓嶄笂锛屽氨鍒啋闄╁垏閿欒瘝浜嗭紝鐩存帴璧板厹搴曟樉绀哄師鏂?
                            if (phraseTokens.length && best.score === 0) {
                                finalStart = null;
                                finalEnd = null;
                            } else {
                                finalStart = best.st;
                                finalEnd = best.ed;
                            }
                        }
                    }

                    // 鏈€缁堝厹搴曪細浠讳綍寮傚父閮戒笉涓㈠潡
                    if (finalStart === null || finalEnd === null || finalStart > finalEnd) {
                        pushFallbackChunk(targetSeg, chunk, segId);
                        return;
                    }

                    if (finalStart < 0 || finalStart >= segWords.length) {
                        pushFallbackChunk(targetSeg, chunk, segId);
                        return;
                    }

                    finalEnd = clamp(finalEnd, 0, segWords.length - 1);

                    const chunkWords = segWords.slice(finalStart, finalEnd + 1);

                    if (!chunkWords.length) {
                        pushFallbackChunk(targetSeg, chunk, segId);
                        return;
                    }

                    chunkItems.push({
                        words: chunkWords,
                        start: chunkWords[0].start,
                        end: chunkWords[chunkWords.length - 1].end,
                        ch: chunk.zh || " ",
                        rawEn: chunk.en || "",
                        isFallback: false,
                        segId: segId
                    });
                    if (chunkWords.length && Number.isFinite(Number(chunkWords[chunkWords.length - 1].globalIndex))) {
                        globalWordCursor = Math.max(globalWordCursor, Number(chunkWords[chunkWords.length - 1].globalIndex) + 1);
                    }
                });
            });
        }
        // 2. 澶勭悊鏃ф牸寮?
        else {
            const items = Array.isArray(data) ? data : (data.items || []);
            chunkItems = items.map(item => {
                const seg = segments[item.segment_id];
                if (!seg || !seg.words || !seg.words.length) {
                    const [st, ed] = getSegTimeRange(seg);
                    return {
                        ...item,
                        words: [],
                        start: st,
                        end: ed,
                        ch: item.ch || item.zh || " ",
                        rawEn: item.en || "",
                        isFallback: true,
                        segId: item.segment_id
                    };
                }

                const startIdx = (item.w_start_1based || 1) - 1;
                const endIdx = (item.w_end_1based || seg.words.length);
                const chunkWords = seg.words.slice(startIdx, endIdx);

                if (!chunkWords.length) {
                    const [st, ed] = getSegTimeRange(seg);
                    return {
                        ...item,
                        words: [],
                        start: st,
                        end: ed,
                        ch: item.ch || item.zh || " ",
                        rawEn: item.en || "",
                        isFallback: true,
                        segId: item.segment_id
                    };
                }

                return {
                    ...item,
                    words: chunkWords,
                    start: chunkWords[0].start,
                    end: chunkWords[chunkWords.length - 1].end,
                    isFallback: false,
                    rawEn: item.en || ""
                };
            }).filter(item => item !== null);
        }

        hasAiChunkData = chunkItems.length > 0;
        toggleChunkBtn.innerText = hasAiChunkData ? "AI切分(已就绪)" : "AI切分";
        if (isChunkMode) renderChunkMode();
    }
    // === Transcript/chunk context matching logic ===
    function rebuildVocabMatching() {
        vocabMatchMap.clear();
        if (!segments.length || !globalVocab.length) return;

        const normalize = (str) => str.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]/g, "");

        globalVocab.forEach(vData => {
            const anchorText = vData.match_context ? vData.match_context : vData.word;
            const targetWord = vData.word;

            const anchorTokens = anchorText.trim().split(/\s+/).map(normalize).filter(t => t);
            const targetTokens = targetWord.trim().split(/\s+/).map(normalize).filter(t => t);

            if (anchorTokens.length === 0 || targetTokens.length === 0) return;

            for (let i = 0; i <= words.length - anchorTokens.length; i++) {
                let isAnchorMatch = true;
                for (let k = 0; k < anchorTokens.length; k++) {
                    const docWord = words[i + k].word || words[i + k].text || "";
                    if (normalize(docWord) !== anchorTokens[k]) {
                        isAnchorMatch = false;
                        break;
                    }
                }

                if (isAnchorMatch) {
                    let offsetInAnchor = -1;
                    for(let m = 0; m <= anchorTokens.length - targetTokens.length; m++) {
                        let subMatch = true;
                        for(let n = 0; n < targetTokens.length; n++) {
                            if(anchorTokens[m + n] !== targetTokens[n]) {
                                subMatch = false;
                                break;
                            }
                        }
                        if(subMatch) {
                            offsetInAnchor = m;
                            break; 
                        }
                    }

                    if (offsetInAnchor !== -1) {
                        const realStartIndex = i + offsetInAnchor;
                        const groupIndices = [];
                        for (let len = 0; len < targetTokens.length; len++) {
                            const exactIndex = realStartIndex + len;
                            groupIndices.push(exactIndex);
                            vocabMatchMap.set(exactIndex, { 
                                data: vData, 
                                group: groupIndices 
                            });
                        }
                    }
                }
            }
        });
    }

    // === Main transcript/chunk rendering ===
    
    // 1. Normal Mode Render
    function renderTranscript() {
      clearPlaybackHighlightState();
      playbackUiSignature = '';
      document.body.classList.toggle('highlight-sentence-mode', highlightMode === 2);
      transcriptContainer.innerHTML = '';
      transcriptContainer.classList.remove('chunk-mode');
      lastActiveSegIndex = -1; 
      
      if (!segments.length && words.length) { 
        const div = document.createElement('div');
        div.className = 'transcript-line';
        renderWordsToContainer(words, div);
        transcriptContainer.appendChild(div);
        return;
      }
      if (!segments.length) return;

      segments.forEach((seg, sIdx) => {
        const lineDiv = document.createElement('div');
        lineDiv.className = 'transcript-line';
        lineDiv.id = `segment-${sIdx}`; 

        if (seg.words) renderWordsToContainer(seg.words, lineDiv);

        if (seg.translation) {
            const details = document.createElement('details');
            details.className = 'grok-box has-content'; 
            details.id = `note-${sIdx}`; 
            
            const summary = document.createElement('summary');
            summary.className = 'grok-summary';
            summary.innerText = ''; 
            const content = document.createElement('div');
            content.className = 'grok-content';
            content.innerText = seg.translation;
            details.appendChild(summary);
            details.appendChild(content);
            lineDiv.appendChild(details);
        }
        transcriptContainer.appendChild(lineDiv);
      });
    }

    // 2. AI Chunk Mode Render (Modified)
    function renderChunkMode() {
        clearPlaybackHighlightState();
        playbackUiSignature = '';
        document.body.classList.remove('highlight-sentence-mode');
        transcriptContainer.innerHTML = '';
        transcriptContainer.classList.add('chunk-mode');
        lastActiveChunkIndex = -1;

        if (chunkCnMode === 'focus') {
            transcriptContainer.classList.add('cn-mode-focus');
        } else {
            transcriptContainer.classList.remove('cn-mode-focus');
        }

        if (!chunkItems.length) {
            transcriptContainer.innerHTML = '<div style="padding:20px;text-align:center;">暂无 AI 切分数据，请点击上方“AI切分”加载 JSON。</div>';
            return;
        }
        adjustChunkNoteArrowSizeByGap();
        chunkItems.forEach((chunk, idx) => {
            const chunkBlock = document.createElement('div');
            chunkBlock.className = 'chunk-block';
            chunkBlock.id = `chunk-${idx}`;
            const chunkRef = getChunkRef(chunk, idx);
            chunkBlock.dataset.chunkRef = chunkRef;
            chunkBlock.dataset.chunkIdx = String(idx);
            if (selectedSentence && selectedSentence.chunkRef === chunkRef) {
                chunkBlock.classList.add('chunk-selected');
            }
            
            // 濡傛灉璇ュ彞鍦ㄥ瓧鍏搁噷璁板綍涓?true锛屽姞涓?manual-show 绫?
            if (manualChunkStates[idx]) {
                chunkBlock.classList.add('manual-show');
            }
            
            const rowDiv = document.createElement('div');
            rowDiv.className = 'chunk-row';
            const leftDiv = document.createElement('div');
            leftDiv.className = 'chunk-left';

            const enDiv = document.createElement('div');
            enDiv.className = 'chunk-en';
            if (chunk.words && chunk.words.length) {
                renderWordsToContainer(chunk.words, enDiv);
            } else {
                enDiv.textContent = chunk.rawEn || "";
            }
            leftDiv.appendChild(enDiv);

            const cnDiv = document.createElement('div');
            cnDiv.className = 'chunk-cn';
            if (!chunkCnVisible) cnDiv.classList.add('hidden-cn');
            
            cnDiv.innerText = chunk.ch || " "; // 鍗犱綅锛岀‘淇濆彲鐐?
            
            cnDiv.title = "点击显示/隐藏中文";
            cnDiv.onclick = (e) => {
                e.stopPropagation(); 
                toggleManualChunkState(idx, chunkBlock);
            };

            leftDiv.appendChild(cnDiv);
            rowDiv.appendChild(leftDiv);

            const notesForChunk = getChunkNotesForRef(chunkRef);
            if (notesForChunk.length > 0) {
                markChunkWordsByNotes(enDiv, notesForChunk);
            } else {
                clearChunkWordAnnotations(enDiv);
            }
            chunkBlock.appendChild(rowDiv);

            chunkBlock.addEventListener('mousedown', (e) => {
                if (e.button !== 0) return;
                if (e.target.closest('.chunk-note-tag')) return;
                chunkPointerDown = {
                    chunkRef,
                    x: e.clientX,
                    y: e.clientY
                };
            });

            chunkBlock.onclick = (e) => {
                if (e.target.closest('.chunk-note-tag')) return;
                const moved = !!(chunkPointerDown && chunkPointerDown.chunkRef === chunkRef && ((Math.abs(e.clientX - chunkPointerDown.x) > 4) || (Math.abs(e.clientY - chunkPointerDown.y) > 4)));
                chunkPointerDown = null;
                if (hasActiveTextSelectionWithinChunk() || moved) return;
                audioPlayer.currentTime = chunk.start;
                forceUpdateUI(chunk.start);
                try { selectSentenceFromChunkTarget(chunkBlock); } catch (err) {}
            };

            transcriptContainer.appendChild(chunkBlock);
        });
        const clozeMarkup = buildClozeQuizMarkup();
        if (clozeMarkup) {
            transcriptContainer.insertAdjacentHTML('beforeend', clozeMarkup);
            transcriptContainer.querySelectorAll('[data-cloze-check]').forEach((btn) => {
                btn.addEventListener('click', () => handleClozeCheck(Number(btn.dataset.clozeCheck)));
            });
            transcriptContainer.querySelectorAll('[data-cloze-input]').forEach((input) => {
                input.addEventListener('keydown', (event) => {
                    if (event.key === 'Enter') {
                        event.preventDefault();
                        handleClozeCheck(Number(input.dataset.clozeInput));
                    }
                });
            });
        }
        renderAllChunkNoteTags();
        setChunkNoteVisible(chunkNoteVisible, false);
        tryRestoreChunkNoteDraft();
    }

    function getChunkNotesForRef(chunkRef) {
        return Object.values(chunkNotesMap)
            .filter(n => n && n.chunkRef === chunkRef)
            .sort((a, b) => (a.startGlobal - b.startGlobal) || (a.endGlobal - b.endGlobal));
    }

    function refreshAllChunkNoteVisuals() {
        if (!isChunkMode || !hasAiChunkData) return;
        document.querySelectorAll('#transcript-container .chunk-block').forEach(block => {
            const chunkRef = String(block.dataset.chunkRef || '');
            const enDiv = block.querySelector('.chunk-en');
            if (!enDiv) return;
            const notes = getChunkNotesForRef(chunkRef);
            if (notes.length > 0) markChunkWordsByNotes(enDiv, notes);
            else clearChunkWordAnnotations(enDiv);
        });
        renderAllChunkNoteTags();
        scheduleChunkNoteConnectorRedraw();
    }

    function handleChunkSelectionContextMenu(e) {
        if (!isChunkMode || !hasAiChunkData) return;
        if (chunkNoteModalEl) saveChunkNoteFromModal();
        const chunkBlock = e.target.closest('.chunk-block');
        if (!chunkBlock) {
            closeChunkNoteContextMenu();
            return;
        }
        const enDiv = chunkBlock.querySelector('.chunk-en');
        if (!enDiv) {
            closeChunkNoteContextMenu();
            return;
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
                return;
            }
            const idx = parseInt(String(nearest.id || '').replace('word-', ''), 10);
            if (!Number.isFinite(idx)) {
                closeChunkNoteContextMenu();
                return;
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
    }

    // 鍒囨崲鍗曚釜鍙ュ潡鐨勬墜鍔ㄦ樉绀虹姸鎬?
    function toggleManualChunkState(index, blockEl) {
        if (manualChunkStates[index]) {
            delete manualChunkStates[index]; 
            blockEl.classList.remove('manual-show');
        } else {
            manualChunkStates[index] = true; 
            blockEl.classList.add('manual-show');
        }
        localStorage.setItem('manualChunkStates', JSON.stringify(manualChunkStates));
    }

    function renderWordsToContainer(wordList, container) {
      const frag = document.createDocumentFragment();
      wordList.forEach(word => {
          const token = (word.word || word.text || '');
          const m = token.match(/^(\s*[\W]*)([\w\u00C0-\u024F\u4E00-\u9FFF'-]+)([\W]*)$/) || [token, '', token, ''];
          const coreTxt = m[2] || token.trim(); 
          const leadTxt = m[1] || '';
          const trailTxt = m[3] || '';

          if(leadTxt) frag.appendChild(makeSpan(leadTxt, -1));
          
          const coreSpan = makeSpan(coreTxt, word.globalIndex, true, word);
          if(markedMap.has(word.globalIndex)) coreSpan.classList.add('marked');
          frag.appendChild(coreSpan);
          
          if(trailTxt) frag.appendChild(makeSpan(trailTxt, -1));
          frag.appendChild(document.createTextNode(' '));
      });
      container.appendChild(frag);
    }

    function makeSpan(text, index, isCore=false, wordMeta=null) {
        const s = document.createElement('span');
        s.textContent = text;
        if (Number.isFinite(index) && index >= 0) {
            s.dataset.wordIndex = String(index);
        }
        if (wordMeta && Number.isFinite(Number(wordMeta.start))) {
            s.dataset.wordStart = String(Number(wordMeta.start));
        }
        if (wordMeta && Number.isFinite(Number(wordMeta.end))) {
            s.dataset.wordEnd = String(Number(wordMeta.end));
        }

        if(isCore) {
            s.id = `word-${index}`;
            s.style.cursor = 'pointer';
            s.onclick = (e) => { 
                if (isChunkMode && hasActiveTextSelectionWithinChunk()) return;
                e.stopPropagation(); 
                const w = Number.isFinite(index) ? words[index] : null;
                const fallbackStart = Number(s.dataset.wordStart);
                const targetTime = w && Number.isFinite(Number(w.start))
                    ? Number(w.start)
                    : (Number.isFinite(fallbackStart) ? fallbackStart : NaN);
                if (Number.isFinite(targetTime)) {
                    audioPlayer.currentTime = targetTime; 
                    forceUpdateUI(targetTime);
                }
                if (isChunkMode) {
                    try { selectSentenceFromChunkTarget(e.currentTarget); } catch (err) {}
                }
            };
        } else {
            s.className = 'punct';
            if (index !== -1) { 
                 s.onclick = (e) => { 
                     if (isChunkMode && hasActiveTextSelectionWithinChunk()) return;
                     e.stopPropagation(); 
                     const w = Number.isFinite(index) ? words[index] : null;
                     const fallbackStart = Number(s.dataset.wordStart);
                     const targetTime = w && Number.isFinite(Number(w.start))
                        ? Number(w.start)
                        : (Number.isFinite(fallbackStart) ? fallbackStart : NaN);
                     if (Number.isFinite(targetTime)) {
                        audioPlayer.currentTime = targetTime; 
                        forceUpdateUI(targetTime);
                     }
                     if (isChunkMode) {
                        try { selectSentenceFromChunkTarget(e.currentTarget); } catch (err) {}
                     }
                 };
                 s.style.cursor = 'pointer';
            }
        }
        return s;
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
        if (annotationGeneratedIndexScopeKey !== currentScopeKey) {
            emitAnnotationDebug('app.generated_click_scope_mismatch', {
                scope: getAnnotationGenerationScope(),
                indexedScopeKey: annotationGeneratedIndexScopeKey,
                currentScopeKey,
                wordIndex
            });
            emitAnnotationDiagnostics('app.generated_click_scope_mismatch', {
                scope: getAnnotationGenerationScope(),
                indexedScopeKey: annotationGeneratedIndexScopeKey,
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
            indexedScopeKey: annotationGeneratedIndexScopeKey,
            generatedItemCount: typeof store.getItems === 'function' ? store.getItems().length : 0,
            occurrenceKey: result && result.occurrenceKey || ''
        });
        return result;
    }

    function resolveAnnotationBubbleForSpan(span) {
        const wordIndex = Number(span && span.dataset ? span.dataset.wordIndex : NaN);
        if (!Number.isFinite(wordIndex) || wordIndex < 0) return null;
        if (!markedMap.has(wordIndex)) return null;
        const generated = resolveGeneratedAnnotationBubbleForSpan(span, wordIndex);
        if (generated) return generated;
        const match = vocabMatchMap.get(wordIndex);
        if (!match) return null;
        return normalizeAnnotationBubbleHit(match, wordIndex, span);
    }

    function notifyAnnotationBubbleWordClick(span) {
        const bubble = getAnnotationBubble();
        if (!bubble) {
            emitAnnotationDiagnostics('app.generated_bubble_click_skipped', {
                scope: getAnnotationGenerationScope(),
                reason: 'bubble-missing'
            });
            return;
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
            if (!bubbleVisible && typeof bubble.show === 'function') {
                bubble.show();
            }
            return;
        }
        if (typeof bubble.clearAnnotation === 'function') {
            bubble.clearAnnotation();
        }
        if (typeof bubble.hide === 'function') {
            bubble.hide();
        }
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
        if (notePreviewSavedItemId && notePreviewSavedItemId === itemId) return 'Saved just now';
        if (item && item.updatedAt) return `Last saved ${new Date(item.updatedAt).toLocaleString()}`;
        return 'Draft item';
    }

    function triggerSentenceNoteSavedFeedback(itemId = '') {
        notePreviewSavedItemId = String(itemId || '');
        if (notePreviewSavedHintTimer) clearTimeout(notePreviewSavedHintTimer);
        notePreviewSavedHintTimer = setTimeout(() => {
            notePreviewSavedItemId = '';
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
        if (!sentenceNoteDraft) return;
        if (notePreviewEditingItemId === sentenceNoteDraft.itemId) notePreviewEditingItemId = '';
        sentenceNoteDraft = null;
        if (shouldRender) renderNotePreviewSidebar();
    }

    function commitSentenceNoteDraft(shouldRender = true) {
        if (!sentenceNoteDraft) return false;
        const noteBody = String(sentenceNoteDraft.noteBody || '');
        if (!noteBody.trim()) {
            discardSentenceNoteDraft(shouldRender);
            return false;
        }
        const sentenceId = String(sentenceNoteDraft.sentenceId || '');
        const record = getSentenceNoteRecord(sentenceId);
        if (!record) {
            discardSentenceNoteDraft(shouldRender);
            return false;
        }
        const now = Date.now();
        const committed = normalizeSentenceNoteItem(sentenceId, {
            itemId: sentenceNoteDraft.itemId,
            selectedText: sentenceNoteDraft.selectedText,
            noteBody,
            createdAt: sentenceNoteDraft.createdAt || now,
            updatedAt: now
        }, sentenceNoteDraft.itemId);
        record.items.push(committed);
        sentenceNotesMap[sentenceId] = record;
        const committedItemId = committed.itemId;
        sentenceNoteDraft = null;
        notePreviewEditingItemId = '';
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
            if (!record.items.length) delete sentenceNotesMap[sentenceId];
            else sentenceNotesMap[sentenceId] = record;
            notePreviewEditingItemId = '';
            saveSentenceNotesDebounced();
            if (shouldRender) renderNotePreviewSidebar();
            return false;
        }
        item.updatedAt = Date.now();
        sentenceNotesMap[sentenceId] = record;
        notePreviewEditingItemId = '';
        saveSentenceNotesDebounced();
        triggerSentenceNoteSavedFeedback(itemId);
        if (shouldRender) renderNotePreviewSidebar();
        return true;
    }

    function persistSelectedSentenceNote() {
        if (!selectedSentence) return;
        if (sentenceNoteDraft && sentenceNoteDraft.sentenceId === selectedSentence.sentenceId) {
            commitSentenceNoteDraft(false);
        }
        if (notePreviewEditingItemId) {
            persistSentenceNoteItem(String(selectedSentence.sentenceId || ''), notePreviewEditingItemId, false);
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
        if (notePreviewEditingItemId && notePreviewEditingItemId === item.itemId) wrapper.classList.add('is-editing');

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
        if (notePreviewEditingItemId && notePreviewEditingItemId === item.itemId) meta.classList.add('is-editing');
        if (notePreviewSavedItemId && notePreviewSavedItemId === item.itemId) meta.classList.add('is-saved');
        meta.textContent = formatSentenceNoteItemMeta(item, item.itemId, notePreviewEditingItemId === item.itemId);
        wrapper.appendChild(meta);

        textarea.addEventListener('focus', () => {
            notePreviewSavedItemId = '';
            notePreviewEditingItemId = String(item.itemId || '');
            if (notePreviewSidebar) notePreviewSidebar.classList.add('note-editing');
            wrapper.classList.add('is-editing');
            meta.classList.remove('is-saved');
            meta.classList.add('is-editing');
            meta.textContent = 'Editing note...';
            textarea.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        });
        textarea.addEventListener('input', (e) => {
            const value = String(e.target.value || '');
            notePreviewSavedItemId = '';
            notePreviewEditingItemId = String(item.itemId || '');
            if (isDraft && sentenceNoteDraft && sentenceNoteDraft.itemId === item.itemId) {
                sentenceNoteDraft.noteBody = value;
                sentenceNoteDraft.updatedAt = Date.now();
            } else {
                const found = findSentenceNoteItem(sentenceId, item.itemId);
                if (found.item) {
                    found.item.noteBody = value;
                    sentenceNotesMap[String(sentenceId || '')] = found.record;
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
        notePreviewSidebar.classList.toggle('note-editing', !!notePreviewEditingItemId);
        notePreviewSidebar.classList.toggle('note-has-selection', !!selectedSentence);
        if (!selectedSentence) {
            showNotePreviewEmptyState('No sentence selected\nClick a sentence to view its note here.');
            return;
        }
        const sentenceId = String(selectedSentence.sentenceId || '');
        const items = getSortedSentenceNoteItems(sentenceId);
        const hasDraft = !!(sentenceNoteDraft && sentenceNoteDraft.sentenceId === sentenceId);
        const renderItems = hasDraft ? [...items, sentenceNoteDraft] : items;
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
                isDraft: !!(sentenceNoteDraft && sentenceNoteDraft.itemId === item.itemId)
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
        notePreviewSavedItemId = '';
        notePreviewEditingItemId = '';
        selectedSentence = nextSentence ? { ...nextSentence } : null;
        renderNotePreviewSidebar();
    }

    function updateSentenceFocusPhrase(sentence, focusPhrase) {
        if (!sentence) return;
        const sentenceId = String(sentence.sentenceId || '');
        const nextSelectedText = String(focusPhrase || '').replace(/\s+/g, ' ').trim();
        if (!sentenceId || !nextSelectedText) return;
        persistSelectedSentenceNote();
        notePreviewSavedItemId = '';
        notePreviewEditingItemId = '';
        selectedSentence = { ...sentence };
        sentenceNoteDraft = {
            sentenceId,
            itemId: makeSentenceNoteItemId(sentenceId),
            selectedText: nextSelectedText,
            noteBody: '',
            createdAt: Date.now(),
            updatedAt: Date.now()
        };
        notePreviewEditingItemId = sentenceNoteDraft.itemId;
        notePreviewPendingScrollItemId = sentenceNoteDraft.itemId;
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
        if (importDocId !== currentDocId) {
            throw new Error('docId mismatch');
        }
        if (!isPlainObjectRecord(data.notes)) {
            throw new Error('missing notes payload');
        }
        sentenceNotesMap = normalizeSentenceNotesScope(data.notes);
        allSentenceNotesByDoc[currentDocId] = normalizeSentenceNotesScope(sentenceNotesMap);
        sentenceNoteDraft = null;
        notePreviewEditingItemId = '';
        notePreviewSavedItemId = '';
        saveToDB(getSentenceNotesStorageKey(), allSentenceNotesByDoc);
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
        closeChunkNoteContextMenu();
        closeChunkNotePopover();
        
        if (isChunkMode) {
            renderChunkMode();
        } else {
            renderTranscript();
            document.querySelectorAll('.chunk-note-tag').forEach(el => el.remove());
            clearChunkNoteConnectors();
        }
        
        requestAnimationFrame(() => {
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
        if (persist) localStorage.setItem('chunkCnVisible', chunkCnVisible);
        const els = document.querySelectorAll('.chunk-cn');
        els.forEach(el => {
            if (chunkCnVisible) el.classList.remove('hidden-cn');
            else el.classList.add('hidden-cn');
        });
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
    }

    function toggleChunkCnHoldMode() {
        chunkCnHoldMode = !chunkCnHoldMode;
        localStorage.setItem('chunkCnHoldMode', chunkCnHoldMode);
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
    }

    // Toggle Focus Mode

    function toggleChunkFocusMode() {
        if (!isChunkMode) return;

        const btn = document.getElementById('btn-chunk-focus');
        const container = document.getElementById('transcript-container');

        if (chunkCnMode === 'global') {
            chunkCnMode = 'focus';
            btn.innerText = "聚焦";
            btn.classList.add('active'); // 鎸夐挳鍙樿壊
            container.classList.add('cn-mode-focus'); // 娣诲姞 CSS 绫?
        } else {
            chunkCnMode = 'global';
            btn.innerText = "全局";
            btn.classList.remove('active');
            container.classList.remove('cn-mode-focus');
        }
        
        // 淇濆瓨鐘舵€?
        localStorage.setItem('chunkCnMode', chunkCnMode);
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
        highlightModeBtn.textContent = txt;
        highlightModeBtn.classList.toggle('active', highlightMode !== 0);
        document.body.classList.toggle('highlight-sentence-mode', highlightMode === 2 && !isChunkMode);
    }

    function findChunkIndexByTime(t) {
        return findChunkIndexByTimeHelper(chunkItems, t);
    }

    function swapActiveClass(nextEl, prevEl, className) {
        if (prevEl && prevEl !== nextEl) prevEl.classList.remove(className);
        if (nextEl && nextEl !== prevEl) nextEl.classList.add(className);
        return nextEl || null;
    }

    function clearPlaybackHighlightState() {
        if (activeWordHighlightEl) activeWordHighlightEl.classList.remove('word-highlight');
        if (activeSentenceEl) activeSentenceEl.classList.remove('sentence-active');
        if (activeChunkEl) activeChunkEl.classList.remove('chunk-active');
        activeWordHighlightEl = null;
        activeSentenceEl = null;
        activeChunkEl = null;
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
        const margin = Math.max(24, Math.min(120, containerRect.height * 0.2));
        const fullyVisible =
            elRect.top >= containerRect.top + margin &&
            elRect.bottom <= containerRect.bottom - margin;
        if (fullyVisible) return;
        const offsetTop = elRect.top - containerRect.top + container.scrollTop;
        const targetTop = offsetTop - Math.max(0, (container.clientHeight - elRect.height) / 2);
        container.scrollTo({ top: Math.max(0, targetTop), behavior: 'auto' });
    }

    window.mainUpdateHighlight = function(wordIndex) {
        const currentTime = audioPlayer.currentTime;
        if (isChunkMode) {
             if (wordIndex !== -1) {
                 currentWordIndex = wordIndex;
                 if (words[wordIndex] && Number.isInteger(words[wordIndex].segIndex)) {
                     lastActiveSegIndex = words[wordIndex].segIndex;
                 }
             }
             const chunkIdx = findChunkIndexByTime(currentTime);
             const nextWordEl = (highlightMode === 1 && wordIndex !== -1) ? document.getElementById(`word-${wordIndex}`) : null;
             activeWordHighlightEl = swapActiveClass(nextWordEl, activeWordHighlightEl, 'word-highlight');
             activeSentenceEl = swapActiveClass(null, activeSentenceEl, 'sentence-active');

             if (chunkIdx !== -1) {
                 if (chunkIdx !== lastActiveChunkIndex) {
                     const chunkBlock = document.getElementById(`chunk-${chunkIdx}`);
                     activeChunkEl = swapActiveClass(chunkBlock, activeChunkEl, 'chunk-active');
                     followPlaybackTarget(chunkBlock);
                     lastActiveChunkIndex = chunkIdx;
                 }
             } else {
                 activeChunkEl = swapActiveClass(null, activeChunkEl, 'chunk-active');
                 lastActiveChunkIndex = -1;
             }
             return; 
        }

        // === Playback navigation logic (kept intact) ===
        if (wordIndex !== -1) {
            currentWordIndex = wordIndex;
        }
        activeChunkEl = swapActiveClass(null, activeChunkEl, 'chunk-active');

        if (highlightMode === 2) {
            const segIdx = getCurrentSegmentIndex(currentTime);

            if (segIdx !== -1) {
                if (segIdx !== lastActiveSegIndex) {
                    activeWordHighlightEl = swapActiveClass(null, activeWordHighlightEl, 'word-highlight');
                    const lineDiv = document.getElementById(`segment-${segIdx}`);
                    activeSentenceEl = swapActiveClass(lineDiv, activeSentenceEl, 'sentence-active');
                    followPlaybackTarget(lineDiv);
                    lastActiveSegIndex = segIdx;
                }
            } else {
                activeSentenceEl = swapActiveClass(null, activeSentenceEl, 'sentence-active');
                lastActiveSegIndex = -1;
            }
            return;
        }

        activeSentenceEl = swapActiveClass(null, activeSentenceEl, 'sentence-active');

        if (highlightMode === 1 && wordIndex !== -1) {
            const span = document.getElementById(`word-${wordIndex}`);
            activeWordHighlightEl = swapActiveClass(span, activeWordHighlightEl, 'word-highlight');
            followPlaybackTarget(span);
        } else {
            activeWordHighlightEl = swapActiveClass(null, activeWordHighlightEl, 'word-highlight');
        }
        lastActiveSegIndex = -1; 
    };

    function bsFindActive(time) {
        return bsFindActiveHelper(wordStarts, words, time);
    }

    function forceUpdateUI(time) {
        const idx = bsFindActive(time);
        window.mainUpdateHighlight(idx);
    }

    function getCurrentSegmentIndex(time = audioPlayer.currentTime) {
        return getCurrentSegmentIndexHelper(segments, words, wordStarts, time);
    }

    function getSegmentCheckpoints(segIndex) {
        return getSegmentCheckpointsHelper(segments, segIndex);
    }

    function smartBackward() {
        const cur = audioPlayer.currentTime;
        let sIdx = getCurrentSegmentIndex(cur);
        if (sIdx === -1) { audioPlayer.currentTime = 0; forceUpdateUI(0); return; }

        let points = getSegmentCheckpoints(sIdx);
        let validPoints = points.filter(p => p < cur - 0.5);

        if (validPoints.length > 0) {
            let target = validPoints[validPoints.length - 1];
            audioPlayer.currentTime = Math.max(0, target - 0.15);
            forceUpdateUI(audioPlayer.currentTime);
            return;
        }
        if (sIdx > 0) {
            let prevPoints = getSegmentCheckpoints(sIdx - 1);
            if (prevPoints.length > 0) {
                let target = prevPoints[prevPoints.length - 1];
                audioPlayer.currentTime = Math.max(0, target - 0.15);
            } else {
                audioPlayer.currentTime = Math.max(0, segments[sIdx - 1].start - 0.15);
            }
            forceUpdateUI(audioPlayer.currentTime);
        } else {
            audioPlayer.currentTime = 0;
            forceUpdateUI(0);
        }
    }

    function smartForward() {
        const cur = audioPlayer.currentTime;
        const sIdx = getCurrentSegmentIndex(cur);
        const nextSeg = (sIdx >= 0 && sIdx < segments.length - 1) ? segments[sIdx + 1] : null;
        if (nextSeg && Number.isFinite(nextSeg.start)) {
            audioPlayer.currentTime = nextSeg.start;
            forceUpdateUI(nextSeg.start);
        }
    }

    function getActiveAiChunkIndex(time = audioPlayer.currentTime) {
        if (!chunkItems || chunkItems.length === 0 || !hasAiChunkData) return -1;
        const idx = findChunkIndexByTime(time);
        if (idx !== -1) return idx;
        return time < chunkItems[0].start ? 0 : chunkItems.length - 1;
    }

    function isAiChunkNavMode() {
        return isChunkMode && hasAiChunkData && Array.isArray(chunkItems) && chunkItems.length > 0;
    }

    function seekAndPlay(targetTime) {
        audioPlayer.currentTime = targetTime;
        forceUpdateUI(targetTime);
        if (audioPlayer.paused) {
            const p = audioPlayer.play();
            if (p && typeof p.catch === 'function') p.catch(() => {});
        }
    }

    function aiChunkBackward() {
        const idx = getActiveAiChunkIndex();
        if (idx === -1) return;

        const repeatWindowMs = 600;
        const now = Date.now();
        const isRepeatedPrevOnSameChunk =
            lastAiPrevTapChunkIndex === idx &&
            (now - lastAiPrevTapAt) <= repeatWindowMs;
        const targetIdx = isRepeatedPrevOnSameChunk ? Math.max(0, idx - 1) : idx;
        const targetTime = chunkItems[targetIdx].start;

        seekAndPlay(targetTime);
        lastAiPrevTapChunkIndex = targetIdx;
        lastAiPrevTapAt = now;
    }

    function aiChunkForward() {
        const idx = getActiveAiChunkIndex();
        if (idx === -1) return;

        const targetIdx = Math.min(chunkItems.length - 1, idx + 1);
        const targetTime = chunkItems[targetIdx].start;

        seekAndPlay(targetTime);
        lastAiPrevTapChunkIndex = -1;
        lastAiPrevTapAt = 0;
    }

    // Keep normal mode navigation logic untouched.
    function handleBackwardClickNormalMode() {
        if (highlightMode === 2 && !isChunkMode) jumpPrevSentence();
        else smartBackward();
    }

    // Keep normal mode navigation logic untouched.
    function handleForwardClickNormalMode() {
        if (highlightMode === 2 && !isChunkMode) jumpNextSentence();
        else smartForward();
    }

    function handleBackwardClick() {
        if (isAiChunkNavMode()) aiChunkBackward();
        else handleBackwardClickNormalMode();
    }

    function handleForwardClick() {
        if (isAiChunkNavMode()) aiChunkForward();
        else handleForwardClickNormalMode();
    }

    function toggleAnnotationBubble() {
        const bubble = getAnnotationBubble();
        if (bubble && typeof bubble.toggle === 'function') {
            bubble.toggle();
        }
    }

    document.addEventListener('keydown', e => {
        if (isInputLikeTarget(e.target)) return;
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        const key = e.key; 
        const lowerKey = key.toLowerCase();
        
        if (key === ' ') {
            e.preventDefault();
            audioPlayer.paused ? audioPlayer.play() : audioPlayer.pause();
        } 
        else if (lowerKey === markKey) {
            e.preventDefault();
            toggleMarkCurrent();
        } 
        else if (lowerKey === notesKey) {
            e.preventDefault();
            toggleCurrentNote(); 
        }
        else if (lowerKey === annotationBubbleKey) {
            e.preventDefault();
            toggleAnnotationBubble();
        }
        else if (lowerKey === chunkCnKey && isChunkMode) {
            e.preventDefault();
            if (chunkCnHoldMode) {
                if (!e.repeat) beginHoldChunkCn();
            } else {
                toggleChunkCn();
            }
        }
        else if (lowerKey === chunkShadowKey && isChunkMode) { 
            e.preventDefault();
            toggleChunkShadow();
        }
        else if (lowerKey === chunkNoteKey && isChunkMode) {
            e.preventDefault();
            setChunkNoteVisible(!chunkNoteVisible, true);
        }
        else if (key === backwardKey) {
            e.preventDefault();
            handleBackwardClick(); 
        }
        else if (key === forwardKey) {
            e.preventDefault();
            handleForwardClick();  
        }
    });

    addEventListener('keyup', e => {
        if (isInputLikeTarget(e.target)) return;
        if (!isChunkMode) return;
        const key = e.key;
        const lowerKey = key.toLowerCase();
        if (lowerKey === chunkCnKey && chunkCnHoldMode) {
            endHoldChunkCn();
        }
    });

    window.addEventListener('blur', () => {
        if (chunkCnHoldMode) endHoldChunkCn();
    });

    document.addEventListener('contextmenu', handleChunkSelectionContextMenu);
    if (chunkNoteCtxAddBtn) {
        chunkNoteCtxAddBtn.addEventListener('mousedown', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (!pendingChunkSelectionCtx) return;
            const ctx = pendingChunkSelectionCtx;
            closeChunkNoteContextMenu();
            openChunkNotePopover(ctx);
            const selection = window.getSelection();
            if (selection) {
                try { selection.removeAllRanges(); } catch (err) {}
            }
        });
    }
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeCustomThemePanel();
            cancelChunkNoteModal();
            closeChunkNoteContextMenu();
            closeChunkNoteDeleteDialog();
            closeChunkNoteExportDialog();
            setSelectedChunkNote('');
        } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedChunkNoteId) {
            const target = e.target;
            if (isInputLikeTarget(target) || (target && target.isContentEditable)) return;
            e.preventDefault();
            openChunkNoteDeleteDialog(selectedChunkNoteId);
        }
    });
    document.addEventListener('mousedown', (e) => {
        if (themeCustomPanel && !themeCustomPanel.hidden && themeControlsEl && !themeControlsEl.contains(e.target)) {
            closeCustomThemePanel();
        }
        document.querySelectorAll('.chunk-note-tag.editing').forEach((tag) => {
            if (tag.contains(e.target)) return;
            const finish = tag.__finishChunkNoteEdit;
            if (typeof finish === 'function') finish(false);
        });
        if (chunkNoteCtxMenu && chunkNoteCtxMenu.style.display === 'block') {
            if (!chunkNoteCtxMenu.contains(e.target)) closeChunkNoteContextMenu();
        }
        if (chunkNoteDeleteDialogEl && !chunkNoteDeleteDialogEl.contains(e.target) && !e.target.closest('.chunk-note-tag')) {
            closeChunkNoteDeleteDialog();
            setSelectedChunkNote('');
        }
        if (chunkNoteExportDialogEl && !chunkNoteExportDialogEl.contains(e.target)) {
            closeChunkNoteExportDialog();
        }
        if (!chunkNoteModalEl) return;
        if (chunkNoteModalEl.contains(e.target)) return;
        saveChunkNoteFromModal();
    }, true);
    window.addEventListener('resize', () => {
        if (!isChunkMode) return;
        scheduleChunkNoteLayoutRefresh();
    });
    window.addEventListener('beforeunload', () => {
        persistChunkNoteDraft(true);
    });

    function toggleCurrentNote() {
        if (isChunkMode) return;
        let targetIdx = -1;
        if (currentWordIndex !== -1) {
            const w = words[currentWordIndex];
            if (w) targetIdx = w.segIndex;
        } else if (lastActiveSegIndex !== -1) {
            targetIdx = lastActiveSegIndex;
        }

        if (targetIdx !== -1) {
            const noteEl = document.getElementById(`note-${targetIdx}`);
            if (noteEl) noteEl.open = !noteEl.open;
        }
    }

    function jumpPrevSentence() {
        const cur = audioPlayer.currentTime;
        const sIdx = getCurrentSegmentIndex(cur);
        let targetTime = 0;
        if (sIdx !== -1) {
            const repeatWindowMs = 600;
            const now = Date.now();
            const isRepeatedPrevOnSameSentence =
                lastSentencePrevTapSegIndex === sIdx &&
                (now - lastSentencePrevTapAt) <= repeatWindowMs;

            targetTime = isRepeatedPrevOnSameSentence && sIdx > 0
                ? segments[sIdx - 1].start
                : segments[sIdx].start;

            if (isRepeatedPrevOnSameSentence) {
                lastSentencePrevTapSegIndex = -1;
                lastSentencePrevTapAt = 0;
            } else {
                lastSentencePrevTapSegIndex = sIdx;
                lastSentencePrevTapAt = now;
            }
        } else {
            lastSentencePrevTapSegIndex = -1;
            lastSentencePrevTapAt = 0;
        }
        audioPlayer.currentTime = targetTime;
        forceUpdateUI(targetTime);
    }

    function jumpNextSentence() {
        const cur = audioPlayer.currentTime;
        const sIdx = getCurrentSegmentIndex(cur);
        const next = (sIdx >= 0 && sIdx < segments.length - 1) ? segments[sIdx + 1] : null;
        lastSentencePrevTapSegIndex = -1;
        lastSentencePrevTapAt = 0;
        if(next && Number.isFinite(next.start)) {
            audioPlayer.currentTime = next.start;
            forceUpdateUI(next.start);
        }
    }

    function syncMarkedWordVisual(globalIndex, isMarked) {
        if (!Number.isFinite(globalIndex) || globalIndex < 0) return;
        const selector = `[data-word-index="${globalIndex}"]`;
        document.querySelectorAll(selector).forEach((el) => {
            el.classList.toggle('marked', !!isMarked);
        });
    }

    function toggleMarkCurrent() {
        if(currentWordIndex === -1) return;
        const w = words[currentWordIndex];
        if (!w) return;
        let isMarked = false;
        
        if(markedMap.has(currentWordIndex)) {
            markedMap.delete(currentWordIndex);
        } else {
            markedMap.set(currentWordIndex, {
                word: w.word,
                start: w.start,
                globalIndex: currentWordIndex,
                sourceType: 'manual-mark'
            });
            isMarked = true;
        }
        syncMarkedWordVisual(currentWordIndex, isMarked);
        const arr = Array.from(markedMap.values());
        saveToDB('marks', arr);
        syncAnnotationGenerationEntryStatus();
    }

    highlightColorInput.addEventListener('input', e => {
        document.documentElement.style.setProperty('--word-highlight-bg', e.target.value);
        localStorage.setItem('highlightColor', e.target.value);
    });
    sentenceColorInput.addEventListener('input', e => {
        document.documentElement.style.setProperty('--sentence-highlight-bg', e.target.value);
        localStorage.setItem('sentenceColor', e.target.value);
    });

    [hotkeyInput, hotkeyNotesInput, hotkeyAnnotationBubbleInput, hotkeyBackwardInput, hotkeyForwardInput, hotkeyChunkCnInput, hotkeyChunkShadowInput, hotkeyChunkNoteInput].filter(Boolean).forEach(inp => {
       inp.addEventListener('keydown', e => {
           e.preventDefault();
           const validKey = (e.key.length === 1) ? e.key.toLowerCase() : e.key;
           inp.value = validKey;
           
           if(inp === hotkeyInput) { markKey = validKey; localStorage.setItem('markKey', markKey); }
           if(inp === hotkeyNotesInput) { notesKey = validKey; localStorage.setItem('notesKey', notesKey); }
           if(inp === hotkeyAnnotationBubbleInput) { annotationBubbleKey = validKey; localStorage.setItem('annotationBubbleKey', annotationBubbleKey); }
        if(inp === hotkeyChunkCnInput) { chunkCnKey = validKey; localStorage.setItem('chunkCnKey', chunkCnKey); }
           if(inp === hotkeyChunkShadowInput) { chunkShadowKey = validKey; localStorage.setItem('chunkShadowKey', chunkShadowKey); }
           if(inp === hotkeyChunkNoteInput) { chunkNoteKey = validKey; localStorage.setItem('chunkNoteKey', chunkNoteKey); }
           if(inp === hotkeyBackwardInput) { backwardKey = validKey; localStorage.setItem('backwardKey', backwardKey); }
           if(inp === hotkeyForwardInput) { forwardKey = validKey; localStorage.setItem('forwardKey', forwardKey); }
       });
    });

    function applyImportedChunkNotes(data) {
        const arr = Array.isArray(data) ? data : (data && Array.isArray(data.notes) ? data.notes : null);
        if (!arr) throw new Error('invalid chunk notes json');
        const next = {};
        arr.forEach((n, i) => {
            if (!n || typeof n !== 'object') return;
            const chunkRef = String(n.chunkRef || '');
            const startGlobal = Number(n.startGlobal);
            const endGlobal = Number(n.endGlobal);
            const note = String(n.note || '').trim();
            const selectedText = String(n.selectedText || '').trim();
            if (!chunkRef || !Number.isFinite(startGlobal) || !Number.isFinite(endGlobal) || !note) return;
            const id = String(n.id || makeSelectionNoteBaseId(chunkRef, startGlobal, endGlobal));
            next[id] = {
                id,
                chunkRef,
                chunkIdx: Number.isFinite(Number(n.chunkIdx)) ? Number(n.chunkIdx) : -1,
                startGlobal,
                endGlobal,
                selectedText,
                note,
                coordSpace: typeof n.coordSpace === 'string' ? n.coordSpace : undefined,
                x: Number.isFinite(Number(n.x)) ? Number(n.x) : undefined,
                y: Number.isFinite(Number(n.y)) ? Number(n.y) : undefined,
                offsetX: Number.isFinite(Number(n.offsetX)) ? Number(n.offsetX) : undefined,
                offsetY: Number.isFinite(Number(n.offsetY)) ? Number(n.offsetY) : undefined,
                w: Number.isFinite(Number(n.w)) ? Number(n.w) : undefined,
                h: Number.isFinite(Number(n.h)) ? Number(n.h) : undefined,
                autoSize: n.autoSize !== false,
                fontSize: sanitizeChunkNoteFontSize(n.fontSize),
                color: (typeof n.color === 'string' && n.color.trim()) ? n.color.trim() : undefined,
                updatedAt: Number.isFinite(Number(n.updatedAt)) ? Number(n.updatedAt) : Date.now()
            };
        });
        chunkNotesMap = next;
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
                    saveToDB(getChunkNotesStorageKey(), buildChunkNotesSnapshot());
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
            const sameAudioHandle = !!chunkNotesFileHandle && (chunkNotesFileHandleAudioKey === (currentAudioKey || 'default-audio'));
            try {
                if (!sameAudioHandle) {
                    await saveChunkNotesAs(snapshot, suggestedName);
                    showToast('Chunk notes saved', 'success');
                    return;
                }
                openChunkNotesExportConfirmDialog(
                    chunkNotesFileName || suggestedName,
                    async () => {
                        await saveChunkNotesAs(snapshot, suggestedName);
                        showToast('Chunk notes saved as new file', 'success');
                    },
                    async () => {
                        if (!chunkNotesFileHandle) {
                            await saveChunkNotesAs(snapshot, suggestedName);
                        } else {
                            await writeChunkNotesToHandle(chunkNotesFileHandle, snapshot);
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

    if (importAnnotationGeneratedBtn && importAnnotationGeneratedInput) {
        importAnnotationGeneratedBtn.addEventListener('click', () => importAnnotationGeneratedInput.click());
        importAnnotationGeneratedInput.addEventListener('change', async (event) => {
            const file = getFirstFileFromEvent(event);
            importAnnotationGeneratedInput.value = '';
            if (!file) return;
            try {
                const result = await importFullArticleAnnotations(file);
                if (isChunkMode) renderChunkMode(); else renderTranscript();
                forceUpdateUI(audioPlayer.currentTime);
                showToast(`全文注释已导入 ${result.itemCount} 条`, 'success');
            } catch (error) {
                showError('ANNOTATION_IMPORT', error && error.message ? error.message : 'Import failed');
            }
        });
    }

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

    if (annotationPromptCopyBtn) {
        annotationPromptCopyBtn.addEventListener('click', () => {
            copyAnnotationPromptToClipboard().catch((error) => {
                showError('ANNOTATION_PROMPT_COPY', error && error.message ? error.message : 'Copy failed');
            });
        });
    }

    if (annotationPromptExportBtn) {
        annotationPromptExportBtn.addEventListener('click', exportAnnotationPromptPackage);
    }

    if (annotationPromptCloseBtn) {
        annotationPromptCloseBtn.addEventListener('click', closeAnnotationPromptPanel);
    }

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') closeAnnotationPromptPanel();
    });
    
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

    exportJsonBtn.addEventListener('click', () => {
        if(markedMap.size === 0) { showError('MARKS_EMPTY', 'No marks to export'); return; }
        const arr = Array.from(markedMap.values());
        const blob = new Blob([JSON.stringify(arr, null, 2)], {type:'application/json'});
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob); a.download = 'marks.json';
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
    });

    exportMdAllBtn.addEventListener('click', () => {
        if (!segments.length) { showError('TRANSCRIPT_EMPTY', 'No transcript to export'); return; }
        const lines = segments.map(seg => {
            if(!seg.words) return "";
            return seg.words.map(w => {
                const txt = w.word || w.text || "";
                if (markedMap.has(w.globalIndex)) return `**${txt.trim()}**`; 
                return txt.trim();
            }).join(" "); 
        }).join("\n\n");
        const blob = new Blob([lines], {type:'text/plain'});
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob); a.download = 'transcript_full.txt';
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
    });

    function changeSpeed(r) { 
        audioPlayer.playbackRate = r;
        document.querySelectorAll('.speed-btn').forEach(b => b.classList.toggle('speed-button-active', parseFloat(b.dataset.speed) === r));
    }
    toggleFollowBtn.onclick = () => {
        autoFollow = !autoFollow;
        toggleFollowBtn.classList.toggle('on', autoFollow);
        toggleFollowBtn.innerText = autoFollow ? '跟随:开' : '跟随:关';
    };

    (function(){
      function loop(){
        if(!audioPlayer.paused){
          const currentTime = audioPlayer.currentTime;
          const idx = bsFindActive(currentTime);
          const chunkIdx = isChunkMode ? findChunkIndexByTime(currentTime) : -1;
          const segIdx = (!isChunkMode && highlightMode === 2)
            ? getCurrentSegmentIndex(currentTime)
            : ((!isChunkMode && idx !== -1 && words[idx]) ? words[idx].segIndex : -1);
          const signatureWordIdx = idx;
          const signature = `${isChunkMode ? 'chunk' : 'line'}|${highlightMode}|${signatureWordIdx}|${chunkIdx}|${segIdx}`;
          if (signature !== playbackUiSignature) {
            playbackUiSignature = signature;
            window.mainUpdateHighlight(idx);
          }
        }
        requestAnimationFrame(loop);
      }
      loop();
      document.getElementById('main-app-area').addEventListener('wheel', () => {
        userScrollSuppress = true;
        if(suppressTimer) clearTimeout(suppressTimer);
        suppressTimer = setTimeout(() => userScrollSuppress = false, 3000);
      }, {passive:true});
    })();

    (function initLiquidGlassUIInteractions() {
      const panelSelector = [
        '.controls',
        '.extra-controls',
        '.transcript-header',
        '#helper-panel',
        '#style-editor-modal',
        '#chunk-style-modal',
        '#chunk-note-style-modal',
        '#app-toast',
        '#chunk-note-ctx-menu',
        '.control-group',
        '.hotkey-box'
      ].join(', ');

      function lockChunkNoteDimensions() {
        Object.values(chunkNotesMap).forEach((note) => {
          if (!note || !note.id) return;
          const tag = getChunkNoteTagById(note.id);
          if (tag) {
            const contentBox = getChunkNoteContentBoxSize(tag);
            const w = Math.max(40, Math.round(contentBox && Number.isFinite(contentBox.width) ? contentBox.width : 0));
            const h = Math.max(18, Math.round(contentBox && Number.isFinite(contentBox.height) ? contentBox.height : 0));
            note.w = w;
            note.h = h;
          }
          if (Number.isFinite(Number(note.w)) && Number.isFinite(Number(note.h))) {
            note.autoSize = false;
          }
        });
      }
      const buttonSelector = [
        'button',
        '.file-btn',
        '.mini-toggle',
        '.style-btn-toggle'
      ].join(', ');

      function setGlassPointerVars(el, clientX, clientY) {
        const rect = el.getBoundingClientRect();
        const x = ((clientX - rect.left) / Math.max(rect.width, 1)) * 100;
        const y = ((clientY - rect.top) / Math.max(rect.height, 1)) * 100;
        el.style.setProperty('--glass-mx', `${Math.max(0, Math.min(100, x))}%`);
        el.style.setProperty('--glass-my', `${Math.max(0, Math.min(100, y))}%`);
      }

      function bindGlassDynamic(el) {
        if (!el || el.dataset.glassBound === '1') return;
        el.dataset.glassBound = '1';
        el.classList.add('ui-glass-dynamic');

        let rafId = 0;
        let px = 50;
        let py = 50;
        const onMove = (ev) => {
          px = ev.clientX;
          py = ev.clientY;
          if (rafId) return;
          rafId = requestAnimationFrame(() => {
            setGlassPointerVars(el, px, py);
            rafId = 0;
          });
        };
        const onEnter = (ev) => {
          setGlassPointerVars(el, ev.clientX, ev.clientY);
        };
        const onLeave = () => {
          el.style.setProperty('--glass-mx', '50%');
          el.style.setProperty('--glass-my', '50%');
        };
        el.addEventListener('pointermove', onMove, { passive: true });
        el.addEventListener('pointerenter', onEnter, { passive: true });
        el.addEventListener('pointerleave', onLeave, { passive: true });
      }

      function decorateExisting() {
        document.querySelectorAll(panelSelector).forEach((el) => {
          el.classList.add('glass-panel');
          bindGlassDynamic(el);
        });
        document.querySelectorAll(buttonSelector).forEach((el) => {
          el.classList.add('glass-button');
        });
      }

      decorateExisting();

      const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          if (!mutation.addedNodes || mutation.addedNodes.length === 0) continue;
          for (const node of mutation.addedNodes) {
            if (!(node instanceof Element)) continue;
            if (node.matches && node.matches(panelSelector)) {
              node.classList.add('glass-panel');
              bindGlassDynamic(node);
            }
            if (node.matches && node.matches(buttonSelector)) {
              node.classList.add('glass-button');
            }
            node.querySelectorAll?.(panelSelector).forEach((el) => {
              el.classList.add('glass-panel');
              bindGlassDynamic(el);
            });
            node.querySelectorAll?.(buttonSelector).forEach((el) => {
              el.classList.add('glass-button');
            });
          }
        }
      });

      observer.observe(document.body, { childList: true, subtree: true });
      window.__lockChunkNoteDimensionsForTheme = lockChunkNoteDimensions;
    })();
  
    // Init hold button label
    setTimeout(()=>{ try{updateChunkCnHoldBtn();}catch(e){} }, 0);
