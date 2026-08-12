const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

async function importModule(filePath) {
  const source = fs.readFileSync(filePath, 'utf8');
  const encoded = Buffer.from(source, 'utf8').toString('base64');
  return import(`data:text/javascript;base64,${encoded}#${Date.now()}`);
}

function makeTranscript() {
  return {
    segments: [{
      start: 0,
      end: 1,
      words: [
        { word: 'Hello', start: 0, end: 0.4 },
        { word: 'world', start: 0.5, end: 1 },
      ],
    }],
  };
}

function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function makeVerifiedFixture(jobId = 'verified-job') {
  const transcript = makeTranscript();
  const chunkData = { s: [{ id: 0, chunks: [{ a: 0, b: 2, en: 'Hello world', zh: '你好' }] }] };
  const marks = [{ globalIndex: 1, word: '', start: 0.5, sourceType: 'manual-mark' }];
  const transcriptBytes = Buffer.from(JSON.stringify(transcript));
  const chunkBytes = Buffer.from(JSON.stringify(chunkData));
  const markProjection = [{ globalIndex: 1, sourceType: 'manual-mark', start: '0.5', word: '' }];
  const markBytes = Buffer.from(canonicalJson(markProjection));
  const integrity = {
    algorithm: 'sha256',
    transcript: { bytes: transcriptBytes.length, representation: 'file-bytes', sha256: sha256(transcriptBytes) },
    chunkData: { bytes: chunkBytes.length, representation: 'file-bytes', sha256: sha256(chunkBytes) },
    marks: { bytes: markBytes.length, representation: 'marks-fields.v1', sha256: sha256(markBytes) },
  };
  const contentId = `youtube-workflow:${jobId}`;
  const revision = `sha256:${sha256(Buffer.from(canonicalJson({ contentId, integrity })))}`;
  return { transcript, chunkData, marks, transcriptBytes, chunkBytes, integrity, contentId, revision };
}

async function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const modulePath = path.join(repoRoot, 'src', 'composables', 'youtube-workflow-loader.js');
  const api = await importModule(modulePath);

  const writes = [];
  const sessionCommits = [];
  const persistenceReads = [];
  const calls = [];
  const mediaCalls = [];
  const client = {
    async getSession(jobId) {
      calls.push(['session', jobId]);
      return {
        jobId,
        title: 'Example',
        files: { audio: 'a', transcript: 't', chunkData: 'c', video: 'v' },
        media: { videoSource: 'auto-single' },
      };
    },
    async getFile(jobId, kind) {
      calls.push(['file', kind]);
      if (kind === 'transcript') return new Blob([JSON.stringify(makeTranscript())], { type: 'application/json' });
      return new Blob([JSON.stringify({ s: [{ id: 0, chunks: [{ a: 1, b: 2, en: 'Hello world', zh: '你好' }] }] })], { type: 'application/json' });
    },
    async getReaderMarks(jobId, options = {}) {
      calls.push(['readerMarks', jobId]);
      assert.ok(options.signal, 'marks prepare must share the reader load AbortSignal');
      return { marks: [{ globalIndex: 1, word: 'world', sourceType: 'manual-mark' }] };
    },
    async getAnnotationBackfillResult(jobId) {
      calls.push(['annotationBackfillResult', jobId]);
      return {
        status: 'ready',
        result: {
          schemaVersion: 1,
          items: [{
            targetId: 'transcript-0-1-1',
            markedText: 'world',
            meaning: '世界',
            memoryHint: 'world',
          }],
        },
      };
    },
    mediaUrl(jobId, kind) {
      calls.push(['mediaUrl', jobId, kind]);
      return `http://127.0.0.1:8765/api/jobs/${jobId}/media/${kind}`;
    },
    async probeMediaRange() {
      return { status: 206, contentRange: 'bytes 0-0/16', acceptRanges: 'bytes' };
    },
  };
  const loader = api.createYoutubeWorkflowLoader({
    client,
    hasCurrentContent: () => false,
    audioPlayer: {},
    readerSessionPersistence: {
      async loadCommitted() {
        persistenceReads.push('loadCommitted');
        return { status: 'committed', session: { revision: 'previous-revision' } };
      },
      async commit(session, options) { sessionCommits.push({ session, options }); },
    },
    applyCurrentAudioMeta: (meta) => calls.push(['audioMeta', meta.name]),
    processTranscript: (data) => calls.push(['transcript', data.segments.length]),
    processChunkData: (data) => calls.push(['chunkData', data.s.length]),
    applyReaderMarks: async (marks, options) => calls.push(['applyReaderMarks', marks.length, options]),
    mediaSource: {
      setAudioElement(element) {
        mediaCalls.push(['setAudioElement', !!element]);
      },
      loadJobMedia(payload) {
        mediaCalls.push(['loadJobMedia', payload]);
      },
    },
    annotationLightweightModule: {
      async importManualLightweightAnnotations(file, options = {}) {
        const parsed = JSON.parse(await file.text());
        calls.push(['importAnnotationBackfillResult', parsed.items.length, file.name, options.replaceExisting]);
        return { importedCount: parsed.items.length };
      },
    },
    resetChunkDisplay: () => calls.push(['resetChunkDisplay']),
    validateTranscriptData: (data) => data,
    validateChunkData: (data) => data,
    showToast: (message) => calls.push(['toast', message]),
  });

  const result = await loader.loadJobIntoReader('job-1', { replacePolicy: 'ask' });
  assert.equal(result.status, 'loaded');
  assert.deepEqual(result.identity, {
    status: 'degraded',
    code: 'READER_SESSION_IDENTITY_LEGACY',
    reason: 'manifest-identity-missing',
  }, 'legacy manifests must remain loadable without being reported as verified');
  assert.equal(sessionCommits.length, 1, 'workflow reader state must use one atomic session commit');
  assert.deepEqual(persistenceReads, ['loadCommitted']);
  assert.equal(sessionCommits[0].options.expectedRevision, 'previous-revision');
  assert.ok(sessionCommits[0].options.signal instanceof AbortSignal);
  assert.equal(sessionCommits[0].session.contentId, 'youtube-workflow:job-1');
  assert.equal(sessionCommits[0].session.revision, 'youtube-workflow:job-1:1');
  assert.equal(sessionCommits[0].session.audioMeta.jobId, 'job-1');
  assert.equal(sessionCommits[0].session.audioMeta.readerSessionIdentity.status, 'degraded');
  assert.equal(sessionCommits[0].session.marks.length, 1);
  assert.ok(calls.some((call) => call[0] === 'transcript'));
  assert.ok(calls.some((call) => call[0] === 'chunkData'));
  assert.ok(calls.some((call) => call[0] === 'readerMarks' && call[1] === 'job-1'));
  assert.ok(calls.some((call) => call[0] === 'applyReaderMarks' && call[1] === 1));
  assert.ok(calls.some((call) => call[0] === 'applyReaderMarks' && call[2]?.persist === false));
  assert.ok(calls.some((call) => call[0] === 'annotationBackfillResult' && call[1] === 'job-1'));
  assert.ok(calls.some((call) => call[0] === 'importAnnotationBackfillResult' && call[1] === 1 && call[3] === false), 'loader should import saved annotation backfill result without replacing existing reader marks or calling Gemini again');
  assert.ok(calls.some((call) => call[0] === 'resetChunkDisplay'), 'loader should reset AI chunk Chinese visibility after loading generated chunk data');
  assert.ok(calls.some((call) => call[0] === 'mediaUrl' && call[1] === 'job-1' && call[2] === 'video'), 'loader should request the authorized Range video URL when manifest has a video file');
  assert.ok(mediaCalls.some((call) => call[0] === 'setAudioElement' && call[1] === true), 'loader should register the audio element with the shared media source');
  assert.ok(mediaCalls.some((call) => {
    return call[0] === 'loadJobMedia'
      && call[1].hasVideo === true
      && call[1].videoUrl.endsWith('/api/jobs/job-1/media/video')
      && call[1].videoSource === 'auto-single';
  }), 'loader should register video availability with the shared media source');

  const verifiedFixture = makeVerifiedFixture();
  const verifiedCommits = [];
  const verifiedLoader = api.createYoutubeWorkflowLoader({
    client: {
      async getSession() {
        return {
          schemaVersion: 1,
          jobId: 'verified-job',
          title: 'Verified',
          contentId: verifiedFixture.contentId,
          revision: verifiedFixture.revision,
          integrity: verifiedFixture.integrity,
          files: { audio: 'a', transcript: 't', chunkData: 'c' },
        };
      },
      async getFile(_jobId, kind) {
        return new Blob([kind === 'transcript' ? verifiedFixture.transcriptBytes : verifiedFixture.chunkBytes]);
      },
      async getReaderMarks() {
        return { marks: verifiedFixture.marks, integrity: verifiedFixture.integrity.marks };
      },
      mediaUrl(jobId, kind) { return `http://workflow.test/${jobId}/${kind}`; },
      async probeMediaRange() { return { status: 206 }; },
    },
    hasCurrentContent: () => false,
    readerSessionPersistence: {
      async loadCommitted() { return { status: 'legacy', session: null }; },
      async commit(session, options) { verifiedCommits.push({ session, options }); },
    },
    audioPlayer: {},
    applyCurrentAudioMeta: () => {},
    processTranscript: () => {},
    processChunkData: () => {},
    validateTranscriptData: (value) => value,
    validateChunkData: (value) => value,
  });
  const verifiedResult = await verifiedLoader.loadJobIntoReader('verified-job', { replacePolicy: 'replace-current' });
  assert.deepEqual(verifiedResult.identity, { status: 'verified' });
  assert.equal(verifiedCommits[0].session.contentId, verifiedFixture.contentId);
  assert.equal(verifiedCommits[0].session.revision, verifiedFixture.revision);
  assert.deepEqual(verifiedCommits[0].session.marks, [{
    globalIndex: 1,
    word: 'world',
    start: 0.5,
    sourceType: 'manual-mark',
  }]);
  assert.equal(verifiedCommits[0].options.expectedRevision, null);

  const failedWrites = [];
  const badLoader = api.createYoutubeWorkflowLoader({
    client: {
      async getSession() { return { jobId: 'bad', files: {} }; },
      async getFile(_jobId, kind) {
        if (kind === 'transcript') return new Blob([JSON.stringify(makeTranscript())], { type: 'application/json' });
        return new Blob([JSON.stringify({ s: [{ id: 0, chunks: [{ a: 1, b: 99, en: 'bad', zh: '坏' }] }] })], { type: 'application/json' });
      },
      mediaUrl(jobId, kind) { return `http://127.0.0.1:8765/api/jobs/${jobId}/media/${kind}`; },
      async probeMediaRange() { return { status: 206, contentRange: 'bytes 0-0/16', acceptRanges: 'bytes' }; },
    },
    hasCurrentContent: () => false,
    readerSessionPersistence: { commit: (session) => failedWrites.push(session) },
    applyCurrentAudioMeta: () => {},
    processTranscript: () => {},
    processChunkData: () => {},
    validateTranscriptData: (data) => data,
    validateChunkData: (data) => data,
  });

  await assert.rejects(
    () => badLoader.loadJobIntoReader('bad'),
    /chunkData does not match transcript/
  );
  assert.deepEqual(failedWrites, []);

  const conflictLoader = api.createYoutubeWorkflowLoader({
    client,
    hasCurrentContent: () => true,
    readerSessionPersistence: { commit: (session) => failedWrites.push(session) },
  });
  const conflict = await conflictLoader.loadJobIntoReader('job-1', { replacePolicy: 'ask' });
  assert.equal(conflict.status, 'conflict');

  console.log('youtube workflow loader check passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
