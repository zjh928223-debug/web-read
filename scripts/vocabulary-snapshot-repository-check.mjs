import assert from 'node:assert/strict'
import fs from 'node:fs/promises'

const modelsSource = await fs.readFile(new URL('../src/services/vocabulary/vocabulary-models.js', import.meta.url), 'utf8')
const modelsUrl = `data:text/javascript;base64,${Buffer.from(modelsSource).toString('base64')}`
const persistenceSource = await fs.readFile(new URL('../src/services/vocabulary/vocabulary-persistence.js', import.meta.url), 'utf8')
const persistenceUrl = `data:text/javascript;base64,${Buffer.from(persistenceSource).toString('base64')}`
const { checksumFor } = await import(persistenceUrl)
const repositorySource = (await fs.readFile(new URL('../src/services/vocabulary/vocabulary-repository.js', import.meta.url), 'utf8'))
  .replace("'./vocabulary-models.js'", `'${modelsUrl}'`)
  .replace("'./vocabulary-persistence.js'", `'${persistenceUrl}'`)
const { createIndexedDbVocabularyRepository } = await import(
  `data:text/javascript;base64,${Buffer.from(repositorySource).toString('base64')}`
)

const fake = createFakeIndexedDb()
const first = createIndexedDbVocabularyRepository({ indexedDBApi: fake.indexedDBApi })
const second = createIndexedDbVocabularyRepository({ indexedDBApi: fake.indexedDBApi })

await Promise.all([
  first.updateSnapshot((snapshot) => {
    snapshot.words.push(word('word-a', 'alpha'))
    return 'alpha-added'
  }),
  second.updateSnapshot((snapshot) => {
    snapshot.words.push(word('word-b', 'beta'))
    return 'beta-added'
  }),
])

const concurrentSnapshot = await first.loadSnapshot()
assert.deepEqual(
  concurrentSnapshot.words.map((entry) => entry.lemma).sort(),
  ['alpha', 'beta'],
  'two repository instances must not lose either concurrent snapshot update',
)
assert.equal(fake.rows.get('vocabulary.srs.store.v1').revision, 2)
assert.equal('saveSnapshot' in first, false, 'blind whole-snapshot writers must not remain public')

const beforeUnknown = structuredClone(fake.rows.get('vocabulary.srs.store.v1'))
const backupIdsBeforeUnknown = [...fake.rows.keys()]
  .filter((id) => id.startsWith('vocabulary.srs.store.v1.backup:'))
  .sort()
const unknownContent = { ...beforeUnknown.content, schemaVersion: 99 }
fake.rows.set('vocabulary.srs.store.v1', {
  ...beforeUnknown,
  content: unknownContent,
  checksum: checksumFor(unknownContent),
})
await assert.rejects(
  first.loadSnapshot(),
  (error) => error?.name === 'VocabularyPersistenceError'
    && error.code === 'UNKNOWN_SCHEMA'
    && error.details.schemaVersion === 99,
)
assert.deepEqual(
  [...fake.rows.keys()].filter((id) => id.startsWith('vocabulary.srs.store.v1.backup:')).sort(),
  backupIdsBeforeUnknown,
  'unknown schemas must be rejected without rewriting or migrating the row',
)
fake.rows.set('vocabulary.srs.store.v1', beforeUnknown)

const migrationFake = createFakeIndexedDb()
migrationFake.rows.set('vocabulary.srs.store.v1', {
  id: 'vocabulary.srs.store.v1',
  content: {
    words: [word('legacy-word', 'legacy')],
    contexts: [],
    reviewStates: [],
    reviewLogs: [],
  },
  timestamp: 1,
})
const migrating = createIndexedDbVocabularyRepository({
  indexedDBApi: migrationFake.indexedDBApi,
  now: () => 1786492800000,
})
const migrated = await migrating.loadSnapshot()
assert.equal(migrated.schemaVersion, 1)
assert.deepEqual(migrated.words.map((entry) => entry.lemma), ['legacy'])
const migratedRow = migrationFake.rows.get('vocabulary.srs.store.v1')
assert.equal(migratedRow.revision, 1)
assert.equal(migratedRow.content.schemaVersion, 1)
const backupRows = [...migrationFake.rows.values()].filter((row) => row.id.startsWith('vocabulary.srs.store.v1.backup:'))
assert.equal(backupRows.length, 1, 'migration must create exactly one source-row backup before replacement')
assert.deepEqual(backupRows[0].content.sourceRow.content, {
  words: [word('legacy-word', 'legacy')],
  contexts: [],
  reviewStates: [],
  reviewLogs: [],
})
assert.equal(backupRows[0].content.fromSchemaVersion, 0)
assert.equal(backupRows[0].content.toSchemaVersion, 1)

const concurrentMigrationFake = createFakeIndexedDb()
concurrentMigrationFake.rows.set('vocabulary.srs.store.v1', {
  id: 'vocabulary.srs.store.v1',
  content: { words: [], contexts: [], reviewStates: [], reviewLogs: [] },
  timestamp: 3,
})
const migrationA = createIndexedDbVocabularyRepository({ indexedDBApi: concurrentMigrationFake.indexedDBApi })
const migrationB = createIndexedDbVocabularyRepository({ indexedDBApi: concurrentMigrationFake.indexedDBApi })
const [migrationResultA, migrationResultB] = await Promise.all([
  migrationA.loadSnapshot(),
  migrationB.loadSnapshot(),
])
assert.equal(migrationResultA.schemaVersion, 1)
assert.equal(migrationResultB.schemaVersion, 1)
assert.equal(
  [...concurrentMigrationFake.rows.keys()].filter((id) => id.startsWith('vocabulary.srs.store.v1.backup:')).length,
  1,
  'concurrent migration attempts must converge on one pre-migration backup',
)

const failedMigrationFake = createFakeIndexedDb()
const failedSourceRow = {
  id: 'vocabulary.srs.store.v1',
  content: { words: [], contexts: [], reviewStates: [], reviewLogs: [] },
  timestamp: 2,
}
failedMigrationFake.rows.set(failedSourceRow.id, structuredClone(failedSourceRow))
const failingMigration = createIndexedDbVocabularyRepository({
  indexedDBApi: failedMigrationFake.indexedDBApi,
  migrationRegistry: new Map([[0, () => { throw new Error('migration rejected fixture') }]]),
})
await assert.rejects(failingMigration.loadSnapshot(), /migration rejected fixture/)
assert.deepEqual(failedMigrationFake.rows.get(failedSourceRow.id), failedSourceRow)
assert.equal([...failedMigrationFake.rows.keys()].some((id) => id.includes('.backup:')), false)

console.log('vocabulary snapshot repository check passed')

function word(id, lemma) {
  return {
    id,
    word: lemma,
    lemma,
    lookup_key: lemma,
    entry_type: 'word',
    language: 'en',
    status: 'new',
    tags: [],
    created_at: '2026-08-12T00:00:00.000Z',
    updated_at: '2026-08-12T00:00:00.000Z',
  }
}

function createFakeIndexedDb() {
  const rows = new Map()
  const readwriteQueue = []
  let readwriteActive = false

  function clone(value) {
    return value === undefined ? undefined : structuredClone(value)
  }

  function startNextReadwrite() {
    if (readwriteActive || readwriteQueue.length === 0) return
    readwriteActive = true
    readwriteQueue.shift()()
  }

  function transaction(mode) {
    let staged = new Map(rows)
    let started = mode !== 'readwrite'
    let pending = 0
    let completionQueued = false
    const queuedOperations = []
    const tx = {
      error: null,
      oncomplete: null,
      onabort: null,
      onerror: null,
      objectStore() {
        return {
          keyPath: 'id',
          get(id) { return request(() => clone(staged.get(id))) },
          put(row) {
            assert.equal(mode, 'readwrite')
            return request(() => {
              staged.set(row.id, clone(row))
              return row.id
            })
          },
        }
      },
      abort() {
        queueMicrotask(() => tx.onabort?.())
      },
    }

    function finishIfReady() {
      if (!started || pending !== 0 || completionQueued) return
      completionQueued = true
      queueMicrotask(() => {
        if (mode === 'readwrite') {
          rows.clear()
          for (const [key, value] of staged) rows.set(key, value)
        }
        tx.oncomplete?.()
        if (mode === 'readwrite') {
          readwriteActive = false
          startNextReadwrite()
        }
      })
    }

    function request(operation) {
      pending += 1
      const result = { result: undefined, error: null, onsuccess: null, onerror: null }
      const run = () => queueMicrotask(() => {
        try {
          result.result = operation()
          result.onsuccess?.()
        } catch (error) {
          result.error = error
          result.onerror?.()
          tx.onerror?.()
        } finally {
          pending -= 1
          finishIfReady()
        }
      })
      if (started) run()
      else queuedOperations.push(run)
      return result
    }

    if (mode === 'readwrite') {
      readwriteQueue.push(() => {
        staged = new Map(rows)
        started = true
        queuedOperations.splice(0).forEach((run) => run())
        finishIfReady()
      })
      setTimeout(startNextReadwrite, 0)
    } else {
      queueMicrotask(finishIfReady)
    }
    return tx
  }

  const database = {
    version: 1,
    objectStoreNames: { contains: (name) => name === 'files' },
    close() {},
    transaction(_stores, mode) { return transaction(mode) },
  }
  return {
    rows,
    indexedDBApi: {
      open(name, version) {
        assert.equal(name, 'SeekPlayerDB')
        assert.equal(version, 1)
        const request = { result: database, error: null, onsuccess: null, onerror: null, onupgradeneeded: null }
        queueMicrotask(() => request.onsuccess?.({ target: request }))
        return request
      },
    },
  }
}
