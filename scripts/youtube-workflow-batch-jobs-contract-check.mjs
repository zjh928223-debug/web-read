import assert from 'node:assert/strict'
import fs from 'node:fs/promises'

const clientUrl = new URL('../src/composables/youtube-workflow-client.js', import.meta.url)
const clientSource = (await fs.readFile(clientUrl, 'utf8'))
  .replace("const DEFAULT_BASE_URL = import.meta.env?.VITE_LOCAL_SERVICE_BASE_URL\n  || 'http://127.0.0.1:8765'", "const DEFAULT_BASE_URL = 'http://127.0.0.1:8765'")
const { createYoutubeWorkflowClient } = await import(
  `data:text/javascript;base64,${Buffer.from(clientSource).toString('base64')}`
)

const requests = []
const fetchImpl = async (url, init = {}) => {
  requests.push({ url, init })
  return {
    ok: true,
    async json() {
      return {
        schemaVersion: 1,
        snapshotAt: '2026-08-12T00:00:00Z',
        jobs: [
          { jobId: 'job-a', status: 'downloading', stage: 'download', updatedAt: '2026-08-12T00:00:00Z' },
          { jobId: 'job-b', status: 'queued', stage: 'queued', updatedAt: '2026-08-12T00:00:00Z' },
        ],
        missingJobIds: ['job-missing'],
      }
    },
  }
}

const client = createYoutubeWorkflowClient({ baseUrl: 'http://workflow.test', fetchImpl })
assert.equal(
  typeof client.getJobsSnapshot,
  'function',
  'client must expose one batch snapshot operation instead of polling getJob(jobId) N times',
)

const controller = new AbortController()
const snapshot = await client.getJobsSnapshot(
  ['job-a', 'job-b', 'job-a', '', 'job-missing'],
  { signal: controller.signal },
)

assert.equal(requests.length, 1, 'one polling generation must make exactly one HTTP request')
assert.equal(requests[0].url, 'http://workflow.test/api/jobs/snapshot')
assert.equal(requests[0].init.method, 'POST')
assert.equal(requests[0].init.headers['content-type'], 'application/json')
assert.equal(requests[0].init.signal, controller.signal)
assert.deepEqual(
  JSON.parse(requests[0].init.body),
  { jobIds: ['job-a', 'job-b', 'job-missing'] },
  'client must remove blank and duplicate IDs while preserving first-seen order',
)
assert.equal(snapshot.schemaVersion, 1)
assert.deepEqual(snapshot.jobs.map((job) => job.jobId), ['job-a', 'job-b'])
assert.deepEqual(snapshot.missingJobIds, ['job-missing'])
assert.equal(typeof snapshot.snapshotAt, 'string')

console.log('youtube workflow batch jobs contract check passed')
