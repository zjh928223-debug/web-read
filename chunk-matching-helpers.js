(function attachChunkMatchingHelpers(global) {
    "use strict";

    function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    function cleanText(value) {
        return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    }

    function tokenizeText(value) {
        return String(value || "")
            .trim()
            .split(/\s+/)
            .map(cleanText)
            .filter(Boolean);
    }

    function findExactMatchRange(wordList, phraseTokens, fromIndex = 0) {
        if (!Array.isArray(wordList) || !wordList.length) return null;
        if (!Array.isArray(phraseTokens) || !phraseTokens.length) return null;
        if (phraseTokens.length > wordList.length) return null;

        const wordTokens = wordList.map((word) => cleanText(word && (word.word || word.text || word)));
        const startAt = clamp(Number.isFinite(fromIndex) ? fromIndex : 0, 0, wordList.length - 1);

        for (let i = startAt; i <= wordTokens.length - phraseTokens.length; i++) {
            if (wordTokens[i] !== phraseTokens[0]) continue;
            let ok = true;
            for (let k = 0; k < phraseTokens.length; k++) {
                if (wordTokens[i + k] !== phraseTokens[k]) {
                    ok = false;
                    break;
                }
            }
            if (ok) return [i, i + phraseTokens.length - 1];
        }

        return null;
    }

    function findExactMatch(wordList, phraseTokens, fromIndex = 0) {
        return findExactMatchRange(wordList, phraseTokens, fromIndex);
    }

    function adjustIndex(baseIdx, targetWord, wordList, searchRange) {
        if (!targetWord || !Array.isArray(wordList) || !wordList.length) return baseIdx;

        const min = 0;
        const max = wordList.length - 1;
        const normalizedBase = clamp(baseIdx, min, max);

        for (const offset of Array.isArray(searchRange) ? searchRange : []) {
            const idx = normalizedBase + offset;
            if (idx < min || idx > max) continue;
            const word = wordList[idx];
            const wordText = cleanText(word && (word.word || word.text || ""));
            if (wordText === targetWord || wordText.startsWith(targetWord) || targetWord.startsWith(wordText)) {
                return idx;
            }
        }

        return normalizedBase;
    }

    function scoreMatchCandidate(firstWord, lastWord, startWord, endWord) {
        return (firstWord && startWord === firstWord ? 1 : 0)
            + (lastWord && endWord === lastWord ? 1 : 0);
    }

    function normalizeChunkCandidateBounds(rawStart, rawEnd) {
        const start = Number.isFinite(rawStart) ? rawStart : 0;
        const end = Number.isFinite(rawEnd) ? rawEnd : start;
        return { start, end };
    }

    function buildChunkCandidateVariants(rawStart, rawEnd) {
        const normalized = normalizeChunkCandidateBounds(rawStart, rawEnd);
        return [
            { s: normalized.start, e: normalized.end },
            { s: normalized.start - 1, e: normalized.end - 1 }
        ];
    }

    function buildChunkMatchWindow(startIndex, endIndex, phraseTokensLength) {
        const estimatedLength = phraseTokensLength > 0
            ? phraseTokensLength
            : Math.max(1, (endIndex - startIndex + 1));
        return {
            estimatedLength,
            minEnd: startIndex + estimatedLength - 1
        };
    }

    function clampChunkMatchCandidate(candidate, segmentLength) {
        const maxIndex = Math.max(0, Number(segmentLength || 0) - 1);
        return {
            startIndex: clamp(candidate && candidate.s, 0, maxIndex),
            endIndex: clamp(candidate && candidate.e, 0, maxIndex)
        };
    }

    function buildChunkCandidateEndWindow(startIndex, endIndex, phraseTokensLength, segmentLength) {
        const { estimatedLength, minEnd } = buildChunkMatchWindow(startIndex, endIndex, phraseTokensLength);
        const maxIndex = Math.max(0, Number(segmentLength || 0) - 1);
        let baseEnd = Math.max(endIndex, startIndex + estimatedLength - 1);
        baseEnd = clamp(baseEnd, 0, maxIndex);
        return {
            estimatedLength,
            minEnd,
            baseEnd
        };
    }

    function getChunkCandidateBoundaryWords(wordList, startIndex, endIndex) {
        return {
            startWord: cleanText(wordList && wordList[startIndex] ? (wordList[startIndex].word || wordList[startIndex].text) : ""),
            endWord: cleanText(wordList && wordList[endIndex] ? (wordList[endIndex].word || wordList[endIndex].text) : "")
        };
    }

    function normalizeChunkMatchCandidate(startIndex, endIndex, score) {
        return {
            st: startIndex,
            ed: endIndex,
            score
        };
    }

    global.ChunkMatchingHelpers = {
        clamp,
        cleanText,
        tokenizeText,
        findExactMatchRange,
        findExactMatch,
        adjustIndex,
        scoreMatchCandidate,
        normalizeChunkCandidateBounds,
        buildChunkCandidateVariants,
        buildChunkMatchWindow,
        clampChunkMatchCandidate,
        buildChunkCandidateEndWindow,
        getChunkCandidateBoundaryWords,
        normalizeChunkMatchCandidate
    };
})(window);
