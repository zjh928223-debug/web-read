import { createClozeAnswerState, checkClozeAnswerState } from './cloze-interactions.js';

  // === M5: AI chunk alignment/matching pipeline ===
  function initChunkPipeline(deps) {
    var state = deps.state;
    var getIsChunkMode = deps.getIsChunkMode;
    var renderChunkMode = deps.renderChunkMode;
    var bridgeToPinia = deps.bridgeToPinia;
    var toggleChunkBtn = deps.toggleChunkBtn;
    var enterChunkMode = deps.enterChunkMode;

    var cleanTextHelper = deps.cleanTextHelper;
    var tokenizeTextHelper = deps.tokenizeTextHelper;
    var findExactMatchRangeHelper = deps.findExactMatchRangeHelper;

    var CMH = window.ChunkMatchingHelpers;

    function processChunkData(data) {
        if (!state.segments || state.segments.length === 0) {
            state.chunkItems = [];
            return;
        }

        state.chunkItems = [];

        var clean = cleanTextHelper;

        var tokenize = tokenizeTextHelper;

        var getSegTimeRange = function (seg) {
            if (seg && typeof seg.start === "number" && typeof seg.end === "number") return [seg.start, seg.end];
            if (seg && seg.words && seg.words.length) return [seg.words[0].start, seg.words[seg.words.length - 1].end];
            return [0, 0];
        };

        var pushFallbackChunk = function (seg, chunk, segId) {
            var st_ed = getSegTimeRange(seg);
            var st = st_ed[0];
            var ed = st_ed[1];
            state.chunkItems.push({
                words: [],
                start: st,
                end: ed,
                ch: chunk && (chunk.zh || chunk.ch) ? (chunk.zh || chunk.ch) : " ",
                rawEn: chunk && chunk.en ? chunk.en : "",
                isFallback: true,
                segId: (typeof segId === "number") ? segId : -1
            });
        };

        var findExactPhrase = function (segWords, phraseTokens) { return findExactMatchRangeHelper(segWords, phraseTokens, 0); };

        var findExactPhraseFromIndex = function (wordList, phraseTokens, fromIndex) {
            if (fromIndex === undefined) fromIndex = 0;
            return findExactMatchRangeHelper(wordList, phraseTokens, fromIndex);
        };

        var clamp = CMH.clamp;

        var findMatchIndex = function (baseIdx, targetWord, segWords, searchRange) {
            return CMH.adjustIndex(baseIdx, targetWord, segWords, searchRange);
        };

        var START_RANGE = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, -1, -2, -3, -4, -5, -6, -7, -8, -9, -10];
        var END_RANGE   = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, -1, -2, -3, -4, -5, -6, -7, -8, -9, -10, -11, -12];

        // 1. process new format
        if (data.s && Array.isArray(data.s)) {
            var useGlobalWordIndexMode = data.s.length === 1;
            var globalWordCursor = 0;
            data.s.forEach(function (segItem) {
                var segId = segItem.id;
                var targetSeg = (segId >= 0 && segId < state.segments.length) ? state.segments[segId] : null;

                if (!segItem.chunks || !Array.isArray(segItem.chunks)) return;

                segItem.chunks.forEach(function (chunk) {
                    var segWords = targetSeg && targetSeg.words ? targetSeg.words : null;

                    if (!segWords || !segWords.length) {
                        pushFallbackChunk(targetSeg, chunk, segId);
                        return;
                    }

                    var phraseTokens = tokenize(chunk.en);

                    var exact = findExactPhrase(segWords, phraseTokens);

                    var finalStart = null;
                    var finalEnd = null;

                    if (useGlobalWordIndexMode && Number.isFinite(Number(chunk.a)) && Number.isFinite(Number(chunk.b))) {
                        var globalStart = Math.max(0, Number(chunk.a) - 1);
                        var globalEnd = Math.max(globalStart, Number(chunk.b) - 1);
                        var matchedWords = state.words.slice(globalStart, globalEnd + 1);
                        if (matchedWords.length) {
                            state.chunkItems.push({
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
                        var globalExact = findExactPhraseFromIndex(state.words, phraseTokens, globalWordCursor);
                        if (globalExact) {
                            var matchedWords2 = state.words.slice(globalExact[0], globalExact[1] + 1);
                            if (matchedWords2.length) {
                                state.chunkItems.push({
                                    words: matchedWords2,
                                    start: matchedWords2[0].start,
                                    end: matchedWords2[matchedWords2.length - 1].end,
                                    ch: chunk.zh || " ",
                                    rawEn: chunk.en || "",
                                    isFallback: false,
                                    segId: Number.isInteger(matchedWords2[0].segIndex) ? matchedWords2[0].segIndex : segId
                                });
                                globalWordCursor = globalExact[1] + 1;
                                return;
                            }
                        }

                        var bounds = CMH.normalizeChunkCandidateBounds(chunk.a, chunk.b);
                        var a = bounds.start;
                        var b = bounds.end;

                        var candidates = CMH.buildChunkCandidateVariants(a, b);

                        var firstWord = phraseTokens.length ? phraseTokens[0] : "";
                        var lastWord  = phraseTokens.length ? phraseTokens[phraseTokens.length - 1] : "";

                        var best = null;

                        candidates.forEach(function (c) {
                            var clamped = CMH.clampChunkMatchCandidate(c, segWords.length);
                            var s0 = clamped.startIndex;
                            var e0 = clamped.endIndex;

                            var st = s0;
                            var ed = e0;

                            if (firstWord) st = findMatchIndex(s0, firstWord, segWords, START_RANGE);

                            var endWindow = CMH.buildChunkCandidateEndWindow(st, e0, phraseTokens.length, segWords.length);
                            var minEnd = endWindow.minEnd;
                            var baseEnd = endWindow.baseEnd;

                            if (lastWord) ed = findMatchIndex(baseEnd, lastWord, segWords, END_RANGE);

                            if (ed < minEnd) ed = Math.min(segWords.length - 1, minEnd);

                            var boundaryWords = CMH.getChunkCandidateBoundaryWords(segWords, st, ed);
                            var wStart = boundaryWords.startWord;
                            var wEnd = boundaryWords.endWord;

                            var score = CMH.scoreMatchCandidate(firstWord, lastWord, wStart, wEnd);

                            var candidate = CMH.normalizeChunkMatchCandidate(st, ed, score);

                            if (!best || candidate.score > best.score) best = candidate;
                        });

                        if (best) {
                            if (phraseTokens.length && best.score === 0) {
                                finalStart = null;
                                finalEnd = null;
                            } else {
                                finalStart = best.st;
                                finalEnd = best.ed;
                            }
                        }
                    }

                    if (finalStart === null || finalEnd === null || finalStart > finalEnd) {
                        pushFallbackChunk(targetSeg, chunk, segId);
                        return;
                    }

                    if (finalStart < 0 || finalStart >= segWords.length) {
                        pushFallbackChunk(targetSeg, chunk, segId);
                        return;
                    }

                    finalEnd = clamp(finalEnd, 0, segWords.length - 1);

                    var chunkWords = segWords.slice(finalStart, finalEnd + 1);

                    if (!chunkWords.length) {
                        pushFallbackChunk(targetSeg, chunk, segId);
                        return;
                    }

                    state.chunkItems.push({
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
        // 2. process old format
        else {
            var items = Array.isArray(data) ? data : (data.items || []);
            state.chunkItems = items.map(function (item) {
                var seg = state.segments[item.segment_id];
                if (!seg || !seg.words || !seg.words.length) {
                    var st_ed2 = getSegTimeRange(seg);
                    var st2 = st_ed2[0];
                    var ed2 = st_ed2[1];
                    return Object.assign({}, item, {
                        words: [],
                        start: st2,
                        end: ed2,
                        ch: item.ch || item.zh || " ",
                        rawEn: item.en || "",
                        isFallback: true,
                        segId: item.segment_id
                    });
                }

                var startIdx = (item.w_start_1based || 1) - 1;
                var endIdx = (item.w_end_1based || seg.words.length);
                var chunkWords = seg.words.slice(startIdx, endIdx);

                if (!chunkWords.length) {
                    var st_ed3 = getSegTimeRange(seg);
                    var st3 = st_ed3[0];
                    var ed3 = st_ed3[1];
                    return Object.assign({}, item, {
                        words: [],
                        start: st3,
                        end: ed3,
                        ch: item.ch || item.zh || " ",
                        rawEn: item.en || "",
                        isFallback: true,
                        segId: item.segment_id
                    });
                }

                return Object.assign({}, item, {
                    words: chunkWords,
                    start: chunkWords[0].start,
                    end: chunkWords[chunkWords.length - 1].end,
                    isFallback: false,
                    rawEn: item.en || ""
                });
            }).filter(function (item) { return item !== null; });
        }

        state.hasAiChunkData = state.chunkItems.length > 0;
        toggleChunkBtn.innerText = state.hasAiChunkData ? "AI切分(已就绪)" : "AI切分";
        if (state.hasAiChunkData && !getIsChunkMode() && typeof enterChunkMode === 'function') {
            enterChunkMode();
        } else if (getIsChunkMode()) {
            renderChunkMode();
        }
        bridgeToPinia();
    }

    window.processChunkData = processChunkData;

    return {
        processChunkData: processChunkData
    };
  }

  // === M4: Import handlers (audio/transcript/chunk/marks) ===
  function initImportHandlers(deps) {
    var state = deps.state;

    var audioFileInput = deps.audioFileInput;
    var transcriptFileInput = deps.transcriptFileInput;
    var chunkFileInput = deps.chunkFileInput;
    var clozeFileInput = deps.clozeFileInput;

    var getFirstFileFromEvent = deps.getFirstFileFromEvent;
    var readFileAsText = deps.readFileAsText;
    var saveToDB = deps.saveToDB;
    var applyCurrentAudioMeta = deps.applyCurrentAudioMeta;
    var clearGeneratedAnnotationIndex = deps.clearGeneratedAnnotationIndex;
    var restoreReaderFocus = deps.restoreReaderFocus;
    var showToast = deps.showToast;
    var showError = deps.showError;
    var markFileLoaded = deps.markFileLoaded;
    var lblAudio = deps.lblAudio;
    var lblTranscript = deps.lblTranscript;
    var validateTranscriptData = deps.validateTranscriptData;
    var validateChunkData = deps.validateChunkData;
    var validateClozeData = deps.validateClozeData;
    var clearPersistedChunkSession = deps.clearPersistedChunkSession;
    var switchSentenceNotesDoc = deps.switchSentenceNotesDoc;
    var getAnnotationGenerationScope = deps.getAnnotationGenerationScope;
    var emitAnnotationDiagnostics = deps.emitAnnotationDiagnostics;
    var buildCurrentSentenceDocId = deps.buildCurrentSentenceDocId;
    var scheduleGeneratedAnnotationIndexRefresh = deps.scheduleGeneratedAnnotationIndexRefresh;
    var renderTranscript = deps.renderTranscript;
    var renderChunkMode = deps.renderChunkMode;
    var forceUpdateUI = deps.forceUpdateUI;
    var syncAnnotationGenerationEntryStatus = deps.syncAnnotationGenerationEntryStatus;
    var bridgeToPinia = deps.bridgeToPinia;
    var rebuildVocabMatching = deps.rebuildVocabMatching;
    var closeChunkNoteExportDialog = deps.closeChunkNoteExportDialog;
    var loadChunkNotesForCurrentAudio = deps.loadChunkNotesForCurrentAudio;
    var _ns = deps._ns || window.__notesState || null;
    var clearChunkNotesFileState = typeof deps.clearChunkNotesFileState === 'function'
        ? deps.clearChunkNotesFileState
        : function () {
            if (!_ns || typeof _ns !== 'object') return;
            _ns.chunkNotesFileHandle = null;
            _ns.chunkNotesFileHandleAudioKey = '';
            _ns.chunkNotesFileName = '';
        };
    var processChunkData = deps.processChunkData;

    var audioPlayer = deps.audioPlayer;
    var transcriptContainer = deps.transcriptContainer;
    var loadClozeBtn = deps.loadClozeBtn || (typeof document !== 'undefined' ? document.getElementById('btn-load-cloze') : null);
    var markedMap = deps.markedMap;

    // Audio
    audioFileInput.addEventListener('change', function (e) {
        var file = getFirstFileFromEvent(e);
        if (!file) return;
        saveToDB('audio', file);
        applyCurrentAudioMeta({ name: file.name || 'audio', size: file.size || 0, lastModified: file.lastModified || 0, type: file.type || '' });
        clearGeneratedAnnotationIndex();
        clearChunkNotesFileState();
        closeChunkNoteExportDialog();
        saveToDB('audioMeta', state.currentAudioMeta);
        loadChunkNotesForCurrentAudio().then(function () {
            if (state.isChunkMode) renderChunkMode();
        });
        audioPlayer.src = URL.createObjectURL(file);
        markFileLoaded(lblAudio);
        e.target.value = '';
        restoreReaderFocus();
    });

    // Transcript
    transcriptFileInput.addEventListener('change', function (event) {
      var file = getFirstFileFromEvent(event);
      if (!file) return;
      readFileAsText(file, function (rawText) {
        var json, promiseChain;
        try {
            json = validateTranscriptData(JSON.parse(rawText));
            promiseChain = clearPersistedChunkSession().then(function () {
              saveToDB('transcript', json);
              processTranscript(json);
              return switchSentenceNotesDoc(json);
            }).then(function () {
                emitAnnotationDiagnostics('app.import_scope_updated', {
                    scope: getAnnotationGenerationScope(),
                    currentAudioKey: state.currentAudioKey,
                    currentDocId: _ns.currentDocId,
                    derivedDocId: buildCurrentSentenceDocId(json),
                    segmentCount: Array.isArray(json && json.segments) ? json.segments.length : 0
                });
                scheduleGeneratedAnnotationIndexRefresh();
                markFileLoaded(lblTranscript);
                showToast('Transcript loaded', 'success');
            }).catch(function (err) { showError('TRANSCRIPT_PARSE', err && err.message ? err.message : 'Invalid transcript JSON'); })
            .then(function () { event.target.value = ''; restoreReaderFocus(); });
        } catch(err) { showError('TRANSCRIPT_PARSE', err && err.message ? err.message : 'Invalid transcript JSON'); event.target.value = ''; restoreReaderFocus(); }
      });
    });

    function processTranscript(json) {
          state.segments = json.segments || [];
          state.hasAiChunkData = false;
          state.chunkItems = [];
          resetClozeState();
          state.words = state.segments.reduce(function (acc, s) { return acc.concat(s.words || []); }, []);
          var gIdx = 0;
          state.segments.forEach(function (seg, sIdx) {
            if (seg.words && seg.words.length > 0) {
                 if (!seg.end) seg.end = seg.words[seg.words.length - 1].end;
            }
            if (seg.words) seg.words.forEach(function (w) {
              w.globalIndex = gIdx++;
              w.segIndex = sIdx;
            });
          });
          state.wordStarts = state.words.map(function (w) { return w.start != null ? w.start : 0; });
          markedMap.clear();
          clearGeneratedAnnotationIndex();
          rebuildVocabMatching();
          emitAnnotationDiagnostics('app.process_transcript', {
              scope: getAnnotationGenerationScope(),
              currentAudioKey: state.currentAudioKey,
              currentDocId: _ns.currentDocId,
              derivedDocId: buildCurrentSentenceDocId(json),
              segmentCount: state.segments.length,
              wordCount: state.words.length
          });
           if (!state.isChunkMode) renderTranscript();
           syncAnnotationGenerationEntryStatus();
           bridgeToPinia();
           if (state.chunkItems.length > 0) {
           }
    }

    // Chunk File
    chunkFileInput.addEventListener('change', function (event) {
        var file = getFirstFileFromEvent(event);
        if (!file) return;
        readFileAsText(file, function (rawText) {
            try {
                var data = validateChunkData(JSON.parse(rawText));
                state.manualChunkStates = {};
                resetClozeState();
                try {
                    localStorage.removeItem('manualChunkStates');
                } catch (e) {}
                saveToDB('chunkData', data);
                processChunkData(data);
                showToast('AI chunk data loaded', 'success');
            } catch (err) { showError('CHUNK_PARSE', err && err.message ? err.message : 'Invalid chunk JSON'); }
            finally { event.target.value = ''; restoreReaderFocus(); }
        });
    });

    function resetClozeState() {
        state.clozeItems.length = 0;
        state.clozeAnswerState.length = 0;
        state.hasClozeData = false;
        window.__hasClozeData = false;
        if (loadClozeBtn) {
            loadClozeBtn.classList.remove('active');
        }
    }

    // Cloze State (exposed for Vue Phase 4)
    window.__clozeItems = state.clozeItems;
    window.__clozeAnswerState = state.clozeAnswerState;
    window.__hasClozeData = state.hasClozeData;

    function setClozeData(items) {
        state.clozeItems = Array.isArray(items) ? items : [];
        state.hasClozeData = state.clozeItems.length > 0;
        state.clozeAnswerState = createClozeAnswerState(state.clozeItems);
        window.__clozeItems = state.clozeItems;
        window.__clozeAnswerState = state.clozeAnswerState;
        window.__hasClozeData = state.hasClozeData;
        if (loadClozeBtn) {
            loadClozeBtn.classList.toggle('active', state.hasClozeData);
        }
        bridgeToPinia();
    }

    function buildClozeQuizMarkup() {
        if (window.__USE_VUE_RENDERING) return '';
        if (!state.hasClozeData || !state.clozeItems.length) return '';
        var quizVm = window.buildClozeQuizViewModel(state.clozeItems, state.clozeAnswerState);
        var cards = quizVm.cards.map(function (card) {
            var resultHtml = card.resultKind === 'hint'
                ? '<div class="cloze-result-hint">填写后点击“检查答案”。</div>'
                : card.resultKind === 'ok'
                    ? '<div class="cloze-result-ok">回答正确。标准答案：<strong>' + window.escapeHtml(card.targetWord) + '</strong></div>' + (card.reasoning ? '<div class="cloze-result-reason">' + window.escapeHtml(card.reasoning) + '</div>' : '')
                    : '<div class="cloze-result-error">不匹配。标准答案：<strong>' + window.escapeHtml(card.targetWord) + '</strong></div>' + (card.reasoning ? '<div class="cloze-result-reason">' + window.escapeHtml(card.reasoning) + '</div>' : '');
            var metaHtml = card.wordType ? '<div class="cloze-meta">' + window.escapeHtml(card.wordType) + '</div>' : '';
            return '\n                <section class="cloze-card ' + card.statusClass + '" data-cloze-card="' + card.index + '">\n                    <div class="cloze-card-head">\n                        <span class="cloze-index">' + card.indexLabel + '</span>\n                        ' + metaHtml + '\n                    </div>\n                    <div class="cloze-sentence">' + window.escapeHtml(card.clozeSentence) + '</div>\n                    <div class="cloze-answer-row">\n                        <input type="text" class="cloze-answer-input" data-cloze-input="' + card.index + '" value="' + window.escapeHtml(card.userAnswer) + '" placeholder="输入答案">\n                        <button type="button" class="small-btn cloze-check-btn" data-cloze-check="' + card.index + '">检查答案</button>\n                    </div>\n                    ' + resultHtml + '\n                </section>\n            ';
        }).join('');

        return '\n            <section class="cloze-quiz-section" id="cloze-quiz-section">\n                <div class="cloze-quiz-header">\n                    <h3>文章填空</h3>\n                    <p>AI 切分内容读完后，可以直接在这里做题。无论回答对错，都会显示标准答案和解释。</p>\n                </div>\n                <div class="cloze-quiz-list">' + cards + '</div>\n            </section>\n        ';
    }

    function handleClozeCheck(index) {
        var item = state.clozeItems[index];
        if (!item) return;
        var input = document.querySelector('[data-cloze-input="' + index + '"]');
        var userAnswer = input ? input.value : '';
        var result = checkClozeAnswerState({
            items: state.clozeItems,
            answerState: state.clozeAnswerState,
            index: index,
            userAnswer: userAnswer
        });
        if (!result) return;
        state.clozeAnswerState = result.answerState;
        window.__clozeAnswerState = state.clozeAnswerState;
        bridgeToPinia();
        if (!window.__USE_VUE_RENDERING) {
            renderChunkMode();
            var nextInput = transcriptContainer.querySelector('[data-cloze-input="' + index + '"]');
            if (nextInput) {
                nextInput.focus();
                nextInput.setSelectionRange(nextInput.value.length, nextInput.value.length);
            }
        }
    }

    // Expose for Vue Phase 4
    window.__clozeCheck = handleClozeCheck;
    window.__buildClozeQuizMarkup = buildClozeQuizMarkup;

    if (clozeFileInput) {
        clozeFileInput.addEventListener('change', function (event) {
            var file = getFirstFileFromEvent(event);
            if (!file) return;
            readFileAsText(file, function (rawText) {
                try {
                    var data = validateClozeData(JSON.parse(rawText));
                    setClozeData(data);
                    if (state.isChunkMode) renderChunkMode();
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

    window.processTranscript = processTranscript;

    return {
        processTranscript: processTranscript,
        setClozeData: setClozeData,
        resetClozeState: resetClozeState,
        buildClozeQuizMarkup: buildClozeQuizMarkup,
        handleClozeCheck: handleClozeCheck
    };
  }

  window.__importModule = {
    initChunkPipeline: initChunkPipeline,
    initImportHandlers: initImportHandlers
  };
