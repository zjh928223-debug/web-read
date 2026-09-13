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

function clone(value) {
  return structuredClone(value)
}

function createHarness({
  jobId = 'job-a',
  marks = [],
  rememberMarksRevision,
  restoreVisibleMarks,
  submitLocalChanges,
} = {}) {
  let currentJobId = jobId
  let currentMarks = clone(marks)
  const revisions = []
  const visibleMarks = []
  const localSubmissions = []
  const harness = {
    setJobId(value) { currentJobId = value },
    setMarks(value) { currentMarks = clone(value) },
    getCurrentMarks() { return clone(currentMarks) },
    revisions,
    visibleMarks,
    localSubmissions,
  }
  harness.tracker = createReaderMarksHydration({
    getCurrentJobId: () => currentJobId,
    getCurrentReaderMarks: () => currentMarks,
    rememberMarksRevision: rememberMarksRevision || ((id, revision) => revisions.push({ id, revision })),
    restoreVisibleMarks: restoreVisibleMarks || ((value) => {
      currentMarks = clone(value)
      visibleMarks.push(clone(value))
    }),
    submitLocalChanges: submitLocalChanges || ((intent) => localSubmissions.push(clone(intent))),
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

  const remoteMarks = [
    { globalIndex: 3, word: 'remote', start: 3, sourceType: 'manual-mark' },
  ]
  const sessionMarks = [
    { globalIndex: 1, word: 'session', start: 1, sourceType: 'manual-mark' },
  ]
  youtubeWorkflowClient.getReaderMarks = async () => ({ revision: '7', marks: remoteMarks })
  const restoreOrder = []
  const applied = createHarness({
    jobId: 'restore',
    rememberMarksRevision: (id, revision) => restoreOrder.push(['remember', id, revision]),
    restoreVisibleMarks: (marks) => restoreOrder.push(['restore', clone(marks)]),
  })
  await applied.tracker.startReaderMarksHydration('restore')
  assert.deepEqual(applied.visibleMarks, [], 'the harness restore callback is intentionally observational')
  assert.deepEqual(restoreOrder, [
    ['restore', remoteMarks],
    ['remember', 'restore', 7],
  ], 'marks must be applied before their revision becomes the edit baseline')
  applied.setMarks(sessionMarks)
  await applied.tracker.handleProgrammaticRestore('restore')
  assert.deepEqual(restoreOrder.at(-1), ['restore', remoteMarks], 'late session restoration must be corrected back to authority')
  assert.equal(applied.tracker.getLocalIntent('restore'), null, 'restoration must not create local edit intent')
  assert.deepEqual(applied.localSubmissions, [], 'restoration must not submit marks')

  const pendingMarks = [
    { globalIndex: 1, word: 'keep', start: 1, sourceType: 'manual-mark' },
    { globalIndex: 2, word: 'remove', start: 2, sourceType: 'manual-mark' },
  ]
  const addedMark = { globalIndex: 9, word: 'added', start: 9, sourceType: 'manual-mark' }
  const addGate = deferred()
  youtubeWorkflowClient.getReaderMarks = () => addGate.promise
  const addSubmissions = []
  const adding = createHarness({
    jobId: 'add',
    submitLocalChanges: (intent) => addSubmissions.push(clone(intent)),
  })
  const addingPromise = adding.tracker.startReaderMarksHydration('add')
  adding.setMarks([addedMark])
  const addIntent = adding.tracker.recordLocalEdit('add', {
    marks: [addedMark],
    operation: { type: 'add', mark: addedMark },
  })
  assert.equal(addIntent.sourceRevision, null, 'an edit made before authority loads has no fabricated revision')
  assert.equal(adding.tracker.deferLocalChange('add'), true, 'pending hydration must defer an explicit edit')
  addGate.resolve({ revision: 8, marks: [remoteMarks[0]] })
  await addingPromise
  assert.deepEqual(adding.visibleMarks, [[remoteMarks[0], addedMark]], 'an add must replay on the latest authority')
  assert.deepEqual(addSubmissions[0].marks, [remoteMarks[0], addedMark])
  assert.equal(addSubmissions[0].sourceRevision, 8)
  assert.deepEqual(addSubmissions[0].operations.map(({ type, mark }) => ({ type, mark })), [{ type: 'add', mark: addedMark }])

  const removeGate = deferred()
  youtubeWorkflowClient.getReaderMarks = () => removeGate.promise
  const removeSubmissions = []
  const removing = createHarness({
    jobId: 'remove',
    marks: pendingMarks,
    submitLocalChanges: (intent) => removeSubmissions.push(clone(intent)),
  })
  const removingPromise = removing.tracker.startReaderMarksHydration('remove')
  removing.setMarks([pendingMarks[0]])
  removing.tracker.recordLocalEdit('remove', {
    marks: [pendingMarks[0]],
    operation: { type: 'remove', globalIndex: 2 },
  })
  removeGate.resolve({ revision: 9, marks: [...pendingMarks, { globalIndex: 4, word: 'remote-extra', start: 4, sourceType: 'manual-mark' }] })
  await removingPromise
  assert.deepEqual(removing.visibleMarks, [[
    pendingMarks[0],
    { globalIndex: 4, word: 'remote-extra', start: 4, sourceType: 'manual-mark' },
  ]], 'a delete must remove only its explicit target and preserve unrelated authority marks')
  assert.deepEqual(removeSubmissions[0].marks, removing.visibleMarks[0], 'the pending delete must submit the exact final set')

  youtubeWorkflowClient.getReaderMarks = async () => ({ revision: 10, marks: remoteMarks })
  const noEvent = createHarness({ jobId: 'no-event', marks: pendingMarks })
  const noEventPromise = noEvent.tracker.startReaderMarksHydration('no-event')
  noEvent.setMarks([{ globalIndex: 11, word: 'unclassified', start: 11, sourceType: 'manual-mark' }])
  await noEventPromise
  assert.deepEqual(noEvent.visibleMarks, [remoteMarks], 'an unclassified state mutation must not be guessed as a user edit')
  assert.deepEqual(noEvent.localSubmissions, [], 'an unclassified state mutation must not invent a save')

  const revertGate = deferred()
  youtubeWorkflowClient.getReaderMarks = () => revertGate.promise
  const revertedSubmissions = []
  const reverted = createHarness({
    jobId: 'reverted',
    marks: pendingMarks,
    submitLocalChanges: (intent) => revertedSubmissions.push(clone(intent)),
  })
  const revertedPromise = reverted.tracker.startReaderMarksHydration('reverted')
  const transientMarks = [{ globalIndex: 7, word: 'transient', start: 7, sourceType: 'manual-mark' }]
  reverted.setMarks(transientMarks)
  reverted.tracker.recordLocalEdit('reverted', {
    marks: transientMarks,
    operation: { type: 'replace', marks: transientMarks },
  })
  reverted.setMarks(pendingMarks)
  reverted.tracker.recordLocalEdit('reverted', {
    marks: pendingMarks,
    operation: { type: 'replace', marks: pendingMarks },
  })
  revertGate.resolve({ revision: 11, marks: remoteMarks })
  await revertedPromise
  assert.deepEqual(reverted.visibleMarks, [pendingMarks], 'A to B to A must preserve the explicit final edit')
  assert.deepEqual(revertedSubmissions[0].marks, pendingMarks, 'A to B to A must not be collapsed into a no-op against the old UI baseline')

  youtubeWorkflowClient.getReaderMarks = async () => ({ revision: 13, marks: remoteMarks })
  const rapid = createHarness({ jobId: 'rapid' })
  await rapid.tracker.startReaderMarksHydration('rapid')
  const rapidFirst = { globalIndex: 20, word: 'first', start: 20, sourceType: 'manual-mark' }
  const rapidSecond = { globalIndex: 21, word: 'second', start: 21, sourceType: 'manual-mark' }
  rapid.setMarks([...remoteMarks, rapidFirst])
  rapid.tracker.recordLocalEdit('rapid', {
    marks: [...remoteMarks, rapidFirst],
    operation: { type: 'add', mark: rapidFirst },
  })
  rapid.setMarks([...remoteMarks, rapidFirst, rapidSecond])
  rapid.tracker.recordLocalEdit('rapid', {
    marks: [...remoteMarks, rapidFirst, rapidSecond],
    operation: { type: 'add', mark: rapidSecond },
  })
  rapid.tracker.markLocalChangesSaved('rapid', [...remoteMarks, rapidFirst], 14, 1)
  const retainedRapidIntent = rapid.tracker.getLocalIntent('rapid')
  assert.deepEqual(retainedRapidIntent.marks, [...remoteMarks, rapidFirst, rapidSecond], 'a newer edit must survive completion of the first in-flight save')
  assert.equal(retainedRapidIntent.sourceRevision, 14, 'the newer edit must inherit the completed save revision')
  assert.deepEqual(retainedRapidIntent.operations.map(({ type, mark }) => ({ type, mark })), [{ type: 'add', mark: rapidSecond }])
  rapid.tracker.markLocalChangesSaved('rapid', retainedRapidIntent.marks, 15, 2)
  assert.equal(rapid.tracker.getLocalIntent('rapid'), null, 'the final in-flight edit must clear only after its own save succeeds')

  const sameVersion = createHarness({ jobId: 'same-version' })
  await sameVersion.tracker.startReaderMarksHydration('same-version')
  const staleSameVersion = [{ globalIndex: 30, word: 'stale', start: 30, sourceType: 'manual-mark' }]
  const currentSameVersion = [{ globalIndex: 30, word: 'current', start: 30, sourceType: 'manual-mark' }]
  sameVersion.setMarks(currentSameVersion)
  sameVersion.tracker.recordLocalEdit('same-version', {
    marks: currentSameVersion,
    operation: { type: 'replace', marks: currentSameVersion },
  })
  sameVersion.tracker.markLocalChangesSaved('same-version', staleSameVersion, 14, 1)
  assert.deepEqual(sameVersion.tracker.getLocalIntent('same-version').marks, currentSameVersion, 'a same-version cross-context stale completion must not replace newer content')
  assert.deepEqual(sameVersion.tracker.getLocalIntent('same-version').operations, [{
    type: 'replace',
    marks: currentSameVersion,
    version: 1,
  }], 'a same-version mismatch must retain the local operation for later reconciliation')

  const applyGate = deferred()
  const syncGate = deferred()
  youtubeWorkflowClient.getReaderMarks = () => applyGate.promise
  let applyingHarness = null
  let applying = null
  applyingHarness = createHarness({
    jobId: 'applying',
    restoreVisibleMarks: async (marks) => {
      applying = clone(marks)
      assert.equal(applyingHarness.tracker.deferLocalChange('applying'), true, 'events caused by restoration must stay deferred')
      assert.equal(applyingHarness.tracker.recordLocalEdit('applying', { marks }), null, 'restoration must not become an edit')
      await syncGate.promise
      assert.equal(applyingHarness.tracker.deferLocalChange('applying'), true, 'events during annotation sync must stay deferred')
    },
  })
  const applyingPromise = applyingHarness.tracker.startReaderMarksHydration('applying')
  applyGate.resolve({ revision: 12, marks: [{ globalIndex: 13, word: 'remote', start: 13, sourceType: 'manual-mark' }] })
  await tick()
  assert.deepEqual(applying, [{ globalIndex: 13, word: 'remote', start: 13, sourceType: 'manual-mark' }], 'restoration callback must receive remote marks')
  assert.equal(applyingHarness.tracker.deferLocalChange('applying'), true, 'hydration must remain pending while annotation sync is unresolved')
  syncGate.resolve()
  await applyingPromise
  assert.deepEqual(applyingHarness.localSubmissions, [], 'programmatic restoration events must not trigger local saves')
  assert.equal(applyingHarness.tracker.deferLocalChange('applying'), false, 'completed hydration must release event deferral')

  const jobGates = new Map()
  youtubeWorkflowClient.getReaderMarks = (jobId) => {
    const gate = deferred()
    jobGates.set(jobId, gate)
    return gate.promise
  }
  const switched = createHarness({ jobId: 'job-a' })
  const aPromise = switched.tracker.startReaderMarksHydration('job-a')
  switched.setJobId('job-b')
  const bPromise = switched.tracker.startReaderMarksHydration('job-b')
  jobGates.get('job-a').resolve({
    revision: 21,
    marks: [{ globalIndex: 0, word: 'JOB-A', start: 1, sourceType: 'manual-mark' }],
  })
  await aPromise
  assert.deepEqual(switched.visibleMarks, [], 'a stale response must not replace the active job marks')
  jobGates.get('job-b').resolve({
    revision: 22,
    marks: [{ globalIndex: 1, word: 'JOB-B', start: 1, sourceType: 'manual-mark' }],
  })
  await bPromise
  assert.deepEqual(switched.visibleMarks, [[{ globalIndex: 1, word: 'JOB-B', start: 1, sourceType: 'manual-mark' }]], 'the active job response must still be applied')
  assert.deepEqual(switched.revisions, [{ id: 'job-b', revision: 22 }], 'a revision is remembered only when its marks were applied')
  switched.setJobId('job-a')
  assert.strictEqual(switched.tracker.startReaderMarksHydration('job-a'), aPromise, 'returning to a job must reuse its original hydration record')

  youtubeWorkflowClient.getReaderMarks = async () => { throw new Error('marks GET failed') }
  const failed = createHarness({ jobId: 'failed' })
  await failed.tracker.startReaderMarksHydration('failed')
  assert.deepEqual(failed.localSubmissions, [], 'a failed GET without edits must not create a marks save')
  const offlineMarks = [{ globalIndex: 30, word: 'offline', start: 30, sourceType: 'manual-mark' }]
  failed.setMarks(offlineMarks)
  const offlineIntent = failed.tracker.recordLocalEdit('failed', {
    marks: offlineMarks,
    operation: { type: 'replace', marks: offlineMarks },
  })
  assert.deepEqual(offlineIntent.marks, offlineMarks, 'an offline edit remains available as local intent')
  assert.equal(offlineIntent.sourceRevision, null, 'offline intent must not fabricate a revision')
  assert.deepEqual(failed.localSubmissions, [], 'an offline edit without authority must wait for a trusted revision')
  failed.tracker.rememberAuthoritativeMarks('failed', remoteMarks, 40, { applied: true })
  await tick()
  assert.deepEqual(failed.visibleMarks, [offlineMarks], 'a recovered authority must replay the retained offline edit')
  assert.equal(failed.localSubmissions[0].sourceRevision, 40, 'the recovered edit must submit with the newly trusted revision')
  assert.deepEqual(failed.localSubmissions[0].marks, offlineMarks)

  youtubeWorkflowClient.getReaderMarks = async () => ({ revision: -1, marks: null })
  const invalid = createHarness({ jobId: 'invalid' })
  await invalid.tracker.startReaderMarksHydration('invalid')
  assert.deepEqual(invalid.visibleMarks, [], 'invalid marks must not be applied')
  assert.deepEqual(invalid.localSubmissions, [], 'invalid authority must not create a compensating save')
  assert.deepEqual(invalid.revisions, [], 'negative revisions must not be remembered')

  youtubeWorkflowClient.getReaderMarks = async () => ({ revision: 1.5, marks: remoteMarks })
  const fractional = createHarness({
    jobId: 'fractional',
    rememberMarksRevision: (id, revision) => {
      fractional.revisions.push({ id, revision })
    },
  })
  await fractional.tracker.startReaderMarksHydration('fractional')
  assert.deepEqual(fractional.visibleMarks, [remoteMarks], 'valid marks remain restorable with an illegal revision')
  assert.deepEqual(fractional.revisions, [], 'fractional revisions must not be remembered')

  youtubeWorkflowClient.getReaderMarks = async () => ({ revision: 30, marks: remoteMarks })
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
