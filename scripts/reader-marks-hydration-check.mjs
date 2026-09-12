import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'

const esmRootUrl = new URL('../src/', import.meta.url).href
registerHooks({
  load(url, context, nextLoad) {
    if (url.startsWith(esmRootUrl) && url.endsWith('.js')) {
      return nextLoad(url, { ...context, format: 'module' })
    }
    return nextLoad(url, context)
  },
})

const { createReaderMarksHydration } = await import(
  '../src/composables/create-reader-marks-hydration.js',
)
const { youtubeWorkflowClient } = await import('../src/composables/youtube-workflow-client.js')

function deferred() {
  let resolve
  let reject
  const promise = new Promise((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function tick() {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function createHarness({
  jobId = 'job-a',
  marks = [],
  rememberMarksRevision,
  restoreVisibleMarks,
  submitLocalChanges,
} = {}) {
  let currentJobId = jobId
  let currentMarks = marks
  const revisions = []
  const visibleMarks = []
  const localSubmissions = []
  const harness = {
    setJobId(value) { currentJobId = value },
    setMarks(value) { currentMarks = value },
    getCurrentMarks() { return currentMarks },
    revisions,
    visibleMarks,
    localSubmissions,
  }
  harness.tracker = createReaderMarksHydration({
    getCurrentJobId: () => currentJobId,
    getCurrentReaderMarks: () => currentMarks,
    rememberMarksRevision: rememberMarksRevision || ((id, revision) => revisions.push({ id, revision })),
    restoreVisibleMarks: restoreVisibleMarks || ((value) => visibleMarks.push(structuredClone(value))),
    submitLocalChanges: submitLocalChanges || (() => localSubmissions.push('marks', 'activity')),
  })
  return harness
}

const originalGetReaderMarks = youtubeWorkflowClient.getReaderMarks
const originalWarn = console.warn
const warnings = []
console.warn = (...args) => warnings.push(args)

try {
  let dependencyCalls = 0
  createReaderMarksHydration({
    getCurrentJobId: () => { dependencyCalls += 1; return 'unused' },
    getCurrentReaderMarks: () => { dependencyCalls += 1; return [] },
    rememberMarksRevision: () => { dependencyCalls += 1 },
    restoreVisibleMarks: () => { dependencyCalls += 1 },
    submitLocalChanges: () => { dependencyCalls += 1 },
  })
  assert.equal(dependencyCalls, 0, 'constructing hydration must not call its dependencies')

  const requests = []
  youtubeWorkflowClient.getReaderMarks = (jobId) => {
    const pending = deferred()
    requests.push({ jobId, pending })
    return pending.promise
  }
  const first = createHarness({ jobId: 'job-a' })
  const second = createHarness({ jobId: 'job-a' })
  assert.equal(first.tracker.startReaderMarksHydration('   '), undefined, 'empty job ids must be skipped')
  const firstPromise = first.tracker.startReaderMarksHydration(' job-a ')
  assert.strictEqual(first.tracker.startReaderMarksHydration('job-a'), firstPromise, 'same-job hydration must reuse the pending promise')
  assert.equal(requests.length, 1, 'same-job hydration must issue only one GET')
  requests[0].pending.resolve({ revision: 1, marks: [] })
  await firstPromise
  assert.strictEqual(first.tracker.startReaderMarksHydration('job-a'), firstPromise, 'completed hydration must remain cached')
  assert.equal(requests.length, 1, 'completed hydration must not issue a second GET')
  first.tracker.clear()
  const afterClear = first.tracker.startReaderMarksHydration('job-a')
  assert.equal(requests.length, 2, 'clear must allow the next hydration to start')
  requests[1].pending.resolve({ revision: 2, marks: [] })
  await afterClear
  const secondPromise = second.tracker.startReaderMarksHydration('job-a')
  assert.equal(requests.length, 3, 'separate instances must not share hydration records')
  requests[2].pending.resolve({ revision: 3, marks: [] })
  await secondPromise

  youtubeWorkflowClient.getReaderMarks = async (jobId) => ({
    jobId,
    revision: '7',
    marks: [{ globalIndex: 3, word: 'remote' }],
  })
  const applied = createHarness({ jobId: 'restore' })
  await applied.tracker.startReaderMarksHydration('restore')
  assert.deepEqual(applied.visibleMarks, [[{ globalIndex: 3, word: 'remote' }]], 'unchanged local marks must accept remote marks')
  assert.deepEqual(applied.revisions, [{ id: 'restore', revision: 7 }], 'valid revisions must be remembered before applying marks')
  assert.deepEqual(applied.localSubmissions, [], 'remote restoration must not enter the local DB save path')

  const pendingMarks = [
    { globalIndex: 1, word: 'baseline', start: 1, sourceType: 'manual-mark' },
    { globalIndex: 2, word: 'second', start: 2, sourceType: 'manual-mark' },
  ]
  const localEdit = [{ globalIndex: 9, word: 'local', start: 9, sourceType: 'manual-mark' }]
  const localGate = deferred()
  youtubeWorkflowClient.getReaderMarks = () => localGate.promise
  const pending = createHarness({ jobId: 'pending', marks: pendingMarks })
  const pendingPromise = pending.tracker.startReaderMarksHydration('pending')
  pending.setMarks(localEdit)
  assert.equal(pending.tracker.deferLocalChange('pending'), true, 'pending hydration must take ownership of local changes')
  localGate.resolve({ revision: 8, marks: [{ globalIndex: 9, word: 'remote' }] })
  await pendingPromise
  assert.deepEqual(pending.visibleMarks, [], 'local changes must prevent remote overwrite')
  assert.deepEqual(pending.localSubmissions, ['marks', 'activity'], 'pending local changes must resubmit marks before activity')

  const revertGate = deferred()
  youtubeWorkflowClient.getReaderMarks = () => revertGate.promise
  const reverted = createHarness({ jobId: 'reverted', marks: pendingMarks })
  const revertedPromise = reverted.tracker.startReaderMarksHydration('reverted')
  reverted.setMarks(localEdit)
  assert.equal(reverted.tracker.deferLocalChange('reverted'), true)
  reverted.setMarks(pendingMarks)
  assert.equal(reverted.tracker.deferLocalChange('reverted'), true, 'a pending edit may be changed back to its baseline')
  revertGate.resolve({ revision: 9, marks: [{ globalIndex: 10, word: 'remote' }] })
  await revertedPromise
  assert.deepEqual(reverted.visibleMarks, [[{ globalIndex: 10, word: 'remote' }]], 'returning to baseline must allow remote restoration')
  assert.deepEqual(reverted.localSubmissions, [], 'returning to baseline must not trigger a compensating save')

  const noEventGate = deferred()
  youtubeWorkflowClient.getReaderMarks = () => noEventGate.promise
  const noEvent = createHarness({ jobId: 'no-event', marks: pendingMarks })
  const noEventPromise = noEvent.tracker.startReaderMarksHydration('no-event')
  noEvent.setMarks(localEdit)
  noEventGate.resolve({ revision: 10, marks: [{ globalIndex: 11, word: 'remote' }] })
  await noEventPromise
  assert.deepEqual(noEvent.visibleMarks, [], 'fingerprint changes must prevent overwrite without a change event')
  assert.deepEqual(noEvent.localSubmissions, [], 'fingerprint-only changes must not invent a compensating save')

  const orderGate = deferred()
  youtubeWorkflowClient.getReaderMarks = () => orderGate.promise
  const reordered = createHarness({
    jobId: 'reordered',
    marks: [pendingMarks[1], pendingMarks[0]],
  })
  const reorderedPromise = reordered.tracker.startReaderMarksHydration('reordered')
  reordered.setMarks([...pendingMarks].reverse())
  orderGate.resolve({ revision: 11, marks: [{ globalIndex: 12, word: 'remote' }] })
  await reorderedPromise
  assert.deepEqual(reordered.visibleMarks, [[{ globalIndex: 12, word: 'remote' }]], 'mark array ordering must not count as a local change')

  const applyGate = deferred()
  const syncGate = deferred()
  youtubeWorkflowClient.getReaderMarks = () => applyGate.promise
  let applying = null
  const applyingHarness = createHarness({
    jobId: 'applying',
    restoreVisibleMarks: async (marks) => {
      applying = structuredClone(marks)
      assert.equal(applyingHarness.tracker.deferLocalChange('applying'), true, 'events caused by restoration must stay deferred')
      await syncGate.promise
      assert.equal(applyingHarness.tracker.deferLocalChange('applying'), true, 'events during annotation sync must stay deferred')
    },
  })
  const applyingPromise = applyingHarness.tracker.startReaderMarksHydration('applying')
  applyGate.resolve({ revision: 12, marks: [{ globalIndex: 13, word: 'remote' }] })
  await tick()
  assert.deepEqual(applying, [{ globalIndex: 13, word: 'remote' }], 'restoration callback must receive remote marks')
  assert.equal(applyingHarness.tracker.deferLocalChange('applying'), true, 'hydration must remain pending while annotation sync is unresolved')
  syncGate.resolve()
  await applyingPromise
  assert.deepEqual(applyingHarness.localSubmissions, [], 'programmatic restoration events must not trigger local saves')
  assert.equal(applyingHarness.tracker.deferLocalChange('applying'), false, 'completed hydration must release event deferral')

  const jobRequests = []
  const jobGates = new Map()
  youtubeWorkflowClient.getReaderMarks = (jobId) => {
    const pending = deferred()
    jobRequests.push(jobId)
    jobGates.set(jobId, pending)
    return pending.promise
  }
  const switched = createHarness({ jobId: 'job-a' })
  const aPromise = switched.tracker.startReaderMarksHydration('job-a')
  switched.setJobId('job-b')
  const bPromise = switched.tracker.startReaderMarksHydration('job-b')
  jobGates.get('job-a').resolve({ revision: 21, marks: [{ globalIndex: 21, word: 'A' }] })
  await aPromise
  assert.deepEqual(switched.visibleMarks, [], 'a stale response must not replace the active job marks')
  jobGates.get('job-b').resolve({ revision: 22, marks: [{ globalIndex: 22, word: 'B' }] })
  await bPromise
  assert.deepEqual(switched.visibleMarks, [[{ globalIndex: 22, word: 'B' }]], 'the active job response must still be applied')
  assert.deepEqual(switched.revisions, [{ id: 'job-a', revision: 21 }, { id: 'job-b', revision: 22 }], 'stale-job revisions must still be remembered')
  switched.setJobId('job-a')
  assert.strictEqual(switched.tracker.startReaderMarksHydration('job-a'), aPromise, 'returning to a job must reuse its original hydration record')
  assert.deepEqual(jobRequests, ['job-a', 'job-b'], 'job switching must not re-request a completed job')

  let failureMode = 'reject'
  youtubeWorkflowClient.getReaderMarks = async () => {
    if (failureMode === 'reject') throw new Error('marks GET failed')
    if (failureMode === 'invalid') return { revision: -1, marks: null }
    return { revision: 1.5, marks: [{ globalIndex: 31, word: 'remote' }] }
  }
  const failed = createHarness({ jobId: 'failed', marks: pendingMarks })
  const failedPromise = failed.tracker.startReaderMarksHydration('failed')
  failed.setMarks(localEdit)
  failed.tracker.deferLocalChange('failed')
  await failedPromise
  assert.deepEqual(failed.localSubmissions, ['marks', 'activity'], 'GET failures must still release the local compensating save')
  assert.equal(failed.tracker.deferLocalChange('failed'), false)

  failureMode = 'invalid'
  const invalid = createHarness({ jobId: 'invalid', marks: pendingMarks })
  const invalidPromise = invalid.tracker.startReaderMarksHydration('invalid')
  invalid.setMarks(localEdit)
  invalid.tracker.deferLocalChange('invalid')
  await invalidPromise
  assert.deepEqual(invalid.visibleMarks, [], 'invalid marks must not be applied')
  assert.deepEqual(invalid.localSubmissions, ['marks', 'activity'], 'invalid marks must still preserve the local compensating save')
  assert.deepEqual(invalid.revisions, [], 'negative revisions must not be remembered')

  failureMode = 'fractional'
  const fractional = createHarness({ jobId: 'fractional' })
  await fractional.tracker.startReaderMarksHydration('fractional')
  assert.deepEqual(fractional.visibleMarks, [[{ globalIndex: 31, word: 'remote' }]], 'valid marks remain restorable with an illegal revision')
  assert.deepEqual(fractional.revisions, [], 'fractional revisions must not be remembered')

  youtubeWorkflowClient.getReaderMarks = async () => ({ revision: 30, marks: [{ globalIndex: 32, word: 'remote' }] })
  const restoreFailure = createHarness({
    jobId: 'restore-failure',
    restoreVisibleMarks: () => { throw new Error('visible restore failed') },
  })
  await restoreFailure.tracker.startReaderMarksHydration('restore-failure')
  assert.equal(restoreFailure.tracker.deferLocalChange('restore-failure'), false, 'restore failures must still finish the pending record')
  assert.deepEqual(restoreFailure.localSubmissions, [], 'restore failure without local edits must not submit unrelated changes')
} finally {
  youtubeWorkflowClient.getReaderMarks = originalGetReaderMarks
  console.warn = originalWarn
}

assert.equal(warnings.length >= 2, true, 'best-effort failures must remain diagnosable')
console.log('reader marks hydration check passed')
