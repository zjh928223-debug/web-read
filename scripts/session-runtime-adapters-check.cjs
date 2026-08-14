const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const modulePath = path.join(repoRoot, 'src', 'composables', 'session-runtime-adapters.js');
  const assemblyPath = path.join(repoRoot, 'src', 'composables', 'session-runtime-assembly.js');
  const moduleSource = fs.readFileSync(modulePath, 'utf8');
  const assemblySource = fs.readFileSync(assemblyPath, 'utf8');

  assert.ok(moduleSource.includes('export function createSessionRuntimeAdapters'));
  assert.equal(assemblySource.includes('runtimeDeps'), false, 'session assembly must not receive the implementation dependency bag');
  assert.equal(assemblySource.includes('domRefs'), false, 'session assembly must not receive DOM leaf aliases');
  assert.equal(assemblySource.includes('globals'), false, 'session assembly must not receive global leaf aliases');
  assert.equal(moduleSource.includes('__session_'), false, 'session adapters must not expose retired session runtime facades');

  const calls = [];
  const executableSource = moduleSource
    .replace(/^import[\s\S]*?from '[^']+';\r?\n/gm, '')
    .replace('export function createSessionRuntimeAdapters', 'function createSessionRuntimeAdapters')
    .concat('\nexport { createSessionRuntimeAdapters };');
  const declarations = [
    'const createSessionAnnotationRuntime = globalThis.__sessionAdapterBindings.createSessionAnnotationRuntime;',
    'const startSessionLifecycleRuntime = globalThis.__sessionAdapterBindings.startSessionLifecycleRuntime;'
  ].join('\n');
  globalThis.__sessionAdapterBindings = {
    createSessionAnnotationRuntime(deps) {
      calls.push(['annotation', deps]);
      return { kind: 'annotation' };
    },
    startSessionLifecycleRuntime(deps) {
      calls.push(['lifecycle', deps]);
      return { kind: 'lifecycle' };
    }
  };
  const encodedSource = Buffer.from(`${declarations}\n${executableSource}`, 'utf8').toString('base64');
  const { createSessionRuntimeAdapters } = await import(`data:text/javascript;base64,${encodedSource}#${Date.now()}`);

  const elements = new Map([
    ['audio-player', { id: 'audio-player', currentTime: 12 }],
    ['annotation-mark-count', { id: 'annotation-mark-count' }],
    ['hotkey-input', { id: 'hotkey-input' }]
  ]);
  const windowObject = {
    _ns: {},
    localStorage: { getItem() { return null; } },
    URL: { createObjectURL() { return 'blob:test'; } },
    Blob: function Blob() {},
    saveToDB() {},
    loadFromDB() {},
    deleteFromDB() {},
    initDB() {},
    showToast() {},
    __annotationLightweightModule: { id: 'annotation-lightweight' }
  };
  const documentObject = {
    getElementById(id) {
      return elements.get(id) || null;
    }
  };
  const state = { id: 'state' };
  const adapters = createSessionRuntimeAdapters({
    getWindow: () => windowObject,
    getDocument: () => documentObject
  });

  assert.deepEqual(Object.keys(adapters).sort(), ['annotation', 'getWindow', 'lifecycle']);
  assert.equal(adapters.getWindow(), windowObject);
  const annotationRuntime = adapters.annotation.start(state);
  const lifecycleRuntime = adapters.lifecycle.start(state, annotationRuntime);
  assert.equal(annotationRuntime.kind, 'annotation');
  assert.equal(lifecycleRuntime.kind, 'lifecycle');

  const annotationDeps = calls[0][1];
  assert.equal(annotationDeps.state, state);
  assert.equal(annotationDeps.namespace, windowObject._ns);
  assert.equal(annotationDeps.windowObject, windowObject);
  assert.equal(annotationDeps.documentObject, documentObject);
  assert.equal(annotationDeps.domRefs.audioPlayer.id, 'audio-player');
  assert.equal(annotationDeps.domRefs.annotationMarkCountEl.id, 'annotation-mark-count');
  assert.equal(annotationDeps.globals.saveToDB, windowObject.saveToDB);
  assert.equal(annotationDeps.globals.showToast, windowObject.showToast);
  assert.equal(annotationDeps.globals.annotationLightweightModule, windowObject.__annotationLightweightModule);

  const lifecycleDeps = calls[1][1];
  assert.equal(lifecycleDeps.state, state);
  assert.equal(lifecycleDeps.namespace, windowObject._ns);
  assert.equal(lifecycleDeps.annotationRuntime, annotationRuntime);
  assert.equal(lifecycleDeps.domRefs.hotkeyInput.id, 'hotkey-input');
  assert.equal(lifecycleDeps.runtimeDeps.localStorageApi, windowObject.localStorage);
  assert.equal(lifecycleDeps.globals.loadFromDB, windowObject.loadFromDB);

  console.log('session runtime adapters check passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
