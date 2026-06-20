const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const runtimeSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime.js'), 'utf8');
  const shellSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime-assembly.js'), 'utf8');
const assemblySource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime-assembly.js'), 'utf8');
  const contextSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime-context.js'), 'utf8');
  const bootstrapSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-bootstrap-runtime.js'), 'utf8');
  const featureDepsSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-feature-runtime-deps.js'), 'utf8');
  const keyboardRuntimeSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-keyboard-runtime.js'), 'utf8');
  const keyboardSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'keyboard-module.js'), 'utf8');
  const moduleSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'hotkey-state-module.js'), 'utf8');
  const bindingsSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'runtime-state-bindings.js'), 'utf8');
  const sessionInitSource = [
  'session-runtime-assembly.js',
  'session-restore-runtime.js',
  'session-startup-runtime.js',
  'session-startup-cleanup.js',
  'session-ui-settings-restore.js',
  'session-annotation-api-settings-runtime.js',
  'session-annotation-context.js',
  'session-annotation-generated-index.js',
  'session-annotation-marks.js',
  'session-annotation-lightweight-io.js',
  'session-annotation-export-payload.js',
  'session-annotation-import-normalization.js',
  'session-annotation-bundle-merge.js',
  'session-annotation-text.js'
].map((file) => fs.readFileSync(path.join(repoRoot, 'src', 'composables', file), 'utf8')).join('\n');

  assert.ok(
    runtimeSource.includes("import { initReaderRuntimeAssembly } from './reader-runtime-assembly.js';"),
    'reader-runtime should delegate hotkey state assembly through reader-runtime-assembly'
  );
  assert.ok(
    assemblySource.includes("import { initReaderRuntimeContext } from './reader-runtime-context.js';"),
    'reader-runtime-assembly should initialize hotkey state through reader runtime context'
  );
  assert.ok(
    contextSource.includes("import { initReaderBootstrapRuntime } from './reader-bootstrap-runtime.js';"),
    'reader-runtime-context should initialize hotkey state through reader bootstrap runtime'
  );
  assert.ok(
    featureDepsSource.includes('hotkeyStateApi: bootstrapRuntime.hotkeyStateApi'),
    'reader-feature-runtime-deps should receive hotkey state through the bootstrap module'
  );
  assert.equal(
    runtimeSource.includes("import { initHotkeyState } from './hotkey-state-module.js';"),
    false,
    'reader-runtime should not import hotkey state module directly'
  );
  assert.equal(
    runtimeSource.includes('var hotkeyStateApi = initHotkeyState();'),
    false,
    'reader-runtime should not initialize hotkey state directly'
  );
  assert.ok(
    bootstrapSource.includes("import { initHotkeyState } from './hotkey-state-module.js';"),
    'reader-bootstrap-runtime should import hotkey state module'
  );
  assert.ok(
    bootstrapSource.includes('hotkeyStateApi: initHotkeyState()'),
    'reader-bootstrap-runtime should initialize hotkey state through the module'
  );

  [
    ['markKey', 'setMarkKey'],
    ['notesKey', 'setNotesKey'],
    ['annotationBubbleKey', 'setAnnotationBubbleKey'],
    ['chunkCnKey', 'setChunkCnKey'],
    ['chunkShadowKey', 'setChunkShadowKey'],
    ['chunkNoteKey', 'setChunkNoteKey'],
    ['backwardKey', 'setBackwardKey'],
    ['forwardKey', 'setForwardKey']
  ].forEach(([field, setter]) => {
    assert.ok(
      bindingsSource.includes(`defineRuntimeStateBinding(runtimeState, '${field}', () => hotkeyStateApi.${field}, (value) => { hotkeyStateApi.${setter}(value); })`),
      `runtimeState.${field} should read/write hotkey module state`
    );
    assert.ok(
      keyboardRuntimeSource.includes(`get${setter.slice(3)}: function () { return deps.hotkeyStateApi.${field} }`),
      `keyboard init should pass dynamic getter for ${field}`
    );
    assert.ok(
      keyboardRuntimeSource.includes(`${setter}: deps.hotkeyStateApi.${setter}`),
      `keyboard init should pass module setter for ${field}`
    );
    assert.equal(
      runtimeSource.includes(`let ${field}`),
      false,
      `reader-runtime should not own local hotkey variable: ${field}`
    );
  });

  [
    'var getMarkKey = typeof deps.getMarkKey ===',
    'var getNotesKey = typeof deps.getNotesKey ===',
    'var getAnnotationBubbleKey = typeof deps.getAnnotationBubbleKey ===',
    'var getChunkCnKey = typeof deps.getChunkCnKey ===',
    'var getChunkShadowKey = typeof deps.getChunkShadowKey ===',
    'var getChunkNoteKey = typeof deps.getChunkNoteKey ===',
    'var getBackwardKey = typeof deps.getBackwardKey ===',
    'var getForwardKey = typeof deps.getForwardKey ===',
    'lowerKey === getMarkKey()',
    'lowerKey === getNotesKey()',
    'lowerKey === getAnnotationBubbleKey()',
    'lowerKey === getChunkCnKey()',
    'lowerKey === getChunkShadowKey()',
    'lowerKey === getChunkNoteKey()',
    'key === getBackwardKey() || lowerKey === getBackwardKey()',
    'key === getForwardKey() || lowerKey === getForwardKey()'
  ].forEach((pattern) => {
    assert.ok(
      keyboardSource.includes(pattern),
      `keyboard module should use dynamic hotkey source: ${pattern}`
    );
  });

  [
    'if (savedMarkKey) { state.markKey = savedMarkKey.toLowerCase(); deps.hotkeyInput.value = state.markKey; }',
    'if (savedNotesKey) { state.notesKey = savedNotesKey.toLowerCase(); deps.hotkeyNotesInput.value = state.notesKey; }',
    'if (savedAnnotationBubbleKey) { state.annotationBubbleKey = savedAnnotationBubbleKey.toLowerCase();',
    'if (savedChunkCnKey) { state.chunkCnKey = savedChunkCnKey.toLowerCase(); deps.hotkeyChunkCnInput.value = state.chunkCnKey; }',
    'if (savedChunkShadowKey) { state.chunkShadowKey = savedChunkShadowKey.toLowerCase(); deps.hotkeyChunkShadowInput.value = state.chunkShadowKey; }',
    'if (savedChunkNoteKey) { state.chunkNoteKey = savedChunkNoteKey.toLowerCase();',
    'if (savedBackwardKey) { state.backwardKey = savedBackwardKey; deps.hotkeyBackwardInput.value = state.backwardKey; }',
    'if (savedForwardKey) { state.forwardKey = savedForwardKey; deps.hotkeyForwardInput.value = state.forwardKey; }'
  ].forEach((pattern) => {
    assert.ok(
      sessionInitSource.includes(pattern),
      `session-init hotkey restore contract should remain intact: ${pattern}`
    );
  });

  assert.ok(
    moduleSource.includes('export function initHotkeyState'),
    'hotkey state module should export initHotkeyState'
  );

  const encodedSource = Buffer.from(moduleSource, 'utf8').toString('base64');
  const { initHotkeyState } = await import(`data:text/javascript;base64,${encodedSource}#${Date.now()}`);
  const api = initHotkeyState();

  assert.equal(api.markKey, 'm');
  assert.equal(api.notesKey, 'n');
  assert.equal(api.annotationBubbleKey, 'b');
  assert.equal(api.chunkCnKey, 'c');
  assert.equal(api.chunkShadowKey, 's');
  assert.equal(api.chunkNoteKey, 'x');
  assert.equal(api.backwardKey, 'ArrowLeft');
  assert.equal(api.forwardKey, 'ArrowRight');

  assert.equal(api.setMarkKey('q'), 'q');
  assert.equal(api.setNotesKey('w'), 'w');
  assert.equal(api.setAnnotationBubbleKey('e'), 'e');
  assert.equal(api.setChunkCnKey('r'), 'r');
  assert.equal(api.setChunkShadowKey('t'), 't');
  assert.equal(api.setChunkNoteKey('y'), 'y');
  assert.equal(api.setBackwardKey('a'), 'a');
  assert.equal(api.setForwardKey('d'), 'd');
  assert.deepEqual(
    {
      markKey: api.markKey,
      notesKey: api.notesKey,
      annotationBubbleKey: api.annotationBubbleKey,
      chunkCnKey: api.chunkCnKey,
      chunkShadowKey: api.chunkShadowKey,
      chunkNoteKey: api.chunkNoteKey,
      backwardKey: api.backwardKey,
      forwardKey: api.forwardKey
    },
    {
      markKey: 'q',
      notesKey: 'w',
      annotationBubbleKey: 'e',
      chunkCnKey: 'r',
      chunkShadowKey: 't',
      chunkNoteKey: 'y',
      backwardKey: 'a',
      forwardKey: 'd'
    }
  );

  assert.equal(api.setMarkKey(''), 'm');
  assert.equal(api.setBackwardKey(null), 'ArrowLeft');

  const customApi = initHotkeyState({ markKey: 'z', forwardKey: 'ArrowDown' });
  assert.equal(customApi.markKey, 'z');
  assert.equal(customApi.forwardKey, 'ArrowDown');
}

main().then(() => {
  console.log('hotkey state module check passed');
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
