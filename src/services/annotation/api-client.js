'use strict';

import * as RUN_DIAGNOSTICS from './run-diagnostics.js';

const DEFAULT_REAL_TIMEOUT_MS = 300000;
const DEFAULT_GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';

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

export async function generateAnnotations(promptPayload, options = {}) {
    const payload = promptPayload && typeof promptPayload === 'object' ? promptPayload : {};
    const global = (typeof window !== 'undefined') ? window : (typeof globalThis !== 'undefined' ? globalThis : {});
    const configReader = global.AnnotationApiConfig;
    const configResult = configReader && typeof configReader.read === 'function'
        ? configReader.read(options.configOverride || null)
        : readFallbackConfig(options.configOverride || null);

    if (configResult.state === 'mock') {
        return buildMockResult(payload, configResult);
    }

    if (configResult.state !== 'ready') {
        const error = createClientError('unconfigured', 'Annotation API is not configured.', {
            failureType: 'unconfigured',
            requestIssued: false
        });
        error.configResult = configResult;
        throw error;
    }

    if ((configResult.config.provider || '').toLowerCase() !== 'gemini') {
        throw createClientError('fatal', `Unsupported annotation provider: ${configResult.config.provider}`, {
            failureType: 'unsupported_provider',
            requestIssued: false
        });
    }

    return requestGeminiAnnotations(payload, configResult.config, options);
}

export function parseModelJson(rawText, options) {
    const text = String(rawText || '').trim();
    recordRunDiagnostic(options, 'response parse start', {
        inputLength: text.length,
        inputPreview: text.slice(0, 1000)
    });
    emitAnnotationDebug('parse.model_json_start', {
        inputLength: text.length,
        inputPreview: text.slice(0, 1000)
    });
    if (!text) {
        console.warn('[annotation-api-client] parse skipped because text is empty');
        recordRunDiagnostic(options, 'response parse failed', {
            reason: 'empty_text',
            inputLength: 0
        });
        throw createClientError('parse_failure', 'Model response is empty.', {
            failureType: 'parse_failure'
        });
    }

    const direct = tryParseJson(text);
    if (direct.ok) {
        emitAnnotationDebug('parse.model_json_success', {
            path: 'direct',
            rootKeys: direct.value && typeof direct.value === 'object' ? Object.keys(direct.value).slice(0, 8) : [],
            itemsCount: direct.value && Array.isArray(direct.value.items) ? direct.value.items.length : 0,
            candidatesCount: direct.value && Array.isArray(direct.value.candidates) ? direct.value.candidates.length : 0
        });
        return direct.value;
    }

    const fenced = extractCodeFence(text);
    if (fenced) {
        const fencedParsed = tryParseJson(fenced);
        if (fencedParsed.ok) {
            emitAnnotationDebug('parse.model_json_success', {
                path: 'code_fence',
                rootKeys: fencedParsed.value && typeof fencedParsed.value === 'object' ? Object.keys(fencedParsed.value).slice(0, 8) : [],
                itemsCount: fencedParsed.value && Array.isArray(fencedParsed.value.items) ? fencedParsed.value.items.length : 0,
                candidatesCount: fencedParsed.value && Array.isArray(fencedParsed.value.candidates) ? fencedParsed.value.candidates.length : 0
            });
            return fencedParsed.value;
        }
    }

    const objectSlice = extractJsonObject(text);
    if (objectSlice) {
        const slicedParsed = tryParseJson(objectSlice);
        if (slicedParsed.ok) {
            emitAnnotationDebug('parse.model_json_success', {
                path: 'object_slice',
                rootKeys: slicedParsed.value && typeof slicedParsed.value === 'object' ? Object.keys(slicedParsed.value).slice(0, 8) : [],
                itemsCount: slicedParsed.value && Array.isArray(slicedParsed.value.items) ? slicedParsed.value.items.length : 0,
                candidatesCount: slicedParsed.value && Array.isArray(slicedParsed.value.candidates) ? slicedParsed.value.candidates.length : 0
            });
            return slicedParsed.value;
        }
    }

    emitAnnotationDebug('parse.model_json_failed', {
        inputLength: text.length,
        inputPreview: text.slice(0, 1000)
    });
    console.warn('[annotation-api-client] parse failed for text', {
        inputLength: text.length,
        inputPreview: text.slice(0, 1000)
    });
    recordRunDiagnostic(options, 'response parse failed', {
        inputLength: text.length,
        inputPreview: text.slice(0, 1000)
    });
    throw createClientError('parse_failure', 'Model response is not valid JSON.', {
        failureType: 'parse_failure'
    });
}

export function compactMeaning(value) {
    return limitSentenceLikeText(normalizeText(value), 2, 72);
}

export function compactMemoryHint(value) {
    return limitSentenceLikeText(normalizeText(value), 1, 60);
}

export function isRetryableFailureType(failureType) {
    return failureType === 'provider_server' || failureType === 'network' || failureType === 'timeout';
}

async function requestGeminiAnnotations(promptPayload, config, options = {}) {
    const prompt = buildGeminiPrompt(promptPayload);
    const model = normalizeText(config.model || DEFAULT_GEMINI_MODEL);
    const baseUrl = normalizeBaseUrl(config.baseUrl || DEFAULT_GEMINI_BASE_URL);
    const requestUrl = `${baseUrl}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(config.apiKey)}`;
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const externalSignal = options && options.abortSignal ? options.abortSignal : null;
    const timeoutMs = toInteger(options.timeoutMs, DEFAULT_REAL_TIMEOUT_MS);
    const timeoutId = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    const requestStartedAt = new Date().toISOString();
    const requestStartedMs = Date.now();
    let requestIssued = false;
    let externalAbortHandler = null;
    const requestDebugMeta = {
        blockId: normalizeText(promptPayload && promptPayload.blockId),
        requestUrl,
        timeoutMs,
        requestStartedAt
    };

    emitAnnotationDebug('request start', {
        ...requestDebugMeta,
        externalSignalAborted: !!(externalSignal && externalSignal.aborted)
    });
    recordRunDiagnostic(options, 'provider request start', {
        blockId: requestDebugMeta.blockId,
        requestUrl,
        timeoutMs,
        requestStartedAt,
        externalSignalAborted: !!(externalSignal && externalSignal.aborted),
        requestIndex: toInteger(options && options.requestIndex, 0),
        attempt: toInteger(options && options.attempt, 0)
    });

    if (controller && controller.signal && typeof controller.signal.addEventListener === 'function') {
        controller.signal.addEventListener('abort', () => {
            emitAnnotationDebug('signal aborted', {
                ...requestDebugMeta,
                elapsedMs: Math.max(0, Date.now() - requestStartedMs),
                timeoutMs,
                externalSignalAborted: !!(externalSignal && externalSignal.aborted),
                abortTrace: new Error('annotation-api-client signal aborted').stack || ''
            });
        }, { once: true });
    }

    if (controller && externalSignal && typeof externalSignal.addEventListener === 'function') {
        if (externalSignal.aborted) {
            emitAnnotationDebug('external signal abort', {
                ...requestDebugMeta,
                elapsedMs: Math.max(0, Date.now() - requestStartedMs),
                timeoutMs,
                externalSignalAborted: true,
                abortTrace: new Error('annotation-api-client external signal already aborted').stack || ''
            });
            recordRunDiagnostic(options, 'external abort', {
                blockId: requestDebugMeta.blockId,
                requestUrl,
                timeoutMs,
                elapsedMs: Math.max(0, Date.now() - requestStartedMs),
                requestStartedAt
            });
            controller.abort();
        } else {
            externalAbortHandler = () => {
                emitAnnotationDebug('external signal abort', {
                    ...requestDebugMeta,
                    elapsedMs: Math.max(0, Date.now() - requestStartedMs),
                    timeoutMs,
                    externalSignalAborted: !!(externalSignal && externalSignal.aborted),
                    abortTrace: new Error('annotation-api-client external signal abort').stack || ''
                });
                recordRunDiagnostic(options, 'external abort', {
                    blockId: requestDebugMeta.blockId,
                    requestUrl,
                    timeoutMs,
                    elapsedMs: Math.max(0, Date.now() - requestStartedMs),
                    requestStartedAt
                });
                controller.abort();
            };
            externalSignal.addEventListener('abort', externalAbortHandler, { once: true });
        }
    }

    if (timeoutId) {
        clearTimeout(timeoutId);
    }
    const nextTimeoutId = controller ? setTimeout(() => {
        emitAnnotationDebug('timeout abort', {
            ...requestDebugMeta,
            elapsedMs: Math.max(0, Date.now() - requestStartedMs),
            timeoutMs,
            externalSignalAborted: !!(externalSignal && externalSignal.aborted),
            abortTrace: new Error('annotation-api-client timeout abort').stack || ''
        });
        recordRunDiagnostic(options, 'local timeout abort', {
            blockId: requestDebugMeta.blockId,
            requestUrl,
            timeoutMs,
            elapsedMs: Math.max(0, Date.now() - requestStartedMs),
            requestStartedAt
        });
        controller.abort();
    }, timeoutMs) : null;

    try {
        requestIssued = true;
        const response = await fetch(requestUrl, {
            method: 'POST',
            headers: buildHeaders(config.extraHeaders),
            body: JSON.stringify({
                contents: [
                    {
                        role: 'user',
                        parts: [{ text: prompt }]
                    }
                ],
                generationConfig: {
                    temperature: 0.2,
                    responseMimeType: 'application/json'
                }
            }),
            signal: controller ? controller.signal : undefined
        });

        if (!response.ok) {
            const responseText = await response.text();
            const elapsedMs = Math.max(0, Date.now() - requestStartedMs);
            console.error('[annotation-api-client] non-200 response', {
                httpStatus: Number(response.status) || 0,
                statusText: normalizeText(response.statusText || ''),
                elapsedMs,
                requestUrl,
                responseText
            });
            recordRunDiagnostic(options, 'provider non-200', {
                blockId: requestDebugMeta.blockId,
                requestUrl,
                httpStatus: Number(response.status) || 0,
                statusText: normalizeText(response.statusText || ''),
                elapsedMs,
                responseText
            });
            throw await buildHttpError(response, {
                bodyText: responseText,
                requestUrl,
                timeoutMs,
                requestStartedAt,
                requestStartedMs,
                requestIssued
            });
        }

        const responseText = await response.text();
        recordRunDiagnostic(options, 'provider response received', {
            blockId: requestDebugMeta.blockId,
            requestUrl,
            httpStatus: Number(response.status) || 200,
            statusText: normalizeText(response.statusText || ''),
            elapsedMs: Math.max(0, Date.now() - requestStartedMs),
            responseText
        });
        console.debug('[annotation-api-client] 200 response', {
            httpStatus: Number(response.status) || 200,
            statusText: normalizeText(response.statusText || ''),
            elapsedMs: Math.max(0, Date.now() - requestStartedMs),
            requestUrl,
            responseText
        });
        emitAnnotationDebug('api.response_text', {
            provider: 'gemini',
            httpStatus: Number(response.status) || 200,
            textLength: responseText.length,
            textPreview: responseText.slice(0, 1000)
        });
        recordRunDiagnostic(options, 'response parse start', {
            blockId: requestDebugMeta.blockId,
            stage: 'extract_gemini_text',
            httpStatus: Number(response.status) || 200,
            responseText
        });
        const parsed = parseModelJson(extractGeminiText(responseText, options), options);
        const requestFinishedAt = new Date().toISOString();
        const durationMs = Math.max(0, Date.now() - requestStartedMs);
        const normalizedItems = normalizeRealProviderItems(parsed, promptPayload, 'gemini', options);
        emitAnnotationDebug('request complete', {
            ...requestDebugMeta,
            requestFinishedAt,
            elapsedMs: durationMs,
            timeoutMs,
            externalSignalAborted: !!(externalSignal && externalSignal.aborted),
            httpStatus: Number(response.status) || 200
        });
        emitAnnotationDebug('api.response_normalized', {
            provider: 'gemini',
            blockId: normalizeText(promptPayload && promptPayload.blockId),
            rawItemsCount: parsed && Array.isArray(parsed.items) ? parsed.items.length : 0,
            normalizedItemsCount: normalizedItems.length
        });
        return {
            provider: 'gemini',
            mode: 'real',
            promptPayload,
            items: normalizedItems,
            requestMeta: {
                requestIssued,
                requestUrl,
                timeoutMs,
                requestStartedAt,
                requestFinishedAt,
                durationMs,
                httpStatus: Number(response.status) || 200
            }
        };
    } catch (error) {
        if (error && error.name === 'AbortError') {
            const abortedByCaller = !!(externalSignal && externalSignal.aborted);
            throw createClientError(abortedByCaller ? 'aborted' : 'retryable', abortedByCaller ? 'Annotation API request aborted.' : 'Annotation API request timed out.', {
                failureType: abortedByCaller ? 'aborted' : 'timeout',
                requestIssued,
                requestUrl,
                timeoutMs,
                requestStartedAt,
                requestFinishedAt: new Date().toISOString(),
                durationMs: Math.max(0, Date.now() - requestStartedMs)
            });
        }
        if (error && error.clientErrorType) throw error;
        const failureType = classifyUnknownError(error, requestIssued);
        throw createClientError(
            isRetryableFailureType(failureType) ? 'retryable' : 'fatal',
            buildUnknownFailureMessage(failureType, error),
            {
                failureType,
                requestIssued,
                requestUrl,
                timeoutMs,
                requestStartedAt,
                requestFinishedAt: new Date().toISOString(),
                durationMs: Math.max(0, Date.now() - requestStartedMs)
            }
        );
    } finally {
        if (nextTimeoutId) clearTimeout(nextTimeoutId);
        if (externalSignal && externalAbortHandler && typeof externalSignal.removeEventListener === 'function') {
            externalSignal.removeEventListener('abort', externalAbortHandler);
        }
    }
}

function buildUnknownFailureMessage(failureType, error) {
    if (failureType === 'network') return 'Network error while contacting Annotation API.';
    if (failureType === 'parse_failure') return 'Annotation API response could not be parsed.';
    return error && error.message ? error.message : 'Annotation API request failed.';
}

function buildGeminiPrompt(promptPayload) {
    return [
        'Return exactly one JSON object and nothing else.',
        'The top-level format must be {"items":[...]}.',
        'Generate annotation JSON only.',
        'Do not output markdown, code fences, commentary, or any text before or after JSON.',
        'Return targetId exactly as provided.',
        'meaning should be concise Chinese explanation.',
        'memoryHint should be concise and memorable.',
        'If any item is uncertain, still keep the output as valid JSON.',
        '',
        promptPayload && promptPayload.prompt ? String(promptPayload.prompt) : ''
    ].join('\n');
}

function buildHeaders(extraHeaders) {
    return {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...normalizeHeaders(extraHeaders)
    };
}

function buildMockResult(promptPayload, configResult) {
    const targets = Array.isArray(promptPayload && promptPayload.targets) ? promptPayload.targets : [];
    return {
        provider: 'mock',
        mode: 'mock',
        promptPayload,
        configResult,
        requestMeta: {
            requestIssued: false,
            failureType: '',
            httpStatus: 0,
            durationMs: 0
        },
        items: targets.map((target, index) => ({
            id: `${promptPayload.blockId || 'block'}-mock-${index}`,
            targetId: String(target.id || ''),
            blockId: String(promptPayload.blockId || ''),
            markedText: target.markedText,
            boundary: buildMockBoundary(target),
            type: inferMockType(target),
            meaning: compactMeaning(buildMockMeaning(target)),
            memoryHint: compactMemoryHint(buildMockMemoryHint(target)),
            provider: 'mock',
            source: 'mock',
            occurrenceKey: normalizeText(target.occurrenceKey || ''),
            occurrenceGlobalStart: toInteger(target.occurrenceGlobalStart, null),
            occurrenceGlobalEnd: toInteger(target.occurrenceGlobalEnd, null)
        }))
    };
}

function buildMockBoundary(target) {
    const hint = normalizeText(target.boundaryHint || '');
    return hint || normalizeText(target.markedText || '');
}

function inferMockType(target) {
    const boundary = normalizeText(target.boundaryHint || '');
    const marked = normalizeText(target.markedText || '');
    if (boundary && marked && boundary !== marked) {
        return /\s/.test(boundary) ? 'phrase' : 'collocation';
    }
    return 'word';
}

function buildMockMeaning(target) {
    const boundary = buildMockBoundary(target);
    if (!target || !target.sentenceText) {
        return `${boundary} should be read as a single contextual chunk here.`;
    }
    return `${boundary} should be understood from the current sentence context.`;
}

function buildMockMemoryHint(target) {
    const boundary = buildMockBoundary(target);
    const markedText = normalizeText(target && target.markedText);
    if (!boundary || boundary === markedText) {
        return `Remember ${boundary || markedText} in the original sentence.`;
    }
    return `Remember ${boundary} as one English chunk.`;
}

function normalizeRealProviderItems(parsed, promptPayload, providerName, options) {
    const rawItems = parsed && Array.isArray(parsed.items) ? parsed.items : [];
    const targetById = new Map();
    const targets = Array.isArray(promptPayload && promptPayload.targets) ? promptPayload.targets : [];
    targets.forEach((target, index) => {
        targetById.set(String(target.id || index), { ...target, __index: index });
    });
    recordRunDiagnostic(options, 'normalize start', {
        provider: providerName,
        blockId: normalizeText(promptPayload && promptPayload.blockId),
        rawItemsCount: rawItems.length,
        targetCount: targets.length
    });
    emitAnnotationDebug('normalize.real_provider_items_start', {
        provider: providerName,
        rawItemsCount: rawItems.length,
        targetCount: targets.length
    });

    const normalizedItems = rawItems
        .map((item, index) => normalizeRealProviderItem(item, index, targetById, providerName))
        .filter(Boolean);
    if (!normalizedItems.length) {
        console.warn('[annotation-api-client] no valid annotations after normalizeRealProviderItems', {
            provider: providerName,
            rawItemsCount: rawItems.length,
            targetCount: targets.length
        });
        recordRunDiagnostic(options, 'normalize empty', {
            provider: providerName,
            blockId: normalizeText(promptPayload && promptPayload.blockId),
            rawItemsCount: rawItems.length,
            targetCount: targets.length
        });
    }
    return normalizedItems;
}

function normalizeRealProviderItem(rawItem, index, targetById, providerName) {
    if (!rawItem || typeof rawItem !== 'object') return null;

    const targetId = normalizeText(rawItem.targetId || rawItem.id || '');
    const target = targetId ? targetById.get(targetId) : null;
    const markedText = normalizeText(rawItem.markedText || (target && target.markedText) || '');
    const boundary = normalizeText(rawItem.boundary || rawItem.phrase || rawItem.matchContext || markedText);
    const meaning = compactMeaning(rawItem.meaning || rawItem.explanation || rawItem.definition || '');
    const memoryHint = compactMemoryHint(rawItem.memoryHint || rawItem.memory_hint || rawItem.hint || '');
    const occurrenceKey = normalizeText(rawItem.occurrenceKey || (target && target.occurrenceKey) || '');
    const occurrenceGlobalStart = toInteger(
        rawItem.occurrenceGlobalStart != null ? rawItem.occurrenceGlobalStart : target && target.occurrenceGlobalStart,
        null
    );
    const occurrenceGlobalEnd = toInteger(
        rawItem.occurrenceGlobalEnd != null ? rawItem.occurrenceGlobalEnd : target && target.occurrenceGlobalEnd,
        null
    );

    let dropReason = '';
    if (!boundary && !markedText) dropReason = 'missing-boundary-and-markedText';
    else if (!meaning || !memoryHint) dropReason = 'missing-meaning-or-memoryHint';
    else if (!occurrenceKey) dropReason = 'missing-occurrenceKey';

    emitAnnotationDebug('normalize.real_provider_item', {
        provider: providerName,
        index,
        rawTargetId: normalizeText(rawItem.targetId || rawItem.id || ''),
        targetMatched: !!target,
        matchedTargetId: normalizeText(target && target.id),
        hasMeaning: !!meaning,
        hasMemoryHint: !!memoryHint,
        occurrenceKey,
        hasOccurrenceKey: !!occurrenceKey,
        dropReason
    });

    if (dropReason) return null;

    return {
        id: normalizeText(rawItem.id || rawItem.itemId || `${providerName}-${index}`),
        targetId,
        blockId: normalizeText(rawItem.blockId || (target && target.blockId) || ''),
        markedText,
        boundary: boundary || markedText,
        type: normalizeText(rawItem.type || rawItem.category || inferMockType({ markedText, boundaryHint: boundary })),
        meaning,
        memoryHint,
        provider: providerName,
        source: providerName,
        occurrenceKey,
        occurrenceGlobalStart,
        occurrenceGlobalEnd
    };
}

async function buildHttpError(response, requestMeta = {}) {
    let bodyText = typeof requestMeta.bodyText === 'string' ? requestMeta.bodyText : '';
    if (!bodyText) {
        try {
            bodyText = await response.text();
        } catch (error) {}
    }

    const status = Number(response && response.status);
    const baseExtra = {
        status,
        bodyText,
        httpStatus: status,
        providerErrorCode: extractProviderErrorCode(bodyText),
        errorBodySummary: summarizeErrorBody(bodyText),
        requestIssued: !!requestMeta.requestIssued,
        requestUrl: requestMeta.requestUrl || '',
        timeoutMs: toInteger(requestMeta.timeoutMs, DEFAULT_REAL_TIMEOUT_MS),
        requestStartedAt: requestMeta.requestStartedAt || new Date().toISOString(),
        requestFinishedAt: new Date().toISOString(),
        durationMs: Math.max(0, Date.now() - Number(requestMeta.requestStartedMs || Date.now()))
    };

    if (status === 401 || status === 403) {
        return createClientError('fatal', 'Annotation API auth failed.', {
            ...baseExtra,
            failureType: 'auth'
        });
    }
    if (status === 400 || status === 404) {
        return createClientError('fatal', `Annotation API request invalid (${status}).`, {
            ...baseExtra,
            failureType: 'request_invalid'
        });
    }
    if (status === 408 || status === 429 || status >= 500) {
        return createClientError('retryable', `Annotation API temporarily unavailable (${status}).`, {
            ...baseExtra,
            failureType: status === 429 ? 'rate_limited' : (status >= 500 ? 'provider_server' : 'timeout')
        });
    }
    return createClientError('retryable', `Annotation API request failed (${status || 'unknown'}).`, {
        ...baseExtra,
        failureType: 'http_error'
    });
}

function extractGeminiText(rawResponseText, options) {
    const parsedResponse = parseModelJson(rawResponseText, options);
    const candidates = parsedResponse && Array.isArray(parsedResponse.candidates) ? parsedResponse.candidates : [];
    const firstCandidate = candidates[0] && typeof candidates[0] === 'object' ? candidates[0] : null;
    const content = firstCandidate && firstCandidate.content && typeof firstCandidate.content === 'object'
        ? firstCandidate.content
        : null;
    const parts = candidates[0] && candidates[0].content && Array.isArray(candidates[0].content.parts)
        ? candidates[0].content.parts
        : [];
    const textPart = parts.find((part) => part && typeof part.text === 'string');
    emitAnnotationDebug('parse.extract_gemini_text', {
        candidatesCount: candidates.length,
        candidatesPreview: candidates.slice(0, 1),
        hasContent: !!content,
        contentPreview: content,
        partsCount: parts.length,
        partsPreview: parts.slice(0, 3),
        foundTextPart: !!textPart,
        textLength: textPart && typeof textPart.text === 'string' ? textPart.text.length : 0,
        textPreview: textPart && typeof textPart.text === 'string' ? textPart.text.slice(0, 1000) : ''
    });
    if (!textPart) {
        console.warn('[annotation-api-client] 200 response missing Gemini text part', {
            candidates,
            content,
            parts
        });
        recordRunDiagnostic(options, 'response parse failed', {
            reason: 'missing_text_part',
            candidatesCount: candidates.length,
            partsCount: parts.length
        });
        throw createClientError('parse_failure', 'Gemini response is missing text content.', {
            failureType: 'parse_failure'
        });
    }
    return textPart.text;
}

function tryParseJson(text) {
    try {
        return { ok: true, value: JSON.parse(text) };
    } catch (error) {
        console.warn('[annotation-api-client] JSON.parse failed', {
            errorName: normalizeText(error && error.name),
            errorMessage: normalizeText(error && error.message),
            inputLength: String(text || '').length,
            inputPreview: String(text || '').slice(0, 1000)
        });
        return { ok: false, error };
    }
}

function extractCodeFence(text) {
    const match = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    return match ? match[1].trim() : '';
}

function extractJsonObject(text) {
    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    if (firstBrace < 0 || lastBrace <= firstBrace) return '';
    return text.slice(firstBrace, lastBrace + 1).trim();
}

function limitSentenceLikeText(text, maxSentences, maxChars) {
    if (!text) return '';
    const collapsed = normalizeText(text);
    const parts = collapsed
        .split(/(?<=[.!?。！？])/)
        .map((part) => part.trim())
        .filter(Boolean);
    const kept = (parts.length ? parts : [collapsed]).slice(0, maxSentences).join('');
    if (kept.length <= maxChars) return kept;
    return `${kept.slice(0, maxChars).trim()}...`;
}

function normalizeHeaders(extraHeaders) {
    if (!extraHeaders || typeof extraHeaders !== 'object') return {};
    return Object.keys(extraHeaders).reduce((result, key) => {
        const value = extraHeaders[key];
        if (value == null || !String(value).trim()) return result;
        result[key] = String(value);
        return result;
    }, {});
}

function normalizeBaseUrl(value) {
    return String(value || DEFAULT_GEMINI_BASE_URL).replace(/\/+$/, '');
}

function normalizeText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function toInteger(value, fallback) {
    const next = Number(value);
    return Number.isInteger(next) ? next : fallback;
}

function recordRunDiagnostic(options, event, payload) {
    if (!RUN_DIAGNOSTICS || typeof RUN_DIAGNOSTICS.record !== 'function') return;
    const runId = normalizeText(options && options.runId);
    if (!runId) return;
    const scope = options && options.diagnosticScope && typeof options.diagnosticScope === 'object'
        ? options.diagnosticScope
        : options && options.context && typeof options.context === 'object'
            ? options.context
            : {};
    try {
        RUN_DIAGNOSTICS.record(scope, runId, event, payload);
    } catch (error) {}
}

function createClientError(clientErrorType, message, extra = {}) {
    const error = new Error(message);
    error.clientErrorType = clientErrorType;
    Object.assign(error, extra);
    return error;
}

function summarizeErrorBody(bodyText) {
    const normalized = normalizeText(bodyText || '');
    if (!normalized) return '';
    if (normalized.length <= 240) return normalized;
    return `${normalized.slice(0, 240).trim()}...`;
}

function extractProviderErrorCode(bodyText) {
    const parsed = tryParseJson(bodyText);
    if (!parsed.ok || !parsed.value || typeof parsed.value !== 'object') return '';
    const root = parsed.value.error && typeof parsed.value.error === 'object' ? parsed.value.error : parsed.value;
    return normalizeText(root.code || root.status || root.error || '');
}

function classifyUnknownError(error, requestIssued) {
    if (error && normalizeText(error.name) === 'TypeError' && requestIssued) return 'network';
    if (error && normalizeText(error.name) === 'SyntaxError') return 'parse_failure';
    return requestIssued ? 'request_failed' : 'request_not_sent';
}

function readFallbackConfig(override) {
    const global = (typeof window !== 'undefined') ? window : (typeof globalThis !== 'undefined' ? globalThis : {});
    const raw = override || global.__ANNOTATION_API_CONFIG__ || null;
    if (!raw || typeof raw !== 'object') {
        return { state: 'unconfigured', reason: 'missing-config', config: null };
    }
    const mode = normalizeText(raw.mode || 'unconfigured').toLowerCase();
    if (mode === 'mock') {
        return { state: 'mock', reason: 'mock-mode', config: raw };
    }
    if (mode !== 'real') {
        return { state: 'unconfigured', reason: 'invalid-mode', config: null };
    }
    if (!raw.provider || !raw.apiKey) {
        return { state: 'unconfigured', reason: 'missing-required-fields', config: null };
    }
    return { state: 'ready', reason: 'ok', config: raw };
}
