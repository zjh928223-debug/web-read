import assert from 'node:assert/strict'
import fs from 'node:fs/promises'

const modelsSource = await fs.readFile(new URL('../src/services/vocabulary/vocabulary-models.js', import.meta.url), 'utf8')
const modelsUrl = `data:text/javascript;base64,${Buffer.from(modelsSource).toString('base64')}`
const repositorySource = (await fs.readFile(new URL('../src/services/vocabulary/srs-pending-candidates.js', import.meta.url), 'utf8'))
  .replace("'./vocabulary-models.js'", `'${modelsUrl}'`)
const { createIndexedDbSrsPendingCandidatesRepository } = await import(
  `data:text/javascript;base64,${Buffer.from(repositorySource).toString('base64')}#${Date.now()}`
)

const fake = createFakeIndexedDb()
const first = createIndexedDbSrsPendingCandidatesRepository({ indexedDBApi: fake.indexedDBApi })
const second = createIndexedDbSrsPendingCandidatesRepository({ indexedDBApi: fake.indexedDBApi })

await Promise.all([
  first.setPendingCandidates('scope-a', group('scope-a', 'alpha')),
  second.setPendingCandidates('scope-b', group('scope-b', 'beta')),
])
assert.deepEqual(Object.keys((await first.loadStore()).groups).sort(), ['scope-a', 'scope-b'])

fake.manualCompletion = true
let settled = false
const pending = first.setPendingCandidates('scope-c', group('scope-c', 'gamma')).then(() => { settled = true })
await tick()
assert.equal(settled, false, 'request success must remain pending until readwrite transaction completion')
fake.completePendingTransaction()
await pending

fake.failNextWrite = Object.assign(new Error('quota exceeded'), { name: 'QuotaExceededError' })
await assert.rejects(first.clearPendingCandidates('scope-a'), (error) => error.name === 'QuotaExceededError')
assert.ok(await first.getPendingCandidates('scope-a'))

fake.abortNextWrite = true
await assert.rejects(first.clearPendingCandidates('scope-a'), /aborted/i)
assert.ok(await first.getPendingCandidates('scope-a'))

fake.fireVersionChange()
await first.getPendingCandidates('scope-a')
assert.equal(fake.openCount, 3, 'repository must reopen its connection after versionchange')

console.log('SRS pending candidates transaction checks passed')

function group(scopeKey, lemma) {
  return {
    scopeKey,
    candidates: [{ target_id: `${scopeKey}:target`, lemma }],
    excluded: [],
    created_at: '2026-08-12T00:00:00.000Z',
  }
}

function tick() { return new Promise((resolve) => setTimeout(resolve, 0)) }

function createFakeIndexedDb() {
  const rows = new Map()
  const connections = new Set()
  const readwriteQueue = []
  let readwriteActive = false
  const control = { abortNextWrite: false, failNextWrite: null, manualCompletion: false, pendingComplete: null, openCount: 0 }
  const clone = (value) => value === undefined ? undefined : structuredClone(value)

  function startNextReadwrite() {
    if (readwriteActive || readwriteQueue.length === 0) return
    readwriteActive = true
    readwriteQueue.shift()()
  }

  function transaction(mode) {
    let staged = new Map(rows)
    let started = mode !== 'readwrite'
    let pending = 0
    let done = false
    const queued = []
    const tx = {
      error: null, oncomplete: null, onabort: null, onerror: null,
      objectStore() {
        return {
          get(id) { return request(() => clone(staged.get(id)), false) },
          put(row) { return request(() => { staged.set(row.id, clone(row)); return row.id }, true) },
        }
      },
      abort() { fail(new Error('transaction aborted'), true) },
    }

    function release() {
      if (mode === 'readwrite') { readwriteActive = false; startNextReadwrite() }
    }
    function fail(error, aborted = false) {
      if (done) return
      done = true
      tx.error = error
      queueMicrotask(() => {
        if (aborted) tx.onabort?.({ target: tx })
        else tx.onerror?.({ target: tx })
        release()
      })
    }
    function finishIfReady() {
      if (!started || pending || done) return
      if (mode === 'readwrite' && control.abortNextWrite) {
        control.abortNextWrite = false
        fail(new Error('transaction aborted'), true)
        return
      }
      const complete = () => {
        if (done) return
        done = true
        if (mode === 'readwrite') {
          rows.clear()
          for (const [key, value] of staged) rows.set(key, value)
        }
        tx.oncomplete?.({ target: tx })
        release()
      }
      if (mode === 'readwrite' && control.manualCompletion) control.pendingComplete = complete
      else queueMicrotask(complete)
    }
    function request(operation, write) {
      pending += 1
      const req = { result: undefined, error: null, onsuccess: null, onerror: null }
      const run = () => queueMicrotask(() => {
        if (write && control.failNextWrite) {
          const error = control.failNextWrite
          control.failNextWrite = null
          req.error = error
          tx.error = error
          req.onerror?.({ target: req })
          fail(error)
        } else if (!done) {
          req.result = operation()
          req.onsuccess?.({ target: req })
        }
        pending -= 1
        finishIfReady()
      })
      if (started) run(); else queued.push(run)
      return req
    }
    if (mode === 'readwrite') {
      readwriteQueue.push(() => {
        staged = new Map(rows)
        started = true
        queued.splice(0).forEach((run) => run())
        finishIfReady()
      })
      queueMicrotask(startNextReadwrite)
    } else queueMicrotask(finishIfReady)
    return tx
  }

  function connection() {
    const db = {
      version: 1,
      objectStoreNames: { contains: (name) => name === 'files' },
      onversionchange: null,
      close() { connections.delete(db) },
      transaction(_stores, mode) { return transaction(mode) },
    }
    connections.add(db)
    return db
  }

  return {
    indexedDBApi: {
      open() {
        control.openCount += 1
        const req = { result: connection(), error: null, onsuccess: null, onerror: null, onupgradeneeded: null }
        queueMicrotask(() => req.onsuccess?.({ target: req }))
        return req
      },
    },
    get abortNextWrite() { return control.abortNextWrite },
    set abortNextWrite(value) { control.abortNextWrite = value },
    get failNextWrite() { return control.failNextWrite },
    set failNextWrite(value) { control.failNextWrite = value },
    get manualCompletion() { return control.manualCompletion },
    set manualCompletion(value) { control.manualCompletion = value },
    get openCount() { return control.openCount },
    completePendingTransaction() {
      control.manualCompletion = false
      const complete = control.pendingComplete
      control.pendingComplete = null
      complete?.()
    },
    fireVersionChange() { for (const db of [...connections]) db.onversionchange?.() },
  }
}
