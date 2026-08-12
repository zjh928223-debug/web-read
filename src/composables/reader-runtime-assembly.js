import { runtimeState } from './runtime-state-facade.js';
import { renderTranscript, renderChunkMode } from './render-runtime.js';
import { initReaderRuntimeContext } from './reader-runtime-context.js';
import { initReaderFeatureRuntime } from './reader-feature-runtime.js';
import { createReaderFeatureRuntimeDeps } from './reader-feature-runtime-deps.js';
import { showToast, showError } from './ui-facades.js';
import { syncAnnotationGenerationEntryStatus } from './session-facades.js';
import { createLifecycleScope } from '../services/runtime/lifecycle-scope.js';

var activeReaderRuntimeAssembly = null;

export function initReaderRuntimeAssembly(deps = {}) {
  if (activeReaderRuntimeAssembly) activeReaderRuntimeAssembly.dispose();
  var lifecycle = createLifecycleScope();
  function own(runtime) {
    if (runtime && typeof runtime.dispose === 'function') {
      lifecycle.add(function () { runtime.dispose(); });
    }
    return runtime;
  }
  var getWindow = typeof deps.getWindow === 'function' ? deps.getWindow : function () { return globalThis; };
  var getDocument = typeof deps.getDocument === 'function' ? deps.getDocument : function () {
    return getWindow().document;
  };
  var globalObject = getWindow();

  var runtimeContext = initReaderRuntimeContext({
    getWindow: getWindow,
    getDocument: getDocument
  });
  own(runtimeContext);
  var bootstrapRuntime = runtimeContext.bootstrapRuntime;
  var featureRuntime = initReaderFeatureRuntime({
    ...createReaderFeatureRuntimeDeps({
      globalObject: globalObject,
      runtimeState: runtimeState,
      runtimeContext: runtimeContext,
      bootstrapRuntime: bootstrapRuntime,
      showToast: showToast,
      showError: showError,
      renderTranscript: renderTranscript,
      renderChunkMode: renderChunkMode,
      syncAnnotationGenerationEntryStatus: syncAnnotationGenerationEntryStatus
    })
  });
  own(featureRuntime);

  var assembly = {
    runtimeContext: runtimeContext,
    bootstrapRuntime: bootstrapRuntime,
    featureRuntime: featureRuntime,
    dispose: function () {
      lifecycle.dispose();
      if (activeReaderRuntimeAssembly === assembly) activeReaderRuntimeAssembly = null;
    }
  };
  activeReaderRuntimeAssembly = assembly;
  return assembly;
}
