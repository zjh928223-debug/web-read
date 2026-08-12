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
  const committedReads = [];
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
    readerSessionPersistence: {
      async loadCommitted() {
        committedReads.push('legacy-probe');
        return { status: 'legacy', session: null };
      }
    },
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
    processTranscript(data) {
      calls.push(['transcript', data.segments.length]);
    },
    buildCurrentSentenceDocId() {
      return 'derived-doc';
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

  const legacyResult = await runtime.restoreSession();

  assert.deepEqual(committedReads, ['legacy-probe']);
  assert.equal(legacyResult.status, 'restored');
  assert.equal(legacyResult.source, 'legacy');
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

  const committedCalls = [];
  const committedDiagnostics = [];
  const committedAudioPlayer = { src: 'visible-before-restore' };
  const committedSession = {
    contentId: 'youtube-workflow:job-22',
    revision: 'youtube-workflow:job-22:7',
    audioMeta: { name: 'derived.m4a', streamUrl: 'http://127.0.0.1:8766/media/job-22' },
    transcript: { segments: [{ words: [{ word: 'committed' }] }] },
    chunkData: { s: [{ chunks: [{ en: 'committed chunk' }] }] }
  };
  const committedRuntime = api.createSessionRestoreRuntime({
    state: { currentAudioKey: 'old-audio', markedMap: new Map(), isChunkMode: false },
    namespace: { currentDocId: 'old-doc' },
    urlApi: { createObjectURL() { throw new Error('stream restore must not create an Object URL'); } },
    audioPlayer: committedAudioPlayer,
    lblAudio: {},
    lblTranscript: {},
    lblVisual: {},
    readerSessionPersistence: {
      async loadCommitted() {
        committedCalls.push(['loadCommitted']);
        return { status: 'committed', session: committedSession };
      }
    },
    async loadFromDB(key) {
      committedCalls.push(['legacyLoad', key]);
      if (key === 'visual' || key === 'marks') return null;
      throw new Error(`committed restore must not read legacy ${key}`);
    },
    markFileLoaded(_label, text) { committedCalls.push(['loaded', text]); },
    applyCurrentAudioMeta(meta) { committedCalls.push(['audioMeta', meta.name]); },
    processTranscript(data) { committedCalls.push(['transcript', data.segments[0].words[0].word]); },
    buildCurrentSentenceDocId() { return 'committed-doc'; },
    scheduleGeneratedAnnotationIndexRefresh() { committedCalls.push(['refresh']); },
    processVisual() { committedCalls.push(['visual']); },
    processChunkData(data) { committedCalls.push(['chunk', data.s[0].chunks[0].en]); },
    normalizeAnnotationMark(mark) { return mark; },
    renderTranscript() {},
    syncAnnotationGenerationEntryStatus() {},
    bridgeToPinia() {},
    getAnnotationGeneratedResultStore() { return { getItems() { return []; } }; },
    getAnnotationGenerationScope() { return { audioKey: 'old-audio', documentId: 'old-doc' }; },
    emitAnnotationDiagnostics(event, payload) { committedDiagnostics.push({ event, payload }); }
  });

  const committedResult = await committedRuntime.restoreSession();
  assert.deepEqual(committedResult, {
    status: 'restored',
    source: 'committed',
    contentId: committedSession.contentId,
    revision: committedSession.revision
  });
  assert.equal(committedAudioPlayer.src, committedSession.audioMeta.streamUrl);
  assert.ok(committedCalls.some((call) => call[0] === 'audioMeta' && call[1] === 'derived.m4a'));
  assert.ok(committedCalls.some((call) => call[0] === 'transcript' && call[1] === 'committed'));
  assert.ok(committedCalls.some((call) => call[0] === 'chunk' && call[1] === 'committed chunk'));
  assert.equal(
    committedCalls.some((call) => call[0] === 'legacyLoad' && ['audioMeta', 'transcript', 'chunkData'].includes(call[1])),
    false,
    'committed restore must not mix legacy rows into the validated revision'
  );
  assert.equal(committedDiagnostics.at(-1).payload.source, 'committed');
  assert.equal(committedDiagnostics.at(-1).payload.revision, committedSession.revision);

  for (const failure of [
    {
      name: 'inconsistent result',
      loadCommitted: async () => ({
        status: 'inconsistent',
        session: null,
        error: { code: 'READER_SESSION_INCONSISTENT', message: 'mixed revisions' }
      }),
      code: 'READER_SESSION_INCONSISTENT'
    },
    {
      name: 'corrupt row rejection',
      loadCommitted: async () => {
        const error = new Error('invalid stored row');
        error.code = 'INVALID_VALUE';
        throw error;
      },
      code: 'INVALID_VALUE'
    }
  ]) {
    const rejectedCalls = [];
    const rejectedDiagnostics = [];
    const visibleAudioPlayer = { src: 'still-visible' };
    const visibleState = {
      currentAudioKey: 'visible-audio',
      markedMap: new Map([[9, { globalIndex: 9, word: 'visible-mark' }]]),
      isChunkMode: false
    };
    const rejectedRuntime = api.createSessionRestoreRuntime({
      state: visibleState,
      namespace: { currentDocId: 'visible-doc' },
      audioPlayer: visibleAudioPlayer,
      lblAudio: {},
      lblTranscript: {},
      lblVisual: {},
      readerSessionPersistence: { loadCommitted: failure.loadCommitted },
      async loadFromDB(key) {
        rejectedCalls.push(['legacyLoad', key]);
        return { shouldNotLoad: true };
      },
      markFileLoaded() { rejectedCalls.push(['markFileLoaded']); },
      applyCurrentAudioMeta() { rejectedCalls.push(['applyCurrentAudioMeta']); },
      processTranscript() { rejectedCalls.push(['processTranscript']); },
      processVisual() { rejectedCalls.push(['processVisual']); },
      processChunkData() { rejectedCalls.push(['processChunkData']); },
      getAnnotationGenerationScope() { return { audioKey: 'visible-audio', documentId: 'visible-doc' }; },
      emitAnnotationDiagnostics(event, payload) { rejectedDiagnostics.push({ event, payload }); }
    });

    const rejectedResult = await rejectedRuntime.restoreSession();
    assert.equal(rejectedResult.status, 'rejected', failure.name);
    assert.equal(rejectedResult.source, 'committed', failure.name);
    assert.equal(rejectedResult.error.code, failure.code, failure.name);
    assert.equal(visibleAudioPlayer.src, 'still-visible', failure.name);
    assert.equal(visibleState.currentAudioKey, 'visible-audio', failure.name);
    assert.equal(visibleState.markedMap.get(9).word, 'visible-mark', failure.name);
    assert.deepEqual(rejectedCalls, [], `${failure.name} must not fall back or mutate visible session`);
    assert.equal(rejectedDiagnostics.at(-1).event, 'app.restore_session_rejected', failure.name);
    assert.equal(rejectedDiagnostics.at(-1).payload.code, failure.code, failure.name);
  }

  console.log('session restore runtime check passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
