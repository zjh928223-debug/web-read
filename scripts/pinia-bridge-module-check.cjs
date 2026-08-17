const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const appSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime.js'), 'utf8');
const shellSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime-assembly.js'), 'utf8');
const assemblySource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime-assembly.js'), 'utf8');
const featureDepsSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-feature-runtime-deps.js'), 'utf8');
const bootstrapSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-bootstrap-runtime.js'), 'utf8');
const bridgeSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'pinia-bridge-module.js'), 'utf8');
const interactionSource = fs.readFileSync(path.join(repoRoot, 'scripts', 'read-web-interactions-check.cjs'), 'utf8');

assert.ok(
  appSource.includes("import { initReaderRuntimeAssembly } from './reader-runtime-assembly.js';"),
  'reader-runtime should delegate Pinia bridge assembly through reader-runtime-assembly'
);
assert.ok(
  bootstrapSource.includes("import { initPiniaBridge } from './pinia-bridge-module.js';"),
  'bootstrap runtime should import the Pinia bridge'
);
assert.equal(
  assemblySource.includes('notesSessionRuntime'),
  false,
  'retired notes/session runtime should stay absent'
);
assert.ok(
  featureDepsSource.includes('bridgeToPinia: bootstrap.bridgeToPinia'),
  'feature deps should receive the Pinia bridge from bootstrap runtime'
);
assert.ok(
  bootstrapSource.includes('var bridgeToPinia = initPiniaBridge({'),
  'bootstrap runtime should initialize the bridge once'
);
assert.ok(
  bootstrapSource.includes('bridgeToPinia: bridgeToPinia'),
  'bootstrap runtime should expose the bridge'
);
assert.equal(appSource.includes('initPiniaBridge({'), false, 'reader-runtime should not initialize Pinia bridge directly');
assert.equal(appSource.includes('function bridgeToPinia()'), false, 'reader-runtime should not own bridgeToPinia implementation');
assert.equal(appSource.includes('window.bridgeToPinia ='), false, 'reader-runtime should not own window.bridgeToPinia');
assert.ok(
  bootstrapSource.includes("import { initPiniaBridge } from './pinia-bridge-module.js'"),
  'bootstrap runtime should import the bridge module'
);
assert.ok(
  bootstrapSource.includes('var bridgeToPinia = initPiniaBridge({'),
  'bootstrap runtime should initialize Pinia bridge once'
);
assert.ok(bridgeSource.includes('export function initPiniaBridge'), 'bridge module should expose an init API');
assert.ok(bridgeSource.includes('export function bridgeToPinia()'), 'bridge module should expose an explicit bridge API');
assert.equal(bridgeSource.includes('window.bridgeToPinia'), false, 'bridge module should not publish a window bridge');
assert.ok(bridgeSource.includes('chunkState.getSnapshot()'), 'bridge module should read chunk state owner snapshots');
assert.ok(bridgeSource.includes('clozeState.getSnapshot()'), 'bridge module should read cloze state owner snapshots');
assert.equal(interactionSource.includes('window.bridgeToPinia'), false, 'behavior checks should not depend on the retired window bridge');

console.log('pinia bridge module check passed');
