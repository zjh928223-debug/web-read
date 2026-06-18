const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const runtimeSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime.js'), 'utf8');
  const contextSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime-context.js'), 'utf8');
  const helperSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime-helpers.js'), 'utf8');
  const sessionInitSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'session-init.js'), 'utf8');

  assert.ok(
    contextSource.includes("} from './reader-runtime-helpers.js';"),
    'reader-runtime-context should import reader runtime helpers'
  );
  [
    'createReaderFocusRestorer({',
    'createCurrentNoteToggler({',
    'createChunkNoteTransferDialogAccess({'
  ].forEach((pattern) => {
    assert.ok(contextSource.includes(pattern), `reader-runtime-context should configure ${pattern}`);
  });
  assert.ok(
    runtimeSource.includes("import { initReaderRuntimeContext } from './reader-runtime-context.js';"),
    'reader-runtime should use reader-runtime-context'
  );
  assert.ok(
    runtimeSource.includes('const restoreReaderFocus = runtimeContext.restoreReaderFocus;'),
    'reader-runtime should receive restoreReaderFocus from context'
  );
  assert.ok(
    runtimeSource.includes('const toggleCurrentNote = runtimeContext.toggleCurrentNote;'),
    'reader-runtime should receive toggleCurrentNote from context'
  );

  [
    "} from './reader-runtime-helpers.js';",
    'createReaderFocusRestorer({',
    'createCurrentNoteToggler({',
    'createChunkNoteTransferDialogAccess({',
    'function restoreReaderFocus()',
    'function toggleCurrentNote()',
    'function closeChunkNoteExportDialog()',
    'function getChunkNoteExportDialogEl()',
    "document.getElementById('note-'"
  ].forEach((pattern) => {
    assert.equal(
      runtimeSource.includes(pattern),
      false,
      `reader-runtime should not own helper implementation: ${pattern}`
    );
  });

  [
    'export function createReaderFocusRestorer',
    'export function createCurrentNoteToggler',
    'export function createChunkNoteTransferDialogAccess'
  ].forEach((pattern) => {
    assert.ok(helperSource.includes(pattern), `reader-runtime-helpers should own ${pattern}`);
  });
  assert.equal(helperSource.includes('window.'), false, 'reader-runtime-helpers should not read or write window globals');
  assert.equal(helperSource.includes('document.'), false, 'reader-runtime-helpers should not read document globals directly');

  [
    'setChunkNoteVisible(_ns.chunkNoteVisible, false);',
    'applyCurrentAudioMeta(audioMeta);',
    'await loadChunkNotesForCurrentAudio();',
    'await loadSentenceNotesForCurrentAudio();',
    'await switchSentenceNotesDoc(transcriptData);'
  ].forEach((pattern) => {
    assert.ok(sessionInitSource.includes(pattern), `session-init contract should remain intact: ${pattern}`);
  });

  const encodedSource = Buffer.from(helperSource, 'utf8').toString('base64');
  const {
    createReaderFocusRestorer,
    createCurrentNoteToggler,
    createChunkNoteTransferDialogAccess
  } = await import(`data:text/javascript;base64,${encodedSource}#${Date.now()}`);

  let blurred = 0;
  let focused = 0;
  const doc = {
    activeElement: { blur() { blurred += 1; } },
    body: { focus() { throw new Error('body should not be focused when target exists'); } },
    getElementById() { return null; }
  };
  const focusTarget = {
    receivedOptions: null,
    focus(options) {
      focused += 1;
      this.receivedOptions = options;
    }
  };
  const restoreReaderFocus = createReaderFocusRestorer({
    getDocument: () => doc,
    getFocusTarget: () => focusTarget
  });
  restoreReaderFocus();
  assert.equal(blurred, 1, 'focus restorer should blur the current active element');
  assert.equal(focused, 1, 'focus restorer should focus the injected target');
  assert.deepEqual(focusTarget.receivedOptions, { preventScroll: true });

  const noteEl = { open: false };
  const toggler = createCurrentNoteToggler({
    chunkState: { isChunkMode: false },
    transcriptState: { currentWordIndex: 0, words: [{ segIndex: 3 }] },
    playbackState: { lastActiveSegIndex: 8 },
    getDocument: () => ({
      getElementById(id) {
        assert.equal(id, 'note-3');
        return noteEl;
      }
    })
  });
  toggler();
  assert.equal(noteEl.open, true, 'current note toggler should open the selected note element');
  toggler();
  assert.equal(noteEl.open, false, 'current note toggler should toggle the selected note element');

  const chunkModeNote = { open: false };
  createCurrentNoteToggler({
    chunkState: { isChunkMode: true },
    transcriptState: { currentWordIndex: 0, words: [{ segIndex: 1 }] },
    playbackState: { lastActiveSegIndex: -1 },
    getDocument: () => ({ getElementById: () => chunkModeNote })
  })();
  assert.equal(chunkModeNote.open, false, 'current note toggler should do nothing in chunk mode');

  let closed = 0;
  const dialogEl = { id: 'export-dialog' };
  const dialogAccess = createChunkNoteTransferDialogAccess({
    getTransferApi: () => ({
      closeExportDialog() {
        closed += 1;
        return 'closed';
      },
      getExportDialogEl() {
        return dialogEl;
      }
    })
  });
  assert.equal(dialogAccess.closeChunkNoteExportDialog(), 'closed');
  assert.equal(closed, 1);
  assert.equal(dialogAccess.getChunkNoteExportDialogEl(), dialogEl);

  const emptyDialogAccess = createChunkNoteTransferDialogAccess({ getTransferApi: () => null });
  assert.equal(emptyDialogAccess.closeChunkNoteExportDialog(), undefined);
  assert.equal(emptyDialogAccess.getChunkNoteExportDialogEl(), null);

  console.log('reader runtime helpers check passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
