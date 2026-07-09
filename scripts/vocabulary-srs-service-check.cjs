const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

async function importVocabularyApi(repoRoot) {
  const sourceDir = path.join(repoRoot, 'src', 'services', 'vocabulary');
  const files = [
    'vocabulary-models.js',
    'vocabulary-repository.js',
    'srs-candidates.js',
    'srs-pending-candidates.js',
    'srs-scheduler.js',
    'vocabulary-service.js',
    'index.js',
  ];

  files.forEach((file) => {
    assert.ok(fs.existsSync(path.join(sourceDir, file)), `missing vocabulary module: ${file}`);
  });

  const tempDir = fs.mkdtempSync(path.join(repoRoot, `.tmp-vocabulary-srs-${process.pid}-`));
  try {
    files.forEach((file) => {
      const source = fs.readFileSync(path.join(sourceDir, file), 'utf8')
        .replace(/from '\.\/([^']+)\.js'/g, "from './$1.mjs'")
        .replace(/from \"\.\/([^\"]+)\.js\"/g, 'from "./$1.mjs"');
      fs.writeFileSync(path.join(tempDir, file.replace(/\.js$/, '.mjs')), source);
    });

    return await import(`${pathToFileURL(path.join(tempDir, 'index.mjs')).href}#${Date.now()}`);
  } finally {
    const resolvedTemp = path.resolve(tempDir);
    const resolvedRepo = path.resolve(repoRoot);
    if (resolvedTemp.startsWith(resolvedRepo + path.sep)) {
      fs.rmSync(resolvedTemp, { recursive: true, force: true });
    }
  }
}

function assertIsoAfter(actual, floor, message) {
  assert.ok(Date.parse(actual) > Date.parse(floor), message);
}

async function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const api = await importVocabularyApi(repoRoot);

  assert.equal(api.WORD_STATUSES.NEW, 'new');
  assert.equal(api.WORD_STATUSES.LEARNING, 'learning');
  assert.equal(api.WORD_STATUSES.KNOWN, 'known');
  assert.equal(api.WORD_STATUSES.IGNORED, 'ignored');
  assert.equal(api.REVIEW_RATINGS.AGAIN, 'again');
  assert.equal(api.REVIEW_RATINGS.HARD, 'hard');
  assert.equal(api.REVIEW_RATINGS.GOOD, 'good');
  assert.equal(api.REVIEW_RATINGS.EASY, 'easy');
  assert.equal(api.VOCABULARY_ENTRY_TYPES.WORD, 'word');
  assert.equal(api.VOCABULARY_ENTRY_TYPES.PHRASE, 'phrase');

  const repository = api.createInMemoryVocabularyRepository();
  const service = api.createVocabularyService({
    repository,
    scheduler: api.createSrsScheduler({ enable_fuzz: false }),
  });

  const createdAt = '2026-07-09T00:00:00.000Z';
  const first = await service.addWord({
    word: 'Running',
    lemma: 'Run',
    language: 'en',
    meaning: 'move quickly on foot',
    createdAt,
  });

  assert.equal(first.word, 'Running');
  assert.equal(first.lemma, 'Run');
  assert.equal(first.lookup_key, 'run');
  assert.equal(first.entry_type, 'word');
  assert.equal(first.language, 'en');
  assert.equal(first.status, 'new');
  assert.equal(first.created_at, createdAt);

  const firstReviewState = await repository.getReviewState(first.id);
  assert.equal(firstReviewState.word_id, first.id);
  assert.equal(firstReviewState.due_at, createdAt);
  assert.equal(firstReviewState.reps, 0);
  assert.equal(firstReviewState.state, 'new');

  const duplicate = await service.addWord({
    word: 'run',
    lemma: 'RUN',
    language: 'en',
    context: {
      sentence: 'I was running when the rain started.',
      source_title: 'Morning Notes',
      source_url: 'https://example.test/morning',
      surrounding_text: 'Before that, the sky was clear.',
    },
    createdAt: '2026-07-09T00:01:00.000Z',
  });
  assert.equal(duplicate.id, first.id, 'duplicate lemma should return existing word');

  const snapshotAfterDuplicate = await repository.loadSnapshot();
  assert.equal(snapshotAfterDuplicate.words.length, 1, 'duplicate lemma should not create another word');
  const contexts = await repository.getContextsForWord(first.id);
  assert.equal(contexts.length, 1);
  assert.equal(contexts[0].sentence, 'I was running when the rain started.');
  assert.equal(contexts[0].source_title, 'Morning Notes');
  assert.equal(contexts[0].source_url, 'https://example.test/morning');
  assert.equal(contexts[0].surrounding_text, 'Before that, the sky was clear.');

  const lookup = await service.getWordByLemma('RUN', { language: 'en' });
  assert.equal(lookup.id, first.id);

  const properNoun = await service.addWord({
    word: 'US',
    lemma: 'US',
    language: 'en',
    createdAt,
  });
  const properNounDuplicate = await service.addWord({
    word: 'us',
    lemma: 'us',
    language: 'en',
    createdAt: '2026-07-09T00:01:00.000Z',
  });
  assert.equal(properNoun.id, properNounDuplicate.id, 'lookup key should still dedupe case-only variants');
  assert.equal(properNoun.lemma, 'US', 'lemma should preserve canonical casing for proper nouns and abbreviations');
  assert.equal(properNoun.lookup_key, 'us');

  const phrase = await service.addWord({
    word: 'United   States',
    lemma: 'United States',
    language: 'en',
    entry_type: 'phrase',
    createdAt,
  });
  assert.equal(phrase.lemma, 'United States');
  assert.equal(phrase.lookup_key, 'united states');
  assert.equal(phrase.entry_type, 'phrase');
  assert.equal((await service.getWordByLemma('  united    states  ')).id, phrase.id);

  const legacyRepository = api.createInMemoryVocabularyRepository({
    words: [{
      id: 'legacy-word-1',
      word: 'legacy',
      lemma: 'legacy',
      lookup_key: 'legacy',
      language: 'en',
      status: 'new',
      created_at: createdAt,
      updated_at: createdAt,
    }],
  });
  assert.equal((await legacyRepository.getWord('legacy-word-1')).entry_type, 'word', 'legacy vocabulary entries should default to word');

  const futureWord = await service.addWord({
    word: 'Durable',
    lemma: 'durable',
    language: 'en',
    createdAt,
  });
  const futureReview = await service.reviewWord(futureWord.id, 'good', '2026-07-09T00:02:00.000Z');
  assert.equal(futureReview.word.id, futureWord.id);
  assertIsoAfter(futureReview.nextDueAt, '2026-07-09T00:02:00.000Z', 'review should move due_at forward');

  const dueWords = await service.getDueWords('2026-07-09T00:02:00.000Z');
  assert.deepEqual(dueWords.map((entry) => entry.word.lemma), ['Run', 'US', 'United States']);

  const logs = await repository.getReviewLogsForWord(futureWord.id);
  assert.equal(logs.length, 1);
  assert.equal(logs[0].rating, 'good');
  assert.equal(logs[0].word_id, futureWord.id);
  assert.equal(logs[0].reviewed_at, '2026-07-09T00:02:00.000Z');
  assert.equal(logs[0].before_state.state, 'new');
  assert.notEqual(logs[0].after_state.due_at, logs[0].before_state.due_at);

  await service.ignoreWord(first.id, '2026-07-09T00:03:00.000Z');
  const dueAfterIgnore = await service.getDueWords('2026-07-09T00:03:00.000Z');
  assert.equal(dueAfterIgnore.some((entry) => entry.word.id === first.id), false);
  assert.equal((await service.getWordByLemma('run')).status, 'ignored');

  await service.markWordKnown(futureWord.id, '2026-07-09T00:04:00.000Z');
  const knownWord = await service.getWordByLemma('durable');
  assert.equal(knownWord.status, 'known');
  assertIsoAfter((await repository.getReviewState(futureWord.id)).due_at, '2026-07-09T00:04:00.000Z', 'known words should not remain immediately due');

  const contextRepository = api.createInMemoryVocabularyRepository();
  const contextService = api.createVocabularyService({
    repository: contextRepository,
    scheduler: api.createSrsScheduler({ enable_fuzz: false }),
  });
  const chargeFirst = await contextService.addWord({
    word: 'charge',
    lemma: 'charge',
    language: 'en',
    context: {
      sentence: 'The company will charge users a monthly fee.',
      meaning: 'In this sentence, charge means to ask someone to pay.',
      source_title: 'Article A',
      source_url: 'https://example.test/a',
    },
    createdAt,
  });
  assert.equal(chargeFirst.meaning, 'In this sentence, charge means to ask someone to pay.');
  const chargeContextsAfterFirstAdd = await contextRepository.getContextsForWord(chargeFirst.id);
  assert.equal(chargeContextsAfterFirstAdd.length, 1);
  assert.equal(chargeContextsAfterFirstAdd[0].meaning, 'In this sentence, charge means to ask someone to pay.');

  const chargeSecond = await contextService.addWord({
    word: 'charged',
    lemma: 'charge',
    language: 'en',
    context: {
      sentence: 'He was charged with fraud.',
      meaning: 'In this sentence, charged means accused of a crime.',
      source_title: 'Article B',
      source_url: 'https://example.test/b',
    },
    createdAt: '2026-07-09T00:05:00.000Z',
  });
  assert.equal(chargeSecond.id, chargeFirst.id);
  assert.equal(chargeSecond.meaning, 'In this sentence, charge means to ask someone to pay.');
  const chargeContextsAfterSecondAdd = await contextRepository.getContextsForWord(chargeFirst.id);
  assert.equal(chargeContextsAfterSecondAdd.length, 2);
  assert.deepEqual(
    chargeContextsAfterSecondAdd.map((context) => context.meaning),
    [
      'In this sentence, charge means to ask someone to pay.',
      'In this sentence, charged means accused of a crime.',
    ]
  );

  const signal = await contextService.addWord({
    word: 'signal',
    lemma: 'signal',
    language: 'en',
    context: {
      sentence: 'The signal faded near the tunnel.',
      source_title: 'Article C',
      source_url: 'https://example.test/c',
    },
    createdAt,
  });
  const signalContexts = await contextRepository.getContextsForWord(signal.id);
  assert.equal(signalContexts.length, 1);
  assert.equal(signalContexts[0].meaning, null);

  await contextService.addWord({
    word: 'signal',
    lemma: 'signal',
    language: 'en',
    context: {
      sentence: 'The signal faded near the tunnel.',
      source_title: 'Article C',
      source_url: 'https://example.test/c',
    },
    createdAt: '2026-07-09T00:06:30.000Z',
  });
  assert.equal((await contextRepository.getContextsForWord(signal.id)).length, 1, 'identical context should not be appended twice');

  await contextService.addWord({
    word: 'signal',
    lemma: 'signal',
    language: 'en',
    context: {
      sentence: 'The signal faded near the tunnel.',
      meaning: 'In this sentence, signal means reception.',
      source_title: 'Article C',
      source_url: 'https://example.test/c',
    },
    createdAt: '2026-07-09T00:07:00.000Z',
  });
  assert.equal((await contextRepository.getContextsForWord(signal.id)).length, 2, 'same sentence with different meaning should remain useful context');

  const contextsBeforeReview = await contextRepository.getContextsForWord(chargeFirst.id);
  await contextService.reviewWord(chargeFirst.id, 'good', '2026-07-09T00:06:00.000Z');
  assert.deepEqual(await contextRepository.getContextsForWord(chargeFirst.id), contextsBeforeReview);

  for (const rating of ['again', 'hard', 'good', 'easy']) {
    const word = await service.addWord({
      word: `sample-${rating}`,
      lemma: `sample-${rating}`,
      language: 'en',
      createdAt,
    });
    const result = await service.reviewWord(word.id, rating, '2026-07-09T01:00:00.000Z');
    assert.equal(result.rating, rating);
    assert.ok(Date.parse(result.nextDueAt) >= Date.parse('2026-07-09T01:00:00.000Z'));
  }

  const candidateTemplate = {
    articleId: 'article-srs',
    items: [{
      targetId: 'target-word',
      markedText: 'Grill',
      sourceSentence: 'The chef will grill the fish.',
      sentenceBefore: 'Dinner starts soon.',
      sentenceAfter: 'Guests are waiting.',
    }, {
      targetId: 'target-phrase',
      markedText: 'take it for granted',
      sourceSentence: 'People take clean water for granted.',
    }, {
      targetId: 'target-long',
      markedText: 'this is a very long selected passage that should stay out of srs',
      sourceSentence: 'This is a very long selected passage that should stay out of SRS.',
    }],
  };
  const candidateResult = {
    items: [{
      targetId: 'target-word',
      markedText: 'Grill',
      meaning: 'In this sentence, grill means cook over heat.',
    }, {
      targetId: 'target-phrase',
      markedText: 'take it for granted',
      meaning: 'Treat something as automatically available.',
    }, {
      targetId: 'target-long',
      markedText: 'this is a very long selected passage that should stay out of srs',
      meaning: 'This is an explanation for a long text selection.',
    }, {
      targetId: 'target-old',
      markedText: 'old',
      meaning: 'Should not be included because it was not requested in this run.',
    }],
  };
  const candidateBuild = api.buildSrsCandidatesFromBackfillRun({
    template: candidateTemplate,
    result: candidateResult,
    requestedTargetIds: ['target-word', 'target-phrase', 'target-long'],
    sourceTitle: 'Article SRS',
    sourceUrl: 'https://example.test/srs',
  });
  assert.deepEqual(candidateBuild.candidates.map((candidate) => [candidate.lemma, candidate.entry_type]), [
    ['grill', 'word'],
    ['take it for granted', 'phrase'],
  ]);
  assert.equal(candidateBuild.excluded.length, 1, 'long text selections should be excluded from SRS candidates');
  assert.equal(candidateBuild.candidates[0].context.sentence, 'The chef will grill the fish.');
  assert.equal(candidateBuild.candidates[0].context.meaning, 'In this sentence, grill means cook over heat.');
  assert.equal(candidateBuild.candidates[0].context.source_title, 'Article SRS');
  assert.equal(candidateBuild.candidates[0].context.source_url, 'https://example.test/srs');
  assert.equal(candidateBuild.candidates[0].context.surrounding_text, 'Dinner starts soon. The chef will grill the fish. Guests are waiting.');

  const candidateRepository = api.createInMemoryVocabularyRepository();
  const candidateService = api.createVocabularyService({
    repository: candidateRepository,
    scheduler: api.createSrsScheduler({ enable_fuzz: false }),
  });
  await candidateService.addWord({ word: 'known phrase', lemma: 'known phrase', entry_type: 'phrase', createdAt });
  await candidateService.markWordKnown((await candidateService.getWordByLemma('known phrase')).id, '2026-07-09T00:07:00.000Z');
  await candidateService.addWord({ word: 'ignored phrase', lemma: 'ignored phrase', entry_type: 'phrase', createdAt });
  await candidateService.ignoreWord((await candidateService.getWordByLemma('ignored phrase')).id, '2026-07-09T00:08:00.000Z');
  const applyResult = await api.applySrsCandidatesToVocabulary({
    vocabularyService: candidateService,
    candidates: [{
      word: 'fresh word',
      lemma: 'fresh word',
      entry_type: 'phrase',
      language: 'en',
      context: { sentence: 'A fresh word appears.', meaning: 'A new phrase meaning.' },
    }, {
      word: 'known phrase',
      lemma: 'known phrase',
      entry_type: 'phrase',
      language: 'en',
      context: { sentence: 'Known phrase appears again.', meaning: 'Known but uncertain.' },
    }, {
      word: 'ignored phrase',
      lemma: 'ignored phrase',
      entry_type: 'phrase',
      language: 'en',
      context: { sentence: 'Ignored phrase appears again.', meaning: 'Ignored meaning.' },
    }],
    mode: 'all',
  });
  assert.equal(applyResult.added, 1);
  assert.equal(applyResult.knownContextAdded, 1);
  assert.equal(applyResult.ignoredSkipped, 1);
  assert.equal((await candidateRepository.getContextsForWord((await candidateService.getWordByLemma('known phrase')).id)).length, 1);
  assert.equal((await candidateRepository.getContextsForWord((await candidateService.getWordByLemma('ignored phrase')).id)).length, 0);

  const pendingRepository = api.createInMemorySrsPendingCandidatesRepository();
  await pendingRepository.setPendingCandidates('article-srs', {
    scopeKey: 'article-srs',
    candidates: candidateBuild.candidates,
  });
  assert.equal((await pendingRepository.getPendingCandidates('article-srs')).candidates.length, 2);
  await pendingRepository.clearPendingCandidates('article-srs');
  assert.equal(await pendingRepository.getPendingCandidates('article-srs'), null);

  console.log('vocabulary SRS service check passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
