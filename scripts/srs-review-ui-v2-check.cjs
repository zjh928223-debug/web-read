const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { h } = require('vue')
const { renderToString } = require('@vue/server-renderer')

const repoRoot = path.resolve(__dirname, '..')
const tempDir = fs.mkdtempSync(path.join(repoRoot, '.tmp-srs-review-ui-v2-'))

function stage(source, target, rewrites = []) {
  let text = fs.readFileSync(path.join(repoRoot, source), 'utf8')
  for (const [from, to] of rewrites) text = text.replaceAll(from, to)
  fs.writeFileSync(path.join(tempDir, target), text)
}

async function main() {
  fs.writeFileSync(
    path.join(tempDir, 'ratings.mjs'),
    "export const REVIEW_RATINGS = Object.freeze({ AGAIN: 'again', HARD: 'hard', GOOD: 'good', EASY: 'easy' })\n",
  )
  fs.writeFileSync(
    path.join(tempDir, 'ui-service-deps.mjs'),
    [
      'const unavailable = () => { throw new Error("Focused verification must inject UI service dependencies") }',
      'export const createIndexedDbAcquisitionRepository = unavailable',
      'export const createIndexedDbContextEvidenceRepository = unavailable',
      'export const createIndexedDbLearningEventRepository = unavailable',
      'export const createIndexedDbVocabularyRepository = unavailable',
      'export const createIndexedDbReviewSessionLedgerRepository = unavailable',
      'export const createIndexedDbReviewStateReader = unavailable',
      'export const createIndexedDbPersonalizationShadowReportRepository = unavailable',
      'export const createPersonalizationShadowService = unavailable',
      'export const createSrsReviewServiceV2 = unavailable',
      'export const getWindowsOwnerVocabularySrsIntegration = () => null',
      '',
    ].join('\n'),
  )
  stage('src/features/srs-review/srs-review-queue.js', 'queue.mjs')
  stage('src/features/srs-review/srs-review-flow.js', 'flow.mjs')
  stage('src/features/srs-review/srs-review-policy.js', 'policy.mjs')
  stage('src/features/srs-review/srs-review-prompt.js', 'prompt.mjs')
  stage('src/features/srs-review/srs-review-source-selector.js', 'selector.mjs')
  stage(
    'src/features/srs-review/srs-review-ui-service.js',
    'ui-service.mjs',
    [
      ['../../services/vocabulary/vocabulary-acquisition-repository.js', './ui-service-deps.mjs'],
      ['../../services/vocabulary/vocabulary-context-evidence.js', './ui-service-deps.mjs'],
      ['../../services/vocabulary/vocabulary-learning-events.js', './ui-service-deps.mjs'],
      ['../../services/vocabulary/vocabulary-repository.js', './ui-service-deps.mjs'],
      ['../../services/vocabulary/srs-review-session-ledger.js', './ui-service-deps.mjs'],
      ['../../services/vocabulary/srs-review-service-v2.js', './ui-service-deps.mjs'],
      ['../../services/vocabulary/personalization/personalization-shadow-report-repository.js', './ui-service-deps.mjs'],
      ['../../services/vocabulary/personalization/personalization-shadow-service.js', './ui-service-deps.mjs'],
      ['../../services/vocabulary/windows-owner-vocabulary-srs.js', './ui-service-deps.mjs'],
      ['./srs-review-policy.js', './policy.mjs'],
    ],
  )
  stage(
    'src/features/srs-review/srs-session-planner.js',
    'planner.mjs',
    [['./srs-review-policy.js', './policy.mjs']],
  )
  stage(
    'src/features/srs-review/useSrsReview.js',
    'use-review.mjs',
    [
      ['../../services/vocabulary/index.js', './ratings.mjs'],
      ['./srs-review-queue.js', './queue.mjs'],
      ['./srs-review-prompt.js', './prompt.mjs'],
      ['./srs-review-source-selector.js', './selector.mjs'],
    ],
  )

  const [
    { useSrsReview },
    { createSrsReviewFlow },
    policy,
    planner,
    prompt,
    sourceSelector,
    uiServiceModule,
  ] = await Promise.all([
    import(pathToFileURL(path.join(tempDir, 'use-review.mjs')).href),
    import(pathToFileURL(path.join(tempDir, 'flow.mjs')).href),
    import(pathToFileURL(path.join(tempDir, 'policy.mjs')).href),
    import(pathToFileURL(path.join(tempDir, 'planner.mjs')).href),
    import(pathToFileURL(path.join(tempDir, 'prompt.mjs')).href),
    import(pathToFileURL(path.join(tempDir, 'selector.mjs')).href),
    import(pathToFileURL(path.join(tempDir, 'ui-service.mjs')).href),
  ])

  await verifyReadOnlySourceProbe({ sourceSelector, uiServiceModule })
  await verifySourceSelection({ useSrsReview, sourceSelector })
  verifySourceIndicator()
  await verifyPromptRendering(prompt)

  const now = '2026-07-29T01:00:00.000Z'
  const timezone = 'UTC'
  const candidates = Array.from({ length: 101 }, (_, index) => ({
    learning_unit_id: `unit-${String(index + 1).padStart(3, '0')}`,
    queue_kind: 'due_review',
    due_at: '2026-07-28T00:00:00.000Z',
    estimated_duration_ms: 36000,
    enqueue_reason: 'SCHEDULER_DUE',
  }))
  const sixtyMinuteLedger = planner.planReviewSession({
    now,
    local_day: '2026-07-29',
    timezone,
    session_id: 'ui-budget-session',
    policy: { mode: 'balanced', budget_ms: 3600000 },
    candidates,
  })
  sixtyMinuteLedger.status = 'active'
  sixtyMinuteLedger.extensions = {
    ...sixtyMinuteLedger.extensions,
    completed_item_ids: [],
    attempt_ids: [],
    attempt_results_by_id: {},
  }
  assert.equal(sixtyMinuteLedger.entries.length, 100, '60 minutes at 36 seconds should plan 100 attempts')
  assert.equal(sixtyMinuteLedger.backlog.extensions.total_count, 1)

  const budgetService = createUiService(sixtyMinuteLedger)
  const budgetReview = useSrsReview(budgetService, { now, timezone })
  await budgetReview.load()
  assert.equal(budgetReview.mode.value, 'balanced')
  assert.equal(budgetReview.modeLabel.value, '均衡')
  assert.equal(budgetReview.budgetMinutes.value, 60)
  assert.equal(budgetReview.estimatedRemainingLabel.value, '60 分钟')
  assert.equal(budgetReview.backlogLabel.value, '1 项（约 不足 1 分钟）')

  let ordinaryQueueLoads = 0
  const ordinaryLedger = createLedger({ mode: 'balanced', promptMode: 'original_context', count: 2 })
  const ordinaryReview = useSrsReview(createUiService(ordinaryLedger, {
    onQueueLoad() { ordinaryQueueLoads += 1 },
  }), { now, timezone })
  await ordinaryReview.load()
  assert.equal(ordinaryQueueLoads, 1)
  assert.equal(await ordinaryReview.submitAction(ordinaryReview.actions[2]), true)
  assert.equal(
    ordinaryQueueLoads,
    1,
    'an ordinary rating must reuse the loaded queue instead of rebuilding every review card',
  )

  for (const mode of ['once_daily', 'balanced', 'intensive']) {
    const ledger = createLedger({ mode, promptMode: 'word_only' })
    const review = useSrsReview(createUiService(ledger), { now, timezone })
    await review.load()
    assert.equal(review.mode.value, mode, `${mode} should reach the UI session snapshot`)
  }

  const attempts = []
  for (const testCase of [
    {
      promptMode: 'word_only',
      contexts: [],
      actionIndex: 0,
      revealed: false,
      cueLevel: 'none',
    },
    {
      promptMode: 'original_context',
      contexts: [reviewContext('ctx-original', false)],
      actionIndex: 2,
      revealed: true,
      cueLevel: 'translation',
    },
    {
      promptMode: 'word_only',
      contexts: [reviewContext('ctx-word-revealed', true)],
      actionIndex: 2,
      revealed: false,
      cueLevel: 'target_sentence',
      revealTarget: true,
    },
    {
      promptMode: 'transfer_context',
      contexts: [reviewContext('ctx-transfer', true)],
      actionIndex: 0,
      revealed: false,
      cueLevel: 'surrounding_context',
      revealSurrounding: true,
    },
  ]) {
    const ledger = createLedger({ mode: 'balanced', promptMode: testCase.promptMode })
    const service = createUiService(ledger, {
      contexts: testCase.contexts,
      onAttempt(input) {
        attempts.push(input)
      },
    })
    const review = useSrsReview(service, { now, timezone })
    await review.load()
    if (testCase.revealTarget) {
      assert.equal(review.showTargetSentence(), true)
    }
    if (testCase.revealSurrounding) {
      assert.equal(review.showSurroundingContext(), true)
    }
    assert.equal(await review.submitAction(review.actions[testCase.actionIndex], {
      advance: false,
      answerRevealedBeforeRating: testCase.revealed,
    }), true)
    assert.equal(attempts.at(-1).prompt_mode, testCase.promptMode)
    assert.equal(attempts.at(-1).cue_level, testCase.cueLevel)
    assert.equal(attempts.at(-1).rating, review.actions[testCase.actionIndex].rating)
  }

  const flowMetadata = []
  const flow = createSrsReviewFlow({
    async submitAction(action, metadata) {
      flowMetadata.push([action.rating, metadata.answerRevealedBeforeRating])
      return true
    },
  })
  assert.equal(
    await flow.rate({ rating: 'again', tone: 'again' }),
    false,
    'Again must be rejected until the answer is revealed',
  )
  assert.deepEqual(flowMetadata, [], 'no rating may be submitted before the answer is revealed')
  flow.resetCard()
  flow.revealAnswer()
  assert.equal(await flow.rate({ rating: 'again', tone: 'again' }), true)
  assert.deepEqual(flowMetadata.at(-1), ['again', true])
  flow.resetCard()
  flow.revealAnswer()
  assert.equal(await flow.rate({ rating: 'good', tone: 'good' }), true)
  assert.deepEqual(flowMetadata.at(-1), ['good', true])

  const synchronousBlockReview = useSrsReview(createUiService(
    createLedger({ mode: 'balanced', promptMode: 'word_only', count: 2 }),
    {
      waitForAttempt() {
        const startedAt = Date.now()
        while (Date.now() - startedAt < 120) {}
      },
    },
  ), { now, timezone })
  await synchronousBlockReview.load()
  const synchronousBlockStartedAt = Date.now()
  assert.equal(await synchronousBlockReview.submitAction(
    synchronousBlockReview.actions[0],
    { advance: false, background: true },
  ), true)
  const synchronousBlockAcceptanceMs = Date.now() - synchronousBlockStartedAt
  assert.ok(
    synchronousBlockAcceptanceMs < 50,
    `rating acceptance must run before synchronous persistence setup (${synchronousBlockAcceptanceMs}ms)`,
  )
  assert.equal(synchronousBlockReview.advanceCurrent(), true)
  await synchronousBlockReview.flushPendingSaves()

  const instantReleases = []
  let instantRecordCalls = 0
  const instantReview = useSrsReview(createUiService(
    createLedger({ mode: 'balanced', promptMode: 'word_only', count: 2 }),
    {
      async waitForAttempt() {
        instantRecordCalls += 1
        await new Promise((resolve) => { instantReleases.push(resolve) })
      },
    },
  ), { now, timezone })
  await instantReview.load()
  const instantFirst = instantReview.submitAction(instantReview.actions[0], {
    advance: false,
    background: true,
  })
  const instantFirstAccepted = await Promise.race([
    instantFirst,
    new Promise((resolve) => setTimeout(() => resolve(false), 25)),
  ])
  if (!instantFirstAccepted) instantReleases.shift()?.()
  assert.equal(
    instantFirstAccepted,
    true,
    'rating acceptance must not wait for the persistence transaction',
  )
  assert.equal(instantReview.advanceCurrent(), true)
  assert.equal(
    instantReview.current.value.word.id,
    'unit-2',
    'the next review card must appear without waiting for IndexedDB persistence',
  )
  assert.equal(await instantReview.submitAction(instantReview.actions[0], {
    advance: false,
    background: true,
  }), true)
  assert.equal(instantReview.advanceCurrent(), true)
  assert.equal(instantReview.completed.value, true, 'rapid ratings should keep advancing optimistically')
  await waitFor(() => instantRecordCalls === 1)
  assert.equal(instantRecordCalls, 1, 'background writes must remain sequential')
  instantReleases.shift()()
  await waitFor(() => instantRecordCalls === 2)
  instantReleases.shift()()
  await instantReview.flushPendingSaves()
  assert.equal(instantReview.backgroundSaving.value, 0)
  assert.deepEqual(instantReview.sessionRatingCounts.value, {
    again: 2,
    hard: 0,
    good: 0,
    easy: 0,
  })

  let revisitNow = '2026-07-29T01:00:00.000Z'
  const deferredRevisitReview = useSrsReview(createUiService(
    createLedger({ mode: 'balanced', promptMode: 'word_only' }),
    { appendFutureRevisit: true },
  ), { now: () => revisitNow, timezone })
  await deferredRevisitReview.load()
  assert.equal(await deferredRevisitReview.submitAction(
    deferredRevisitReview.actions[0],
    { advance: false, background: true },
  ), true)
  assert.equal(deferredRevisitReview.advanceCurrent(), true)
  await deferredRevisitReview.flushPendingSaves()
  assert.equal(
    deferredRevisitReview.progress.value,
    '复习 1 / 1',
    'a future same-day revisit must not overflow the original batch progress',
  )
  assert.equal(
    deferredRevisitReview.completed.value,
    true,
    'a future same-day revisit must not leave the finished batch on a disabled card',
  )
  assert.equal(deferredRevisitReview.deferredRevisit.value, true)
  revisitNow = '2026-07-29T01:03:00.000Z'
  deferredRevisitReview.refreshEligibility()
  assert.equal(deferredRevisitReview.completed.value, false)
  assert.equal(deferredRevisitReview.progress.value, '同日重访')

  let releaseAttempt
  let recordCalls = 0
  const duplicateLedger = createLedger({ mode: 'balanced', promptMode: 'word_only' })
  const duplicateService = createUiService(duplicateLedger, {
    async waitForAttempt() {
      recordCalls += 1
      await new Promise((resolve) => { releaseAttempt = resolve })
    },
  })
  const duplicateReview = useSrsReview(duplicateService, { now, timezone })
  await duplicateReview.load()
  const first = duplicateReview.submitAction(duplicateReview.actions[0], { advance: false })
  const duplicate = duplicateReview.submitAction(duplicateReview.actions[0], { advance: false })
  assert.equal(await duplicate, false, 'rapid duplicate input must be rejected locally')
  assert.equal(recordCalls, 1)
  releaseAttempt()
  assert.equal(await first, true)
  assert.equal(recordCalls, 1)

  const restoredLedger = createLedger({ mode: 'balanced', promptMode: 'word_only', count: 2 })
  restoredLedger.cursor = 1
  restoredLedger.extensions.completed_item_ids = [restoredLedger.entries[0].ledger_item_id]
  restoredLedger.extensions.attempt_ids = ['restored-attempt']
  restoredLedger.extensions.attempt_results_by_id = {
    'restored-attempt': {
      attempt: { attempt_id: 'restored-attempt', rating: 'hard' },
    },
  }
  const restoredReview = useSrsReview(createUiService(restoredLedger, { resume: true }), {
    now,
    timezone,
  })
  await restoredReview.load()
  assert.equal(restoredReview.index.value, 1, 'refresh should restore the persisted ledger cursor')
  assert.equal(restoredReview.current.value.ledgerEntry.ledger_item_id, restoredLedger.entries[1].ledger_item_id)
  assert.equal(restoredReview.sessionRatingCounts.value.hard, 1)

  const matureState = reviewState({ state: 'review' })
  const wrongRevisit = policy.shouldScheduleSameDayRevisit({
    local_day: '2026-07-29',
    timezone,
    mode: 'balanced',
    review_state: matureState,
    rating: 'again',
    completed_revisit_count: 0,
    now,
  })
  assert.equal(wrongRevisit.allowed, true, 'Again should schedule one balanced revisit')
  assert.equal(wrongRevisit.reason_code, 'BALANCED_REVISIT_ALLOWED')
  const matureCorrect = policy.shouldScheduleSameDayRevisit({
    local_day: '2026-07-29',
    timezone,
    mode: 'balanced',
    review_state: matureState,
    rating: 'good',
    completed_revisit_count: 0,
    now,
  })
  assert.equal(matureCorrect.allowed, false, 'a mature correct card must not repeat today')
  assert.equal(matureCorrect.reason_code, 'BALANCED_MATURE_CORRECT')

  assert.deepEqual(
    budgetReview.actions.map(({ label, rating }) => [label, rating]),
    [['忘记', 'again'], ['困难', 'hard'], ['一般', 'good'], ['容易', 'easy']],
  )

  const pageSource = fs.readFileSync(
    path.join(repoRoot, 'src/features/srs-review/SrsReviewPage.vue'),
    'utf8',
  )
  assert.doesNotMatch(pageSource, /srs-review-session-meta/)
  assert.doesNotMatch(pageSource, /<strong>Backlog<\/strong>/)
  assert.match(pageSource, /visibleReviewParagraphs/)
  assert.match(pageSource, /显示目标句/)
  assert.match(pageSource, /显示周边语境/)
  assert.match(pageSource, /removeUnavailableReason/)
  assert.match(pageSource, /sourceAudioNotice/)
  assert.match(pageSource, /retrySourceAudio/)
  assert.match(pageSource, /handleReviewSourceError\(error, request\)/)
  assert.doesNotMatch(pageSource, />\s*掌握\s*</, 'the page must not expose a fifth rating')

  const appSource = fs.readFileSync(path.join(repoRoot, 'src/App.vue'), 'utf8')
  assert.match(appSource, /createSrsReviewSourceSelector/)
  assert.match(appSource, /VITE_SRS_REVIEW_V2_ENABLED/)
  assert.match(appSource, /createLegacyVocabularyMigration/)
  assert.match(appSource, /createLegacyReviewServiceAdapter/)
  assert.match(appSource, /legacyService:\s*legacyReviewService/)
  assert.match(
    appSource,
    /setTimeout\(\(\) => \{[\s\S]*srsReviewV2Service\.warmReviewData\?\.\(\)/,
    'the reader should warm review snapshots in the background after startup',
  )
  assert.match(appSource, /v-if="isSrsReviewMounted"/)
  assert.match(appSource, /v-show="isSrsReviewOpen"/)
  assert.match(appSource, /:active="isSrsReviewOpen"/)

  console.log('SRS review UI V2 focused verification passed.')
}

async function verifyReadOnlySourceProbe({ sourceSelector, uiServiceModule }) {
  const warmReads = { acquisition: 0, content: 0, review: 0, context: 0 }
  let warmCommandCalls = 0
  const warmUiService = uiServiceModule.createSrsReviewUiService({
    acquisitionRepository: { async loadSnapshot() { warmReads.acquisition += 1; return { by_learning_unit_id: {} } } },
    contentRepository: { async loadSnapshot() { warmReads.content += 1; return { words: [], contexts: [] } } },
    reviewStateRepository: { async loadSnapshot() { warmReads.review += 1; return { by_learning_unit_id: {} } } },
    contextEvidenceRepository: { async loadSnapshot() { warmReads.context += 1; return { by_context_evidence_id: {} } } },
    learningEventRepository: { async query() { return [] } },
    sessionLedgerRepository: { async getBySessionId() { return null } },
    reviewService: {
      async startReviewSession() { warmCommandCalls += 1 },
      async resumeReviewSession() { warmCommandCalls += 1 },
      async recordReviewAttempt() { warmCommandCalls += 1 },
      async completeReviewSession() { warmCommandCalls += 1 },
    },
  })
  await warmUiService.warmReviewData()
  assert.equal(await warmUiService.hasReviewCards({ now: '2026-07-29T01:00:00.000Z' }), false)
  assert.deepEqual(await warmUiService.getReviewCards({ entries: [] }), [])
  assert.deepEqual(warmReads, { acquisition: 2, content: 1, review: 2, context: 1 })
  assert.equal(warmCommandCalls, 0, 'review warmup must remain read-only')

  let activationCalls = 0
  const activationUiService = uiServiceModule.createSrsReviewUiService({
    managementService: {
      async activatePendingPreviewLearning(input) {
        activationCalls += 1
        assert.equal(input.timezone, 'UTC')
        return { activated: [] }
      },
    },
    acquisitionRepository: { async loadSnapshot() { return { by_learning_unit_id: {} } } },
    contentRepository: { async loadSnapshot() { return { words: [], contexts: [] } } },
    reviewStateRepository: { async loadSnapshot() { return { by_learning_unit_id: {} } } },
    contextEvidenceRepository: { async loadSnapshot() { return { by_context_evidence_id: {} } } },
    learningEventRepository: { async query() { return [] } },
    sessionLedgerRepository: { async getBySessionId() { return null } },
    reviewService: {
      async startReviewSession() { return null },
      async resumeReviewSession() { return null },
      async recordReviewAttempt() { return null },
      async completeReviewSession() { return null },
    },
  })
  await activationUiService.startReviewSession({
    session_id: 'fresh-preview-review',
    now: '2026-07-29T01:00:00.000Z',
    timezone: 'UTC',
  })
  assert.equal(activationCalls, 1, 'a new review session should activate eligible preview learning')

  let storedLedger = createLedger({ mode: 'balanced', promptMode: 'word_only' })
  storedLedger.local_day = '2026-07-28'
  let ledgerPutCalls = 0
  let v2CommandCalls = 0
  const sessionLedgerRepository = {
    async getBySessionId(sessionId) {
      return sessionId === storedLedger.session_id ? clone(storedLedger) : null
    },
    async put() {
      ledgerPutCalls += 1
      throw new Error('read-only source probe attempted to write a ledger')
    },
    snapshot() {
      return clone({ [storedLedger.session_id]: storedLedger })
    },
  }
  const reviewService = {
    async startReviewSession() {
      v2CommandCalls += 1
      throw new Error('source probe must not start a session')
    },
    async resumeReviewSession() {
      v2CommandCalls += 1
      throw new Error('source probe must not resume a session')
    },
    async recordReviewAttempt() {
      v2CommandCalls += 1
      throw new Error('source probe must not record an attempt')
    },
    async completeReviewSession() {
      v2CommandCalls += 1
      throw new Error('source probe must not complete a session')
    },
  }
  let acquisitionReads = 0
  const acquisitionRepository = {
    async loadSnapshot() {
      acquisitionReads += 1
      return { by_learning_unit_id: {} }
    },
  }
  const uiService = uiServiceModule.createSrsReviewUiService({
    acquisitionRepository,
    contextEvidenceRepository: { async listByLearningUnit() { return [] } },
    learningEventRepository: { async query() { return [] } },
    sessionLedgerRepository,
    reviewStateRepository: { async getByLearningUnitId() { return null } },
    contentRepository: { async loadSnapshot() { return { words: [], contexts: [] } } },
    reviewService,
  })

  const beforeProbe = Buffer.from(JSON.stringify(sessionLedgerRepository.snapshot()))
  assert.equal(await uiService.hasReviewCards({
    session_id: storedLedger.session_id,
    now: '2026-07-29T01:00:00.000Z',
  }), true, 'an expired active ledger should be observed without abandoning it')
  const afterProbe = Buffer.from(JSON.stringify(sessionLedgerRepository.snapshot()))
  assert.deepEqual(afterProbe, beforeProbe, 'source probing must leave ledger bytes unchanged')
  assert.equal(ledgerPutCalls, 0)
  assert.equal(v2CommandCalls, 0, 'source probing must not call any V2 session command')
  assert.equal(acquisitionReads, 0, 'an available ledger should avoid the due-state scan')

  storedLedger = createLedger({ mode: 'balanced', promptMode: 'word_only' })
  storedLedger.extensions.completed_item_ids = []
  storedLedger.extensions.attempt_results_by_id = {
    'completed-attempt': {
      ledger_item_id: storedLedger.entries[0].ledger_item_id,
      attempt: { attempt_id: 'completed-attempt' },
    },
  }
  const beforeFallback = Buffer.from(JSON.stringify(sessionLedgerRepository.snapshot()))
  const legacyService = {
    async getDueWords() { return [] },
    async reviewWord() { return {} },
  }
  const selector = sourceSelector.createSrsReviewSourceSelector({
    v2Service: uiService,
    legacyService,
  })
  const selection = await selector.resolveReviewSource({
    session_id: storedLedger.session_id,
    now: '2026-07-29T01:00:00.000Z',
  })
  assert.equal(selection.source, 'legacy')
  const afterFallback = Buffer.from(JSON.stringify(sessionLedgerRepository.snapshot()))
  assert.deepEqual(
    afterFallback,
    beforeFallback,
    'falling back to legacy must not reconcile or abandon the V2 ledger',
  )
  assert.equal(ledgerPutCalls, 0)
  assert.equal(v2CommandCalls, 0)
  assert.equal(acquisitionReads, 1, 'no available ledger should use the read-only due-state scan')
}

async function verifySourceSelection({ useSrsReview, sourceSelector }) {
  const now = '2026-07-29T01:00:00.000Z'
  let legacyLoads = 0
  let legacyReviews = 0
  let legacyDeletes = 0
  const legacyService = {
    async getDueWords() {
      legacyLoads += 1
      return [{
        word: { id: 'legacy-only', word: 'legacy-only' },
        contexts: [reviewContext('legacy-context', true)],
      }]
    },
    async getReviewLogs() {
      return []
    },
    async reviewWord() {
      legacyReviews += 1
      return {}
    },
    async deleteWord() {
      legacyDeletes += 1
    },
  }
  const emptyV2 = {
    ...createUiService(createLedger({ mode: 'balanced', promptMode: 'word_only' })),
    async hasReviewCards() {
      return false
    },
  }
  const legacyOnlySelector = sourceSelector.createSrsReviewSourceSelector({
    v2Service: emptyV2,
    legacyService,
  })
  const legacyReview = useSrsReview(legacyOnlySelector, { now, timezone: 'UTC' })
  await legacyReview.load()
  assert.equal(legacyReview.reviewSource.value, 'legacy')
  assert.equal(legacyReview.current.value.word.id, 'legacy-only')
  assert.equal(legacyReview.canRemoveCurrent.value, true)
  assert.equal(
    legacyReview.contextCueLevel.value,
    'target_sentence',
    'legacy fallback must not bring the whole surrounding article back by default',
  )
  assert.equal(await legacyReview.removeCurrent(), true)
  assert.equal(legacyDeletes, 1, 'legacy management behavior remains available')

  let v2Attempts = 0
  const v2Service = {
    ...createUiService(createLedger({ mode: 'balanced', promptMode: 'word_only' }), {
      onAttempt() {
        v2Attempts += 1
      },
    }),
    async hasReviewCards() {
      return true
    },
  }
  const preferredSelector = sourceSelector.createSrsReviewSourceSelector({
    v2Service,
    legacyService,
  })
  const preferredReview = useSrsReview(preferredSelector, { now, timezone: 'UTC' })
  await preferredReview.load()
  assert.equal(preferredReview.reviewSource.value, 'v2')
  assert.equal(preferredReview.canRemoveCurrent.value, false)
  assert.match(preferredReview.removeUnavailableReason.value, /不支持安全移除/)
  assert.equal(legacyLoads, 1, 'V2 availability must not merge in the legacy queue')
  assert.equal(await preferredReview.submitAction(preferredReview.actions[2], { advance: false }), true)
  assert.equal(v2Attempts, 1)
  assert.equal(legacyReviews, 0, 'a V2 card must never be written through the legacy scheduler')

  let transientProbeCalls = 0
  const transientSelector = sourceSelector.createSrsReviewSourceSelector({
    v2Service: {
      ...v2Service,
      async hasReviewCards() {
        transientProbeCalls += 1
        if (transientProbeCalls === 1) throw new Error('temporary IndexedDB contention')
        return true
      },
    },
    legacyService,
    probeRetryDelayMs: 0,
  })
  const transientSelection = await transientSelector.resolveReviewSource({})
  assert.equal(transientProbeCalls, 2)
  assert.equal(
    transientSelection.source,
    'v2',
    'a transient V2 probe error must not downgrade the whole review session to legacy',
  )

  const probeFailureSelector = sourceSelector.createSrsReviewSourceSelector({
    v2Service: {
      ...v2Service,
      async hasReviewCards() {
        throw new Error('V2 storage unavailable')
      },
    },
    legacyService,
  })
  const failureSelection = await probeFailureSelector.resolveReviewSource({})
  assert.equal(failureSelection.source, 'legacy', 'V2 probe errors must safely fall back')
  assert.equal(failureSelection.reason, 'v2_probe_failed')

  const flagOffSelector = sourceSelector.createSrsReviewSourceSelector({
    v2Service,
    legacyService,
    v2Enabled: 'off',
  })
  assert.equal((await flagOffSelector.resolveReviewSource({})).source, 'legacy')
}

function verifySourceIndicator() {
  const pageSource = fs.readFileSync(
    path.join(repoRoot, 'src', 'features', 'srs-review', 'SrsReviewPage.vue'),
    'utf8',
  )
  assert.match(pageSource, /review\.progress\.value \|\| '今日复习'/)
  assert.match(pageSource, />\s*快捷键\s*</)
  assert.doesNotMatch(pageSource, /personalization-shadow\.html/)
  assert.doesNotMatch(pageSource, /reviewSourceCaption/)
  assert.match(pageSource, /legacyMigration/)
  assert.match(pageSource, /startLegacyMigration/)
  assert.doesNotMatch(pageSource, /接入 V2/)
}

async function verifyPromptRendering(prompt) {
  const paragraphs = [
    { target: false, text: 'Lead paragraph.' },
    { target: true, before: 'Lead sentence. ', after: ' Closing sentence.' },
  ]
  const renderCue = async (cueLevel) => {
    const visible = prompt.visibleReviewParagraphs(paragraphs, cueLevel)
    return renderToString(h('article', { 'data-cue': cueLevel }, visible.map((paragraph) => (
      h('p', paragraph.target
        ? `${paragraph.before}Target sentence.${paragraph.after}`
        : paragraph.text)
    ))))
  }
  const wordOnlyHtml = await renderCue('none')
  assert.doesNotMatch(wordOnlyHtml, /Target sentence|Lead paragraph/)
  const targetHtml = await renderCue('target_sentence')
  assert.match(targetHtml, /Target sentence/)
  assert.doesNotMatch(targetHtml, /Lead sentence|Closing sentence|Lead paragraph/)
  const surroundingHtml = await renderCue('surrounding_context')
  assert.match(surroundingHtml, /Lead paragraph/)
  assert.match(surroundingHtml, /Lead sentence/)
  assert.match(surroundingHtml, /Closing sentence/)
}

function createUiService(initialLedger, options = {}) {
  let ledger = clone(initialLedger)
  return {
    async resumeReviewSession() {
      return options.resume ? clone(ledger) : null
    },
    async startReviewSession() {
      return clone(ledger)
    },
    async getReviewCards(inputLedger) {
      if (options.onQueueLoad) options.onQueueLoad(inputLedger)
      return inputLedger.entries.map((entry) => ({
        word: { id: entry.learning_unit_id, word: entry.learning_unit_id },
        contexts: options.contexts || [],
        ledgerEntry: clone(entry),
        promptMode: entry.extensions.prompt_mode || 'word_only',
      }))
    },
    getReviewPolicy() {
      return {
        schema_version: 'review-policy.v1',
        policy_version: 'review-policy.v1',
        mode: ledger.mode,
        budget_ms: ledger.budget_ms,
        default_attempt_ms: ledger.estimated_attempt_ms,
        balanced_revisit_delay_ms: 900000,
        balanced_max_revisits_per_local_day: 1,
      }
    },
    async getReviewEvents() {
      return []
    },
    async recordReviewAttempt(input) {
      if (options.onAttempt) options.onAttempt(input)
      if (options.waitForAttempt) await options.waitForAttempt()
      const current = ledger.entries[ledger.cursor]
      ledger.extensions.completed_item_ids.push(current.ledger_item_id)
      ledger.extensions.attempt_ids.push(input.attempt_id)
      ledger.cursor += 1
      if (
        options.appendFutureRevisit
        && !ledger.entries.some((entry) => entry.queue_kind === 'revisit')
      ) {
        ledger.entries.push({
          ledger_item_id: `${ledger.session_id}:1:revisit:${current.learning_unit_id}:1`,
          position: ledger.entries.length,
          queue_kind: 'revisit',
          learning_unit_id: current.learning_unit_id,
          enqueue_reason: 'BALANCED_REVISIT_ALLOWED',
          estimated_duration_ms: 36000,
          planned_due_at: '2026-07-29T01:03:00.000Z',
          revisit_ordinal: 1,
          extensions: { prompt_mode: 'word_only' },
        })
      }
      ledger.status = ledger.cursor === ledger.entries.length ? 'completed' : 'active'
      const result = {
        attempt: {
          attempt_id: input.attempt_id,
          rating: input.rating,
          occurred_at: input.occurred_at,
        },
        ledger: clone(ledger),
      }
      ledger.extensions.attempt_results_by_id[input.attempt_id] = clone(result)
      result.ledger = clone(ledger)
      return result
    },
  }
}

function createLedger({ mode, promptMode, count = 1 }) {
  const entries = Array.from({ length: count }, (_, index) => ({
    ledger_item_id: `ui-${mode}:${index}:due_review:unit-${index + 1}`,
    position: index,
    queue_kind: 'due_review',
    learning_unit_id: `unit-${index + 1}`,
    enqueue_reason: 'SCHEDULER_DUE',
    estimated_duration_ms: 36000,
    planned_due_at: '2026-07-28T00:00:00.000Z',
    revisit_ordinal: 0,
    extensions: { prompt_mode: promptMode },
  }))
  return {
    schema_version: 'session-ledger.v1',
    session_id: `ui-${mode}`,
    created_at: '2026-07-29T01:00:00.000Z',
    local_day: '2026-07-29',
    timezone: 'UTC',
    policy_version: 'review-policy.v1',
    mode,
    budget_ms: 3600000,
    estimated_attempt_ms: 36000,
    entries,
    cursor: 0,
    status: entries.length ? 'active' : 'completed',
    backlog: {
      due_review_count: 0,
      relearning_count: 0,
      reassessment_count: 0,
      acquisition_count: 0,
      estimated_ms: 0,
      extensions: { revisit_count: 0, total_count: 0 },
    },
    revision: 0,
    extensions: {
      completed_item_ids: [],
      attempt_ids: [],
      attempt_results_by_id: {},
    },
  }
}

function reviewContext(id, withSurrounding) {
  return {
    context_evidence_id: id,
    sentence: 'A synthetic target sentence.',
    surrounding_text: withSurrounding
      ? 'Synthetic lead. A synthetic target sentence. Synthetic close.'
      : 'A synthetic target sentence.',
    source_kind: 'article',
    created_at: '2026-07-29T00:00:00.000Z',
    extensions: {},
  }
}

function reviewState({ state }) {
  return {
    schema_version: 'review-state.v2',
    review_state_id: 'state-1',
    learning_unit_id: 'unit-1',
    word_id: 'word-1',
    state,
    due_at: '2026-07-30T00:00:00.000Z',
    stability: 2,
    difficulty: 5,
    elapsed_days: 1,
    scheduled_days: 1,
    reps: 2,
    lapses: 0,
    learning_steps: 0,
    last_review_at: '2026-07-28T00:00:00.000Z',
    scheduler_version: 'test',
    scheduler_parameters_version: 'test',
    created_at: '2026-07-20T00:00:00.000Z',
    updated_at: '2026-07-28T00:00:00.000Z',
    revision: 2,
    extensions: {},
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

async function waitFor(predicate, timeoutMs = 1000) {
  const startedAt = Date.now()
  while (!predicate()) {
    if (Date.now() - startedAt >= timeoutMs) throw new Error('Timed out waiting for review save')
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
  })
