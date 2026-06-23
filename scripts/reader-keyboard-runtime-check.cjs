const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const runtimeSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime.js'), 'utf8');
  const shellSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime-assembly.js'), 'utf8');
const assemblySource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime-assembly.js'), 'utf8');
  const featureSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-feature-runtime.js'), 'utf8');
  const moduleSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-keyboard-runtime.js'), 'utf8');
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
    'reader-runtime should delegate keyboard setup through reader-runtime-assembly'
  );
  assert.ok(
    assemblySource.includes("import { initReaderFeatureRuntime } from './reader-feature-runtime.js';"),
    'reader-runtime-assembly should delegate keyboard setup through reader-feature-runtime'
  );
  assert.ok(
    featureSource.includes("import { initReaderKeyboardRuntime } from './reader-keyboard-runtime.js';"),
    'reader-feature-runtime should import the reader keyboard runtime module'
  );
  assert.ok(
    featureSource.includes('initReaderKeyboardRuntime({'),
    'reader-feature-runtime should initialize keyboard wiring through reader keyboard runtime'
  );
  [
    'window.__keyboardModule.init({',
    'window.__marksStore.toggleMark(marksStateApi.markedMap',
    'getMarkKey: function () { return hotkeyStateApi.markKey; }',
    'setMarkKey: hotkeyStateApi.setMarkKey',
    'beginHoldChunkCn: chunkControlsApi.beginHoldChunkCn'
  ].forEach((pattern) => {
    assert.equal(
      runtimeSource.includes(pattern),
      false,
      `reader-runtime should not own keyboard wiring: ${pattern}`
    );
  });

  [
    'export function initReaderKeyboardRuntime',
    'deps.keyboardModule.init({',
    'isChunkMode: function () { return deps.chunkState.isChunkMode }',
    'getMarkKey: function () { return deps.hotkeyStateApi.markKey }',
    'setMarkKey: deps.hotkeyStateApi.setMarkKey',
    'beginHoldChunkCn: deps.chunkControlsApi.beginHoldChunkCn',
    'deps.marksStore.toggleMark(',
    'closeCustomThemePanel: function () { deps.themeStore.closeCustomThemePanel() }'
  ].forEach((pattern) => {
    assert.ok(
      moduleSource.includes(pattern),
      `reader-keyboard-runtime should own keyboard wiring: ${pattern}`
    );
  });

  assert.equal(moduleSource.includes('window.'), false, 'reader-keyboard-runtime should not read window globals');
  assert.equal(moduleSource.includes('document.'), false, 'reader-keyboard-runtime should not read document globals');
  [
    'chunkNoteVisible',
    'hotkeyNotesInput',
    'hotkeyChunkNoteInput',
    'chunkNoteCtxAddBtn',
    'chunkNoteCtxMenu',
    'getChunkNoteExportDialogEl',
    'closeChunkNoteExportDialog',
    'toggleCurrentNote',
    'setChunkNoteVisible'
  ].forEach((pattern) => {
    assert.equal(moduleSource.includes(pattern), false, `retired keyboard note wiring should stay removed: ${pattern}`);
  });

  [
    'deps.processTranscript(transcriptData);',
    'deps.processChunkData(chunkData);',
    'windowObject.toggleChunkMode(true);',
    'deps.bridgeToPinia();'
  ].forEach((pattern) => {
    assert.ok(
      sessionInitSource.includes(pattern),
      `session-init contract should remain intact: ${pattern}`
    );
  });

  const encodedSource = Buffer.from(moduleSource, 'utf8').toString('base64');
  const { initReaderKeyboardRuntime } = await import(`data:text/javascript;base64,${encodedSource}#${Date.now()}`);

  let keyboardConfig = null;
  const calls = {
    mark: null,
    themeClosed: 0,
    saveDb: 0,
    sync: 0
  };
  const markedMap = new Map();
  const deps = {
    keyboardModule: {
      init(config) {
        keyboardConfig = config;
      }
    },
    marksStore: {
      toggleMark(marked, currentWordIndex, words, saveToDB, syncAnnotationGenerationEntryStatus) {
        calls.mark = { marked, currentWordIndex, words, saveToDB, syncAnnotationGenerationEntryStatus };
      }
    },
    themeStore: {
      closeCustomThemePanel() {
        calls.themeClosed += 1;
      }
    },
    audioPlayer: { id: 'audio' },
    transcriptState: {
      currentWordIndex: 4,
      words: [{ word: 'four' }]
    },
    chunkState: {
      isChunkMode: true,
      chunkCnHoldMode: false
    },
    hotkeyStateApi: {
      markKey: 'm',
      annotationBubbleKey: 'b',
      chunkCnKey: 'c',
      chunkShadowKey: 's',
      backwardKey: 'ArrowLeft',
      forwardKey: 'ArrowRight',
      setMarkKey(value) { this.markKey = value; },
      setAnnotationBubbleKey(value) { this.annotationBubbleKey = value; },
      setChunkCnKey(value) { this.chunkCnKey = value; },
      setChunkShadowKey(value) { this.chunkShadowKey = value; },
      setBackwardKey(value) { this.backwardKey = value; },
      setForwardKey(value) { this.forwardKey = value; }
    },
    marksStateApi: {
      markedMap
    },
    chunkControlsApi: {
      beginHoldChunkCn() {},
      endHoldChunkCn() {},
      toggleChunkCn() {},
      toggleChunkShadow() {}
    },
    chunkNotesApi: {},
    saveToDB() { calls.saveDb += 1; },
    syncAnnotationGenerationEntryStatus() { calls.sync += 1; },
    toggleAnnotationBubble() {},
    handleBackwardClick() {},
    handleForwardClick() {},
    hotkeyInput: { id: 'hotkey' },
    hotkeyAnnotationBubbleInput: { id: 'bubble' },
    hotkeyBackwardInput: { id: 'back' },
    hotkeyForwardInput: { id: 'forward' },
    hotkeyChunkCnInput: { id: 'cn' },
    hotkeyChunkShadowInput: { id: 'shadow' },
    highlightColorInput: { id: 'highlight' },
    sentenceColorInput: { id: 'sentence' },
    themeCustomPanel: { id: 'theme-panel' },
    themeControlsEl: { id: 'theme-controls' }
  };

  initReaderKeyboardRuntime(deps);

  assert.ok(keyboardConfig, 'keyboard module should be initialized');
  assert.equal(keyboardConfig.audioPlayer, deps.audioPlayer);
  assert.equal(keyboardConfig.isChunkMode(), true);
  assert.equal(keyboardConfig.chunkCnHoldMode(), false);
  assert.equal(keyboardConfig.getMarkKey(), 'm');
  deps.hotkeyStateApi.setMarkKey('z');
  assert.equal(keyboardConfig.getMarkKey(), 'z');
  assert.equal(keyboardConfig.beginHoldChunkCn, deps.chunkControlsApi.beginHoldChunkCn);

  keyboardConfig.toggleMarkCurrent();
  assert.equal(calls.mark.marked, markedMap);
  assert.equal(calls.mark.currentWordIndex, 4);
  assert.deepEqual(calls.mark.words, [{ word: 'four' }]);
  assert.equal(calls.mark.saveToDB, deps.saveToDB);
  assert.equal(calls.mark.syncAnnotationGenerationEntryStatus, deps.syncAnnotationGenerationEntryStatus);

  keyboardConfig.closeCustomThemePanel();
  assert.equal(calls.themeClosed, 1);

  console.log('reader keyboard runtime check passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
