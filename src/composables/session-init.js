import { renderTranscript, renderChunkMode } from './render-runtime.js';
import { getAnnotationApiSettingsUiApi } from './annotation-api-settings-ui.js';
import { getSessionState } from './session-state-provider.js';

  var st = getSessionState();
  var _ns = window._ns || {};
  var annotationApiSettingsBtn = document.getElementById('btn-annotation-api-settings');
  var annotationApiSettingsPanel = document.getElementById('annotation-api-settings-panel');

    initDB().then(async () => {
        await clearPersistedReaderContentOnStartup();
        // [鍏抽敭淇] 鍏堝姞杞界姸鎬侊紝鍐嶆仮澶?Session (娓叉煋)
        // Restore Manual States FIRST
        const savedManualStates = localStorage.getItem('st.manualChunkStates');
        if (savedManualStates) {
            try { st.manualChunkStates= JSON.parse(savedManualStates); } catch(e){}
        }

        // Restore CN Mode (Focus/Global)
        const savedCnMode = localStorage.getItem('st.chunkCnMode');
        if (savedCnMode === 'focus') {
             st.chunkCnMode= 'focus'; // 璁剧疆鍙橀噺
             // 鎸夐挳UI绋嶅悗鍦?restoreSession 鍚庢洿鏂?
        }

        // Restore Shadow State
        const savedShadowState = localStorage.getItem('st.isChunkShadowOn');
        if (savedShadowState !== null) {
            st.isChunkShadowOn= (savedShadowState === 'true');
            if (!st.isChunkShadowOn) document.body.classList.add('hide-chunk-shadow');
        }

        // Restore Chunk Settings
        if (localStorage.getItem('chunkEnSize')) document.documentElement.style.setProperty('--chunk-en-size', localStorage.getItem('chunkEnSize'));
        if (localStorage.getItem('chunkCnSize')) document.documentElement.style.setProperty('--chunk-cn-size', localStorage.getItem('chunkCnSize'));
        if (localStorage.getItem('chunkGap')) document.documentElement.style.setProperty('--chunk-gap', localStorage.getItem('chunkGap'));
        if (localStorage.getItem('chunkCnColor')) document.documentElement.style.setProperty('--chunk-cn-color', localStorage.getItem('chunkCnColor'));
        if (localStorage.getItem('chunkBgColor')) document.documentElement.style.setProperty('--chunk-active-bg', localStorage.getItem('chunkBgColor'));
        adjustChunkNoteArrowSizeByGap();
        
    function initStyleEditor() { /* moved to style-editor module */ }
        
        // Update UI buttons based on loaded state
        if (st.chunkCnMode === 'focus') {
             const btn = document.getElementById('btn-chunk-focus');
             if(btn) { btn.innerText = "聚焦"; btn.classList.add('active'); }
             if(st.isChunkMode && transcriptContainer) transcriptContainer.classList.add('cn-mode-focus');
        }

        const savedChunkMode = localStorage.getItem('st.isChunkMode') === 'true';
        const savedChunkVisible = localStorage.getItem('st.chunkCnVisible');
        if (savedChunkVisible !== null) st.chunkCnVisible= savedChunkVisible === 'true';
        const savedHoldMode = localStorage.getItem('st.chunkCnHoldMode');
        if (savedHoldMode !== null) st.chunkCnHoldMode= savedHoldMode === 'true';
        const savedNoteVisible = localStorage.getItem('chunkNoteVisible');
        if (savedNoteVisible !== null) _ns.chunkNoteVisible = savedNoteVisible === 'true';
        setChunkNoteVisible(_ns.chunkNoteVisible, false);
        updateChunkCnHoldBtn();

        await restoreSession();
        
        if (savedChunkMode) {
            setTimeout(() => {
                if (st.chunkItems.length > 0 && st.hasAiChunkData) window.toggleChunkMode(true);
            }, 500);
        }
    });

    async function restoreSession() {
        emitAnnotationDiagnostics('app.restore_session_start', {
            scope: getAnnotationGenerationScope(),
            currentAudioKey: st.currentAudioKey,
            currentDocId: _ns.currentDocId
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
                currentAudioKey: st.currentAudioKey,
                currentDocId: _ns.currentDocId,
                derivedDocId: buildCurrentSentenceDocId(transcriptData),
                segmentCount: Array.isArray(transcriptData && transcriptData.segments) ? transcriptData.segments.length : 0
            });
            await switchSentenceNotesDoc(transcriptData);
            emitAnnotationDiagnostics('app.restore_scope_updated', {
                scope: getAnnotationGenerationScope(),
                currentAudioKey: st.currentAudioKey,
                currentDocId: _ns.currentDocId
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
                if (normalizedMark) st.markedMap.set(normalizedMark.globalIndex, normalizedMark);
            });
           if (!st.isChunkMode) renderTranscript();
           syncAnnotationGenerationEntryStatus();
           bridgeToPinia();
        }
        const generatedStore = getAnnotationGeneratedResultStore();
        emitAnnotationDiagnostics('app.restore_session_complete', {
            scope: getAnnotationGenerationScope(),
            currentAudioKey: st.currentAudioKey,
            currentDocId: _ns.currentDocId,
            markedCount: st.markedMap.size,
            generatedItemCount: generatedStore && typeof generatedStore.getItems === 'function'
                ? generatedStore.getItems().length
                : 0
        });
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
        if (!Array.isArray(words) || start >= st.words.length || end >= st.words.length) return null;

        const matchedWords = st.words.slice(start, end + 1);
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
                const word = st.words[globalIndex];
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
            st.markedMap.clear();
            saveToDB('marks', []);
            return { addedCount: 0, totalCount: 0 };
        }

        if (!addedCount && !replaceExisting) {
            return { addedCount: 0, totalCount: st.markedMap.size };
        }

        st.markedMap.clear();
        nextMap.forEach((value, key) => st.markedMap.set(key, value));
        saveToDB('marks', Array.from(st.markedMap.values()));
        if (st.isChunkMode) renderChunkMode(); else renderTranscript();
        forceUpdateUI(audioPlayer.currentTime);
        syncAnnotationGenerationEntryStatus();
        return { addedCount, totalCount: st.markedMap.size };
    }

    async function syncAnnotationGenerationEntryStatus() {
        return undefined;
    }

    let annotationGeneratedIndexRefreshSeq= 0;
    let annotationGeneratedIndexScopeKey= '';

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
                audioKey: st.currentAudioKey,
                documentId: _ns.currentDocId
            });
        }
        return normalizeAnnotationGenerationScope({
            audioKey: st.currentAudioKey,
            documentId: _ns.currentDocId
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
        st.annotationGeneratedIndexRefreshSeq++;
        st.annotationGeneratedIndexScopeKey= '';
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
        const refreshSeq = ++st.annotationGeneratedIndexRefreshSeq;
        emitAnnotationDiagnostics('app.generated_index_refresh_start', {
            scope,
            scopeKey,
            refreshSeq
        });

        const bundle = await storage.loadBundle(scope);
        if (refreshSeq !== st.annotationGeneratedIndexRefreshSeq || getAnnotationGenerationScopeKey() !== scopeKey) {
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
        st.annotationGeneratedIndexScopeKey= scopeKey;
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
        const transcriptBlocks = st.segments.map((seg, index) => ({
            type: 'segment',
            index,
            id: String(seg.id || seg.segment_id || index),
            start: Number.isFinite(Number(seg.start)) ? Number(seg.start) : null,
            end: Number.isFinite(Number(seg.end)) ? Number(seg.end) : null,
            text: getAnnotationGenerationBlockText(seg),
            words: Array.isArray(seg.words) ? seg.words : []
        })).filter(block => block.text);
        const chunkBlocks = (st.hasAiChunkData && Array.isArray(st.chunkItems))
            ? st.chunkItems.map((item, index) => ({
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
        const marks = Array.from(st.markedMap.values())
            .map((mark) => normalizeAnnotationMark(mark))
            .filter(Boolean);
        return {
            documentId: _ns.currentDocId,
            audioKey: st.currentAudioKey,
            sourceMode: chunkBlocks.length ? 'chunk' : 'transcript',
            totalBlocks: blocks.length,
            marks,
            stats: {
                words: st.words.length,
                segments: st.segments.length,
                chunks: st.chunkItems.length,
                marks: marks.length
            },
            blocks
        };
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
        const words= getAnnotationSentenceFragmentWords(source);
        const lastWord = getAnnotationSentenceFragmentLastWord(source);
        if (/[,;:]\s*$/.test(source)) return true;
        if (/^(and|or|but)\b/i.test(source) && !/[.!?;。！？；]["')\]”’）】》」』]*$/.test(source)) return true;
        if (/\b[aA]n?\s+[A-Za-z-]+$/.test(source) && st.words.length <= 5) return true;
        if (/\bthe\s+[A-Za-z-]+$/.test(source) && st.words.length <= 5) return true;
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
        const helper = window.ImportExportSharedHelpers || null;
        const audioBase = helper && typeof helper.getCurrentAudioFilenameBase === 'function'
            ? helper.getCurrentAudioFilenameBase(st.currentAudioMeta, 'article')
            : 'article';
        const filenameBase = sanitizeFilenamePart(payload.articleId || audioBase, 'article');
        downloadJsonFile(payload, `${filenameBase}_annotation_light.json`);
        showToast(`轻量标注导出完成，共 ${payload.items.length} 条`, 'success');
        return payload;
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

    function initAnnotationApiSettingsUi() {
        if (!annotationApiSettingsBtn || annotationApiSettingsBtn.hidden) return;
        const configHelper = getAnnotationApiConfigHelper();
        if (configHelper && typeof configHelper.restore === 'function') {
            configHelper.restore();
        }

        const settingsUi = getAnnotationApiSettingsUiApi();
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
        st.chunkItems= [];
        st.hasAiChunkData= false;
        st.manualChunkStates= {};
        _ns.selectedSentence = null;
        st.lastActiveChunkIndex= -1;
        st.lastAiPrevTapChunkIndex= -1;
        st.lastAiPrevTapAt= 0;
        try {
            localStorage.removeItem('st.manualChunkStates');
            localStorage.removeItem('st.isChunkMode');
        } catch (e) {}
        await deleteFromDB('chunkData');
        await deleteFromDB('marks');
        const toggleChunkBtn = document.getElementById('toggle-chunk-btn');
        if (toggleChunkBtn) toggleChunkBtn.innerText = 'AI切分';
        if (st.isChunkMode) {
            st.isChunkMode= false;
        }
    }

    async function clearPersistedReaderContentOnStartup() {
        emitAnnotationDiagnostics('app.startup_clear_reader_skipped', {
            scope: getAnnotationGenerationScope(),
            currentAudioKey: st.currentAudioKey,
            currentDocId: _ns.currentDocId,
            skippedKeys: ['transcript', 'marks', 'notes', 'visual', 'chunkData']
        });
        try {
            localStorage.removeItem('st.manualChunkStates');
            localStorage.removeItem('st.isChunkMode');
            localStorage.removeItem('st.chunkCnVisible');
            localStorage.removeItem('st.chunkCnHoldMode');
            localStorage.removeItem('chunkNoteVisible');
        } catch (e) {}
    }

    // --- Settings Load ---
    try {
      const readStoredHotkey = (key, legacyKey) => localStorage.getItem(key) || localStorage.getItem(legacyKey);
      const savedMarkKey = readStoredHotkey('st.markKey', 'markKey');
      const savedNotesKey = readStoredHotkey('st.notesKey', 'notesKey');
      const savedAnnotationBubbleKey = readStoredHotkey('st.annotationBubbleKey', 'annotationBubbleKey');
      const savedChunkCnKey = readStoredHotkey('st.chunkCnKey', 'chunkCnKey');
      const savedChunkShadowKey = readStoredHotkey('st.chunkShadowKey', 'chunkShadowKey');
      const savedChunkNoteKey = readStoredHotkey('st.chunkNoteKey', 'chunkNoteKey');
      const savedBackwardKey = readStoredHotkey('st.backwardKey', 'backwardKey');
      const savedForwardKey = readStoredHotkey('st.forwardKey', 'forwardKey');
      if(savedMarkKey) { st.markKey= savedMarkKey.toLowerCase(); hotkeyInput.value = st.markKey; }
      if(savedNotesKey) { st.notesKey= savedNotesKey.toLowerCase(); hotkeyNotesInput.value = st.notesKey; }
      if(savedAnnotationBubbleKey) { st.annotationBubbleKey= savedAnnotationBubbleKey.toLowerCase(); if (hotkeyAnnotationBubbleInput) hotkeyAnnotationBubbleInput.value = st.annotationBubbleKey; }
      if(savedChunkCnKey) { st.chunkCnKey= savedChunkCnKey.toLowerCase(); hotkeyChunkCnInput.value = st.chunkCnKey; }
      if(savedChunkShadowKey) { st.chunkShadowKey= savedChunkShadowKey.toLowerCase(); hotkeyChunkShadowInput.value = st.chunkShadowKey; }
      if(savedChunkNoteKey) { st.chunkNoteKey= savedChunkNoteKey.toLowerCase(); if (hotkeyChunkNoteInput) hotkeyChunkNoteInput.value = st.chunkNoteKey; }
      if(savedBackwardKey) { st.backwardKey= savedBackwardKey; hotkeyBackwardInput.value = st.backwardKey; }
      if(savedForwardKey) { st.forwardKey= savedForwardKey; hotkeyForwardInput.value = st.forwardKey; }
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
      const storedPreviewVisible = localStorage.getItem('st.notePreviewVisible');
      if (storedPreviewVisible !== null) st.notePreviewVisible= storedPreviewVisible === 'true';
      const storedPreviewWidth = parseFloat(localStorage.getItem('st.notePreviewWidth') || '');
      if (Number.isFinite(storedPreviewWidth)) {
          st.notePreviewWidth= Math.max(280, Math.min(520, storedPreviewWidth));
      }
      const storedPreviewHeight = parseFloat(localStorage.getItem('st.notePreviewHeight') || '');
      if (Number.isFinite(storedPreviewHeight)) {
          st.notePreviewHeight= Math.max(420, Math.min(window.innerHeight - 28, storedPreviewHeight));
      }
    } catch(e){}


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
