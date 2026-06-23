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
  await client.clearCanceledJobs();
  await client.getSession('job-1');
  await client.getFile('job-1', 'audio');
  await client.recent(5);

  assert.deepEqual(calls.map((call) => call.url), [
    'http://127.0.0.1:8765/api/health',
    'http://127.0.0.1:8765/api/diagnostics',
    'http://127.0.0.1:8765/api/jobs',
    'http://127.0.0.1:8765/api/jobs/job-1',
    'http://127.0.0.1:8765/api/jobs/job-1/cancel',
    'http://127.0.0.1:8765/api/jobs/job-2/prioritize',
    'http://127.0.0.1:8765/api/jobs/job-3/redo',
    'http://127.0.0.1:8765/api/jobs/clear-canceled',
    'http://127.0.0.1:8765/api/jobs/job-1/session',
    'http://127.0.0.1:8765/api/jobs/job-1/file/audio',
    'http://127.0.0.1:8765/api/recent?limit=5',
  ]);
  assert.equal(calls[2].options.method, 'POST');
  assert.equal(JSON.parse(calls[2].options.body).geminiMode, 'mock');
  assert.equal(calls[4].options.method, 'POST');
  assert.equal(calls[5].options.method, 'POST');
  assert.equal(calls[6].options.method, 'POST');
  assert.equal(calls[7].options.method, 'POST');

  console.log('youtube workflow client check passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
