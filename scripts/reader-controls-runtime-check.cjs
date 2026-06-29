const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

async function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const runtimePath = path.join(repoRoot, 'src', 'composables', 'reader-runtime.js');
  const shellPath = path.join(repoRoot, 'src', 'composables', 'reader-runtime-assembly.js');
  const assemblyPath = path.join(repoRoot, 'src', 'composables', 'reader-runtime-assembly.js');
  const featurePath = path.join(repoRoot, 'src', 'composables', 'reader-feature-runtime.js');
  const modulePath = path.join(repoRoot, 'src', 'composables', 'reader-controls-runtime.js');
  const runtimeSource = fs.readFileSync(runtimePath, 'utf8');
  const shellSource = fs.readFileSync(shellPath, 'utf8');
  const assemblySource = fs.readFileSync(assemblyPath, 'utf8');
  const featureSource = fs.readFileSync(featurePath, 'utf8');
  const moduleSource = fs.readFileSync(modulePath, 'utf8');
  const sessionInitSource = [
    'session-runtime-assembly.js',
    'session-restore-runtime.js',
    'session-startup-runtime.js',
    'session-startup-cleanup.js',
    'session-ui-settings-restore.js',
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
  assert.ok(
    featureSource.includes('var controlsRuntime = initReaderControlsRuntime({'),
    'reader-feature-runtime should initialize controls through reader controls runtime'
  );

  [
    "import { initChunkControls } from './chunk-controls-module.js';",
    "import { initHighlightControls } from './highlight-controls-module.js';",
    "import { initThemeControls } from './theme-controls-module.js';",
    'initChunkControls({',
    'initHighlightControls({',
    'initThemeControls({',
    'window.__styleEditor.init({',
    'initAnnotationApiSettingsUi();',
    'deps.initAnnotationApiSettingsUi()'
  ].forEach((pattern) => {
    assert.equal(
      runtimeSource.includes(pattern),
      false,
      `reader-runtime should not own controls setup: ${pattern}`
    );
  });

  [
    "import { initChunkControls } from './chunk-controls-module.js'",
    "import { initHighlightControls } from './highlight-controls-module.js'",
    "import { initThemeControls } from './theme-controls-module.js'",
    'export function initReaderControlsRuntime',
    'var highlightControlsApi = initHighlightControls({',
    'var chunkControlsApi = initChunkControls({',
    'deps.styleEditor.init({',
    'initThemeControls({',
    'updateHighlightModeUI: highlightControlsApi.updateHighlightModeUI',
    'updateShadowBtnText: chunkControlsApi.updateShadowBtnText'
  ].forEach((pattern) => {
    assert.ok(
      moduleSource.includes(pattern),
      `reader-controls-runtime should own controls setup: ${pattern}`
    );
  });

  assert.equal(moduleSource.includes('window.'), false, 'reader-controls-runtime should not read window globals');
  assert.equal(moduleSource.includes('document.'), false, 'reader-controls-runtime should not read document globals');

  [
    'deps.processTranscript(transcriptData);',
    'deps.processChunkData(chunkData);',
    'windowObject.toggleChunkMode(true);',
    'deps.bridgeToPinia();',
    "import { getSessionState } from './session-state-provider.js';"
  ].forEach((pattern) => {
    assert.ok(
      sessionInitSource.includes(pattern),
      `session-init contract should remain intact: ${pattern}`
    );
  });

  const calls = {
    highlight: [],
    chunk: [],
    theme: [],
    style: []
  };
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reader-controls-runtime-'));
  const tempModulePath = path.join(tempDir, 'reader-controls-runtime.mjs');
  const tempSource = moduleSource
    .replace(
      "import { initChunkControls } from './chunk-controls-module.js'\n",
      "const initChunkControls = globalThis.__readerControlsRuntimeTest.initChunkControls;\n"
    )
    .replace(
      "import { initHighlightControls } from './highlight-controls-module.js'\n",
      "const initHighlightControls = globalThis.__readerControlsRuntimeTest.initHighlightControls;\n"
    )
    .replace(
      "import { initThemeControls } from './theme-controls-module.js'\n",
      "const initThemeControls = globalThis.__readerControlsRuntimeTest.initThemeControls;\n"
    );
  fs.writeFileSync(tempModulePath, tempSource);

  globalThis.__readerControlsRuntimeTest = {
    initHighlightControls(deps) {
      calls.highlight.push(deps);
      return {
        updateHighlightModeUI() {}
      };
    },
    initChunkControls(deps) {
      calls.chunk.push(deps);
      return {
        beginHoldChunkCn() {},
        updateShadowBtnText() {}
      };
    },
    initThemeControls(deps) {
      calls.theme.push(deps);
    }
  };

  const { initReaderControlsRuntime } = await import(pathToFileURL(tempModulePath).href);
  const deps = {
    transcriptState: { segments: [] },
    chunkState: { isChunkMode: true },
    playbackState: { activeIndex: 0 },
    highlightModeBtn: { id: 'highlight' },
    chunkFileInput: { id: 'chunkFileInput' },
    toggleChunkBtn: { id: 'toggleChunkBtn' },
    chunkCnHoldBtn: { id: 'chunkCnHoldBtn' },
    audioPlayer: { id: 'audio' },
    closeChunkNoteContextMenu() {},
    closeChunkNotePopover() {},
    renderChunkMode() {},
    renderTranscript() {},
    clearChunkNoteConnectors() {},
    getForceUpdateUI() { return false; },
    bridgeToPinia() {},
    styleEditor: {
      init(styleDeps) {
        calls.style.push(styleDeps);
      }
    },
    adjustChunkNoteArrowSizeByGap() {},
    renderAllChunkNoteTags() {},
    scheduleChunkNoteConnectorRedraw() {},
    themeStore: { init() {} },
    themeToggleBtn: { id: 'themeToggleBtn' },
    themeCustomBgInput: { id: 'themeCustomBgInput' },
    themeCustomTextInput: { id: 'themeCustomTextInput' },
    themeCustomSubInput: { id: 'themeCustomSubInput' },
    themeCustomBorderInput: { id: 'themeCustomBorderInput' },
    themeCustomButtonInput: { id: 'themeCustomButtonInput' },
    themeCustomResetBtn: { id: 'themeCustomResetBtn' },
    refreshAllChunkNoteVisuals() {},
    getLockChunkNoteDimensionsForTheme() { return false; }
  };

  const api = initReaderControlsRuntime(deps);

  assert.equal(calls.highlight.length, 1, 'highlight controls should be initialized once');
  assert.equal(calls.chunk.length, 1, 'chunk controls should be initialized once');
  assert.equal(calls.theme.length, 1, 'theme controls should be initialized once');
  assert.equal(calls.style.length, 1, 'style editor should be initialized once');

  assert.equal(calls.highlight[0].transcriptState, deps.transcriptState);
  assert.equal(calls.highlight[0].chunkState, deps.chunkState);
  assert.equal(calls.highlight[0].playbackState, deps.playbackState);
  assert.equal(calls.highlight[0].getForceUpdateUI, deps.getForceUpdateUI);
  assert.equal(calls.chunk[0].state, deps.chunkState);
  assert.equal(calls.chunk[0].closeChunkNotePopover, deps.closeChunkNotePopover);
  assert.equal(typeof calls.chunk[0].updateHighlightModeUI, 'function');
  assert.equal(calls.style[0].updateShadowBtnText, api.chunkControlsApi.updateShadowBtnText);
  assert.equal(calls.style[0].getIsChunkMode(), true);
  assert.equal(calls.theme[0].themeStore, deps.themeStore);
  assert.equal(calls.theme[0].getLockChunkNoteDimensionsForTheme, deps.getLockChunkNoteDimensionsForTheme);
  assert.equal(typeof api.highlightControlsApi.updateHighlightModeUI, 'function');
  assert.equal(typeof api.chunkControlsApi.beginHoldChunkCn, 'function');

  delete globalThis.__readerControlsRuntimeTest;

  console.log('reader controls runtime check passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
