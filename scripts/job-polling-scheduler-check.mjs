import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { registerHooks } from 'node:module'

const moduleSource = readFileSync(
  new URL('../src/services/workflow/job-polling-scheduler.js', import.meta.url),
  'utf8',
)
const { createJobPollingScheduler } = await import(
  `data:text/javascript;base64,${Buffer.from(moduleSource).toString('base64')}`
)

const clock = createManualClock()
let resolveFetch
let activeFetches = 0
let maxActiveFetches = 0
const scheduler = createJobPollingScheduler({
  fetchJobs(ids) {
    assert.deepEqual(ids, ['job-a', 'job-b'])
    activeFetches += 1
    maxActiveFetches = Math.max(maxActiveFetches, activeFetches)
    return new Promise((resolve) => {
      resolveFetch = (jobs) => {
        activeFetches -= 1
        resolve(jobs)
      }
    })
  },
  setTimeout: clock.setTimeout,
  clearTimeout: clock.clearTimeout,
  intervalMs: 1000,
})

scheduler.start(['job-a', 'job-b'])
assert.equal(clock.pendingCount(), 1)
clock.runNext()
assert.equal(clock.pendingCount(), 0, 'next timeout is not scheduled while fetch is in flight')
scheduler.start(['job-a', 'job-b'])
assert.equal(clock.pendingCount(), 0, 'restarting during fetch must not schedule overlapping work')
assert.equal(maxActiveFetches, 1)
resolveFetch([])
await tick()
assert.equal(clock.pendingCount(), 1)

const observed = []
const errors = []
const guardClock = createManualClock()
let hidden = false
const guardScheduler = createJobPollingScheduler({
  async fetchJobs(ids, signal) {
    assert.deepEqual(ids, ['job-a', 'job-b'])
    assert.equal(signal.aborted, false)
    const next = fetchQueue.shift()
    if (next instanceof Error) throw next
    return next
  },
  onJobs(jobs) { observed.push(jobs.map((job) => `${job.id}:${job.revision}`)) },
  onError(error) { errors.push(error.message) },
  isHidden: () => hidden,
  setTimeout: guardClock.setTimeout,
  clearTimeout: guardClock.clearTimeout,
  intervalMs: 1000,
  hiddenIntervalMs: 5000,
})
const fetchQueue = [
  [
    { id: 'job-a', revision: 2, updatedAt: '2026-08-12T02:00:00.000Z' },
    { id: 'job-b', updatedAt: '2026-08-12T03:00:00.000Z' },
  ],
  [
    { id: 'job-a', revision: 1, updatedAt: '2026-08-12T04:00:00.000Z' },
    { id: 'job-b', updatedAt: '2026-08-12T02:00:00.000Z' },
  ],
  new Error('network down'),
]

guardScheduler.start(['job-a', 'job-b', 'job-a'])
assert.equal(guardClock.nextDelay(), 1000)
await guardClock.runNextAndSettle()
assert.deepEqual(observed, [['job-a:2', 'job-b:undefined']])
hidden = true
assert.equal(guardClock.nextDelay(), 1000)
await guardClock.runNextAndSettle()
assert.deepEqual(observed, [['job-a:2', 'job-b:undefined']], 'stale snapshots must be ignored')
assert.equal(guardClock.nextDelay(), 5000)
await guardClock.runNextAndSettle()
assert.deepEqual(errors, ['network down'])

const abortClock = createManualClock()
let inFlightSignal
let settleAbortFetch
const abortScheduler = createJobPollingScheduler({
  fetchJobs(_ids, signal) {
    inFlightSignal = signal
    return new Promise((resolve) => { settleAbortFetch = resolve })
  },
  setTimeout: abortClock.setTimeout,
  clearTimeout: abortClock.clearTimeout,
})
abortScheduler.start(['job-a'])
abortClock.runNext()
await tick()
abortScheduler.stop()
assert.equal(inFlightSignal.aborted, true)
settleAbortFetch([])
await tick()
assert.equal(abortClock.pendingCount(), 0)
abortScheduler.start(['job-a'])
abortScheduler.dispose()
assert.equal(abortClock.pendingCount(), 0)
assert.throws(() => abortScheduler.start(['job-a']), { code: 'JOB_POLLING_DISPOSED' })

// Exercise the real Panel library owner against controlled client/timer boundaries.
const esmRootUrl = new URL('../src/', import.meta.url).href
registerHooks({ load(url, context, nextLoad) {
  return nextLoad(url, url.startsWith(esmRootUrl) && url.endsWith('.js') ? { ...context, format: 'module' } : context)
} })
const { useWorkflowLibrary } = await import('../src/composables/use-workflow-library.js')
const savedGlobals = { window: globalThis.window, document: globalThis.document, setTimeout, clearTimeout }
const libraryClock = createManualClock()
globalThis.window = libraryClock
globalThis.document = { hidden: false }
globalThis.setTimeout = libraryClock.setTimeout
globalThis.clearTimeout = libraryClock.clearTimeout
const settleLibrary = async () => { for (let i = 0; i < 12; i += 1) await Promise.resolve() }
const owners = []
try {
  const reads = []
  let page = Array.from({ length: 20 }, (_, i) => ({ jobId: `row-${i}`, createdAt: new Date(i * 1000).toISOString() }))
  let snapshotCalls = 0
  let snapshotSignal, resolveSnapshot
  let ownerNotReady = false
  const client = {
    async readerRecent(query) {
      reads.push(query)
      if (ownerNotReady) throw Object.assign(new Error('starting'), { code: 'owner-not-ready' })
      return page
    },
    getJobsSnapshot(_ids, options) {
      snapshotCalls += 1
      snapshotSignal = options.signal
      return new Promise(resolve => { resolveSnapshot = resolve })
    },
  }
  const revisions = []
  const library = useWorkflowLibrary({ client, onRevision: value => revisions.push(value.revision), onRevisionUnavailable() {}, onJobsChanged() {}, canRetryLibrary: () => true, hasUntrustedMarksNotice: () => false })
  owners.push(library)
  await library.refreshLibrary()
  assert.deepEqual(reads[0], { limit: 20, offset: 0, timeScope: 'all' })
  assert.equal(library.recentJobs.value[0].jobId, 'row-19', 'initial rows retain newest-first order')
  assert.equal(library.libraryHasMore.value, true)
  page = [{ jobId: 'row-19', createdAt: new Date(19000).toISOString() }, { jobId: 'older', createdAt: '1970-01-01T00:00:00.000Z' }]
  await library.loadMoreLibrary()
  assert.equal(reads[1].offset, 20)
  assert.equal(library.recentJobs.value.length, 22)
  assert.equal(library.recentJobs.value.filter(row => row.jobId === 'row-19').length, 2, 'append keeps existing duplicate-response semantics')
  assert.equal(library.libraryHasMore.value, false)
  library.setLibraryTimeScope('week')
  await settleLibrary()
  assert.deepEqual(reads[2], { limit: 20, offset: 0, timeScope: 'week' })
  const firstSnapshot = library.requestWorkflowSnapshot(['active'])
  assert.equal(library.requestWorkflowSnapshot(['active']), firstSnapshot, 'polling and authority reads share one in-flight snapshot')
  assert.equal(snapshotCalls, 1)
  resolveSnapshot({ revision: 4, jobs: [{ jobId: 'active', status: 'queued', title: 'Kept title' }] })
  await firstSnapshot
  library.updateJob({ jobId: 'active', status: 'ready', title: '' })
  assert.equal(library.queueJobs.value[0].title, 'Kept title')
  assert.deepEqual(library.visibleCompletedJobIds.value, ['active'])
  assert.equal(library.completionSignal.value, true)
  assert.equal(libraryClock.nextDelay(), 5000)
  libraryClock.runNext()
  libraryClock.runNext()
  assert.deepEqual(library.visibleCompletedJobIds.value, [])
  assert.equal(library.completionSignal.value, false)
  libraryClock.runNext() // terminal transition restarts with no active jobs
  await settleLibrary()
  assert.equal(libraryClock.pendingCount(), 0)
  library.updateJob({ jobId: 'failed', status: 'failed' })
  library.updateJob({ jobId: 'canceled', status: 'canceled' })
  library.dispose()
  assert.equal(libraryClock.pendingCount(), 0, 'dispose releases terminal transition timers')

  const late = useWorkflowLibrary({ client, onRevision() {}, onRevisionUnavailable() {}, onJobsChanged() {}, canRetryLibrary: () => true, hasUntrustedMarksNotice: () => false })
  owners.push(late)
  ownerNotReady = true
  await late.refreshLibrary()
  assert.equal(libraryClock.nextDelay(), 750)
  libraryClock.runNext()
  await settleLibrary()
  assert.equal(libraryClock.pendingCount(), 0, 'owner startup performs only one automatic retry')
  assert.match(late.libraryNotice.value, /尚未就绪/)
  ownerNotReady = false
  late.updateJob({ jobId: 'in-flight', status: 'queued' })
  late.startPolling()
  assert.equal(libraryClock.nextDelay(), 2000)
  libraryClock.runNext()
  await settleLibrary()
  late.dispose()
  assert.equal(snapshotSignal.aborted, true)
  resolveSnapshot({ revision: 5, jobs: [{ jobId: 'in-flight', status: 'ready' }] })
  await settleLibrary()
  assert.equal(late.queueJobs.value[0].status, 'queued', 'late responses cannot rebuild disposed UI state')
  assert.equal(libraryClock.pendingCount(), 0, 'late completion cannot recreate polling or completion timers')
  assert.ok(revisions.includes(4))
} finally {
  owners.forEach(owner => owner.dispose())
  Object.assign(globalThis, savedGlobals)
}
console.log('JobPollingScheduler and workflow library owner checks passed.')

function tick() {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function createManualClock() {
  let sequence = 0
  const pending = new Map()
  return {
    setTimeout(callback, delay) {
      const id = ++sequence
      pending.set(id, { callback, delay })
      return id
    },
    clearTimeout(id) { pending.delete(id) },
    pendingCount() { return pending.size },
    nextDelay() { return pending.values().next().value?.delay ?? null },
    runNext() {
      const [id, task] = pending.entries().next().value
      pending.delete(id)
      return task.callback()
    },
    async runNextAndSettle() {
      await this.runNext()
      await tick()
    },
  }
}
