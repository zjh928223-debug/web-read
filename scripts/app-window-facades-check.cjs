const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const appSource = fs.readFileSync(path.join(repoRoot, 'app.js'), 'utf8');
const playbackSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'playback-module.js'), 'utf8');
const controlsSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'controls-module.js'), 'utf8');
const styleSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'style-editor.js'), 'utf8');
const sessionInitSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'session-init.js'), 'utf8');

[
  'handleBackwardClick',
  'handleForwardClick',
  'forceUpdateUI',
  'mainUpdateHighlight',
  'changeSpeed',
  'toggleChunkBtn',
  'openChunkStyleModal',
  'closeChunkStyleModal',
  'updateChunkStyle'
].forEach((name) => {
  assert.equal(
    appSource.includes(`window.${name} =`),
    false,
    `app.js should not duplicate window.${name} facade ownership`
  );
});

[
  'handleBackwardClick',
  'handleForwardClick',
  'forceUpdateUI',
  'mainUpdateHighlight'
].forEach((name) => {
  assert.ok(playbackSource.includes(`window.${name} = ${name};`), `playback-module should own window.${name}`);
});

assert.ok(controlsSource.includes('window.changeSpeed = changeSpeed;'), 'controls-module should own window.changeSpeed');
assert.equal(sessionInitSource.includes('window.toggleChunkBtn'), false, 'session-init should not read window.toggleChunkBtn');

[
  'openChunkStyleModal',
  'closeChunkStyleModal',
  'updateChunkStyle'
].forEach((name) => {
  assert.ok(styleSource.includes(`window.${name} = ${name};`), `style-editor should own window.${name}`);
});

console.log('app window facades check passed');
