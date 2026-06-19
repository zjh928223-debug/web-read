import { runtimeState } from './runtime-state-facade.js';
import { renderTranscript, renderChunkMode } from './render-runtime.js';
import { initReaderRuntimeContext } from './reader-runtime-context.js';
import { initReaderNotesSessionRuntime } from './reader-notes-session-runtime.js';
import { createReaderNotesSessionRuntimeDeps } from './reader-notes-session-runtime-deps.js';
import { initReaderFeatureRuntime } from './reader-feature-runtime.js';
import { createReaderFeatureRuntimeDeps } from './reader-feature-runtime-deps.js';
import { showToast, showError } from './ui-facades.js';
import { syncAnnotationGenerationEntryStatus, initAnnotationApiSettingsUi } from './session-facades.js';

export function initReaderRuntimeAssembly(deps = {}) {
  var getWindow = typeof deps.getWindow === 'function' ? deps.getWindow : function () { return globalThis; };
  var getDocument = typeof deps.getDocument === 'function' ? deps.getDocument : function () {
    return getWindow().document;
  };
  var globalObject = getWindow();

  var runtimeContext = initReaderRuntimeContext({
    getWindow: getWindow,
    getDocument: getDocument
  });
  var bootstrapRuntime = runtimeContext.bootstrapRuntime;
  var notesSessionRuntime = initReaderNotesSessionRuntime(createReaderNotesSessionRuntimeDeps({
    globalObject: globalObject,
    runtimeContext: runtimeContext,
    bootstrapRuntime: bootstrapRuntime
  }));

  var featureRuntime = initReaderFeatureRuntime({
    ...createReaderFeatureRuntimeDeps({
      globalObject: globalObject,
      runtimeState: runtimeState,
      runtimeContext: runtimeContext,
      bootstrapRuntime: bootstrapRuntime,
      notesSessionRuntime: notesSessionRuntime,
      showToast: showToast,
      showError: showError,
      renderTranscript: renderTranscript,
      renderChunkMode: renderChunkMode,
      syncAnnotationGenerationEntryStatus: syncAnnotationGenerationEntryStatus,
      initAnnotationApiSettingsUi: initAnnotationApiSettingsUi
    })
  });

  return {
    runtimeContext: runtimeContext,
    bootstrapRuntime: bootstrapRuntime,
    notesSessionRuntime: notesSessionRuntime,
    featureRuntime: featureRuntime
  };
}
