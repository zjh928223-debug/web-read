import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const root = path.resolve(import.meta.dirname, '..')
const api = await loadModules(root)

await runUowFaultScenarios(api)
console.log('Vocabulary learning UoW fault checks passed')

async function runUowFaultScenarios(modules) {
  const now = '2026-08-13T00:00:00.000Z'
  const current = acquisitionRow(modules, 3)
  const backup = acquisitionBackup(modules, current, 2)

  {
    const fake = createFakeIndexedDb({
      rows: [
        {
          ...current,
          content: { ...current.content, by_learning_unit_id: {} },
          checksum: `sha256:${'0'.repeat(64)}`,
        },
        backup,
      ],
    })
    let calls = 0
    const result = await modules.uow.runVocabularyLearningUnitOfWork(
      { indexedDBApi: fake.indexedDBApi, now: () => now },
      command('uow-corrupt-with-backup'),
      async (bound) => {
        calls += 1
        return bound.acquisition.getLearningUnit('uow-unit')
      },
    )
    assert.equal(result.learning_unit_id, 'uow-unit')
    assert.equal(calls, 2, 'corrupt UoW rows must recover and explicitly retry once')
    assert.ok(fake.rows.get(current.id).revision > current.revision)
    assert.ok([...fake.rows.values()].some((row) => row.id.startsWith('vocabulary.corrupt.quarantine.v1:')))
  }

  {
    const fake = createFakeIndexedDb({
      rows: [{
        ...current,
        content: { ...current.content, by_learning_unit_id: {} },
        checksum: `sha256:${'0'.repeat(64)}`,
      }],
    })
    await assert.rejects(
      modules.uow.runVocabularyLearningUnitOfWork(
        { indexedDBApi: fake.indexedDBApi, now: () => now },
        command('uow-corrupt-without-backup'),
        (bound) => bound.acquisition.getLearningUnit('uow-unit'),
      ),
      (error) => error?.code === 'CORRUPT',
    )
    assert.equal(fake.rows.get(current.id).revision, current.revision)
    assert.ok([...fake.rows.values()].some((row) => row.id.startsWith('vocabulary.corrupt.quarantine.v1:')))
  }

  {
    const unknownContent = {
      ...current.content,
      schema_version: 'acquisition-store.v99',
    }
    const unknownRow = {
      ...current,
      content: unknownContent,
      checksum: modules.persistence.checksumFor(unknownContent),
    }
    const fake = createFakeIndexedDb({ rows: [unknownRow] })
    await assert.rejects(
      modules.uow.runVocabularyLearningUnitOfWork(
        { indexedDBApi: fake.indexedDBApi, now: () => now },
        command('uow-unknown-schema'),
        (bound) => bound.acquisition.getLearningUnit('uow-unit'),
      ),
      (error) => error?.code === 'UNKNOWN_SCHEMA',
    )
    assert.deepEqual(fake.rows.get(current.id), unknownRow, 'unknown schema rows must remain unchanged')
  }

  {
    const fake = createFakeIndexedDb({ fault: 'quota' })
    await assert.rejects(
      modules.uow.runVocabularyLearningUnitOfWork(
        { indexedDBApi: fake.indexedDBApi, now: () => now },
        command('uow-quota'),
        (bound) => bound.review.putInitial(reviewState(now, 'uow-quota')),
      ),
      (error) => error?.code === 'QUOTA_EXCEEDED',
    )
  }

  {
    const fake = createFakeIndexedDb({ fault: 'connection-close' })
    await assert.rejects(
      modules.uow.runVocabularyLearningUnitOfWork(
        { indexedDBApi: fake.indexedDBApi, now: () => now },
        command('uow-connection-close'),
        (bound) => bound.review.putInitial(reviewState(now, 'uow-connection-close')),
      ),
      (error) => error?.code === 'CONNECTION_CLOSED',
    )
  }

  {
    const candidate = acquisitionRow(modules, 0)
    const fake = createFakeIndexedDb({ rows: [candidate] })
    await assert.rejects(
      modules.uow.runVocabularyLearningUnitOfWork(
        { indexedDBApi: fake.indexedDBApi, now: () => now },
        command('uow-revision-conflict'),
        async (bound) => {
          const state = await bound.acquisition.getState('uow-unit')
          return bound.acquisition.putState({ ...state, status: 'skipped', skipped_at: now }, 99)
        },
      ),
      (error) => error?.code === 'REVISION_CONFLICT',
    )
  }

  {
    const fake = createFakeIndexedDb({ upgrade: true })
    await assert.rejects(
      modules.uow.runVocabularyLearningUnitOfWork(
        { indexedDBApi: fake.indexedDBApi, now: () => now },
        command('uow-unknown-database'),
        async () => ({ ok: true }),
      ),
      (error) => error?.code === 'UNKNOWN_SCHEMA',
    )
  }
}

async function loadModules(root) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'read-web-vocabulary-uow-faults-'))
  const sources = [
    ['src/services/vocabulary/vocabulary-learning-models.js', 'vocabulary-learning-models.mjs'],
    ['src/services/vocabulary/vocabulary-persistence.js', 'vocabulary-persistence.mjs'],
    ['src/services/vocabulary/vocabulary-acquisition-repository.js', 'vocabulary-acquisition-repository.mjs'],
    ['src/services/vocabulary/vocabulary-context-evidence.js', 'vocabulary-context-evidence.mjs'],
    ['src/services/vocabulary/vocabulary-learning-events.js', 'vocabulary-learning-events.mjs'],
    ['src/services/vocabulary/vocabulary-learning-uow.js', 'vocabulary-learning-uow.mjs'],
  ]
  try {
    for (const [relativePath, stagedName] of sources) {
      let source = fs.readFileSync(path.join(root, relativePath), 'utf8')
      source = source.replaceAll(/from '(\.\/[^']+)\.js'/gu, "from '$1.mjs'")
      fs.writeFileSync(path.join(tempDir, stagedName), source)
    }
    const imported = await Promise.all(sources.map(([, stagedName]) => import(
      `${pathToFileURL(path.join(tempDir, stagedName)).href}?faults=1`
    )))
    return {
      models: imported[0],
      persistence: imported[1],
      uow: imported[5],
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
}

function command(id) {
  return {
    command_id: id,
    command_type: 'vocabulary_fault_probe',
    correlation_id: `${id}:correlation`,
    event_partition: '2026-08',
    payload: { id },
  }
}

function acquisitionRow(modules, revision) {
  const unit = modules.models.normalizeLearningUnit({
    learning_unit_id: 'uow-unit',
    word_id: 'uow-word',
    normalized_form: 'uow',
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
  const state = modules.models.normalizeAcquisitionState({
    learning_unit_id: 'uow-unit',
    status: 'candidate',
  })
  const content = {
    schema_version: 'acquisition-store.v1',
    by_learning_unit_id: {
      'uow-unit': { learning_unit: unit, acquisition_state: state },
    },
    acquisition_attempts_by_id: {},
  }
  return {
    id: 'vocabulary.acquisition.store.v1',
    content,
    revision,
    timestamp: '2026-08-13T00:00:00.000Z',
    checksum: modules.persistence.checksumFor(content),
  }
}

function acquisitionBackup(modules, row, revision) {
  const content = {
    schema_version: 'vocabulary-backup.v1',
    sourceId: row.id,
    sourceRow: { ...row, revision },
    createdAt: '2026-08-13T00:00:00.000Z',
  }
  return {
    id: `${row.id}.backup:${revision}`,
    content,
    revision,
    timestamp: '2026-08-13T00:00:00.000Z',
    checksum: modules.persistence.checksumFor(content),
  }
}

function reviewState(timestamp, suffix) {
  return {
    schema_version: 'review-state.v2',
    review_state_id: `review-${suffix}`,
    learning_unit_id: `learning-${suffix}`,
    word_id: `word-${suffix}`,
    state: 'new',
    due_at: timestamp,
    stability: 0,
    difficulty: 5,
    elapsed_days: 0,
    scheduled_days: 0,
    reps: 0,
    lapses: 0,
    learning_steps: 0,
    last_review_at: null,
    scheduler_version: 'fsrs.v1',
    scheduler_parameters_version: 'fsrs-parameters.v1',
    created_at: timestamp,
    updated_at: timestamp,
    revision: 0,
    extensions: {},
  }
}

function createFakeIndexedDb({ rows = [], fault = null, upgrade = false } = {}) {
  const state = { fault, upgrade }
  const storeRows = new Map(rows.map((row) => [row.id, structuredClone(row)]))

  function makeTransaction(mode) {
    const staged = new Map([...storeRows].map(([id, row]) => [id, structuredClone(row)]))
    let pending = 0
    let aborted = false
    let completed = false
    const transaction = {
      error: null,
      oncomplete: null,
      onabort: null,
      onerror: null,
      objectStore() {
        return {
          keyPath: 'id',
          get(id) { return request(() => staged.get(id)) },
          getAll() { return request(() => [...staged.values()]) },
          put(row) {
            return request(() => {
              if (state.fault === 'quota') {
                state.fault = null
                throw new DOMException('quota fixture', 'QuotaExceededError')
              }
              staged.set(row.id, structuredClone(row))
              if (state.fault === 'connection-close') {
                state.fault = null
                queueMicrotask(() => transaction.abort(new DOMException('closed fixture', 'InvalidStateError')))
              }
              return row.id
            })
          },
        }
      },
      abort(error = new DOMException('aborted fixture', 'AbortError')) {
        if (aborted || completed) return
        aborted = true
        transaction.error = error
        queueMicrotask(() => transaction.onabort?.({ target: transaction }))
      },
    }

    function request(operation) {
      pending += 1
      const result = { result: undefined, error: null, onsuccess: null, onerror: null }
      queueMicrotask(() => {
        if (aborted) {
          result.error = transaction.error
          result.onerror?.({ target: result })
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
      return result
    }

    function finish() {
      if (aborted || completed || pending !== 0) return
      queueMicrotask(() => {
        if (aborted || completed || pending !== 0) return
        completed = true
        if (mode === 'readwrite') {
          storeRows.clear()
          for (const [id, row] of staged) storeRows.set(id, row)
        }
        transaction.oncomplete?.({ target: transaction })
      })
    }
    return transaction
  }

  const database = {
    version: 1,
    objectStoreNames: { contains: (name) => name === 'files' },
    close() {},
    transaction(_storeNames, mode) {
      if (mode === 'readwrite' && state.fault === 'connection-close') {
        state.fault = null
        throw new DOMException('closed fixture', 'InvalidStateError')
      }
      return makeTransaction(mode)
    },
  }

  return {
    rows: storeRows,
    indexedDBApi: {
      open() {
        const request = {
          result: database,
          error: null,
          onupgradeneeded: null,
          onsuccess: null,
          onerror: null,
        }
        queueMicrotask(() => {
          if (state.upgrade) request.onupgradeneeded?.({ target: request })
          else request.onsuccess?.({ target: request })
        })
        return request
      },
    },
  }
}
