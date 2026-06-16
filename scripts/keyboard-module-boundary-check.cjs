const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const repoRoot = path.resolve(__dirname, '..');
const sourcePath = path.join(repoRoot, 'src', 'composables', 'keyboard-module.js');
const source = fs.readFileSync(sourcePath, 'utf8');

const sandbox = {
  window: {},
  console,
};

vm.runInNewContext(source, sandbox, { filename: sourcePath });

const api = sandbox.window.__keyboardModule;
assert.ok(api, 'keyboard module should attach to window');
assert.equal(typeof api.init, 'function');
assert.equal(typeof api.isInputLikeTarget, 'function');

assert.equal(api.isInputLikeTarget({ tagName: 'TEXTAREA' }), true);
assert.equal(api.isInputLikeTarget({ tagName: 'INPUT', type: 'text' }), true);
assert.equal(api.isInputLikeTarget({ tagName: 'INPUT', type: 'search' }), true);
assert.equal(api.isInputLikeTarget({ tagName: 'INPUT', type: 'file' }), false);
assert.equal(api.isInputLikeTarget({ tagName: 'INPUT', type: 'color' }), false);
assert.equal(api.isInputLikeTarget({ tagName: 'INPUT', type: 'button' }), false);
assert.equal(api.isInputLikeTarget({ tagName: 'BUTTON' }), false);
assert.equal(api.isInputLikeTarget(null), false);

console.log('keyboard module boundary check passed');
