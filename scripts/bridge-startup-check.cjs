const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const appSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime.js'), 'utf8');
const shellSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime-shell.js'), 'utf8');
const assemblySource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime-assembly.js'), 'utf8');
const mainSource = fs.readFileSync(path.join(repoRoot, 'src', 'main.js'), 'utf8');
const bridgeSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'pinia-bridge-module.js'), 'utf8');
const featureDepsSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-feature-runtime-deps.js'), 'utf8');
const notesRuntimeSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-notes-runtime.js'), 'utf8');

assert.equal(appSource.includes('window.__bridge'), false, 'app.js should not create or write window.__bridge');
assert.equal(mainSource.includes('window.__bridge'), false, 'src/main.js should not read window.__bridge');
assert.equal(mainSource.includes('preferStore: true'), false, 'state adapters should seed Pinia from fallback state');

assert.equal(appSource.includes('function bridgeToPinia()'), false, 'app.js should not own bridgeToPinia implementation');
assert.equal(appSource.includes('window.bridgeToPinia ='), false, 'app.js should not own window.bridgeToPinia');
assert.equal(appSource.includes("import { initPiniaBridge } from './pinia-bridge-module.js';"), false);
assert.equal(appSource.includes('var bridgeToPinia = initPiniaBridge({'), false, 'reader-runtime should not initialize the bridge module directly');
assert.ok(appSource.includes("import { initReaderRuntimeShell } from './reader-runtime-shell.js';"), 'reader-runtime should delegate bridge startup through reader-runtime-shell');
assert.ok(assemblySource.includes('notesSessionRuntime: notesSessionRuntime'), 'reader-runtime-assembly should pass notes/session runtime to focused feature deps');
assert.ok(featureDepsSource.includes('bridgeToPinia: notesSessionRuntime.bridgeToPinia'), 'reader-feature-runtime-deps should receive the bridge for injected callers');
assert.ok(notesRuntimeSource.includes("import { initPiniaBridge } from './pinia-bridge-module.js'"));
assert.ok(notesRuntimeSource.includes('var bridgeToPinia = initPiniaBridge({'), 'reader-notes-runtime should initialize the bridge module');
assert.ok(bridgeSource.includes('function bridgeToPinia()'), 'bridge module should own bridgeToPinia implementation');
assert.ok(bridgeSource.includes('var ps = window.__piniaStores;'), 'bridgeToPinia should write directly to Pinia stores');
assert.ok(bridgeSource.includes('window.bridgeToPinia = bridgeToPinia;'), 'bridge module should own window.bridgeToPinia');
assert.ok(mainSource.includes('window.__transcriptState.bindPiniaStore(transcriptStore)'));
assert.ok(mainSource.includes('window.__chunkState.bindPiniaStore(chunkStore)'));
assert.ok(mainSource.includes('window.__clozeState.bindPiniaStore(clozeStore)'));

console.log('bridge startup check passed');
