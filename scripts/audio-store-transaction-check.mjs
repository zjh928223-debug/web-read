import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import vm from 'node:vm'
import { createPinia, setActivePinia } from 'pinia'

const pending = Symbol('pending')

class FakeRequest {
  constructor() {
    this.error = null
    this.onsuccess = null
    this.onerror = null
  }

  succeed() {
    this.onsuccess?.({ target: this })
  }

  fail(error = new Error('request failed')) {
    this.error = error
    this.onerror?.({ target: this })
  }
}

class FakeTransaction {
  constructor() {
    this.error = null
    this.oncomplete = null
    this.onerror = null
    this.onabort = null
    this.request = new FakeRequest()
    this.record = null
  }

  objectStore(name) {
    assert.equal(name, 'files')
    return {
      put: (record) => {
        this.record = record
        return this.request
      },
    }
  }

  complete() {
    this.oncomplete?.({ target: this })
  }

  fail(error = new Error('transaction failed')) {
    this.error = error
    this.onerror?.({ target: this })
  }

  abort(error = new Error('transaction aborted')) {
    this.error = error
    this.onabort?.({ target: this })
  }
}

class FakeDatabase {
  constructor() {
    this.transactions = []
  }

  transaction(storeNames, mode) {
    assert.deepEqual(Array.from(storeNames), ['files'])
    assert.equal(mode, 'readwrite')
    const transaction = new FakeTransaction()
    this.transactions.push(transaction)
    return transaction
  }
}

function observeSettlement(promise) {
  const state = { status: pending, value: undefined }
  Promise.resolve(promise).then(
    (value) => {
      state.status = 'fulfilled'
      state.value = value
    },
    (error) => {
      state.status = 'rejected'
      state.value = error
    },
  )
  return state
}

async function flushMicrotasks() {
  await Promise.resolve()
  await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 0))
}

/**
 * Reusable contract for the future ApplicationPersistence write Interface.
 *
 * createWriter receives a fresh fake database and returns a function with the
 * public shape `(key, value) => Promise<void>`.  The contract intentionally
 * observes transaction events rather than request success: IndexedDB can
 * accept a request and still abort the surrounding transaction later.
 */
export async function verifyTransactionWriterContract(createWriter) {
  {
    const database = new FakeDatabase()
    const write = await createWriter(database)
    const promise = write('transcript', { words: [] })
    assert.ok(promise && typeof promise.then === 'function', 'write must return a Promise')
    const settlement = observeSettlement(promise)
    const transaction = database.transactions[0]
    assert.ok(transaction, 'write must open one readwrite transaction')

    transaction.request.succeed()
    await flushMicrotasks()
    assert.equal(settlement.status, pending, 'request success must not resolve before transaction complete')

    transaction.complete()
    await flushMicrotasks()
    assert.equal(settlement.status, 'fulfilled', 'transaction complete must resolve the write')
  }

  {
    const database = new FakeDatabase()
    const write = await createWriter(database)
    const promise = write('marks', [])
    const settlement = observeSettlement(promise)
    database.transactions[0].request.fail(new Error('put rejected'))
    await flushMicrotasks()
    assert.equal(settlement.status, 'rejected', 'request error must reject the write')
  }

  {
    const database = new FakeDatabase()
    const write = await createWriter(database)
    const promise = write('audioMeta', { name: 'sample' })
    const settlement = observeSettlement(promise)
    database.transactions[0].fail(new Error('commit failed'))
    await flushMicrotasks()
    assert.equal(settlement.status, 'rejected', 'transaction error must reject the write')
  }

  {
    const database = new FakeDatabase()
    const write = await createWriter(database)
    const promise = write('audio', new Uint8Array([1]))
    const settlement = observeSettlement(promise)
    database.transactions[0].abort(new Error('quota abort'))
    await flushMicrotasks()
    assert.equal(settlement.status, 'rejected', 'transaction abort must reject the write')
  }
}

function installIndexedDbOpen(database) {
  globalThis.indexedDB = {
    open() {
      const request = new FakeRequest()
      queueMicrotask(() => {
        request.result = database
        request.onsuccess?.({ target: { result: database } })
      })
      return request
    },
  }
}

async function loadCurrentAudioStore(database) {
  installIndexedDbOpen(database)
  setActivePinia(createPinia())
  const moduleUrl = new URL('../src/pinia-stores/audio.js', import.meta.url)
  const piniaUrl = import.meta.resolve('pinia')
  const source = (await readFile(moduleUrl, 'utf8')).replace("from 'pinia'", `from '${piniaUrl}'`)
  const dataUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}#${Date.now()}`
  const { useAudioStore } = await import(dataUrl)
  const store = useAudioStore()
  await store.initDB()
  return store
}

async function verifyCurrentPiniaStoreContract() {
  await verifyTransactionWriterContract(async (database) => {
    const store = await loadCurrentAudioStore(database)
    return store.saveToDB.bind(store)
  })
}

async function createLegacyFacade(database) {
  const sourceUrl = new URL('../src/stores/audio.js', import.meta.url)
  const context = {
    Date,
    Error,
    Promise,
    indexedDB: {
      open() {
        const request = new FakeRequest()
        queueMicrotask(() => request.onsuccess?.({ target: { result: database } }))
        return request
      },
    },
    queueMicrotask,
    window: {},
  }
  vm.runInNewContext(await readFile(sourceUrl, 'utf8'), context, { filename: 'src/stores/audio.js' })
  await context.window.__audioStore.initDB()
  return context.window.saveToDB
}

async function verifyLegacyFacadeContract() {
  await verifyTransactionWriterContract(createLegacyFacade)
}

async function verifyReferenceWriterProvesHarness() {
  await verifyTransactionWriterContract((database) => (key, value) => new Promise((resolve, reject) => {
    const transaction = database.transaction(['files'], 'readwrite')
    const request = transaction.objectStore('files').put({ id: key, content: value })
    let settled = false
    const fail = (event) => {
      if (settled) return
      settled = true
      reject(event?.target?.error || transaction.error || request.error || new Error('IndexedDB write failed'))
    }
    request.onerror = fail
    transaction.onerror = fail
    transaction.onabort = fail
    transaction.oncomplete = () => {
      if (settled) return
      settled = true
      resolve()
    }
  }))
}

async function main() {
  await verifyReferenceWriterProvesHarness()
  await verifyCurrentPiniaStoreContract()
  await verifyLegacyFacadeContract()
  console.log('audio store transaction contract check passed')
}

const invokedUrl = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : ''
if (import.meta.url === invokedUrl) {
  main().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
