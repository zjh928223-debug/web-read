const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const appSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime.js'), 'utf8');
const shellSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime-assembly.js'), 'utf8');
const assemblySource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime-assembly.js'), 'utf8');
const mainSource = fs.readFileSync(path.join(repoRoot, 'src', 'main.js'), 'utf8');
const bridgeSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'pinia-bridge-module.js'), 'utf8');
const featureDepsSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-feature-runtime-deps.js'), 'utf8');
const bootstrapSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-bootstrap-runtime.js'), 'utf8');

assert.equal(appSource.includes('window.__bridge'), false, 'app.js should not create or write window.__bridge');
assert.equal(mainSource.includes('window.__bridge'), false, 'src/main.js should not read window.__bridge');
assert.equal(mainSource.includes('preferStore: true'), false, 'state adapters should seed Pinia from fallback state');

assert.equal(appSource.includes('function bridgeToPinia()'), false, 'app.js should not own bridgeToPinia implementation');
assert.equal(appSource.includes('window.bridgeToPinia ='), false, 'app.js should not own window.bridgeToPinia');
assert.equal(appSource.includes("import { initPiniaBridge } from './pinia-bridge-module.js';"), false);
assert.equal(appSource.includes('var bridgeToPinia = initPiniaBridge({'), false, 'reader-runtime should not initialize the bridge module directly');
assert.ok(appSource.includes("import { initReaderRuntimeAssembly } from './reader-runtime-assembly.js';"), 'reader-runtime should delegate bridge startup through reader-runtime-assembly');
assert.equal(assemblySource.includes('notesSessionRuntime'), false, 'retired notes/session runtime should stay absent');
assert.ok(featureDepsSource.includes('bridgeToPinia: bootstrap.bridgeToPinia'), 'feature deps should receive bridge from bootstrap runtime');
assert.ok(bootstrapSource.includes("import { initPiniaBridge } from './pinia-bridge-module.js'"));
assert.ok(bootstrapSource.includes('var bridgeToPinia = initPiniaBridge({'), 'bootstrap runtime should initialize the bridge module');
assert.ok(bridgeSource.includes('function bridgeToPinia()'), 'bridge module should own bridgeToPinia implementation');
assert.ok(bridgeSource.includes('var ps = requirePiniaRuntimeStores();'), 'bridgeToPinia should resolve the configured Pinia stores');
assert.equal(bridgeSource.includes('window.__piniaStores'), false, 'bridge must not read the retired global store bag');
assert.equal(bridgeSource.includes('window.bridgeToPinia'), false, 'bridge must not publish a window facade');
assert.ok(mainSource.includes('window.__transcriptState.bindPiniaStore(transcriptStore)'));
assert.ok(mainSource.includes('window.__chunkState.bindPiniaStore(chunkStore)'));
assert.doesNotMatch(mainSource, /clozeState|clozeStore|useClozeStore|cloze-state\.js|pinia-stores\/cloze\.js/);
for (const relativePath of ['src/composables/cloze-state.js', 'src/pinia-stores/cloze.js']) {
  assert.equal(fs.existsSync(path.join(repoRoot, relativePath)), false, `${relativePath} must stay retired`);
}

console.log('bridge startup check passed');
