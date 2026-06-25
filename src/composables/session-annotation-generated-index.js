function normalizeAnnotationScopeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

export function normalizeAnnotationGenerationScope(scope) {
  return {
    audioKey: normalizeAnnotationScopeText(scope && scope.audioKey) || 'default-audio',
    documentId: normalizeAnnotationScopeText(scope && scope.documentId) || 'default-document'
  };
}

export function createSessionAnnotationGeneratedIndexRuntime(deps = {}) {
  const state = deps.state || {};
  const namespace = deps.namespace || {};
  const markCountEl = deps.markCountEl || null;
  const getWindow = typeof deps.getWindow === 'function'
    ? deps.getWindow
    : function () { return globalThis; };
  const consoleApi = deps.consoleApi || console;

  function getAnnotationGenerationScope() {
    const storage = typeof deps.getAnnotationGenerationStorage === 'function'
      ? deps.getAnnotationGenerationStorage()
      : null;
    if (storage && typeof storage.normalizeScope === 'function') {
      return storage.normalizeScope({
        audioKey: state.currentAudioKey,
        documentId: namespace.currentDocId
      });
    }
    return normalizeAnnotationGenerationScope({
      audioKey: state.currentAudioKey,
      documentId: namespace.currentDocId
    });
  }

  function getAnnotationGenerationScopeKey(scope = getAnnotationGenerationScope()) {
    const normalized = normalizeAnnotationGenerationScope(scope);
    return `${normalized.audioKey}::${normalized.documentId}`;
  }

  function isAnnotationDebugEnabled() {
    const windowObject = getWindow();
    try {
      if (windowObject.ANNOTATION_DEBUG === true) return true;
      const stored = windowObject.localStorage && windowObject.localStorage.getItem('annotation.debug');
      return stored === '1' || stored === 'true';
    } catch (error) {
      return windowObject.ANNOTATION_DEBUG === true;
    }
  }

  function emitAnnotationDebug(step, payload) {
    if (!isAnnotationDebugEnabled()) return;
    try {
      consoleApi.debug(`[annotation-debug] ${step}`, payload || {});
    } catch (error) {}
  }

  function emitDiagnostics(event, payload) {
    if (typeof deps.emitAnnotationDiagnostics === 'function') {
      deps.emitAnnotationDiagnostics(event, payload);
    }
  }

  function clearGeneratedAnnotationIndex() {
    state.annotationGeneratedIndexRefreshSeq++;
    state.annotationGeneratedIndexScopeKey = '';
    const store = typeof deps.getAnnotationGeneratedResultStore === 'function'
      ? deps.getAnnotationGeneratedResultStore()
      : null;
    if (store && typeof store.clear === 'function') store.clear();
  }

  async function refreshGeneratedAnnotationIndexForCurrentDocument() {
    const storage = typeof deps.getAnnotationGenerationStorage === 'function'
      ? deps.getAnnotationGenerationStorage()
      : null;
    const store = typeof deps.getAnnotationGeneratedResultStore === 'function'
      ? deps.getAnnotationGeneratedResultStore()
      : null;
    if (!storage || typeof storage.loadBundle !== 'function' || !store || typeof store.indexBundle !== 'function') {
      emitDiagnostics('app.generated_index_refresh_skipped', {
        scope: getAnnotationGenerationScope(),
        reason: 'missing-storage-or-store'
      });
      consoleApi.warn('[app] generated index refresh skipped', {
        scope: getAnnotationGenerationScope(),
        reason: 'missing-storage-or-store'
      });
      clearGeneratedAnnotationIndex();
      return { itemCount: 0, skipped: true };
    }

    const scope = getAnnotationGenerationScope();
    const scopeKey = getAnnotationGenerationScopeKey(scope);
    const refreshSeq = ++state.annotationGeneratedIndexRefreshSeq;
    emitDiagnostics('app.generated_index_refresh_start', {
      scope,
      scopeKey,
      refreshSeq
    });

    const bundle = await storage.loadBundle(scope);
    if (refreshSeq !== state.annotationGeneratedIndexRefreshSeq || getAnnotationGenerationScopeKey() !== scopeKey) {
      emitDiagnostics('app.generated_index_refresh_stale', {
        scope,
        scopeKey,
        refreshSeq,
        currentScopeKey: getAnnotationGenerationScopeKey(),
        generatedItemCount: Array.isArray(bundle && bundle.generated && bundle.generated.items) ? bundle.generated.items.length : 0,
        runtimeArtifacts: bundle && bundle.runtimeArtifacts
      });
      consoleApi.warn('[app] generated index refresh stale/skipped', {
        scope,
        scopeKey,
        refreshSeq,
        currentScopeKey: getAnnotationGenerationScopeKey(),
        generatedItemCount: Array.isArray(bundle && bundle.generated && bundle.generated.items) ? bundle.generated.items.length : 0
      });
      return { itemCount: 0, skipped: true, stale: true };
    }

    const generated = bundle && bundle.generated ? bundle.generated : null;
    const result = store.indexBundle(generated, scope);
    state.annotationGeneratedIndexScopeKey = scopeKey;
    emitAnnotationDebug('app.generated_index_refresh', {
      scope,
      scopeKey,
      generatedItemCount: Array.isArray(generated && generated.items) ? generated.items.length : 0,
      indexedItemCount: result && Number.isFinite(Number(result.itemCount)) ? Number(result.itemCount) : 0,
      runtimeArtifacts: bundle && bundle.runtimeArtifacts || null
    });
    if (!(result && Number(result.itemCount) > 0)) {
      consoleApi.warn('[app] generated index refresh produced empty result', {
        scope,
        scopeKey,
        generatedItemCount: Array.isArray(generated && generated.items) ? generated.items.length : 0,
        indexedItemCount: result && Number.isFinite(Number(result.itemCount)) ? Number(result.itemCount) : 0
      });
    }
    emitDiagnostics('app.generated_index_refresh_complete', {
      scope,
      scopeKey,
      refreshSeq,
      indexedItemCount: result && Number.isFinite(Number(result.itemCount)) ? Number(result.itemCount) : 0,
      generatedItemCount: Array.isArray(generated && generated.items) ? generated.items.length : 0,
      runtimeArtifacts: bundle && bundle.runtimeArtifacts
    });
    return result;
  }

  function scheduleGeneratedAnnotationIndexRefresh() {
    const scheduledScopeKey = getAnnotationGenerationScopeKey();
    refreshGeneratedAnnotationIndexForCurrentDocument().catch(() => {
      if (getAnnotationGenerationScopeKey() === scheduledScopeKey) clearGeneratedAnnotationIndex();
    });
  }

  async function syncAnnotationGenerationEntryStatus() {
    const markedMap = state.markedMap instanceof Map ? state.markedMap : null;
    const count = markedMap ? markedMap.size : 0;
    if (markCountEl) {
      markCountEl.textContent = `已标记 ${count}`;
      markCountEl.setAttribute('data-count', String(count));
      markCountEl.setAttribute('title', `当前文章已标记 ${count} 个重点词`);
    }
    return { markedCount: count };
  }

  return {
    clearGeneratedAnnotationIndex,
    emitAnnotationDebug,
    getAnnotationGenerationScope,
    getAnnotationGenerationScopeKey,
    refreshGeneratedAnnotationIndexForCurrentDocument,
    scheduleGeneratedAnnotationIndexRefresh,
    syncAnnotationGenerationEntryStatus
  };
}
