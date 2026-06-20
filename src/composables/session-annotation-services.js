function getGlobalObject(globalObject) {
  return globalObject || globalThis;
}

export function getAnnotationGenerationStorage(globalObject) {
  return getGlobalObject(globalObject).AnnotationGenerationStorage || null;
}

export function getAnnotationBlockPlanner(globalObject) {
  return getGlobalObject(globalObject).AnnotationBlockPlanner || null;
}

export function getAnnotationPromptBuilder(globalObject) {
  return getGlobalObject(globalObject).AnnotationPromptBuilder || null;
}

export function getAnnotationGeneratedResultStore(globalObject) {
  return getGlobalObject(globalObject).AnnotationGeneratedResultStore || null;
}

export function getAnnotationClickResolver(globalObject) {
  return getGlobalObject(globalObject).AnnotationClickResolver || null;
}

export function getAnnotationTargetSource(globalObject) {
  return getGlobalObject(globalObject).AnnotationTargetSource || null;
}

export function getAnnotationGenerationDiagnostics(globalObject) {
  return getGlobalObject(globalObject).AnnotationGenerationDiagnostics || null;
}

export function getAnnotationApiConfigHelper(globalObject) {
  return getGlobalObject(globalObject).AnnotationApiConfig || null;
}

export function emitAnnotationDiagnostics(event, payload, deps = {}) {
  var diagnostics = typeof deps.getAnnotationGenerationDiagnostics === 'function'
    ? deps.getAnnotationGenerationDiagnostics()
    : getAnnotationGenerationDiagnostics(deps.globalObject);
  if (!diagnostics || typeof diagnostics.emit !== 'function') return;
  diagnostics.emit(event, payload);
}
