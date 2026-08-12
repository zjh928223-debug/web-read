import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

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

console.log('JobPollingScheduler checks passed.')

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
