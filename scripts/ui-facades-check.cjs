const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const indexSource = fs.readFileSync(path.join(repoRoot, 'index.html'), 'utf8');
const appSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime.js'), 'utf8');
const assemblySource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime-assembly.js'), 'utf8');
const facadeSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'ui-facades.js'), 'utf8');

[
  'showToast',
  'showError'
].forEach((name) => {
  assert.equal(appSource.includes(`function ${name}(`), false, `app.js should not own ${name}`);
  assert.equal(appSource.includes(`window.${name} =`), false, `app.js should not own window.${name}`);
  assert.ok(facadeSource.includes(`export function ${name}(`), `ui-facades should export ${name}`);
  assert.ok(facadeSource.includes(`window.${name} = ${name};`), `ui-facades should own window.${name}`);
});

assert.equal(
  facadeSource.includes('window.__uiStore'),
  false,
  'ui-facades should not delegate to the legacy __uiStore facade because it delegates back to window.showToast/window.showError'
);
assert.equal(
  fs.existsSync(path.join(repoRoot, 'src', 'stores', 'ui.js')),
  false,
  'the UI compatibility store should be retired after Pinia became the only UI state owner'
);
assert.equal(
  indexSource.includes('src/stores/ui.js'),
  false,
  'index.html should not load the retired UI compatibility store'
);
assert.ok(
  assemblySource.includes("import { showToast, showError } from './ui-facades.js';"),
  'reader runtime assembly should import UI facades'
);

console.log('ui facades check passed');
