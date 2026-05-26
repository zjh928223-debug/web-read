'use strict';

let currentScope = null;
let items = [];
let byOccurrenceKey = new Map();
let byWordIndex = new Map();
let byMarkedToken = new Map();
let byBoundaryToken = new Map();

function isAnnotationDebugEnabled() {
    try {
        const global = (typeof window !== 'undefined') ? window : (typeof globalThis !== 'undefined' ? globalThis : {});
        if (global.ANNOTATION_DEBUG === true) return true;
        const stored = global.localStorage && global.localStorage.getItem('annotation.debug');
        return stored === '1' || stored === 'true';
    } catch (error) {
        const global = (typeof window !== 'undefined') ? window : (typeof globalThis !== 'undefined' ? globalThis : {});
        return global.ANNOTATION_DEBUG === true;
    }
}

function emitAnnotationDebug(step, payload) {
    if (!isAnnotationDebugEnabled()) return;
    try {
        console.debug(`[annotation-debug] ${step}`, payload || {});
    } catch (error) {}
}

export function clear() {
    currentScope = null;
    items = [];
    byOccurrenceKey = new Map();
    byWordIndex = new Map();
    byMarkedToken = new Map();
    byBoundaryToken = new Map();
}

export function indexBundle(bundle, scope = {}) {
    currentScope = normalizeScope(scope);
    const rawItems = bundle && Array.isArray(bundle.items) ? bundle.items : [];
    items = normalizeItems(rawItems);
    byOccurrenceKey = buildOccurrenceIndex(items);
    byWordIndex = buildWordIndex(items);
    byMarkedToken = buildTokenIndex(items, 'markedTokens');
    byBoundaryToken = buildTokenIndex(items, 'boundaryTokens');
    emitAnnotationDebug('index.bundle', {
        scope: getScope(),
        inputItemCount: rawItems.length,
        indexedItemCount: items.length,
        occurrenceKeyCount: byOccurrenceKey.size,
        wordIndexCount: byWordIndex.size
    });
    if (rawItems.length && !items.length) {
        console.warn('[AnnotationGeneratedResultStore] indexBundle normalized to empty items', {
            scope: getScope(),
            inputItemCount: rawItems.length
        });
    }
    return {
        scope: getScope(),
        itemCount: items.length
    };
}

export function query(queryInput = {}) {
    const clickedTokens = Array.isArray(queryInput.clickedTokens)
        ? queryInput.clickedTokens
        : normalizeToTokens(queryInput.clickedText);
    const candidateSet = new Set();

    clickedTokens.forEach((token) => {
        (byBoundaryToken.get(token) || []).forEach(item => candidateSet.add(item));
        (byMarkedToken.get(token) || []).forEach(item => candidateSet.add(item));
    });

    return Array.from(candidateSet);
}

export function queryByOccurrence(queryInput = {}) {
    const occurrenceKey = firstText(queryInput, ['occurrenceKey', 'hitKey']);
    if (occurrenceKey && byOccurrenceKey.has(occurrenceKey)) {
        return [...(byOccurrenceKey.get(occurrenceKey) || [])];
    }

    const wordIndex = Number(queryInput.wordIndex);
    if (Number.isInteger(wordIndex) && byWordIndex.has(wordIndex)) {
        return [...(byWordIndex.get(wordIndex) || [])];
    }

    return [];
}

export function getScope() {
    return currentScope ? { ...currentScope } : null;
}

export function getItems() {
    return items.map(item => ({
        ...item,
        markedTokens: [...item.markedTokens],
        boundaryTokens: [...item.boundaryTokens]
    }));
}

export function normalizeToTokens(text) {
    return String(text || '')
        .toLowerCase()
        .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, ' ')
        .trim()
        .split(/\s+/)
        .filter(Boolean);
}

function normalizeItems(rawItems) {
    return rawItems
        .map(normalizeItem)
        .filter(Boolean);
}

function normalizeItem(raw, index) {
    if (!raw || typeof raw !== 'object') return null;

    const markedText = firstText(raw, ['markedText', 'marked_text', 'word', 'text']);
    const boundary = firstText(raw, ['boundary', 'match_context', 'context', 'phrase']);
    const markedTokens = normalizeToTokens(markedText);
    const boundaryTokens = normalizeToTokens(boundary);

    if (!markedTokens.length && !boundaryTokens.length) {
        console.warn('[AnnotationGeneratedResultStore] item dropped during index normalize', {
            index,
            id: String(raw.id || raw.itemId || ''),
            markedText,
            boundary,
            occurrenceKey: firstText(raw, ['occurrenceKey', 'occurrence_key', 'hitKey'])
        });
        return null;
    }

    return {
        id: String(raw.id || raw.itemId || `generated-${index}`),
        targetId: String(raw.targetId || ''),
        blockId: String(raw.blockId || ''),
        markedText,
        boundary,
        type: firstText(raw, ['type', 'category', 'label', 'tag']),
        meaning: firstText(raw, ['meaning', 'means', 'explanation', 'definition', 'cn', 'zh']),
        memoryHint: firstText(raw, ['memoryHint', 'memory_hint', 'remember', 'note', 'not_meaning', 'hint']),
        provider: firstText(raw, ['provider']),
        source: firstText(raw, ['source']),
        occurrenceKey: firstText(raw, ['occurrenceKey', 'occurrence_key', 'hitKey']),
        occurrenceGlobalStart: firstInteger(raw, ['occurrenceGlobalStart', 'occurrence_global_start', 'globalStart']),
        occurrenceGlobalEnd: firstInteger(raw, ['occurrenceGlobalEnd', 'occurrence_global_end', 'globalEnd']),
        markedTokens,
        boundaryTokens
    };
}

function firstText(source, keys) {
    for (const key of keys) {
        const value = source[key];
        if (value != null && String(value).trim()) return String(value).replace(/\s+/g, ' ').trim();
    }
    return '';
}

function buildTokenIndex(nextItems, tokenField) {
    const index = new Map();
    nextItems.forEach((item) => {
        item[tokenField].forEach((token) => {
            if (!index.has(token)) index.set(token, []);
            index.get(token).push(item);
        });
    });
    return index;
}

function buildOccurrenceIndex(nextItems) {
    const index = new Map();
    nextItems.forEach((item) => {
        if (!item.occurrenceKey) return;
        if (!index.has(item.occurrenceKey)) index.set(item.occurrenceKey, []);
        index.get(item.occurrenceKey).push(item);
    });
    return index;
}

function buildWordIndex(nextItems) {
    const index = new Map();
    nextItems.forEach((item) => {
        if (!Number.isInteger(item.occurrenceGlobalStart) || !Number.isInteger(item.occurrenceGlobalEnd)) return;
        for (let value = item.occurrenceGlobalStart; value <= item.occurrenceGlobalEnd; value++) {
            if (!index.has(value)) index.set(value, []);
            index.get(value).push(item);
        }
    });
    return index;
}

function firstInteger(source, keys) {
    for (const key of keys) {
        const value = Number(source[key]);
        if (Number.isInteger(value)) return value;
    }
    return null;
}

function normalizeScope(scope) {
    return {
        audioKey: normalizeText(scope && scope.audioKey) || 'default-audio',
        documentId: normalizeText(scope && scope.documentId) || 'default-document'
    };
}

function normalizeText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

window.AnnotationGeneratedResultStore = { clear, indexBundle, query, queryByOccurrence, getScope, getItems, normalizeToTokens };
