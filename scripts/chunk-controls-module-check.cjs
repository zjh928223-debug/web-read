const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const appSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime.js'), 'utf8');
const shellSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime-shell.js'), 'utf8');
const assemblySource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime-assembly.js'), 'utf8');
const featureSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-feature-runtime.js'), 'utf8');
const controlsRuntimeSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-controls-runtime.js'), 'utf8');
const keyboardRuntimeSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-keyboard-runtime.js'), 'utf8');
const moduleSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'chunk-controls-module.js'), 'utf8');

assert.ok(
  appSource.includes("import { initReaderRuntimeShell } from './reader-runtime-shell.js';"),
  'app.js should delegate controls setup through reader-runtime-shell'
);
assert.ok(
  assemblySource.includes("import { initReaderFeatureRuntime } from './reader-feature-runtime.js';"),
  'reader-runtime-shell should delegate controls setup through reader-feature-runtime'
);
assert.ok(
  featureSource.includes("import { initReaderControlsRuntime } from './reader-controls-runtime.js';"),
  'reader-feature-runtime should import the reader controls runtime module'
);
assert.equal(
  appSource.includes("import { initChunkControls } from './chunk-controls-module.js';"),
  false,
  'app.js should not import the chunk controls module directly'
);
assert.ok(
  controlsRuntimeSource.includes("import { initChunkControls } from './chunk-controls-module.js'"),
  'reader-controls-runtime should import the chunk controls module'
);
assert.ok(
  controlsRuntimeSource.includes('var chunkControlsApi = initChunkControls({'),
  'reader-controls-runtime should initialize chunk controls through the module'
);

assert.ok(
  moduleSource.includes('export function initChunkControls'),
  'chunk controls module should expose an explicit init API'
);

[
  'toggleChunkMode',
  'setChunkCnVisible',
  'toggleChunkCn',
  'updateChunkCnHoldBtn',
  'toggleChunkCnHoldMode',
  'beginHoldChunkCn',
  'endHoldChunkCn',
  'updateChunkFocusModeUI',
  'toggleChunkFocusMode',
  'toggleChunkShadow',
  'updateShadowBtnText',
  'toggleChunkShadowManual'
].forEach((name) => {
  assert.equal(
    new RegExp(`function\\s+${name}\\s*\\(`).test(appSource),
    false,
    `app.js should not own ${name}`
  );
  assert.ok(
    new RegExp(`function\\s+${name}\\s*\\(`).test(moduleSource),
    `chunk controls module should own ${name}`
  );
});

[
  'toggleChunkMode',
  'toggleChunkFocusMode',
  'toggleChunkShadowManual',
  'updateChunkCnHoldBtn'
].forEach((name) => {
  assert.equal(appSource.includes(`window.${name} =`), false, `app.js should not own window.${name}`);
  assert.ok(moduleSource.includes(`window.${name} = ${name};`), `chunk controls module should own window.${name}`);
});

assert.equal(appSource.includes("Object.defineProperty(runtimeState, 'holdPrevHadFocusClass'"), false);
assert.equal(/\blet\s+holdPrevHadFocusClass\b/.test(appSource), false);

[
  'chunkControlsApi.beginHoldChunkCn',
  'chunkControlsApi.endHoldChunkCn',
  'chunkControlsApi.toggleChunkCn',
  'chunkControlsApi.toggleChunkShadow'
].forEach((fragment) => {
  assert.ok(keyboardRuntimeSource.includes(fragment.replace('chunkControlsApi.', 'deps.chunkControlsApi.')), `reader-keyboard-runtime should delegate through ${fragment}`);
});

assert.equal(
  appSource.includes('chunkControlsApi.updateChunkCnHoldBtn'),
  false,
  'app.js should not schedule initial chunk CN hold button updates'
);

assert.ok(
  moduleSource.includes('setTimeout(function () {') && moduleSource.includes('try { updateChunkCnHoldBtn(); }'),
  'chunk controls module should own the initial chunk CN hold button update'
);

console.log('chunk controls module check passed');
