import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const repoRoot = path.resolve(import.meta.dirname, '..')
const loaded = await loadModules(repoRoot)

await runSnapshotScenarios(loaded)
await runMonotonicSnapshotCasScenario(loaded)
await runAcquisitionScenarios(loaded)
await runNoBackupQuarantineScenario(loaded)
await runQuarantineStructuredCloneScenarios(loaded)

console.log('Vocabulary persistence fault checks passed (checksum, quarantine, recovery, quota, close, schema)')

async function runSnapshotScenarios(api) {
  const fake = createFakeIndexedDb()
  const first = api.snapshot.createIndexedDbVocabularyRepository({
    indexedDBApi: fake.indexedDBApi,
    now: () => 1_700_000_000_000,
  })
  const second = api.snapshot.createIndexedDbVocabularyRepository({
    indexedDBApi: fake.indexedDBApi,
    now: () => 1_700_000_000_001,
  })

  await first.updateSnapshot((snapshot) => {
    snapshot.words.push(word('snapshot-alpha', 'alpha'))
    return 'alpha'
  })
  const firstRow = fake.rows.get('vocabulary.srs.store.v1')
  assert.match(firstRow.checksum, /^sha256:[a-f0-9]{64}$/u)
  assert.equal(firstRow.revision, 1)
  const firstWatermark = fake.rows.get(api.persistence.VOCABULARY_REVISION_WATERMARK_ROW_ID)
  assert.equal(firstWatermark.content.schema_version, api.persistence.VOCABULARY_REVISION_WATERMARK_SCHEMA)
  assert.equal(firstWatermark.revision, 1)
  assert.equal(firstWatermark.checksum, api.persistence.checksumFor(firstWatermark.content))

  await Promise.all([
    first.updateSnapshot((snapshot) => {
      snapshot.words.push(word('snapshot-beta', 'beta'))
      return 'beta'
    }),
    second.updateSnapshot((snapshot) => {
      snapshot.words.push(word('snapshot-gamma', 'gamma'))
      return 'gamma'
    }),
  ])
  assert.deepEqual(
    (await first.loadSnapshot()).words.map((entry) => entry.lemma).sort(),
    ['alpha', 'beta', 'gamma'],
    'CAS retries must retain both tab updates',
  )

  const committed = structuredClone(fake.rows.get('vocabulary.srs.store.v1'))
  const backupForRecovery = structuredClone(fake.rows.get(
    `vocabulary.srs.store.v1.backup:${committed.revision - 1}`,
  ))
  assert.ok(backupForRecovery, 'the damaged revision must have a valid immediately previous backup')
  fake.rows.set('vocabulary.srs.store.v1', {
    ...committed,
    content: { ...committed.content, words: [word('snapshot-corrupt', 'corrupt')] },
  })
  const corruptRow = structuredClone(fake.rows.get('vocabulary.srs.store.v1'))
  const recoveredFromCorruption = await first.loadSnapshot()
  const quarantined = [...fake.rows.values()].find((row) => (
    row.id.startsWith('vocabulary.corrupt.quarantine.v1:')
      && row.content?.sourceId === 'vocabulary.srs.store.v1'
  ))
  assert.ok(quarantined, 'checksum failures must leave typed quarantine evidence')
  assert.deepEqual(quarantined.content.sourceRow, corruptRow)
  assert.deepEqual(
    recoveredFromCorruption.words.map((entry) => entry.lemma).sort(),
    ['alpha', 'beta'],
    'a corrupt current snapshot must recover the previous valid backup',
  )
  const recoveredRow = fake.rows.get('vocabulary.srs.store.v1')
  const recoveredWatermark = fake.rows.get(api.persistence.VOCABULARY_REVISION_WATERMARK_ROW_ID)
  assert.ok(recoveredRow.revision > corruptRow.revision, 'recovery must advance past the damaged revision')
  assert.ok(recoveredRow.revision > backupForRecovery.revision, 'recovery must advance past the backup revision')
  assert.ok(recoveredRow.revision <= recoveredWatermark.revision)
  assert.equal(recoveredWatermark.checksum, api.persistence.checksumFor(recoveredWatermark.content))

  const beforeUnknown = structuredClone(fake.rows.get('vocabulary.srs.store.v1'))
  const unknownContent = { ...beforeUnknown.content, schemaVersion: 99 }
  fake.rows.set('vocabulary.srs.store.v1', {
    ...beforeUnknown,
    content: unknownContent,
    checksum: `sha256:${'0'.repeat(64)}`,
  })
  await assert.rejects(
    first.loadSnapshot(),
    (error) => error?.code === 'UNKNOWN_SCHEMA'
      && error.details.schemaVersion === 99,
  )
  assert.deepEqual(
    fake.rows.get('vocabulary.srs.store.v1'),
    { ...beforeUnknown, content: unknownContent, checksum: `sha256:${'0'.repeat(64)}` },
    'unknown schema must fail closed without rewriting the source row',
  )
  fake.rows.set('vocabulary.srs.store.v1', beforeUnknown)

  const canonicalBeforeWatermarkFault = structuredClone(fake.rows.get('vocabulary.srs.store.v1'))
  const validWatermark = structuredClone(fake.rows.get(api.persistence.VOCABULARY_REVISION_WATERMARK_ROW_ID))
  const unknownWatermarkContent = {
    ...validWatermark.content,
    schema_version: 'vocabulary-revision-watermark.v99',
  }
  fake.rows.set(api.persistence.VOCABULARY_REVISION_WATERMARK_ROW_ID, {
    ...validWatermark,
    content: unknownWatermarkContent,
    checksum: api.persistence.checksumFor(unknownWatermarkContent),
  })
  await assert.rejects(
    first.loadSnapshot(),
    (error) => error?.code === 'UNKNOWN_SCHEMA',
  )
  assert.deepEqual(fake.rows.get('vocabulary.srs.store.v1'), canonicalBeforeWatermarkFault)
  fake.rows.set(api.persistence.VOCABULARY_REVISION_WATERMARK_ROW_ID, {
    ...validWatermark,
    checksum: `sha256:${'0'.repeat(64)}`,
  })
  await assert.rejects(
    first.loadSnapshot(),
    (error) => error?.code === 'CORRUPT',
  )
  assert.deepEqual(fake.rows.get('vocabulary.srs.store.v1'), canonicalBeforeWatermarkFault)
  fake.rows.set(api.persistence.VOCABULARY_REVISION_WATERMARK_ROW_ID, validWatermark)

  fake.fault = 'quota'
  const snapshotBeforeQuota = await first.loadSnapshot()
  const watermarkBeforeQuota = structuredClone(fake.rows.get(api.persistence.VOCABULARY_REVISION_WATERMARK_ROW_ID))
  await assert.rejects(
    first.updateSnapshot((snapshot) => {
      snapshot.words.push(word('snapshot-quota', 'quota'))
      return 'quota'
    }),
    (error) => error?.code === 'QUOTA_EXCEEDED',
  )
  assert.deepEqual(
    await first.loadSnapshot(),
    snapshotBeforeQuota,
  )
  assert.equal(fake.rows.get('vocabulary.srs.store.v1').revision, beforeUnknown.revision)
  assert.deepEqual(fake.rows.get(api.persistence.VOCABULARY_REVISION_WATERMARK_ROW_ID), watermarkBeforeQuota)
  fake.fault = null

  const watermarkBeforeAbort = structuredClone(fake.rows.get(api.persistence.VOCABULARY_REVISION_WATERMARK_ROW_ID))
  fake.fault = 'abort-after-put'
  await assert.rejects(
    first.updateSnapshot((snapshot) => {
      snapshot.words.push(word('snapshot-close', 'close'))
      return 'close'
    }),
    (error) => error?.code === 'TRANSACTION_ABORTED' || error?.code === 'CONNECTION_CLOSED',
  )
  assert.equal(fake.rows.get('vocabulary.srs.store.v1').revision, beforeUnknown.revision)
  assert.deepEqual(fake.rows.get(api.persistence.VOCABULARY_REVISION_WATERMARK_ROW_ID), watermarkBeforeAbort)
  fake.fault = null

  fake.triggerVersionChange()
  await first.loadSnapshot()
  assert.ok(fake.openCalls.length >= 2, 'versionchange/page-close recovery must reopen the database')
}

async function runMonotonicSnapshotCasScenario(api) {
  const fake = createFakeIndexedDb()
  const seed = api.snapshot.createIndexedDbVocabularyRepository({ indexedDBApi: fake.indexedDBApi })
  await seed.updateSnapshot((snapshot) => {
    snapshot.words.push(word('monotonic-one', 'one'))
    return 'one'
  })
  await seed.updateSnapshot((snapshot) => {
    snapshot.words.push(word('monotonic-two', 'two'))
    return 'two'
  })
  await seed.updateSnapshot((snapshot) => {
    snapshot.words.push(word('monotonic-three', 'three'))
    return 'three'
  })

  const damagedRevisionThree = structuredClone(fake.rows.get('vocabulary.srs.store.v1'))
  const validBackupRevisionTwo = structuredClone(
    fake.rows.get('vocabulary.srs.store.v1.backup:2'),
  )
  assert.equal(damagedRevisionThree.revision, 3)
  assert.equal(validBackupRevisionTwo.revision, 2)

  // This owner has observed expectedRevision=2 and pauses before its CAS.
  fake.rows.set('vocabulary.srs.store.v1', structuredClone(validBackupRevisionTwo.content.sourceRow))
  const staleOwner = api.snapshot.createIndexedDbVocabularyRepository({ indexedDBApi: fake.indexedDBApi })
  let releaseStaleOwner
  let staleOwnerStarted
  const staleOwnerStart = new Promise((resolve) => { staleOwnerStarted = resolve })
  const gate = new Promise((resolve) => { releaseStaleOwner = resolve })
  let mutatorCalls = 0
  const staleWrite = staleOwner.updateSnapshot(async (snapshot) => {
    mutatorCalls += 1
    if (mutatorCalls === 1) {
      staleOwnerStarted()
      await gate
    }
    snapshot.words.push(word('monotonic-stale-owner', 'stale-owner'))
    return 'stale-owner'
  })
  await staleOwnerStart

  fake.rows.set('vocabulary.srs.store.v1', {
    ...damagedRevisionThree,
    content: { ...damagedRevisionThree.content, words: [word('monotonic-damaged', 'damaged')] },
    checksum: `sha256:${'0'.repeat(64)}`,
  })
  const recoveryOwner = api.snapshot.createIndexedDbVocabularyRepository({ indexedDBApi: fake.indexedDBApi })
  await recoveryOwner.loadSnapshot()
  const recovered = fake.rows.get('vocabulary.srs.store.v1')
  assert.ok(recovered.revision > 3, 'recovery must not reuse revision 2 or 3')
  await assert.rejects(
    staleOwner.compareAndSwap(
      { ...validBackupRevisionTwo.content.sourceRow.content },
      2,
    ),
    (error) => error?.code === 'REVISION_CONFLICT',
    'the old owner expectedRevision=2 must not CAS after recovery',
  )

  releaseStaleOwner()
  await staleWrite
  assert.equal(
    mutatorCalls,
    2,
    'an owner that observed revision 2 must lose its first CAS after recovery rather than ABA-success',
  )
  assert.ok(
    fake.rows.get('vocabulary.srs.store.v1').revision > recovered.revision,
    'the retried stale owner must commit after the recovery revision',
  )
}

async function runAcquisitionScenarios(api) {
  const concurrentFake = createFakeIndexedDb()
  const concurrentFirst = api.acquisition.createIndexedDbAcquisitionRepository({
    indexedDBApi: concurrentFake.indexedDBApi,
  })
  const concurrentSecond = api.acquisition.createIndexedDbAcquisitionRepository({
    indexedDBApi: concurrentFake.indexedDBApi,
  })
  const fake = createFakeIndexedDb()
  const repository = api.acquisition.createIndexedDbAcquisitionRepository({
    indexedDBApi: fake.indexedDBApi,
  })
  const unit = api.models.normalizeLearningUnit({
    learning_unit_id: 'fault-unit',
    word_id: 'fault-word',
    normalized_form: 'fault',
    language: 'en',
    target_sense_id: null,
    target_sense_key: null,
    target_sense: null,
    created_at: '2026-08-13T00:00:00.000Z',
    updated_at: '2026-08-13T00:00:00.000Z',
    archived_at: null,
    revision: 0,
    extensions: {},
  })
  const secondUnit = api.models.normalizeLearningUnit({
    ...unit,
    learning_unit_id: 'fault-unit-second',
    word_id: 'fault-word-second',
    normalized_form: 'fault-second',
  })
  await Promise.all([
    concurrentFirst.putLearningUnit(unit, null),
    concurrentSecond.putLearningUnit(secondUnit, null),
  ])
  assert.deepEqual(
    Object.keys(await concurrentFirst.loadSnapshot()).sort(),
    ['acquisition_attempts_by_id', 'by_learning_unit_id', 'schema_version'],
  )
  assert.deepEqual(
    Object.keys((await concurrentFirst.loadSnapshot()).by_learning_unit_id).sort(),
    ['fault-unit', 'fault-unit-second'],
    'concurrent acquisition repository instances must not lose either update',
  )
  await repository.putLearningUnit(unit, null)
  const initialRow = structuredClone(fake.rows.get('vocabulary.acquisition.store.v1'))
  assert.match(initialRow.checksum, /^sha256:[a-f0-9]{64}$/u)

  await repository.putLearningUnit({
    ...unit,
    updated_at: '2026-08-13T00:01:00.000Z',
  }, 0)
  const currentRow = structuredClone(fake.rows.get('vocabulary.acquisition.store.v1'))
  const acquisitionBackup = [...fake.rows.values()].find((row) => (
    row.id === 'vocabulary.acquisition.store.v1.backup:1'
  ))
  assert.ok(acquisitionBackup, 'acquisition updates must retain the previous valid row as a backup')
  assert.equal(acquisitionBackup.checksum, api.persistence.checksumFor(acquisitionBackup.content))
  fake.rows.set('vocabulary.acquisition.store.v1', {
    ...currentRow,
    content: { ...currentRow.content, by_learning_unit_id: {} },
  })
  const corruptRow = structuredClone(fake.rows.get('vocabulary.acquisition.store.v1'))
  const recovered = await repository.loadSnapshot()
  const quarantine = [...fake.rows.values()].find((row) => (
    row.id.startsWith('vocabulary.corrupt.quarantine.v1:')
      && row.content?.sourceId === 'vocabulary.acquisition.store.v1'
  ))
  assert.ok(quarantine)
  assert.deepEqual(quarantine.content.sourceRow, corruptRow)
  assert.deepEqual(
    Object.keys(recovered.by_learning_unit_id),
    ['fault-unit'],
    'acquisition repository must recover its previous valid row',
  )
  assert.match(fake.rows.get('vocabulary.acquisition.store.v1').checksum, /^sha256:[a-f0-9]{64}$/u)

  const recoveredRow = structuredClone(fake.rows.get('vocabulary.acquisition.store.v1'))
  const unknownContent = { ...recoveredRow.content, schema_version: 'acquisition-store.v99' }
  fake.rows.set('vocabulary.acquisition.store.v1', {
    ...recoveredRow,
    content: unknownContent,
    checksum: `sha256:${'0'.repeat(64)}`,
  })
  await assert.rejects(
    repository.loadSnapshot(),
    (error) => error?.code === 'UNSUPPORTED_SCHEMA_VERSION',
  )
  assert.deepEqual(fake.rows.get('vocabulary.acquisition.store.v1'), {
    ...recoveredRow,
    content: unknownContent,
    checksum: `sha256:${'0'.repeat(64)}`,
  })
  fake.rows.set('vocabulary.acquisition.store.v1', recoveredRow)

  const malformedContent = { ...recoveredRow.content, by_learning_unit_id: null }
  fake.rows.set('vocabulary.acquisition.store.v1', {
    ...recoveredRow,
    content: malformedContent,
    checksum: api.persistence.checksumFor(malformedContent),
  })
  assert.deepEqual(
    Object.keys((await repository.loadSnapshot()).by_learning_unit_id),
    ['fault-unit'],
  )
  assert.ok([...fake.rows.values()].some((row) => (
    row.id.startsWith('vocabulary.corrupt.quarantine.v1:')
      && row.content?.sourceId === 'vocabulary.acquisition.store.v1'
  )))
  fake.rows.set('vocabulary.acquisition.store.v1', recoveredRow)

  const malformedSnapshotFake = createFakeIndexedDb()
  const malformedSnapshotRepository = api.snapshot.createIndexedDbVocabularyRepository({
    indexedDBApi: malformedSnapshotFake.indexedDBApi,
  })
  const malformedSnapshot = {
    schemaVersion: 1,
    words: null,
    contexts: [],
    reviewStates: [],
    reviewLogs: [],
  }
  malformedSnapshotFake.rows.set('vocabulary.srs.store.v1', {
    id: 'vocabulary.srs.store.v1',
    content: malformedSnapshot,
    revision: 4,
    timestamp: '2026-08-13T00:02:30.000Z',
    checksum: api.persistence.checksumFor(malformedSnapshot),
  })
  await assert.rejects(
    malformedSnapshotRepository.loadSnapshot(),
    (error) => error?.code === 'CORRUPT',
  )
  assert.ok([...malformedSnapshotFake.rows.values()].some((row) => (
    row.id.startsWith('vocabulary.corrupt.quarantine.v1:')
      && row.content?.sourceId === 'vocabulary.srs.store.v1'
  )))

  fake.fault = 'quota'
  await assert.rejects(
    repository.putLearningUnit({
      ...unit,
      updated_at: '2026-08-13T00:02:00.000Z',
    }, 0),
    (error) => error?.code === 'QUOTA_EXCEEDED',
  )
  assert.equal(fake.rows.get('vocabulary.acquisition.store.v1').revision, recoveredRow.revision)
  fake.fault = null

  fake.fault = 'abort-after-put'
  await assert.rejects(
    repository.putLearningUnit({
      ...unit,
      updated_at: '2026-08-13T00:02:00.000Z',
    }, 0),
    (error) => error?.code === 'TRANSACTION_ABORTED' || error?.code === 'CONNECTION_CLOSED',
  )
  assert.equal(fake.rows.get('vocabulary.acquisition.store.v1').revision, recoveredRow.revision)
  fake.fault = null

  fake.triggerVersionChange()
  assert.deepEqual(
    Object.keys(await repository.loadSnapshot()),
    ['schema_version', 'by_learning_unit_id', 'acquisition_attempts_by_id'],
  )
  assert.ok(fake.openCalls.length >= 2, 'acquisition repository must reopen after connection invalidation')
}

async function runNoBackupQuarantineScenario(api) {
  const fake = createFakeIndexedDb()
  const repository = api.acquisition.createIndexedDbAcquisitionRepository({
    indexedDBApi: fake.indexedDBApi,
  })
  const corruptContent = {
    schema_version: 'acquisition-store.v1',
    by_learning_unit_id: null,
    acquisition_attempts_by_id: {},
  }
  const corruptRow = {
    id: 'vocabulary.acquisition.store.v1',
    content: corruptContent,
    timestamp: '2026-08-13T00:03:00.000Z',
    revision: 7,
    checksum: api.persistence.checksumFor(corruptContent),
  }
  fake.rows.set(corruptRow.id, corruptRow)

  await assert.rejects(
    repository.loadSnapshot(),
    (error) => error?.code === 'CORRUPT',
  )
  const quarantine = [...fake.rows.values()].find((row) => (
    row.id.startsWith('vocabulary.corrupt.quarantine.v1:')
      && row.content?.sourceId === corruptRow.id
  ))
  assert.ok(quarantine, 'corrupt rows without a backup must still leave typed quarantine evidence')
  assert.deepEqual(quarantine.content.sourceRow, corruptRow)
}

async function runQuarantineStructuredCloneScenarios(api) {
  const candidates = [
    undefined,
    {
      id: 'structured-clone-corrupt',
      content: {
        undefinedValue: undefined,
        dateValue: new Date('2026-08-13T00:00:00.000Z'),
        blobValue: new Blob(['secret-token'], { type: 'text/plain' }),
        bufferValue: new Uint8Array([1, 2, 3]).buffer,
      },
      timestamp: '2026-08-13T00:04:00.000Z',
    },
  ]
  for (const sourceRow of candidates) {
    const make = () => api.persistence.makeQuarantineRow({
      sourceId: 'vocabulary.structured-clone-corrupt',
      sourceRow,
      reason: 'checksum-mismatch',
      detectedAt: '2026-08-13T00:04:00.000Z',
    })
    assert.doesNotThrow(make, 'quarantine evidence must tolerate structured-clone values')
    const row = make()
    const sameRow = api.persistence.makeQuarantineRow({
      sourceId: 'vocabulary.structured-clone-corrupt',
      sourceRow: sourceRow === undefined ? undefined : structuredClone(sourceRow),
      reason: 'checksum-mismatch',
      detectedAt: '2030-01-01T00:00:00.000Z',
    })
    assert.equal(row.id, sameRow.id, 'quarantine evidence IDs must not depend on detection time')
    assert.equal(row.checksum, api.persistence.checksumFor(row.content))
    assert.doesNotMatch(JSON.stringify(row.content), /secret-token/u, 'typed fallback evidence must not leak blob data')
  }
}

async function loadModules(root) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'read-web-vocab-faults-'))
  const files = [
    ['src/services/vocabulary/vocabulary-persistence.js', 'vocabulary-persistence.mjs'],
    ['src/services/vocabulary/vocabulary-models.js', 'vocabulary-models.mjs'],
    ['src/services/vocabulary/vocabulary-repository.js', 'vocabulary-repository.mjs'],
    ['src/services/vocabulary/vocabulary-learning-models.js', 'vocabulary-learning-models.mjs'],
    ['src/services/vocabulary/vocabulary-acquisition-repository.js', 'vocabulary-acquisition-repository.mjs'],
  ]
  try {
    for (const [source, target] of files) {
      let contents = fs.readFileSync(path.join(root, source), 'utf8')
      contents = contents
        .replaceAll("'./vocabulary-persistence.js'", "'./vocabulary-persistence.mjs'")
        .replaceAll("'./vocabulary-models.js'", "'./vocabulary-models.mjs'")
        .replaceAll("'./vocabulary-learning-models.js'", "'./vocabulary-learning-models.mjs'")
      fs.writeFileSync(path.join(tempDir, target), contents)
    }
    const persistence = await import(pathToFileURL(path.join(tempDir, 'vocabulary-persistence.mjs')).href)
    const snapshot = await import(pathToFileURL(path.join(tempDir, 'vocabulary-repository.mjs')).href)
    const models = await import(pathToFileURL(path.join(tempDir, 'vocabulary-learning-models.mjs')).href)
    const acquisition = await import(pathToFileURL(path.join(tempDir, 'vocabulary-acquisition-repository.mjs')).href)
    return { persistence, snapshot, models, acquisition }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
}

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
    created_at: '2026-08-13T00:00:00.000Z',
    updated_at: '2026-08-13T00:00:00.000Z',
  }
}

function createFakeIndexedDb() {
  const rows = new Map()
  const openCalls = []
  const state = { fault: null, connections: [] }
  let readwriteQueue = Promise.resolve()

  function clone(value) {
    return value === undefined ? undefined : structuredClone(value)
  }

  function makeTransaction(mode) {
    let staged = mode === 'readwrite'
      ? null
      : new Map([...rows].map(([id, row]) => [id, clone(row)]))
    let pending = 0
    let done = false
    let aborted = false
    let completionScheduled = false
    let started = mode !== 'readwrite'
    const queuedRequests = []
    const previous = readwriteQueue
    let releaseQueue = () => {}
    if (mode === 'readwrite') {
      readwriteQueue = new Promise((resolve) => { releaseQueue = resolve })
      previous.then(() => {
        staged = new Map([...rows].map(([id, row]) => [id, clone(row)]))
        started = true
        queuedRequests.splice(0).forEach((run) => run())
        finish()
      })
    }
    const transaction = {
      error: null,
      oncomplete: null,
      onabort: null,
      onerror: null,
      objectStore() {
        return {
          keyPath: 'id',
          get(id) { return request(() => clone(staged.get(id))) },
          getAll() { return request(() => [...staged.values()].map(clone)) },
          put(row) {
            assert.equal(mode, 'readwrite')
            return request(() => {
              if (state.fault === 'quota') {
                state.fault = null
                throw new DOMException('quota fixture', 'QuotaExceededError')
              }
              staged.set(row.id, clone(row))
              if (state.fault === 'abort-after-put'
                && ['vocabulary.srs.store.v1', 'vocabulary.acquisition.store.v1'].includes(row.id)) {
                state.fault = null
                queueMicrotask(() => transaction.abort(new DOMException('closed fixture', 'InvalidStateError')))
              }
              return row.id
            })
          },
        }
      },
      abort(error = new DOMException('aborted fixture', 'AbortError')) {
        if (aborted) return
        aborted = true
        transaction.error = error
        queueMicrotask(() => transaction.onabort?.({ target: transaction }))
        releaseQueue()
      },
    }

    function request(operation) {
      pending += 1
      const result = { result: undefined, error: null, onsuccess: null, onerror: null }
      const run = () => queueMicrotask(() => {
        if (aborted) {
          pending -= 1
          return
        }
        try {
          result.result = operation()
          result.onsuccess?.({ target: result })
        } catch (error) {
          result.error = error
          result.onerror?.({ target: result })
          transaction.onerror?.({ target: transaction })
          transaction.abort(error)
        } finally {
          pending -= 1
          finish()
        }
      })
      if (!started) queuedRequests.push(run)
      else run()
      return result
    }

    function finish() {
      if (done || aborted || pending !== 0 || completionScheduled) return
      completionScheduled = true
      setTimeout(() => {
        completionScheduled = false
        if (done || aborted || pending !== 0) return
        done = true
        if (aborted) return
        if (mode === 'readwrite') {
          rows.clear()
          for (const [id, row] of staged) rows.set(id, row)
        }
        transaction.oncomplete?.({ target: transaction })
        releaseQueue()
      }, 0)
    }

    return transaction
  }

  function makeDatabase() {
    const database = {
      version: 1,
      objectStoreNames: { contains: (name) => name === 'files' },
      onversionchange: null,
      closed: false,
      close() { this.closed = true },
      transaction(_storeNames, mode) {
        if (this.closed) throw new DOMException('connection closed fixture', 'InvalidStateError')
        return makeTransaction(mode)
      },
    }
    state.connections.push(database)
    return database
  }

  return {
    rows,
    openCalls,
    indexedDBApi: {
      open(name, version) {
        assert.equal(name, 'SeekPlayerDB')
        assert.equal(version, 1)
        const database = makeDatabase()
        database.closed = false
        const request = { result: database, error: null, onsuccess: null, onerror: null, onupgradeneeded: null }
        openCalls.push([name, version])
        queueMicrotask(() => request.onsuccess?.({ target: request }))
        return request
      },
    },
    get fault() { return state.fault },
    set fault(value) { state.fault = value },
    triggerVersionChange() {
      for (const database of state.connections) {
        database.onversionchange?.({ target: database })
        database.closed = true
      }
    },
  }
}
