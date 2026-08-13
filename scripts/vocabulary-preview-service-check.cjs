const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

async function importVocabularyApi(repoRoot) {
  const sourceDir = path.join(repoRoot, 'src', 'services', 'vocabulary');
  const files = [
    'vocabulary-models.js',
    'vocabulary-repository.js',
    'vocabulary-persistence.js',
    'srs-candidates.js',
    'srs-pending-candidates.js',
    'preview-scan.js',
    'article-srs-settlement.js',
    'article-srs-settlement-progress.js',
    'settlement-meaning-refinement.js',
    'srs-scheduler.js',
    'vocabulary-learning-models.js',
    'vocabulary-acquisition-repository.js',
    'vocabulary-context-evidence.js',
    'vocabulary-learning-events.js',
    'legacy-vocabulary-audit.js',
    'vocabulary-learning-uow.js',
    'vocabulary-acquisition-service.js',
    'srs-review-session-ledger.js',
    'srs-review-service-v2.js',
    'exam-vocabulary-importer.js',
    'exam-vocabulary-context-matcher.js',
    'legacy-vocabulary-reassessment.js',
    'legacy-vocabulary-migration.js',
    'ielts-learning-pools.js',
    'vocabulary-service.js',
    'index.js',
  ];

  const tempDir = fs.mkdtempSync(path.join(repoRoot, `.tmp-vocabulary-preview-${process.pid}-`));
  try {
    const poolConfig = JSON.stringify(JSON.parse(fs.readFileSync(path.join(repoRoot, 'config', 'ielts-learning-pools.json'), 'utf8')));
    files.forEach((file) => {
      let source = fs.readFileSync(path.join(sourceDir, file), 'utf8')
        .replace(/from '\.\/([^']+)\.js'/g, "from './$1.mjs'")
        .replace(/from \"\.\/([^\"]+)\.js\"/g, 'from "./$1.mjs"')
        .replace(/from '\.\.\/\.\.\/features\/srs-review\/srs-review-policy\.js'/g, "from './srs-review-policy.mjs'")
        .replace(/from '\.\.\/\.\.\/features\/srs-review\/srs-session-planner\.js'/g, "from './srs-session-planner.mjs'");
      if (file === 'ielts-learning-pools.js') {
        source = source.replace(/import poolConfig from '\.\.\/\.\.\/\.\.\/config\/ielts-learning-pools\.json'/, `const poolConfig = ${poolConfig}`);
      }
      if (file === 'index.js') {
        source = source.replace(/export \* from '\.\/personalization\/index\.(?:js|mjs)';/, '');
      }
      fs.writeFileSync(path.join(tempDir, file.replace(/\.js$/, '.mjs')), source);
    });
    fs.writeFileSync(
      path.join(tempDir, 'srs-review-policy.mjs'),
      fs.readFileSync(path.join(repoRoot, 'src', 'features', 'srs-review', 'srs-review-policy.js'), 'utf8'),
    );
    fs.writeFileSync(
      path.join(tempDir, 'srs-session-planner.mjs'),
      fs.readFileSync(path.join(repoRoot, 'src', 'features', 'srs-review', 'srs-session-planner.js'), 'utf8')
        .replace(/from '\.\/srs-review-policy\.js'/g, "from './srs-review-policy.mjs'"),
    );
    return await import(`${pathToFileURL(path.join(tempDir, 'index.mjs')).href}#${Date.now()}`);
  } finally {
    const resolvedTemp = path.resolve(tempDir);
    const resolvedRepo = path.resolve(repoRoot);
    if (resolvedTemp.startsWith(resolvedRepo + path.sep)) {
      fs.rmSync(resolvedTemp, { recursive: true, force: true });
    }
  }
}

function createPreviewState() {
  const words = [
    'The',
    'earthquake',
    'triggered',
    'seismic',
    'seismic',
    'waves',
    'near',
    'California',
    'tectonic',
    'tectonic',
    'plates',
    'grill',
  ].map((word, index) => ({ word, globalIndex: index }));
  return {
    currentAudioKey: 'audio-preview',
    documentId: 'doc-preview',
    segments: [{
      id: 'segment-1',
      text: 'The earthquake triggered seismic seismic waves near California tectonic tectonic plates grill.',
      words,
    }],
  };
}

function createPreviewStateFromWords(tokens) {
  return {
    currentAudioKey: 'audio-preview-filter',
    documentId: 'doc-preview-filter',
    segments: [{
      id: 'segment-filter',
      text: tokens.join(' '),
      words: tokens.map((word, globalIndex) => ({ word, globalIndex })),
    }],
  };
}

function createManualItem(targetId, markedText, meaning, extra = {}) {
  return {
    targetId,
    markedText,
    boundary: markedText,
    type: extra.type || 'word',
    meaning,
    simpleMeaning: extra.simpleMeaning || null,
    sourceSentence: extra.sourceSentence || `${markedText} appears in context.`,
    source: extra.source || 'manual_annotation',
    ...extra,
  };
}

async function createService(api, initialSnapshot) {
  const repository = api.createInMemoryVocabularyRepository(initialSnapshot);
  const service = api.createVocabularyService({
    repository,
    scheduler: api.createSrsScheduler({ enable_fuzz: false }),
    now: () => new Date('2026-07-10T00:00:00.000Z'),
  });
  return { repository, service };
}

async function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const api = await importVocabularyApi(repoRoot);

  const previewState = createPreviewState();
  const scan = await api.buildPreviewScan({
    state: previewState,
    sourceId: 'article-preview',
    sourceTitle: 'Earthquake Article',
    sourceUrl: 'https://example.test/earthquake',
    markedMap: new Map([[1, true]]),
    generatedItems: [{
      targetId: 'preview-existing',
      source: api.PREVIEW_SCAN_SOURCE,
      markedText: 'plates',
      occurrenceGlobalStart: 10,
      occurrenceGlobalEnd: 10,
    }],
    vocabularyService: {
      async getWordByLemma(lemma) {
        return lemma === 'grill' ? { id: 'word-grill', lemma: 'grill', status: 'learning' } : null;
      },
    },
    maxCount: 20,
  });

  const previewLemmas = scan.candidates.map((candidate) => candidate.lemma);
  assert.ok(previewLemmas.includes('seismic'), 'preview scan should include high-value unknown words');
  assert.ok(previewLemmas.includes('tectonic'), 'preview scan should include repeated article vocabulary');
  assert.ok(previewLemmas.includes('california'), 'preview scan may include likely proper nouns in a separate group');
  assert.equal(previewLemmas.includes('earthquake'), false, 'manually marked words should not be preview-scan candidates');
  assert.equal(previewLemmas.includes('plates'), false, 'already explained preview words should not be re-sent');
  assert.equal(previewLemmas.includes('grill'), false, 'existing SRS entries should not be preview-scan candidates');
  assert.equal(scan.summary.properNounCount, 1);
  assert.ok(scan.excluded.some((item) => item.reason === 'already_explained_current_article'));
  assert.ok(scan.excluded.some((item) => item.reason === 'vocabulary_learning'));

  const lightweightFilterScan = await api.buildPreviewScan({
    state: createPreviewStateFromWords([
      'Bus',
      'three',
      'cars',
      'hour',
      'video',
      "He'll",
      'happened',
      'recovering',
      'seismic',
      'devastating',
      'slammed',
      'into',
      'Florida',
    ]),
    sourceId: 'article-lightweight-filter',
    maxCount: 20,
  });
  const filteredLemmas = lightweightFilterScan.candidates.map((candidate) => candidate.lemma);
  ['bus', 'three', 'car', 'hour', 'video', 'he', 'happen', 'recover'].forEach((lemma) => {
    assert.equal(filteredLemmas.includes(lemma), false, `${lemma} should be filtered as common vocabulary`);
  });
  assert.ok(filteredLemmas.includes('seismic'), 'B2+ vocabulary should remain in preview candidates');
  assert.ok(filteredLemmas.includes('devastating'), 'news-relevant vocabulary should remain in preview candidates');
  assert.ok(filteredLemmas.includes('slam into'), 'allowlisted news expressions should remain in preview candidates');
  assert.ok(
    lightweightFilterScan.candidates.some((candidate) => candidate.lemma === 'florida' && candidate.group === api.PREVIEW_SCAN_GROUPS.PROPER_NOUN),
    'proper nouns should remain in a separate preview group'
  );

  const enrichedPreviewCandidates = scan.candidates.map((candidate, index) => index === 0 ? {
    ...candidate,
    dictionarySuggestion: {
      available: true,
      matchedBy: 'exact',
      directMatch: { word: candidate.lemma, translation: 'must stay transient' },
      normalizedCandidates: [],
      lemmaCandidates: [],
    },
  } : candidate);
  const template = api.buildPreviewAnnotationTemplate({
    context: scan.context,
    candidates: enrichedPreviewCandidates,
    articleId: 'article-preview',
  });
  assert.equal(template.source, api.PREVIEW_SCAN_SOURCE);
  assert.equal(template.items.length, scan.candidates.length);
  assert.equal(template.items.every((item) => item.previewSource === api.PREVIEW_SCAN_SOURCE), true);
  assert.equal(JSON.stringify(template).includes('dictionarySuggestion'), false);
  assert.equal(JSON.stringify(template).includes('must stay transient'), false);

  const seismicCandidate = scan.candidates.find((candidate) => candidate.lemma === 'seismic');
  const californiaCandidate = scan.candidates.find((candidate) => candidate.lemma === 'california');
  const generated = api.buildPreviewGeneratedItemsFromResult({
    candidates: enrichedPreviewCandidates,
    result: {
      items: [{
        targetId: seismicCandidate.targetId,
        markedText: seismicCandidate.markedText,
        meaning: 'In this article, seismic means related to earthquakes.',
        simpleMeaning: 'earthquake-related',
      }, {
        targetId: californiaCandidate.targetId,
        markedText: californiaCandidate.markedText,
        meaning: 'A location name in the article.',
        simpleMeaning: 'a place',
      }, {
        targetId: 'not-requested',
        markedText: 'ignored',
        meaning: 'ignored',
      }],
    },
  });
  assert.equal(JSON.stringify(generated).includes('dictionarySuggestion'), false);
  assert.equal(JSON.stringify(generated).includes('must stay transient'), false);
  assert.deepEqual(generated.map((item) => item.targetId), [seismicCandidate.targetId, californiaCandidate.targetId]);
  assert.equal(generated[0].source, api.PREVIEW_SCAN_SOURCE);
  assert.equal(generated[0].simpleMeaning, 'earthquake-related');
  assert.equal(generated[0].source_id, 'article-preview');
  assert.deepEqual(
    api.getPreviewWordIndexesFromGeneratedItems([
      ...generated,
      { ...generated[0], targetId: 'preview-seismic-2', occurrenceGlobalStart: 20, occurrenceGlobalEnd: 20 },
      { ...generated[0], targetId: 'preview-seismic-3', occurrenceGlobalStart: 21, occurrenceGlobalEnd: 21 },
    ], { maxPerLemma: 2 }),
    [3, 7, 20]
  );

  const settlementItems = [
    createManualItem('manual-word', 'seismic', 'In this sentence, seismic means earthquake-related.', { simpleMeaning: 'earthquake-related' }),
    createManualItem('manual-phrase', 'take it for granted', 'Treat something as automatically available.', { type: 'phrase' }),
    createManualItem('manual-punctuated-word', 'reunions.', 'Meetings or gatherings again.'),
    createManualItem('manual-punctuated-phrase', 'crust, mantle,', 'Two earth layers listed together.'),
    {
      ...createManualItem('preview-word', 'tectonic', 'In this article, tectonic means related to earth plates.'),
      source: api.PREVIEW_SCAN_SOURCE,
    },
    {
      ...createManualItem('preview-proper', 'California', 'A location name.'),
      source: api.PREVIEW_SCAN_SOURCE,
      is_proper_noun: true,
    },
    createManualItem('manual-long', 'this selected passage is too long to become a vocabulary card now', 'Long explanation.'),
    createManualItem('manual-missing', 'unexplained', ''),
  ];
  const emptyVocabulary = await createService(api);
  const settlement = await api.buildArticleSrsSettlement({
    items: settlementItems,
    vocabularyService: emptyVocabulary.service,
    sourceId: 'article-settlement',
    sourceTitle: 'Settlement Article',
    sourceUrl: 'https://example.test/settlement',
  });
  assert.deepEqual(settlement.candidates.map((candidate) => [candidate.lemma, candidate.entry_type, candidate.source_type]), [
    ['seismic', 'word', 'manual_annotation'],
    ['take it for granted', 'phrase', 'manual_annotation'],
    ['reunions', 'word', 'manual_annotation'],
    ['crust mantle', 'phrase', 'manual_annotation'],
    ['tectonic', 'word', api.PREVIEW_SCAN_SOURCE],
  ]);
  assert.equal(settlement.summary.wordCandidates, 3);
  assert.equal(settlement.summary.phraseCandidates, 2);
  assert.equal(settlement.candidates.find((candidate) => candidate.targetId === 'manual-punctuated-word').markedText, 'reunions');
  assert.equal(settlement.candidates.find((candidate) => candidate.targetId === 'manual-punctuated-phrase').markedText, 'crust mantle');
  assert.ok(settlement.excluded.some((item) => item.reason === 'preview_proper_noun'));
  assert.ok(settlement.excluded.some((item) => item.reason === 'long_text'));
  assert.ok(settlement.excluded.some((item) => item.reason === 'missing_meaning'));
  assert.equal(settlement.candidates[0].context.simple_meaning, 'earthquake-related');
  assert.equal(settlement.candidates[0].context.source_id, 'article-settlement');

  const longMeaningSettlement = await api.buildArticleSrsSettlement({
    items: [createManualItem('manual-compact-meaning', 'dense', '指密度较大的大洋板块，因为岩石成分较重，在碰撞时会下沉。', {
      memoryHint: '词根和联想记忆应该留在要记里，不应该出现在整理生词短释义中。',
    })],
    vocabularyService: emptyVocabulary.service,
    sourceId: 'article-compact-meaning',
  });
  assert.equal(longMeaningSettlement.candidates[0].simple_meaning, null);
  assert.equal(longMeaningSettlement.candidates[0].context.simple_meaning, null);
  assert.equal(longMeaningSettlement.candidates[0].context.meaning, '指密度较大的大洋板块，因为岩石成分较重，在碰撞时会下沉。');
  const refinementTemplate = api.buildSettlementMeaningRefinementTemplate({
    candidates: longMeaningSettlement.candidates,
    sourceId: 'article-compact-meaning',
  });
  assert.equal(refinementTemplate.source, api.SETTLEMENT_MEANING_REFINEMENT_SOURCE);
  assert.equal(refinementTemplate.items.length, 1);
  assert.equal(refinementTemplate.items[0].meaning.length <= 160, true);
  assert.equal(refinementTemplate.items[0].sentence.length <= 220, true);
  assert.equal(refinementTemplate.items[0].markedText, 'dense');
  assert.equal(refinementTemplate.items[0].boundary, 'dense');
  assert.equal(refinementTemplate.items[0].sourceSentence.length <= 220, true);
  const refinementInstructions = refinementTemplate.instructions.join('\n');
  assert.ok(
    refinementInstructions.includes('词汇释义') && refinementInstructions.includes('具体指代'),
    'meaning refinement must translate the selected expression instead of its contextual referent'
  );
  assert.ok(
    refinementTemplate.instructions.some((instruction) => instruction.includes('不可见气体') && instruction.includes('乙烯气体')),
    'meaning refinement should explicitly reject inferring ethylene from the banana article context'
  );
  const referentConflictSettlement = await api.buildArticleSrsSettlement({
    items: [createManualItem(
      'manual-referent-conflict',
      'invisible gas',
      '指乙烯气体，虽然肉眼看不见，但它对水果成熟的影响是显而易见的。',
      {
        type: 'phrase',
        sourceSentence: 'As bananas ripen they produce increasing amounts of this invisible gas.',
        sentenceBefore: 'The key player is a natural plant hormone called ethylene gas.',
        sentenceAfter: 'Ethylene tells the fruit to soften.',
      }
    )],
    vocabularyService: emptyVocabulary.service,
    sourceId: 'article-referent-conflict',
  });
  const referentConflictTemplate = api.buildSettlementMeaningRefinementTemplate({
    candidates: referentConflictSettlement.candidates,
    sourceId: 'article-referent-conflict',
  });
  const referentInstructions = referentConflictTemplate.instructions.join('\n');
  assert.ok(referentInstructions.includes('词汇释义'), 'the task must be defined as a lexical gloss rather than referent summarization');
  assert.ok(referentInstructions.includes('the capital') && referentInstructions.includes('首都') && referentInstructions.includes('北京'), 'few-shot examples should generalize beyond the banana article');
  assert.ok(referentInstructions.includes('ethylene gas') && referentInstructions.includes('乙烯气体'), 'few-shot examples should allow named entities explicitly present in markedText');
  assert.equal(referentInstructions.includes('Why Bananas Ripen So Much Faster Than Other Fruits'), false, 'the contract should not rely on one article-specific exception');
  assert.equal(Object.hasOwn(referentConflictTemplate, 'articleText'), false, 'the refinement request must not upload the full article');
  assert.equal(Object.hasOwn(referentConflictTemplate, 'articleSentences'), false, 'the refinement request must not upload all article sentences');
  assert.equal(referentConflictTemplate.items[0].localContext, [
    'The key player is a natural plant hormone called ethylene gas.',
    'As bananas ripen they produce increasing amounts of this invisible gas.',
    'Ethylene tells the fruit to soften.',
  ].join(' '));
  assert.equal(referentConflictTemplate.items[0].contextualExplanation, '指乙烯气体，虽然肉眼看不见，但它对水果成熟的影响是显而易见的。');
  const refinementStats = api.applySettlementMeaningRefinementResult(longMeaningSettlement.candidates, {
    items: [{ targetId: 'manual-compact-meaning', simpleMeaning: '密度较大' }],
  });
  assert.equal(refinementStats.updated, 1);
  assert.equal(longMeaningSettlement.candidates[0].simple_meaning, '密度较大');
  assert.equal(longMeaningSettlement.candidates[0].context.simple_meaning, '密度较大');
  const rejectedStats = api.applySettlementMeaningRefinementResult(longMeaningSettlement.candidates, {
    items: [{ targetId: 'manual-compact-meaning', simpleMeaning: '这是一个明显超过硬上限的单词释义，不应该写入 SRS' }],
  });
  assert.equal(rejectedStats.rejected, 1);
  assert.equal(longMeaningSettlement.candidates[0].simple_meaning, '密度较大');

  const meaningFieldSettlement = await api.buildArticleSrsSettlement({
    items: [createManualItem('manual-meaning-field', 'buoyant', 'A long contextual explanation that should be refined before SRS.')],
    vocabularyService: emptyVocabulary.service,
    sourceId: 'article-meaning-field',
  });
  const meaningFieldStats = api.applySettlementMeaningRefinementResult(meaningFieldSettlement.candidates, {
    items: [{ targetId: 'manual-meaning-field', meaning: 'light' }],
  });
  assert.equal(meaningFieldStats.updated, 1);
  assert.equal(meaningFieldSettlement.candidates[0].simple_meaning, 'light');

  assert.equal(
    typeof api.createInMemoryArticleSrsSettlementProgressRepository,
    'function',
    'article settlement refinement progress should have a persistent repository'
  );
  const settlementProgressRepository = api.createInMemoryArticleSrsSettlementProgressRepository();
  await settlementProgressRepository.recordRefinement('article-meaning-field', meaningFieldSettlement.candidates, {
    refinedAt: '2026-07-10T01:00:00.000Z',
  });
  const rebuiltMeaningFieldSettlement = await api.buildArticleSrsSettlement({
    items: [createManualItem('manual-meaning-field', 'buoyant', 'A long contextual explanation that should be refined before SRS.')],
    vocabularyService: emptyVocabulary.service,
    sourceId: 'article-meaning-field',
  });
  const restoredMeaningFieldSettlement = api.applyArticleSrsSettlementProgress(
    rebuiltMeaningFieldSettlement,
    await settlementProgressRepository.getProgress('article-meaning-field')
  );
  assert.equal(restoredMeaningFieldSettlement.candidates[0].simple_meaning, 'light');
  assert.equal(restoredMeaningFieldSettlement.candidates[0].context.simple_meaning, 'light');
  assert.equal(restoredMeaningFieldSettlement.candidates[0].refinement_attempted, true);
  assert.equal(api.getSettlementMeaningRefinementCandidates(restoredMeaningFieldSettlement.candidates).length, 0);
  const stalePromptRepository = api.createInMemoryArticleSrsSettlementProgressRepository({
    schemaVersion: 1,
    articles: {
      'article-stale-prompt': {
        article_id: 'article-stale-prompt',
        refinements: [{
          target_id: 'manual-stale-meaning',
          simple_meaning: '乙烯气体',
          status: 'completed',
          attempted_at: '2026-07-10T00:30:00.000Z',
          completed_at: '2026-07-10T00:30:01.000Z',
        }],
      },
    },
  });
  const stalePromptSettlement = await api.buildArticleSrsSettlement({
    items: [createManualItem('manual-stale-meaning', 'invisible gas', '不可见气体', {
      type: 'phrase',
      sourceSentence: 'As bananas ripen they produce increasing amounts of this invisible gas.',
    })],
    vocabularyService: emptyVocabulary.service,
    sourceId: 'article-stale-prompt',
  });
  const stalePromptRestored = api.applyArticleSrsSettlementProgress(
    stalePromptSettlement,
    await stalePromptRepository.getProgress('article-stale-prompt')
  );
  assert.equal(stalePromptRestored.candidates[0].simple_meaning, null, 'old prompt results should not keep a known over-specific meaning');
  assert.equal(api.getSettlementMeaningRefinementCandidates(stalePromptRestored.candidates).length, 1, 'a prompt revision should allow one explicit re-refinement');
  assert.equal(api.getArticleSrsSettlementProgressStatus(stalePromptRestored.progress), 'none', 'stale refinement should not show the current prompt as completed');
  const revisedPromptClaim = await stalePromptRepository.claimRefinementAttempt('article-stale-prompt', stalePromptRestored.candidates, {
    claimToken: 'revised-prompt',
  });
  assert.deepEqual(revisedPromptClaim.claimedTargetIds, ['manual-stale-meaning']);
  assert.equal(typeof api.createArticleSrsSettlementProgressRepository, 'function');
  assert.equal(typeof api.createIndexedDbArticleSrsSettlementProgressRepository, 'function');
  let persistedSettlementProgressStore = null;
  const persistentProgressStorage = {
    async loadStore() {
      return persistedSettlementProgressStore;
    },
    async saveStore(nextStore) {
      persistedSettlementProgressStore = JSON.parse(JSON.stringify(nextStore));
    },
  };
  const firstProgressSession = api.createArticleSrsSettlementProgressRepository(persistentProgressStorage);
  await firstProgressSession.recordRefinement('article-persisted', meaningFieldSettlement.candidates, {
    refinedAt: '2026-07-10T01:30:00.000Z',
  });
  const secondProgressSession = api.createArticleSrsSettlementProgressRepository(persistentProgressStorage);
  const persistedProgress = await secondProgressSession.getProgress('article-persisted');
  assert.equal(persistedProgress.refinements[0].simple_meaning, 'light');
  assert.equal(api.getArticleSrsSettlementProgressStatus(persistedProgress), 'refined');

  const concurrentProgressRepository = api.createInMemoryArticleSrsSettlementProgressRepository();
  const [concurrentRefinementClaim] = await Promise.all([
    concurrentProgressRepository.claimRefinementAttempt('article-concurrent', [{ targetId: 'target-refine' }], {
      claimToken: 'refine-concurrent',
      attemptedAt: '2026-07-10T01:40:00.000Z',
    }),
    concurrentProgressRepository.recordApplication('article-concurrent', {
      appliedTargetIds: ['target-applied'],
      mode: 'all',
      appliedAt: '2026-07-10T01:41:00.000Z',
    }),
  ]);
  const concurrentProgress = await concurrentProgressRepository.getProgress('article-concurrent');
  assert.deepEqual(concurrentProgress.applied_target_ids, ['target-applied']);
  assert.equal(concurrentProgress.refinements[0].target_id, 'target-refine');
  assert.equal(concurrentProgress.refinements[0].status, 'pending');
  await concurrentProgressRepository.recordRefinementFailure('article-concurrent', [{ targetId: 'target-refine' }], new Error('network failed'), {
    claimToken: concurrentRefinementClaim.claimToken,
    failedAt: '2026-07-10T01:42:00.000Z',
  });
  const failedProgress = await concurrentProgressRepository.getProgress('article-concurrent');
  assert.equal(api.getArticleSrsSettlementProgressStatus(failedProgress), 'processed');

  const failedRefinementRepository = api.createInMemoryArticleSrsSettlementProgressRepository();
  const failedRefinementClaim = await failedRefinementRepository.claimRefinementAttempt('article-meaning-field', rebuiltMeaningFieldSettlement.candidates, {
    claimToken: 'refine-first',
  });
  const duplicateRefinementClaim = await failedRefinementRepository.claimRefinementAttempt('article-meaning-field', rebuiltMeaningFieldSettlement.candidates, {
    claimToken: 'refine-duplicate',
  });
  assert.deepEqual(failedRefinementClaim.claimedTargetIds, ['manual-meaning-field']);
  assert.deepEqual(duplicateRefinementClaim.claimedTargetIds, [], 'a second tab must not dispatch the same refinement request');
  assert.equal(
    api.getArticleSrsSettlementProgressStatus(await failedRefinementRepository.getProgress('article-meaning-field')),
    'refinement_pending'
  );
  await failedRefinementRepository.recordRefinementFailure('article-meaning-field', rebuiltMeaningFieldSettlement.candidates, new Error('network failed'), {
    claimToken: failedRefinementClaim.claimToken,
  });
  const retryRefinementClaim = await failedRefinementRepository.claimRefinementAttempt('article-meaning-field', rebuiltMeaningFieldSettlement.candidates, {
    claimToken: 'refine-retry',
  });
  assert.deepEqual(retryRefinementClaim.claimedTargetIds, ['manual-meaning-field'], 'failed refinement should be claimable only by an explicit retry');
  await failedRefinementRepository.recordRefinementFailure('article-meaning-field', rebuiltMeaningFieldSettlement.candidates, new Error('retry failed'), {
    claimToken: retryRefinementClaim.claimToken,
  });
  const failedRefinementSettlement = api.applyArticleSrsSettlementProgress(
    rebuiltMeaningFieldSettlement,
    await failedRefinementRepository.getProgress('article-meaning-field')
  );
  assert.equal(failedRefinementSettlement.candidates[0].refinement_status, 'failed');
  assert.equal(api.getSettlementMeaningRefinementCandidates(failedRefinementSettlement.candidates).length, 1, 'failed refinement should require an explicit user retry');
  assert.equal(api.getArticleSrsSettlementProgressStatus(failedRefinementSettlement.progress), 'refinement_failed');

  const firstClaim = await concurrentProgressRepository.claimApplication('article-claim', {
    candidateTargetIds: ['target-once'],
    claimToken: 'apply-first',
    claimedAt: '2026-07-10T01:50:00.000Z',
  });
  const duplicateClaim = await concurrentProgressRepository.claimApplication('article-claim', {
    candidateTargetIds: ['target-once'],
    claimToken: 'apply-duplicate',
    claimedAt: '2026-07-10T01:50:01.000Z',
  });
  assert.deepEqual(firstClaim.claimedTargetIds, ['target-once']);
  assert.deepEqual(duplicateClaim.claimedTargetIds, [], 'a stale second dialog must not claim the same target');
  await concurrentProgressRepository.recordApplication('article-claim', {
    appliedTargetIds: firstClaim.claimedTargetIds,
    claimToken: firstClaim.claimToken,
    appliedAt: '2026-07-10T01:51:00.000Z',
  });
  const claimedProgress = await concurrentProgressRepository.getProgress('article-claim');
  assert.deepEqual(claimedProgress.applied_target_ids, ['target-once']);
  assert.deepEqual(claimedProgress.application_claims, []);

  const expiredFirstClaim = await concurrentProgressRepository.claimApplication('article-claim-ownership', {
    candidateTargetIds: ['target-owned'],
    claimToken: 'owner-a',
    claimedAt: '2026-07-10T02:00:00.000Z',
  });
  const replacementClaim = await concurrentProgressRepository.claimApplication('article-claim-ownership', {
    candidateTargetIds: ['target-owned'],
    claimToken: 'owner-b',
    claimedAt: '2026-07-10T02:16:00.000Z',
  });
  assert.deepEqual(expiredFirstClaim.claimedTargetIds, ['target-owned']);
  assert.deepEqual(replacementClaim.claimedTargetIds, ['target-owned']);
  await concurrentProgressRepository.releaseApplicationClaim('article-claim-ownership', ['target-owned'], { claimToken: 'owner-a' });
  await concurrentProgressRepository.recordApplication('article-claim-ownership', {
    appliedTargetIds: ['target-owned'],
    claimToken: 'owner-a',
  });
  const ownershipProgress = await concurrentProgressRepository.getProgress('article-claim-ownership');
  assert.equal(ownershipProgress.application_claims[0].claim_token, 'owner-b', 'an expired owner must not release or finalize a replacement claim');
  assert.deepEqual(ownershipProgress.applied_target_ids, []);

  await settlementProgressRepository.setCandidateRemoved('article-settlement', 'manual-phrase', true, {
    updatedAt: '2026-07-10T01:59:00.000Z',
  });
  const draftRemovedSettlement = api.applyArticleSrsSettlementProgress(
    settlement,
    await settlementProgressRepository.getProgress('article-settlement')
  );
  assert.equal(draftRemovedSettlement.candidates.length, settlement.candidates.length, 'draft removal should keep the gray candidate visible');
  assert.deepEqual(draftRemovedSettlement.removedTargetIds, ['manual-phrase']);
  await settlementProgressRepository.setCandidateRemoved('article-settlement', 'manual-phrase', false, {
    updatedAt: '2026-07-10T01:59:30.000Z',
  });
  assert.deepEqual(
    api.applyArticleSrsSettlementProgress(
      settlement,
      await settlementProgressRepository.getProgress('article-settlement')
    ).removedTargetIds,
    [],
    'clicking the gray candidate again should persistently restore it'
  );

  await settlementProgressRepository.recordApplication('article-settlement', {
    appliedTargetIds: ['manual-word', 'manual-punctuated-word'],
    skippedTargetIds: ['preview-word'],
    mode: 'words',
    appliedAt: '2026-07-10T02:00:00.000Z',
  });
  const partiallyRestoredSettlement = api.applyArticleSrsSettlementProgress(
    settlement,
    await settlementProgressRepository.getProgress('article-settlement')
  );
  assert.deepEqual(
    partiallyRestoredSettlement.candidates.map((candidate) => candidate.targetId),
    ['manual-phrase', 'manual-punctuated-phrase'],
    'already applied or explicitly removed candidates should not be offered again after reload'
  );
  assert.equal(partiallyRestoredSettlement.summary.wordCandidates, 0);
  assert.equal(partiallyRestoredSettlement.summary.phraseCandidates, 2);
  assert.equal(partiallyRestoredSettlement.summary.processed, 3);
  assert.equal(partiallyRestoredSettlement.summary.completed, false);
  assert.equal(
    api.getArticleSrsSettlementProgressStatus(await settlementProgressRepository.getProgress('article-settlement')),
    'processed'
  );

  await settlementProgressRepository.recordSkip('article-settlement', {
    skippedTargetIds: ['manual-phrase', 'manual-punctuated-phrase'],
    skippedAt: '2026-07-10T03:00:00.000Z',
  });
  const completedSettlement = api.applyArticleSrsSettlementProgress(
    settlement,
    await settlementProgressRepository.getProgress('article-settlement')
  );
  assert.equal(completedSettlement.candidates.length, 0);
  assert.equal(completedSettlement.summary.processed, 5);
  assert.equal(completedSettlement.summary.completed, true);

  const wordsOnlyVocabulary = await createService(api);
  const wordsOnlySelection = api.selectArticleSrsSettlementCandidates({
    candidates: settlement.candidates,
    mode: 'words',
    removedTargetIds: ['preview-word'],
  });
  assert.deepEqual(wordsOnlySelection.selectedTargetIds, ['manual-word', 'manual-punctuated-word']);
  assert.deepEqual(wordsOnlySelection.removedTargetIds, ['preview-word']);
  const wordsOnlyResult = await api.applyArticleSrsSettlement({
    vocabularyService: wordsOnlyVocabulary.service,
    candidates: settlement.candidates,
    mode: 'words',
  });
  assert.equal(wordsOnlyResult.added, 3);
  assert.deepEqual(wordsOnlyResult.selectedTargetIds, ['manual-word', 'manual-punctuated-word', 'preview-word']);
  assert.equal(await wordsOnlyVocabulary.service.getWordByLemma('take it for granted'), null);
  assert.ok(await wordsOnlyVocabulary.service.getWordByLemma('reunions'));

  const allVocabulary = await createService(api);
  const allResult = await api.applyArticleSrsSettlement({
    vocabularyService: allVocabulary.service,
    candidates: settlement.candidates,
    mode: 'all',
    removedTargetIds: ['preview-word'],
  });
  assert.equal(allResult.added, 4);
  assert.deepEqual(allResult.selectedTargetIds, ['manual-word', 'manual-phrase', 'manual-punctuated-word', 'manual-punctuated-phrase']);
  assert.deepEqual(allResult.removedTargetIds, ['preview-word']);
  assert.ok(await allVocabulary.service.getWordByLemma('seismic'));
  assert.ok(await allVocabulary.service.getWordByLemma('take it for granted'));
  assert.ok(await allVocabulary.service.getWordByLemma('crust mantle'));
  assert.equal(await allVocabulary.service.getWordByLemma('tectonic'), null, 'per-item removed candidates should not be applied');
  const rebuiltAfterPartialApply = await api.buildArticleSrsSettlement({
    items: settlementItems,
    vocabularyService: allVocabulary.service,
    sourceId: 'article-settlement',
    sourceTitle: 'Settlement Article',
    sourceUrl: 'https://example.test/settlement',
  });
  assert.deepEqual(
    rebuiltAfterPartialApply.candidates.map((candidate) => candidate.targetId),
    ['preview-word'],
    'contexts already saved from this article should be inferred as processed even before progress tracking existed'
  );
  assert.equal(rebuiltAfterPartialApply.summary.processed, 4);
  assert.equal(rebuiltAfterPartialApply.summary.completed, false);

  const legacyCompletedVocabulary = await createService(api);
  await api.applyArticleSrsSettlement({
    vocabularyService: legacyCompletedVocabulary.service,
    candidates: settlement.candidates,
    mode: 'all',
  });
  const rebuiltAfterCompleteApply = await api.buildArticleSrsSettlement({
    items: settlementItems,
    vocabularyService: legacyCompletedVocabulary.service,
    sourceId: 'article-settlement',
    sourceTitle: 'Settlement Article',
    sourceUrl: 'https://example.test/settlement',
  });
  assert.equal(rebuiltAfterCompleteApply.candidates.length, 0);
  assert.equal(rebuiltAfterCompleteApply.summary.processed, 5);
  assert.equal(rebuiltAfterCompleteApply.summary.completed, true);
  const staleRepeatResult = await api.applyArticleSrsSettlement({
    vocabularyService: legacyCompletedVocabulary.service,
    candidates: settlement.candidates,
    mode: 'all',
  });
  assert.equal(staleRepeatResult.selectedCount, 0, 'a stale dialog should re-check same-article contexts before applying');
  assert.deepEqual(staleRepeatResult.alreadyAppliedTargetIds, [
    'manual-word',
    'manual-phrase',
    'manual-punctuated-word',
    'manual-punctuated-phrase',
    'preview-word',
  ]);

  const fallbackOnlyVocabulary = await createService(api);
  await fallbackOnlyVocabulary.service.addWordLegacy({
    word: 'fallbackterm',
    lemma: 'fallbackterm',
    context: {
      sentence: 'fallbackterm appears in context.',
      meaning: 'An older context without an explicit source id.',
      source_url: 'https://example.test/fallback-source',
    },
  });
  const fallbackOnlySettlement = await api.buildArticleSrsSettlement({
    items: [createManualItem('manual-fallback-source', 'fallbackterm', 'Current article explanation.')],
    vocabularyService: fallbackOnlyVocabulary.service,
    sourceId: 'https://example.test/fallback-source',
  });
  assert.equal(fallbackOnlySettlement.candidates.length, 1, 'legacy inference must require explicit source_id instead of URL/title fallback');

  const knownPreview = await createService(api);
  const knownWord = await knownPreview.service.addWordLegacy({ word: 'knownterm', lemma: 'knownterm', createdAt: '2026-07-08T00:00:00.000Z' });
  await knownPreview.service.markWordKnown(knownWord.id, '2026-07-08T01:00:00.000Z');
  const knownPreviewSettlement = await api.buildArticleSrsSettlement({
    items: [{
      ...createManualItem('preview-known', 'knownterm', 'Known preview explanation.'),
      source: api.PREVIEW_SCAN_SOURCE,
    }],
    vocabularyService: knownPreview.service,
    sourceId: 'article-known-preview',
  });
  assert.equal(knownPreviewSettlement.candidates.length, 0);
  assert.equal(knownPreviewSettlement.excluded[0].reason, 'known_preview');

  const knownManual = await createService(api);
  const knownManualWord = await knownManual.service.addWordLegacy({ word: 'knownterm', lemma: 'knownterm', createdAt: '2026-07-08T00:00:00.000Z' });
  await knownManual.service.markWordKnown(knownManualWord.id, '2026-07-08T01:00:00.000Z');
  const knownRelearnSettlement = await api.buildArticleSrsSettlement({
    items: [createManualItem('manual-known', 'knownterm', 'I forgot this known word in context.')],
    vocabularyService: knownManual.service,
    sourceId: 'article-known-b',
  });
  assert.equal(knownRelearnSettlement.candidates[0].group, api.ARTICLE_SRS_SETTLEMENT_GROUPS.RELEARN);
  assert.equal(knownRelearnSettlement.candidates[0].relearn, true);

  const knownFocus = await createService(api);
  const knownFocusWord = await knownFocus.service.addWordLegacy({ word: 'focusknown', lemma: 'focusknown', createdAt: '2026-07-08T00:00:00.000Z' });
  await knownFocus.service.markWordKnown(knownFocusWord.id, '2026-07-08T01:00:00.000Z');
  await knownFocus.service.addWordLegacy({
    word: 'focusknown',
    lemma: 'focusknown',
    context: { sentence: 'Focusknown appeared in another article.', meaning: 'Missed before.', source_id: 'article-known-b' },
    createdAt: '2026-07-09T00:00:00.000Z',
  });
  const knownFocusSettlement = await api.buildArticleSrsSettlement({
    items: [createManualItem('manual-known-focus', 'focusknown', 'I missed this known word again.')],
    vocabularyService: knownFocus.service,
    sourceId: 'article-known-c',
  });
  assert.equal(knownFocusSettlement.candidates[0].group, api.ARTICLE_SRS_SETTLEMENT_GROUPS.FOCUS);
  assert.deepEqual(knownFocusSettlement.candidates[0].tags, ['focus']);

  const ignoredManual = await createService(api);
  const ignoredWord = await ignoredManual.service.addWordLegacy({ word: 'ignoredterm', lemma: 'ignoredterm', createdAt: '2026-07-08T00:00:00.000Z' });
  await ignoredManual.service.ignoreWord(ignoredWord.id, '2026-07-08T01:00:00.000Z');
  const ignoredFirstSettlement = await api.buildArticleSrsSettlement({
    items: [createManualItem('manual-ignored', 'ignoredterm', 'I marked this ignored word again.')],
    vocabularyService: ignoredManual.service,
    sourceId: 'article-ignored-b',
  });
  assert.equal(ignoredFirstSettlement.candidates[0].group, api.ARTICLE_SRS_SETTLEMENT_GROUPS.NEEDS_EXPLICIT_RELEARN);
  assert.equal(ignoredFirstSettlement.candidates[0].eligible, false);
  const ignoredFirstApply = await api.applyArticleSrsSettlement({
    vocabularyService: ignoredManual.service,
    candidates: ignoredFirstSettlement.candidates,
    mode: 'all',
  });
  assert.equal(ignoredFirstApply.added, 0);
  assert.equal(ignoredFirstApply.signalContextsRecorded, 1);
  assert.equal((await ignoredManual.service.getWordByLemma('ignoredterm')).status, 'ignored');

  const ignoredRelearn = await createService(api);
  const ignoredRelearnWord = await ignoredRelearn.service.addWordLegacy({ word: 'ignoredterm', lemma: 'ignoredterm', createdAt: '2026-07-08T00:00:00.000Z' });
  await ignoredRelearn.service.ignoreWord(ignoredRelearnWord.id, '2026-07-08T01:00:00.000Z');
  await ignoredRelearn.service.addWordLegacy({
    word: 'ignoredterm',
    lemma: 'ignoredterm',
    context: { sentence: 'Ignoredterm appeared after ignore.', meaning: 'Missed once.', source_id: 'article-ignored-b' },
    createdAt: '2026-07-09T00:00:00.000Z',
  });
  const ignoredRelearnSettlement = await api.buildArticleSrsSettlement({
    items: [createManualItem('manual-ignored-relearn', 'ignoredterm', 'I marked this ignored word in a second article.')],
    vocabularyService: ignoredRelearn.service,
    sourceId: 'article-ignored-c',
  });
  assert.equal(ignoredRelearnSettlement.candidates[0].group, api.ARTICLE_SRS_SETTLEMENT_GROUPS.RELEARN);
  assert.equal(ignoredRelearnSettlement.candidates[0].eligible, true);

  const ignoredFocus = await createService(api);
  const ignoredFocusWord = await ignoredFocus.service.addWordLegacy({ word: 'ignoredfocus', lemma: 'ignoredfocus', createdAt: '2026-07-08T00:00:00.000Z' });
  await ignoredFocus.service.ignoreWord(ignoredFocusWord.id, '2026-07-08T01:00:00.000Z');
  await ignoredFocus.service.addWordLegacy({
    word: 'ignoredfocus',
    lemma: 'ignoredfocus',
    context: { sentence: 'Ignoredfocus appeared in article B.', meaning: 'Missed once.', source_id: 'article-b' },
    createdAt: '2026-07-09T00:00:00.000Z',
  });
  await ignoredFocus.service.addWordLegacy({
    word: 'ignoredfocus',
    lemma: 'ignoredfocus',
    context: { sentence: 'Ignoredfocus appeared in article C.', meaning: 'Missed twice.', source_id: 'article-c' },
    createdAt: '2026-07-09T01:00:00.000Z',
  });
  const ignoredFocusSettlement = await api.buildArticleSrsSettlement({
    items: [createManualItem('manual-ignored-focus', 'ignoredfocus', 'I marked this ignored word in a third article.')],
    vocabularyService: ignoredFocus.service,
    sourceId: 'article-d',
  });
  assert.equal(ignoredFocusSettlement.candidates[0].group, api.ARTICLE_SRS_SETTLEMENT_GROUPS.FOCUS);
  assert.deepEqual(ignoredFocusSettlement.candidates[0].tags, ['focus']);

  const previewModuleSource = fs.readFileSync(path.join(repoRoot, 'src', 'composables', 'vocabulary-preview-module.js'), 'utf8');
  const progressModuleSource = fs.readFileSync(path.join(repoRoot, 'src', 'services', 'vocabulary', 'article-srs-settlement-progress.js'), 'utf8');
  assert.ok(previewModuleSource.includes('refinementInFlight'), 'AI refinement should guard against repeated clicks while a request is in flight');
  assert.ok(previewModuleSource.includes('singleRequest: true'), 'AI refinement payload should request a single backend call');
  assert.ok(previewModuleSource.includes('maxApiCalls: 1'), 'AI refinement payload should cap Gemini calls for one refinement run');
  assert.ok(previewModuleSource.includes('createIndexedDbArticleSrsSettlementProgressRepository'), 'article settlement should use persistent progress storage');
  assert.ok(previewModuleSource.includes('applyArticleSrsSettlementProgress'), 'article settlement should restore persisted meanings and processed targets when opened');
  assert.ok(previewModuleSource.includes('settlementProgressRepository.recordRefinement'), 'AI refinement results should be persisted before the dialog is closed');
  assert.ok(previewModuleSource.includes('settlementProgressRepository.recordApplication'), 'applied SRS targets should be persisted to prevent duplicate settlement');
  assert.ok(previewModuleSource.includes('settlementProgressRepository.recordSkip'), 'explicitly skipped settlement targets should stay skipped after reload');
  assert.ok(previewModuleSource.includes('settlementProgressRepository.setCandidateRemoved'), 'per-item X selections should persist immediately instead of waiting for final apply');
  assert.ok(previewModuleSource.includes('getArticleSrsSettlementProgressStatus'), 'the settlement button should reflect persisted article progress');
  assert.ok(previewModuleSource.includes('释义已精简'), 'the settlement button should expose the persisted refinement mark');
  assert.ok(previewModuleSource.includes('本篇已有整理记录'), 'the settlement button should expose persisted processed targets');
  assert.ok(previewModuleSource.includes('articleId: settlement.articleId'), 'dialog actions should keep the article identity captured when the settlement was opened');
  assert.ok(previewModuleSource.includes('options.articleId'), 'async settlement writes should not resolve their progress key from mutable current state after completion');
  assert.ok(previewModuleSource.includes('settlement.summary.processed > 0'), 'legacy same-article SRS contexts should also surface a persistent processed badge after opening');
  assert.ok(previewModuleSource.includes('settlementProgressRepository.claimRefinementAttempt'), 'refinement attempts should be atomically claimed before the backend request is dispatched');
  assert.ok(previewModuleSource.includes('settlementProgressRepository.claimApplication'), 'SRS application should atomically claim targets before writing vocabulary state');
  assert.ok(previewModuleSource.includes('settlementProgressRepository.releaseApplicationClaim'), 'failed SRS writes should release their atomic target claims');
  assert.ok(previewModuleSource.includes('client.runAnnotationBackfill(articleId'), 'refinement backend routing should use the article identity captured by the dialog');
  assert.ok(previewModuleSource.includes('currentIdentity.jobId !== articleId'), 'stale dialogs should be rejected after the current article changes');
  assert.ok(progressModuleSource.includes('transaction.oncomplete'), 'IndexedDB progress writes should resolve only after transaction commit');
  const refinementFailureIndex = previewModuleSource.indexOf('recordRefinementFailure');
  const refinementFailureThrowIndex = previewModuleSource.indexOf('throw apiError', refinementFailureIndex);
  assert.ok(
    refinementFailureIndex >= 0
      && refinementFailureThrowIndex > refinementFailureIndex
      && previewModuleSource.slice(refinementFailureIndex, refinementFailureThrowIndex).includes('refreshSettlementProgressBadge(currentIdentity)'),
    'failed refinement persistence should immediately refresh the visible article badge'
  );
  const apiErrorCatchIndex = previewModuleSource.indexOf('catch (apiError)');
  const completionPersistenceCatchIndex = previewModuleSource.indexOf('catch (progressError)', apiErrorCatchIndex);
  assert.ok(apiErrorCatchIndex >= 0 && completionPersistenceCatchIndex > apiErrorCatchIndex, 'API failures and completed-result persistence failures must have separate recovery paths');

  console.log('vocabulary preview service check passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
