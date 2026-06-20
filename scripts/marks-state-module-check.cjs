const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const runtimeSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime.js'), 'utf8');
  const shellSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime-assembly.js'), 'utf8');
const assemblySource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime-assembly.js'), 'utf8');
  const contextSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime-context.js'), 'utf8');
  const featureSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-feature-runtime.js'), 'utf8');
  const featureDepsSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-feature-runtime-deps.js'), 'utf8');
  const bootstrapSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-bootstrap-runtime.js'), 'utf8');
  const appRuntimeSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-app-runtime.js'), 'utf8');
  const keyboardRuntimeSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-keyboard-runtime.js'), 'utf8');
  const moduleSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'marks-state-module.js'), 'utf8');
  const bindingsSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'runtime-state-bindings.js'), 'utf8');
  const sessionInitSource = [
  'session-runtime-assembly.js',
  'session-restore-runtime.js',
  'session-startup-runtime.js',
  'session-startup-cleanup.js',
  'session-ui-settings-restore.js',
  'session-annotation-api-settings-runtime.js',
  'session-annotation-context.js',
  'session-annotation-generated-index.js',
  'session-annotation-marks.js',
  'session-annotation-lightweight-io.js',
  'session-annotation-export-payload.js',
  'session-annotation-import-normalization.js',
  'session-annotation-bundle-merge.js',
  'session-annotation-text.js'
].map((file) => fs.readFileSync(path.join(repoRoot, 'src', 'composables', file), 'utf8')).join('\n');

  assert.ok(
    runtimeSource.includes("import { initReaderRuntimeAssembly } from './reader-runtime-assembly.js';"),
    'reader-runtime should delegate marks state assembly through reader-runtime-assembly'
  );
  assert.ok(
    assemblySource.includes("import { initReaderRuntimeContext } from './reader-runtime-context.js';"),
    'reader-runtime-assembly should initialize marks state through reader runtime context'
  );
  assert.ok(
    contextSource.includes("import { initReaderBootstrapRuntime } from './reader-bootstrap-runtime.js';"),
    'reader-runtime-context should initialize marks state through reader bootstrap runtime'
  );
  assert.ok(
    featureDepsSource.includes('marksStateApi: bootstrapRuntime.marksStateApi'),
    'reader-feature-runtime-deps should receive marks state through the bootstrap module'
  );
  assert.equal(
    runtimeSource.includes("import { initMarksState } from './marks-state-module.js';"),
    false,
    'reader-runtime should not import marks state module directly'
  );
  assert.equal(
    runtimeSource.includes('var marksStateApi = initMarksState();'),
    false,
    'reader-runtime should not initialize marks state directly'
  );
  assert.ok(
    bootstrapSource.includes("import { initMarksState } from './marks-state-module.js';"),
    'reader-bootstrap-runtime should import marks state module'
  );
  assert.ok(
    bootstrapSource.includes('marksStateApi: initMarksState()'),
    'reader-bootstrap-runtime should initialize marks state through the module'
  );
  assert.ok(
    bindingsSource.includes("defineRuntimeStateBinding(runtimeState, 'markedMap', () => marksStateApi.markedMap, (value) => { marksStateApi.setMarkedMap(value); })"),
    'runtimeState.markedMap should read/write marks state module'
  );
  assert.equal(
    runtimeSource.includes('const markedMap = new Map();'),
    false,
    'reader-runtime should not own the markedMap instance'
  );

  assert.ok(
    featureDepsSource.includes('marksStateApi: bootstrapRuntime.marksStateApi'),
    'reader-feature-runtime-deps should pass marks state into reader-feature-runtime'
  );
  assert.ok(
    featureSource.includes('markedMap: deps.marksStateApi.markedMap'),
    'reader-feature-runtime should pass marks state into interaction runtime'
  );
  assert.ok(
    featureSource.includes('var interactionRuntime = initReaderInteractionRuntime({'),
    'reader-feature-runtime should initialize interaction runtime'
  );

  [
    'markedMap: deps.marksStateApi.markedMap',
    'deps.appHandlers.initExports({',
    'deps.appHandlers.initMarksImport({'
  ].forEach((pattern) => {
    assert.ok(
      appRuntimeSource.includes(pattern),
      `reader-app-runtime should pass marks state through explicit deps: ${pattern}`
    );
  });

  assert.ok(
    keyboardRuntimeSource.includes('deps.marksStore.toggleMark('),
    'reader-keyboard-runtime should inject keyboard mark toggle through the marks store'
  );
  assert.ok(
    keyboardRuntimeSource.includes('deps.marksStateApi.markedMap'),
    'reader-keyboard-runtime should pass marks state into the mark toggle'
  );

  assert.equal(
    sessionInitSource.includes('new Map(markedMap)'),
    false,
    'session-init should not depend on a bare markedMap binding'
  );
  [
    'nextMap.set(globalIndex, normalizeAnnotationMark({',
    'const nextMap = replaceExisting ? new Map() : new Map(state.markedMap);',
    'state.markedMap.clear();',
    'nextMap.forEach((value, key) => state.markedMap.set(key, value));',
    "deps.saveToDB('marks', Array.from(state.markedMap.values()));"
  ].forEach((pattern) => {
    assert.ok(
      sessionInitSource.includes(pattern),
      `session-init should keep the st.markedMap contract: ${pattern}`
    );
  });

  assert.ok(
    moduleSource.includes('export function initMarksState'),
    'marks state module should export initMarksState'
  );

  const encodedSource = Buffer.from(moduleSource, 'utf8').toString('base64');
  const { initMarksState } = await import(`data:text/javascript;base64,${encodedSource}#${Date.now()}`);
  const api = initMarksState();
  const mapRef = api.markedMap;

  assert.ok(mapRef instanceof Map);
  assert.equal(mapRef.size, 0);
  mapRef.set(1, { globalIndex: 1, word: 'one' });
  assert.equal(api.markedMap.get(1).word, 'one');

  const nextMap = new Map([[2, { globalIndex: 2, word: 'two' }]]);
  assert.equal(api.setMarkedMap(nextMap), mapRef);
  assert.equal(api.markedMap, mapRef);
  assert.equal(api.markedMap.has(1), false);
  assert.deepEqual(api.markedMap.get(2), { globalIndex: 2, word: 'two' });

  api.setMarkedMap({ ignored: true });
  assert.equal(api.markedMap, mapRef);
  assert.equal(api.markedMap.size, 0);

  const seededMap = new Map([[3, { globalIndex: 3, word: 'three' }]]);
  const seededApi = initMarksState(seededMap);
  assert.deepEqual(seededApi.markedMap.get(3), { globalIndex: 3, word: 'three' });
}

main().then(() => {
  console.log('marks state module check passed');
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
