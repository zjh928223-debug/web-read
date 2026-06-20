const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const runtimeSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime.js'), 'utf8');
const shellSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime-assembly.js'), 'utf8');
const assemblySource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime-assembly.js'), 'utf8');
const featureSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-feature-runtime.js'), 'utf8');
const controlsRuntimeSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-controls-runtime.js'), 'utf8');
const themeControlsSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'theme-controls-module.js'), 'utf8');
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
  'reader-runtime should delegate controls setup through reader-runtime-assembly'
);
assert.ok(
  assemblySource.includes("import { initReaderFeatureRuntime } from './reader-feature-runtime.js';"),
  'reader-runtime-assembly should delegate controls setup through reader-feature-runtime'
);
assert.ok(
  featureSource.includes("import { initReaderControlsRuntime } from './reader-controls-runtime.js';"),
  'reader-feature-runtime should import the reader controls runtime module'
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
