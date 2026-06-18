let runtimeStateGetter = function () { return null; };

function getRuntimeState() {
  try {
    return runtimeStateGetter() || null;
  } catch (error) {
    return null;
  }
}

export function configureSessionFacades(options = {}) {
  if (typeof options.getRuntimeState === 'function') {
    runtimeStateGetter = options.getRuntimeState;
  }
  installSessionWindowFacades();
  return sessionFacadesApi;
}

export function clearGeneratedAnnotationIndex() {
  if (typeof window.__session_clearGeneratedAnnotationIndex === 'function') {
    window.__session_clearGeneratedAnnotationIndex();
  }
}

export function clearPersistedChunkSession() {
  if (typeof window.__session_clearPersistedChunkSession === 'function') {
    return window.__session_clearPersistedChunkSession();
  }
  return Promise.resolve();
}

export function getAnnotationGenerationScope() {
  if (typeof window.__session_getAnnotationGenerationScope === 'function') {
    return window.__session_getAnnotationGenerationScope();
  }
  return { audioKey: 'default-audio', documentId: 'default-document' };
}

export function getAnnotationGenerationScopeKey(scope) {
  const rawScope = scope || getAnnotationGenerationScope();
  const audioKey = rawScope && rawScope.audioKey ? String(rawScope.audioKey) : 'default-audio';
  const documentId = rawScope && rawScope.documentId ? String(rawScope.documentId) : 'default-document';
  return `${audioKey}::${documentId}`;
}

export function getAnnotationGeneratedIndexScopeKey() {
  const runtimeState = getRuntimeState();
  return runtimeState && runtimeState.annotationGeneratedIndexScopeKey
    ? String(runtimeState.annotationGeneratedIndexScopeKey)
    : '';
}

export function emitAnnotationDiagnostics() {
  if (typeof window.__session_emitAnnotationDiagnostics === 'function') {
    return window.__session_emitAnnotationDiagnostics.apply(null, arguments);
  }
}

export function emitAnnotationDebug(step, payload) {
  try {
    if (window.ANNOTATION_DEBUG === true || localStorage.getItem('annotationDebug') === '1') {
      console.debug(`[annotation-debug] ${step}`, payload || {});
    }
  } catch (error) {}
}

export function scheduleGeneratedAnnotationIndexRefresh() {
  if (typeof window.__session_scheduleGeneratedAnnotationIndexRefresh === 'function') {
    return window.__session_scheduleGeneratedAnnotationIndexRefresh();
  }
  return Promise.resolve();
}

export function syncAnnotationGenerationEntryStatus() {
  if (typeof window.__session_syncAnnotationGenerationEntryStatus === 'function') {
    return window.__session_syncAnnotationGenerationEntryStatus();
  }
}

export function getAnnotationGeneratedResultStore() {
  return window.AnnotationGeneratedResultStore || null;
}

export function getAnnotationClickResolver() {
  return window.AnnotationClickResolver || null;
}

export function initAnnotationApiSettingsUi() {
  if (typeof window.__session_initAnnotationApiSettingsUi === 'function') {
    return window.__session_initAnnotationApiSettingsUi();
  }
}

function installSessionWindowFacades() {
  window.getAnnotationGenerationScope = getAnnotationGenerationScope;
  window.clearGeneratedAnnotationIndex = clearGeneratedAnnotationIndex;
  window.clearPersistedChunkSession = clearPersistedChunkSession;
  window.emitAnnotationDiagnostics = emitAnnotationDiagnostics;
  window.scheduleGeneratedAnnotationIndexRefresh = scheduleGeneratedAnnotationIndexRefresh;
  window.syncAnnotationGenerationEntryStatus = syncAnnotationGenerationEntryStatus;
  window.initAnnotationApiSettingsUi = initAnnotationApiSettingsUi;
}

const sessionFacadesApi = {
  clearGeneratedAnnotationIndex,
  clearPersistedChunkSession,
  getAnnotationGenerationScope,
  getAnnotationGenerationScopeKey,
  getAnnotationGeneratedIndexScopeKey,
  emitAnnotationDiagnostics,
  emitAnnotationDebug,
  scheduleGeneratedAnnotationIndexRefresh,
  syncAnnotationGenerationEntryStatus,
  getAnnotationGeneratedResultStore,
  getAnnotationClickResolver,
  initAnnotationApiSettingsUi
};

installSessionWindowFacades();
