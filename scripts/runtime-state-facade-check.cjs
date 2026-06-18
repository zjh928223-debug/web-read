const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const appSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime.js'), 'utf8');
const facadeSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'runtime-state-facade.js'), 'utf8');

assert.equal(
  appSource.includes('const runtimeState = {};'),
  false,
  'app.js should not create runtimeState'
);
assert.equal(
  appSource.includes('window.__state = runtimeState;'),
  false,
  'app.js should not expose window.__state'
);
assert.ok(
  appSource.includes("import { runtimeState } from './runtime-state-facade.js';"),
  'app.js should import runtimeState from the facade owner'
);
assert.ok(
  facadeSource.includes('export const runtimeState = {};'),
  'runtime-state-facade should own runtimeState'
);
assert.ok(
  facadeSource.includes('window.__state = runtimeState;'),
  'runtime-state-facade should expose the temporary window.__state alias'
);

console.log('runtime state facade check passed');
