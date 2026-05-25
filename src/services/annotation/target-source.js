'use strict';

export function buildTargetSource(context = {}) {
    const blocks = Array.isArray(context.blocks) ? context.blocks : [];
    const marks = Array.isArray(context.marks) ? context.marks : [];
    const marksByIndex = new Map();

    marks.forEach((mark) => {
        const normalized = normalizeMark(mark);
        if (!normalized) return;
        marksByIndex.set(normalized.globalIndex, normalized);
    });

    const targets = [];
    const bySentenceKey = new Map();

    blocks.forEach((block, sentenceIndex) => {
        const blockContext = buildBlockContext(block, sentenceIndex);
        const sentenceId = blockContext.sentenceId;
        const sentenceTargets = dedupeTargets([
            ...extractRawMarkupTargets(blockContext, sentenceIndex, sentenceId),
            ...extractMarkedTargets(blockContext, sentenceIndex, sentenceId, marksByIndex)
        ]);

        const enrichedTargets = sentenceTargets.map((target, index) => enrichTarget(target, blockContext, index));
        bySentenceKey.set(buildSentenceKey(sentenceIndex, sentenceId), enrichedTargets);
        enrichedTargets.forEach((target) => targets.push(target));
    });

    return {
        targets,
        bySentenceKey
    };
}

export function getTargetsForSentence(targetSource, sentenceIndex, sentenceId) {
    if (!targetSource || !(targetSource.bySentenceKey instanceof Map)) return [];
    const targets = targetSource.bySentenceKey.get(buildSentenceKey(sentenceIndex, sentenceId));
    return Array.isArray(targets) ? targets.map(cloneTarget) : [];
}

export function countTargetsFromContext(context = {}) {
    return buildTargetSource(context).targets.length;
}

export function extractRawMarkupTargets(blockContext, sentenceIndex, sentenceId) {
    const text = blockContext.text;
    if (!text) return [];

    const targets = [];
    const pattern = /\*\*([^*]+(?:\*(?!\*)[^*]+)*)\*\*/g;
    let match;

    while ((match = pattern.exec(text)) !== null) {
        const markedText = normalizeWhitespace(match[1]);
        if (!markedText) continue;
        targets.push({
            id: `raw-${sentenceId}-${match.index}-${match.index + match[0].length}`,
            sourceType: 'raw-markup',
            markedText,
            boundaryHint: markedText,
            sentenceIndex,
            sentenceId,
            localOrder: targets.length,
            rawStartOffset: match.index,
            rawEndOffset: match.index + match[0].length,
            searchHintCharStart: stripBoldMarkers(text.slice(0, match.index)).length,
            metadata: {
                raw: match[0]
            }
        });
    }

    return targets;
}

export function extractMarkedTargets(blockContext, sentenceIndex, sentenceId, marksByIndex) {
    const words = Array.isArray(blockContext.words) ? blockContext.words : [];
    const groups = [];
    let currentGroup = [];

    words.forEach((word) => {
        const globalIndex = Number(word && word.globalIndex);
        if (!Number.isInteger(globalIndex) || !marksByIndex.has(globalIndex)) {
            if (currentGroup.length) groups.push(currentGroup.slice());
            currentGroup = [];
            return;
        }
        currentGroup.push({
            word,
            mark: marksByIndex.get(globalIndex)
        });
    });

    if (currentGroup.length) groups.push(currentGroup.slice());

    return groups
        .map((group, index) => buildMarkedGroupTarget(group, sentenceIndex, sentenceId, index))
        .filter(Boolean);
}

function buildMarkedGroupTarget(group, sentenceIndex, sentenceId, index) {
    if (!Array.isArray(group) || !group.length) return null;
    const first = group[0];
    const last = group[group.length - 1];
    const markedText = normalizeWhitespace(group.map((entry) => getWordText(entry.word)).filter(Boolean).join(' '));
    if (!markedText) return null;

    const globalStart = toInteger(first && first.word && first.word.globalIndex);
    const globalEnd = toInteger(last && last.word && last.word.globalIndex);
    const sourceType = inferMarkSourceType(first && first.mark);

    return {
        id: `${sourceType}-${sentenceId}-${globalStart != null ? globalStart : index}-${globalEnd != null ? globalEnd : index}`,
        sourceType,
        markedText,
        boundaryHint: markedText,
        sentenceIndex,
        sentenceId,
        localOrder: index,
        occurrenceGlobalStart: globalStart,
        occurrenceGlobalEnd: globalEnd,
        metadata: {
            globalStart,
            globalEnd
        }
    };
}

function buildBlockContext(block, sentenceIndex) {
    const text = normalizeWhitespace(block && block.text);
    const plainText = stripBoldMarkers(text);
    const words = Array.isArray(block && block.words) ? block.words : [];
    return {
        text,
        plainText,
        words,
        sentenceIndex,
        sentenceId: String((block && block.id) || sentenceIndex),
        sentenceSpans: splitSentenceSpans(plainText)
    };
}

function enrichTarget(target, blockContext, sentenceTargetIndex) {
    const sentenceText = normalizeWhitespace(findContainingSentenceText(blockContext, target));
    const occurrence = deriveOccurrence(target, blockContext);
    const occurrenceGlobalStart = toInteger(occurrence.globalStart);
    const occurrenceGlobalEnd = toInteger(occurrence.globalEnd);
    const occurrenceKey = buildOccurrenceKey({
        sourceType: target.sourceType,
        sentenceId: target.sentenceId,
        sentenceIndex: target.sentenceIndex,
        globalStart: occurrenceGlobalStart,
        globalEnd: occurrenceGlobalEnd,
        charStart: occurrence.charStart,
        charEnd: occurrence.charEnd,
        localOrder: target.localOrder
    });

    return {
        ...target,
        boundary: normalizeWhitespace(target.boundaryHint || target.markedText),
        sentenceTargetIndex,
        sentenceText,
        sentencePlainText: sentenceText,
        occurrenceKey,
        occurrenceGlobalStart,
        occurrenceGlobalEnd,
        occurrenceCharStart: toInteger(occurrence.charStart),
        occurrenceCharEnd: toInteger(occurrence.charEnd)
    };
}

function deriveOccurrence(target, blockContext) {
    const directStart = toInteger(target.occurrenceGlobalStart);
    const directEnd = toInteger(target.occurrenceGlobalEnd);
    if (directStart != null && directEnd != null) {
        return {
            globalStart: directStart,
            globalEnd: directEnd,
            charStart: null,
            charEnd: null
        };
    }

    const match = findWordRangeForText(
        blockContext.words,
        target.boundaryHint || target.markedText,
        {
            fromGlobalIndex: 0
        }
    );

    if (match) {
        return {
            globalStart: match.globalStart,
            globalEnd: match.globalEnd,
            charStart: null,
            charEnd: null
        };
    }

    const occurrence = findCharOccurrence(
        blockContext.plainText,
        target.boundaryHint || target.markedText,
        target.searchHintCharStart
    );

    return {
        globalStart: null,
        globalEnd: null,
        charStart: occurrence.start,
        charEnd: occurrence.end
    };
}

function findContainingSentenceText(blockContext, target) {
    const occurrence = findCharOccurrence(
        blockContext.plainText,
        target.boundaryHint || target.markedText,
        target.searchHintCharStart
    );
    const spans = Array.isArray(blockContext.sentenceSpans) ? blockContext.sentenceSpans : [];
    const span = spans.find((item) => occurrence.start >= item.start && occurrence.end <= item.end) || spans[0];
    return span && span.text ? span.text : blockContext.plainText;
}

function findWordRangeForText(words, text, options = {}) {
    const targetTokens = tokenizeText(text);
    if (!targetTokens.length || !Array.isArray(words) || !words.length) return null;

    const fromGlobalIndex = toInteger(options.fromGlobalIndex);
    for (let start = 0; start < words.length; start++) {
        const startGlobalIndex = toInteger(words[start] && words[start].globalIndex);
        if (fromGlobalIndex != null && startGlobalIndex != null && startGlobalIndex < fromGlobalIndex) continue;

        let tokenCursor = 0;
        let end = start - 1;
        for (let index = start; index < words.length && tokenCursor < targetTokens.length; index++) {
            const wordTokens = tokenizeText(getWordText(words[index]));
            if (!wordTokens.length) {
                end = index;
                continue;
            }
            let allMatched = true;
            for (let tokenIndex = 0; tokenIndex < wordTokens.length; tokenIndex++) {
                if (targetTokens[tokenCursor] !== wordTokens[tokenIndex]) {
                    allMatched = false;
                    break;
                }
                tokenCursor += 1;
            }
            if (!allMatched) break;
            end = index;
            if (tokenCursor === targetTokens.length) {
                return {
                    globalStart: toInteger(words[start] && words[start].globalIndex),
                    globalEnd: toInteger(words[end] && words[end].globalIndex)
                };
            }
        }
    }

    return null;
}

function findCharOccurrence(plainText, searchText, hintStart) {
    const source = String(plainText || '');
    const needle = normalizeWhitespace(searchText);
    if (!source || !needle) {
        return { start: 0, end: 0 };
    }

    const lowerSource = source.toLowerCase();
    const lowerNeedle = needle.toLowerCase();
    const occurrences = [];
    let cursor = 0;

    while (cursor < lowerSource.length) {
        const next = lowerSource.indexOf(lowerNeedle, cursor);
        if (next < 0) break;
        occurrences.push(next);
        cursor = next + Math.max(1, lowerNeedle.length);
    }

    if (!occurrences.length) {
        return { start: 0, end: 0 };
    }

    let chosen = occurrences[0];
    const numericHint = Number(hintStart);
    if (Number.isFinite(numericHint)) {
        chosen = occurrences.reduce((best, current) => (
            Math.abs(current - numericHint) < Math.abs(best - numericHint) ? current : best
        ), occurrences[0]);
    }

    return {
        start: chosen,
        end: chosen + lowerNeedle.length
    };
}

function normalizeMark(mark) {
    const globalIndex = toInteger(mark && mark.globalIndex);
    if (globalIndex == null || globalIndex < 0) return null;
    return {
        ...mark,
        globalIndex,
        sourceType: inferMarkSourceType(mark)
    };
}

function inferMarkSourceType(mark) {
    const sourceType = String(mark && (mark.sourceType || mark.source || '') || '').trim();
    if (sourceType === 'marks-json') return 'marks-json';
    if (sourceType === 'manual-mark') return 'manual-mark';
    return 'manual-mark';
}

function dedupeTargets(targets) {
    const byKey = new Map();
    targets.forEach((target) => {
        const key = [
            Number(target.sentenceIndex),
            normalizeWhitespace(target.markedText).toLowerCase(),
            toInteger(target.occurrenceGlobalStart) != null ? toInteger(target.occurrenceGlobalStart) : normalizeWhitespace(target.id)
        ].join('::');
        if (!byKey.has(key)) byKey.set(key, target);
    });
    return Array.from(byKey.values()).map(cloneTarget);
}

function cloneTarget(target) {
    return {
        ...target,
        metadata: target && target.metadata ? { ...target.metadata } : {}
    };
}

function buildSentenceKey(sentenceIndex, sentenceId) {
    return `${Number(sentenceIndex)}::${String(sentenceId || '')}`;
}

function buildOccurrenceKey(parts = {}) {
    const start = toInteger(parts.globalStart);
    const end = toInteger(parts.globalEnd);
    if (start != null && end != null) {
        return `${String(parts.sourceType || 'target')}::${String(parts.sentenceId || '')}::g:${start}-${end}`;
    }
    return `${String(parts.sourceType || 'target')}::${String(parts.sentenceId || '')}::c:${toInteger(parts.charStart) || 0}-${toInteger(parts.charEnd) || 0}::${toInteger(parts.localOrder) || 0}`;
}

function splitSentenceSpans(text) {
    const source = String(text || '');
    const spans = [];
    const closingMarks = new Set(['"', '\'', ')', ']', '}', '”', '’', '」', '』', '】', '》']);
    let start = 0;

    for (let index = 0; index < source.length; index++) {
        const ch = source[index];
        if (!/[.!?;。！？；]/.test(ch || '')) continue;
        let end = index + 1;
        while (end < source.length && closingMarks.has(source[end])) end += 1;
        const textSlice = normalizeWhitespace(source.slice(start, end));
        if (textSlice) spans.push({ text: textSlice, start, end });
        start = end;
        while (start < source.length && /\s/.test(source[start])) start += 1;
    }

    const tail = normalizeWhitespace(source.slice(start));
    if (tail) spans.push({ text: tail, start, end: source.length });
    if (!spans.length && source.trim()) spans.push({ text: normalizeWhitespace(source), start: 0, end: source.length });
    return spans;
}

function stripBoldMarkers(text) {
    return String(text || '').replace(/\*\*([^*]+(?:\*(?!\*)[^*]+)*)\*\*/g, '$1');
}

function tokenizeText(text) {
    return String(text || '')
        .toLowerCase()
        .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, ' ')
        .trim()
        .split(/\s+/)
        .filter(Boolean);
}

function normalizeWhitespace(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function getWordText(word) {
    return normalizeWhitespace(word && (word.word || word.text || ''));
}

function toInteger(value) {
    const number = Number(value);
    return Number.isInteger(number) ? number : null;
}
