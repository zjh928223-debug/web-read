const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const appSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime.js'), 'utf8');
const readerPlaybackSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-playback-runtime.js'), 'utf8');
const controlsSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'controls-module.js'), 'utf8');
const playbackSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'playback-module.js'), 'utf8');

[
  ['controls-module.js', controlsSource],
  ['playback-module.js', playbackSource]
].forEach(([fileName, source]) => {
  assert.equal(
    source.includes('window.__state'),
    false,
    `${fileName} should receive state through deps instead of reading window.__state`
  );
  assert.ok(
    source.includes('var state = deps.state;'),
    `${fileName} should bind deps.state explicitly`
  );
});

assert.ok(
  /deps\.playbackModule\.init\(\{\s*state:\s*deps\.runtimeState,/m.test(readerPlaybackSource),
  'reader-playback-runtime should pass explicit runtimeState into playback-module'
);

assert.ok(
  /window\.__controlsModule\.init\(\{\s*state:\s*runtimeState,/m.test(appSource),
  'app.js should pass explicit runtimeState into controls-module'
);

console.log('control/playback state dependency check passed');
