const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const shellSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime-assembly.js'), 'utf8');
const assemblySource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime-assembly.js'), 'utf8');
  const moduleSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-notes-session-runtime-deps.js'), 'utf8');

  assert.ok(
    assemblySource.includes("import { createReaderNotesSessionRuntimeDeps } from './reader-notes-session-runtime-deps.js';"),
    'reader-runtime-assembly should import reader notes/session dependency assembly'
  );
  assert.ok(
    assemblySource.includes('initReaderNotesSessionRuntime(createReaderNotesSessionRuntimeDeps({'),
    'reader-runtime-assembly should initialize notes/session through the dependency assembly module'
  );
  [
    'notesModule: globalObject.__notesModule',
    'chunkNoteLayout: globalObject.__chunkNoteLayout',
    'transcriptState: bootstrapRuntime.transcriptState',
    'chunkState: bootstrapRuntime.chunkState',
    'clozeState: bootstrapRuntime.clozeState',
    'loadFromDB: bootstrapRuntime.loadFromDB',
    'saveToDB: bootstrapRuntime.saveToDB',
    'audioIdentityApi: bootstrapRuntime.audioIdentityApi',
    'isPlainObjectRecord: bootstrapRuntime.runtimeDeps.isPlainObjectRecord',
    'mainAppArea: domRefs.mainAppArea',
    'notePreviewResizeHandleY: domRefs.notePreviewResizeHandleY'
  ].forEach((pattern) => {
    assert.ok(moduleSource.includes(pattern), `reader-notes-session-runtime-deps should own mapping: ${pattern}`);
  });
  assert.equal(moduleSource.includes('window.'), false, 'reader-notes-session-runtime-deps should not read or write window globals');
  assert.equal(moduleSource.includes('document.'), false, 'reader-notes-session-runtime-deps should not read document globals');

  const encodedSource = Buffer.from(moduleSource, 'utf8').toString('base64');
  const { createReaderNotesSessionRuntimeDeps } = await import(`data:text/javascript;base64,${encodedSource}#${Date.now()}`);

  const domRefs = {
    mainAppArea: { id: 'main' },
    chunkNoteSvgLayer: { id: 'svg' },
    chunkNoteLayer: { id: 'layer' },
    chunkNoteCtxMenu: { id: 'menu' },
    notePreviewSidebar: { id: 'sidebar' },
    notePreviewEmpty: { id: 'empty' },
    notePreviewList: { id: 'list' },
    toggleNotePreviewBtn: { id: 'toggle' },
    notePreviewResizeHandle: { id: 'resize-x' },
    notePreviewResizeHandleY: { id: 'resize-y' }
  };
  const globalObject = {
    __notesModule: { id: 'notes' },
    __chunkNoteLayout: { id: 'layout' }
  };
  const runtimeContext = { domRefs };
  const bootstrapRuntime = {
    transcriptState: { id: 'transcript' },
    chunkState: { id: 'chunk' },
    clozeState: { id: 'cloze' },
    loadFromDB: () => 'loaded',
    saveToDB: () => 'saved',
    audioIdentityApi: { id: 'audio' },
    runtimeDeps: {
      isPlainObjectRecord: () => true
    }
  };

  const deps = createReaderNotesSessionRuntimeDeps({
    globalObject,
    runtimeContext,
    bootstrapRuntime
  });

  assert.equal(deps.notesModule, globalObject.__notesModule);
  assert.equal(deps.chunkNoteLayout, globalObject.__chunkNoteLayout);
  assert.equal(deps.transcriptState, bootstrapRuntime.transcriptState);
  assert.equal(deps.chunkState, bootstrapRuntime.chunkState);
  assert.equal(deps.clozeState, bootstrapRuntime.clozeState);
  assert.equal(deps.loadFromDB, bootstrapRuntime.loadFromDB);
  assert.equal(deps.saveToDB, bootstrapRuntime.saveToDB);
  assert.equal(deps.audioIdentityApi, bootstrapRuntime.audioIdentityApi);
  assert.equal(deps.isPlainObjectRecord, bootstrapRuntime.runtimeDeps.isPlainObjectRecord);
  assert.equal(deps.chunkNoteCtxMenu, domRefs.chunkNoteCtxMenu);
  assert.equal(deps.notePreviewResizeHandleY, domRefs.notePreviewResizeHandleY);

  console.log('reader notes session runtime deps check passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
