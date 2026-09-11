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

  const structuredErrorClient = api.createYoutubeWorkflowClient({
    baseUrl: 'http://127.0.0.1:8765',
    fetchImpl: async () => ({
      ok: false,
      status: 409,
      async json() {
        return {
          status: 'not-ready',
          error: {
            code: 'legacy-writer-frozen',
            message: 'the Host owner API is authoritative for this domain',
          },
        };
      },
    }),
  });
  await assert.rejects(
    structuredErrorClient.health(),
    (error) => error.message === 'the Host owner API is authoritative for this domain'
      && error.code === 'legacy-writer-frozen'
      && error.detail?.code === 'legacy-writer-frozen',
  );

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
  await client.deleteJob('job-delete');
  await client.cancelJob('job-1');
  await client.prioritizeJob('job-2');
  await client.redoJob('job-3');
  await client.retryJob('job-4', { stage: 'translating' });
  await client.clearCanceledJobs();
  await client.clearFailedJobs();
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

  const ownerQueries = [];
  const ownerCommands = [];
  globalThis.__windowsOwnerDomainCutover = {
    isAuthoritative(domain) { return domain === 'marks-activity'; },
    async query(request) {
      ownerQueries.push(request);
      return { payload: { revision: 4 }, revision: 4 };
    },
    async command(request) {
      ownerCommands.push(request);
      return { outcome: 'committed', commitStatus: 'committed', revision: 5 };
    },
  };
  try {
    await client.recordReaderActivity({ jobId: 'job-owner', contentId: 'content-owner', event: 'progress' });
    await client.saveReaderMarks('job-owner', { contentId: 'content-owner', marks: [{ globalIndex: 1 }] });
  } finally {
    delete globalThis.__windowsOwnerDomainCutover;
  }
  assert.equal(ownerQueries.length, 2);
  assert.equal(ownerCommands.length, 2);
  assert.deepEqual(ownerCommands.map((request) => [request.domain, request.operation, request.expectedRevision]), [
    ['marks-activity', 'activity-append', 4],
    ['marks-activity', 'marks-commit', 4],
  ]);
  assert.ok(ownerCommands.every((request) => typeof request.idempotencyKey === 'string' && request.idempotencyKey.startsWith('marks-')));
  assert.equal(calls.filter((call) => call.url.includes('/api/reader/activity') || call.url.includes('/reader-marks')).length, 3);

  let workflowOwnerRefreshes = 0;
  let workflowOwnerReady = false;
  globalThis.__windowsOwnerDomainCutover = {
    get ownerReady() { return workflowOwnerReady; },
    isAuthoritative(domain) { return domain === 'workflow'; },
    async refresh() {
      workflowOwnerRefreshes += 1;
      workflowOwnerReady = true;
    },
    async query(request) {
      assert.equal(workflowOwnerReady, true);
      return { outcome: 'read', revision: 1, payload: { records: [] } };
    },
    async command() { return { outcome: 'committed', commitStatus: 'committed', revision: 1 }; },
  };
  try {
    assert.deepEqual(await client.readerRecent({ limit: 1 }), []);
  } finally {
    delete globalThis.__windowsOwnerDomainCutover;
  }
  assert.equal(workflowOwnerRefreshes, 1);

  const workflowCommands = [];
  let workflowRevision = 0;
  const workflowCommandReceipts = new Map();
  const workflowRevisionToken = (revision) => `w1:j${revision}:${'a'.repeat(16)}:h0:${'b'.repeat(16)}:c${'c'.repeat(16)}:i${'d'.repeat(16)}`;
  const workflowJob = {
    jobId: 'workflow-real-retry',
    status: 'failed',
    stage: 'translating',
    request: {
      url: 'https://youtube.example/real-retry',
      geminiMode: 'real',
      model: 'gemini-test',
      baseUrl: 'https://workflow.example/v1',
      videoPriority: true,
      apiKey: 'SERVER-PERSISTED-KEY-MUST-NOT-REENTER-RETRY',
    },
  };
  const safeWorkflowRequest = { ...workflowJob.request };
  delete safeWorkflowRequest.apiKey;
  globalThis.__windowsOwnerDomainCutover = {
    isAuthoritative(domain) { return domain === 'workflow'; },
    async query(request) {
      return {
        outcome: 'read',
        revision: workflowRevisionToken(workflowRevision),
        payload: request.payload?.jobId
          ? { job: workflowJob, records: [workflowJob] }
          : { records: [workflowJob] },
      };
    },
    async command(request) {
      const capturedRequest = structuredClone(request);
      workflowCommands.push(capturedRequest);
      const receiptKey = `${request.operation}:${request.idempotencyKey}`;
      const existing = workflowCommandReceipts.get(receiptKey);
      if (existing) {
        return {
          ...existing,
          payload: {
            ...existing.payload,
            serviceResult: { ...existing.payload.serviceResult, idempotent: true },
          },
        };
      }
      workflowRevision += 1;
      const jobId = request.operation === 'job-start' ? 'workflow-real-created' : 'workflow-real-retried';
      const response = {
        outcome: 'committed',
        commitStatus: 'committed',
        revision: workflowRevisionToken(workflowRevision),
        payload: {
          serviceResult: {
            jobId,
            status: 'queued',
            stage: 'queued',
            request: safeWorkflowRequest,
          },
        },
      };
      workflowCommandReceipts.set(receiptKey, response);
      return response;
    },
  };
  try {
    const createSecret = 'SECRET-WORKFLOW-CREATE-CLIENT';
    const createdWorkflowJob = await client.createJob(
      {
        url: 'https://youtube.example/real-create',
        geminiMode: 'real',
        model: 'gemini-test',
        baseUrl: 'https://workflow.example/v1',
        apiKey: createSecret,
      },
      { expectedRevision: 0, idempotencyKey: 'workflow-client-create-secret' },
    );
    assert.equal(createdWorkflowJob.jobId, 'workflow-real-created');
    assert.equal(workflowCommands[0].payload.record.request.apiKey, undefined);
    assert.deepEqual(workflowCommands[0].payload.ephemeral, { apiKey: createSecret });

    const createdReplay = await client.createJob(
      {
        url: 'https://youtube.example/real-create',
        geminiMode: 'real',
      },
      { expectedRevision: workflowRevisionToken(1), idempotencyKey: 'workflow-client-create-secret' },
    );
    assert.equal(createdReplay.jobId, 'workflow-real-created');
    assert.equal(workflowCommands[1].payload.ephemeral, undefined);

    const retrySecret = 'SECRET-WORKFLOW-RETRY-CLIENT';
    const retriedWorkflowJob = await client.retryJob(
      'workflow-real-retry',
      { stage: 'translating', apiKey: retrySecret },
      { expectedRevision: 1, idempotencyKey: 'workflow-client-retry-secret' },
    );
    assert.equal(retriedWorkflowJob.jobId, 'workflow-real-retried');
    assert.equal(workflowCommands[2].payload.record.request.apiKey, undefined);
    assert.equal(workflowCommands[2].payload.record.request.api_key, undefined);
    assert.deepEqual(workflowCommands[2].payload.ephemeral, { apiKey: retrySecret });

    const retriedReplay = await client.retryJob(
      'workflow-real-retry',
      { stage: 'translating' },
      { expectedRevision: workflowRevisionToken(2), idempotencyKey: 'workflow-client-retry-secret' },
    );
    assert.equal(retriedReplay.jobId, 'workflow-real-retried');
    assert.equal(workflowCommands[3].payload.ephemeral, undefined);
  } finally {
    delete globalThis.__windowsOwnerDomainCutover;
  }

  const failureCommands = [];
  let failureMode = 'conflict';
  globalThis.__windowsOwnerDomainCutover = {
    isAuthoritative(domain) { return domain === 'marks-activity'; },
    async query() { return { revision: 7 }; },
    async command(request) {
      failureCommands.push(request);
      const error = failureMode === 'conflict'
        ? { code: 'OWNER_REVISION_CONFLICT', category: 'conflict' }
        : { code: 'OWNER_NOT_READY', category: 'recovery' };
      return {
        outcome: failureMode,
        commitStatus: failureMode,
        revision: 8,
        error,
      };
    },
  };
  try {
    await assert.rejects(
      client.recordReaderActivity({
        jobId: 'job-owner',
        contentId: 'content-owner',
        event: 'progress',
        expectedRevision: 7,
        operationId: 'activity-op-7',
      }),
      (error) => error.category === 'conflict',
    );
    assert.equal(failureCommands[0].expectedRevision, 7);
    assert.equal(failureCommands[0].idempotencyKey, 'activity-op-7');
    assert.deepEqual(failureCommands[0].payload, {
      jobId: 'job-owner',
      contentId: 'content-owner',
      event: 'progress',
    });

    failureMode = 'not-ready';
    await assert.rejects(
      client.saveReaderMarks('job-owner', {
        contentId: 'content-owner',
        marks: [],
        expectedRevision: 7,
        operationId: 'marks-op-7',
      }),
      (error) => error.category === 'recovery',
    );
    assert.equal(failureCommands[1].expectedRevision, 7);
    assert.equal(failureCommands[1].idempotencyKey, 'marks-op-7');
    assert.equal(Object.hasOwn(failureCommands[1].payload, 'expectedRevision'), false);
    assert.equal(Object.hasOwn(failureCommands[1].payload, 'operationId'), false);

    failureMode = 'commit-unknown';
    const ledgerApi = await importModule(
      path.join(repoRoot, 'src', 'services', 'persistence', 'latest-wins-ledger.js'),
    );
    const ledger = ledgerApi.createLatestWinsLedger({
      write(snapshot, context) {
        return client.saveReaderMarks('job-owner', {
          ...snapshot,
          expectedRevision: 7,
          operationId: context.operationId,
        });
      },
    });
    ledger.submit({ marks: [{ globalIndex: 2 }] });
    await ledger.waitForIdle();
    assert.equal(ledger.getState().status, 'error');
    assert.equal(ledger.getState().dirty, true);
    assert.equal(ledger.getState().savedSequence, 0);
    assert.equal(failureCommands[2].expectedRevision, 7);
    assert.equal(failureCommands[2].idempotencyKey, 'ledger-1');
    ledger.dispose();
  } finally {
    delete globalThis.__windowsOwnerDomainCutover;
  }

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
    'http://127.0.0.1:8765/api/jobs/job-delete',
    'http://127.0.0.1:8765/api/jobs/job-1/cancel',
    'http://127.0.0.1:8765/api/jobs/job-2/prioritize',
    'http://127.0.0.1:8765/api/jobs/job-3/redo',
    'http://127.0.0.1:8765/api/jobs/job-4/retry',
    'http://127.0.0.1:8765/api/jobs/clear-canceled',
    'http://127.0.0.1:8765/api/jobs/clear-failed',
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
  assert.equal(calls[12].options.method, 'DELETE');
  assert.equal(calls[13].options.method, 'POST');
  assert.equal(calls[14].options.method, 'POST');
  assert.equal(calls[15].options.method, 'POST');
  assert.equal(calls[16].options.method, 'POST');
  assert.equal(calls[17].options.method, 'POST');
  assert.equal(calls[18].options.method, 'POST');
  assert.equal(calls[19].options.method, 'POST');
  assert.equal(calls[20].options.method, 'POST');
  assert.equal(calls[19].options.signal, pickerSignal);
  assert.equal(calls[20].options.signal, pickerSignal);
  assert.equal(calls[21].options.method, 'POST');
  assert.equal(calls[22].options.method, 'POST');
  assert.equal(JSON.parse(calls[22].options.body).geminiMode, 'mock');
  assert.equal(calls[25].options.method, 'POST');
  assert.equal(JSON.parse(calls[25].options.body).videoPath, 'D:/legacy-materials/a/a.mp4');
  assert.equal(calls[29].options.method, 'DELETE');
  assert.equal(calls[31].options.method, 'POST');
  assert.equal(JSON.parse(calls[31].options.body).event, 'progress');
  assert.equal(calls[33].options.method, 'POST');
  assert.equal(JSON.parse(calls[33].options.body).marks[0].word, 'workflow');
  assert.equal(calls[34].options.method, 'POST');
  assert.equal(JSON.parse(calls[34].options.body).template.articleId, 'article-1');
  assert.equal(JSON.parse(calls[34].options.body).model, 'gemini-test');
  assert.ok(calls.every((call) => call.options.headers['X-Read-Web-Token'] === 'test-client-token'));
  assert.equal(client.fileUrl('job-1', 'video'), 'http://127.0.0.1:8765/api/jobs/job-1/file/video?access_token=test-client-token');
  assert.equal(client.mediaUrl('job-1', 'video'), 'http://127.0.0.1:8765/api/jobs/job-1/media/video?access_token=test-client-token');
  assert.equal(client.eventsUrl('job-1'), 'http://127.0.0.1:8765/api/jobs/job-1/events?access_token=test-client-token');

  const rangeProbeCalls = [];
  const rangeProbeClient = api.createYoutubeWorkflowClient({
    baseUrl: 'http://127.0.0.1:8765',
    fetchImpl: async (url, options = {}) => {
      rangeProbeCalls.push({ url, options });
      return {
        ok: true,
        status: 206,
        headers: new Map([
          ['content-range', 'bytes 0-0/10'],
          ['accept-ranges', 'bytes'],
          ['etag', '"probe"'],
        ]),
      };
    },
  });
  await rangeProbeClient.probeMediaRange('job-1', 'audio');
  assert.equal(rangeProbeCalls[0].options.cache, 'no-store', 'Range availability probes must bypass stale cached CORS responses');
  assert.equal(rangeProbeCalls[0].options.headers.Range, 'bytes=0-0');

  const unsupportedRangeClient = api.createYoutubeWorkflowClient({
    baseUrl: 'http://127.0.0.1:8765',
    fetchImpl: async () => ({ ok: true, status: 206, headers: new Map() }),
  });
  await assert.rejects(
    unsupportedRangeClient.probeMediaRange('job-1', 'audio'),
    (error) => {
      assert.equal(error.code, 'MEDIA_RANGE_UNSUPPORTED');
      assert.deepEqual(error.details, { status: 206, contentRange: '', acceptRanges: '' });
      return true;
    },
  );

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
  await protocolClient.deleteJob('job-delete', { expectedRevision: 7 });
  await protocolClient.clearFailedJobs({ expectedRevision: 7 });
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
      { idempotencyKey: undefined, expectedRevision: '7', ifMatch: '"7"', token: 'test-client-token' },
      { idempotencyKey: undefined, expectedRevision: '7', ifMatch: '"7"', token: 'test-client-token' },
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
