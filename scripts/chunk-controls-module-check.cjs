const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const appSource = fs.readFileSync(path.join(repoRoot, 'app.js'), 'utf8');
const moduleSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'chunk-controls-module.js'), 'utf8');

assert.ok(
  appSource.includes("import { initChunkControls } from './src/composables/chunk-controls-module.js';"),
  'app.js should import the chunk controls module'
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
  'chunkControlsApi.toggleChunkShadow',
  'chunkControlsApi.updateChunkCnHoldBtn'
].forEach((fragment) => {
  assert.ok(appSource.includes(fragment), `app.js should delegate through ${fragment}`);
});

console.log('chunk controls module check passed');
