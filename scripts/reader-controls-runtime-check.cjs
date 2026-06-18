const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

async function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const runtimePath = path.join(repoRoot, 'src', 'composables', 'reader-runtime.js');
  const featurePath = path.join(repoRoot, 'src', 'composables', 'reader-feature-runtime.js');
  const modulePath = path.join(repoRoot, 'src', 'composables', 'reader-controls-runtime.js');
  const sessionInitPath = path.join(repoRoot, 'src', 'composables', 'session-init.js');
  const runtimeSource = fs.readFileSync(runtimePath, 'utf8');
  const featureSource = fs.readFileSync(featurePath, 'utf8');
  const moduleSource = fs.readFileSync(modulePath, 'utf8');
  const sessionInitSource = fs.readFileSync(sessionInitPath, 'utf8');

  assert.ok(
    runtimeSource.includes("import { initReaderFeatureRuntime } from './reader-feature-runtime.js';"),
    'reader-runtime should delegate controls setup through reader-feature-runtime'
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
    'initAnnotationApiSettingsUi();'
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
    'deps.initAnnotationApiSettingsUi()',
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
    'processTranscript(transcriptData);',
    'processChunkData(chunkData);',
    'window.toggleChunkMode(true);',
    'bridgeToPinia();',
    "import { renderTranscript, renderChunkMode } from './render-runtime.js';",
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
    style: [],
    annotationSettings: 0
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
    getLockChunkNoteDimensionsForTheme() { return false; },
    initAnnotationApiSettingsUi() { calls.annotationSettings += 1; }
  };

  const api = initReaderControlsRuntime(deps);

  assert.equal(calls.highlight.length, 1, 'highlight controls should be initialized once');
  assert.equal(calls.chunk.length, 1, 'chunk controls should be initialized once');
  assert.equal(calls.theme.length, 1, 'theme controls should be initialized once');
  assert.equal(calls.style.length, 1, 'style editor should be initialized once');
  assert.equal(calls.annotationSettings, 1, 'annotation settings UI should be initialized once');

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
