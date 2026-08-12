import assert from 'node:assert/strict'
import fs from 'node:fs/promises'

const ledgerSource = await fs.readFile(
  new URL('../src/services/persistence/latest-wins-ledger.js', import.meta.url),
  'utf8',
)
const { createLatestWinsLedger } = await import(
  `data:text/javascript;base64,${Buffer.from(ledgerSource).toString('base64')}#${Date.now()}`
)

await verifyRapidLatestWins()
await verifyLateCompletionDoesNotFakeSaved()
await verifyFailureRetryKeepsLatestIntent()
console.log('latest-wins ledger checks passed')

async function verifyRapidLatestWins() {
  const writes = []
  const first = deferred()
  const ledger = createLatestWinsLedger({
    write(snapshot, context) {
      writes.push({ snapshot, context })
      return writes.length === 1 ? first.promise : Promise.resolve({ ok: true })
    },
  })

  const firstSequence = ledger.submit({ marks: [1] })
  await tick()
  const secondSequence = ledger.submit({ marks: [1, 2] })
  ledger.submit({ marks: [2] })
  assert.equal(writes.length, 1, 'only one write may be active')
  assert.ok(secondSequence > firstSequence, 'intent sequence must increase monotonically')
  assert.equal(ledger.getState().status, 'saving')
  assert.equal(ledger.getState().dirty, true)

  first.resolve({ ok: true })
  await tick()
  await tick()
  assert.equal(writes.length, 2, 'intermediate snapshots must coalesce to the latest pending value')
  assert.deepEqual(writes[1].snapshot, { marks: [2] })
  assert.equal(ledger.getState().status, 'saved')
  assert.equal(ledger.getState().dirty, false)
}

async function verifyLateCompletionDoesNotFakeSaved() {
  const first = deferred()
  const states = []
  const ledger = createLatestWinsLedger({
    write(_snapshot, context) {
      return context.sequence === 1 ? first.promise : Promise.resolve()
    },
    onStateChange(state) { states.push(state) },
  })
  ledger.submit({ position: 1 })
  await tick()
  ledger.submit({ position: 9 })
  first.resolve()
  await tick()
  assert.equal(
    states.some((state) => state.status === 'saved' && state.savedSequence === 1 && state.sequence === 2),
    false,
    'an older completion must not report the newer intent as saved',
  )
  await tick()
  assert.equal(ledger.getState().savedSequence, 2)
}

async function verifyFailureRetryKeepsLatestIntent() {
  const attempts = []
  let fail = true
  const ledger = createLatestWinsLedger({
    async write(snapshot, context) {
      attempts.push({ snapshot, context })
      if (fail) throw new Error('offline')
    },
  })
  const sequence = ledger.submit({ event: 'annotation', markCount: 3 })
  await tick()
  await tick()
  assert.equal(ledger.getState().status, 'error')
  assert.equal(ledger.getState().dirty, true)
  fail = false
  await ledger.retry()
  assert.equal(attempts.length, 2)
  assert.deepEqual(attempts[1].snapshot, attempts[0].snapshot)
  assert.equal(attempts[1].context.sequence, sequence)
  assert.equal(attempts[1].context.operationId, attempts[0].context.operationId)
  assert.equal(ledger.getState().status, 'saved')
  assert.equal(ledger.getState().dirty, false)
}

function deferred() {
  let resolve
  let reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

function tick() {
  return new Promise((resolve) => setTimeout(resolve, 0))
}
