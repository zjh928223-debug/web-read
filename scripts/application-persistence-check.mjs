import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const moduleSource = readFileSync(
  new URL('../src/services/persistence/application-persistence.js', import.meta.url),
  'utf8',
)
const { createApplicationPersistence } = await import(
  `data:text/javascript;base64,${Buffer.from(moduleSource).toString('base64')}`
)

const fake = createFakeIndexedDb()
const persistence = createApplicationPersistence({
  indexedDBApi: fake.indexedDBApi,
  types: {
    session: {
      keyPrefix: 'reader.session:',
      validate(row) {
        return row?.schema === 'reader-session.v1'
      },
    },
  },
})

const row = {
  id: 'reader.session:current',
  schema: 'reader-session.v1',
  content: { contentId: 'fixture-1' },
}

await persistence.put('session', row)
assert.deepEqual(await persistence.get('session', row.id), row)
assert.equal(fake.openCalls.length, 1, 'one persistence instance must share one database open')
assert.equal(fake.completedTransactions, 2)

await assert.rejects(
  persistence.put('session', { id: 'other:current', schema: 'reader-session.v1' }),
  (error) => error.name === 'ApplicationPersistenceError' && error.code === 'INVALID_KEY',
)
await assert.rejects(
  persistence.get('unknown', 'reader.session:current'),
  (error) => error.name === 'ApplicationPersistenceError' && error.code === 'UNKNOWN_TYPE',
)

const deletesCompletedBeforeResolve = fake.completedTransactions
await persistence.deleteMany('session', [row.id, 'reader.session:missing'])
assert.equal(fake.completedTransactions, deletesCompletedBeforeResolve + 1)
assert.equal(await persistence.get('session', row.id), undefined)

const delayed = createFakeIndexedDb({ manualCompletion: true })
const delayedPersistence = createApplicationPersistence({
  indexedDBApi: delayed.indexedDBApi,
  types: { session: { keyPrefix: 'reader.session:', validate: () => true } },
})
let settled = false
const delayedPut = delayedPersistence.put('session', row).then(() => { settled = true })
await tick()
await tick()
assert.equal(settled, false, 'request success must not resolve before transaction completion')
delayed.completeNextTransaction()
await delayedPut
assert.equal(settled, true)

const recoverable = createFakeIndexedDb({ failOpenCount: 1 })
const recoverablePersistence = createApplicationPersistence({
  indexedDBApi: recoverable.indexedDBApi,
  types: { session: { keyPrefix: 'reader.session:', validate: () => true } },
})
await assert.rejects(recoverablePersistence.get('session', row.id), { code: 'OPEN_FAILED' })
assert.equal(await recoverablePersistence.get('session', row.id), undefined)
assert.equal(recoverable.openCalls.length, 2, 'a rejected shared open promise must reset')

const blocked = createFakeIndexedDb({ blockedOpenCount: 1 })
const blockedPersistence = createApplicationPersistence({
  indexedDBApi: blocked.indexedDBApi,
  types: { session: { keyPrefix: 'reader.session:', validate: () => true } },
})
await assert.rejects(blockedPersistence.get('session', row.id), { code: 'OPEN_BLOCKED' })
assert.equal(await blockedPersistence.get('session', row.id), undefined)
assert.equal(blocked.openCalls.length, 2, 'a blocked shared open promise must reset')

fake.database.onversionchange?.()
assert.equal(fake.closeCalls, 1)
await persistence.get('session', row.id)
assert.equal(fake.openCalls.length, 2, 'versionchange must close and reset the shared connection')

assert.equal('clear' in persistence, false)
assert.equal('runTransaction' in persistence, false)

console.log('ApplicationPersistence checks passed.')

function tick() {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function createFakeIndexedDb(options = {}) {
  const rows = new Map()
  const openCalls = []
  const pendingTransactions = []
  const state = {
    blockedOpenCount: options.blockedOpenCount ?? 0,
    closeCalls: 0,
    completedTransactions: 0,
    failOpenCount: options.failOpenCount ?? 0,
  }

  const database = {
    version: 1,
    objectStoreNames: { contains: (name) => name === 'files' },
    onversionchange: null,
    close() { state.closeCalls += 1 },
    transaction(storeNames, mode) {
      assert.deepEqual(storeNames, ['files'])
      const transaction = {
        mode,
        oncomplete: null,
        onabort: null,
        onerror: null,
        aborted: false,
        pending: 0,
        objectStore(name) {
          assert.equal(name, 'files')
          return {
            keyPath: 'id',
            get(key) {
              return request(() => structuredClone(rows.get(key)))
            },
            put(value) {
              return request(() => {
                rows.set(value.id, structuredClone(value))
                return value.id
              })
            },
            delete(key) {
              return request(() => rows.delete(key))
            },
          }
        },
        abort() {
          this.aborted = true
          queueMicrotask(() => this.onabort?.({ target: this }))
        },
      }

      function request(execute) {
        transaction.pending += 1
        const result = { result: undefined, error: null, onsuccess: null, onerror: null }
        queueMicrotask(() => {
          if (transaction.aborted) return
          try {
            result.result = execute()
            result.onsuccess?.({ target: result })
          } catch (error) {
            result.error = error
            result.onerror?.({ target: result })
            transaction.onerror?.({ target: transaction })
            return
          }
          transaction.pending -= 1
          if (transaction.pending === 0) {
            const complete = () => {
              if (transaction.aborted || transaction.pending !== 0) return
              state.completedTransactions += 1
              transaction.oncomplete?.({ target: transaction })
            }
            if (options.manualCompletion) pendingTransactions.push(complete)
            else queueMicrotask(complete)
          }
        })
        return result
      }

      return transaction
    },
  }

  const indexedDBApi = {
    open(name, version) {
      openCalls.push([name, version])
      const request = {
        result: database,
        error: null,
        transaction: null,
        onsuccess: null,
        onerror: null,
        onblocked: null,
        onupgradeneeded: null,
      }
      queueMicrotask(() => {
        if (state.blockedOpenCount > 0) {
          state.blockedOpenCount -= 1
          request.onblocked?.({ target: request })
        } else if (state.failOpenCount > 0) {
          state.failOpenCount -= 1
          request.error = new Error('open failed')
          request.onerror?.({ target: request })
        } else {
          request.onsuccess?.({ target: request })
        }
      })
      return request
    },
  }

  return {
    database,
    indexedDBApi,
    openCalls,
    completeNextTransaction() { pendingTransactions.shift()?.() },
    get closeCalls() { return state.closeCalls },
    get completedTransactions() { return state.completedTransactions },
  }
}
