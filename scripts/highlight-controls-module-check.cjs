const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const appSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime.js'), 'utf8');
const shellSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime-shell.js'), 'utf8');
const featureSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-feature-runtime.js'), 'utf8');
const controlsRuntimeSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-controls-runtime.js'), 'utf8');
const moduleSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'highlight-controls-module.js'), 'utf8');
const chunkControlsSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'chunk-controls-module.js'), 'utf8');

assert.ok(
  appSource.includes("import { initReaderRuntimeShell } from './reader-runtime-shell.js';"),
  'app.js should delegate controls setup through reader-runtime-shell'
);
assert.ok(
  shellSource.includes("import { initReaderFeatureRuntime } from './reader-feature-runtime.js';"),
  'reader-runtime-shell should delegate controls setup through reader-feature-runtime'
);
assert.ok(
  featureSource.includes("import { initReaderControlsRuntime } from './reader-controls-runtime.js';"),
  'reader-feature-runtime should import the reader controls runtime module'
);
assert.equal(
  appSource.includes("import { initHighlightControls } from './highlight-controls-module.js';"),
  false,
  'app.js should not import the highlight controls module directly'
);
assert.ok(
  controlsRuntimeSource.includes("import { initHighlightControls } from './highlight-controls-module.js'"),
  'reader-controls-runtime should import the highlight controls module'
);
assert.ok(
  controlsRuntimeSource.includes('var highlightControlsApi = initHighlightControls({'),
  'reader-controls-runtime should initialize highlight controls through the module'
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
  controlsRuntimeSource.includes('updateHighlightModeUI: highlightControlsApi.updateHighlightModeUI'),
  'reader-controls-runtime should pass highlight control API to chunk controls'
);
assert.ok(
  chunkControlsSource.includes('deps.updateHighlightModeUI'),
  'chunk controls should receive highlight UI updates as an injected dependency'
);

console.log('highlight controls module check passed');
