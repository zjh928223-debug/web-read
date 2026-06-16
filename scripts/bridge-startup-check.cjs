const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const appSource = fs.readFileSync(path.join(repoRoot, 'app.js'), 'utf8');
const mainSource = fs.readFileSync(path.join(repoRoot, 'src', 'main.js'), 'utf8');

assert.equal(appSource.includes('window.__bridge'), false, 'app.js should not create or write window.__bridge');
assert.equal(mainSource.includes('window.__bridge'), false, 'src/main.js should not read window.__bridge');
assert.equal(mainSource.includes('preferStore: true'), false, 'state adapters should seed Pinia from fallback state');

assert.ok(appSource.includes('function bridgeToPinia()'), 'bridgeToPinia compatibility function should remain for runtime callers');
assert.ok(appSource.includes('var ps = window.__piniaStores;'), 'bridgeToPinia should write directly to Pinia stores');
assert.ok(mainSource.includes('window.__transcriptState.bindPiniaStore(transcriptStore)'));
assert.ok(mainSource.includes('window.__chunkState.bindPiniaStore(chunkStore)'));
assert.ok(mainSource.includes('window.__clozeState.bindPiniaStore(clozeStore)'));

console.log('bridge startup check passed');
