(function (global) {
    'use strict';

    const STORAGE_PREFIX = 'AnnotationGenerationDiagnosticsRecords::';
    const RUNS_SUFFIX = 'runs';
    const EVENTS_SUFFIX = 'events';
    const MAX_RUNS_PER_SCOPE = 20;
    const MAX_EVENTS_PER_RUN = 120;
    const MAX_SCOPE_EVENTS = 300;

    let sequence = 0;

    function createRun(scope = {}, meta = {}) {
        const normalizedScope = normalizeScope(scope);
        const scopeKey = buildScopeKey(normalizedScope);
        const runId = `run-${Date.now()}-${++sequence}`;
        const runs = readJson(getRunsKey(scopeKey), []);
        runs.unshift({
            runId,
            audioKey: normalizedScope.audioKey,
            documentId: normalizedScope.documentId,
            scopeKey,
            createdAt: new Date().toISOString(),
            status: 'running',
            meta: sanitizeValue(meta),
            summary: {},
            events: []
        });
        writeJson(getRunsKey(scopeKey), runs.slice(0, MAX_RUNS_PER_SCOPE));
        return runId;
    }

    function finalizeRun(scope = {}, runId, summary = {}) {
        if (!runId) return null;
        const normalizedScope = normalizeScope(scope);
        const scopeKey = buildScopeKey(normalizedScope);
        const runs = readJson(getRunsKey(scopeKey), []);
        const index = runs.findIndex((run) => run && run.runId === runId);
        if (index < 0) return null;
        runs[index] = {
            ...runs[index],
            status: normalizeText(summary.status || summary.state || 'complete'),
            finishedAt: new Date().toISOString(),
            summary: sanitizeValue(summary)
        };
        writeJson(getRunsKey(scopeKey), runs.slice(0, MAX_RUNS_PER_SCOPE));
        return runs[index];
    }

    function recordEvent(entry = {}) {
        const scope = normalizeScope(entry);
        const scopeKey = buildScopeKey(scope);
        appendScopeEvent(scopeKey, entry);
        if (!entry.runId) return;
        appendRunEvent(scopeKey, entry.runId, entry);
    }

    function getRuns(scope = {}) {
        const scopeKey = buildScopeKey(normalizeScope(scope));
        return readJson(getRunsKey(scopeKey), []);
    }

    function getScopeEvents(scope = {}) {
        const scopeKey = buildScopeKey(normalizeScope(scope));
        return readJson(getEventsKey(scopeKey), []);
    }

    function getLatestRun(scope = {}) {
        return getRuns(scope)[0] || null;
    }

    function clearScope(scope = {}) {
        const scopeKey = buildScopeKey(normalizeScope(scope));
        removeKey(getRunsKey(scopeKey));
        removeKey(getEventsKey(scopeKey));
    }

    function appendScopeEvent(scopeKey, entry) {
        const events = readJson(getEventsKey(scopeKey), []);
        events.push(sanitizeValue(entry));
        const next = events.slice(Math.max(0, events.length - MAX_SCOPE_EVENTS));
        writeJson(getEventsKey(scopeKey), next);
    }

    function appendRunEvent(scopeKey, runId, entry) {
        const runs = readJson(getRunsKey(scopeKey), []);
        const index = runs.findIndex((run) => run && run.runId === runId);
        if (index < 0) return;
        const currentEvents = Array.isArray(runs[index].events) ? runs[index].events : [];
        currentEvents.push(sanitizeValue(entry));
        runs[index] = {
            ...runs[index],
            events: currentEvents.slice(Math.max(0, currentEvents.length - MAX_EVENTS_PER_RUN))
        };
        writeJson(getRunsKey(scopeKey), runs.slice(0, MAX_RUNS_PER_SCOPE));
    }

    function getRunsKey(scopeKey) {
        return `${STORAGE_PREFIX}${scopeKey}::${RUNS_SUFFIX}`;
    }

    function getEventsKey(scopeKey) {
        return `${STORAGE_PREFIX}${scopeKey}::${EVENTS_SUFFIX}`;
    }

    function normalizeScope(scope = {}) {
        return {
            audioKey: normalizeText(scope.audioKey) || 'default-audio',
            documentId: normalizeText(scope.documentId) || 'default-document'
        };
    }

    function buildScopeKey(scope = {}) {
        const normalized = normalizeScope(scope);
        return `${normalized.audioKey}::${normalized.documentId}`;
    }

    function sanitizeValue(value) {
        if (value == null) return value;
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
        if (Array.isArray(value)) return value.slice(0, 20).map(sanitizeValue);
        if (typeof value === 'object') {
            const next = {};
            Object.keys(value).forEach((key) => {
                const current = value[key];
                if (current == null) return;
                if (typeof current === 'function') return;
                next[key] = sanitizeValue(current);
            });
            return next;
        }
        return String(value);
    }

    function readJson(key, fallback) {
        try {
            if (!global.localStorage) return cloneValue(fallback);
            const raw = global.localStorage.getItem(key);
            return raw ? JSON.parse(raw) : cloneValue(fallback);
        } catch (error) {
            return cloneValue(fallback);
        }
    }

    function writeJson(key, value) {
        if (!global.localStorage) return false;
        global.localStorage.setItem(key, JSON.stringify(value));
        return true;
    }

    function removeKey(key) {
        try {
            if (global.localStorage) global.localStorage.removeItem(key);
        } catch (error) {}
    }

    function cloneValue(value) {
        if (value == null) return value;
        return JSON.parse(JSON.stringify(value));
    }

    function normalizeText(value) {
        return String(value || '').replace(/\s+/g, ' ').trim();
    }

    global.AnnotationGenerationDiagnosticsRecords = {
        STORAGE_PREFIX,
        createRun,
        finalizeRun,
        recordEvent,
        getRuns,
        getScopeEvents,
        getLatestRun,
        clearScope,
        normalizeScope,
        buildScopeKey
    };
})(window);
