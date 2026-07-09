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
    createdAt,
  });
  assert.equal(phrase.lemma, 'United States');
  assert.equal(phrase.lookup_key, 'united states');
  assert.equal((await service.getWordByLemma('  united    states  ')).id, phrase.id);

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

  console.log('vocabulary SRS service check passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
