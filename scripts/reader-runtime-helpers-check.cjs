const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const runtimeSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime.js'), 'utf8');
  const shellSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime-assembly.js'), 'utf8');
const assemblySource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime-assembly.js'), 'utf8');
  const contextSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime-context.js'), 'utf8');
  const featureDepsSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-feature-runtime-deps.js'), 'utf8');
  const helperSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime-helpers.js'), 'utf8');
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
    contextSource.includes("import { createReaderFocusRestorer } from './reader-runtime-helpers.js';"),
    'reader-runtime-context should import reader runtime helpers'
  );
  [
    'createReaderFocusRestorer({'
  ].forEach((pattern) => {
    assert.ok(contextSource.includes(pattern), `reader-runtime-context should configure ${pattern}`);
  });
  assert.ok(
    runtimeSource.includes("import { initReaderRuntimeAssembly } from './reader-runtime-assembly.js';"),
    'reader-runtime should delegate reader-runtime-context through reader-runtime-assembly'
  );
  assert.ok(
    assemblySource.includes("import { initReaderRuntimeContext } from './reader-runtime-context.js';"),
    'reader-runtime-assembly should use reader-runtime-context'
  );
  assert.ok(
    featureDepsSource.includes('restoreReaderFocus: runtimeContext.restoreReaderFocus,'),
    'reader-feature-runtime-deps should receive restoreReaderFocus from context'
  );

  [
    "import { createReaderFocusRestorer } from './reader-runtime-helpers.js';",
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
    'export function createReaderFocusRestorer'
  ].forEach((pattern) => {
    assert.ok(helperSource.includes(pattern), `reader-runtime-helpers should own ${pattern}`);
  });
  [
    'export function createCurrentNoteToggler',
    'export function createChunkNoteTransferDialogAccess',
    'function toggleCurrentNote()',
    'function closeChunkNoteExportDialog()',
    'function getChunkNoteExportDialogEl()'
  ].forEach((pattern) => {
    assert.equal(helperSource.includes(pattern), false, `retired runtime helper should stay removed: ${pattern}`);
  });
  assert.equal(helperSource.includes('window.'), false, 'reader-runtime-helpers should not read or write window globals');
  assert.equal(helperSource.includes('document.'), false, 'reader-runtime-helpers should not read document globals directly');

  [
    'applyCurrentAudioMeta(audioMeta);',
    'await deps.loadChunkNotesForCurrentAudio();',
    'await deps.loadSentenceNotesForCurrentAudio();',
    'await deps.switchSentenceNotesDoc(transcriptData);'
  ].forEach((pattern) => {
    assert.ok(sessionInitSource.includes(pattern), `session-init contract should remain intact: ${pattern}`);
  });

  const encodedSource = Buffer.from(helperSource, 'utf8').toString('base64');
  const { createReaderFocusRestorer } = await import(`data:text/javascript;base64,${encodedSource}#${Date.now()}`);

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

  console.log('reader runtime helpers check passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
