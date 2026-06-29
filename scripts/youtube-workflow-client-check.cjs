const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function importModule(filePath) {
  const source = fs.readFileSync(filePath, 'utf8');
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
    return {
      ok: true,
      status: 200,
      headers: new Map(),
      async json() { return { url, ok: true }; },
      async blob() { return new Blob(['audio']); },
    };
  };
  const client = api.createYoutubeWorkflowClient({ baseUrl: 'http://127.0.0.1:8765', fetchImpl });

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
  await client.pickImportFolder({ initialDir: 'D:/legacy-materials' });
  await client.scanImportRoot({ rootPath: 'D:/legacy-materials' });
  await client.createImportJobs({ items: [{ audioPath: 'D:/legacy-materials/a.mp3', selected: true }], geminiMode: 'mock' });
  await client.getSession('job-1');
  await client.getFile('job-1', 'audio');
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
    'http://127.0.0.1:8765/api/import/scan',
    'http://127.0.0.1:8765/api/import/jobs',
    'http://127.0.0.1:8765/api/jobs/job-1/session',
    'http://127.0.0.1:8765/api/jobs/job-1/file/audio',
    'http://127.0.0.1:8765/api/recent?limit=5',
    'http://127.0.0.1:8765/api/history?query=alpha&status=ready&limit=20',
    'http://127.0.0.1:8765/api/history/job-1',
    'http://127.0.0.1:8765/api/history/job-1?deleteFiles=true',
    'http://127.0.0.1:8765/api/reader/recent?query=read&limit=10',
    'http://127.0.0.1:8765/api/reader/activity',
    'http://127.0.0.1:8765/api/jobs/job-1/reader-marks',
    'http://127.0.0.1:8765/api/jobs/job-1/reader-marks',
    'http://127.0.0.1:8765/api/jobs/job-1/annotation-backfill',
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
  assert.equal(calls[19].options.method, 'POST');
  assert.equal(JSON.parse(calls[19].options.body).geminiMode, 'mock');
  assert.equal(calls[25].options.method, 'DELETE');
  assert.equal(calls[27].options.method, 'POST');
  assert.equal(JSON.parse(calls[27].options.body).event, 'progress');
  assert.equal(calls[29].options.method, 'POST');
  assert.equal(JSON.parse(calls[29].options.body).marks[0].word, 'workflow');
  assert.equal(calls[30].options.method, 'POST');
  assert.equal(JSON.parse(calls[30].options.body).template.articleId, 'article-1');
  assert.equal(JSON.parse(calls[30].options.body).model, 'gemini-test');

  console.log('youtube workflow client check passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
