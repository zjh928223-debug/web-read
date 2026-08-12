import { getSessionState } from './session-state-provider.js';
import {
    createSessionAnnotationRuntime
} from './session-annotation-runtime.js';
import {
    startSessionLifecycleRuntime
} from './session-lifecycle-runtime.js';
import {
    createSessionRuntimeDeps
} from './session-runtime-deps.js';
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
    const runtimeDeps = createSessionRuntimeDeps(env);
    const documentObject = runtimeDeps.documentObject;
    const windowObject = runtimeDeps.windowObject;
    const domRefs = runtimeDeps.domRefs;
    const globals = runtimeDeps.globals;
    var st = getSessionState();
    var _ns = runtimeDeps.namespace;
    const annotationRuntime = createSessionAnnotationRuntime({
        state: st,
        namespace: _ns,
        windowObject,
        documentObject,
        runtimeDeps,
        domRefs,
        globals
    });
    own(annotationRuntime);
    const clearGeneratedAnnotationIndex = annotationRuntime.clearGeneratedAnnotationIndex;
    const getAnnotationGenerationScope = annotationRuntime.getAnnotationGenerationScope;
    const scheduleGeneratedAnnotationIndexRefresh = annotationRuntime.scheduleGeneratedAnnotationIndexRefresh;
    const syncAnnotationGenerationEntryStatus = annotationRuntime.syncAnnotationGenerationEntryStatus;
    const emitAnnotationDiagnostics = annotationRuntime.emitAnnotationDiagnostics;
    const lifecycleRuntime = startSessionLifecycleRuntime({
        state: st,
        namespace: _ns,
        runtimeDeps,
        documentObject,
        windowObject,
        domRefs,
        globals,
        annotationRuntime
      });
      own(lifecycleRuntime);


      configureSessionFacades({
        getWindow: function () { return windowObject; },
        getRuntimeState: function () { return st; },
        clearGeneratedAnnotationIndex,
        clearPersistedChunkSession: lifecycleRuntime.clearPersistedChunkSession,
        getAnnotationGenerationScope,
        emitAnnotationDiagnostics,
        scheduleGeneratedAnnotationIndexRefresh,
        syncAnnotationGenerationEntryStatus
      });

      const assembly = {
        runtimeDeps,
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
