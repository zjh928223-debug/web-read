'use strict';

const DONE_STATES = new Set(['complete', 'skipped']);
const FAILED_STATES = new Set(['failed', 'retryable']);

export function createProgressStore(blocks = [], statusData = null) {
    const blockMap = new Map();
    const savedBlocks = statusData && statusData.blocks && typeof statusData.blocks === 'object'
        ? statusData.blocks
        : {};

    blocks.forEach((block) => {
        const saved = savedBlocks[block.id] || {};
        blockMap.set(block.id, {
            blockId: block.id,
            state: normalizeState(saved.state || 'pending'),
            targetCount: Number.isFinite(Number(saved.targetCount))
                ? Number(saved.targetCount)
                : (Array.isArray(block.targets) ? block.targets.length : 0),
            attempts: Number.isFinite(Number(saved.attempts)) ? Number(saved.attempts) : 0,
            error: String(saved.error || ''),
            skippedReason: saved.skippedReason || ''
        });
    });

    function setBlockState(blockId, state, patch = {}) {
        const current = blockMap.get(blockId) || { blockId, state: 'pending', targetCount: 0, attempts: 0, error: '' };
        blockMap.set(blockId, {
            ...current,
            ...patch,
            state: normalizeState(state),
            attempts: patch.incrementAttempts ? current.attempts + 1 : (patch.attempts ?? current.attempts)
        });
        const next = blockMap.get(blockId);
        delete next.incrementAttempts;
        return next;
    }

    function snapshot(extra = {}) {
        const entries = Array.from(blockMap.values());
        const total = entries.length;
        const completed = entries.filter(entry => DONE_STATES.has(entry.state)).length;
        const successful = entries.filter(entry => entry.state === 'complete').length;
        const skipped = entries.filter(entry => entry.state === 'skipped').length;
        const failed = entries.filter(entry => FAILED_STATES.has(entry.state)).length;
        const running = entries.filter(entry => entry.state === 'running').length;
        const progress = total > 0 ? completed / total : 0;
        const state =
            running > 0 ? 'running' :
            failed > 0 && completed + failed >= total ? 'partial-failed' :
            total > 0 && successful === 0 && skipped === total ? 'no-targets' :
            total > 0 && completed >= total ? 'complete' :
            failed > 0 ? 'retryable' :
            'ready';
        return {
            state,
            total,
            completed,
            successful,
            skipped,
            failed,
            running,
            progress,
            message: extra.message || defaultMessage(state),
            ...extra
        };
    }

    function toStatusJson(meta = {}) {
        const blocksObject = {};
        blockMap.forEach((entry, blockId) => {
            blocksObject[blockId] = {
                state: entry.state,
                targetCount: entry.targetCount,
                attempts: entry.attempts,
                error: entry.error || '',
                skippedReason: entry.skippedReason || ''
            };
        });
        return {
            schemaVersion: 1,
            audioKey: meta.audioKey || 'default-audio',
            documentId: meta.documentId || 'default-document',
            updatedAt: Date.now(),
            storageMode: meta.storageMode || 'unknown',
            blocks: blocksObject
        };
    }

    return {
        setBlockState,
        snapshot,
        toStatusJson,
        getBlock: (blockId) => blockMap.get(blockId) || null,
        isComplete: (blockId) => {
            const entry = blockMap.get(blockId);
            return !!entry && entry.state === 'complete';
        },
        entries: () => Array.from(blockMap.values())
    };
}

function normalizeState(state) {
    const s = String(state || 'pending');
    return ['pending', 'running', 'complete', 'failed', 'retryable', 'skipped'].includes(s) ? s : 'pending';
}

function defaultMessage(state) {
    return {
        ready: 'Annotation generation is ready.',
        running: 'Generating annotations.',
        complete: 'Annotation generation complete.',
        'no-targets': 'No generation targets were found.',
        'partial-failed': 'Annotation generation finished with failed blocks.',
        retryable: 'Annotation generation can be retried.'
    }[state] || 'Annotation generation status updated.';
}
