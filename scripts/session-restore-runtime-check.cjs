const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const modulePath = path.join(repoRoot, 'src', 'composables', 'session-restore-runtime.js');
  const sessionInitPath = path.join(repoRoot, 'src', 'composables', 'session-init.js');
  const sessionAssemblyPath = path.join(repoRoot, 'src', 'composables', 'session-runtime-assembly.js');
  const sessionLifecyclePath = path.join(repoRoot, 'src', 'composables', 'session-lifecycle-runtime.js');
  const moduleSource = fs.readFileSync(modulePath, 'utf8');
  const sessionInitSource = fs.readFileSync(sessionInitPath, 'utf8');
  const sessionAssemblySource = fs.readFileSync(sessionAssemblyPath, 'utf8');
  const sessionLifecycleSource = fs.readFileSync(sessionLifecyclePath, 'utf8');

  assert.ok(
    sessionInitSource.includes("from './session-runtime-assembly.js';")
      && sessionAssemblySource.includes("from './session-lifecycle-runtime.js';")
      && sessionLifecycleSource.includes("from './session-restore-runtime.js';"),
    'session-init should reach session restore runtime through session-runtime-assembly'
  );
  assert.equal(
    sessionInitSource.includes('async function restoreSession()'),
    false,
    'session-init should not keep local restoreSession implementation'
  );
  assert.ok(moduleSource.includes('export function createSessionRestoreRuntime'));

  const encodedSource = Buffer.from(moduleSource, 'utf8').toString('base64');
  const api = await import(`data:text/javascript;base64,${encodedSource}#${Date.now()}`);
  const state = {
    currentAudioKey: 'audio-1',
    markedMap: new Map(),
    isChunkMode: false
  };
  const namespace = { currentDocId: 'doc-1' };
  const labels = {
    audio: {},
    transcript: {},
    visual: {}
  };
  const calls = [];
  const diagnostics = [];
  const db = {
    audio: { name: 'clip.mp3', size: 10, lastModified: 20, type: 'audio/mpeg' },
    audioMeta: null,
    transcript: { segments: [{ id: 1 }] },
    visual: { v: 1 },
    chunkData: [{ chunk: 1 }],
    marks: [{ globalIndex: '2', word: 'marked' }]
  };
  const runtime = api.createSessionRestoreRuntime({
    state,
    namespace,
    urlApi: {
      createObjectURL(blob) {
        return `blob:${blob.name}`;
      }
    },
    audioPlayer: {},
    lblAudio: labels.audio,
    lblTranscript: labels.transcript,
    lblVisual: labels.visual,
    async loadFromDB(key) {
      calls.push(['load', key]);
      return db[key];
    },
    markFileLoaded(label, text) {
      label.loaded = text;
    },
    applyCurrentAudioMeta(meta) {
      calls.push(['audioMeta', meta.name]);
    },
    async loadChunkNotesForCurrentAudio() {
      calls.push(['chunkNotes']);
    },
    async loadSentenceNotesForCurrentAudio() {
      calls.push(['sentenceNotes']);
    },
    processTranscript(data) {
      calls.push(['transcript', data.segments.length]);
    },
    buildCurrentSentenceDocId() {
      return 'derived-doc';
    },
    async switchSentenceNotesDoc(data) {
      calls.push(['switchSentenceNotesDoc', !!data]);
    },
    scheduleGeneratedAnnotationIndexRefresh() {
      calls.push(['scheduleGeneratedAnnotationIndexRefresh']);
    },
    processVisual(data) {
      calls.push(['visual', data.v]);
    },
    processChunkData(data) {
      calls.push(['chunkData', data.length]);
    },
    normalizeAnnotationMark(mark) {
      return { ...mark, globalIndex: Number(mark.globalIndex) };
    },
    renderTranscript() {
      calls.push(['renderTranscript']);
    },
    syncAnnotationGenerationEntryStatus() {
      calls.push(['sync']);
    },
    bridgeToPinia() {
      calls.push(['bridge']);
    },
    getAnnotationGeneratedResultStore() {
      return {
        getItems() {
          return [{ id: 1 }];
        }
      };
    },
    getAnnotationGenerationScope() {
      return { audioKey: state.currentAudioKey, documentId: namespace.currentDocId };
    },
    emitAnnotationDiagnostics(event, payload) {
      diagnostics.push({ event, payload });
    }
  });

  await runtime.restoreSession();

  assert.equal(labels.audio.loaded, 'Audio restored');
  assert.equal(labels.transcript.loaded, 'Transcript restored');
  assert.equal(labels.visual.loaded, 'Visual restored');
  assert.equal(state.markedMap.get(2).word, 'marked');
  assert.ok(calls.some((call) => call[0] === 'audioMeta' && call[1] === 'clip.mp3'));
  assert.ok(calls.some((call) => call[0] === 'scheduleGeneratedAnnotationIndexRefresh'));
  assert.ok(calls.some((call) => call[0] === 'renderTranscript'));
  assert.ok(calls.some((call) => call[0] === 'bridge'));
  assert.equal(diagnostics[0].event, 'app.restore_session_start');
  assert.ok(diagnostics.some((entry) => entry.event === 'app.restore_transcript_processed'));
  assert.equal(diagnostics.at(-1).event, 'app.restore_session_complete');
  assert.equal(diagnostics.at(-1).payload.markedCount, 1);
  assert.equal(diagnostics.at(-1).payload.generatedItemCount, 1);

  console.log('session restore runtime check passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
