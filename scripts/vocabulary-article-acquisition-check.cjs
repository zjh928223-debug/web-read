const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

async function loadModules(repoRoot) {
  const sourceDir = path.join(repoRoot, 'src', 'services', 'vocabulary');
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
    'srs-candidates.js',
    'srs-pending-candidates.js',
    'preview-scan.js',
    'article-srs-settlement.js',
  ];
  const tempDir = fs.mkdtempSync(path.join(repoRoot, `.tmp-vocabulary-p10-${process.pid}-`));
  try {
    for (const file of files) {
      const source = fs.readFileSync(path.join(sourceDir, file), 'utf8')
        .replace(/from '\.\/([^']+)\.js'/g, "from './$1.mjs'")
        .replace(/from \"\.\/([^\"]+)\.js\"/g, 'from "./$1.mjs"');
      fs.writeFileSync(path.join(tempDir, file.replace(/\.js$/u, '.mjs')), source);
    }
    const names = files.map((file) => file.replace(/\.js$/u, '.mjs'));
    const modules = await Promise.all(names.map((name) => import(
      `${pathToFileURL(path.join(tempDir, name)).href}?p10=${Date.now()}`
    )));
    return Object.assign({}, ...modules);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function createAcquisitionReader(snapshotRows) {
  const readStore = () => {
    const row = snapshotRows().find((item) => item.id === 'vocabulary.acquisition.store.v1');
    return row?.content || {
      schema_version: 'acquisition-store.v1',
      by_learning_unit_id: {},
      acquisition_attempts_by_id: {},
    };
  };
  return {
    async loadSnapshot() {
      return readStore();
    },
    async getLearningUnit(id) {
      return readStore().by_learning_unit_id[id]?.learning_unit || null;
    },
    async getState(id) {
      return readStore().by_learning_unit_id[id]?.acquisition_state || null;
    },
    async findActiveByWordAndSense(wordId, targetSenseKey) {
      return Object.values(readStore().by_learning_unit_id)
        .map((pair) => pair.learning_unit)
        .find((unit) => (
          unit.archived_at === null
          && unit.word_id === wordId
          && unit.target_sense_key === targetSenseKey
        )) || null;
    },
  };
}

function schedulerStub() {
  return {
    createInitialReviewState(wordId, now) {
      return { id: `legacy-review:${wordId}`, word_id: wordId, due_at: now, state: 'new' };
    },
  };
}

function candidate(overrides = {}) {
  const base = {
    target_id: 'article-target-1',
    targetId: 'article-target-1',
    word: 'seismic',
    lemma: 'seismic',
    language: 'en',
    entry_type: 'word',
    meaning: '地震的',
    group: 'ready',
    eligible: true,
    relearn: false,
    tags: [],
    existing_word_id: '',
    context: {
      sentence: 'A user-imported sentence contains the target.',
      meaning: '地震的',
      source_id: 'article-1',
      source_title: 'Imported article',
      source_url: null,
      surrounding_text: null,
    },
  };
  return {
    ...base,
    ...overrides,
    context: overrides.context === null ? null : {
      ...base.context,
      ...(overrides.context || {}),
    },
  };
}

async function applyArticle(api, vocabularyService, candidates) {
  return api.applyArticleSrsSettlement({
    vocabularyService,
    candidates,
    mode: 'all',
  });
}

function assertNoReviewRows(legacySnapshot, learningRows, message) {
  assert.equal(legacySnapshot.reviewStates.length, 0, `${message}: legacy ReviewState`);
  assert.equal(
    learningRows.some((row) => row.id === 'vocabulary.review.store.v2'),
    false,
    `${message}: review v2 row`,
  );
}

function assertCanonicalReviewCount(learningRows, expected, message) {
  const row = learningRows.find((item) => item.id === 'vocabulary.review.store.v2');
  assert.equal(
    Object.keys(row?.content?.by_learning_unit_id || {}).length,
    expected,
    message,
  );
}

async function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const api = await loadModules(repoRoot);
  const now = '2026-07-28T08:00:00.000Z';

  const vocabularyRepository = api.createInMemoryVocabularyRepository();
  const runner = api.createInMemoryVocabularyLearningUnitOfWorkRunner({ now: () => now });
  const acquisitionRepository = createAcquisitionReader(runner.snapshot);
  const acquisitionService = api.createVocabularyAcquisitionService({
    enabled: true,
    runUnitOfWork: runner.run,
    now: () => now,
  });
  const service = api.createVocabularyService({
    repository: vocabularyRepository,
    scheduler: schedulerStub(),
    now: () => new Date(now),
    acquisitionEnabled: true,
    acquisitionRepository,
    acquisitionService,
  });

  const first = await applyArticle(api, service, [candidate()]);
  assert.equal(first.added, 1);

  const batchVocabularyRepositoryBase = api.createInMemoryVocabularyRepository();
  let batchVocabularySnapshotWrites = 0;
  const batchVocabularyRepository = {
    ...batchVocabularyRepositoryBase,
    updateSnapshot(...args) {
      batchVocabularySnapshotWrites += 1;
      return batchVocabularyRepositoryBase.updateSnapshot(...args);
    },
  };
  const batchRunner = api.createInMemoryVocabularyLearningUnitOfWorkRunner({ now: () => now });
  const batchReader = createAcquisitionReader(batchRunner.snapshot);
  let individualTransactionCount = 0;
  let batchTransactionCount = 0;
  const batchService = api.createVocabularyService({
    repository: batchVocabularyRepository,
    scheduler: schedulerStub(),
    now: () => new Date(now),
    acquisitionEnabled: true,
    acquisitionRepository: batchReader,
    runVocabularyLearningUnitOfWork(...args) {
      individualTransactionCount += 1;
      return batchRunner.run(...args);
    },
    runVocabularyLearningBatchSession(...args) {
      batchTransactionCount += 1;
      return batchRunner.runBatchSession(...args);
    },
  });
  const batchCandidates = Array.from({ length: 20 }, (_, index) => candidate({
    target_id: `batch-target-${index}`,
    targetId: `batch-target-${index}`,
    word: `batchword${index}`,
    lemma: `batchword${index}`,
    context: {
      source_id: 'article-batch',
      sentence: `Batchword${index} appears in this article.`,
    },
  }));
  const batchResult = await applyArticle(api, batchService, batchCandidates);
  assert.equal(batchResult.added, 20);
  assert.equal(batchTransactionCount, 5, 'twenty article candidates should use five short canonical learning transactions');
  assert.equal(individualTransactionCount, 0, 'batch article settlement must not open one transaction per state command');
  assert.equal(batchVocabularySnapshotWrites, 1, 'twenty article candidates should finalize the legacy vocabulary snapshot once');
  assertCanonicalReviewCount(batchRunner.snapshot(), 20, 'batch settlement should commit one canonical review state per candidate');
  const batchAcquisitionRow = batchRunner.snapshot()
    .find((row) => row.id === 'vocabulary.acquisition.store.v1');
  assert.equal(Object.keys(batchAcquisitionRow?.content?.by_learning_unit_id || {}).length, 20);
  assert.ok(Object.values(batchAcquisitionRow.content.by_learning_unit_id)
    .every((pair) => pair.acquisition_state.status === 'graduated'));
  assert.equal(first.selectedCount, 1);
  const legacySnapshot = await vocabularyRepository.loadSnapshot();
  assert.equal(legacySnapshot.words.length, 1);
  assert.equal(legacySnapshot.contexts.length, 1, 'legacy context remains available for settlement restore');
  const firstCanonicalRows = runner.snapshot();
  assertCanonicalReviewCount(firstCanonicalRows, 1, 'confirmed article learning should create one canonical review state');

  const acquisitionRow = runner.snapshot()
    .find((row) => row.id === 'vocabulary.acquisition.store.v1');
  const pairs = Object.values(acquisitionRow.content.by_learning_unit_id);
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].acquisition_state.status, 'graduated');
  assert.equal(pairs[0].learning_unit.target_sense.normalized_gloss, '地震的');
  const existingContextResult = await applyArticle(api, service, [candidate()]);
  assert.deepEqual(existingContextResult.alreadyAppliedTargetIds, ['article-target-1']);
  assert.equal(existingContextResult.selectedCount, 0);
  assert.equal(
    Object.keys(runner.snapshot()
      .find((row) => row.id === 'vocabulary.acquisition.store.v1')
      .content.by_learning_unit_id).length,
    1,
    'existing article context must reuse the same acquisition unit',
  );

  const retryVocabularyRepository = api.createInMemoryVocabularyRepository();
  const retryRunner = api.createInMemoryVocabularyLearningUnitOfWorkRunner({ now: () => now });
  const retryReader = createAcquisitionReader(retryRunner.snapshot);
  const retryAcquisitionService = api.createVocabularyAcquisitionService({
    enabled: true,
    runUnitOfWork: retryRunner.run,
    now: () => now,
  });
  let failAttachOnce = true;
  const retryService = api.createVocabularyService({
    repository: retryVocabularyRepository,
    scheduler: schedulerStub(),
    now: () => new Date(now),
    acquisitionEnabled: true,
    acquisitionRepository: retryReader,
    acquisitionService: {
      ...retryAcquisitionService,
      async attachContextEvidence(command) {
        if (failAttachOnce) {
          failAttachOnce = false;
          throw new Error('injected article acquisition failure');
        }
        return retryAcquisitionService.attachContextEvidence(command);
      },
    },
  });
  const pendingRepository = api.createInMemorySrsPendingCandidatesRepository();
  await pendingRepository.setPendingCandidates('article-retry', {
    candidates: [candidate()],
    excluded: [],
    created_at: now,
    updated_at: now,
  });
  await assert.rejects(
    () => applyArticle(api, retryService, [candidate()]),
    /injected article acquisition failure/u,
    'article settlement errors must remain visible to the caller',
  );
  const pendingAfterFailure = await pendingRepository.getPendingCandidates('article-retry');
  assert.equal(pendingAfterFailure.candidates.length, 1, 'failed article candidate must remain recoverable');
  assertNoReviewRows(
    await retryVocabularyRepository.loadSnapshot(),
    retryRunner.snapshot(),
    'failed article candidate before retry',
  );
  const partialPair = Object.values(retryRunner.snapshot()
    .find((row) => row.id === 'vocabulary.acquisition.store.v1')
    .content.by_learning_unit_id)[0];
  assert.equal(partialPair.acquisition_state.status, 'introduced');
  const retryResult = await applyArticle(api, retryService, pendingAfterFailure.candidates);
  assert.equal(retryResult.selectedCount, 1);
  assert.equal(
    Object.values(retryRunner.snapshot()
      .find((row) => row.id === 'vocabulary.acquisition.store.v1')
      .content.by_learning_unit_id)[0].acquisition_state.status,
    'graduated',
  );
  assertCanonicalReviewCount(
    retryRunner.snapshot(),
    1,
    'recovered article candidate should enter canonical review',
  );

  const reconciliationVocabularyRepository = api.createInMemoryVocabularyRepository();
  const reconciliationRunner = api.createInMemoryVocabularyLearningUnitOfWorkRunner({ now: () => now });
  const reconciliationReader = createAcquisitionReader(reconciliationRunner.snapshot);
  const reconciliationAcquisitionService = api.createVocabularyAcquisitionService({
    enabled: true,
    runUnitOfWork: reconciliationRunner.run,
    now: () => now,
  });
  const interruptedArticleService = api.createVocabularyService({
    repository: reconciliationVocabularyRepository,
    scheduler: schedulerStub(),
    now: () => new Date(now),
    acquisitionEnabled: true,
    acquisitionRepository: reconciliationReader,
    acquisitionService: {
      ...reconciliationAcquisitionService,
      async completeArticleLearning() {
        throw new Error('simulated pre-direct-review article state');
      },
    },
  });
  await assert.rejects(
    () => applyArticle(api, interruptedArticleService, [candidate({ target_id: 'article-reconcile' })]),
    /simulated pre-direct-review article state/u,
  );
  const pendingArticlePair = Object.values((await reconciliationReader.loadSnapshot()).by_learning_unit_id)[0];
  const pendingArticleKind = pendingArticlePair.learning_unit.extensions.source;
  assert.equal(pendingArticleKind, 'article-settlement');
  assert.equal(pendingArticlePair.acquisition_state.status, 'acquiring');
  const reconciliationService = api.createVocabularyService({
    repository: reconciliationVocabularyRepository,
    scheduler: schedulerStub(),
    now: () => new Date(now),
    acquisitionEnabled: true,
    acquisitionRepository: reconciliationReader,
    acquisitionService: reconciliationAcquisitionService,
  });
  const reconciliationResult = await reconciliationService.completePendingArticleLearning();
  assert.equal(reconciliationResult.completed, 1, 'settled historical article words should be reconciled');
  assert.equal(reconciliationResult.remaining, 0);
  assert.equal(
    Object.values((await reconciliationReader.loadSnapshot()).by_learning_unit_id)[0].acquisition_state.status,
    'graduated',
  );
  assertCanonicalReviewCount(
    reconciliationRunner.snapshot(),
    1,
    'reconciled article word should enter canonical review',
  );
  const previewResult = await reconciliationService.queuePreviewVocabularyAcquisition({
    ...candidate({
      target_id: 'preview-must-remain-preview',
      word: 'tectonic',
      lemma: 'tectonic',
      meaning: '构造的',
    }),
    preview_item_id: 'preview-must-remain-preview',
  });
  assert.equal(previewResult.acquisitionState.status, 'acquiring');
  const previewIsolationResult = await reconciliationService.completePendingArticleLearning();
  assert.equal(previewIsolationResult.completed, 0, 'IELTS preview must not use article completion');
  assert.equal(
    (await reconciliationReader.getState(previewResult.learningUnit.learning_unit_id)).status,
    'acquiring',
    'IELTS preview must remain in acquisition until its delayed check',
  );
  assertCanonicalReviewCount(
    reconciliationRunner.snapshot(),
    1,
    'IELTS preview isolation must not create another review state',
  );

  for (const legacyStatus of ['known', 'ignored']) {
    const existingRepository = api.createInMemoryVocabularyRepository();
    const legacyService = api.createVocabularyService({
      repository: existingRepository,
      scheduler: schedulerStub(),
      now: () => new Date(now),
    });
    const existing = await legacyService.addWordLegacy({
      ...candidate(),
      context: null,
      legacyCaller: 'p10-existing-relearn-fixture',
    });
    await existingRepository.updateSnapshot((snapshot) => {
      snapshot.words.find((word) => word.id === existing.id).status = legacyStatus;
    });
    const before = await existingRepository.loadSnapshot();
    const existingRunner = api.createInMemoryVocabularyLearningUnitOfWorkRunner({ now: () => now });
    const existingAcquisitionService = api.createVocabularyAcquisitionService({
      enabled: true,
      runUnitOfWork: existingRunner.run,
      now: () => now,
    });
    const existingService = api.createVocabularyService({
      repository: existingRepository,
      scheduler: schedulerStub(),
      now: () => new Date(now),
      acquisitionEnabled: true,
      acquisitionRepository: createAcquisitionReader(existingRunner.snapshot),
      acquisitionService: existingAcquisitionService,
    });
    existingService.relearnWord = async () => {
      throw new Error('flag-on must not call legacy relearnWord');
    };
    const result = await applyArticle(api, existingService, [candidate({
      existing_word_id: existing.id,
      existing_status: legacyStatus,
      group: 'relearn',
      relearn: true,
      tags: ['focus'],
    })]);
    assert.equal(result.relearned, 0, `flag-on ${legacyStatus} must not report legacy relearn`);
    const after = await existingRepository.loadSnapshot();
    assert.deepEqual(after.reviewStates, before.reviewStates, `flag-on ${legacyStatus} must preserve legacy ReviewState`);
    assert.deepEqual(after.words, before.words, `flag-on ${legacyStatus} must preserve legacy word metadata`);
    assert.equal(after.contexts.length, 1, `flag-on ${legacyStatus} may append the article context`);
    assert.equal(
      Object.keys(existingRunner.snapshot()
        .find((row) => row.id === 'vocabulary.acquisition.store.v1')
        .content.by_learning_unit_id).length,
      1,
      `flag-on ${legacyStatus} should use acquisition state`,
    );
    assertCanonicalReviewCount(
      existingRunner.snapshot(),
      1,
      `flag-on ${legacyStatus} article completion should create review v2`,
    );
  }

  const ignoredSkipRepository = api.createInMemoryVocabularyRepository();
  const ignoredSkipLegacyService = api.createVocabularyService({
    repository: ignoredSkipRepository,
    scheduler: schedulerStub(),
    now: () => new Date(now),
  });
  const ignoredSkipWord = await ignoredSkipLegacyService.addWordLegacy({
    ...candidate(),
    context: null,
    legacyCaller: 'p10-ignored-skip-fixture',
  });
  await ignoredSkipRepository.updateSnapshot((snapshot) => {
    snapshot.words.find((word) => word.id === ignoredSkipWord.id).status = 'ignored';
  });
  const ignoredSkipBefore = await ignoredSkipRepository.loadSnapshot();
  const ignoredSkipService = api.createVocabularyService({
    repository: ignoredSkipRepository,
    scheduler: schedulerStub(),
    now: () => new Date(now),
    acquisitionEnabled: true,
    acquisitionRepository: createAcquisitionReader(() => []),
    acquisitionService: {},
  });
  const ignoredSkipResult = await applyArticle(api, ignoredSkipService, [candidate({
    existing_word_id: ignoredSkipWord.id,
    existing_status: 'ignored',
    relearn: false,
  })]);
  assert.equal(ignoredSkipResult.ignoredSkipped, 1);
  assert.deepEqual(await ignoredSkipRepository.loadSnapshot(), ignoredSkipBefore);

  const graduatedVocabularyRepository = api.createInMemoryVocabularyRepository();
  const existingWord = await api.createVocabularyService({
    repository: graduatedVocabularyRepository,
    scheduler: schedulerStub(),
    now: () => new Date(now),
  }).upsertVocabularyEntry({ ...candidate(), context: null });
  const targetSense = {
    gloss: '地震的',
    normalized_gloss: '地震的',
    part_of_speech: null,
    definition: null,
    language: 'en',
  };
  const targetSenseKey = api.deriveTargetSenseKey(targetSense);
  const graduatedPair = {
    learning_unit: {
      schema_version: 'learning-unit.v1',
      learning_unit_id: 'graduated-unit',
      word_id: existingWord.id,
      normalized_form: 'seismic',
      language: 'en',
      target_sense_id: 'graduated-sense',
      target_sense_key: targetSenseKey,
      target_sense: targetSense,
      created_at: now,
      updated_at: now,
      archived_at: null,
      revision: 3,
      extensions: {},
    },
    acquisition_state: {
      schema_version: 'acquisition-state.v1',
      learning_unit_id: 'graduated-unit',
      status: 'graduated',
      context_evidence_ids: ['graduated-context'],
      validated_anchor_id: 'graduated-context',
      last_acquisition_attempt_id: 'graduated-attempt',
      introduction_episode_id: 'graduated-episode',
      introduced_at: now,
      last_exposure_at: now,
      ready_for_check_at: now,
      graduated_at: now,
      skipped_at: null,
      revision: 4,
      extensions: {},
    },
  };
  const graduatedRows = () => [{
    id: 'vocabulary.acquisition.store.v1',
    content: {
      schema_version: 'acquisition-store.v1',
      by_learning_unit_id: { 'graduated-unit': graduatedPair },
      acquisition_attempts_by_id: {},
    },
  }];
  let acquisitionCommandCalls = 0;
  const graduatedService = api.createVocabularyService({
    repository: graduatedVocabularyRepository,
    scheduler: schedulerStub(),
    now: () => new Date(now),
    acquisitionEnabled: true,
    acquisitionRepository: createAcquisitionReader(graduatedRows),
    acquisitionService: new Proxy({}, {
      get() {
        return async () => {
          acquisitionCommandCalls += 1;
          throw new Error('graduated unit must not receive acquisition commands');
        };
      },
    }),
  });
  const graduatedResult = await applyArticle(api, graduatedService, [candidate({
    existing_word_id: existingWord.id,
  })]);
  assert.equal(acquisitionCommandCalls, 0);
  assert.equal(graduatedResult.relearned, 0);
  assert.equal(graduatedRows()[0].content.by_learning_unit_id['graduated-unit'], graduatedPair);
  assert.equal((await graduatedVocabularyRepository.loadSnapshot()).reviewStates.length, 0);

  const fallbackRepository = api.createInMemoryVocabularyRepository();
  const legacyCalls = [];
  const fallbackService = api.createVocabularyService({
    repository: fallbackRepository,
    scheduler: schedulerStub(),
    now: () => new Date(now),
    onLegacyAddWordCall: (trace) => legacyCalls.push(trace),
  });
  await applyArticle(api, fallbackService, [candidate()]);
  assert.equal((await fallbackRepository.loadSnapshot()).reviewStates.length, 1);
  assert.equal(legacyCalls.length, 1);
  assert.equal(legacyCalls[0].compatibility, api.VOCABULARY_LEGACY_ADD_WORD_COMPATIBILITY);

  console.log('Vocabulary article acquisition migration checks passed.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
