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
  await client.getSession('job-1');
  await client.getFile('job-1', 'audio');
  await client.recent(5);
  await client.history({ query: 'alpha', status: 'ready', limit: 20 });
  await client.getHistory('job-1');
  await client.deleteHistory('job-1', { deleteFiles: true });
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
    'http://127.0.0.1:8765/api/jobs/job-1/session',
    'http://127.0.0.1:8765/api/jobs/job-1/file/audio',
    'http://127.0.0.1:8765/api/recent?limit=5',
    'http://127.0.0.1:8765/api/history?query=alpha&status=ready&limit=20',
    'http://127.0.0.1:8765/api/history/job-1',
    'http://127.0.0.1:8765/api/history/job-1?deleteFiles=true',
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
  assert.equal(calls[22].options.method, 'DELETE');

  console.log('youtube workflow client check passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
