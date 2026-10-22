const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

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
  'closeChunkStyleModal',
  'toggleChunkShadowManual',
  'updateChunkStyle'
].forEach((handlerName) => {
  assert.ok(bindingsSource.includes(handlerName), `legacy control bindings should bind ${handlerName}`);
});

// Execute the automatic bindings and verify that repeated initialization is idempotent.
const calls = [];
const ids = ['btn-prev-sentence', 'btn-next-sentence', 'btn-chunk-style', 'chunk-gap-input'];
function element(dataset = {}) {
  const listeners = new Map();
  return { dataset, listeners, addEventListener(type, fn) {
    if (!listeners.has(type)) listeners.set(type, []);
    listeners.get(type).push(fn);
  } };
}
const elements = new Map(ids.map((id) => [id, element()]));
const speed = element({ speed: '1.25' });
const context = {
  window: Object.fromEntries(['handleBackwardClick', 'handleForwardClick', 'openChunkStyleModal', 'updateChunkStyle', 'changeSpeed']
    .map((name) => [name, (...args) => calls.push([name, ...args])])),
  document: { getElementById: (id) => elements.get(id), querySelectorAll: () => [speed] },
};
vm.runInNewContext(bindingsSource.replace('export function bindLegacyControlHandlers', 'function bindLegacyControlHandlers'), context);
assert.equal(Object.hasOwn(context.window, '__legacyControlBindings'), false);
context.bindLegacyControlHandlers();
for (const id of ids) {
  const type = id === 'chunk-gap-input' ? 'input' : 'click';
  assert.equal(elements.get(id).listeners.get(type).length, 1);
  elements.get(id).listeners.get(type)[0]();
}
assert.equal(speed.listeners.get('click').length, 1);
speed.listeners.get('click')[0]();
assert.deepEqual(calls, [['handleBackwardClick'], ['handleForwardClick'], ['openChunkStyleModal'], ['updateChunkStyle'], ['changeSpeed', 1.25]]);
console.log('inline handler bindings check passed');
