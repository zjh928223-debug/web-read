(function (global) {
    'use strict';

    const GENERATED_FILE = 'annotation.generated.json';
    const STATUS_FILE = 'annotation.status.json';
    const FULL_EXPORT_FILE = 'annotation-full-export.json';
    const STORAGE_PREFIX = 'AnnotationGenerationStorage::';
    const DIAGNOSTICS = global.AnnotationGenerationDiagnostics;

    let directoryHandle = null;

    function isAnnotationDebugEnabled() {
        try {
            if (global.ANNOTATION_DEBUG === true) return true;
            const stored = global.localStorage && global.localStorage.getItem('annotation.debug');
            return stored === '1' || stored === 'true';
        } catch (error) {
            return global.ANNOTATION_DEBUG === true;
        }
    }

    function emitAnnotationDebug(step, payload) {
        if (!isAnnotationDebugEnabled()) return;
        try {
            console.debug(`[annotation-debug] ${step}`, payload || {});
        } catch (error) {}
    }

    function setDirectoryHandle(handle) {
        directoryHandle = handle || null;
    }

    function getStorageMode() {
        return directoryHandle ? 'audio-folder' : 'localStorage-fallback';
    }

    async function loadBundle(scope, options = {}) {
        const normalizedScope = normalizeScope(scope);
        const generatedKey = describeStorageTarget(normalizedScope, GENERATED_FILE);
        const statusKey = describeStorageTarget(normalizedScope, STATUS_FILE);
        const runtimeArtifacts = await inspectRuntimeArtifacts(normalizedScope);
        try {
            const [generated, status] = await Promise.all([
                loadJson(normalizedScope, GENERATED_FILE),
                loadJson(normalizedScope, STATUS_FILE)
            ]);
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

    async function saveBundle(scope, generated, status, options = {}) {
        const normalizedScope = normalizeScope(scope);
        const nextGenerated = { ...createGeneratedJson(normalizedScope, []), ...generated, updatedAt: Date.now(), storageMode: getStorageMode() };
        const nextStatus = { ...createStatusJson(normalizedScope, {}), ...status, updatedAt: Date.now(), storageMode: getStorageMode() };
        try {
            emitAnnotationDebug('storage.save_bundle_start', {
                scope: normalizedScope,
                generatedKey: describeStorageTarget(normalizedScope, GENERATED_FILE),
                statusKey: describeStorageTarget(normalizedScope, STATUS_FILE),
                generatedItemCount: Array.isArray(nextGenerated.items) ? nextGenerated.items.length : 0,
                statusBlockCount: countStatusBlocks(nextStatus)
            });
            await saveJson(normalizedScope, GENERATED_FILE, nextGenerated);
            await saveJson(normalizedScope, STATUS_FILE, nextStatus);
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

    function createGeneratedJson(scope, items = []) {
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

    function createStatusJson(scope, blocks = {}) {
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

    async function loadJson(scope, filename) {
        if (directoryHandle) {
            try {
                const fileHandle = await directoryHandle.getFileHandle(filename);
                const file = await fileHandle.getFile();
                return JSON.parse(await file.text());
            } catch (error) {
                return null;
            }
        }
        try {
            const raw = global.localStorage && global.localStorage.getItem(getLocalStorageKey(scope, filename));
            return raw ? JSON.parse(raw) : null;
        } catch (error) {
            return null;
        }
    }

    async function saveJson(scope, filename, json) {
        if (directoryHandle) {
            const fileHandle = await directoryHandle.getFileHandle(filename, { create: true });
            const writable = await fileHandle.createWritable();
            await writable.write(JSON.stringify(json, null, 2));
            await writable.close();
            return;
        }
        if (!global.localStorage) throw new Error('annotation generation storage fallback unavailable');
        global.localStorage.setItem(getLocalStorageKey(scope, filename), JSON.stringify(json));
    }

    function getLocalStorageKey(scope, filename) {
        const normalizedScope = normalizeScope(scope);
        return `${STORAGE_PREFIX}${normalizedScope.audioKey}::${normalizedScope.documentId}::${filename}`;
    }

    function describeStorageTarget(scope, filename) {
        if (directoryHandle) return `[audio-folder]::${filename}`;
        return getLocalStorageKey(scope, filename);
    }

    async function inspectRuntimeArtifacts(scope) {
        return {
            generatedTarget: describeStorageTarget(scope, GENERATED_FILE),
            statusTarget: describeStorageTarget(scope, STATUS_FILE),
            fullExportFile: FULL_EXPORT_FILE,
            fullExportTarget: describeStorageTarget(scope, FULL_EXPORT_FILE),
            fullExportExists: await fileExists(FULL_EXPORT_FILE),
            fullExportRuntimeRequired: false
        };
    }

    async function fileExists(filename) {
        if (!directoryHandle) return false;
        try {
            await directoryHandle.getFileHandle(filename);
            return true;
        } catch (error) {
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

    global.AnnotationGenerationStorage = {
        GENERATED_FILE,
        STATUS_FILE,
        FULL_EXPORT_FILE,
        setDirectoryHandle,
        getStorageMode,
        loadBundle,
        saveBundle,
        inspectRuntimeArtifacts,
        createGeneratedJson,
        createStatusJson,
        getLocalStorageKey,
        normalizeScope
    };

    function normalizeScope(scope) {
        return {
            audioKey: normalizeText(scope && scope.audioKey) || 'default-audio',
            documentId: normalizeText(scope && scope.documentId) || 'default-document'
        };
    }

    function normalizeText(value) {
        return String(value || '').replace(/\s+/g, ' ').trim();
    }
})(window);
