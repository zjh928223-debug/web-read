const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const runtimeSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime.js'), 'utf8');
  const shellSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime-shell.js'), 'utf8');
  const featureSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-feature-runtime.js'), 'utf8');
  const moduleSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-keyboard-runtime.js'), 'utf8');
  const sessionInitSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'session-init.js'), 'utf8');

  assert.ok(
    runtimeSource.includes("import { initReaderRuntimeShell } from './reader-runtime-shell.js';"),
    'reader-runtime should delegate keyboard setup through reader-runtime-shell'
  );
  assert.ok(
    shellSource.includes("import { initReaderFeatureRuntime } from './reader-feature-runtime.js';"),
    'reader-runtime-shell should delegate keyboard setup through reader-feature-runtime'
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
    'chunkNoteVisible: function () { return deps.notesState.chunkNoteVisible }',
    'getMarkKey: function () { return deps.hotkeyStateApi.markKey }',
    'setMarkKey: deps.hotkeyStateApi.setMarkKey',
    'beginHoldChunkCn: deps.chunkControlsApi.beginHoldChunkCn',
    'deps.marksStore.toggleMark(',
    'closeCustomThemePanel: function () { deps.themeStore.closeCustomThemePanel() }',
    'getChunkNoteExportDialogEl: deps.getChunkNoteExportDialogEl'
  ].forEach((pattern) => {
    assert.ok(
      moduleSource.includes(pattern),
      `reader-keyboard-runtime should own keyboard wiring: ${pattern}`
    );
  });

  assert.equal(moduleSource.includes('window.'), false, 'reader-keyboard-runtime should not read window globals');
  assert.equal(moduleSource.includes('document.'), false, 'reader-keyboard-runtime should not read document globals');

  [
    'processTranscript(transcriptData);',
    'processChunkData(chunkData);',
    'window.toggleChunkMode(true);',
    'bridgeToPinia();'
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
    notesState: {
      chunkNoteVisible: true
    },
    hotkeyStateApi: {
      markKey: 'm',
      notesKey: 'n',
      annotationBubbleKey: 'b',
      chunkCnKey: 'c',
      chunkShadowKey: 's',
      chunkNoteKey: 'x',
      backwardKey: 'ArrowLeft',
      forwardKey: 'ArrowRight',
      setMarkKey(value) { this.markKey = value; },
      setNotesKey(value) { this.notesKey = value; },
      setAnnotationBubbleKey(value) { this.annotationBubbleKey = value; },
      setChunkCnKey(value) { this.chunkCnKey = value; },
      setChunkShadowKey(value) { this.chunkShadowKey = value; },
      setChunkNoteKey(value) { this.chunkNoteKey = value; },
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
    chunkNotesApi: {
      cancelChunkNoteModal() {},
      closeChunkNoteDeleteDialog() {},
      setSelectedChunkNote() {},
      openChunkNoteDeleteDialog() {},
      getChunkNoteDeleteDialogEl() { return { id: 'delete-dialog' }; },
      getSelectedChunkNoteId() { return 'note-1'; },
      handleChunkSelectionContextMenu() {},
      getPendingChunkSelectionCtx() { return { id: 'pending' }; },
      consumePendingChunkSelectionCtx() { return { id: 'consumed' }; },
      openChunkNotePopover() {},
      getChunkNoteModalEl() { return { id: 'modal' }; },
      saveChunkNoteFromModal() {}
    },
    saveToDB() { calls.saveDb += 1; },
    syncAnnotationGenerationEntryStatus() { calls.sync += 1; },
    toggleCurrentNote() {},
    toggleAnnotationBubble() {},
    setChunkNoteVisible() {},
    handleBackwardClick() {},
    handleForwardClick() {},
    closeChunkNoteContextMenu() {},
    closeChunkNoteExportDialog() {},
    getChunkNoteExportDialogEl() { return { id: 'export-dialog' }; },
    chunkNoteCtxAddBtn: { id: 'add' },
    hotkeyInput: { id: 'hotkey' },
    hotkeyNotesInput: { id: 'notes' },
    hotkeyAnnotationBubbleInput: { id: 'bubble' },
    hotkeyBackwardInput: { id: 'back' },
    hotkeyForwardInput: { id: 'forward' },
    hotkeyChunkCnInput: { id: 'cn' },
    hotkeyChunkShadowInput: { id: 'shadow' },
    hotkeyChunkNoteInput: { id: 'note' },
    highlightColorInput: { id: 'highlight' },
    sentenceColorInput: { id: 'sentence' },
    themeCustomPanel: { id: 'theme-panel' },
    themeControlsEl: { id: 'theme-controls' },
    chunkNoteCtxMenu: { id: 'ctx-menu' }
  };

  initReaderKeyboardRuntime(deps);

  assert.ok(keyboardConfig, 'keyboard module should be initialized');
  assert.equal(keyboardConfig.audioPlayer, deps.audioPlayer);
  assert.equal(keyboardConfig.isChunkMode(), true);
  assert.equal(keyboardConfig.chunkCnHoldMode(), false);
  assert.equal(keyboardConfig.chunkNoteVisible(), true);
  assert.equal(keyboardConfig.getMarkKey(), 'm');
  deps.hotkeyStateApi.setMarkKey('z');
  assert.equal(keyboardConfig.getMarkKey(), 'z');
  assert.equal(keyboardConfig.beginHoldChunkCn, deps.chunkControlsApi.beginHoldChunkCn);
  assert.deepEqual(keyboardConfig.getChunkNoteExportDialogEl(), deps.getChunkNoteExportDialogEl());
  assert.deepEqual(keyboardConfig.pendingChunkSelectionCtx(), { id: 'pending' });
  assert.deepEqual(keyboardConfig.consumePendingChunkSelectionCtx(), { id: 'consumed' });
  assert.equal(keyboardConfig.getChunkNoteModalEl().id, 'modal');

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
