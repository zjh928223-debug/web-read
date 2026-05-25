'use strict';

import * as STORAGE from './storage.js';
import * as BLOCK_PLANNER from './block-planner.js';
import * as PROMPT_BUILDER from './prompt-builder.js';
import * as API_CLIENT from './api-client.js';
import * as DIFF_HELPER from './diff.js';
import * as DIAGNOSTICS from './diagnostics.js';
import * as DIAGNOSTIC_RECORDS from './diagnostics-records.js';
import * as RUN_DIAGNOSTICS from './run-diagnostics.js';

const MAX_SCHEDULED_BLOCKS = 3;
const RUN_REQUEST_BUDGET = 6;
const REQUEST_START_INTERVAL_MS = 16000;
const RATE_LIMIT_BACKOFF_MIN_MS = 30000;
const RATE_LIMIT_BACKOFF_MAX_MS = 60000;
const PROVIDER_BUSY_BACKOFF_MIN_MS = 10000;
const PROVIDER_BUSY_BACKOFF_MAX_MS = 20000;
const MAX_RETRY_ATTEMPTS_PER_BLOCK = 1;

let activeRun = null;

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

export async function startFullArticle(context = {}, callbacks = {}) {
    if (activeRun && !activeRun.finished) return buildBusyResult(activeRun);

    const plannerContext = isObject(context) ? context : {};
    const diagnosticScope = buildStorageContext(plannerContext);
    const apiConfig = readApiConfig();
    const runId = createDiagnosticsRun(diagnosticScope, {
        sourceMode: normalizeText(plannerContext.sourceMode || ''),
        totalBlocks: toInteger(plannerContext.totalBlocks, 0),
        marksCount: toInteger(plannerContext.stats && plannerContext.stats.marks, 0),
        requestBudget: RUN_REQUEST_BUDGET,
        scheduledBlockLimit: MAX_SCHEDULED_BLOCKS
    });
    recordRunDiagnostic(diagnosticScope, runId, 'config resolved', {
        configState: normalizeText(apiConfig && apiConfig.state),
        provider: normalizeText(apiConfig && apiConfig.config && apiConfig.config.provider),
        model: normalizeText(apiConfig && apiConfig.config && apiConfig.config.model),
        sourceMode: normalizeText(plannerContext.sourceMode || ''),
        totalBlocks: toInteger(plannerContext.totalBlocks, 0)
    });
    emitDiagnostics('controller.start', {
        scope: diagnosticScope,
        runId,
        sourceMode: normalizeText(plannerContext.sourceMode || ''),
        totalBlocks: toInteger(plannerContext.totalBlocks, 0),
        marksCount: toInteger(plannerContext.stats && plannerContext.stats.marks, 0),
        requestBudget: RUN_REQUEST_BUDGET,
        scheduledBlockLimit: MAX_SCHEDULED_BLOCKS
    });

    if (apiConfig.state === 'unconfigured') {
        const result = buildUnconfiguredResult(apiConfig);
        await finishEarly(diagnosticScope, runId, callbacks, result);
        return result;
    }

    const existingBundle = await loadExistingGeneratedBundle(plannerContext, apiConfig, { runId });
    const diffResult = buildDiffResult(plannerContext, existingBundle);
    emitDiagnostics('controller.diff_result', {
        scope: diagnosticScope,
        runId,
        allTargetsCount: diffResult.allTargetsCount,
        generatedTargetsCount: diffResult.generatedTargetsCount,
        missingTargetsCount: arrayLength(diffResult.missingTargets),
        generatedBaselineCount: arrayLength(existingBundle && existingBundle.items),
        targetSummary: DIAGNOSTICS && typeof DIAGNOSTICS.summarizeTargets === 'function'
            ? DIAGNOSTICS.summarizeTargets(diffResult.missingTargets)
            : undefined
    });

    if (!diffResult.allTargetsCount) {
        const result = buildNoTargetsResult(existingBundle);
        emitDiagnostics('controller.no_targets', { scope: diagnosticScope, runId, state: result.state });
        await finishEarly(diagnosticScope, runId, callbacks, result);
        return result;
    }

    if (!arrayLength(diffResult.missingTargets)) {
        const result = buildUpToDateResult(existingBundle, diffResult);
        emitDiagnostics('controller.up_to_date', {
            scope: diagnosticScope,
            runId,
            state: result.state,
            noRequest: true,
            allTargetsCount: diffResult.allTargetsCount,
            generatedTargetsCount: diffResult.generatedTargetsCount
        });
        await finishEarly(diagnosticScope, runId, callbacks, result);
        return result;
    }

    const plan = BLOCK_PLANNER && typeof BLOCK_PLANNER.planFromContext === 'function'
        ? BLOCK_PLANNER.planFromContext(plannerContext, { targetFilterKeys: diffResult.missingTargetKeys })
        : { blocks: [] };
    const allBlocks = Array.isArray(plan.blocks) ? plan.blocks : [];
    const scheduledBlocks = buildScheduledBlocks(allBlocks, MAX_SCHEDULED_BLOCKS, diagnosticScope, runId);
    const totalBlocks = scheduledBlocks.length;
    scheduledBlocks.forEach((scheduled, index) => {
        recordRunDiagnostic(diagnosticScope, runId, 'provider request scheduled', {
            blockId: normalizeText(scheduled && scheduled.block && scheduled.block.id),
            blockIndex: index,
            totalBlocks,
            targetCount: arrayLength(scheduled && scheduled.promptPayload && scheduled.promptPayload.targets)
        });
    });

    emitDiagnostics('controller.plan_ready', {
        scope: diagnosticScope,
        runId,
        plannedBlockCount: allBlocks.length,
        scheduledBlockCount: totalBlocks,
        missingTargetsCount: arrayLength(diffResult.missingTargets),
        requestedTargetCount: arrayLength(diffResult.missingTargetKeys),
        requestBudget: RUN_REQUEST_BUDGET,
        scheduledBlockLimit: MAX_SCHEDULED_BLOCKS
    });

    const generatedBundle = createBundleFromExistingBundle(existingBundle, plannerContext, apiConfig);
    initializeRunStatus(generatedBundle, diffResult, runId, totalBlocks);

    const progressStore = createProgressStore(totalBlocks);
    const aggregateCounts = { returnedCount: 0, normalizedCount: 0, insertedCount: 0, skippedCount: 0, requestCount: 0, actualPostCount: 0, retryCount: 0 };
    const failureSummary = { primaryType: '', primaryMessage: '', counts: {} };
    activeRun = createActiveRun(runId, diagnosticScope);

    notify(callbacks, 'onStateChange', buildStateSnapshot({ state: totalBlocks ? 'ready' : 'no-targets', total: totalBlocks, completed: 0, failed: 0 }));
    notify(callbacks, 'onStatus', buildStateSnapshot({ state: totalBlocks ? 'ready' : 'no-targets', total: totalBlocks, completed: 0, failed: 0 }));

    if (!totalBlocks) {
        const result = buildNoTargetsResult(generatedBundle);
        result.finalRunReason = 'complete';
        await finishRun(plannerContext, diagnosticScope, runId, callbacks, generatedBundle, progressStore, aggregateCounts, diffResult, failureSummary, result, activeRun);
        return result;
    }

    let preferredFinalReason = '';
    try {
        for (let index = 0; index < scheduledBlocks.length; index++) {
            const scheduled = scheduledBlocks[index];
            if (shouldStopRun(activeRun)) {
                preferredFinalReason = handleStop(activeRun, diagnosticScope, runId, false);
                break;
            }
            if (aggregateCounts.actualPostCount >= RUN_REQUEST_BUDGET) {
                preferredFinalReason = 'budget_exhausted';
                break;
            }
            const execution = await executeScheduledBlock({
                scheduled,
                blockIndex: index,
                totalBlocks,
                plannerContext,
                diagnosticScope,
                runId,
                generatedBundle,
                aggregateCounts,
                progressStore,
                callbacks
            });
            if (execution.stopHandled) {
                preferredFinalReason = handleStop(activeRun, diagnosticScope, runId, execution.requestAborted);
                break;
            }
            if (!execution.ok) {
                recordFailure(failureSummary, execution.failureDetails);
                progressStore.markFailed(scheduled.block.id);
                generatedBundle.status.lastFailureType = execution.failureDetails.failureType;
                generatedBundle.status.lastFailureMessage = buildFailureFeedbackMessage(execution.failureDetails.failureType, execution.failureDetails.errorMessage);
                updateBundleProgress(generatedBundle, progressStore, aggregateCounts, activeRun);
                generatedBundle.updatedAt = new Date().toISOString();
                await persistBundle(plannerContext, generatedBundle, { runId });
                notify(callbacks, 'onBlockFailed', {
                    blockId: scheduled.block.id,
                    index,
                    totalBlocks,
                    error: execution.error,
                    failureType: execution.failureDetails.failureType,
                    generatedBundle
                });
                notify(callbacks, 'onProgress', progressStore.snapshot());
                notify(callbacks, 'onStatus', {
                    state: 'running',
                    ...progressStore.snapshot(),
                    requestCount: aggregateCounts.requestCount,
                    scheduledBlockCount: totalBlocks,
                    actualPostCount: aggregateCounts.actualPostCount,
                    retryCount: aggregateCounts.retryCount,
                    requestBudget: RUN_REQUEST_BUDGET,
                    message: buildFailureContinueMessage(execution.failureDetails.failureType, aggregateCounts.requestCount, RUN_REQUEST_BUDGET)
                });
                continue;
            }

            progressStore.markComplete(scheduled.block.id);
            generatedBundle.status.lastFailureType = '';
            generatedBundle.status.lastFailureMessage = '';
            updateBundleProgress(generatedBundle, progressStore, aggregateCounts, activeRun);
            generatedBundle.updatedAt = new Date().toISOString();
            await persistBundle(plannerContext, generatedBundle, { runId });
            notify(callbacks, 'onBlockComplete', {
                blockId: scheduled.block.id,
                index,
                totalBlocks,
                items: execution.items,
                generatedBundle
            });
            notify(callbacks, 'onProgress', progressStore.snapshot());
            notify(callbacks, 'onStatus', {
                state: 'running',
                ...progressStore.snapshot(),
                requestCount: aggregateCounts.requestCount,
                scheduledBlockCount: totalBlocks,
                actualPostCount: aggregateCounts.actualPostCount,
                retryCount: aggregateCounts.retryCount,
                requestBudget: RUN_REQUEST_BUDGET,
                message: buildRunningMessage(aggregateCounts.requestCount, RUN_REQUEST_BUDGET)
            });
        }

        const result = buildFinalResult({
            plannerContext,
            diagnosticScope,
            runId,
            callbacks,
            generatedBundle,
            progressStore,
            aggregateCounts,
            initialDiffResult: diffResult,
            failureSummary,
            preferredFinalReason,
            run: activeRun
        });
        await finishRun(plannerContext, diagnosticScope, runId, callbacks, generatedBundle, progressStore, aggregateCounts, diffResult, failureSummary, result, activeRun);
        return result;
    } finally {
        if (activeRun && activeRun.runId === runId) activeRun.finished = true;
    }
}

export function requestStop() {
    if (!activeRun || activeRun.finished) return { accepted: false, state: 'idle' };
    activeRun.stopRequested = true;
    emitDiagnostics('controller.stop_requested', {
        scope: activeRun.scope,
        runId: activeRun.runId,
        requestBudget: RUN_REQUEST_BUDGET,
        requestCount: activeRun.requestCount,
        scheduledBlockCount: activeRun.scheduledBlockCount,
        actualPostCount: activeRun.actualPostCount,
        retryCount: activeRun.retryCount,
        currentRequestInFlight: !!activeRun.currentRequestInFlight,
        nextAllowedStartAt: activeRun.nextAllowedStartAt || ''
    });
    if (activeRun.currentAbortController && typeof activeRun.currentAbortController.abort === 'function') {
        emitAnnotationDebug('external signal abort', {
            runId: activeRun.runId,
            scope: activeRun.scope,
            currentRequestInFlight: !!activeRun.currentRequestInFlight,
            elapsedMs: activeRun.lastRequestStartMs ? Math.max(0, Date.now() - activeRun.lastRequestStartMs) : 0,
            abortTrace: new Error('annotation-generation-controller requestStop').stack || ''
        });
        try { activeRun.currentAbortController.abort(); } catch (error) {}
    }
    return {
        accepted: true,
        state: activeRun.currentRequestInFlight ? 'stopping' : 'stopped',
        runId: activeRun.runId
    };
}

export function getActiveRunInfo() {
    if (!activeRun || activeRun.finished) return null;
    return {
        runId: activeRun.runId,
        state: activeRun.stopRequested ? (activeRun.currentRequestInFlight ? 'stopping' : 'stopped') : (activeRun.waiting ? 'waiting-next-block' : 'running'),
        requestBudget: RUN_REQUEST_BUDGET,
        requestCount: activeRun.requestCount,
        scheduledBlockCount: activeRun.scheduledBlockCount,
        actualPostCount: activeRun.actualPostCount,
        retryCount: activeRun.retryCount,
        stopRequested: !!activeRun.stopRequested,
        stopHandled: !!activeRun.stopHandled,
        currentRequestInFlight: !!activeRun.currentRequestInFlight,
        nextAllowedStartAt: activeRun.nextAllowedStartAt || ''
    };
}

export { getConfigState };

export function isConfigured() {
    return getConfigState() === 'configured';
}

async function finishEarly(scope, runId, callbacks, result) {
    finalizeDiagnosticsRun(scope, runId, result);
    notify(callbacks, 'onStateChange', buildStateSnapshot(result));
    notify(callbacks, 'onStatus', buildStateSnapshot(result));
    notify(callbacks, 'onComplete', result);
}

function buildScheduledBlocks(allBlocks, requestBudget, diagnosticScope, runId) {
    const scheduled = [];
    const blocks = Array.isArray(allBlocks) ? allBlocks : [];
    for (let index = 0; index < blocks.length; index++) {
        const block = blocks[index];
        const promptPayload = PROMPT_BUILDER && typeof PROMPT_BUILDER.buildPromptPayload === 'function'
            ? PROMPT_BUILDER.buildPromptPayload(block, {
                blockIndex: index,
                documentId: plannerContext && plannerContext.documentId
            })
            : { skipped: true, reason: 'no-builder', targets: [], blockId: block && block.id };
        if (promptPayload.skipped) {
            emitDiagnostics('controller.block_skipped', {
                scope: diagnosticScope,
                runId,
                blockId: normalizeText(block && block.id),
                blockIndex: index,
                reason: normalizeText(promptPayload.reason || 'skipped')
            });
            continue;
        }
        scheduled.push({ block, promptPayload });
        if (scheduled.length >= requestBudget) break;
    }
    return scheduled;
}

async function waitForNextAllowedStart(run, callbacks, progressStore, meta = {}) {
    if (!run) return { stopped: false };
    const throttleUntilMs = run.lastRequestStartMs ? (run.lastRequestStartMs + REQUEST_START_INTERVAL_MS) : 0;
    const backoffUntilMs = toInteger(run.backoffUntilMs, 0);
    const nextAllowedMs = Math.max(throttleUntilMs, backoffUntilMs);
    if (!nextAllowedMs) return { stopped: false };
    const nextAllowedStartAt = new Date(nextAllowedMs).toISOString();
    run.nextAllowedStartAt = nextAllowedStartAt;
    if (Date.now() >= nextAllowedMs) return { stopped: false };
    run.waiting = true;
    emitDiagnostics('controller.waiting_next_block', {
        scope: run.scope,
        runId: run.runId,
        blockId: normalizeText(meta.blockId),
        blockIndex: toInteger(meta.blockIndex, 0),
        totalBlocks: toInteger(meta.totalBlocks, 0),
        attempt: toInteger(meta.attempt, 0),
        waitReason: normalizeText(meta.waitReason) || (backoffUntilMs > throttleUntilMs ? 'provider_backoff' : 'throttle'),
        requestBudget: RUN_REQUEST_BUDGET,
        requestCount: run.requestCount,
        scheduledBlockCount: run.scheduledBlockCount,
        actualPostCount: run.actualPostCount,
        retryCount: run.retryCount,
        nextAllowedStartAt
    });
    while (Date.now() < nextAllowedMs) {
        if (shouldStopRun(run)) {
            run.waiting = false;
            return { stopped: true };
        }
        const remainingMs = Math.max(0, nextAllowedMs - Date.now());
        notify(callbacks, 'onStatus', {
            state: 'waiting-next-block',
            ...progressStore.snapshot(),
            requestBudget: RUN_REQUEST_BUDGET,
            requestCount: run.requestCount,
            scheduledBlockCount: run.scheduledBlockCount,
            actualPostCount: run.actualPostCount,
            retryCount: run.retryCount,
            nextAllowedStartAt,
            message: `Cooling down. Next request in ${Math.ceil(remainingMs / 1000)}s.`
        });
        await delay(Math.min(remainingMs, 250));
    }
    run.waiting = false;
    return { stopped: false };
}

async function executeScheduledBlock(params) {
    const {
        scheduled,
        blockIndex,
        totalBlocks,
        plannerContext,
        diagnosticScope,
        runId,
        generatedBundle,
        aggregateCounts,
        progressStore,
        callbacks
    } = params;
    const block = scheduled.block;
    const promptPayload = scheduled.promptPayload;

    progressStore.markRunning(block.id);
    emitDiagnostics('controller.block_start', {
        scope: diagnosticScope,
        runId,
        blockId: normalizeText(block && block.id),
        blockIndex,
        totalBlocks,
        scheduledBlockCount: totalBlocks,
        targetCount: arrayLength(promptPayload && promptPayload.targets),
        requestBudget: RUN_REQUEST_BUDGET,
        requestCount: aggregateCounts.requestCount,
        actualPostCount: aggregateCounts.actualPostCount,
        retryCount: aggregateCounts.retryCount
    });

    let attempt = 0;
    while (attempt <= MAX_RETRY_ATTEMPTS_PER_BLOCK) {
        attempt += 1;
        if (aggregateCounts.actualPostCount >= RUN_REQUEST_BUDGET) {
            return {
                ok: false,
                error: createSyntheticControllerError('budget_exhausted', 'Run request budget exhausted before sending the next POST.'),
                failureDetails: buildSyntheticFailureDetails('budget_exhausted', 'Run request budget exhausted before sending the next POST.'),
                stopHandled: false,
                requestAborted: false
            };
        }

        const waitResult = await waitForNextAllowedStart(activeRun, callbacks, progressStore, {
            blockId: block && block.id,
            blockIndex,
            totalBlocks,
            attempt,
            waitReason: activeRun.backoffUntilMs ? 'provider_backoff' : 'throttle'
        });
        if (waitResult.stopped) {
            return {
                ok: false,
                error: createSyntheticControllerError('aborted', 'Run stopped before sending the next POST.'),
                failureDetails: buildSyntheticFailureDetails('aborted', 'Run stopped before sending the next POST.'),
                stopHandled: true,
                requestAborted: false
            };
        }

        const requestIndex = aggregateCounts.actualPostCount + 1;
        const isRetryAttempt = attempt > 1;
        const requestStartedAt = new Date().toISOString();
        const requestStartedMs = Date.now();
        const nextAllowedStartAt = new Date(requestStartedMs + REQUEST_START_INTERVAL_MS).toISOString();

        activeRun.requestCount = requestIndex;
        activeRun.scheduledBlockCount = totalBlocks;
        activeRun.actualPostCount = requestIndex;
        if (isRetryAttempt) activeRun.retryCount += 1;
        activeRun.lastRequestStartMs = requestStartedMs;
        activeRun.nextAllowedStartAt = nextAllowedStartAt;
        activeRun.backoffUntilMs = 0;
        activeRun.backoffReason = '';
        activeRun.currentAbortController = typeof AbortController === 'function' ? new AbortController() : null;
        activeRun.currentRequestInFlight = true;
        aggregateCounts.requestCount = requestIndex;
        aggregateCounts.actualPostCount = requestIndex;
        if (isRetryAttempt) aggregateCounts.retryCount += 1;

        emitDiagnostics('controller.provider_request', {
            scope: diagnosticScope,
            runId,
            blockId: normalizeText(block && block.id),
            blockIndex,
            totalBlocks,
            scheduledBlockCount: totalBlocks,
            targetCount: arrayLength(promptPayload && promptPayload.targets),
            requestBudget: RUN_REQUEST_BUDGET,
            requestCount: requestIndex,
            actualPostCount: requestIndex,
            retryCount: aggregateCounts.retryCount,
            requestIndex,
            attempt,
            isRetryAttempt,
            requestStartedAt,
            nextAllowedStartAt
        });

        try {
            const providerResult = await API_CLIENT.generateAnnotations(promptPayload, {
                block,
                context: plannerContext,
                diagnosticScope,
                runId,
                requestIndex,
                attempt,
                requestBudget: RUN_REQUEST_BUDGET,
                abortSignal: activeRun.currentAbortController ? activeRun.currentAbortController.signal : null
            });
            emitAnnotationDebug('controller.provider_result_raw', {
                blockId: normalizeText(block && block.id),
                requestIndex,
                attempt,
                provider: normalizeText(providerResult && providerResult.provider),
                rawItemCount: arrayLength(providerResult && providerResult.items),
                requestMeta: isObject(providerResult && providerResult.requestMeta) ? providerResult.requestMeta : {}
            });
            const items = normalizeProviderItems(providerResult, block, promptPayload);
            const requestMeta = isObject(providerResult && providerResult.requestMeta) ? providerResult.requestMeta : {};
            aggregateCounts.returnedCount += arrayLength(providerResult && providerResult.items);
            aggregateCounts.normalizedCount += items.length;
            if (!arrayLength(providerResult && providerResult.items)) {
                console.warn('[AnnotationGenerationController] provider returned empty items', {
                    blockId: normalizeText(block && block.id),
                    requestIndex,
                    attempt,
                    httpStatus: toInteger(requestMeta.httpStatus, 0),
                    requestUrl: normalizeText(requestMeta.requestUrl)
                });
            }
            if (!items.length) {
                console.warn('[AnnotationGenerationController] provider result normalized to empty items', {
                    blockId: normalizeText(block && block.id),
                    requestIndex,
                    attempt,
                    rawItemCount: arrayLength(providerResult && providerResult.items),
                    httpStatus: toInteger(requestMeta.httpStatus, 0)
                });
            }
            emitDiagnostics('controller.provider_result', {
                scope: diagnosticScope,
                runId,
                blockId: normalizeText(block && block.id),
                blockIndex,
                totalBlocks,
                scheduledBlockCount: totalBlocks,
                requestBudget: RUN_REQUEST_BUDGET,
                requestCount: requestIndex,
                actualPostCount: requestIndex,
                retryCount: aggregateCounts.retryCount,
                requestIndex,
                attempt,
                isRetryAttempt,
                requestIssued: !!requestMeta.requestIssued,
                httpStatus: toInteger(requestMeta.httpStatus, 0),
                requestStartedAt: requestMeta.requestStartedAt || requestStartedAt,
                requestFinishedAt: requestMeta.requestFinishedAt || '',
                durationMs: toInteger(requestMeta.durationMs, 0),
                returnedCount: arrayLength(providerResult && providerResult.items),
                normalizedCount: items.length,
                nextAllowedStartAt,
                stopRequested: !!activeRun.stopRequested,
                requestAborted: false
            });
            const mergeStats = appendGeneratedItems(generatedBundle, items);
            aggregateCounts.insertedCount += mergeStats.insertedCount;
            aggregateCounts.skippedCount += mergeStats.skippedCount;
            emitDiagnostics('controller.merge_result', {
                scope: diagnosticScope,
                runId,
                blockId: normalizeText(block && block.id),
                blockIndex,
                requestBudget: RUN_REQUEST_BUDGET,
                requestCount: requestIndex,
                actualPostCount: requestIndex,
                retryCount: aggregateCounts.retryCount,
                requestIndex,
                attempt,
                isRetryAttempt,
                beforeItemCount: mergeStats.beforeItemCount,
                afterItemCount: mergeStats.afterItemCount,
                insertedCount: mergeStats.insertedCount,
                skippedCount: mergeStats.skippedCount,
                skippedKeys: mergeStats.skippedKeys
            });
            if (mergeStats.persistSkippedReason) {
                recordRunDiagnostic(diagnosticScope, runId, 'persist skipped', {
                    blockId: normalizeText(block && block.id),
                    blockIndex,
                    requestIndex,
                    reason: mergeStats.persistSkippedReason,
                    beforeItemCount: mergeStats.beforeItemCount,
                    afterItemCount: mergeStats.afterItemCount,
                    insertedCount: mergeStats.insertedCount,
                    skippedCount: mergeStats.skippedCount,
                    skippedKeys: mergeStats.skippedKeys
                });
            }
            recordRunDiagnostic(diagnosticScope, runId, 'block completed', {
                blockId: normalizeText(block && block.id),
                blockIndex,
                requestIndex,
                returnedCount: arrayLength(providerResult && providerResult.items),
                normalizedCount: items.length,
                insertedCount: mergeStats.insertedCount,
                skippedCount: mergeStats.skippedCount
            });
            return { ok: true, items };
        } catch (error) {
            const failureDetails = buildFailureDetails(error);
            const stopHandled = !!activeRun.stopRequested && failureDetails.failureType === 'aborted';
            if (stopHandled) activeRun.requestAborted = true;
            emitDiagnostics('controller.block_failed', {
                scope: diagnosticScope,
                runId,
                blockId: normalizeText(block && block.id),
                blockIndex,
                totalBlocks,
                scheduledBlockCount: totalBlocks,
                requestBudget: RUN_REQUEST_BUDGET,
                requestCount: requestIndex,
                actualPostCount: requestIndex,
                retryCount: aggregateCounts.retryCount,
                requestIndex,
                attempt,
                isRetryAttempt,
                failureType: failureDetails.failureType,
                errorMessage: failureDetails.errorMessage,
                providerErrorCode: failureDetails.providerErrorCode,
                errorBodySummary: failureDetails.errorBodySummary,
                requestIssued: failureDetails.requestIssued,
                httpStatus: failureDetails.httpStatus,
                requestStartedAt: failureDetails.requestStartedAt || requestStartedAt,
                requestFinishedAt: failureDetails.requestFinishedAt || '',
                durationMs: failureDetails.durationMs,
                nextAllowedStartAt,
                stopRequested: !!activeRun.stopRequested,
                requestAborted: stopHandled
            });

            const backoff = shouldRetryWithBackoff(failureDetails, attempt);
            if (!stopHandled && backoff) {
                activeRun.backoffUntilMs = Date.now() + backoff.backoffMs;
                activeRun.backoffReason = backoff.reason;
                activeRun.nextAllowedStartAt = new Date(activeRun.backoffUntilMs).toISOString();
                emitDiagnostics('controller.provider_backoff', {
                    scope: diagnosticScope,
                    runId,
                    blockId: normalizeText(block && block.id),
                    blockIndex,
                    totalBlocks,
                    scheduledBlockCount: totalBlocks,
                    requestBudget: RUN_REQUEST_BUDGET,
                    requestCount: requestIndex,
                    actualPostCount: requestIndex,
                    retryCount: aggregateCounts.retryCount,
                    requestIndex,
                    attempt,
                    isRetryAttempt,
                    httpStatus: failureDetails.httpStatus,
                    failureType: failureDetails.failureType,
                    triggeredBackoff: true,
                    backoffReason: backoff.reason,
                    backoffMs: backoff.backoffMs,
                    nextAllowedStartAt: activeRun.nextAllowedStartAt
                });
                continue;
            }

            return { ok: false, error, failureDetails, stopHandled, requestAborted: stopHandled };
        } finally {
            activeRun.currentRequestInFlight = false;
            activeRun.currentAbortController = null;
        }
    }

    return {
        ok: false,
        error: createSyntheticControllerError('request_failed', 'Request failed after retries.'),
        failureDetails: buildSyntheticFailureDetails('request_failed', 'Request failed after retries.'),
        stopHandled: false,
        requestAborted: false
    };
}

function buildFinalResult(params) {
    const {
        generatedBundle,
        progressStore,
        aggregateCounts,
        initialDiffResult,
        failureSummary,
        preferredFinalReason,
        run
    } = params;
    const finalDiffResult = buildDiffResult(params.plannerContext, generatedBundle);
    generatedBundle.status.requestedTargetCount = arrayLength(initialDiffResult.missingTargets);
    generatedBundle.status.returnedCount = aggregateCounts.returnedCount;
    generatedBundle.status.normalizedCount = aggregateCounts.normalizedCount;
    generatedBundle.status.insertedCount = aggregateCounts.insertedCount;
    generatedBundle.status.skippedCount = aggregateCounts.skippedCount;
    generatedBundle.status.requestBudget = RUN_REQUEST_BUDGET;
    generatedBundle.status.requestCount = aggregateCounts.requestCount;
    generatedBundle.status.scheduledBlockCount = progressStore.totalBlocks;
    generatedBundle.status.actualPostCount = aggregateCounts.actualPostCount;
    generatedBundle.status.retryCount = aggregateCounts.retryCount;
    generatedBundle.status.generatedTargetsCount = finalDiffResult.generatedTargetsCount;
    generatedBundle.status.missingTargetsCount = arrayLength(finalDiffResult.missingTargets);
    generatedBundle.status.allTargetsCount = finalDiffResult.allTargetsCount;
    generatedBundle.status.failureCounts = { ...failureSummary.counts };
    generatedBundle.status.lastFailureType = failureSummary.primaryType || generatedBundle.status.lastFailureType || '';
    generatedBundle.status.lastFailureMessage = failureSummary.primaryMessage || generatedBundle.status.lastFailureMessage || '';
    generatedBundle.status.stopRequested = !!(run && run.stopRequested);
    generatedBundle.status.stopHandled = !!(run && run.stopHandled);
    generatedBundle.status.requestAborted = !!(run && run.requestAborted);
    generatedBundle.status.nextAllowedStartAt = run && run.nextAllowedStartAt || '';
    const finalRunReason = deriveFinalRunReason({
        requestedStop: !!(run && run.stopRequested),
        stopHandled: !!(run && run.stopHandled),
        requestCount: aggregateCounts.requestCount,
        requestBudget: RUN_REQUEST_BUDGET,
        scheduledBlockCount: progressStore.totalBlocks,
        completedBlocks: progressStore.completedBlocks,
        failedBlocks: progressStore.failedBlocks,
        missingTargetsCount: arrayLength(finalDiffResult.missingTargets)
    }, preferredFinalReason);
    const state = deriveBundleState(progressStore, generatedBundle, finalRunReason);
    emitAnnotationDebug('controller.final_result_summary', {
        finalRunReason,
        state,
        completedBlocks: progressStore.completedBlocks,
        failedBlocks: progressStore.failedBlocks,
        requestedTargetCount: generatedBundle.status.requestedTargetCount,
        returnedCount: generatedBundle.status.returnedCount,
        normalizedCount: generatedBundle.status.normalizedCount,
        insertedCount: generatedBundle.status.insertedCount,
        skippedCount: generatedBundle.status.skippedCount,
        generatedTargetsCount: generatedBundle.status.generatedTargetsCount,
        missingTargetsCount: generatedBundle.status.missingTargetsCount
    });
    if (state === 'failed' || state === 'incomplete' || generatedBundle.status.normalizedCount === 0 || generatedBundle.status.insertedCount === 0) {
        console.warn('[AnnotationGenerationController] final result indicates failed/empty/skipped path', {
            finalRunReason,
            state,
            completedBlocks: progressStore.completedBlocks,
            failedBlocks: progressStore.failedBlocks,
            requestedTargetCount: generatedBundle.status.requestedTargetCount,
            returnedCount: generatedBundle.status.returnedCount,
            normalizedCount: generatedBundle.status.normalizedCount,
            insertedCount: generatedBundle.status.insertedCount,
            skippedCount: generatedBundle.status.skippedCount,
            generatedTargetsCount: generatedBundle.status.generatedTargetsCount,
            missingTargetsCount: generatedBundle.status.missingTargetsCount,
            failureType: generatedBundle.status.lastFailureType || '',
            failureMessage: generatedBundle.status.lastFailureMessage || ''
        });
    }
    return {
        state,
        total: progressStore.totalBlocks,
        totalBlocks: progressStore.totalBlocks,
        completed: progressStore.completedBlocks,
        completedBlocks: progressStore.completedBlocks,
        failed: progressStore.failedBlocks,
        failedBlocks: progressStore.failedBlocks,
        requestedTargetCount: generatedBundle.status.requestedTargetCount,
        returnedCount: generatedBundle.status.returnedCount,
        normalizedCount: generatedBundle.status.normalizedCount,
        insertedCount: generatedBundle.status.insertedCount,
        skippedCount: generatedBundle.status.skippedCount,
        generatedTargetsCount: generatedBundle.status.generatedTargetsCount,
        missingTargetsCount: generatedBundle.status.missingTargetsCount,
        requestBudget: RUN_REQUEST_BUDGET,
        requestCount: aggregateCounts.requestCount,
        scheduledBlockCount: progressStore.totalBlocks,
        actualPostCount: aggregateCounts.actualPostCount,
        retryCount: aggregateCounts.retryCount,
        runId: run && run.runId || '',
        failureType: generatedBundle.status.lastFailureType || '',
        failureMessage: generatedBundle.status.lastFailureMessage || '',
        finalRunReason,
        stopRequested: !!(run && run.stopRequested),
        stopHandled: !!(run && run.stopHandled),
        requestAborted: !!(run && run.requestAborted),
        generatedBundle,
        message: buildFinalMessage({ progressStore, bundle: generatedBundle, finalDiffResult, finalRunReason })
    };
}

async function finishRun(plannerContext, diagnosticScope, runId, callbacks, generatedBundle, progressStore, aggregateCounts, diffResult, failureSummary, result, run) {
    generatedBundle.status.state = result.state;
    generatedBundle.status.totalBlocks = result.totalBlocks;
    generatedBundle.status.completedBlocks = result.completedBlocks;
    generatedBundle.status.failedBlocks = result.failedBlocks;
    generatedBundle.status.runningBlockId = null;
    generatedBundle.status.finalRunState = result.state;
    generatedBundle.status.finalRunReason = result.finalRunReason;
    generatedBundle.updatedAt = new Date().toISOString();
    try {
        await persistBundle(plannerContext, generatedBundle, { runId });
    } finally {
        emitDiagnostics('controller.complete', {
            scope: diagnosticScope,
            runId,
            state: result.state,
            finalRunState: result.state,
            finalRunReason: result.finalRunReason,
            requestBudget: RUN_REQUEST_BUDGET,
            requestCount: result.requestCount,
            scheduledBlockCount: toInteger(result && result.scheduledBlockCount, 0),
            actualPostCount: toInteger(result && result.actualPostCount, 0),
            retryCount: toInteger(result && result.retryCount, 0),
            requestedTargetCount: result.requestedTargetCount,
            returnedCount: result.returnedCount,
            normalizedCount: result.normalizedCount,
            insertedCount: result.insertedCount,
            skippedCount: result.skippedCount,
            generatedTargetsCount: result.generatedTargetsCount,
            missingTargetsCount: result.missingTargetsCount,
            failedBlocks: result.failedBlocks,
            failureCounts: generatedBundle.status.failureCounts,
            failureType: result.failureType,
            failureMessage: result.failureMessage,
            stopRequested: result.stopRequested,
            stopHandled: result.stopHandled,
            requestAborted: result.requestAborted,
            nextAllowedStartAt: generatedBundle.status.nextAllowedStartAt || '',
            bundle: generatedBundle
        });
        finalizeDiagnosticsRun(diagnosticScope, runId, result);
        notify(callbacks, 'onComplete', result);
        notify(callbacks, 'onStateChange', buildStateSnapshot(result));
        notify(callbacks, 'onStatus', buildStateSnapshot(result));
        if (run && run.runId === runId) activeRun = null;
        if (run && run.runId === runId) run.finished = true;
    }
}

function createActiveRun(runId, scope) {
    return {
        runId,
        scope,
        requestCount: 0,
        scheduledBlockCount: 0,
        actualPostCount: 0,
        retryCount: 0,
        requestBudget: RUN_REQUEST_BUDGET,
        lastRequestStartMs: 0,
        nextAllowedStartAt: '',
        backoffUntilMs: 0,
        backoffReason: '',
        waiting: false,
        stopRequested: false,
        stopHandled: false,
        requestAborted: false,
        currentAbortController: null,
        currentRequestInFlight: false,
        finished: false
    };
}

function initializeRunStatus(bundle, diffResult, runId, totalBlocks) {
    bundle.status.totalBlocks = totalBlocks;
    bundle.status.completedBlocks = 0;
    bundle.status.failedBlocks = 0;
    bundle.status.runningBlockId = null;
    bundle.status.requestedTargetCount = arrayLength(diffResult.missingTargets);
    bundle.status.generatedTargetsCount = diffResult.generatedTargetsCount;
    bundle.status.allTargetsCount = diffResult.allTargetsCount;
    bundle.status.noRequest = false;
    bundle.status.runId = runId;
    bundle.status.requestBudget = RUN_REQUEST_BUDGET;
    bundle.status.requestCount = 0;
    bundle.status.scheduledBlockCount = totalBlocks;
    bundle.status.actualPostCount = 0;
    bundle.status.retryCount = 0;
    bundle.status.stopRequested = false;
    bundle.status.stopHandled = false;
    bundle.status.requestAborted = false;
    bundle.status.nextAllowedStartAt = '';
    bundle.status.finalRunReason = '';
}

function updateBundleProgress(bundle, progressStore, aggregateCounts, run) {
    bundle.status.completedBlocks = progressStore.completedBlocks;
    bundle.status.failedBlocks = progressStore.failedBlocks;
    bundle.status.runningBlockId = progressStore.runningBlockId;
    bundle.status.generatedTargetsCount = countDistinctGeneratedTargets(bundle);
    bundle.status.returnedCount = aggregateCounts.returnedCount;
    bundle.status.normalizedCount = aggregateCounts.normalizedCount;
    bundle.status.insertedCount = aggregateCounts.insertedCount;
    bundle.status.skippedCount = aggregateCounts.skippedCount;
    bundle.status.requestCount = aggregateCounts.requestCount;
    bundle.status.scheduledBlockCount = progressStore.totalBlocks;
    bundle.status.actualPostCount = aggregateCounts.actualPostCount;
    bundle.status.requestBudget = RUN_REQUEST_BUDGET;
    bundle.status.retryCount = aggregateCounts.retryCount;
    bundle.status.stopRequested = !!(run && run.stopRequested);
    bundle.status.stopHandled = !!(run && run.stopHandled);
    bundle.status.requestAborted = !!(run && run.requestAborted);
    bundle.status.nextAllowedStartAt = run && run.nextAllowedStartAt || '';
}

function handleStop(run, diagnosticScope, runId, requestAborted) {
    if (run) {
        run.stopHandled = true;
        run.requestAborted = !!requestAborted;
    }
    emitDiagnostics('controller.stop_handled', {
        scope: diagnosticScope,
        runId,
        requestBudget: RUN_REQUEST_BUDGET,
        requestCount: run && run.requestCount || 0,
        scheduledBlockCount: run && run.scheduledBlockCount || 0,
        actualPostCount: run && run.actualPostCount || 0,
        retryCount: run && run.retryCount || 0,
        stopRequested: true,
        stopHandled: true,
        requestAborted: !!requestAborted,
        currentRequestInFlight: !!(run && run.currentRequestInFlight)
    });
    return 'stopped';
}

function shouldStopRun(run) {
    return !!(run && run.stopRequested);
}

function normalizeProviderItems(providerResult, block, promptPayload) {
    const rawItems = providerResult && Array.isArray(providerResult.items) ? providerResult.items : [];
    const targets = Array.isArray(promptPayload && promptPayload.targets) ? promptPayload.targets : [];
    const targetsById = new Map();
    targets.forEach((target, index) => {
        targetsById.set(String(target.id || index), { ...target, __index: index });
    });
    const normalizedItems = rawItems
        .map((item, index) => {
            const itemTargetId = String(item && item.targetId ? item.targetId : '');
            const target = itemTargetId ? targetsById.get(itemTargetId) : targets[index] || null;
            emitAnnotationDebug('normalize.provider_items_candidate', {
                blockId: normalizeText(block && block.id),
                index,
                rawTargetId: itemTargetId,
                targetMatched: !!target,
                matchedTargetId: normalizeText(target && target.id),
                targetOccurrenceKey: normalizeText(target && target.occurrenceKey)
            });
            return normalizeGeneratedItem(item, target, providerResult, block, index);
        })
        .filter(isValidGeneratedItem);
    if (rawItems.length && !normalizedItems.length) {
        console.warn('[AnnotationGenerationController] all provider items were filtered out', {
            blockId: normalizeText(block && block.id),
            rawItemsCount: rawItems.length,
            targetCount: targets.length
        });
    }
    emitAnnotationDebug('normalize.provider_items_summary', {
        blockId: normalizeText(block && block.id),
        rawItemsCount: rawItems.length,
        normalizedItemsCount: normalizedItems.length,
        droppedCount: Math.max(0, rawItems.length - normalizedItems.length)
    });
    return normalizedItems;
}

function normalizeGeneratedItem(item, target, providerResult, block, index) {
    const normalizedTarget = isObject(target) ? target : {};
    const markedText = normalizeText((item && item.markedText) || normalizedTarget.markedText || '');
    const boundary = normalizeText((item && item.boundary) || normalizedTarget.boundaryHint || markedText);
    const meaning = normalizeText(item && item.meaning);
    const memoryHint = normalizeText(item && item.memoryHint);
    const occurrenceKey = normalizeText((item && item.occurrenceKey) || normalizedTarget.occurrenceKey || '');
    const validationFailed = !(markedText && boundary && meaning && memoryHint && occurrenceKey);
    emitAnnotationDebug('normalize.generated_item', {
        blockId: normalizeText(block && block.id),
        index,
        rawTargetId: normalizeText(item && item.targetId),
        targetMatched: !!target,
        matchedTargetId: normalizeText(normalizedTarget.id),
        occurrenceKey,
        hasOccurrenceKey: !!occurrenceKey,
        hasMeaning: !!meaning,
        hasMemoryHint: !!memoryHint,
        markedText,
        boundary,
        validationFailed
    });
    if (validationFailed) {
        console.warn('[AnnotationGenerationController] generated item validation failed', {
            blockId: normalizeText(block && block.id),
            index,
            rawTargetId: normalizeText(item && item.targetId),
            matchedTargetId: normalizeText(normalizedTarget.id),
            hasMarkedText: !!markedText,
            hasBoundary: !!boundary,
            hasMeaning: !!meaning,
            hasMemoryHint: !!memoryHint,
            hasOccurrenceKey: !!occurrenceKey
        });
    }
    return {
        id: normalizeText((item && item.id) || `${block.id}-item-${index}`),
        targetId: normalizeText((item && item.targetId) || normalizedTarget.id || ''),
        blockId: normalizeText((item && item.blockId) || block.id || ''),
        markedText,
        boundary,
        type: normalizeText((item && item.type) || 'word'),
        meaning,
        memoryHint,
        provider: normalizeText((item && item.provider) || (providerResult && providerResult.provider) || ''),
        source: normalizeText((item && item.source) || (providerResult && providerResult.provider) || ''),
        occurrenceKey,
        occurrenceGlobalStart: toInteger(item && item.occurrenceGlobalStart != null ? item.occurrenceGlobalStart : normalizedTarget.occurrenceGlobalStart, null),
        occurrenceGlobalEnd: toInteger(item && item.occurrenceGlobalEnd != null ? item.occurrenceGlobalEnd : normalizedTarget.occurrenceGlobalEnd, null),
        updatedAt: new Date().toISOString()
    };
}

function isValidGeneratedItem(item) {
    return !!(item && item.markedText && item.boundary && item.meaning && item.memoryHint && item.occurrenceKey);
}

function createEmptyBundle(context, apiConfig) {
    return {
        version: 1,
        scope: {
            audioKey: normalizeText(context.audioKey || 'default-audio'),
            documentId: normalizeText(context.documentId || 'default-document')
        },
        metadata: {
            provider: normalizeText(apiConfig.config && apiConfig.config.provider),
            mode: apiConfig.state,
            createdAt: new Date().toISOString()
        },
        items: [],
        status: { state: 'idle', totalBlocks: 0, completedBlocks: 0, failedBlocks: 0, runningBlockId: null },
        updatedAt: new Date().toISOString()
    };
}

function createBundleFromExistingBundle(existingBundle, context, apiConfig) {
    const base = createEmptyBundle(context, apiConfig);
    const current = isObject(existingBundle) ? existingBundle : {};
    return {
        ...base,
        ...current,
        scope: { ...base.scope, ...(isObject(current.scope) ? current.scope : {}) },
        metadata: {
            ...base.metadata,
            ...(isObject(current.metadata) ? current.metadata : {}),
            provider: normalizeText(apiConfig.config && apiConfig.config.provider) || normalizeText(current.metadata && current.metadata.provider)
        },
        items: Array.isArray(current.items) ? current.items.slice() : [],
        status: { ...base.status, ...(isObject(current.status) ? current.status : {}) }
    };
}

function appendGeneratedItems(bundle, nextItems) {
    const beforeItemCount = arrayLength(bundle.items);
    const merged = new Map();
    const skippedKeys = [];
    let insertedCount = 0;
    let persistSkippedReason = '';
    (bundle.items || []).forEach((item) => merged.set(buildGeneratedIdentityKey(item), item));
    nextItems.forEach((item) => {
        const key = buildGeneratedIdentityKey(item);
        if (!merged.has(key)) {
            merged.set(key, item);
            insertedCount += 1;
        } else {
            skippedKeys.push(key);
        }
    });
    bundle.items = Array.from(merged.values());
    if (!nextItems.length) {
        persistSkippedReason = 'empty_items';
        console.warn('[AnnotationGenerationController] persist skipped because nextItems is empty', {
            beforeItemCount,
            afterItemCount: bundle.items.length
        });
    } else if (!insertedCount) {
        persistSkippedReason = 'duplicates_only';
        console.warn('[AnnotationGenerationController] persist skipped because all items were duplicates', {
            beforeItemCount,
            nextItemsCount: nextItems.length,
            skippedCount: skippedKeys.length,
            skippedKeys: DIAGNOSTICS && typeof DIAGNOSTICS.sampleValues === 'function' ? DIAGNOSTICS.sampleValues(skippedKeys) : skippedKeys.slice(0, 3)
        });
    }
    return {
        beforeItemCount,
        afterItemCount: bundle.items.length,
        insertedCount,
        skippedCount: skippedKeys.length,
        skippedKeys: DIAGNOSTICS && typeof DIAGNOSTICS.sampleValues === 'function' ? DIAGNOSTICS.sampleValues(skippedKeys) : skippedKeys.slice(0, 3),
        persistSkippedReason
    };
}

function buildGeneratedIdentityKey(item) {
    if (item && item.occurrenceKey) return `occurrence::${item.occurrenceKey}`;
    return `id::${item && item.id ? item.id : ''}`;
}

async function persistBundle(context, bundle, options = {}) {
    if (!STORAGE || typeof STORAGE.saveBundle !== 'function') return;
    recordRunDiagnostic(buildStorageContext(context), options.runId, 'persist start', {
        itemCount: arrayLength(bundle && bundle.items),
        requestCount: toInteger(bundle && bundle.status && bundle.status.requestCount, 0),
        completedBlocks: toInteger(bundle && bundle.status && bundle.status.completedBlocks, 0),
        failedBlocks: toInteger(bundle && bundle.status && bundle.status.failedBlocks, 0)
    });
    try {
        emitAnnotationDebug('bundle.persist_start', {
            scope: buildStorageContext(context),
            itemCount: arrayLength(bundle && bundle.items),
            requestCount: toInteger(bundle && bundle.status && bundle.status.requestCount, 0),
            completedBlocks: toInteger(bundle && bundle.status && bundle.status.completedBlocks, 0),
            failedBlocks: toInteger(bundle && bundle.status && bundle.status.failedBlocks, 0)
        });
        await STORAGE.saveBundle(buildStorageContext(context), bundle, bundle.status || {}, options);
        emitAnnotationDebug('bundle.persist_complete', {
            scope: buildStorageContext(context),
            itemCount: arrayLength(bundle && bundle.items),
            requestCount: toInteger(bundle && bundle.status && bundle.status.requestCount, 0),
            completedBlocks: toInteger(bundle && bundle.status && bundle.status.completedBlocks, 0),
            failedBlocks: toInteger(bundle && bundle.status && bundle.status.failedBlocks, 0)
        });
        recordRunDiagnostic(buildStorageContext(context), options.runId, 'persist success', {
            itemCount: arrayLength(bundle && bundle.items),
            requestCount: toInteger(bundle && bundle.status && bundle.status.requestCount, 0),
            completedBlocks: toInteger(bundle && bundle.status && bundle.status.completedBlocks, 0),
            failedBlocks: toInteger(bundle && bundle.status && bundle.status.failedBlocks, 0)
        });
    } catch (error) {
        emitAnnotationDebug('bundle.persist_failed', {
            scope: buildStorageContext(context),
            itemCount: arrayLength(bundle && bundle.items),
            errorMessage: normalizeText(error && error.message)
        });
        console.warn('[AnnotationGenerationController] saveGeneratedBundle failed', error);
    }
}

async function loadExistingGeneratedBundle(context, apiConfig, options = {}) {
    const fallback = createEmptyBundle(context, apiConfig);
    if (!STORAGE || typeof STORAGE.loadBundle !== 'function') return fallback;
    try {
        const loaded = await STORAGE.loadBundle(buildStorageContext(context), options);
        const generated = loaded && loaded.generated && typeof loaded.generated === 'object' ? loaded.generated : null;
        return generated ? createBundleFromExistingBundle(generated, context, apiConfig) : fallback;
    } catch (error) {
        return fallback;
    }
}

function buildStorageContext(context) {
    return {
        audioKey: normalizeText(context.audioKey || 'default-audio'),
        documentId: normalizeText(context.documentId || 'default-document')
    };
}

function emitDiagnostics(event, payload) {
    if (DIAGNOSTICS && typeof DIAGNOSTICS.emit === 'function') DIAGNOSTICS.emit(event, payload);
}

function createDiagnosticsRun(scope, meta) {
    if (!DIAGNOSTIC_RECORDS || typeof DIAGNOSTIC_RECORDS.createRun !== 'function') return '';
    try {
        const runId = DIAGNOSTIC_RECORDS.createRun(scope, meta);
        if (RUN_DIAGNOSTICS && typeof RUN_DIAGNOSTICS.createRun === 'function') {
            RUN_DIAGNOSTICS.createRun(scope, { ...meta, runIdOverride: runId });
        }
        return runId;
    } catch (error) { return ''; }
}

function finalizeDiagnosticsRun(scope, runId, result) {
    if (!DIAGNOSTIC_RECORDS || typeof DIAGNOSTIC_RECORDS.finalizeRun !== 'function' || !runId) return;
    try {
        DIAGNOSTIC_RECORDS.finalizeRun(scope, runId, {
            status: normalizeText(result && result.state),
            finalRunState: normalizeText(result && result.state),
            finalRunReason: normalizeText(result && result.finalRunReason),
            requestedTargetCount: toInteger(result && result.requestedTargetCount, 0),
            returnedCount: toInteger(result && result.returnedCount, 0),
            normalizedCount: toInteger(result && result.normalizedCount, 0),
            insertedCount: toInteger(result && result.insertedCount, 0),
            skippedCount: toInteger(result && result.skippedCount, 0),
            generatedTargetsCount: toInteger(result && result.generatedTargetsCount, 0),
            missingTargetsCount: toInteger(result && result.missingTargetsCount, 0),
            failedBlocks: toInteger(result && result.failedBlocks, 0),
            failureType: normalizeText(result && result.failureType),
            failureMessage: normalizeText(result && result.failureMessage),
            requestBudget: toInteger(result && result.requestBudget, RUN_REQUEST_BUDGET),
            requestCount: toInteger(result && result.requestCount, 0),
            scheduledBlockCount: toInteger(result && result.scheduledBlockCount, 0),
            actualPostCount: toInteger(result && result.actualPostCount, 0),
            retryCount: toInteger(result && result.retryCount, 0),
            stopRequested: !!(result && result.stopRequested),
            stopHandled: !!(result && result.stopHandled),
            requestAborted: !!(result && result.requestAborted),
            nextAllowedStartAt: normalizeText(result && result.generatedBundle && result.generatedBundle.status && result.generatedBundle.status.nextAllowedStartAt),
            message: normalizeText(result && result.message)
        });
        if (RUN_DIAGNOSTICS && typeof RUN_DIAGNOSTICS.finish === 'function') {
            RUN_DIAGNOSTICS.finish(scope, runId, {
                state: normalizeText(result && result.state),
                finalRunReason: normalizeText(result && result.finalRunReason),
                failureType: normalizeText(result && result.failureType),
                failureMessage: normalizeText(result && result.failureMessage),
                requestCount: toInteger(result && result.requestCount, 0),
                actualPostCount: toInteger(result && result.actualPostCount, 0),
                retryCount: toInteger(result && result.retryCount, 0),
                missingTargetsCount: toInteger(result && result.missingTargetsCount, 0)
            });
        }
    } catch (error) {}
}

function recordRunDiagnostic(scope, runId, event, payload) {
    if (!RUN_DIAGNOSTICS || typeof RUN_DIAGNOSTICS.record !== 'function' || !runId) return;
    try {
        RUN_DIAGNOSTICS.record(scope, runId, event, payload);
    } catch (error) {}
}

function buildDiffResult(context, existingBundle) {
    if (DIFF_HELPER && typeof DIFF_HELPER.diffContextAgainstBundle === 'function') {
        return DIFF_HELPER.diffContextAgainstBundle(context, existingBundle);
    }
    return { allTargetsCount: 0, generatedTargetsCount: 0, missingTargets: [], missingTargetKeys: [] };
}

function buildFailureDetails(error) {
    return {
        failureType: normalizeText(error && (error.failureType || error.clientErrorType)) || classifyErrorTypeFallback(error),
        errorMessage: normalizeText(error && error.message),
        providerErrorCode: normalizeText(error && error.providerErrorCode),
        errorBodySummary: normalizeText(error && error.errorBodySummary),
        requestIssued: !!(error && error.requestIssued),
        httpStatus: toInteger(error && (error.httpStatus != null ? error.httpStatus : error.status), 0),
        requestStartedAt: normalizeText(error && error.requestStartedAt),
        requestFinishedAt: normalizeText(error && error.requestFinishedAt),
        durationMs: toInteger(error && error.durationMs, 0)
    };
}

function classifyErrorTypeFallback(error) {
    return normalizeText(error && error.clientErrorType) || 'request_failed';
}

function recordFailure(summary, details) {
    if (!summary || !details) return;
    const key = normalizeText(details.failureType) || 'unknown';
    summary.counts[key] = toInteger(summary.counts[key], 0) + 1;
    if (!summary.primaryType) summary.primaryType = key;
    if (!summary.primaryMessage) summary.primaryMessage = normalizeText(details.errorMessage);
}

function deriveFinalRunReason(context, preferredReason) {
    if (preferredReason === 'stopped') return 'stopped';
    if (preferredReason === 'budget_exhausted') return 'budget_exhausted';
    if (context.requestedStop && context.stopHandled) return 'stopped';
    if (context.requestCount >= context.requestBudget && context.missingTargetsCount > 0) return 'budget_exhausted';
    if (context.missingTargetsCount === 0 && context.failedBlocks === 0) return 'complete';
    if (context.failedBlocks > 0 && context.completedBlocks === 0) return 'failed';
    if (context.missingTargetsCount > 0) return 'remaining_targets';
    return 'complete';
}

function deriveBundleState(progressStore, bundle, finalRunReason) {
    if (bundle && bundle.status && bundle.status.noRequest) return 'up-to-date';
    if (finalRunReason === 'stopped') return 'stopped';
    if (!progressStore.totalBlocks) return 'no-targets';
    if (finalRunReason === 'budget_exhausted' || finalRunReason === 'remaining_targets') return 'incomplete';
    if (finalRunReason === 'failed') return 'failed';
    if (toInteger(bundle && bundle.status && bundle.status.missingTargetsCount, 0) > 0) return 'incomplete';
    if (progressStore.completedBlocks > 0) return 'complete';
    return 'no-targets';
}

function buildFinalMessage(params) {
    const { progressStore, bundle, finalRunReason } = params;
    const state = deriveBundleState(progressStore, bundle, finalRunReason);
    const requestedCount = toInteger(bundle && bundle.status && bundle.status.requestedTargetCount, 0);
    const returnedCount = toInteger(bundle && bundle.status && bundle.status.returnedCount, 0);
    const normalizedCount = toInteger(bundle && bundle.status && bundle.status.normalizedCount, 0);
    const missingTargetsCount = toInteger(bundle && bundle.status && bundle.status.missingTargetsCount, 0);
    const requestCount = toInteger(bundle && bundle.status && bundle.status.requestCount, 0);
    const scheduledBlockCount = toInteger(bundle && bundle.status && bundle.status.scheduledBlockCount, progressStore && progressStore.totalBlocks);
    const actualPostCount = toInteger(bundle && bundle.status && bundle.status.actualPostCount, requestCount);
    const retryCount = toInteger(bundle && bundle.status && bundle.status.retryCount, 0);
    if (state === 'up-to-date') return 'All current targets are already generated. No provider request was sent.';
    if (state === 'no-targets') return 'No annotation targets are available in the current document.';
    if (state === 'stopped') return bundle && bundle.status && bundle.status.requestAborted
        ? `Run stopped after ${actualPostCount}/${RUN_REQUEST_BUDGET} POSTs across ${scheduledBlockCount} scheduled blocks with ${retryCount} retries. The in-flight request was aborted.`
        : `Run stopped after ${actualPostCount}/${RUN_REQUEST_BUDGET} POSTs across ${scheduledBlockCount} scheduled blocks with ${retryCount} retries. No further requests will be sent.`;
    if (state === 'failed') return `Run failed after ${actualPostCount}/${RUN_REQUEST_BUDGET} POSTs across ${scheduledBlockCount} scheduled blocks with ${retryCount} retries.`;
    if (finalRunReason === 'budget_exhausted') return `Run used the full ${RUN_REQUEST_BUDGET} POST budget and ended with ${missingTargetsCount} remaining targets.`;
    if (state === 'incomplete') return `Run ended with remaining work: scheduledBlockCount ${scheduledBlockCount}, actualPostCount ${actualPostCount}, retryCount ${retryCount}, requested ${requestedCount}, returned ${returnedCount}, normalized ${normalizedCount}, missing ${missingTargetsCount}.`;
    return requestedCount > 0 ? `Run complete. scheduledBlockCount ${scheduledBlockCount}, actualPostCount ${actualPostCount}, retryCount ${retryCount}, processed ${requestedCount} requested targets.` : 'Generation complete.';
}

function buildFailureFeedbackMessage(failureType, failureMessage) {
    const label = failureTypeToUserLabel(failureType);
    if (label && failureMessage && failureMessage.indexOf(label) >= 0) return failureMessage;
    if (label && failureMessage) return `${label}: ${failureMessage}`;
    if (label) return label;
    return failureMessage || 'Please retry later.';
}

function buildRunningMessage(requestCount, requestBudget) {
    return `Running request ${requestCount}/${requestBudget}.`;
}

function buildFailureContinueMessage(failureType, requestCount, requestBudget) {
    return `${failureTypeToUserLabel(failureType)}. Run continues within the same budget (${requestCount}/${requestBudget}).`;
}

function failureTypeToUserLabel(failureType) {
    const type = normalizeText(failureType);
    if (type === 'provider_server') return '503 Service Unavailable';
    if (type === 'request_invalid') return '400 request_invalid';
    if (type === 'network') return 'network error';
    if (type === 'rate_limited') return 'provider rate limited';
    if (type === 'timeout') return 'request timeout';
    if (type === 'aborted') return 'request aborted';
    return type || '';
}

function buildUnconfiguredResult(apiConfig) {
    return {
        state: 'unconfigured',
        total: 0,
        totalBlocks: 0,
        completed: 0,
        completedBlocks: 0,
        failed: 0,
        failedBlocks: 0,
        requestBudget: RUN_REQUEST_BUDGET,
        requestCount: 0,
        scheduledBlockCount: 0,
        actualPostCount: 0,
        retryCount: 0,
        finalRunReason: 'failed',
        generatedBundle: createEmptyBundle({}, apiConfig),
        message: 'Annotation API is not configured.'
    };
}

function buildBusyResult(run) {
    return {
        state: run && run.waiting ? 'waiting-next-block' : 'running',
        total: 0,
        totalBlocks: 0,
        completed: 0,
        completedBlocks: 0,
        failed: 0,
        failedBlocks: 0,
        requestBudget: RUN_REQUEST_BUDGET,
        requestCount: run && run.requestCount || 0,
        scheduledBlockCount: run && run.scheduledBlockCount || 0,
        actualPostCount: run && run.actualPostCount || 0,
        retryCount: run && run.retryCount || 0,
        finalRunReason: 'running',
        message: 'A generation run is already active.'
    };
}

function buildNoTargetsResult(existingBundle) {
    return {
        state: 'no-targets',
        total: 0,
        totalBlocks: 0,
        completed: 0,
        completedBlocks: 0,
        failed: 0,
        failedBlocks: 0,
        requestBudget: RUN_REQUEST_BUDGET,
        requestCount: 0,
        scheduledBlockCount: 0,
        actualPostCount: 0,
        retryCount: 0,
        finalRunReason: 'complete',
        generatedBundle: existingBundle,
        message: 'No annotation targets are available on the current page.'
    };
}

function buildUpToDateResult(existingBundle, diffResult) {
    const bundle = {
        ...(existingBundle || {}),
        status: {
            ...((existingBundle && existingBundle.status) || {}),
            state: 'up-to-date',
            totalBlocks: 0,
            completedBlocks: 0,
            failedBlocks: 0,
            runningBlockId: null,
            noRequest: true,
            allTargetsCount: diffResult.allTargetsCount,
            generatedTargetsCount: diffResult.generatedTargetsCount,
            requestedTargetCount: 0,
            requestBudget: RUN_REQUEST_BUDGET,
            requestCount: 0,
            scheduledBlockCount: 0,
            actualPostCount: 0,
            retryCount: 0,
            finalRunReason: 'complete'
        }
    };
    return {
        state: 'up-to-date',
        total: diffResult.allTargetsCount,
        totalBlocks: 0,
        completed: diffResult.generatedTargetsCount,
        completedBlocks: diffResult.generatedTargetsCount,
        failed: 0,
        failedBlocks: 0,
        requestBudget: RUN_REQUEST_BUDGET,
        requestCount: 0,
        scheduledBlockCount: 0,
        actualPostCount: 0,
        retryCount: 0,
        finalRunReason: 'complete',
        generatedBundle: bundle,
        message: 'All current targets are already generated. No provider request was sent.'
    };
}

function buildStateSnapshot(result) {
    return {
        state: normalizeText(result && result.state),
        total: toInteger(result && (result.total != null ? result.total : result.totalBlocks), 0),
        totalBlocks: toInteger(result && result.totalBlocks, 0),
        completed: toInteger(result && (result.completed != null ? result.completed : result.completedBlocks), 0),
        completedBlocks: toInteger(result && result.completedBlocks, 0),
        failed: toInteger(result && (result.failed != null ? result.failed : result.failedBlocks), 0),
        failedBlocks: toInteger(result && result.failedBlocks, 0),
        requestBudget: toInteger(result && result.requestBudget, RUN_REQUEST_BUDGET),
        requestCount: toInteger(result && result.requestCount, 0),
        scheduledBlockCount: toInteger(result && result.scheduledBlockCount, 0),
        actualPostCount: toInteger(result && result.actualPostCount, 0),
        retryCount: toInteger(result && result.retryCount, 0),
        nextAllowedStartAt: normalizeText(result && result.nextAllowedStartAt),
        stopRequested: !!(result && result.stopRequested),
        stopHandled: !!(result && result.stopHandled),
        requestAborted: !!(result && result.requestAborted),
        finalRunReason: normalizeText(result && result.finalRunReason),
        message: normalizeText(result && result.message)
    };
}

function createProgressStore(totalBlocks) {
    const states = new Map();
    return {
        totalBlocks,
        completedBlocks: 0,
        failedBlocks: 0,
        runningBlockId: null,
        markRunning(blockId) {
            this.runningBlockId = String(blockId || '');
            states.set(this.runningBlockId, 'running');
        },
        markComplete(blockId) {
            const id = String(blockId || '');
            if (states.get(id) !== 'complete') this.completedBlocks += 1;
            states.set(id, 'complete');
            this.runningBlockId = null;
        },
        markFailed(blockId) {
            const id = String(blockId || '');
            if (states.get(id) !== 'failed') this.failedBlocks += 1;
            states.set(id, 'failed');
            this.runningBlockId = null;
        },
        snapshot() {
            return {
                total: this.totalBlocks,
                totalBlocks: this.totalBlocks,
                completed: this.completedBlocks,
                completedBlocks: this.completedBlocks,
                failed: this.failedBlocks,
                failedBlocks: this.failedBlocks,
                runningBlockId: this.runningBlockId
            };
        }
    };
}

function countDistinctGeneratedTargets(bundle) {
    const keys = new Set();
    (bundle && Array.isArray(bundle.items) ? bundle.items : []).forEach((item) => {
        const key = normalizeText(item && item.occurrenceKey);
        if (key) keys.add(key);
    });
    return keys.size;
}

function readApiConfig() {
    const global = (typeof window !== 'undefined') ? window : (typeof globalThis !== 'undefined' ? globalThis : {});
    if (global.AnnotationApiConfig && typeof global.AnnotationApiConfig.read === 'function') return global.AnnotationApiConfig.read();
    const raw = global.__ANNOTATION_API_CONFIG__;
    if (!isObject(raw)) return { state: 'unconfigured', config: null };
    const mode = normalizeText(raw.mode).toLowerCase();
    if (mode === 'mock') return { state: 'mock', config: raw };
    if (mode === 'real' && raw.provider && raw.apiKey) return { state: 'ready', config: raw };
    return { state: 'unconfigured', config: null };
}

function getConfigState() {
    const config = readApiConfig();
    return config.state === 'ready' || config.state === 'mock' ? 'configured' : 'unconfigured';
}

function notify(callbacks, name, payload) {
    const handler = callbacks && callbacks[name];
    if (typeof handler !== 'function') return;
    try { handler(payload); } catch (error) { console.warn(`[AnnotationGenerationController] callback ${name} failed`, error); }
}

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

function arrayLength(value) {
    return Array.isArray(value) ? value.length : 0;
}

function shouldRetryWithBackoff(failureDetails, attempt) {
    if (attempt > MAX_RETRY_ATTEMPTS_PER_BLOCK) return null;
    const type = normalizeText(failureDetails && failureDetails.failureType);
    const status = toInteger(failureDetails && failureDetails.httpStatus, 0);
    if (type === 'rate_limited' || status === 429) {
        return {
            reason: 'rate_limited',
            backoffMs: randomBetween(RATE_LIMIT_BACKOFF_MIN_MS, RATE_LIMIT_BACKOFF_MAX_MS)
        };
    }
    if (type === 'provider_server' || status === 503) {
        return {
            reason: 'provider_busy',
            backoffMs: randomBetween(PROVIDER_BUSY_BACKOFF_MIN_MS, PROVIDER_BUSY_BACKOFF_MAX_MS)
        };
    }
    return null;
}

function buildSyntheticFailureDetails(failureType, message) {
    return {
        failureType: normalizeText(failureType) || 'request_failed',
        errorMessage: normalizeText(message),
        providerErrorCode: '',
        errorBodySummary: '',
        requestIssued: false,
        httpStatus: 0,
        requestStartedAt: '',
        requestFinishedAt: '',
        durationMs: 0
    };
}

function createSyntheticControllerError(failureType, message) {
    const error = new Error(message || 'Annotation generation request failed.');
    error.clientErrorType = failureType;
    error.failureType = failureType;
    return error;
}

function randomBetween(min, max) {
    const low = Math.max(0, toInteger(min, 0));
    const high = Math.max(low, toInteger(max, low));
    return low + Math.floor(Math.random() * (high - low + 1));
}

function isObject(value) {
    return !!value && typeof value === 'object';
}

function normalizeText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function toInteger(value, fallback) {
    const next = Number(value);
    return Number.isInteger(next) ? next : fallback;
}
