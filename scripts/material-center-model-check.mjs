import assert from 'node:assert/strict'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const source = fs.readFileSync(fileURLToPath(new URL('../src/services/workflow/material-center-model.js', import.meta.url)), 'utf8')
const moduleUrl = `data:text/javascript;base64,${Buffer.from(source, 'utf8').toString('base64')}`
const {
  canonicalMaterialKey,
  extractYoutubeVideoId,
  filterLibraryByTime,
  findDuplicateMaterial,
  groupTaskAttempts,
} = await import(moduleUrl)

assert.equal(extractYoutubeVideoId('https://youtu.be/AbCdEf12345?t=20'), 'AbCdEf12345')
assert.equal(extractYoutubeVideoId('https://www.youtube.com/watch?v=AbCdEf12345&feature=share'), 'AbCdEf12345')
assert.equal(extractYoutubeVideoId('https://m.youtube.com/shorts/AbCdEf12345'), 'AbCdEf12345')
assert.equal(canonicalMaterialKey('https://www.youtube.com/embed/AbCdEf12345'), 'youtube:AbCdEf12345')

const jobs = [
  {
    jobId: 'failed-old',
    status: 'failed',
    updatedAt: '2026-08-10T10:00:00.000Z',
    request: { url: 'https://youtu.be/AbCdEf12345' },
  },
  {
    jobId: 'failed-new',
    status: 'failed',
    updatedAt: '2026-08-11T10:00:00.000Z',
    request: { url: 'https://www.youtube.com/watch?v=AbCdEf12345' },
  },
  {
    jobId: 'active',
    status: 'translating',
    updatedAt: '2026-08-12T10:00:00.000Z',
    request: { url: 'https://www.youtube.com/shorts/Another1234' },
  },
  {
    jobId: 'ready-hidden',
    status: 'ready',
    updatedAt: '2026-08-13T10:00:00.000Z',
    request: { url: 'https://youtu.be/ReadyVid123' },
  },
]

const groups = groupTaskAttempts(jobs)
assert.equal(groups.length, 2)
assert.equal(groups.find((group) => group.key === 'youtube:AbCdEf12345').attemptCount, 2)
assert.equal(groups.find((group) => group.key === 'youtube:Another1234').statusKind, 'active')

const duplicate = findDuplicateMaterial('https://youtube.com/live/AbCdEf12345', jobs, [])
assert.equal(duplicate.state, 'failed')
assert.equal(duplicate.job.jobId, 'failed-new')

const now = Date.parse('2026-08-18T12:00:00.000Z')
const library = [
  { jobId: 'older', finishedAt: '2026-07-01T12:00:00.000Z' },
  { jobId: 'recent', lastActivityAt: '2026-08-17T12:00:00.000Z' },
  { jobId: 'newest', finishedAt: '2026-08-18T11:00:00.000Z' },
]
assert.deepEqual(filterLibraryByTime(library, 'all', now).map((item) => item.jobId), ['newest', 'recent', 'older'])
assert.deepEqual(filterLibraryByTime(library, 'recent', now).map((item) => item.jobId), ['newest', 'recent'])
assert.deepEqual(filterLibraryByTime(library, 'earlier', now).map((item) => item.jobId), ['older'])

console.log('material center model check passed')
