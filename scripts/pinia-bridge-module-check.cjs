const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const appSource = fs.readFileSync(path.join(repoRoot, 'app.js'), 'utf8');
const bridgeSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'pinia-bridge-module.js'), 'utf8');
const interactionSource = fs.readFileSync(path.join(repoRoot, 'scripts', 'read-web-interactions-check.cjs'), 'utf8');

assert.ok(
  appSource.includes("import { initPiniaBridge } from './src/composables/pinia-bridge-module.js';"),
  'app.js should import the Pinia bridge module'
);
assert.ok(
  appSource.includes('var bridgeToPinia = initPiniaBridge({'),
  'app.js should initialize Pinia bridge once'
);
assert.equal(appSource.includes('function bridgeToPinia()'), false, 'app.js should not own bridgeToPinia implementation');
assert.equal(appSource.includes('window.bridgeToPinia ='), false, 'app.js should not own window.bridgeToPinia');
assert.ok(bridgeSource.includes('export function initPiniaBridge'), 'bridge module should expose an init API');
assert.ok(bridgeSource.includes('window.bridgeToPinia = bridgeToPinia;'), 'bridge module should own window.bridgeToPinia');
assert.ok(bridgeSource.includes('chunkState.getSnapshot()'), 'bridge module should read chunk state owner snapshots');
assert.ok(bridgeSource.includes('clozeState.getSnapshot()'), 'bridge module should read cloze state owner snapshots');
assert.ok(interactionSource.includes('window.bridgeToPinia'), 'compatibility tests should still cover window.bridgeToPinia');

console.log('pinia bridge module check passed');
