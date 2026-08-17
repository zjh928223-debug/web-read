import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const api = await loadModules(path.resolve(fileURLToPath(new URL('..', import.meta.url))))
const introducedAt = '2026-08-07T08:00:00.000Z'
const delayedAt = '2026-08-08T08:00:00.000Z'
const vocabularyRepository = api.createInMemoryVocabularyRepository()
const runner = api.createInMemoryVocabularyLearningUnitOfWorkRunner({ now: () => delayedAt })
const acquisitionRepository = createAcquisitionReader(runner.snapshot)
const acquisitionService = api.createVocabularyAcquisitionService({
  enabled: true,
  runUnitOfWork: runner.run,
  now: () => delayedAt,
})
const vocabularyService = api.createVocabularyService({
  repository: vocabularyRepository,
  scheduler: { createInitialReviewState() { throw new Error('legacy scheduler must not run') } },
  now: () => new Date(delayedAt),
  acquisitionEnabled: true,
  acquisitionRepository,
  acquisitionService,
})

const queued = await vocabularyService.queuePreviewVocabularyAcquisition({
  word: 'brain',
  lemma: 'brain',
  language: 'en',
  meaning: '脑',
  part_of_speech: 'noun',
  createdAt: introducedAt,
  target_id: 'ielts-preview:brain',
  acquisition_identity: {
    source_id: 'cambridge-04-21-reading',
    target_id: 'ielts-preview:brain',
  },
  context: {
    sentence: 'Learning a language produces changes in the brain.',
    surrounding_text: 'The study followed students over several years.',
    source_kind: 'user_local_exam_material',
    source_id: 'cambridge-04-21:b04-t2-reading-p1',
    source_title: '剑桥雅思本地阅读语料',
    source_locator: {
      locator_version: 'source-locator.v1',
      local_locator: 'book-4:test-2:passage-1:b04-t2-reading-p1',
    },
    license_kind: 'user_owned',
    ownership: 'private',
    quality_status: 'validated',
    quality_reason: 'local corpus',
  },
})

assert.equal(queued.acquisitionState.status, 'acquiring')
assert.equal((await vocabularyRepository.loadSnapshot()).reviewStates.length, 0)
const unitId = queued.learningUnit.learning_unit_id
const unit = await acquisitionRepository.getLearningUnit(unitId)
const state = await acquisitionRepository.getState(unitId)
assert.equal(state.validated_anchor_id !== null, true)

await acquisitionService.markReadyForCheck({
  command_id: `preview-check:${unitId}:ready`,
  correlation_id: `preview-check:${unitId}`,
  event_partition: '2026-08',
  payload: { learning_unit_id: unitId, occurred_at: delayedAt },
})
const attemptResult = await acquisitionService.recordAcquisitionAttempt({
  command_id: `preview-check:${unitId}:attempt-command`,
  correlation_id: `preview-check:${unitId}`,
  event_partition: '2026-08',
  payload: {
    attempt: {
      attempt_id: `preview-check:${unitId}:attempt`,
      learning_unit_id: unitId,
      target_sense_id: unit.target_sense_id,
      attempt_kind: 'delayed_check',
      episode_id: `preview-check:${unitId}:episode`,
      session_id: null,
      session_position: null,
      occurred_at: delayedAt,
      prompt_mode: 'original_context',
      cue_level: 'target_sentence',
      rating: 'good',
      answer_revealed_before_rating: false,
      context_evidence_id: state.validated_anchor_id,
      duration_ms: 1000,
      active_duration_ms: 1000,
      extensions: {},
    },
    event_id: `preview-check:${unitId}:attempt-event`,
  },
})
assert.equal(attemptResult.graduation_eligibility.eligible, true)

const graduation = await acquisitionService.graduateLearningUnit({
  command_id: `preview-check:${unitId}:graduate-command`,
  correlation_id: `preview-check:${unitId}`,
  event_partition: '2026-08',
  payload: {
    learning_unit_id: unitId,
    attempt_id: attemptResult.attempt_id,
    graduated_at: delayedAt,
    review_state_id: `vocabulary-review:${unitId}`,
    scheduler_version: 'fsrs.v1',
    scheduler_parameters_version: 'fsrs-parameters.v1',
    event_id: `preview-check:${unitId}:graduated-event`,
  },
})
assert.ok(graduation.review_state_id)
assert.equal((await acquisitionRepository.getState(unitId)).status, 'graduated')
assert.equal((await vocabularyRepository.loadSnapshot()).reviewStates.length, 0)
assert.equal(
  runner.snapshot().some((row) => row.id === 'vocabulary.review.store.v2'),
  true,
)

await runCoordinatorScenario(api)

console.log('Vocabulary preview acquisition graduation checks passed.')

async function runCoordinatorScenario(moduleApi) {
  const coordinatorNow = { value: new Date(delayedAt) }
  const repository = moduleApi.createInMemoryVocabularyRepository()
  const coordinatorRunner = moduleApi.createInMemoryVocabularyLearningUnitOfWorkRunner({
    now: () => delayedAt,
  })
  const coordinatorAcquisitionRepository = createAcquisitionReader(coordinatorRunner.snapshot)
  const coordinatorAcquisitionService = moduleApi.createVocabularyAcquisitionService({
    enabled: true,
    runUnitOfWork: coordinatorRunner.run,
    now: () => delayedAt,
  })
  const service = moduleApi.createVocabularyService({
    repository,
    scheduler: { createInitialReviewState() { throw new Error('legacy scheduler must not run') } },
    now: () => coordinatorNow.value,
    acquisitionEnabled: true,
    acquisitionRepository: coordinatorAcquisitionRepository,
    acquisitionService: coordinatorAcquisitionService,
  })
  const storage = createMemoryStorage()
  const coordinator = moduleApi.createPassagePreviewAcquisitionCoordinator({
    vocabularyService: service,
    storage,
    now: () => coordinatorNow.value,
  })
  const item = {
    id: 'ielts-reading:2026-08-07:brain',
    lemma: 'brain',
    word: 'brain',
    primaryMeaningZh: '脑',
    pos: 'noun',
    targetSenseKey: 'ielts-reading:brain:脑',
    previewContext: {
      sentence: 'Learning a language produces changes in the brain.',
      source_kind: 'user_local_exam_material',
      source_id: 'cambridge-test',
      source_title: '剑桥雅思本地阅读语料',
      source_locator: { locator_version: 'source-locator.v1', local_locator: 'book-4:test-2:p1' },
      license_kind: 'user_owned',
      ownership: 'private',
      quality_status: 'validated',
    },
  }
  const registered = await coordinator.registerItem(item, { introducedAt })
  assert.equal(registered.state.status, 'acquiring')
  assert.equal((await repository.loadSnapshot()).reviewStates.length, 0)
  storage.setItem('vocabulary.passage-preview.acquisition.v1', JSON.stringify({
    schemaVersion: 'passage-preview.acquisition.v1',
    records: [{
      ...registered.record,
      learningUnitId: 'orphan-local-only',
      previewItemId: 'orphan-preview',
      lemma: 'orphan',
      word: 'orphan',
    }],
  }))
  const rebuilt = await coordinator.rebuildRecords()
  assert.equal(rebuilt.some((record) => record.learningUnitId === 'orphan-local-only'), false)
  assert.equal(rebuilt.some((record) => record.learningUnitId === registered.record.learningUnitId), true)
  assert.deepEqual(await coordinator.getIntroducedLemmas(), ['brain'])
  const due = await coordinator.getDueChecks({ now: delayedAt })
  assert.equal(due.length, 1)
  const checked = await coordinator.recordDelayedCheck(due[0], {
    rating: 'good',
    occurredAt: delayedAt,
    durationMs: 1000,
    activeDurationMs: 1000,
  })
  assert.equal(checked.graduated, true)
  assert.equal((await coordinatorAcquisitionRepository.getState(registered.record.learningUnitId)).status, 'graduated')
}

function createAcquisitionReader(snapshotRows) {
  const readStore = () => snapshotRows().find((item) => item.id === 'vocabulary.acquisition.store.v1')?.content
    || { schema_version: 'acquisition-store.v1', by_learning_unit_id: {}, acquisition_attempts_by_id: {} }
  return {
    async loadSnapshot() { return readStore() },
    async getLearningUnit(id) { return readStore().by_learning_unit_id[id]?.learning_unit || null },
    async getState(id) { return readStore().by_learning_unit_id[id]?.acquisition_state || null },
    async findActiveByWordAndSense(wordId, targetSenseKey) {
      return Object.values(readStore().by_learning_unit_id)
        .map((pair) => pair.learning_unit)
        .find((candidate) => candidate.archived_at === null
          && candidate.word_id === wordId
          && candidate.target_sense_key === targetSenseKey) || null
    },
  }
}

function createMemoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial))
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null },
    setItem(key, value) { values.set(key, String(value)) },
    removeItem(key) { values.delete(key) },
  }
}

async function loadModules(repoRoot) {
  const sourceDir = path.join(repoRoot, 'src', 'services', 'vocabulary')
  const files = [
    'vocabulary-models.js',
    'vocabulary-repository.js',
    'vocabulary-persistence.js',
    'srs-scheduler.js',
    'vocabulary-learning-models.js',
    'vocabulary-acquisition-repository.js',
    'vocabulary-context-evidence.js',
    'vocabulary-learning-events.js',
    'vocabulary-learning-uow.js',
    'vocabulary-acquisition-service.js',
    'vocabulary-service.js',
  ]
  const tempDir = fs.mkdtempSync(path.join(repoRoot, `.tmp-vocabulary-preview-${process.pid}-`))
  try {
    files.forEach((file) => {
      const source = fs.readFileSync(path.join(sourceDir, file), 'utf8')
        .replace(/from '\.\/([^']+)\.js'/g, "from './$1.mjs'")
        .replace(/from \"\.\/([^\"]+)\.js\"/g, 'from "./$1.mjs"')
      fs.writeFileSync(path.join(tempDir, file.replace(/\.js$/u, '.mjs')), source)
    })
    const modules = await Promise.all(files.map((file) => import(
      `${pathToFileURL(path.join(tempDir, file.replace(/\.js$/u, '.mjs'))).href}?preview=${Date.now()}`
    )))
    const coordinatorSource = fs.readFileSync(
      path.join(repoRoot, 'src', 'features', 'passage-preview', 'passage-preview-acquisition.js'),
      'utf8',
    )
      .replace(/\.\.\/\.\.\/services\/vocabulary\/vocabulary-learning-models\.js/gu, './vocabulary-learning-models.mjs')
      .replace(/\.\.\/\.\.\/services\/vocabulary\/vocabulary-service\.js/gu, './vocabulary-service.mjs')
    const coordinatorPath = path.join(tempDir, 'passage-preview-acquisition.mjs')
    fs.writeFileSync(coordinatorPath, coordinatorSource)
    const coordinator = await import(`${pathToFileURL(coordinatorPath).href}?preview-coordinator=${Date.now()}`)
    return Object.assign({}, ...modules, coordinator)
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
}
