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
await runPreviewActivationScenario(api)

console.log('Vocabulary preview acquisition and unified review activation checks passed.')

async function runPreviewActivationScenario(moduleApi) {
  const now = '2026-08-08T08:00:00.000Z'
  const introducedAt = '2026-08-07T08:00:00.000Z'

  for (const [dueReviewCount, expectedLimit] of [[0, 5], [15, 5], [16, 2], [24, 2], [25, 0]]) {
    const fixture = await createActivationFixture(moduleApi, {
      dueReviewCount,
      count: 6,
      introducedAt,
      now,
    })
    const plan = await fixture.service.activatePendingPreviewLearning({
      now,
      timezone: 'UTC',
      local_day: '2026-08-08',
    })
    assert.equal(plan.due_review_count, dueReviewCount)
    assert.equal(plan.dailyLimit, expectedLimit)
    assert.equal(plan.activated.filter((item) => item.activated).length, expectedLimit)
    const snapshot = await fixture.acquisitionRepository.loadSnapshot()
    const graduated = Object.values(snapshot.by_learning_unit_id)
      .filter((pair) => pair.acquisition_state.status === 'graduated')
    assert.equal(graduated.length, expectedLimit)
    assert.equal(
      graduated.every((pair) => pair.acquisition_state.extensions.preview_activation.local_day === '2026-08-08'),
      true,
    )
    const reviewSnapshot = await fixture.reviewStateRepository.loadSnapshot()
    assert.equal(Object.keys(reviewSnapshot.by_learning_unit_id).length, expectedLimit)
    const activationEvents = fixture.runner.snapshot()
      .flatMap((row) => row.content?.events || [])
      .filter((event) => event.event_type === 'preview_learning_activated'
        && event.payload?.completion_basis === 'preview_capacity_activation')
    assert.equal(activationEvents.length, expectedLimit)
  }

  const dailyFixture = await createActivationFixture(moduleApi, {
    dueReviewCount: 0,
    count: 8,
    introducedAt,
    now,
  })
  const firstActivation = await dailyFixture.service.activatePendingPreviewLearning({
    now,
    timezone: 'UTC',
    local_day: '2026-08-08',
  })
  assert.equal(firstActivation.activated.filter((item) => item.activated).length, 5)
  const reopenedActivation = await dailyFixture.service.activatePendingPreviewLearning({
    now,
    timezone: 'UTC',
    local_day: '2026-08-08',
  })
  assert.equal(reopenedActivation.activated.length, 0)
  assert.equal(reopenedActivation.remainingDailyCapacity, 0)

  const restartedService = moduleApi.createVocabularyService({
    repository: dailyFixture.repository,
    scheduler: { createInitialReviewState() { throw new Error('legacy scheduler must not run') } },
    now: () => new Date(now),
    acquisitionEnabled: true,
    acquisitionRepository: dailyFixture.acquisitionRepository,
    acquisitionService: moduleApi.createVocabularyAcquisitionService({
      enabled: true,
      runUnitOfWork: dailyFixture.runner.run,
      now: () => now,
    }),
    reviewStateRepository: dailyFixture.reviewStateRepository,
  })
  const afterRestart = await restartedService.activatePendingPreviewLearning({
    now,
    timezone: 'UTC',
    local_day: '2026-08-08',
  })
  assert.equal(afterRestart.activated.length, 0)
  assert.equal(afterRestart.remainingDailyCapacity, 0)

  const exactBoundary = await createActivationFixture(moduleApi, {
    dueReviewCount: 0,
    count: 1,
    introducedAt,
    now,
    omitContext: true,
  })
  assert.equal(
    (await exactBoundary.acquisitionRepository.loadSnapshot()).by_learning_unit_id[exactBoundary.unitIds[0]]
      .acquisition_state.status,
    'introduced',
  )
  const exactBoundaryPlan = await exactBoundary.service.activatePendingPreviewLearning({
    now,
    timezone: 'UTC',
    local_day: '2026-08-08',
  })
  assert.equal(exactBoundaryPlan.activated.length, 1)
  assert.equal(exactBoundaryPlan.activated[0].activated, true)

  const fifoFixture = await createActivationFixture(moduleApi, {
    dueReviewCount: 0,
    count: 3,
    introducedAt: [
      '2026-08-07T08:00:00.000Z',
      '2026-08-05T08:00:00.000Z',
      '2026-08-06T08:00:00.000Z',
    ],
    now,
  })
  const fifoPlan = await fifoFixture.service.activatePendingPreviewLearning({
    now,
    timezone: 'UTC',
    local_day: '2026-08-08',
  })
  const formById = new Map(
    Object.values((await fifoFixture.acquisitionRepository.loadSnapshot()).by_learning_unit_id)
      .map((pair) => [pair.learning_unit.learning_unit_id, pair.learning_unit.normalized_form]),
  )
  assert.deepEqual(
    fifoPlan.activated.map((item) => formById.get(item.learning_unit_id)),
    ['preview-1', 'preview-2', 'preview-0'],
  )

  const previewOnlyBacklog = await createActivationFixture(moduleApi, {
    dueReviewCount: 0,
    count: 20,
    introducedAt: '2026-08-01T08:00:00.000Z',
    now,
  })
  await seedActivatedPreviewReviews(previewOnlyBacklog, 20)
  const twentyActivatedPreviewDue = await previewOnlyBacklog.service.activatePendingPreviewLearning({
    now: '2026-08-08T08:00:00.000Z',
    timezone: 'UTC',
    local_day: '2026-08-08',
  })
  assert.equal(twentyActivatedPreviewDue.due_review_count, 20)
  assert.equal(twentyActivatedPreviewDue.dailyLimit, 2)
  assert.equal(twentyActivatedPreviewDue.activated.length, 0)
  const activatedPreviewReviewState = Object.values(
    (await previewOnlyBacklog.reviewStateRepository.loadSnapshot()).by_learning_unit_id,
  )[0]
  assert.equal(activatedPreviewReviewState.scheduler_parameters_version, 'fsrs-parameters.v1')

  const twentyFiveActivatedPreview = await createActivationFixture(moduleApi, {
    dueReviewCount: 0,
    count: 25,
    introducedAt: '2026-08-01T08:00:00.000Z',
    now,
  })
  await seedActivatedPreviewReviews(twentyFiveActivatedPreview, 25)
  const twentyFivePreviewDuePlan = await twentyFiveActivatedPreview.service.activatePendingPreviewLearning({
    now: '2026-08-08T08:00:00.000Z',
    timezone: 'UTC',
    local_day: '2026-08-08',
  })
  assert.equal(twentyFivePreviewDuePlan.due_review_count, 25)
  assert.equal(twentyFivePreviewDuePlan.dailyLimit, 0)
  assert.equal(twentyFivePreviewDuePlan.activated.length, 0)

  for (const [formalCount, activatedPreviewCount, expectedLimit] of [
    [5, 10, 5],
    [5, 11, 2],
    [5, 19, 2],
    [5, 20, 0],
  ]) {
    const mixedFixture = await createActivationFixture(moduleApi, {
      dueReviewCount: formalCount,
      count: activatedPreviewCount,
      introducedAt: '2026-08-01T08:00:00.000Z',
      now,
    })
    await seedActivatedPreviewReviews(mixedFixture, activatedPreviewCount)
    const mixedPlan = await mixedFixture.service.activatePendingPreviewLearning({
      now: '2026-08-08T08:00:00.000Z',
      timezone: 'UTC',
      local_day: '2026-08-08',
    })
    assert.equal(mixedPlan.due_review_count, formalCount + activatedPreviewCount)
    assert.equal(mixedPlan.dailyLimit, expectedLimit)
  }
}

async function createActivationFixture(moduleApi, options = {}) {
  const now = options.now || delayedAt
  const repository = moduleApi.createInMemoryVocabularyRepository({
    reviewStates: Array.from({ length: options.dueReviewCount || 0 }, (_, index) => ({
      word_id: `formal-due-${index}`,
      due_at: now,
      state: 'review',
    })),
  })
  const runner = moduleApi.createInMemoryVocabularyLearningUnitOfWorkRunner({
    now: () => now,
  })
  const acquisitionRepository = createAcquisitionReader(runner.snapshot)
  const reviewStateRepository = {
    async loadSnapshot() {
      return runner.snapshot().find((row) => row.id === 'vocabulary.review.store.v2')?.content
        || { schema_version: 'review-store.v2', by_learning_unit_id: {} }
    },
  }
  const acquisitionService = moduleApi.createVocabularyAcquisitionService({
    enabled: true,
    runUnitOfWork: runner.run,
    now: () => now,
  })
  const service = moduleApi.createVocabularyService({
    repository,
    scheduler: { createInitialReviewState() { throw new Error('legacy scheduler must not run') } },
    now: () => new Date(now),
    acquisitionEnabled: true,
    acquisitionRepository,
    acquisitionService,
    reviewStateRepository,
  })
  const unitIds = []
  const introducedAt = options.introducedAt || '2026-08-07T08:00:00.000Z'
  for (let index = 0; index < (options.count || 0); index += 1) {
    const queued = await service.queuePreviewVocabularyAcquisition({
      word: `preview-${index}`,
      lemma: `preview-${index}`,
      language: 'en',
      meaning: `含义 ${index}`,
      createdAt: Array.isArray(introducedAt) ? introducedAt[index] : introducedAt,
      preview_item_id: `preview-item-${index}`,
      context: options.omitContext ? null : undefined,
    })
    unitIds.push(queued.learningUnit.learning_unit_id)
  }
  return {
    repository,
    runner,
    acquisitionRepository,
    reviewStateRepository,
    acquisitionService,
    service,
    unitIds,
  }
}

async function seedActivatedPreviewReviews(fixture, count, {
  activatedAt = '2026-08-07T08:00:00.000Z',
  localDay = '2026-08-07',
} = {}) {
  for (const learningUnitId of fixture.unitIds.slice(0, count)) {
    const commandBase = `preview-test-activation:${learningUnitId}`
    await fixture.acquisitionService.activatePreviewLearningUnit({
      command_id: `${commandBase}:command`,
      correlation_id: commandBase,
      event_partition: activatedAt.slice(0, 7),
      payload: {
        learning_unit_id: learningUnitId,
        activated_at: activatedAt,
        local_day: localDay,
        daily_limit: 5,
        due_review_count: 0,
        review_state_id: `vocabulary-review:${learningUnitId}`,
        scheduler_version: 'fsrs.v1',
        scheduler_parameters_version: 'fsrs-parameters.v1',
        event_id: `${commandBase}:event`,
      },
    })
  }
}

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
  const reloadedCoordinator = moduleApi.createPassagePreviewAcquisitionCoordinator({
    vocabularyService: service,
    storage,
    now: () => coordinatorNow.value,
  })
  const repeated = await reloadedCoordinator.registerItem(item, { introducedAt })
  assert.equal(repeated.record.learningUnitId, registered.record.learningUnitId)
  assert.equal(Object.keys((await coordinatorAcquisitionRepository.loadSnapshot()).by_learning_unit_id).length, 1)
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
        .replace("from './windows-owner-vocabulary-srs.mjs'", "from './owner-vocabulary-srs-stub.mjs'")
      fs.writeFileSync(path.join(tempDir, file.replace(/\.js$/u, '.mjs')), source)
    })
    fs.writeFileSync(
      path.join(tempDir, 'owner-vocabulary-srs-stub.mjs'),
      'export const getWindowsOwnerVocabularySrsIntegration = () => null\n',
    )
    const modules = await Promise.all(files.map((file) => import(
      `${pathToFileURL(path.join(tempDir, file.replace(/\.js$/u, '.mjs'))).href}?preview=${Date.now()}`
    )))
    const coordinatorSource = fs.readFileSync(
      path.join(repoRoot, 'src', 'features', 'passage-preview', 'passage-preview-acquisition.js'),
      'utf8',
    )
      .replace(/\.\.\/\.\.\/services\/vocabulary\/vocabulary-learning-models\.js/gu, './vocabulary-learning-models.mjs')
      .replace(/\.\.\/\.\.\/services\/vocabulary\/vocabulary-service\.js/gu, './vocabulary-service.mjs')
      .replace("./passage-preview-storage.js", './passage-preview-storage.mjs')
    fs.writeFileSync(path.join(tempDir, 'passage-preview-storage.mjs'), [
      'export const commitPassagePreviewOwnerRecords = async () => null',
      'export const isPassagePreviewOwnerAuthoritative = () => false',
      'export const loadPassagePreviewRecordsFromOwner = async () => null',
    ].join('\n'))
    const coordinatorPath = path.join(tempDir, 'passage-preview-acquisition.mjs')
    fs.writeFileSync(coordinatorPath, coordinatorSource)
    const coordinator = await import(`${pathToFileURL(coordinatorPath).href}?preview-coordinator=${Date.now()}`)
    return Object.assign({}, ...modules, coordinator)
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
}
