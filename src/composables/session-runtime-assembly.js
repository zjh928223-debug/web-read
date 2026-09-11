import { getSessionState } from './session-state-provider.js';
import {
    createSessionRuntimeAdapters
} from './session-runtime-adapters.js';
import {
    configureSessionFacades
} from './session-facades.js';
import { createLifecycleScope } from '../services/runtime/lifecycle-scope.js';

var activeSessionRuntimeAssembly = null;

export function initSessionRuntimeAssembly(env = {}) {
    if (activeSessionRuntimeAssembly) activeSessionRuntimeAssembly.dispose();
    const lifecycle = createLifecycleScope();
    function own(runtime) {
      if (runtime && typeof runtime.dispose === 'function') {
        lifecycle.add(function () { runtime.dispose(); });
      }
      return runtime;
    }
    const adapters = createSessionRuntimeAdapters(env);
    const windowObject = adapters.getWindow();
    var st = getSessionState();
    const annotationRuntime = adapters.annotation.start(st);
    own(annotationRuntime);
    const clearGeneratedAnnotationIndex = annotationRuntime.clearGeneratedAnnotationIndex;
    const getAnnotationGenerationScope = annotationRuntime.getAnnotationGenerationScope;
    const scheduleGeneratedAnnotationIndexRefresh = annotationRuntime.scheduleGeneratedAnnotationIndexRefresh;
    const waitForGeneratedAnnotationIndex = annotationRuntime.waitForGeneratedAnnotationIndex;
    const syncAnnotationGenerationEntryStatus = annotationRuntime.syncAnnotationGenerationEntryStatus;
    const emitAnnotationDiagnostics = annotationRuntime.emitAnnotationDiagnostics;
    const lifecycleRuntime = adapters.lifecycle.start(st, annotationRuntime);
      own(lifecycleRuntime);


      configureSessionFacades({
        getWindow: function () { return windowObject; },
        getRuntimeState: function () { return st; },
        clearGeneratedAnnotationIndex,
        clearPersistedChunkSession: lifecycleRuntime.clearPersistedChunkSession,
        getAnnotationGenerationScope,
        emitAnnotationDiagnostics,
        scheduleGeneratedAnnotationIndexRefresh,
        waitForGeneratedAnnotationIndex,
        syncAnnotationGenerationEntryStatus
      });

      const assembly = {
        adapters,
        annotationRuntime,
        lifecycleRuntime,
        ready: lifecycleRuntime && lifecycleRuntime.ready,
        dispose: function () {
          lifecycle.dispose();
          if (activeSessionRuntimeAssembly === assembly) activeSessionRuntimeAssembly = null;
        }
      };
      activeSessionRuntimeAssembly = assembly;
      return assembly;
}
