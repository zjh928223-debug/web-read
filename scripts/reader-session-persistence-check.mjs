import assert from 'node:assert/strict'
import fs from 'node:fs/promises'

const applicationSource = await fs.readFile(new URL('../src/services/persistence/application-persistence.js', import.meta.url), 'utf8')
const applicationUrl = `data:text/javascript;base64,${Buffer.from(applicationSource).toString('base64')}`
const adapterSource = (await fs.readFile(new URL('../src/services/persistence/reader-session-persistence.js', import.meta.url), 'utf8'))
  .replace("'./application-persistence.js'", `'${applicationUrl}'`)
const { createReaderSessionPersistence } = await import(
  `data:text/javascript;base64,${Buffer.from(adapterSource).toString('base64')}`
)

const fake = createAtomicIndexedDb()
const persistence = createReaderSessionPersistence({ indexedDBApi: fake.indexedDBApi })
const oldSession = fixture('old-content', 'revision-old')
await persistence.commit(oldSession)
assertConsistent(fake.rows, oldSession)
assert.deepEqual(await persistence.loadCommitted(), { status: 'committed', session: oldSession })

fake.manualCompletion = true
const nextSession = fixture('next-content', 'revision-next')
let settled = false
const pendingCommit = persistence.commit(nextSession).then(() => { settled = true })
await tick()
await tick()
assert.equal(settled, false, 'request success must not report session commit before tx.oncomplete')
assertConsistent(fake.rows, oldSession)
fake.completeNext()
await pendingCommit
assert.equal(settled, true)
assertConsistent(fake.rows, nextSession)

const mismatched = structuredClone(fake.rows.get('chunkData'))
mismatched.revision = 'foreign-revision'
fake.rows.set('chunkData', mismatched)
const inconsistent = await persistence.loadCommitted()
assert.equal(inconsistent.status, 'inconsistent')
assert.equal(inconsistent.error.code, 'READER_SESSION_INCONSISTENT')
fake.rows.set('chunkData', {
  ...mismatched,
  revision: nextSession.revision,
})

fake.manualCompletion = false
fake.failNextAtPut = 3
const quotaSession = fixture('quota-content', 'revision-quota')
await assert.rejects(
  persistence.commit(quotaSession),
  (error) => error.name === 'ApplicationPersistenceError'
    && (error.code === 'REQUEST_FAILED' || error.code === 'TRANSACTION_FAILED'),
)
assertConsistent(fake.rows, nextSession)

fake.abortNext = true
const abortedSession = fixture('aborted-content', 'revision-aborted')
await assert.rejects(persistence.commit(abortedSession), { code: 'TRANSACTION_ABORTED' })
assertConsistent(fake.rows, nextSession)

assert.equal(fake.schema.name, 'SeekPlayerDB')
assert.equal(fake.schema.version, 1)
assert.equal(fake.schema.store, 'files')
assert.equal(fake.schema.keyPath, 'id')
assert.equal('clear' in persistence, false)

console.log('reader session persistence check passed')

function fixture(contentId, revision) {
  return {
    contentId,
    revision,
    audioMeta: { jobId: contentId, streamUrl: `http://workflow.test/${contentId}/audio` },
    transcript: { segments: [{ words: [{ word: contentId }] }] },
    chunkData: { s: [{ chunks: [{ en: contentId }] }] },
  }
}

function assertConsistent(rows, expected) {
  for (const id of ['audioMeta', 'transcript', 'chunkData', 'readerSession']) {
    const row = rows.get(id)
    assert.equal(row.revision, expected.revision, `${id} revision must match the committed session`)
    assert.equal(row.contentId, expected.contentId, `${id} contentId must match the committed session`)
  }
  assert.deepEqual(rows.get('audioMeta').content, expected.audioMeta)
  assert.deepEqual(rows.get('transcript').content, expected.transcript)
  assert.deepEqual(rows.get('chunkData').content, expected.chunkData)
  assert.equal(rows.get('readerSession').content.schemaVersion, 1)
}

function tick() { return new Promise((resolve) => setTimeout(resolve, 0)) }

function createAtomicIndexedDb() {
  const rows = new Map()
  const pending = []
  const control = {
    abortNext: false,
    failNextAtPut: 0,
    manualCompletion: false,
  }
  const database = {
    version: 1,
    objectStoreNames: { contains: (name) => name === 'files' },
    close() {},
    transaction(_stores, mode) {
      const staged = new Map(rows)
      let puts = 0
      const transaction = {
        error: null,
        oncomplete: null,
        onabort: null,
        onerror: null,
        aborted: false,
        objectStore() {
          return {
            keyPath: 'id',
            get(id) {
              const request = { result: undefined, error: null, onsuccess: null, onerror: null }
              queueMicrotask(() => {
                request.result = staged.has(id) ? structuredClone(staged.get(id)) : undefined
                request.onsuccess?.()
              })
              return request
            },
            put(value) {
              puts += 1
              const putIndex = puts
              const request = { result: value.id, error: null, onsuccess: null, onerror: null }
              queueMicrotask(() => {
                if (transaction.aborted) return
                if (control.failNextAtPut === putIndex) {
                  control.failNextAtPut = 0
                  request.error = Object.assign(new Error('quota exceeded'), { name: 'QuotaExceededError' })
                  transaction.error = request.error
                  request.onerror?.()
                  transaction.onerror?.()
                  return
                }
                staged.set(value.id, structuredClone(value))
                request.onsuccess?.()
              })
              return request
            },
          }
        },
        abort() {
          if (this.aborted) return
          this.aborted = true
          queueMicrotask(() => this.onabort?.())
        },
      }
      queueMicrotask(() => queueMicrotask(() => {
          if (transaction.aborted || transaction.error) return
          if (mode === 'readwrite' && control.abortNext) {
            control.abortNext = false
            transaction.abort()
            return
          }
          const complete = () => {
            if (transaction.aborted || transaction.error) return
            if (mode === 'readwrite') {
              rows.clear()
              for (const [key, value] of staged) rows.set(key, value)
            }
            transaction.oncomplete?.()
          }
          if (mode === 'readwrite' && control.manualCompletion) pending.push(complete)
          else complete()
        }))
      return transaction
    },
  }
  const indexedDBApi = {
    open(name, version) {
      const request = { result: database, error: null, onsuccess: null, onerror: null, onblocked: null, onupgradeneeded: null }
      queueMicrotask(() => request.onsuccess?.())
      return request
    },
  }
  return {
    rows,
    indexedDBApi,
    schema: { name: 'SeekPlayerDB', version: 1, store: 'files', keyPath: 'id' },
    completeNext() { pending.shift()?.() },
    get manualCompletion() { return control.manualCompletion },
    set manualCompletion(value) { control.manualCompletion = value },
    set failNextAtPut(value) { control.failNextAtPut = value },
    set abortNext(value) { control.abortNext = value },
  }
}
