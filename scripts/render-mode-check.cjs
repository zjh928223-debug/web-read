const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const appSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime.js'), 'utf8');
const mainSource = fs.readFileSync(path.join(repoRoot, 'src', 'main.js'), 'utf8');
const renderModeSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'render-mode.js'), 'utf8');

assert.equal(
  appSource.includes('window.__USE_VUE_RENDERING = true;'),
  false,
  'app.js should not own the Vue rendering default'
);
assert.ok(
  appSource.includes("import './render-mode.js';"),
  'app.js should load render-mode while it remains in the entry chain'
);
assert.ok(
  mainSource.includes("import './composables/render-mode.js'"),
  'src/main.js should load render-mode for the final app.js removal path'
);
assert.ok(
  renderModeSource.includes('window.__USE_VUE_RENDERING = true;'),
  'render-mode should set the default Vue rendering flag'
);

console.log('render mode check passed');
