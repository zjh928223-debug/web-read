const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const runtimeSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime.js'), 'utf8');
  const shellSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime-assembly.js'), 'utf8');
const assemblySource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime-assembly.js'), 'utf8');
  const featureSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-feature-runtime.js'), 'utf8');
  const featureAdaptersSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-feature-runtime-deps.js'), 'utf8');
  const moduleSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-keyboard-runtime.js'), 'utf8');
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
    'reader-runtime should delegate keyboard setup through reader-runtime-assembly'
  );
  assert.ok(
    assemblySource.includes("import { initReaderFeatureRuntime } from './reader-feature-runtime.js';"),
    'reader-runtime-assembly should delegate keyboard setup through reader-feature-runtime'
  );
  assert.ok(
    featureAdaptersSource.includes("import { initReaderKeyboardRuntime } from './reader-keyboard-runtime.js'"),
    'reader feature adapters should import the reader keyboard runtime module'
  );
  assert.ok(
    featureAdaptersSource.includes('return initReaderKeyboardRuntime({'),
    'reader feature adapters should initialize keyboard wiring through reader keyboard runtime'
  );
  [
    'window.__keyboardModule.init({',
    'deps.marksStore.toggleMark(',
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

  const lookupSource = fs.readFileSync(path.join(repoRoot, 'src', 'utils', 'playback-index.js'), 'utf8')
    .replace(/^window.PlaybackIndexHelpers = .*;$/m, '');
  const lookupUrl = `data:text/javascript;base64,${Buffer.from(lookupSource, 'utf8').toString('base64')}`;
  const importableSource = moduleSource.replace("'../utils/playback-index.js'", JSON.stringify(lookupUrl));
  const encodedSource = Buffer.from(importableSource, 'utf8').toString('base64');
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

  const { bsFindActive } = await import(lookupUrl);
  const adjacent = [{ word: 'A', start: 1, end: 2 }, { word: 'B', start: 2, end: 3 }];
  const overlap = [{ word: 'A', start: 1, end: 3 }, { word: 'B', start: 2, end: 2.2 }];
  for (const isChunkMode of [false, true]) {
    for (const highlightMode of [1, 2]) {
      Object.assign(deps.chunkState, { isChunkMode });
      Object.assign(deps.transcriptState, {
        words: adjacent, wordStarts: [1, 2], currentWordIndex: 0,
        selectedAnnotationWordIndex: 0, highlightMode
      });
      initReaderKeyboardRuntime(deps);
      const playingMedia = { paused: false, currentTime: 2.001 };
      keyboardConfig.toggleMarkCurrent(playingMedia);
      assert.equal(calls.mark.currentWordIndex, 1, 'playing key must sample time after the cached frame');
      assert.equal(deps.transcriptState.currentWordIndex, 0, 'mark lookup must not replace playback projection');
      assert.equal(playingMedia.currentTime, 2.001, 'mark lookup must not seek');

      Object.assign(deps.transcriptState, { words: overlap, currentWordIndex: 1 });
      keyboardConfig.toggleMarkCurrent({ paused: false, currentTime: 2.1 });
      assert.equal(calls.mark.currentWordIndex, 1, 'two active overlaps keep latest-start priority');
      keyboardConfig.toggleMarkCurrent({ paused: false, currentTime: 2.5 });
      assert.equal(calls.mark.currentWordIndex, 0, 'ended later overlap must not hide earlier active word');

      Object.assign(deps.transcriptState, { words: adjacent, currentWordIndex: 1 });
      keyboardConfig.toggleMarkCurrent({ paused: false, currentTime: 3 });
      assert.equal(calls.mark.currentWordIndex, -1, 'gap must pass no target to the existing mark owner');
      Object.assign(deps.transcriptState, { currentWordIndex: 0 });
      keyboardConfig.toggleMarkCurrent({ paused: true, currentTime: 2.5 });
      assert.equal(calls.mark.currentWordIndex, 0, 'paused click/position target must remain explicit');
    }
  }
  assert.equal(bsFindActive([0], [{ start: 0, end: 0 }], 0), -1, 'zero end is not missing');
  assert.equal(bsFindActive([1], [{ start: 1 }], 2.9), 0, 'missing end keeps two-second fallback');
  assert.equal(bsFindActive([1], [{ start: 1 }], 3), -1, 'fallback end is exclusive');
  assert.equal(bsFindActive([1], [{ start: 1, end: 2 }], 1), 0, 'start is inclusive');
  assert.equal(bsFindActive([1], [{ start: 1, end: 2 }], 2), -1, 'end is exclusive');
  assert.equal(bsFindActive([], [], 0), -1);
  assert.equal(bsFindActive([1], null, 1), -1);
  assert.equal(bsFindActive([1], adjacent, NaN), -1);

  keyboardConfig.closeCustomThemePanel();
  assert.equal(calls.themeClosed, 1);

  console.log('reader keyboard runtime check passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
