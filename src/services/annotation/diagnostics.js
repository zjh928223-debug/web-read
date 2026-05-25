'use strict';

const EVENT_PREFIX = '[AnnotationDiagnostics]';
const MAX_EVENTS = 500;

let events = [];
let sequence = 0;

export function isEnabled() {
    const global = (typeof window !== 'undefined') ? window : (typeof globalThis !== 'undefined' ? globalThis : {});
    const config = global.__ANNOTATION_GENERATION_DIAGNOSTICS__;
    if (config && typeof config === 'object' && Object.prototype.hasOwnProperty.call(config, 'enabled')) {
        return !!config.enabled;
    }
    return true;
}

export function emit(event, payload = {}) {
    if (!isEnabled()) return null;
    const global = (typeof window !== 'undefined') ? window : (typeof globalThis !== 'undefined' ? globalThis : {});
    const scope = normalizeScope(payload.scope || payload);
    const entry = {
        seq: ++sequence,
        ts: new Date().toISOString(),
        event: normalizeText(event) || 'unknown',
        audioKey: scope.audioKey,
        documentId: scope.documentId,
        scopeKey: buildScopeKey(scope),
        ...sanitizePayload(payload)
    };
    events.push(entry);
    if (events.length > MAX_EVENTS) events = events.slice(events.length - MAX_EVENTS);
    try {
        console.info(EVENT_PREFIX, entry.event, entry);
    } catch (error) {}
    try {
        if (
            global.AnnotationGenerationDiagnosticsRecords
            && typeof global.AnnotationGenerationDiagnosticsRecords.recordEvent === 'function'
        ) {
            global.AnnotationGenerationDiagnosticsRecords.recordEvent(entry);
        }
    } catch (error) {}
    return entry;
}

export function clearEvents() {
    events = [];
    sequence = 0;
}

export function getEvents() {
    return events.map((entry) => ({ ...entry }));
}

export function normalizeScope(scope = {}) {
    return {
        audioKey: normalizeText(scope.audioKey) || 'default-audio',
        documentId: normalizeText(scope.documentId) || 'default-document'
    };
}

export function buildScopeKey(scope = {}) {
    const normalized = normalizeScope(scope);
    return `${normalized.audioKey}::${normalized.documentId}`;
}

export function summarizeBundle(bundle = null) {
    const items = Array.isArray(bundle && bundle.items) ? bundle.items : [];
    const blockIds = new Set();
    const occurrenceKeys = new Set();
    items.forEach((item) => {
        const blockId = normalizeText(item && item.blockId);
        const occurrenceKey = normalizeText(item && item.occurrenceKey);
        if (blockId) blockIds.add(blockId);
        if (occurrenceKey) occurrenceKeys.add(occurrenceKey);
    });
    return {
        itemCount: items.length,
        blockCount: blockIds.size,
        occurrenceCount: occurrenceKeys.size,
        occurrenceSample: sampleValues(Array.from(occurrenceKeys))
    };
}

export function summarizeTargets(targets = []) {
    const list = Array.isArray(targets) ? targets : [];
    return {
        targetCount: list.length,
        occurrenceSample: sampleValues(
            list.map((target) => normalizeText(target && target.occurrenceKey)).filter(Boolean)
        )
    };
}

export function sampleValues(values, limit = 3) {
    return (Array.isArray(values) ? values : [])
        .map((value) => normalizeText(value))
        .filter(Boolean)
        .slice(0, limit);
}

function sanitizePayload(payload = {}) {
    const next = {};
    Object.keys(payload || {}).forEach((key) => {
        if (key === 'scope') return;
        const value = payload[key];
        if (value == null) return;

        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
            next[key] = value;
            return;
        }

        if (Array.isArray(value)) {
            next[key] = value.slice(0, 5).map((item) => (
                typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean'
                    ? item
                    : normalizeText(item && item.occurrenceKey || item && item.id || '')
            ));
            return;
        }

        if (key === 'bundle') {
            next.bundleSummary = summarizeBundle(value);
            return;
        }

        if (key === 'targets') {
            next.targetSummary = summarizeTargets(value);
            return;
        }

        if (typeof value === 'object') {
            next[key] = sanitizePlainObject(value);
        }
    });
    return next;
}

function sanitizePlainObject(source = {}) {
    const next = {};
    Object.keys(source).forEach((key) => {
        const value = source[key];
        if (value == null) return;
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
            next[key] = value;
            return;
        }
        if (Array.isArray(value)) {
            next[key] = value.slice(0, 5).map((item) => (
                typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean'
                    ? item
                    : normalizeText(item && item.occurrenceKey || item && item.id || '')
            ));
        }
    });
    return next;
}

function normalizeText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}
