const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const appSource = fs.readFileSync(path.join(repoRoot, 'app.js'), 'utf8');
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
assert.ok(
  appSource.includes("import { showToast, showError } from './src/composables/ui-facades.js';"),
  'app.js should import UI facades'
);

console.log('ui facades check passed');
