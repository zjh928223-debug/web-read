'use strict';

import * as DIAGNOSTICS from './diagnostics.js';
import { recordBestEffortFailure } from '../runtime/best-effort.js';
import { createTypedError } from '../runtime/typed-error.js';
import { assertWindowsOwnerBrowserWriterAllowed } from '../windows-owner-domain-cutover.js';
import {
    getAuthoritativeWindowsOwner,
    ownerRecordContent,
    ownerResponseRecords,
    requireOwnerCommitted,
    requireOwnerRead,
    stableOwnerIdempotencyKey,
} from '../windows-owner-domain-adapter.js';

const GENERATED_FILE = 'annotation.generated.json';
const STATUS_FILE = 'annotation.status.json';
const FULL_EXPORT_FILE = 'annotation-full-export.json';
const BUNDLE_FILE = 'annotation.bundle.v2.json';
const BUNDLE_SCHEMA = 'annotation-bundle.v2';
const STORAGE_PREFIX = 'AnnotationGenerationStorage::';

let directoryHandle = null;

export { GENERATED_FILE, STATUS_FILE, FULL_EXPORT_FILE, BUNDLE_FILE, BUNDLE_SCHEMA };

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
    } catch (error) {
        recordBestEffortFailure(error, {
            operationId: 'annotation-debug-log',
            reason: 'debug logging must never change annotation persistence behavior'
        });
    }
}

export function setDirectoryHandle(handle) {
    directoryHandle = handle || null;
}

export function getStorageMode() {
    return directoryHandle ? 'audio-folder' : 'localStorage-fallback';
}

export async function loadBundle(scope, options = {}) {
    const normalizedScope = normalizeScope(scope);
    const generatedKey = describeStorageTarget(normalizedScope, GENERATED_FILE);
    const statusKey = describeStorageTarget(normalizedScope, STATUS_FILE);
    const ownerBundle = await loadOwnerBundle(normalizedScope);
    if (ownerBundle) return ownerBundle;
    const runtimeArtifacts = await inspectRuntimeArtifacts(normalizedScope);
    try {
        const envelope = await loadJson(normalizedScope, BUNDLE_FILE, { distinguishErrors: true });
        let generated;
        let status;
        let loadState = 'loaded';
        if (envelope) {
            validateBundleEnvelope(envelope, normalizedScope);
            generated = envelope.generated;
            status = envelope.status;
        } else {
            const legacy = await Promise.all([
                loadJson(normalizedScope, GENERATED_FILE),
                loadJson(normalizedScope, STATUS_FILE)
            ]);
            generated = legacy[0];
            status = legacy[1];
            loadState = generated || status ? 'legacy' : 'not-found';
        }
        emitDiagnostics('storage.load_bundle', {
            scope: normalizedScope,
            runId: options.runId,
            storageMode: getStorageMode(),
            generatedKey,
            statusKey,
            generatedItemCount: Array.isArray(generated && generated.items) ? generated.items.length : 0,
            statusBlockCount: countStatusBlocks(status),
            runtimeArtifacts
        });
        const result = {
            generated: generated || createGeneratedJson(normalizedScope, []),
            status: status || createStatusJson(normalizedScope, {}),
            loadState,
            revision: envelope?.revision || 0,
            commitId: envelope?.commitId || null,
            storageMode: getStorageMode(),
            runtimeArtifacts
        };
        emitAnnotationDebug('storage.load_bundle', {
            scope: normalizedScope,
            generatedKey,
            statusKey,
            generatedItemCount: Array.isArray(result.generated && result.generated.items) ? result.generated.items.length : 0,
            statusBlockCount: countStatusBlocks(result.status)
        });
        return result;
    } catch (error) {
        emitDiagnostics('storage.load_bundle_failed', {
            scope: normalizedScope,
            runId: options.runId,
            storageMode: getStorageMode(),
            generatedKey,
            statusKey,
            errorMessage: normalizeText(error && error.message),
            runtimeArtifacts
        });
        throw error;
    }
}

export async function saveBundle(scope, generated, status, options = {}) {
    const normalizedScope = normalizeScope(scope);
    const owner = getAuthoritativeWindowsOwner('annotation');
    const storageMode = owner ? 'host-managed' : getStorageMode();
    const nextGenerated = { ...createGeneratedJson(normalizedScope, []), ...generated, updatedAt: Date.now(), storageMode };
    const nextStatus = { ...createStatusJson(normalizedScope, {}), ...status, updatedAt: Date.now(), storageMode };
    try {
        if (owner) return await saveOwnerBundle(owner, normalizedScope, nextGenerated, nextStatus, options);
        emitAnnotationDebug('storage.save_bundle_start', {
            scope: normalizedScope,
            generatedKey: describeStorageTarget(normalizedScope, GENERATED_FILE),
            statusKey: describeStorageTarget(normalizedScope, STATUS_FILE),
            generatedItemCount: Array.isArray(nextGenerated.items) ? nextGenerated.items.length : 0,
            statusBlockCount: countStatusBlocks(nextStatus)
        });
        const existing = await loadJson(normalizedScope, BUNDLE_FILE, { distinguishErrors: true });
        if (existing) validateBundleEnvelope(existing, normalizedScope);
        if (options.expectedRevision !== undefined && options.expectedRevision !== (existing?.revision || 0)) {
            throw annotationStorageError('conflict', normalizedScope, BUNDLE_FILE, {
                expectedRevision: options.expectedRevision,
                actualRevision: existing?.revision || 0
            });
        }
        const envelope = createBundleEnvelope(normalizedScope, nextGenerated, nextStatus, (existing?.revision || 0) + 1);
        await saveJson(normalizedScope, BUNDLE_FILE, envelope);
        const runtimeArtifacts = await inspectRuntimeArtifacts(normalizedScope);
        emitAnnotationDebug('storage.save_bundle_complete', {
            scope: normalizedScope,
            generatedKey: describeStorageTarget(normalizedScope, GENERATED_FILE),
            statusKey: describeStorageTarget(normalizedScope, STATUS_FILE),
            generatedItemCount: Array.isArray(nextGenerated.items) ? nextGenerated.items.length : 0,
            statusBlockCount: countStatusBlocks(nextStatus)
        });
        emitDiagnostics('storage.save_bundle', {
            scope: normalizedScope,
            runId: options.runId,
            storageMode: getStorageMode(),
            generatedKey: describeStorageTarget(normalizedScope, GENERATED_FILE),
            statusKey: describeStorageTarget(normalizedScope, STATUS_FILE),
            generatedItemCount: Array.isArray(nextGenerated.items) ? nextGenerated.items.length : 0,
            statusBlockCount: countStatusBlocks(nextStatus),
            runtimeArtifacts
        });
        return {
            generated: nextGenerated,
            status: nextStatus,
            revision: envelope.revision,
            commitId: envelope.commitId,
            storageMode: getStorageMode(),
            filenames: { generated: GENERATED_FILE, status: STATUS_FILE },
            runtimeArtifacts
        };
    } catch (error) {
        emitAnnotationDebug('storage.save_bundle_failed', {
            scope: normalizedScope,
            generatedKey: describeStorageTarget(normalizedScope, GENERATED_FILE),
            statusKey: describeStorageTarget(normalizedScope, STATUS_FILE),
            generatedItemCount: Array.isArray(nextGenerated.items) ? nextGenerated.items.length : 0,
            statusBlockCount: countStatusBlocks(nextStatus),
            errorMessage: normalizeText(error && error.message)
        });
        emitDiagnostics('storage.save_bundle_failed', {
            scope: normalizedScope,
            runId: options.runId,
            storageMode: getStorageMode(),
            generatedKey: describeStorageTarget(normalizedScope, GENERATED_FILE),
            statusKey: describeStorageTarget(normalizedScope, STATUS_FILE),
            generatedItemCount: Array.isArray(nextGenerated.items) ? nextGenerated.items.length : 0,
            statusBlockCount: countStatusBlocks(nextStatus),
            errorMessage: normalizeText(error && error.message)
        });
        throw error;
    }
}

export function createGeneratedJson(scope, items = []) {
    const normalizedScope = normalizeScope(scope);
    return {
        schemaVersion: 1,
        audioKey: normalizedScope.audioKey,
        documentId: normalizedScope.documentId,
        updatedAt: Date.now(),
        storageMode: getStorageMode(),
        items
    };
}

export function createStatusJson(scope, blocks = {}) {
    const normalizedScope = normalizeScope(scope);
    return {
        schemaVersion: 1,
        audioKey: normalizedScope.audioKey,
        documentId: normalizedScope.documentId,
        updatedAt: Date.now(),
        storageMode: getStorageMode(),
        blocks
    };
}

export async function inspectRuntimeArtifacts(scope) {
    return {
        generatedTarget: describeStorageTarget(scope, GENERATED_FILE),
        statusTarget: describeStorageTarget(scope, STATUS_FILE),
        fullExportFile: FULL_EXPORT_FILE,
        fullExportTarget: describeStorageTarget(scope, FULL_EXPORT_FILE),
        fullExportExists: await fileExists(FULL_EXPORT_FILE),
        fullExportRuntimeRequired: false
    };
}

export function getLocalStorageKey(scope, filename) {
    const normalizedScope = normalizeScope(scope);
    return `${STORAGE_PREFIX}${normalizedScope.audioKey}::${normalizedScope.documentId}::${filename}`;
}

export function normalizeScope(scope) {
    return {
        audioKey: normalizeText(scope && scope.audioKey) || 'default-audio',
        documentId: normalizeText(scope && scope.documentId) || 'default-document'
    };
}

async function loadJson(scope, filename, options = {}) {
    if (directoryHandle) {
        try {
            const fileHandle = await directoryHandle.getFileHandle(filename);
            const file = await fileHandle.getFile();
            return JSON.parse(await file.text());
        } catch (error) {
            if (options.distinguishErrors && isPermissionError(error)) throw annotationStorageError('permission', scope, filename);
            if (options.distinguishErrors && !isNotFoundError(error)) throw annotationStorageError('corrupt', scope, filename);
            recordBestEffortFailure(error, {
                operationId: 'annotation-storage-read',
                reason: 'missing or unreadable optional annotation artifacts are represented as not loaded',
                details: { filename, storageMode: getStorageMode() }
            });
            return null;
        }
    }
    const global = (typeof window !== 'undefined') ? window : (typeof globalThis !== 'undefined' ? globalThis : {});
    try {
        const raw = global.localStorage && global.localStorage.getItem(getLocalStorageKey(scope, filename));
        return raw ? JSON.parse(raw) : null;
    } catch (error) {
        if (options.distinguishErrors) throw annotationStorageError('corrupt', scope, filename);
        recordBestEffortFailure(error, {
            operationId: 'annotation-storage-read',
            reason: 'unavailable fallback annotation storage returns no optional bundle instead of blocking reader startup',
            details: { filename, storageMode: getStorageMode() }
        });
        return null;
    }
}

function createBundleEnvelope(scope, generated, status, revision, commitId = null) {
    const payload = JSON.stringify({ generated, status });
    return {
        schemaVersion: BUNDLE_SCHEMA,
        scope: normalizeScope(scope),
        revision,
        commitId: commitId || `annotation-${Date.now()}-${revision}`,
        checksum: checksum(payload),
        generated,
        status
    };
}

async function loadOwnerBundle(scope) {
    const owner = getAuthoritativeWindowsOwner('annotation');
    if (!owner) return null;
    const response = requireOwnerRead(await owner.query({
        domain: 'annotation',
        operation: 'scope',
        payload: { scope },
    }), 'annotation');
    const records = ownerResponseRecords(response);
    const bundle = ownerRecordContent(records[getLocalStorageKey(scope, BUNDLE_FILE)]);
    const generated = ownerRecordContent(records[getLocalStorageKey(scope, GENERATED_FILE)]);
    const status = ownerRecordContent(records[getLocalStorageKey(scope, STATUS_FILE)]);
    if (bundle) validateBundleEnvelope(bundle, scope);
    const nextGenerated = bundle?.generated || generated || createGeneratedJson(scope, []);
    const nextStatus = bundle?.status || status || createStatusJson(scope, {});
    validateScopeEnvelope(nextGenerated, scope);
    validateScopeEnvelope(nextStatus, scope);
    return {
        generated: nextGenerated,
        status: nextStatus,
        loadState: bundle ? 'loaded' : generated || status ? 'legacy' : 'not-found',
        revision: response.revision || 0,
        commitId: bundle?.commitId || null,
        storageMode: 'host-managed',
        runtimeArtifacts: hostRuntimeArtifacts(),
    };
}

async function saveOwnerBundle(owner, scope, generated, status, options) {
    const response = requireOwnerRead(await owner.query({
        domain: 'annotation',
        operation: 'scope',
        payload: { scope },
    }), 'annotation');
    const records = ownerResponseRecords(response);
    const existing = ownerRecordContent(records[getLocalStorageKey(scope, BUNDLE_FILE)]);
    if (existing) validateBundleEnvelope(existing, scope);
    const actualRevision = Number.isInteger(response.revision) ? response.revision : 0;
    const expectedRevision = options.expectedRevision === undefined ? actualRevision : options.expectedRevision;
    if (expectedRevision !== actualRevision) {
        throw annotationStorageError('conflict', scope, BUNDLE_FILE, {
            expectedRevision,
            actualRevision,
        });
    }
    const nextRevision = (existing?.revision || 0) + 1;
    const idempotencyKey = options.idempotencyKey || stableOwnerIdempotencyKey('annotation', {
        scope,
        expectedRevision,
        generated,
        status,
    });
    const commitId = options.commitId || stableOwnerIdempotencyKey('annotation-commit', {
        scope,
        revision: nextRevision,
        generated,
        status,
    });
    const bundle = createBundleEnvelope(scope, generated, status, nextRevision, commitId);
    const committed = requireOwnerCommitted(await owner.command({
        domain: 'annotation',
        operation: 'lightweight-import',
        payload: {
            scope,
            records: {
                [getLocalStorageKey(scope, BUNDLE_FILE)]: { id: getLocalStorageKey(scope, BUNDLE_FILE), content: bundle },
                [getLocalStorageKey(scope, GENERATED_FILE)]: { id: getLocalStorageKey(scope, GENERATED_FILE), content: generated },
                [getLocalStorageKey(scope, STATUS_FILE)]: { id: getLocalStorageKey(scope, STATUS_FILE), content: status },
            },
        },
        expectedRevision,
        idempotencyKey,
    }), 'annotation');
    const runtimeArtifacts = hostRuntimeArtifacts();
    emitDiagnostics('storage.save_bundle', {
        scope,
        runId: options.runId,
        storageMode: 'host-managed',
        generatedKey: '[host-managed]',
        statusKey: '[host-managed]',
        generatedItemCount: Array.isArray(generated.items) ? generated.items.length : 0,
        statusBlockCount: countStatusBlocks(status),
        runtimeArtifacts,
    });
    return {
        generated,
        status,
        revision: committed.revision,
        commitId: bundle.commitId,
        storageMode: 'host-managed',
        filenames: { generated: GENERATED_FILE, status: STATUS_FILE },
        runtimeArtifacts,
    };
}

function validateScopeEnvelope(value, scope) {
    if (!value || typeof value !== 'object'
        || value.schemaVersion !== 1
        || value.audioKey !== scope.audioKey
        || value.documentId !== scope.documentId) {
        throw annotationStorageError('corrupt', scope, BUNDLE_FILE);
    }
}

function hostRuntimeArtifacts() {
    return {
        generatedTarget: '[host-managed]',
        statusTarget: '[host-managed]',
        fullExportFile: FULL_EXPORT_FILE,
        fullExportTarget: '[host-managed]',
        fullExportExists: false,
        fullExportRuntimeRequired: false,
    };
}

function validateBundleEnvelope(value, scope) {
    if (value && value.schemaVersion !== BUNDLE_SCHEMA) {
        throw annotationStorageError('unknown-schema', scope, BUNDLE_FILE, { schemaVersion: value.schemaVersion ?? null });
    }
    if (!value || !Number.isInteger(value.revision) || value.revision < 1
        || !value.generated || !value.status
        || value.checksum !== checksum(JSON.stringify({ generated: value.generated, status: value.status }))) {
        throw annotationStorageError('corrupt', scope, BUNDLE_FILE);
    }
}

function annotationStorageError(kind, scope, filename, details = {}) {
    const definitions = {
        permission: { code: 'ANNOTATION_STORAGE_PERMISSION', category: 'permission', message: 'Annotation storage permission is required', retryable: true },
        conflict: { code: 'ANNOTATION_STORAGE_CONFLICT', category: 'conflict', message: 'Annotation storage changed in another owner', retryable: true },
        'unknown-schema': { code: 'ANNOTATION_STORAGE_SCHEMA_UNSUPPORTED', category: 'validation', message: 'Annotation storage schema is unsupported', retryable: false },
        corrupt: { code: 'ANNOTATION_STORAGE_CORRUPT', category: 'storage', message: 'Annotation storage is corrupt', retryable: false }
    };
    const definition = definitions[kind] || definitions.corrupt;
    return createTypedError({
        code: definition.code,
        category: definition.category,
        message: definition.message,
        retryable: definition.retryable,
        operationId: `annotation-storage-${kind}`,
        details: { scope: normalizeScope(scope), filename, ...details }
    });
}

function isPermissionError(error) {
    return ['NotAllowedError', 'SecurityError'].includes(error?.name);
}

function isNotFoundError(error) {
    return error?.name === 'NotFoundError';
}

function checksum(value) {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
}

async function saveJson(scope, filename, json) {
    assertWindowsOwnerBrowserWriterAllowed('annotation', `save:${filename}`);
    if (directoryHandle) {
        const fileHandle = await directoryHandle.getFileHandle(filename, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(JSON.stringify(json, null, 2));
        await writable.close();
        return;
    }
    const global = (typeof window !== 'undefined') ? window : (typeof globalThis !== 'undefined' ? globalThis : {});
    if (!global.localStorage) throw new Error('annotation generation storage fallback unavailable');
    global.localStorage.setItem(getLocalStorageKey(scope, filename), JSON.stringify(json));
}

function describeStorageTarget(scope, filename) {
    if (directoryHandle) return `[audio-folder]::${filename}`;
    return getLocalStorageKey(scope, filename);
}

async function fileExists(filename) {
    if (!directoryHandle) return false;
    try {
        await directoryHandle.getFileHandle(filename);
        return true;
    } catch (error) {
        recordBestEffortFailure(error, {
            operationId: 'annotation-storage-read',
            reason: 'optional artifact existence probes report false when the directory is unavailable',
            details: { filename, storageMode: getStorageMode() }
        });
        return false;
    }
}

function countStatusBlocks(status) {
    if (!status || typeof status !== 'object') return 0;
    const blocks = status.blocks;
    if (blocks && typeof blocks === 'object') return Object.keys(blocks).length;
    return 0;
}

function emitDiagnostics(event, payload) {
    if (!DIAGNOSTICS || typeof DIAGNOSTICS.emit !== 'function') return;
    DIAGNOSTICS.emit(event, payload);
}

function normalizeText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

window.AnnotationGenerationStorage = { GENERATED_FILE, STATUS_FILE, FULL_EXPORT_FILE, BUNDLE_FILE, BUNDLE_SCHEMA, setDirectoryHandle, getStorageMode, loadBundle, saveBundle, createGeneratedJson, createStatusJson, inspectRuntimeArtifacts, getLocalStorageKey, normalizeScope };
