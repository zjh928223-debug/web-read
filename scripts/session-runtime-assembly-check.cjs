const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function countNonBlankLines(source) {
  return source.split(/\r?\n/).filter((line) => line.trim()).length;
}

async function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const entrySource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'session-init.js'), 'utf8');
  const assemblySource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'session-runtime-assembly.js'), 'utf8');
  const adapterSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'session-runtime-adapters.js'), 'utf8');

  assert.ok(entrySource.includes("import { initSessionRuntimeAssembly } from './session-runtime-assembly.js';"));
  assert.ok(entrySource.includes('initSessionRuntimeAssembly({'));
  assert.ok(countNonBlankLines(entrySource) <= 6, 'session-init should remain a thin entry');
  assert.ok(assemblySource.includes('export function initSessionRuntimeAssembly'));
  assert.ok(assemblySource.includes('const adapters = createSessionRuntimeAdapters(env);'));
  assert.ok(assemblySource.includes('const annotationRuntime = adapters.annotation.start(st);'));
  assert.ok(assemblySource.includes('const lifecycleRuntime = adapters.lifecycle.start(st, annotationRuntime);'));
  assert.equal(assemblySource.includes('runtimeDeps'), false);
  assert.equal(assemblySource.includes('domRefs'), false);
  assert.equal(assemblySource.includes('globals'), false);
  assert.equal(assemblySource.includes('document.getElementById'), false);
  assert.ok(adapterSource.includes("from './session-annotation-runtime.js';"));
  assert.ok(adapterSource.includes("from './session-lifecycle-runtime.js';"));

  const calls = [];
  const state = { id: 'state' };
  const windowObject = { id: 'window' };
  const annotationRuntime = {
    clearGeneratedAnnotationIndex() {},
    getAnnotationGenerationScope() {},
    scheduleGeneratedAnnotationIndexRefresh() {},
    syncAnnotationGenerationEntryStatus() {},
    emitAnnotationDiagnostics() {},
    dispose() { calls.push('dispose-annotation'); }
  };
  const lifecycleRuntime = {
    clearPersistedChunkSession() {},
    ready: Promise.resolve('ready'),
    dispose() { calls.push('dispose-lifecycle'); }
  };
  const adapters = {
    getWindow() { calls.push('get-window'); return windowObject; },
    annotation: {
      start(receivedState) {
        calls.push(['start-annotation', receivedState]);
        return annotationRuntime;
      }
    },
    lifecycle: {
      start(receivedState, receivedAnnotation) {
        calls.push(['start-lifecycle', receivedState, receivedAnnotation]);
        return lifecycleRuntime;
      }
    }
  };
  let facadeDeps;
  const executable = assemblySource
    .replace(/^import[\s\S]*?from '[^']+';\r?\n/gm, '')
    .replace('export function initSessionRuntimeAssembly', 'function initSessionRuntimeAssembly')
    .concat('\nexport { initSessionRuntimeAssembly };');
  const bindings = {
    getSessionState: () => state,
    createSessionRuntimeAdapters: () => adapters,
    configureSessionFacades: (deps) => { facadeDeps = deps; },
    createLifecycleScope
  };
  const declarations = Object.keys(bindings)
    .map((name) => `const ${name} = globalThis.__sessionAssemblyBindings.${name};`)
    .join('\n');
  globalThis.__sessionAssemblyBindings = bindings;
  const encoded = Buffer.from(`${declarations}\n${executable}`).toString('base64');
  const module = await import(`data:text/javascript;base64,${encoded}#${Date.now()}`);
  const assembly = module.initSessionRuntimeAssembly();

  assert.deepEqual(calls.slice(0, 3), [
    'get-window',
    ['start-annotation', state],
    ['start-lifecycle', state, annotationRuntime]
  ]);
  assert.equal(assembly.adapters, adapters);
  assert.equal(assembly.annotationRuntime, annotationRuntime);
  assert.equal(assembly.lifecycleRuntime, lifecycleRuntime);
  assert.equal(assembly.ready, lifecycleRuntime.ready);
  assert.equal(facadeDeps.getWindow(), windowObject);
  assert.equal(facadeDeps.getRuntimeState(), state);
  assert.equal(facadeDeps.clearPersistedChunkSession, lifecycleRuntime.clearPersistedChunkSession);
  assembly.dispose();
  assembly.dispose();
  assert.deepEqual(calls.slice(-2), ['dispose-lifecycle', 'dispose-annotation']);

  console.log('session runtime assembly check passed');
}

function createLifecycleScope() {
  const disposers = [];
  let disposed = false;
  return {
    add(disposer) { disposers.push(disposer); },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (let index = disposers.length - 1; index >= 0; index -= 1) disposers[index]();
    }
  };
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
