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
    'reader-runtime should import the runtime assembly module'
  );
  assert.ok(
    assemblySource.includes("import { initReaderRuntimeContext } from './reader-runtime-context.js';"),
    'reader-runtime-assembly should import the runtime context module'
  );
  assert.ok(
    assemblySource.includes('var runtimeContext = initReaderRuntimeContext({'),
    'reader-runtime-assembly should initialize through the runtime context module'
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
    "import { createReaderFeatureRuntimeDeps } from './reader-feature-runtime-deps.js';"
  ].forEach((pattern) => {
    assert.ok(assemblySource.includes(pattern), `reader-runtime-assembly should consume context output: ${pattern}`);
  });
  [
    'restoreReaderFocus: runtimeContext.restoreReaderFocus,',
    'toggleCurrentNote: runtimeContext.toggleCurrentNote,',
    'closeChunkNoteExportDialog: runtimeContext.closeChunkNoteExportDialog,',
    'getChunkNoteExportDialogEl: runtimeContext.getChunkNoteExportDialogEl,',
    'setChunkNoteTransferApi: runtimeContext.setChunkNoteTransferApi'
  ].forEach((pattern) => {
    assert.ok(featureDepsSource.includes(pattern), `reader-feature-runtime-deps should consume context output: ${pattern}`);
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
    'deps.setChunkNoteVisible(namespace.chunkNoteVisible, false);',
    'applyCurrentAudioMeta(audioMeta);',
    'await deps.loadChunkNotesForCurrentAudio();',
    'await deps.loadSentenceNotesForCurrentAudio();',
    'await deps.switchSentenceNotesDoc(transcriptData);',
    'deps.processTranscript(transcriptData);',
    'deps.processChunkData(chunkData);',
    'windowObject.toggleChunkMode(true);',
    'deps.bridgeToPinia();'
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
