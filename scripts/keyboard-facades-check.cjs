const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const appSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime.js'), 'utf8');
const keyboardSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'keyboard-module.js'), 'utf8');

assert.equal(
  appSource.includes('window.isInputLikeTarget ='),
  false,
  'app.js should not own window.isInputLikeTarget'
);
assert.ok(
  keyboardSource.includes('window.isInputLikeTarget = isInputLikeTarget;'),
  'keyboard-module should own window.isInputLikeTarget'
);
assert.ok(
  keyboardSource.includes('window.__keyboardModule = {'),
  'keyboard-module should still expose its module API'
);
assert.ok(
  keyboardSource.includes('isInputLikeTarget: isInputLikeTarget'),
  'keyboard module API should still expose isInputLikeTarget'
);
assert.equal(
  appSource.includes('const isInputLikeTarget = window.__keyboardModule.isInputLikeTarget;'),
  false,
  'app.js should not keep unused local isInputLikeTarget alias'
);

console.log('keyboard facades check passed');
