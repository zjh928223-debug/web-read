(function (global) {
    'use strict';

    const STORAGE_PREFIX = 'AnnotationRunDiagnostics::';
    const RUNS_SUFFIX = 'runs';
    const MAX_RUNS_PER_SCOPE = 15;
    const MAX_EVENTS_PER_RUN = 200;
    const MAX_STRING_LENGTH = 3000;
    const MAX_ARRAY_LENGTH = 10;
    const MAX_OBJECT_KEYS = 20;

    let sequence = 0;

    function isEnabled() {
        const config = global.__ANNOTATION_RUN_DIAGNOSTICS__;
        if (config && typeof config === 'object' && Object.prototype.hasOwnProperty.call(config, 'enabled')) {
            return !!config.enabled;
        }
        if (Object.prototype.hasOwnProperty.call(global, 'ANNOTATION_RUN_DIAGNOSTICS_ENABLED')) {
            return !!global.ANNOTATION_RUN_DIAGNOSTICS_ENABLED;
        }
        return true;
    }

    function createRun(scope = {}, meta = {}) {
        if (!isEnabled()) return '';
        const normalizedScope = normalizeScope(scope);
        const scopeKey = buildScopeKey(normalizedScope);
        const runId = normalizeText(meta && meta.runIdOverride) || `annotation-run-${Date.now()}-${++sequence}`;
        const runs = readJson(getRunsKey(scopeKey), []);
        const nextMeta = sanitizeValue(meta);
        if (nextMeta && typeof nextMeta === 'object') delete nextMeta.runIdOverride;
        const run = {
            runId,
            audioKey: normalizedScope.audioKey,
            documentId: normalizedScope.documentId,
            scopeKey,
            createdAt: new Date().toISOString(),
            status: 'running',
            meta: nextMeta,
            events: [],
            summary: null
        };
        runs.unshift(run);
        writeJson(getRunsKey(scopeKey), runs.slice(0, MAX_RUNS_PER_SCOPE));
        record(normalizedScope, runId, 'run created', {
            ...nextMeta,
            createdAt: run.createdAt
        });
        return runId;
    }

    function record(scope = {}, runId, event, payload = {}) {
        if (!isEnabled() || !runId) return null;
        const normalizedScope = normalizeScope(scope);
        const scopeKey = buildScopeKey(normalizedScope);
        const runs = readJson(getRunsKey(scopeKey), []);
        const index = runs.findIndex((run) => run && run.runId === runId);
        if (index < 0) return null;
        const entry = {
            seq: nextSequence(runs[index]),
            ts: new Date().toISOString(),
            event: normalizeText(event) || 'unknown',
            payload: sanitizeValue(payload)
        };
        const currentEvents = Array.isArray(runs[index].events) ? runs[index].events : [];
        currentEvents.push(entry);
        runs[index] = {
            ...runs[index],
            events: currentEvents.slice(Math.max(0, currentEvents.length - MAX_EVENTS_PER_RUN))
        };
        writeJson(getRunsKey(scopeKey), runs.slice(0, MAX_RUNS_PER_SCOPE));
        return entry;
    }

    function finish(scope = {}, runId, finalState = {}) {
        if (!isEnabled() || !runId) return null;
        const normalizedScope = normalizeScope(scope);
        const scopeKey = buildScopeKey(normalizedScope);
        const runs = readJson(getRunsKey(scopeKey), []);
        const index = runs.findIndex((run) => run && run.runId === runId);
        if (index < 0) return null;
        const run = runs[index];
        const summary = buildSummary(run.events, finalState);
        const closingEvent = summary.runSucceeded ? 'run completed' : 'run failed';
        const finalSummaryEvent = {
            conclusion: summary.conclusion,
            status: summary.status,
            finalState: summary.finalState,
            finalRunReason: summary.finalRunReason,
            failureType: summary.failureType,
            eventCount: summary.eventCount,
            providerStatus: summary.providerStatus,
            message: summary.message
        };
        const nextEvents = (Array.isArray(run.events) ? run.events.slice() : []);
        nextEvents.push({
            seq: nextSequence({ events: nextEvents }),
            ts: new Date().toISOString(),
            event: closingEvent,
            payload: sanitizeValue(finalSummaryEvent)
        });
        nextEvents.push({
            seq: nextSequence({ events: nextEvents }),
            ts: new Date().toISOString(),
            event: 'final summary',
            payload: sanitizeValue(finalSummaryEvent)
        });
        runs[index] = {
            ...run,
            status: summary.status,
            finishedAt: new Date().toISOString(),
            finalState: sanitizeValue(finalState),
            summary,
            events: nextEvents.slice(Math.max(0, nextEvents.length - MAX_EVENTS_PER_RUN))
        };
        writeJson(getRunsKey(scopeKey), runs.slice(0, MAX_RUNS_PER_SCOPE));
        return runs[index];
    }

    function getRuns(scope = {}) {
        const normalizedScope = normalizeScope(scope);
        const scopeKey = buildScopeKey(normalizedScope);
        return readJson(getRunsKey(scopeKey), []);
    }

    function getLatestRun(scope = {}) {
        return getRuns(scope)[0] || null;
    }

    function getRun(input = {}) {
        const normalizedScope = normalizeScope(input);
        const runId = normalizeText(input.runId);
        if (!runId) return null;
        return getRuns(normalizedScope).find((run) => run && run.runId === runId) || null;
    }

    function clearScope(scope = {}) {
        const normalizedScope = normalizeScope(scope);
        removeKey(getRunsKey(buildScopeKey(normalizedScope)));
    }

    function buildSummary(events = [], finalState = {}) {
        const eventList = Array.isArray(events) ? events : [];
        const finalStatus = normalizeText(finalState && finalState.state).toLowerCase();
        const finalRunReason = normalizeText(finalState && finalState.finalRunReason);
        const failureType = normalizeText(finalState && finalState.failureType);
        const failureMessage = normalizeText(finalState && finalState.failureMessage);
        const requestScheduled = hasEvent(eventList, 'provider request scheduled');
        const requestStarted = hasEvent(eventList, 'provider request start');
        const responseReceived = findLastEvent(eventList, 'provider response received');
        const providerNon200 = findLastEvent(eventList, 'provider non-200');
        const localTimeout = findLastEvent(eventList, 'local timeout abort');
        const externalAbort = findLastEvent(eventList, 'external abort');
        const parseFailed = findLastEvent(eventList, 'response parse failed');
        const normalizeEmpty = findLastEvent(eventList, 'normalize empty');
        const persistSkipped = findLastEvent(eventList, 'persist skipped');
        const providerStatus = providerNon200 && providerNon200.payload
            ? toInteger(providerNon200.payload.httpStatus, 0)
            : responseReceived && responseReceived.payload
                ? toInteger(responseReceived.payload.httpStatus, 0)
                : 0;

        let conclusion = 'unknown';
        if (!requestScheduled && !requestStarted) {
            conclusion = 'provider_not_called';
        } else if (localTimeout) {
            conclusion = 'local_timeout_abort';
        } else if (externalAbort) {
            conclusion = 'external_abort';
        } else if (providerNon200 && providerStatus === 503) {
            conclusion = 'provider_503_unavailable';
        } else if (providerNon200 && providerStatus === 429) {
            conclusion = 'provider_429_quota';
        } else if (providerNon200) {
            conclusion = 'provider_non_200_other';
        } else if (responseReceived && parseFailed) {
            conclusion = 'provider_200_but_parse_failed';
        } else if (responseReceived && normalizeEmpty) {
            conclusion = 'provider_200_but_normalized_empty';
        } else if (responseReceived && persistSkipped) {
            conclusion = 'provider_200_but_persist_skipped';
        } else if (finalStatus === 'incomplete' || finalRunReason === 'remaining_targets' || finalRunReason === 'budget_exhausted') {
            conclusion = 'final_incomplete';
        } else if ((finalStatus === 'failed' || finalStatus === 'stopped') && !requestStarted) {
            conclusion = 'provider_not_called';
        }

        const runSucceeded = finalStatus === 'complete' || finalStatus === 'up-to-date' || finalStatus === 'no-targets';
        return sanitizeValue({
            conclusion,
            status: runSucceeded ? 'completed' : 'failed',
            finalState: finalStatus || 'unknown',
            finalRunReason,
            runSucceeded,
            failureType,
            failureMessage,
            providerStatus,
            eventCount: eventList.length,
            providerRequestScheduled: requestScheduled,
            providerRequestStarted: requestStarted,
            responseReceived: !!responseReceived,
            message: buildSummaryMessage(conclusion, finalStatus, finalRunReason, providerStatus, finalState)
        });
    }

    function buildSummaryMessage(conclusion, finalStatus, finalRunReason, providerStatus, finalState) {
        if (conclusion === 'provider_not_called') return 'Provider was never called during this run.';
        if (conclusion === 'local_timeout_abort') return 'Run aborted because the local timeout fired before a provider response completed.';
        if (conclusion === 'external_abort') return 'Run aborted by an external abort signal.';
        if (conclusion === 'provider_503_unavailable') return 'Provider returned HTTP 503 Service Unavailable.';
        if (conclusion === 'provider_429_quota') return 'Provider returned HTTP 429 quota or rate-limit.';
        if (conclusion === 'provider_non_200_other') return `Provider returned non-200 HTTP status ${providerStatus || 'unknown'}.`;
        if (conclusion === 'provider_200_but_parse_failed') return 'Provider returned HTTP 200, but the response could not be parsed.';
        if (conclusion === 'provider_200_but_normalized_empty') return 'Provider returned HTTP 200, but normalization produced no valid items.';
        if (conclusion === 'provider_200_but_persist_skipped') return 'Provider returned HTTP 200, but persistence was skipped because nothing new could be saved.';
        if (conclusion === 'final_incomplete') return 'Run ended incomplete after requests finished.';
        const failureType = normalizeText(finalState && finalState.failureType);
        const failureMessage = normalizeText(finalState && finalState.failureMessage);
        return failureMessage || failureType || finalRunReason || finalStatus || 'Unknown run outcome.';
    }

    function hasEvent(events, name) {
        return !!findLastEvent(events, name);
    }

    function findLastEvent(events, name) {
        for (let index = (Array.isArray(events) ? events.length : 0) - 1; index >= 0; index -= 1) {
            const entry = events[index];
            if (normalizeText(entry && entry.event) === normalizeText(name)) return entry;
        }
        return null;
    }

    function nextSequence(run) {
        const events = Array.isArray(run && run.events) ? run.events : [];
        const last = events[events.length - 1];
        return toInteger(last && last.seq, 0) + 1;
    }

    function getRunsKey(scopeKey) {
        return `${STORAGE_PREFIX}${scopeKey}::${RUNS_SUFFIX}`;
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

    function sanitizeValue(value, depth = 0) {
        if (value == null) return value;
        if (typeof value === 'string') return sanitizeString(value);
        if (typeof value === 'number' || typeof value === 'boolean') return value;
        if (Array.isArray(value)) return value.slice(0, MAX_ARRAY_LENGTH).map((item) => sanitizeValue(item, depth + 1));
        if (typeof value === 'object') {
            const next = {};
            Object.keys(value).slice(0, MAX_OBJECT_KEYS).forEach((key) => {
                const current = value[key];
                if (current == null || typeof current === 'function') return;
                if (depth > 2 && typeof current === 'object') return;
                next[key] = sanitizeValue(
                    key.toLowerCase().indexOf('url') >= 0 ? redactUrl(current) : current,
                    depth + 1
                );
            });
            return next;
        }
        return sanitizeString(String(value));
    }

    function sanitizeString(value) {
        const text = normalizeText(value);
        if (text.length <= MAX_STRING_LENGTH) return text;
        return `${text.slice(0, MAX_STRING_LENGTH)}...(truncated)`;
    }

    function redactUrl(value) {
        const text = String(value || '');
        return text.replace(/([?&]key=)[^&]+/gi, '$1***');
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
        try {
            if (!global.localStorage) return false;
            global.localStorage.setItem(key, JSON.stringify(value));
            return true;
        } catch (error) {
            return false;
        }
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

    function toInteger(value, fallback) {
        const next = Number(value);
        return Number.isFinite(next) ? Math.trunc(next) : fallback;
    }

    global.AnnotationRunDiagnostics = {
        STORAGE_PREFIX,
        isEnabled,
        createRun,
        record,
        finish,
        getRuns,
        getLatestRun,
        getRun,
        clearScope,
        normalizeScope,
        buildScopeKey,
        buildSummary
    };
})(window);
