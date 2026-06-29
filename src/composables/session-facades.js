let runtimeStateGetter = function () { return null; };
let windowObject = typeof window !== 'undefined' ? window : globalThis;
const runtimeHandlers = {};

function getRuntimeState() {
  try {
    return runtimeStateGetter() || null;
  } catch (error) {
    return null;
  }
}

export function configureSessionFacades(options = {}) {
  if (typeof options.getWindow === 'function') {
    windowObject = options.getWindow() || windowObject;
  } else if (options.windowObject) {
    windowObject = options.windowObject;
  }
  if (typeof options.getRuntimeState === 'function') {
    runtimeStateGetter = options.getRuntimeState;
  }
  [
    'clearGeneratedAnnotationIndex',
    'clearPersistedChunkSession',
    'getAnnotationGenerationScope',
    'emitAnnotationDiagnostics',
    'scheduleGeneratedAnnotationIndexRefresh',
    'syncAnnotationGenerationEntryStatus'
  ].forEach((name) => {
    if (typeof options[name] === 'function') runtimeHandlers[name] = options[name];
  });
  installSessionWindowFacades();
  return sessionFacadesApi;
}

export function clearGeneratedAnnotationIndex() {
  if (typeof runtimeHandlers.clearGeneratedAnnotationIndex === 'function') {
    runtimeHandlers.clearGeneratedAnnotationIndex();
  }
}

export function clearPersistedChunkSession() {
  if (typeof runtimeHandlers.clearPersistedChunkSession === 'function') {
    return runtimeHandlers.clearPersistedChunkSession();
  }
  return Promise.resolve();
}

export function getAnnotationGenerationScope() {
  if (typeof runtimeHandlers.getAnnotationGenerationScope === 'function') {
    return runtimeHandlers.getAnnotationGenerationScope();
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
  if (typeof runtimeHandlers.emitAnnotationDiagnostics === 'function') {
    return runtimeHandlers.emitAnnotationDiagnostics.apply(null, arguments);
  }
}

export function emitAnnotationDebug(step, payload) {
  try {
    const storage = windowObject && windowObject.localStorage ? windowObject.localStorage : globalThis.localStorage;
    if (windowObject.ANNOTATION_DEBUG === true || (storage && storage.getItem('annotationDebug') === '1')) {
      console.debug(`[annotation-debug] ${step}`, payload || {});
    }
  } catch (error) {}
}

export function scheduleGeneratedAnnotationIndexRefresh() {
  if (typeof runtimeHandlers.scheduleGeneratedAnnotationIndexRefresh === 'function') {
    return runtimeHandlers.scheduleGeneratedAnnotationIndexRefresh();
  }
  return Promise.resolve();
}

export function syncAnnotationGenerationEntryStatus() {
  if (typeof runtimeHandlers.syncAnnotationGenerationEntryStatus === 'function') {
    return runtimeHandlers.syncAnnotationGenerationEntryStatus();
  }
}

export function getAnnotationGeneratedResultStore() {
  return windowObject.AnnotationGeneratedResultStore || null;
}

export function getAnnotationClickResolver() {
  return windowObject.AnnotationClickResolver || null;
}

function installSessionWindowFacades() {
  windowObject.getAnnotationGenerationScope = getAnnotationGenerationScope;
  windowObject.clearGeneratedAnnotationIndex = clearGeneratedAnnotationIndex;
  windowObject.clearPersistedChunkSession = clearPersistedChunkSession;
  windowObject.emitAnnotationDiagnostics = emitAnnotationDiagnostics;
  windowObject.scheduleGeneratedAnnotationIndexRefresh = scheduleGeneratedAnnotationIndexRefresh;
  windowObject.syncAnnotationGenerationEntryStatus = syncAnnotationGenerationEntryStatus;
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
  getAnnotationClickResolver
};

installSessionWindowFacades();
