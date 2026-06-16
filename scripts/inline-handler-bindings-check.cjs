const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const indexSource = fs.readFileSync(path.join(repoRoot, 'index.html'), 'utf8');
const bindingsSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'legacy-control-bindings.js'), 'utf8');

assert.equal(
  /\son(?:click|input|change|keydown|keyup)=/i.test(indexSource),
  false,
  'index.html should not contain inline DOM event handlers'
);

assert.ok(
  indexSource.includes('<script type="module" src="src/composables/legacy-control-bindings.js"></script>'),
  'index.html should load legacy control bindings through the module graph'
);

[
  'handleBackwardClick',
  'handleForwardClick',
  'changeSpeed',
  'cycleHighlightMode',
  'toggleChunkMode',
  'openChunkStyleModal',
  'toggleChunkFocusMode',
  'openChunkNoteStyleModal',
  'closeChunkStyleModal',
  'toggleChunkShadowManual',
  'closeChunkNoteStyleModal',
  'updateChunkStyle',
  'updateChunkNoteStyle'
].forEach((handlerName) => {
  assert.ok(bindingsSource.includes(handlerName), `legacy control bindings should bind ${handlerName}`);
});

console.log('inline handler bindings check passed');
