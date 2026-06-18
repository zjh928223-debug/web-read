const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const runtimeSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime.js'), 'utf8');
  const featureSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-feature-runtime.js'), 'utf8');
  const appRuntimeSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-app-runtime.js'), 'utf8');
  const transferSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'chunk-note-transfer-module.js'), 'utf8');
  const keyboardSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'keyboard-module.js'), 'utf8');
  const sessionInitSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'session-init.js'), 'utf8');

  assert.ok(
    runtimeSource.includes("import { initReaderFeatureRuntime } from './reader-feature-runtime.js';"),
    'reader-runtime should delegate reader app runtime through reader-feature-runtime'
  );
  assert.ok(
    featureSource.includes("import { initReaderAppRuntime } from './reader-app-runtime.js';"),
    'reader-feature-runtime should import reader app runtime module'
  );
  assert.equal(
    runtimeSource.includes("import { initChunkNoteTransfer } from './chunk-note-transfer-module.js';"),
    false,
    'reader-runtime should not import chunk note transfer module directly'
  );
  assert.ok(
    appRuntimeSource.includes("import { initChunkNoteTransfer } from './chunk-note-transfer-module.js'"),
    'reader-app-runtime should import chunk note transfer module'
  );
  assert.ok(
    appRuntimeSource.includes('var chunkNoteTransferApi = initChunkNoteTransfer({'),
    'reader-app-runtime should initialize chunk note transfer through the module'
  );

  [
    'function supportsChunkNotesDirectOverwrite',
    'function triggerChunkNotesDownload',
    'async function writeChunkNotesToHandle',
    'async function saveChunkNotesAs',
    'function openChunkNotesExportConfirmDialog',
    "importChunkNotesInput.addEventListener('change'",
    "exportChunkNotesBtn.addEventListener('click'"
  ].forEach((pattern) => {
    assert.equal(
      runtimeSource.includes(pattern),
      false,
      `reader-runtime should not own chunk note transfer logic: ${pattern}`
    );
  });

  [
    'function closeExportDialog()',
    'async function writeToHandle',
    'async function saveAs',
    'function openExportConfirmDialog'
  ].forEach((pattern) => {
    assert.ok(
      transferSource.includes(pattern),
      `chunk-note-transfer module should own ${pattern}`
    );
  });

  assert.ok(
    keyboardSource.includes('var getChunkNoteExportDialogEl = deps.getChunkNoteExportDialogEl || function () { return deps.chunkNoteExportDialogEl; };'),
    'keyboard module should read export dialog through a getter'
  );
  assert.ok(
    keyboardSource.includes('var exportDlg = getChunkNoteExportDialogEl();'),
    'keyboard module should call the export dialog getter'
  );

  const previousWindow = global.window;
  const previousDocument = global.document;
  const previousURL = global.URL;
  const previousBlob = global.Blob;

  const appended = [];
  let linkClicked = false;
  global.window = { innerWidth: 1024, innerHeight: 768 };
  global.document = {
    body: {
      appendChild(node) { appended.push(node); },
      removeChild(node) {
        const index = appended.indexOf(node);
        if (index >= 0) appended.splice(index, 1);
      }
    },
    addEventListener() {},
    removeEventListener() {},
    createElement(tagName) {
      if (tagName === 'a') {
        return {
          href: '',
          download: '',
          click() { linkClicked = true; }
        };
      }
      return {
        className: '',
        innerHTML: '',
        style: {},
        remove() {},
        querySelectorAll() { return []; }
      };
    }
  };
  global.URL = { createObjectURL: () => 'blob:chunk-notes' };
  global.Blob = function Blob(parts, options) {
    this.parts = parts;
    this.options = options;
  };

  try {
    const encodedSource = Buffer.from(transferSource, 'utf8').toString('base64');
    const { initChunkNoteTransfer } = await import(`data:text/javascript;base64,${encodedSource}#${Date.now()}`);

    const listeners = {};
    const importButton = {
      addEventListener(type, handler) { listeners[`importButton:${type}`] = handler; }
    };
    const importInput = {
      clicked: false,
      click() { this.clicked = true; },
      addEventListener(type, handler) { listeners[`importInput:${type}`] = handler; }
    };
    const exportButton = {
      addEventListener(type, handler) { listeners[`exportButton:${type}`] = handler; }
    };

    let importedPayload = null;
    let savedNow = false;
    let enteredChunkMode = false;
    let noteVisible = null;
    let renderedChunk = false;
    let fileState = { handle: null, audioKey: '', fileName: '' };
    const toasts = [];

    initChunkNoteTransfer({
      importButton,
      importInput,
      exportButton,
      getFirstFileFromEvent: () => ({ name: 'chunk_notes.json' }),
      readFileAsText: (file, callback) => callback(JSON.stringify({ notes: [{ id: 'n1' }] })),
      applyImportedChunkNotes: (payload) => { importedPayload = payload; },
      saveChunkNotesNow: () => { savedNow = true; },
      getHasAiChunkData: () => true,
      getIsChunkMode: () => false,
      enterChunkMode: () => { enteredChunkMode = true; },
      setChunkNoteVisible: (visible, persist) => { noteVisible = { visible, persist }; },
      renderChunkMode: () => { renderedChunk = true; },
      buildChunkNotesSnapshot: () => ({ notes: [{ id: 'n1' }] }),
      getCurrentAudioFilenameBase: () => 'lesson',
      getChunkNotesFileState: () => fileState,
      setChunkNotesFileState: (next) => { fileState = next; },
      getCurrentAudioKey: () => 'audio-key',
      showToast: (message, type) => { toasts.push({ message, type }); },
      showError: (code, message) => { throw new Error(`${code}: ${message}`); }
    });

    listeners['importButton:click']();
    assert.equal(importInput.clicked, true, 'import button should click the file input');

    const changeEvent = { target: { value: 'chunk_notes.json' } };
    listeners['importInput:change'](changeEvent);
    assert.deepEqual(importedPayload, { notes: [{ id: 'n1' }] });
    assert.equal(savedNow, true);
    assert.equal(enteredChunkMode, true);
    assert.deepEqual(noteVisible, { visible: true, persist: true });
    assert.equal(renderedChunk, true);
    assert.equal(changeEvent.target.value, '');

    await listeners['exportButton:click']();
    assert.equal(linkClicked, true, 'export fallback should trigger a download link click');
    assert.deepEqual(fileState, { handle: null, audioKey: '', fileName: 'lesson_chunk_notes.json' });
    assert.ok(toasts.some((toast) => toast.message === 'Chunk notes imported' && toast.type === 'success'));
    assert.ok(toasts.some((toast) => toast.message === 'Chunk notes saved' && toast.type === 'success'));
  } finally {
    global.window = previousWindow;
    global.document = previousDocument;
    global.URL = previousURL;
    global.Blob = previousBlob;
  }

  [
    "processTranscript(transcriptData);",
    "processChunkData(chunkData);",
    "window.toggleChunkMode(true);",
    "bridgeToPinia();"
  ].forEach((pattern) => {
    assert.ok(
      sessionInitSource.includes(pattern),
      `session-init contract should remain intact: ${pattern}`
    );
  });

  console.log('chunk note transfer check passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
