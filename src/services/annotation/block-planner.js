'use strict';

import * as TargetSource from './target-source.js';

const DEFAULT_OPTIONS = {
    softMinWords: 520,
    softMaxWords: 760,
    softMinTargets: 16,
    softMaxTargets: 24,
    hardMaxWords: 920,
    hardMaxTargets: 30,
    singleRequestMaxWords: 920,
    singleRequestMaxTargets: 30,
    preferredMaxBlocks: 3,
    contextSentenceCount: 1
};

export { DEFAULT_OPTIONS };

export function planFromContext(context, options = {}) {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    const targetSource = TargetSource && typeof TargetSource.buildTargetSource === 'function'
        ? TargetSource.buildTargetSource(context)
        : { targets: [], bySentenceKey: new Map() };
    const filteredTargetSource = filterTargetSource(targetSource, opts.targetFilterKeys);
    const sentences = normalizeSentencesFromContext(context, filteredTargetSource);
    const initialBlocks = buildBlocks(sentences, opts);
    const blocks = rebalanceBlocks(initialBlocks, sentences, opts);
    return {
        documentId: context && context.documentId ? String(context.documentId) : 'default-document',
        audioKey: context && context.audioKey ? String(context.audioKey) : 'default-audio',
        sourceMode: context && context.sourceMode ? String(context.sourceMode) : 'transcript',
        sentences,
        blocks,
        totalBlocks: blocks.length,
        targetCount: Array.isArray(filteredTargetSource.targets)
            ? filteredTargetSource.targets.length
            : blocks.reduce((sum, block) => sum + block.targets.length, 0),
        options: opts
    };
}

export function normalizeSentencesFromContext(context, targetSource = null) {
    const blocks = context && Array.isArray(context.blocks) ? context.blocks : [];
    const sentences = [];
    blocks.forEach((block, index) => {
        const text = normalizeWhitespace(block && block.text);
        if (!text) return;
        const sentenceId = String((block && block.id) || index);
        sentences.push({
            sentenceIndex: sentences.length,
            sourceIndex: Number.isFinite(Number(block.index)) ? Number(block.index) : index,
            id: sentenceId,
            type: String((block && block.type) || 'segment'),
            start: nullableNumber(block && block.start),
            end: nullableNumber(block && block.end),
            text,
            plainText: stripBoldMarkers(text),
            wordCount: countWords(stripBoldMarkers(text)),
            words: Array.isArray(block && block.words) ? block.words : [],
            targets: getSentenceTargets(targetSource, sentences.length, sentenceId)
        });
    });
    return sentences;
}

export function stripBoldMarkers(text) {
    return String(text || '').replace(/\*\*([^*]+(?:\*(?!\*)[^*]+)*)\*\*/g, '$1');
}

export function countWords(text) {
    const matches = String(text || '').trim().match(/[\p{L}\p{N}'-]+/gu);
    return matches ? matches.length : 0;
}

function filterTargetSource(targetSource, targetFilterKeys) {
    const filterSet = normalizeTargetFilterKeys(targetFilterKeys);
    if (!filterSet) return targetSource;

    const nextTargets = Array.isArray(targetSource && targetSource.targets)
        ? targetSource.targets.filter((target) => filterSet.has(String(target && target.occurrenceKey || '')))
        : [];
    const nextBySentenceKey = new Map();
    if (targetSource && targetSource.bySentenceKey instanceof Map) {
        targetSource.bySentenceKey.forEach((sentenceTargets, sentenceKey) => {
            const filteredTargets = Array.isArray(sentenceTargets)
                ? sentenceTargets.filter((target) => filterSet.has(String(target && target.occurrenceKey || '')))
                : [];
            nextBySentenceKey.set(sentenceKey, filteredTargets);
        });
    }

    return {
        targets: nextTargets,
        bySentenceKey: nextBySentenceKey
    };
}

function normalizeTargetFilterKeys(targetFilterKeys) {
    if (!Array.isArray(targetFilterKeys) || !targetFilterKeys.length) return null;
    const filterSet = new Set(
        targetFilterKeys
            .map((value) => String(value || '').trim())
            .filter(Boolean)
    );
    return filterSet.size ? filterSet : null;
}

function buildBlocks(sentences, opts) {
    const blocks = [];
    let i = 0;
    while (i < sentences.length) {
        while (i < sentences.length && !(Array.isArray(sentences[i].targets) && sentences[i].targets.length)) {
            i += 1;
        }
        if (i >= sentences.length) break;
        const start = i;
        let end = i;
        let wordCount = 0;
        let targetCount = 0;

        while (end < sentences.length) {
            const sentence = sentences[end];
            const nextWordCount = wordCount + sentence.wordCount;
            const nextTargetCount = targetCount + sentence.targets.length;
            const hasCurrent = end > start;
            const exceedsHard =
                nextWordCount > opts.hardMaxWords ||
                nextTargetCount > opts.hardMaxTargets;

            if (hasCurrent && exceedsHard) break;

            wordCount = nextWordCount;
            targetCount = nextTargetCount;
            end += 1;

            const reachedSoftWords = wordCount >= opts.softMinWords;
            const reachedSoftTargets = targetCount >= opts.softMinTargets;
            const insideSoftWords = wordCount >= opts.softMinWords && wordCount <= opts.softMaxWords;
            const insideSoftTargets = targetCount >= opts.softMinTargets && targetCount <= opts.softMaxTargets;
            const nextSentence = sentences[end];
            const nextWouldExceedSoft =
                nextSentence &&
                (wordCount + nextSentence.wordCount > opts.softMaxWords ||
                 targetCount + nextSentence.targets.length > opts.softMaxTargets);

            if ((insideSoftWords && (targetCount === 0 || targetCount <= opts.softMaxTargets)) ||
                (insideSoftTargets && reachedSoftWords) ||
                ((reachedSoftWords || reachedSoftTargets) && nextWouldExceedSoft)) {
                break;
            }
        }

        const mainSentences = sentences.slice(start, end);
        blocks.push(createBlock(blocks.length, mainSentences, sentences, start, end - 1, opts));
        i = Math.max(end, start + 1);
    }
    return blocks;
}

function rebalanceBlocks(blocks, sentences, opts) {
    const list = Array.isArray(blocks) ? blocks.filter(Boolean) : [];
    if (!list.length) return [];
    if (list.length === 1) return list;

    const totalWordCount = list.reduce((sum, block) => sum + toNumber(block && block.wordCount), 0);
    const totalTargetCount = list.reduce((sum, block) => sum + toNumber(block && block.targetCount), 0);
    const preferredMaxBlocks = Math.max(1, toInteger(opts && opts.preferredMaxBlocks, 3));
    const desiredBlockCount = Math.max(1, Math.min(
        preferredMaxBlocks,
        Math.ceil(Math.max(
            totalWordCount / Math.max(1, toNumber(opts && opts.singleRequestMaxWords)),
            totalTargetCount / Math.max(1, toNumber(opts && opts.singleRequestMaxTargets))
        ))
    ));

    if (
        totalWordCount <= toNumber(opts && opts.singleRequestMaxWords) &&
        totalTargetCount <= toNumber(opts && opts.singleRequestMaxTargets)
    ) {
        return [mergeBlockGroup(list, sentences, 0, opts)];
    }

    if (list.length <= desiredBlockCount) return list;

    const merged = [];
    const targetsPerGroup = Math.max(1, Math.ceil(totalTargetCount / desiredBlockCount));
    const wordsPerGroup = Math.max(1, Math.ceil(totalWordCount / desiredBlockCount));
    let start = 0;

    for (let groupIndex = 0; groupIndex < desiredBlockCount && start < list.length; groupIndex++) {
        const groupsLeft = desiredBlockCount - groupIndex;
        if (groupsLeft <= 1) {
            merged.push(mergeBlockGroup(list.slice(start), sentences, merged.length, opts));
            start = list.length;
            break;
        }

        let end = start;
        let groupedTargets = 0;
        let groupedWords = 0;
        while (end < list.length) {
            const candidate = list[end];
            groupedTargets += toNumber(candidate && candidate.targetCount);
            groupedWords += toNumber(candidate && candidate.wordCount);
            end += 1;

            const enoughForGroup = groupedTargets >= targetsPerGroup || groupedWords >= wordsPerGroup;
            const enoughRemaining = (list.length - end) >= (groupsLeft - 1);
            if (enoughForGroup && enoughRemaining) break;
        }

        merged.push(mergeBlockGroup(list.slice(start, end), sentences, merged.length, opts));
        start = end;
    }

    return merged.length ? merged : list;
}

function mergeBlockGroup(group, sentences, blockIndex, opts) {
    const list = Array.isArray(group) ? group.filter(Boolean) : [];
    if (!list.length) return null;
    const startIndex = list[0].startSentenceIndex;
    const endIndex = list[list.length - 1].endSentenceIndex;
    const mainSentences = sentences.slice(startIndex, endIndex + 1);
    return createBlock(blockIndex, mainSentences, sentences, startIndex, endIndex, opts);
}

function createBlock(blockIndex, mainSentences, allSentences, startIndex, endIndex, opts) {
    const blockId = `block-${String(blockIndex).padStart(4, '0')}`;
    const wordCount = mainSentences.reduce((sum, sentence) => sum + sentence.wordCount, 0);
    const targets = [];
    mainSentences.forEach((sentence) => {
        sentence.targets.forEach((target) => {
            targets.push({
                ...target,
                id: `${blockId}-target-${String(targets.length).padStart(4, '0')}`,
                blockId,
                blockTargetIndex: targets.length,
                boundaryHint: String(target.boundaryHint || target.boundary || target.markedText || '').trim(),
                sentenceText: String(target.sentenceText || sentence.plainText || sentence.text || '').trim(),
                sentencePlainText: String(target.sentencePlainText || target.sentenceText || sentence.plainText || sentence.text || '').trim(),
                occurrenceKey: String(target.occurrenceKey || ''),
                occurrenceGlobalStart: Number.isInteger(Number(target.occurrenceGlobalStart))
                    ? Number(target.occurrenceGlobalStart)
                    : null,
                occurrenceGlobalEnd: Number.isInteger(Number(target.occurrenceGlobalEnd))
                    ? Number(target.occurrenceGlobalEnd)
                    : null,
                occurrenceCharStart: Number.isInteger(Number(target.occurrenceCharStart))
                    ? Number(target.occurrenceCharStart)
                    : null,
                occurrenceCharEnd: Number.isInteger(Number(target.occurrenceCharEnd))
                    ? Number(target.occurrenceCharEnd)
                    : null
            });
        });
    });

    const beforeStart = Math.max(0, startIndex - opts.contextSentenceCount);
    const before = allSentences.slice(beforeStart, startIndex);
    const after = allSentences.slice(endIndex + 1, endIndex + 1 + opts.contextSentenceCount);
    const mainText = mainSentences.map(sentence => sentence.text).join(' ');

    return {
        id: blockId,
        blockIndex,
        startSentenceIndex: startIndex,
        endSentenceIndex: endIndex,
        sentenceIds: mainSentences.map(sentence => sentence.id),
        mainSentences,
        contextBeforeSentences: before,
        contextAfterSentences: after,
        mainText,
        text: mainText,
        mainPlainText: stripBoldMarkers(mainText),
        contextBefore: before.map(sentence => sentence.text).join(' '),
        contextAfter: after.map(sentence => sentence.text).join(' '),
        contextText: [before.map(sentence => sentence.text).join(' '), mainText, after.map(sentence => sentence.text).join(' ')]
            .filter(Boolean)
            .join(' '),
        wordCount,
        targetCount: targets.length,
        targets,
        coverage: {
            startSentenceIndex: startIndex,
            endSentenceIndex: endIndex,
            outputTargetIds: targets.map(target => target.id)
        },
        oversizeSentence: mainSentences.length === 1 &&
            (mainSentences[0].wordCount > opts.hardMaxWords ||
             mainSentences[0].targets.length > opts.hardMaxTargets)
    };
}

function getSentenceTargets(targetSource, sentenceIndex, sentenceId) {
    if (TargetSource && typeof TargetSource.getTargetsForSentence === 'function') {
        return TargetSource.getTargetsForSentence(targetSource, sentenceIndex, sentenceId).map((target, index) => ({
            ...target,
            sentenceTargetIndex: Number.isFinite(Number(target.sentenceTargetIndex))
                ? Number(target.sentenceTargetIndex)
                : index
        }));
    }
    return [];
}

function normalizeWhitespace(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function nullableNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

function toInteger(value, fallback) {
    const next = Number(value);
    return Number.isInteger(next) ? next : fallback;
}

function toNumber(value) {
    const next = Number(value);
    return Number.isFinite(next) ? next : 0;
}

window.AnnotationBlockPlanner = { planFromContext };
