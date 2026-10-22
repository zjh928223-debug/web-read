const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const repoRoot = path.resolve(__dirname, '..');
const runtimeSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime.js'), 'utf8');
const shellSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime-assembly.js'), 'utf8');
const assemblySource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime-assembly.js'), 'utf8');
const featureSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-feature-runtime.js'), 'utf8');
const featureDepsSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-feature-runtime-deps.js'), 'utf8');
const controlsRuntimeSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-controls-runtime.js'), 'utf8');
const themeControlsSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'theme-controls-module.js'), 'utf8');
const themeStoreSource = fs.readFileSync(path.join(repoRoot, 'src', 'pinia-stores', 'theme.js'), 'utf8');
const sessionInitSource = [
  'session-runtime-assembly.js',
  'session-lifecycle-runtime.js',
  'session-restore-runtime.js',
  'session-startup-runtime.js',
  'session-startup-cleanup.js',
  'session-ui-settings-restore.js',
  'session-annotation-context.js',
  'session-annotation-runtime.js',
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
  'reader-runtime should delegate controls setup through reader-runtime-assembly'
);
assert.ok(
  assemblySource.includes("import { initReaderFeatureRuntime } from './reader-feature-runtime.js';"),
  'reader-runtime-assembly should delegate controls setup through reader-feature-runtime'
);
assert.ok(
  featureDepsSource.includes("import { initReaderControlsRuntime } from './reader-controls-runtime.js'"),
  'reader-feature-runtime-deps should import the reader controls runtime module'
);

assert.equal(
  runtimeSource.includes("import { initThemeControls } from './theme-controls-module.js';"),
  false,
  'reader-runtime should not import the theme controls module directly'
);

assert.ok(
  controlsRuntimeSource.includes("import { initThemeControls } from './theme-controls-module.js'"),
  'reader-controls-runtime should import the theme controls module'
);

assert.ok(
  controlsRuntimeSource.includes('initThemeControls({'),
  'reader-controls-runtime should initialize theme controls through the module'
);

const customThemeVarBlock = themeStoreSource.match(/const CUSTOM_THEME_VAR_NAMES = \[([\s\S]*?)\n\]/);
assert.ok(customThemeVarBlock, 'theme store should expose a custom theme clear-list declaration');
const inlineVars = new Map();
const attributes = new Map();
const stored = new Map();
const themeContext = {
  defineStore: (_name, setup) => setup,
  ref: (value) => ({ value }),
  document: {
    documentElement: {
      style: { setProperty: (key, value) => inlineVars.set(key, value), removeProperty: (key) => inlineVars.delete(key) },
      setAttribute: (key, value) => attributes.set(key, value), removeAttribute: (key) => attributes.delete(key)
    },
    getElementById: () => null
  },
  localStorage: { getItem: (key) => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, value) }
};
vm.createContext(themeContext);
vm.runInContext(themeStoreSource.replace(/^import .*\r?\n/gm, '').replace('export const useThemeStore', 'const useThemeStore') + '\nthis.themeStore = useThemeStore();', themeContext);
const themeStore = themeContext.themeStore;
const clearNames = [...customThemeVarBlock[1].matchAll(/'([^']+)'/g)].map((match) => match[1]).sort();
const retiredThemeVars = ['--sidebar-bg', '--sidebar-border', '--vocab-indicator-color',
  '--v-word-color', '--v-context-color', '--v-meaning-color', '--v-not-color'];
for (const bg of ['#d8e7f5', '#101820']) {
  const colors = { bg, text: '#12263a', sub: '#355c7d', border: '#8db3d9', button: '#f2b880' };
  themeStore.applyCustom(colors);
  for (const name of retiredThemeVars) {
    assert.equal(inlineVars.has(name), false, 'retired theme variable must not be generated: ' + name);
  }
  assert.deepEqual([...inlineVars.keys()].sort(), clearNames, 'every generated custom variable must be paired with clearing');
  assert.deepEqual(JSON.parse(stored.get('themeCustomColors')), colors, 'custom theme must persist exactly the five colors');
  themeStore.applyMode('light', false);
  assert.equal(inlineVars.size, 0, 'leaving custom must clear all generated inline variables');
  themeStore.init();
  assert.equal(themeStore.currentTheme.value, 'custom', 'startup must restore the stored custom mode');
  assert.equal(inlineVars.get('--bg-color'), bg, 'startup must restore the stored background');
  themeStore.applyMode('dark', false);
  assert.equal(inlineVars.size, 0, 'leaving restored custom for dark must clear all generated variables');
  assert.equal(attributes.has('data-theme-mode'), false, 'default modes must clear custom mode');
}

[
  'themeStore.init();',
  "themeToggleBtn.addEventListener('click'",
  'themeStore.getStoredCustomThemeColors()',
  'themeStore.applyCustomTheme(themeStore.CUSTOM_THEME_DEFAULTS)'
].forEach((pattern) => {
  assert.equal(
    runtimeSource.includes(pattern),
    false,
    `reader-runtime should not own theme control binding logic: ${pattern}`
  );
  assert.ok(
    themeControlsSource.includes(pattern),
    `theme-controls-module should own theme control binding logic: ${pattern}`
  );
});

[
  'refreshAllChunkNoteVisuals',
  'getLockChunkNoteDimensionsForTheme',
  '__lockChunkNoteDimensionsForTheme'
].forEach((retiredSurface) => {
  assert.equal(
    themeControlsSource.includes(retiredSurface),
    false,
    `theme controls must not call retired notes surface: ${retiredSurface}`
  );
  assert.equal(
    controlsRuntimeSource.includes(retiredSurface),
    false,
    `reader controls must not inject retired notes surface: ${retiredSurface}`
  );
});

[
  "deps.processTranscript(transcriptData);",
  "deps.processChunkData(chunkData);",
  "windowObject.toggleChunkMode(true);",
  "deps.bridgeToPinia();",
  "import { renderTranscript, renderChunkMode } from './render-runtime.js';",
  "import { getSessionState } from './session-state-provider.js';"
].forEach((pattern) => {
  assert.ok(
    sessionInitSource.includes(pattern),
    `session-init contract should remain intact: ${pattern}`
  );
});

console.log('theme controls module check passed');
