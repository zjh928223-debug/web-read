(function (global) {
    'use strict';

    const MATCH_PRIORITY = {
        BOUNDARY_EXACT: 3,
        BOUNDARY_CONTAINS_CLICKED_WORD: 2,
        MARKED_TEXT_EXACT: 1
    };

    function isAnnotationDebugEnabled() {
        try {
            if (global.ANNOTATION_DEBUG === true) return true;
            const stored = global.localStorage && global.localStorage.getItem('annotation.debug');
            return stored === '1' || stored === 'true';
        } catch (error) {
            return global.ANNOTATION_DEBUG === true;
        }
    }

    function emitAnnotationDebug(step, payload) {
        if (!isAnnotationDebugEnabled()) return;
        try {
            console.debug(`[annotation-debug] ${step}`, payload || {});
        } catch (error) {}
    }

    function resolveClick(options = {}) {
        const store = options.generatedStore || global.AnnotationGeneratedResultStore;
        if (!store || typeof store.query !== 'function') return null;

        const wordIndex = Number(options.wordIndex);
        const words = Array.isArray(options.words) ? options.words : [];
        const span = options.span || null;
        const clickedText = getClickedText(span, words[wordIndex]);
        const clickedTokens = normalizeToTokens(clickedText);
        if (!clickedTokens.length) return null;

        const wordWindow = buildWordWindow(words, wordIndex, 8);
        const occurrenceCandidates = typeof store.queryByOccurrence === 'function'
            ? store.queryByOccurrence({
                occurrenceKey: getOccurrenceKeyFromWord(words[wordIndex]),
                wordIndex
            })
            : [];
        emitAnnotationDebug('click.resolve_start', {
            wordIndex,
            clickedText,
            clickedTokens,
            wordOccurrenceKey: getOccurrenceKeyFromWord(words[wordIndex]),
            occurrenceCandidateCount: occurrenceCandidates.length
        });
        const exact = chooseBestCandidate(occurrenceCandidates, clickedTokens, wordWindow);
        if (exact) {
            const hit = normalizeGeneratedAnnotationHit(exact.item);
            emitAnnotationDebug('click.resolve_hit', {
                source: 'occurrence',
                wordIndex,
                targetId: hit && hit.targetId || '',
                occurrenceKey: hit && hit.occurrenceKey || '',
                hasMeaning: !!(hit && String(hit.meaning || '').trim()),
                hasMemoryHint: !!(hit && String(hit.memoryHint || '').trim())
            });
            return hit;
        }
        if (occurrenceCandidates.length > 1) {
            emitAnnotationDebug('click.resolve_miss', {
                source: 'occurrence',
                reason: 'ambiguous-occurrence-candidates',
                wordIndex,
                clickedText,
                occurrenceCandidateCount: occurrenceCandidates.length
            });
            return null;
        }
        emitAnnotationDebug('click.resolve_miss', {
            source: 'occurrence',
            reason: 'no-precise-occurrence-hit',
            wordIndex,
            clickedText,
            occurrenceCandidateCount: occurrenceCandidates.length
        });
        return null;
    }

    function chooseBestCandidate(candidates, clickedTokens, wordWindow) {
        let bestPriority = 0;
        let bestMatches = [];

        candidates.forEach((item) => {
            const priority = scoreCandidate(item, clickedTokens, wordWindow);
            if (priority <= 0) return;
            if (priority > bestPriority) {
                bestPriority = priority;
                bestMatches = [item];
            } else if (priority === bestPriority && !bestMatches.some(match => match.id === item.id)) {
                bestMatches.push(item);
            }
        });

        if (bestMatches.length !== 1) return null;
        return { item: bestMatches[0], priority: bestPriority };
    }

    function scoreCandidate(item, clickedTokens, wordWindow) {
        const markedTokens = Array.isArray(item.markedTokens) ? item.markedTokens : normalizeToTokens(item.markedText);
        const boundaryTokens = Array.isArray(item.boundaryTokens) ? item.boundaryTokens : normalizeToTokens(item.boundary);
        const windowTokens = wordWindow.tokens;

        if (boundaryTokens.length && containsPhraseAtClickedWord(windowTokens, wordWindow.clickedOffset, boundaryTokens)) {
            return MATCH_PRIORITY.BOUNDARY_EXACT;
        }

        if (boundaryTokens.length && clickedTokens.some(token => boundaryTokens.includes(token))) {
            return MATCH_PRIORITY.BOUNDARY_CONTAINS_CLICKED_WORD;
        }

        if (markedTokens.length && tokensEqual(markedTokens, clickedTokens)) {
            return MATCH_PRIORITY.MARKED_TEXT_EXACT;
        }

        return 0;
    }

    function normalizeGeneratedAnnotationHit(item) {
        if (!item || typeof item !== 'object') return null;
        return {
            id: item.id,
            targetId: item.targetId,
            blockId: item.blockId,
            markedText: item.markedText,
            boundary: item.boundary || item.markedText,
            type: item.type,
            meaning: item.meaning,
            memoryHint: item.memoryHint,
            provider: item.provider,
            source: item.source || item.provider,
            occurrenceKey: item.occurrenceKey,
            occurrenceGlobalStart: item.occurrenceGlobalStart,
            occurrenceGlobalEnd: item.occurrenceGlobalEnd
        };
    }

    function buildWordWindow(words, wordIndex, radius) {
        if (!Number.isFinite(wordIndex) || wordIndex < 0 || !words.length) {
            return { tokens: [], clickedOffset: -1 };
        }
        const start = Math.max(0, wordIndex - radius);
        const end = Math.min(words.length - 1, wordIndex + radius);
        const tokens = [];
        let clickedOffset = -1;
        for (let idx = start; idx <= end; idx++) {
            const wordTokens = normalizeToTokens(getWordText(words[idx]));
            if (idx === wordIndex) clickedOffset = tokens.length;
            tokens.push(...wordTokens);
        }
        return { tokens, clickedOffset };
    }

    function containsPhraseAtClickedWord(windowTokens, clickedOffset, phraseTokens) {
        if (clickedOffset < 0 || !phraseTokens.length || phraseTokens.length > windowTokens.length) return false;
        for (let start = 0; start <= windowTokens.length - phraseTokens.length; start++) {
            if (clickedOffset < start || clickedOffset >= start + phraseTokens.length) continue;
            let same = true;
            for (let i = 0; i < phraseTokens.length; i++) {
                if (windowTokens[start + i] !== phraseTokens[i]) {
                    same = false;
                    break;
                }
            }
            if (same) return true;
        }
        return false;
    }

    function getClickedText(span, word) {
        return ((span && span.textContent) || getWordText(word)).replace(/\s+/g, ' ').trim();
    }

    function getWordText(word) {
        return String((word && (word.word || word.text)) || '');
    }

    function getOccurrenceKeyFromWord(word) {
        if (!word || typeof word !== 'object') return '';
        return String(
            word.annotationOccurrenceKey
            || word.annotation_occurrence_key
            || word.occurrenceKey
            || ''
        ).trim();
    }

    function tokensEqual(a, b) {
        if (a.length !== b.length) return false;
        return a.every((token, index) => token === b[index]);
    }

    function normalizeToTokens(text) {
        if (global.AnnotationGeneratedResultStore && typeof global.AnnotationGeneratedResultStore.normalizeToTokens === 'function') {
            return global.AnnotationGeneratedResultStore.normalizeToTokens(text);
        }
        return String(text || '')
            .toLowerCase()
            .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, ' ')
            .trim()
            .split(/\s+/)
            .filter(Boolean);
    }

    global.AnnotationClickResolver = {
        resolveClick,
        normalizeGeneratedAnnotationHit
    };
})(window);
