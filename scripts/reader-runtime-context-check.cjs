const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const runtimeSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime.js'), 'utf8');
  const contextSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime-context.js'), 'utf8');
  const sessionInitSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'session-init.js'), 'utf8');

  assert.ok(
    runtimeSource.includes("import { initReaderRuntimeContext } from './reader-runtime-context.js';"),
    'reader-runtime should import the runtime context module'
  );
  assert.ok(
    runtimeSource.includes('var runtimeContext = initReaderRuntimeContext({'),
    'reader-runtime should initialize through the runtime context module'
  );
  [
    "import { collectReaderDomRefs } from './reader-dom-refs.js';",
    "import { initReaderBootstrapRuntime } from './reader-bootstrap-runtime.js';",
    '} from \'./reader-runtime-helpers.js\';',
    'collectReaderDomRefs();',
    'createReaderFocusRestorer({',
    'createCurrentNoteToggler({',
    'createChunkNoteTransferDialogAccess({',
    'var chunkNoteTransferApi = null;'
  ].forEach((pattern) => {
    assert.equal(
      runtimeSource.includes(pattern),
      false,
      `reader-runtime should not own context setup directly: ${pattern}`
    );
  });
  [
    'var bootstrapRuntime = runtimeContext.bootstrapRuntime;',
    '} = runtimeContext.domRefs;',
    'const restoreReaderFocus = runtimeContext.restoreReaderFocus;',
    'const toggleCurrentNote = runtimeContext.toggleCurrentNote;',
    'const closeChunkNoteExportDialog = runtimeContext.closeChunkNoteExportDialog;',
    'const getChunkNoteExportDialogEl = runtimeContext.getChunkNoteExportDialogEl;',
    'runtimeContext.setChunkNoteTransferApi(appRuntime.chunkNoteTransferApi);'
  ].forEach((pattern) => {
    assert.ok(runtimeSource.includes(pattern), `reader-runtime should consume context output: ${pattern}`);
  });

  [
    "import { collectReaderDomRefs } from './reader-dom-refs.js';",
    "import { initReaderBootstrapRuntime } from './reader-bootstrap-runtime.js';",
    'createReaderFocusRestorer',
    'createCurrentNoteToggler',
    'createChunkNoteTransferDialogAccess',
    'export function initReaderRuntimeContext',
    'var bootstrapRuntime = initReaderBootstrapRuntime({',
    'var domRefs = collectReaderDomRefs(getDocument());',
    'var chunkNoteTransferApi = null;',
    'setChunkNoteTransferApi: function (api) {',
    'getChunkNoteTransferApi: function () {'
  ].forEach((pattern) => {
    assert.ok(contextSource.includes(pattern), `reader-runtime-context should own ${pattern}`);
  });
  assert.equal(contextSource.includes('window.'), false, 'reader-runtime-context should receive window through explicit deps');
  assert.equal(contextSource.includes('document.'), false, 'reader-runtime-context should receive document through explicit deps');

  [
    'setChunkNoteVisible(_ns.chunkNoteVisible, false);',
    'applyCurrentAudioMeta(audioMeta);',
    'await loadChunkNotesForCurrentAudio();',
    'await loadSentenceNotesForCurrentAudio();',
    'await switchSentenceNotesDoc(transcriptData);',
    'processTranscript(transcriptData);',
    'processChunkData(chunkData);',
    'window.toggleChunkMode(true);',
    'bridgeToPinia();'
  ].forEach((pattern) => {
    assert.ok(sessionInitSource.includes(pattern), `session-init contract should remain intact: ${pattern}`);
  });

  const testableSource = contextSource
    .replace(
      "import { collectReaderDomRefs } from './reader-dom-refs.js';\n",
      'function collectReaderDomRefs(doc) { globalThis.__domRefDoc = doc; return globalThis.__domRefsResult }\n'
    )
    .replace(
      "import { initReaderBootstrapRuntime } from './reader-bootstrap-runtime.js';\n",
      'function initReaderBootstrapRuntime(deps) { globalThis.__bootstrapInput = deps; return globalThis.__bootstrapResult }\n'
    )
    .replace(
      "import {\n  createReaderFocusRestorer,\n  createCurrentNoteToggler,\n  createChunkNoteTransferDialogAccess\n} from './reader-runtime-helpers.js';\n",
      [
        'function createReaderFocusRestorer(deps) { globalThis.__focusDeps = deps; return function restoreFocus() { return deps.getFocusTarget(); } }',
        'function createCurrentNoteToggler(deps) { globalThis.__noteToggleDeps = deps; return function toggleNote() { return deps.chunkState; } }',
        'function createChunkNoteTransferDialogAccess(deps) { globalThis.__dialogDeps = deps; return { closeChunkNoteExportDialog() { var api = deps.getTransferApi(); return api && api.closeExportDialog(); }, getChunkNoteExportDialogEl() { var api = deps.getTransferApi(); return api && api.getExportDialogEl ? api.getExportDialogEl() : null; } }; }',
        ''
      ].join('\n')
    );

  globalThis.__bootstrapInput = null;
  globalThis.__domRefDoc = null;
  globalThis.__focusDeps = null;
  globalThis.__noteToggleDeps = null;
  globalThis.__dialogDeps = null;
  globalThis.__bootstrapResult = {
    transcriptState: { words: [] },
    chunkState: { isChunkMode: false },
    playbackState: { lastActiveSegIndex: -1 }
  };
  globalThis.__domRefsResult = {
    mainAppArea: { id: 'main-app-area' }
  };

  const fakeWindow = { document: { id: 'fallback-doc' } };
  const fakeDocument = { id: 'doc' };
  const encodedSource = Buffer.from(testableSource, 'utf8').toString('base64');
  const { initReaderRuntimeContext } = await import(`data:text/javascript;base64,${encodedSource}#${Date.now()}`);
  const context = initReaderRuntimeContext({
    getWindow: () => fakeWindow,
    getDocument: () => fakeDocument
  });

  assert.equal(globalThis.__bootstrapInput.getWindow(), fakeWindow);
  assert.equal(globalThis.__domRefDoc, fakeDocument);
  assert.equal(context.bootstrapRuntime, globalThis.__bootstrapResult);
  assert.equal(context.domRefs, globalThis.__domRefsResult);
  assert.equal(globalThis.__focusDeps.getDocument(), fakeDocument);
  assert.equal(globalThis.__focusDeps.getFocusTarget(), globalThis.__domRefsResult.mainAppArea);
  assert.equal(globalThis.__noteToggleDeps.chunkState, globalThis.__bootstrapResult.chunkState);
  assert.equal(globalThis.__noteToggleDeps.transcriptState, globalThis.__bootstrapResult.transcriptState);
  assert.equal(globalThis.__noteToggleDeps.playbackState, globalThis.__bootstrapResult.playbackState);
  assert.equal(context.restoreReaderFocus(), globalThis.__domRefsResult.mainAppArea);
  assert.equal(context.toggleCurrentNote(), globalThis.__bootstrapResult.chunkState);
  assert.equal(context.getChunkNoteTransferApi(), null);
  assert.equal(context.closeChunkNoteExportDialog(), null);
  assert.equal(context.getChunkNoteExportDialogEl(), null);

  const dialogEl = { id: 'export-dialog' };
  context.setChunkNoteTransferApi({
    closeExportDialog() { return 'closed'; },
    getExportDialogEl() { return dialogEl; }
  });
  assert.equal(context.getChunkNoteTransferApi().closeExportDialog(), 'closed');
  assert.equal(context.closeChunkNoteExportDialog(), 'closed');
  assert.equal(context.getChunkNoteExportDialogEl(), dialogEl);

  console.log('reader runtime context check passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
