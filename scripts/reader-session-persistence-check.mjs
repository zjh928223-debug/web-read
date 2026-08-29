import assert from 'node:assert/strict'
import fs from 'node:fs/promises'

const applicationSource = (await fs.readFile(new URL('../src/services/persistence/application-persistence.js', import.meta.url), 'utf8'))
  .replace(
    "import { assertWindowsOwnerBrowserWriterAllowed } from '../windows-owner-domain-cutover.js'\n",
    'const assertWindowsOwnerBrowserWriterAllowed = () => {}\n',
  )
const applicationUrl = `data:text/javascript;base64,${Buffer.from(applicationSource).toString('base64')}`
const adapterSource = (await fs.readFile(new URL('../src/services/persistence/reader-session-persistence.js', import.meta.url), 'utf8'))
  .replace("'./application-persistence.js'", `'${applicationUrl}'`)
const { createReaderSessionPersistence } = await import(
  `data:text/javascript;base64,${Buffer.from(adapterSource).toString('base64')}`
)

const fake = createAtomicIndexedDb()
const persistence = createReaderSessionPersistence({ indexedDBApi: fake.indexedDBApi })
fake.rows.set('audioMeta', { id: 'audioMeta', content: { name: 'legacy-audio' } })
fake.rows.set('transcript', { id: 'transcript', content: { segments: [] } })
fake.rows.set('chunkData', { id: 'chunkData', content: { s: [] } })
const plainLegacyRows = cloneRows(fake.rows)
assert.deepEqual(
  await persistence.loadCommitted(),
  { status: 'legacy', session: null },
  'missing manifest is the only explicit legacy fallback signal',
)
assert.deepEqual(fake.rows, plainLegacyRows, 'plain legacy rows must remain untouched for the legacy restore path')
fake.rows.clear()
const oldSession = fixture('old-content', 'revision-old')
await persistence.commit(oldSession)
assertConsistent(fake.rows, oldSession)
assert.deepEqual(await persistence.loadCommitted(), { status: 'committed', session: oldSession })
assert.equal(fake.rows.get('readerSession').content.schemaVersion, 3, 'new commits must use the versioned reader-session envelope')
assert.match(fake.rows.get('readerSession').content.checksum, /^sha256:[a-f0-9]{64}$/)
assert.equal(fake.rows.get('readerSession').checksum, fake.rows.get('readerSession').content.checksum)

const currentV2Rows = cloneRows(fake.rows)
for (const id of ['audioMeta', 'transcript', 'chunkData', 'marks', 'readerSession']) {
  const legacyRow = structuredClone(fake.rows.get(id))
  delete legacyRow.checksum
  if (id === 'readerSession') {
    legacyRow.content.schemaVersion = 1
    delete legacyRow.content.checksum
  }
  fake.rows.set(id, legacyRow)
}
const { marks: _legacyMarks, ...legacyCompatibleSession } = oldSession
assert.deepEqual(
  await persistence.loadCommitted(),
  { status: 'committed', session: legacyCompatibleSession },
  'known v1 envelopes must remain readable without rewriting the source rows',
)
replaceRows(fake.rows, currentV2Rows)

fake.rows.get('readerSession').content.schemaVersion = 99
const unknownSourceRows = [...fake.rows].map(([, row]) => structuredClone(row))
const unknownRows = cloneRows(fake.rows)
const unknownSchema = await persistence.loadCommitted()
assert.equal(unknownSchema.status, 'unknown-schema')
assert.equal(unknownSchema.error.code, 'READER_SESSION_SCHEMA_UNSUPPORTED')
assert.equal(unknownSchema.error.schemaVersion, 99)
assert.match(unknownSchema.quarantine.id, /^readerSessionQuarantine:/)
assert.deepEqual(
  fake.rows.get(unknownSchema.quarantine.id).content.rows,
  unknownSourceRows,
  'unknown envelopes must be quarantined with their original values',
)
for (const [id, row] of unknownRows) {
  assert.deepEqual(fake.rows.get(id), row, `${id} source row must not be overwritten during quarantine`)
}
replaceRows(fake.rows, currentV2Rows)

const brokenManifest = structuredClone(fake.rows.get('readerSession'))
delete brokenManifest.content
fake.rows.set('readerSession', brokenManifest)
const unreadableManifest = await persistence.loadCommitted()
assert.equal(unreadableManifest.status, 'corrupt')
assert.equal(unreadableManifest.error.code, 'READER_SESSION_CORRUPT')
replaceRows(fake.rows, currentV2Rows)

const missingContent = structuredClone(fake.rows.get('chunkData'))
delete missingContent.content
fake.rows.set('chunkData', missingContent)
const malformedRow = await persistence.loadCommitted()
assert.equal(malformedRow.status, 'corrupt')
assert.equal(malformedRow.error.code, 'READER_SESSION_CORRUPT')
assert.match(malformedRow.quarantine.id, /^readerSessionQuarantine:/)
assert.equal(Object.prototype.hasOwnProperty.call(fake.rows.get('chunkData'), 'content'), false)
replaceRows(fake.rows, currentV2Rows)

fake.rows.set('unrelated-domain-row', { id: 'unrelated-domain-row', content: { keep: true } })
const tamperedTranscript = structuredClone(fake.rows.get('transcript'))
tamperedTranscript.content.segments[0].words[0].word = 'tampered-but-valid-shape'
fake.rows.set('transcript', tamperedTranscript)
const checksumMismatch = await persistence.loadCommitted()
assert.equal(checksumMismatch.status, 'corrupt')
assert.equal(checksumMismatch.error.code, 'READER_SESSION_CHECKSUM_MISMATCH')
assert.equal(checksumMismatch.error.expectedChecksum, currentV2Rows.get('readerSession').checksum)
assert.match(checksumMismatch.error.actualChecksum, /^sha256:[a-f0-9]{64}$/)
assert.match(checksumMismatch.quarantine.id, /^readerSessionQuarantine:/)
assert.equal(fake.rows.get('transcript').content.segments[0].words[0].word, 'tampered-but-valid-shape')
assert.deepEqual(fake.rows.get('unrelated-domain-row'), { id: 'unrelated-domain-row', content: { keep: true } })
const quarantineId = checksumMismatch.quarantine.id
const repeatedMismatch = await persistence.loadCommitted()
assert.equal(repeatedMismatch.quarantine.id, quarantineId, 're-reading the same corruption must reuse its quarantine record')
assert.equal([...fake.rows.keys()].filter((id) => id.startsWith('readerSessionQuarantine:')).length, 1)
replaceRows(fake.rows, currentV2Rows)

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
fake.manualCompletion = false

const mismatched = structuredClone(fake.rows.get('chunkData'))
mismatched.revision = 'foreign-revision'
fake.rows.set('chunkData', mismatched)
const inconsistent = await persistence.loadCommitted()
assert.equal(inconsistent.status, 'corrupt')
assert.equal(inconsistent.error.code, 'READER_SESSION_CORRUPT')
assert.match(inconsistent.quarantine.id, /^readerSessionQuarantine:/)
fake.rows.set('chunkData', {
  ...mismatched,
  revision: nextSession.revision,
})

const mismatchedManifest = structuredClone(fake.rows.get('readerSession'))
mismatchedManifest.content.revision = 'foreign-manifest-revision'
fake.rows.set('readerSession', mismatchedManifest)
const invalidManifest = await persistence.loadCommitted()
assert.equal(invalidManifest.status, 'corrupt')
assert.equal(invalidManifest.error.code, 'READER_SESSION_CORRUPT')
fake.rows.set('readerSession', {
  ...mismatchedManifest,
  content: {
    ...mismatchedManifest.content,
    revision: nextSession.revision,
  },
})

const corruptTranscript = structuredClone(fake.rows.get('transcript'))
corruptTranscript.content = { segments: 'not-an-array' }
fake.rows.set('transcript', corruptTranscript)
const invalidPayload = await persistence.loadCommitted()
assert.equal(invalidPayload.status, 'corrupt')
assert.equal(invalidPayload.error.code, 'READER_SESSION_CORRUPT')
fake.rows.set('transcript', {
  ...corruptTranscript,
  content: nextSession.transcript,
})

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

const abortable = createAtomicIndexedDb()
abortable.manualCompletion = true
const abortablePersistence = createReaderSessionPersistence({ indexedDBApi: abortable.indexedDBApi })
const abortController = new AbortController()
const abortCommit = abortablePersistence.commit(fixture('aborted-session', 'abort:1'), { signal: abortController.signal })
await tick()
abortController.abort('superseded reader session generation')
await assert.rejects(abortCommit, { code: 'TRANSACTION_ABORTED' })
assert.equal(abortable.rows.size, 0, 'aborted generation must not commit staged reader rows')

const casFake = createAtomicIndexedDb()
const firstTab = createReaderSessionPersistence({ indexedDBApi: casFake.indexedDBApi })
const secondTab = createReaderSessionPersistence({ indexedDBApi: casFake.indexedDBApi })
const baseSession = fixture('shared-content', 'shared:1')
await firstTab.commit(baseSession, { expectedRevision: null })
const winner = fixture('shared-content', 'shared:2')
const stale = fixture('shared-content', 'shared:stale')
await firstTab.commit(winner, { expectedRevision: 'shared:1' })
await assert.rejects(
  secondTab.commit(stale, { expectedRevision: 'shared:1' }),
  { code: 'REVISION_CONFLICT' },
  'a stale tab must not overwrite a newer committed reader session',
)
assertConsistent(casFake.rows, winner)

const repairFake = createAtomicIndexedDb()
const repairPersistence = createReaderSessionPersistence({ indexedDBApi: repairFake.indexedDBApi })
const corruptBase = fixture('corrupt-base', 'corrupt-base:1')
await repairPersistence.commit(corruptBase, { expectedRevision: null })
repairFake.rows.get('chunkData').revision = 'inconsistent-chunk-revision'
const corruptLoad = await repairPersistence.loadCommitted()
assert.equal(corruptLoad.status, 'corrupt')
assert.equal(await repairPersistence.loadCurrentRevision(), corruptBase.revision)
const repaired = fixture('repaired-content', 'repaired:1')
await repairPersistence.commit(repaired, { expectedRevision: corruptBase.revision })
assertConsistent(repairFake.rows, repaired)
assert.deepEqual(await repairPersistence.loadCommitted(), { status: 'committed', session: repaired })

console.log('reader session persistence check passed')

function fixture(contentId, revision) {
  return {
    contentId,
    revision,
    audioMeta: { jobId: contentId, streamUrl: `http://workflow.test/${contentId}/audio` },
    transcript: { segments: [{ words: [{ word: contentId }] }] },
    chunkData: { s: [{ chunks: [{ en: contentId }] }] },
    marks: [{ globalIndex: 0, word: contentId }],
  }
}

function assertConsistent(rows, expected) {
  const checksums = new Set()
  for (const id of ['audioMeta', 'transcript', 'chunkData', 'marks', 'readerSession']) {
    const row = rows.get(id)
    assert.equal(row.revision, expected.revision, `${id} revision must match the committed session`)
    assert.equal(row.contentId, expected.contentId, `${id} contentId must match the committed session`)
    assert.match(row.checksum, /^sha256:[a-f0-9]{64}$/)
    checksums.add(row.checksum)
  }
  assert.deepEqual(rows.get('audioMeta').content, expected.audioMeta)
  assert.deepEqual(rows.get('transcript').content, expected.transcript)
  assert.deepEqual(rows.get('chunkData').content, expected.chunkData)
  assert.deepEqual(rows.get('marks').content, expected.marks)
  assert.equal(rows.get('readerSession').content.schemaVersion, 3)
  assert.equal(rows.get('readerSession').content.checksum, rows.get('readerSession').checksum)
  assert.equal(checksums.size, 1, 'all committed rows must bind to the same session checksum')
}

function tick() { return new Promise((resolve) => setTimeout(resolve, 0)) }

function cloneRows(rows) {
  return new Map([...rows].map(([key, value]) => [key, structuredClone(value)]))
}

function replaceRows(target, source) {
  target.clear()
  for (const [key, value] of source) target.set(key, structuredClone(value))
}

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
      setTimeout(() => {
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
        }, 0)
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
