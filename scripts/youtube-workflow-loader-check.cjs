const assert = require('node:assert/strict');
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

async function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const modulePath = path.join(repoRoot, 'src', 'composables', 'youtube-workflow-loader.js');
  const api = await importModule(modulePath);

  const writes = [];
  const calls = [];
  const client = {
    async getSession(jobId) {
      calls.push(['session', jobId]);
      return {
        jobId,
        title: 'Example',
        files: { audio: 'a', transcript: 't', chunkData: 'c' },
      };
    },
    async getFile(jobId, kind) {
      calls.push(['file', kind]);
      if (kind === 'audio') return new Blob(['audio'], { type: 'audio/wav' });
      if (kind === 'transcript') return new Blob([JSON.stringify(makeTranscript())], { type: 'application/json' });
      return new Blob([JSON.stringify({ s: [{ id: 0, chunks: [{ a: 1, b: 2, en: 'Hello world', zh: '你好' }] }] })], { type: 'application/json' });
    },
  };
  const loader = api.createYoutubeWorkflowLoader({
    client,
    hasCurrentContent: () => false,
    createObjectURL: () => 'blob:audio',
    audioPlayer: {},
    saveToDB: (key, value) => writes.push([key, value]),
    applyCurrentAudioMeta: (meta) => calls.push(['audioMeta', meta.name]),
    processTranscript: (data) => calls.push(['transcript', data.segments.length]),
    processChunkData: (data) => calls.push(['chunkData', data.s.length]),
    resetChunkDisplay: () => calls.push(['resetChunkDisplay']),
    validateTranscriptData: (data) => data,
    validateChunkData: (data) => data,
    showToast: (message) => calls.push(['toast', message]),
  });

  const result = await loader.loadJobIntoReader('job-1', { replacePolicy: 'ask' });
  assert.equal(result.status, 'loaded');
  assert.deepEqual(writes.map(([key]) => key), ['audio', 'audioMeta', 'transcript', 'chunkData']);
  assert.ok(calls.some((call) => call[0] === 'transcript'));
  assert.ok(calls.some((call) => call[0] === 'chunkData'));
  assert.ok(calls.some((call) => call[0] === 'resetChunkDisplay'), 'loader should reset AI chunk Chinese visibility after loading generated chunk data');

  const failedWrites = [];
  const badLoader = api.createYoutubeWorkflowLoader({
    client: {
      async getSession() { return { jobId: 'bad', files: {} }; },
      async getFile(_jobId, kind) {
        if (kind === 'audio') return new Blob(['audio'], { type: 'audio/wav' });
        if (kind === 'transcript') return new Blob([JSON.stringify(makeTranscript())], { type: 'application/json' });
        return new Blob([JSON.stringify({ s: [{ id: 0, chunks: [{ a: 1, b: 99, en: 'bad', zh: '坏' }] }] })], { type: 'application/json' });
      },
    },
    hasCurrentContent: () => false,
    saveToDB: (key, value) => failedWrites.push([key, value]),
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
    saveToDB: (key, value) => failedWrites.push([key, value]),
  });
  const conflict = await conflictLoader.loadJobIntoReader('job-1', { replacePolicy: 'ask' });
  assert.equal(conflict.status, 'conflict');

  console.log('youtube workflow loader check passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
