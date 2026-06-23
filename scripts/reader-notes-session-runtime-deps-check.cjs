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
    'transcriptState: bootstrapRuntime.transcriptState',
    'chunkState: bootstrapRuntime.chunkState',
    'clozeState: bootstrapRuntime.clozeState',
    'loadFromDB: bootstrapRuntime.loadFromDB',
    'saveToDB: bootstrapRuntime.saveToDB',
    'audioIdentityApi: bootstrapRuntime.audioIdentityApi',
    'isPlainObjectRecord: bootstrapRuntime.runtimeDeps.isPlainObjectRecord',
    'mainAppArea: domRefs.mainAppArea'
  ].forEach((pattern) => {
    assert.ok(moduleSource.includes(pattern), `reader-notes-session-runtime-deps should own mapping: ${pattern}`);
  });
  assert.equal(moduleSource.includes('window.'), false, 'reader-notes-session-runtime-deps should not read or write window globals');
  assert.equal(moduleSource.includes('document.'), false, 'reader-notes-session-runtime-deps should not read document globals');

  const encodedSource = Buffer.from(moduleSource, 'utf8').toString('base64');
  const { createReaderNotesSessionRuntimeDeps } = await import(`data:text/javascript;base64,${encodedSource}#${Date.now()}`);

  const domRefs = {
    mainAppArea: { id: 'main' }
  };
  const globalObject = {};
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

  assert.equal(deps.transcriptState, bootstrapRuntime.transcriptState);
  assert.equal(deps.chunkState, bootstrapRuntime.chunkState);
  assert.equal(deps.clozeState, bootstrapRuntime.clozeState);
  assert.equal(deps.loadFromDB, bootstrapRuntime.loadFromDB);
  assert.equal(deps.saveToDB, bootstrapRuntime.saveToDB);
  assert.equal(deps.audioIdentityApi, bootstrapRuntime.audioIdentityApi);
  assert.equal(deps.isPlainObjectRecord, bootstrapRuntime.runtimeDeps.isPlainObjectRecord);
  assert.equal(deps.mainAppArea, domRefs.mainAppArea);
  [
    'notesModule',
    'chunkNoteLayout',
    'chunkNoteCtxMenu',
    'notePreviewResizeHandleY'
  ].forEach((key) => {
    assert.equal(Object.prototype.hasOwnProperty.call(deps, key), false, `retired notes dep should stay removed: ${key}`);
  });

  console.log('reader notes session runtime deps check passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
