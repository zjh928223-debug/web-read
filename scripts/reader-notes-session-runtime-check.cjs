const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const runtimeSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime.js'), 'utf8');
  const shellSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime-assembly.js'), 'utf8');
const assemblySource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-runtime-assembly.js'), 'utf8');
  const depsSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-notes-session-runtime-deps.js'), 'utf8');
  const moduleSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'reader-notes-session-runtime.js'), 'utf8');
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
    'reader-runtime should delegate notes/session through reader runtime assembly'
  );
  assert.ok(
    assemblySource.includes("import { initReaderNotesSessionRuntime } from './reader-notes-session-runtime.js';"),
    'reader-runtime-assembly should import reader notes/session runtime'
  );
  assert.ok(
    assemblySource.includes("import { createReaderNotesSessionRuntimeDeps } from './reader-notes-session-runtime-deps.js';"),
    'reader-runtime-assembly should import reader notes/session runtime dependency assembly'
  );
  assert.ok(
    assemblySource.includes('var notesSessionRuntime = initReaderNotesSessionRuntime(createReaderNotesSessionRuntimeDeps({'),
    'reader-runtime-assembly should initialize notes/session through the combined module'
  );
  assert.equal(
    runtimeSource.includes("import { initReaderNotesRuntime } from './reader-notes-runtime.js';"),
    false,
    'reader-runtime should not import reader notes runtime directly'
  );
  assert.equal(
    runtimeSource.includes("import { initReaderSessionRuntime } from './reader-session-runtime.js';"),
    false,
    'reader-runtime should not import reader session runtime directly'
  );
  assert.equal(runtimeSource.includes('var notesRuntime = initReaderNotesRuntime({'), false);
  assert.equal(runtimeSource.includes('var sessionRuntime = initReaderSessionRuntime({'), false);

  [
    'var notesState = notesSessionRuntime.notesState;',
    'var bridgeToPinia = notesSessionRuntime.bridgeToPinia;',
    'var chunkNotesApi = notesSessionRuntime.chunkNotesApi;',
    'var sentenceNotesApi = notesSessionRuntime.sentenceNotesApi;',
    'var loadChunkNotesForCurrentAudio = notesSessionRuntime.loadChunkNotesForCurrentAudio;',
    'var setChunkNoteVisible = notesSessionRuntime.setChunkNoteVisible;',
    'var loadSentenceNotesForCurrentAudio = notesSessionRuntime.loadSentenceNotesForCurrentAudio;',
    'var switchSentenceNotesDoc = notesSessionRuntime.switchSentenceNotesDoc;',
    'var applyCurrentAudioMeta = notesSessionRuntime.applyCurrentAudioMeta;'
  ].forEach((pattern) => {
    assert.equal(shellSource.includes(pattern), false, `reader-runtime-assembly should not bind notes/session result directly: ${pattern}`);
  });

  [
    'export function createReaderNotesSessionRuntimeDeps',
    'transcriptState: bootstrapRuntime.transcriptState',
    'chunkState: bootstrapRuntime.chunkState',
    'clozeState: bootstrapRuntime.clozeState',
    'audioIdentityApi: bootstrapRuntime.audioIdentityApi',
    'isPlainObjectRecord: bootstrapRuntime.runtimeDeps.isPlainObjectRecord',
    'mainAppArea: domRefs.mainAppArea'
  ].forEach((pattern) => {
    assert.ok(depsSource.includes(pattern), `reader-notes-session-runtime-deps should own ${pattern}`);
  });
  assert.equal(depsSource.includes('window.'), false, 'reader-notes-session-runtime-deps should not read or write window globals');
  assert.equal(depsSource.includes('document.'), false, 'reader-notes-session-runtime-deps should not read document globals');

  [
    "import { initReaderNotesRuntime } from './reader-notes-runtime.js';",
    "import { initReaderSessionRuntime } from './reader-session-runtime.js';",
    'export function initReaderNotesSessionRuntime',
    'var notesRuntime = initReaderNotesRuntime({',
    'var sessionRuntime = initReaderSessionRuntime({',
    'chunkNotesApi: notesRuntime.chunkNotesApi',
    'sentenceNotesApi: notesRuntime.sentenceNotesApi',
    'notesState: notesRuntime.notesState',
    'bridgeToPinia: notesRuntime.bridgeToPinia',
    'loadChunkNotesForCurrentAudio: sessionRuntime.loadChunkNotesForCurrentAudio',
    'applyCurrentAudioMeta: sessionRuntime.applyCurrentAudioMeta'
  ].forEach((pattern) => {
    assert.ok(moduleSource.includes(pattern), `reader-notes-session-runtime should own ${pattern}`);
  });
  assert.equal(moduleSource.includes('window.'), false, 'reader-notes-session-runtime should receive window globals through deps');
  assert.equal(moduleSource.includes('document.'), false, 'reader-notes-session-runtime should not read document globals');

  [
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

  const testableSource = moduleSource
    .replace(
      "import { initReaderNotesRuntime } from './reader-notes-runtime.js';\n",
      'function initReaderNotesRuntime(deps) { globalThis.__notesRuntimeDeps = deps; return { notesState: { visible: true }, bridgeToPinia: () => "bridge", chunkNotesApi: { chunk: true }, sentenceNotesApi: { sentence: true } } }\n'
    )
    .replace(
      "import { initReaderSessionRuntime } from './reader-session-runtime.js';\n",
      'function initReaderSessionRuntime(deps) { globalThis.__sessionRuntimeDeps = deps; return { loadChunkNotesForCurrentAudio: () => "load-chunk", setChunkNoteVisible: () => "visible", loadSentenceNotesForCurrentAudio: () => "load-sentence", switchSentenceNotesDoc: () => "switch", applyCurrentAudioMeta: () => "audio" } }\n'
    );

  globalThis.__notesRuntimeDeps = null;
  globalThis.__sessionRuntimeDeps = null;

  const encodedSource = Buffer.from(testableSource, 'utf8').toString('base64');
  const { initReaderNotesSessionRuntime } = await import(`data:text/javascript;base64,${encodedSource}#${Date.now()}`);

  const deps = {
    transcriptState: { id: 'transcript' },
    chunkState: { id: 'chunk' },
    clozeState: { id: 'cloze' },
    loadFromDB: () => 'load-db',
    saveToDB: () => 'save-db',
    audioIdentityApi: { currentAudioKey: 'audio-key' },
    isPlainObjectRecord: () => true,
    mainAppArea: { id: 'main' }
  };
  const api = initReaderNotesSessionRuntime(deps);

  assert.equal(globalThis.__notesRuntimeDeps.transcriptState, deps.transcriptState);
  assert.equal(globalThis.__notesRuntimeDeps.audioIdentityApi, deps.audioIdentityApi);
  assert.equal(globalThis.__notesRuntimeDeps.mainAppArea, deps.mainAppArea);
  assert.equal(Object.prototype.hasOwnProperty.call(globalThis.__notesRuntimeDeps, 'notePreviewResizeHandleY'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(globalThis.__notesRuntimeDeps, 'notesModule'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(globalThis.__notesRuntimeDeps, 'chunkNoteLayout'), false);
  assert.deepEqual(globalThis.__sessionRuntimeDeps.chunkNotesApi, { chunk: true });
  assert.deepEqual(globalThis.__sessionRuntimeDeps.sentenceNotesApi, { sentence: true });
  assert.equal(globalThis.__sessionRuntimeDeps.audioIdentityApi, deps.audioIdentityApi);
  assert.deepEqual(api.notesState, { visible: true });
  assert.equal(api.bridgeToPinia(), 'bridge');
  assert.deepEqual(api.chunkNotesApi, { chunk: true });
  assert.deepEqual(api.sentenceNotesApi, { sentence: true });
  assert.equal(api.loadChunkNotesForCurrentAudio(), 'load-chunk');
  assert.equal(api.setChunkNoteVisible(), 'visible');
  assert.equal(api.loadSentenceNotesForCurrentAudio(), 'load-sentence');
  assert.equal(api.switchSentenceNotesDoc(), 'switch');
  assert.equal(api.applyCurrentAudioMeta(), 'audio');

  console.log('reader notes session runtime check passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
