const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const appSource = fs.readFileSync(path.join(repoRoot, 'app.js'), 'utf8');
const moduleSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'highlight-controls-module.js'), 'utf8');
const chunkControlsSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'chunk-controls-module.js'), 'utf8');

assert.ok(
  appSource.includes("import { initHighlightControls } from './src/composables/highlight-controls-module.js';"),
  'app.js should import the highlight controls module'
);
assert.ok(
  moduleSource.includes('export function initHighlightControls'),
  'highlight controls module should expose an explicit init API'
);

[
  'cycleHighlightMode',
  'updateHighlightModeUI'
].forEach((name) => {
  assert.equal(
    new RegExp(`function\\s+${name}\\s*\\(`).test(appSource),
    false,
    `app.js should not own ${name}`
  );
  assert.ok(
    new RegExp(`function\\s+${name}\\s*\\(`).test(moduleSource),
    `highlight controls module should own ${name}`
  );
});

assert.equal(appSource.includes('window.cycleHighlightMode ='), false, 'app.js should not own window.cycleHighlightMode');
assert.ok(
  moduleSource.includes('window.cycleHighlightMode = cycleHighlightMode;'),
  'highlight controls module should own window.cycleHighlightMode'
);
assert.ok(
  appSource.includes('updateHighlightModeUI: highlightControlsApi.updateHighlightModeUI'),
  'app.js should pass highlight control API to chunk controls'
);
assert.ok(
  chunkControlsSource.includes('deps.updateHighlightModeUI'),
  'chunk controls should receive highlight UI updates as an injected dependency'
);

console.log('highlight controls module check passed');
