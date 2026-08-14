const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function importModule(filePath) {
  const source = fs.readFileSync(filePath, 'utf8').replace(
    /^import \{ recordBestEffortFailure \} from '\.\.\/services\/runtime\/best-effort\.js';?$/m,
    "const recordBestEffortFailure = () => null",
  );
  const encoded = Buffer.from(source, 'utf8').toString('base64');
  return import(`data:text/javascript;base64,${encoded}#${Date.now()}`);
}

async function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const modulePath = path.join(repoRoot, 'src', 'composables', 'youtube-workflow-client.js');
  const api = await importModule(modulePath);
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    const isBackfillCreate = url.endsWith('/api/jobs/job-1/annotation-backfill') && options.method === 'POST';
    const isBackfillStatus = url.endsWith('/api/jobs/job-1/annotation-backfill/operations/operation-1');
    return {
      ok: true,
      status: 200,
      headers: new Map(),
      async json() {
        if (isBackfillCreate) {
          return { operationId: 'operation-1', status: 'queued', statusUrl: '/api/jobs/job-1/annotation-backfill/operations/operation-1' };
        }
        if (isBackfillStatus) return { operationId: 'operation-1', status: 'ready', response: { result: { items: [] } } };
        return { url, ok: true };
      },
      async blob() { return new Blob(['audio']); },
    };
  };
  const client = api.createYoutubeWorkflowClient({
    baseUrl: 'http://127.0.0.1:8765',
    fetchImpl,
    accessToken: 'test-client-token',
  });

  await client.health();
  await client.diagnostics();
  await client.diagnosticsPackage();
  await client.credentialStatus();
  await client.saveCredential({ apiKey: 'SECRET-CLIENT-TEST' });
  await client.deleteCredential();
  await client.getConfig();
  await client.saveConfig({ model: 'gemini-test' });
  await client.maintenance();
  await client.cleanupMaintenance({ olderThanDays: 30 });
  await client.createJob({
    url: 'https://youtube.example/video',
    geminiMode: 'mock',
    autoOpenWhenReady: false,
    replacePolicy: 'ask',
  });
  await client.getJob('job-1');
  await client.cancelJob('job-1');
  await client.prioritizeJob('job-2');
  await client.redoJob('job-3');
  await client.retryJob('job-4', { stage: 'translating' });
  await client.clearCanceledJobs();
  const pickerSignal = new AbortController().signal;
  await client.pickImportFolder({ initialDir: 'D:/legacy-materials' }, { signal: pickerSignal });
  await client.pickVideoFile({ initialDir: 'D:/legacy-materials' }, { signal: pickerSignal });
  await client.scanImportRoot({ rootPath: 'D:/legacy-materials' });
  await client.createImportJobs({ items: [{ audioPath: 'D:/legacy-materials/a.mp3', selected: true }], geminiMode: 'mock' });
  await client.getSession('job-1');
  await client.getFile('job-1', 'audio');
  await client.bindVideoSource('job-1', { videoPath: 'D:/legacy-materials/a/a.mp4', source: 'manual' });
  await client.recent(5);
  await client.history({ query: 'alpha', status: 'ready', limit: 20 });
  await client.getHistory('job-1');
  await client.deleteHistory('job-1', { deleteFiles: true });
  await client.readerRecent({ query: 'read', limit: 10 });
  await client.recordReaderActivity({ jobId: 'job-1', event: 'progress' });
  await client.getReaderMarks('job-1');
  await client.saveReaderMarks('job-1', { marks: [{ globalIndex: 1, word: 'workflow' }] });
  await client.runAnnotationBackfill('job-1', {
    template: { articleId: 'article-1', items: [{ targetId: 'target-1' }] },
    model: 'gemini-test',
  });
  await client.getAnnotationBackfillResult('job-1');
  await client.getAnnotationBackfillRunResult('job-1', 'run-1');
  await client.quality('job-1');

  assert.deepEqual(calls.map((call) => call.url), [
    'http://127.0.0.1:8765/api/health',
    'http://127.0.0.1:8765/api/diagnostics',
    'http://127.0.0.1:8765/api/diagnostics/package',
    'http://127.0.0.1:8765/api/credentials/gemini/status',
    'http://127.0.0.1:8765/api/credentials/gemini',
    'http://127.0.0.1:8765/api/credentials/gemini',
    'http://127.0.0.1:8765/api/config',
    'http://127.0.0.1:8765/api/config',
    'http://127.0.0.1:8765/api/maintenance',
    'http://127.0.0.1:8765/api/maintenance/cleanup',
    'http://127.0.0.1:8765/api/jobs',
    'http://127.0.0.1:8765/api/jobs/job-1',
    'http://127.0.0.1:8765/api/jobs/job-1/cancel',
    'http://127.0.0.1:8765/api/jobs/job-2/prioritize',
    'http://127.0.0.1:8765/api/jobs/job-3/redo',
    'http://127.0.0.1:8765/api/jobs/job-4/retry',
    'http://127.0.0.1:8765/api/jobs/clear-canceled',
    'http://127.0.0.1:8765/api/import/pick-folder',
    'http://127.0.0.1:8765/api/media/pick-video',
    'http://127.0.0.1:8765/api/import/scan',
    'http://127.0.0.1:8765/api/import/jobs',
    'http://127.0.0.1:8765/api/jobs/job-1/session',
    'http://127.0.0.1:8765/api/jobs/job-1/file/audio',
    'http://127.0.0.1:8765/api/jobs/job-1/video-source',
    'http://127.0.0.1:8765/api/recent?limit=5',
    'http://127.0.0.1:8765/api/history?query=alpha&status=ready&limit=20',
    'http://127.0.0.1:8765/api/history/job-1',
    'http://127.0.0.1:8765/api/history/job-1?deleteFiles=true',
    'http://127.0.0.1:8765/api/reader/recent?query=read&limit=10',
    'http://127.0.0.1:8765/api/reader/activity',
    'http://127.0.0.1:8765/api/jobs/job-1/reader-marks',
    'http://127.0.0.1:8765/api/jobs/job-1/reader-marks',
    'http://127.0.0.1:8765/api/jobs/job-1/annotation-backfill',
    'http://127.0.0.1:8765/api/jobs/job-1/annotation-backfill/operations/operation-1',
    'http://127.0.0.1:8765/api/jobs/job-1/annotation-backfill/latest',
    'http://127.0.0.1:8765/api/jobs/job-1/annotation-backfill/runs/run-1',
    'http://127.0.0.1:8765/api/jobs/job-1/quality',
  ]);
  assert.equal(calls[4].options.method, 'POST');
  assert.equal(calls[5].options.method, 'DELETE');
  assert.equal(calls[7].options.method, 'POST');
  assert.equal(calls[9].options.method, 'POST');
  assert.equal(calls[10].options.method, 'POST');
  assert.equal(JSON.parse(calls[10].options.body).geminiMode, 'mock');
  assert.equal(calls[12].options.method, 'POST');
  assert.equal(calls[13].options.method, 'POST');
  assert.equal(calls[14].options.method, 'POST');
  assert.equal(calls[15].options.method, 'POST');
  assert.equal(calls[16].options.method, 'POST');
  assert.equal(calls[17].options.method, 'POST');
  assert.equal(calls[18].options.method, 'POST');
  assert.equal(calls[17].options.signal, pickerSignal);
  assert.equal(calls[18].options.signal, pickerSignal);
  assert.equal(calls[19].options.method, 'POST');
  assert.equal(calls[20].options.method, 'POST');
  assert.equal(JSON.parse(calls[20].options.body).geminiMode, 'mock');
  assert.equal(calls[23].options.method, 'POST');
  assert.equal(JSON.parse(calls[23].options.body).videoPath, 'D:/legacy-materials/a/a.mp4');
  assert.equal(calls[27].options.method, 'DELETE');
  assert.equal(calls[29].options.method, 'POST');
  assert.equal(JSON.parse(calls[29].options.body).event, 'progress');
  assert.equal(calls[31].options.method, 'POST');
  assert.equal(JSON.parse(calls[31].options.body).marks[0].word, 'workflow');
  assert.equal(calls[32].options.method, 'POST');
  assert.equal(JSON.parse(calls[32].options.body).template.articleId, 'article-1');
  assert.equal(JSON.parse(calls[32].options.body).model, 'gemini-test');
  assert.ok(calls.every((call) => call.options.headers['X-Read-Web-Token'] === 'test-client-token'));
  assert.equal(client.fileUrl('job-1', 'video'), 'http://127.0.0.1:8765/api/jobs/job-1/file/video?access_token=test-client-token');
  assert.equal(client.mediaUrl('job-1', 'video'), 'http://127.0.0.1:8765/api/jobs/job-1/media/video?access_token=test-client-token');
  assert.equal(client.eventsUrl('job-1'), 'http://127.0.0.1:8765/api/jobs/job-1/events?access_token=test-client-token');

  const protocolCalls = [];
  const protocolClient = api.createYoutubeWorkflowClient({
    baseUrl: 'http://127.0.0.1:8765',
    accessToken: 'test-client-token',
    fetchImpl: async (url, options = {}) => {
      protocolCalls.push({ url, options });
      return {
        ok: true,
        status: 200,
        async json() {
          return { jobId: 'job-1', status: 'queued', revision: 8 };
        },
      };
    },
  });
  const mutationPayload = { url: 'https://youtube.example/protocol', geminiMode: 'mock' };
  await protocolClient.createJob(mutationPayload, {
    idempotencyKey: 'create-operation-1',
    expectedRevision: 7,
  });
  await protocolClient.cancelJob('job-1', {
    idempotencyKey: 'cancel-operation-1',
    expectedRevision: 7,
  });
  await protocolClient.prioritizeJob('job-1', {
    operationKey: 'prioritize-operation-1',
    expectedRevision: 7,
  });
  await protocolClient.retryJob('job-1', { stage: 'translating' }, {
    idempotencyKey: 'retry-operation-1',
    expectedRevision: 7,
  });
  assert.deepEqual(
    protocolCalls.map(({ options }) => ({
      idempotencyKey: options.headers['Idempotency-Key'],
      expectedRevision: options.headers['X-Expected-Revision'],
      ifMatch: options.headers['If-Match'],
      token: options.headers['X-Read-Web-Token'],
    })),
    [
      { idempotencyKey: 'create-operation-1', expectedRevision: '7', ifMatch: '"7"', token: 'test-client-token' },
      { idempotencyKey: 'cancel-operation-1', expectedRevision: '7', ifMatch: '"7"', token: 'test-client-token' },
      { idempotencyKey: 'prioritize-operation-1', expectedRevision: '7', ifMatch: '"7"', token: 'test-client-token' },
      { idempotencyKey: 'retry-operation-1', expectedRevision: '7', ifMatch: '"7"', token: 'test-client-token' },
    ],
  );
  assert.ok(
    protocolCalls.every(({ options }) => !String(options.body || '').includes('test-client-token')),
    'authorization token must never enter a mutation body',
  );

  const conflictClient = api.createYoutubeWorkflowClient({
    baseUrl: 'http://127.0.0.1:8765',
    accessToken: 'test-client-token',
    fetchImpl: async () => ({
      ok: false,
      status: 409,
      async json() {
        return {
          detail: {
            code: 'WORKFLOW_STATE_CONFLICT',
            domain: 'jobs',
            expectedRevision: 7,
            currentRevision: 9,
            message: 'state changed',
          },
        };
      },
    }),
  });
  await assert.rejects(
    conflictClient.cancelJob('job-1', { expectedRevision: 7 }),
    (error) => {
      assert.equal(error.code, 'WORKFLOW_STATE_CONFLICT');
      assert.equal(error.status, 409);
      assert.equal(error.actualRevision, 9);
      assert.equal(error.currentRevision, 9);
      assert.equal(error.expectedRevision, 7);
      assert.equal(error.detail.currentRevision, 9);
      return true;
    },
  );
  const keepaliveStart = calls.length;
  await client.keepaliveReaderActivity({ jobId: 'job-1', event: 'close', activityOperationId: 'keepalive-activity' });
  await client.keepaliveReaderMarks('job-1', { marks: [], operationId: 'keepalive-marks' });
  const keepaliveCalls = calls.slice(keepaliveStart);
  assert.deepEqual(keepaliveCalls.map((call) => call.url), [
    'http://127.0.0.1:8765/api/reader/activity',
    'http://127.0.0.1:8765/api/jobs/job-1/reader-marks',
  ]);
  assert.ok(keepaliveCalls.every((call) => call.options.keepalive === true));
  assert.ok(keepaliveCalls.every((call) => call.options.headers['X-Read-Web-Token'] === 'test-client-token'));
  assert.ok(keepaliveCalls.every((call) => !call.url.includes('access_token=')));

  const failingClient = api.createYoutubeWorkflowClient({
    baseUrl: 'http://127.0.0.1:8765',
    fetchImpl: async () => ({
      ok: false,
      status: 504,
      async json() {
        return { detail: { code: 'native-picker-timeout', message: 'Native picker timed out' } };
      },
    }),
  });
  await assert.rejects(failingClient.pickVideoFile(), (error) => {
    assert.equal(error.code, 'native-picker-timeout');
    assert.equal(error.status, 504);
    assert.equal(error.message, 'Native picker timed out');
    return true;
  });

  console.log('youtube workflow client check passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
