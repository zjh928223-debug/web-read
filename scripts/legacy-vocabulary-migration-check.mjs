import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

async function loadModules(repoRoot) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'read-web-legacy-migration-'))
  const sources = [
    'src/services/vocabulary/vocabulary-models.js',
    'src/services/vocabulary/vocabulary-persistence.js',
    'src/services/vocabulary/vocabulary-repository.js',
    'src/services/vocabulary/vocabulary-learning-models.js',
    'src/services/vocabulary/vocabulary-acquisition-repository.js',
    'src/services/vocabulary/vocabulary-context-evidence.js',
    'src/services/vocabulary/vocabulary-learning-events.js',
    'src/services/vocabulary/vocabulary-learning-uow.js',
    'src/services/vocabulary/legacy-vocabulary-migration.js',
  ]
  const replacements = new Map(sources.map((source) => [
    path.basename(source), `${path.basename(source, '.js')}.mjs`,
  ]))
  try {
    for (const source of sources) {
      let content = fs.readFileSync(path.join(repoRoot, source), 'utf8')
      for (const [from, to] of replacements) content = content.replaceAll(from, to)
      fs.writeFileSync(path.join(tempDir, replacements.get(path.basename(source))), content)
    }
    const migration = await import(
      `${pathToFileURL(path.join(tempDir, replacements.get('legacy-vocabulary-migration.js'))).href}?migration=1`,
    )
    const vocabulary = await import(
      `${pathToFileURL(path.join(tempDir, replacements.get('vocabulary-repository.js'))).href}?migration=1`,
    )
    const uow = await import(
      `${pathToFileURL(path.join(tempDir, replacements.get('vocabulary-learning-uow.js'))).href}?migration=1`,
    )
    return { migration, vocabulary, uow }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
}

function oldWord(id, meaning, status = 'learning') {
  return {
    id,
    word: id,
    lemma: id,
    language: 'en',
    meaning,
    status,
    created_at: '2026-07-01T00:00:00.000Z',
    updated_at: '2026-07-20T00:00:00.000Z',
  }
}

function oldState(wordId, dueAt = '2026-08-01T00:00:00.000Z') {
  return {
    word_id: wordId,
    due_at: dueAt,
    stability: 3,
    difficulty: 6,
    elapsed_days: 2,
    scheduled_days: 3,
    reps: 4,
    lapses: 1,
    state: 'review',
    last_review_at: '2026-07-20T00:00:00.000Z',
    learning_steps: 0,
  }
}

async function main() {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const api = await loadModules(repoRoot)
  const legacySnapshot = {
    schemaVersion: 1,
    words: [
      oldWord('legacy-one', '第一含义'),
      oldWord('legacy-missing', null),
      oldWord('legacy-ignored', '忽略含义', 'ignored'),
    ],
    contexts: [{
      id: 'old-context-1',
      word_id: 'legacy-one',
      sentence: 'This is a short legacy sentence.',
      source_id: 'old-article',
      source_title: 'Old article',
      created_at: '2026-07-01T00:00:00.000Z',
    }],
    reviewStates: [
      oldState('legacy-one'),
      oldState('legacy-missing'),
      oldState('legacy-ignored'),
    ],
    reviewLogs: [],
  }
  const legacyRepository = api.vocabulary.createInMemoryVocabularyRepository(legacySnapshot)
  const runner = api.uow.createInMemoryVocabularyLearningUnitOfWorkRunner({
    now: () => '2026-08-09T00:00:00.000Z',
  })
  const acquisitionRepository = {
    async loadSnapshot() {
      const row = runner.snapshot().find((item) => item.id === 'vocabulary.acquisition.store.v1')
      return row?.content || {
        schema_version: 'acquisition-store.v1',
        by_learning_unit_id: {},
        acquisition_attempts_by_id: {},
      }
    },
  }
  const migration = api.migration.createLegacyVocabularyMigration({
    legacyRepository,
    acquisitionRepository,
    runUnitOfWork: runner.run,
    now: () => '2026-08-09T00:00:00.000Z',
  })

  const before = await migration.getStatus()
  assert.deepEqual(
    {
      eligible: before.eligible,
      migrated: before.migrated,
      remaining: before.remaining,
      pending_confirmation: before.pending_confirmation,
    },
    { eligible: 2, migrated: 0, remaining: 1, pending_confirmation: 1 },
  )

  const contextOnlyPlan = api.migration.buildLegacyVocabularyMigrationPlan({
    words: [oldWord('legacy-context-only', null)],
    contexts: [{
      id: 'context-only',
      word_id: 'legacy-context-only',
      sentence: 'A context supplies the meaning.',
      simple_meaning: '提供含义',
    }],
    reviewStates: [oldState('legacy-context-only')],
    reviewLogs: [],
  })
  assert.equal(contextOnlyPlan.ready.length, 1)
  assert.equal(contextOnlyPlan.ready[0].targetSense.source, 'legacy_context_meaning')

  const batch = await migration.migrateNextBatch({ batchSize: 10 })
  assert.equal(batch.results.length, 1)
  assert.equal(batch.results[0].status, 'migrated')
  assert.equal(batch.results[0].context_count, 1)
  assert.equal(batch.remaining, 0)
  assert.equal(batch.pending_confirmation, 1)

  const migratedIds = await migration.getMigratedWordIds()
  assert.deepEqual([...migratedIds], ['legacy-one'])

  const rows = runner.snapshot()
  const acquisitionRow = rows.find((item) => item.id === 'vocabulary.acquisition.store.v1')
  const unitId = 'legacy-migration:legacy-one'
  const pair = acquisitionRow.content.by_learning_unit_id[unitId]
  assert.equal(pair.learning_unit.extensions.legacy_migration.legacy_word_id, 'legacy-one')
  assert.equal(pair.acquisition_state.status, 'graduated')

  const reviewRow = rows.find((item) => item.id === 'vocabulary.review.store.v2')
  assert.equal(reviewRow.content.by_learning_unit_id[unitId].word_id, 'legacy-one')
  assert.equal(reviewRow.content.by_learning_unit_id[unitId].due_at, '2026-08-01T00:00:00.000Z')
  assert.equal(reviewRow.content.by_learning_unit_id[unitId].revision, 1)

  const eventManifest = rows.find((item) => item.id === 'vocabulary.learning-events.manifest.v1')
  const eventShardId = eventManifest.content.event_locations['legacy-migration:legacy-one:event']
  const eventShard = rows.find((item) => item.id === eventShardId)
  assert.equal(eventShard.content.events[0].event_type, 'legacy_reassessed')
  assert.equal(eventShard.content.events[0].is_legacy, true)
  assert.equal(eventShard.content.events[0].training_eligible, false)

  const secondRun = await migration.migrateNextBatch({ batchSize: 10 })
  assert.equal(secondRun.results.length, 0)
  assert.equal(secondRun.migrated, 1)

  const legacyService = {
    async getDueWords() {
      return [
        { word: { id: 'legacy-one' } },
        { word: { id: 'legacy-missing' } },
      ]
    },
    async reviewWord() {
      return { ok: true }
    },
  }
  const adapter = api.migration.createLegacyReviewServiceAdapter(legacyService, migration)
  const dueAfterMigration = await adapter.getDueWords()
  assert.deepEqual(dueAfterMigration.map((entry) => entry.word.id), ['legacy-missing'])

  console.log('Legacy vocabulary migration focused verification passed.')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
