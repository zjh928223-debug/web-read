import assert from 'node:assert/strict';
import test from 'node:test';

import { createOptionalLocalDictionaryClient } from '../browser/optional-local-dictionary-client.mjs';
import { formatDictionarySuggestion } from '../browser/dictionary-suggestion-view.mjs';
import {
  createSrsReviewDictionaryAssistance,
} from '../../../features/srs-review/srs-review-dictionary-assistance.mjs';

function entry(word, translation = `${word} translation`) {
  return {
    word,
    phonetic: null,
    definition: null,
    translation,
    pos: null,
    collins: null,
    oxford: false,
    tags: [],
    bncRank: null,
    frequencyRank: null,
    exchange: null,
  };
}

function result(query, overrides = {}) {
  return {
    available: true,
    errorCode: null,
    query,
    normalizedQuery: query.toLowerCase().replace(/[^a-z0-9]/g, ''),
    matchedBy: 'exact',
    directMatch: entry(query),
    normalizedCandidates: [],
    lemmaCandidates: [],
    ...overrides,
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

test('optional client stays null and never invokes its factory while disabled', () => {
  let factoryCalls = 0;
  const client = createOptionalLocalDictionaryClient({
    enabled: false,
    clientFactory() {
      factoryCalls += 1;
      return {};
    },
  });
  assert.equal(client, null);
  assert.equal(factoryCalls, 0);
});

test('exact result is queried once, hidden before reveal, and reused in session', async () => {
  const calls = [];
  let snapshot;
  const assistance = createSrsReviewDictionaryAssistance({
    client: {
      async lookup(query) {
        calls.push(query);
        return result(query);
      },
    },
    onChange(next) {
      snapshot = next;
    },
  });

  await assistance.setCard('look');
  assert.equal(snapshot.visibleResult, null);
  assistance.setRevealed(true);
  assert.equal(snapshot.visibleResult.directMatch.word, 'look');

  await assistance.setCard('look');
  assistance.setRevealed(true);
  assert.deepEqual(calls, ['look']);
  assert.equal(snapshot.visibleResult.directMatch.word, 'look');
});

test('normalized and lemma candidates keep their labels and counts', () => {
  const suggestion = result('better', {
    directMatch: entry('better', '更好的'),
    normalizedCandidates: [entry('bet-ter')],
    lemmaCandidates: [
      { lemma: 'good', entry: entry('good') },
      { lemma: 'well', entry: entry('well') },
    ],
  });
  assert.equal(
    formatDictionarySuggestion(suggestion, { includeSource: false }),
    'better：更好的 · normalized 候选（1）：bet-ter · lemma 候选（2）：good、well',
  );
});

test('complete phrases are queried without splitting', async () => {
  const calls = [];
  const assistance = createSrsReviewDictionaryAssistance({
    client: {
      async lookup(query) {
        calls.push(query);
        return result(query, { matchedBy: 'none', directMatch: null });
      },
    },
  });
  await assistance.setCard('run into');
  assistance.setRevealed(true);
  assert.equal(assistance.getSnapshot().visibleResult, null);
  await assistance.setCard('run into');
  assert.deepEqual(calls, ['run into']);
});

test('failures and unavailable results stay fail-open and are retried', async () => {
  let calls = 0;
  let snapshot;
  const assistance = createSrsReviewDictionaryAssistance({
    client: {
      async lookup(query) {
        calls += 1;
        if (calls === 1) throw new Error('endpoint stopped');
        return result(query, {
          available: false,
          errorCode: 'ECDICT_DATABASE_UNAVAILABLE',
          matchedBy: 'none',
          directMatch: null,
        });
      },
    },
    onChange(next) {
      snapshot = next;
    },
  });

  await assert.doesNotReject(assistance.setCard('left'));
  assistance.setRevealed(true);
  assert.equal(snapshot.unavailableVisible, true);

  await assert.doesNotReject(assistance.setCard('left'));
  assistance.setRevealed(true);
  assert.equal(calls, 2);
  assert.equal(snapshot.unavailableVisible, true);
});

test('stale and post-dispose responses never update active state', async () => {
  const pendingA = deferred();
  const pendingB = deferred();
  const snapshots = [];
  const assistance = createSrsReviewDictionaryAssistance({
    client: {
      lookup(query) {
        return query === 'A' ? pendingA.promise : pendingB.promise;
      },
    },
    onChange(next) {
      snapshots.push(next);
    },
  });

  const requestA = assistance.setCard('A');
  const requestB = assistance.setCard('B');
  pendingA.resolve(result('A'));
  await requestA;
  assert.equal(assistance.getSnapshot().query, 'B');
  assert.equal(assistance.getSnapshot().result, null);

  assistance.dispose();
  const updateCount = snapshots.length;
  pendingB.resolve(result('B'));
  await requestB;
  assert.equal(snapshots.length, updateCount);
});

test('review assistance source has no persistence or Node infrastructure dependency', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(
    new URL('../../../features/srs-review/srs-review-dictionary-assistance.mjs', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(source, /cacheGeneralMeanings|VocabularyRepository|reviewLog|node:sqlite/);
  assert.doesNotMatch(source, /infrastructure|sqlite-connection|ecdict-repository/);

  const reviewPage = await readFile(
    new URL('../../../features/srs-review/SrsReviewPage.vue', import.meta.url),
    'utf8',
  );
  const overlayEntry = await readFile(new URL('../../../App.vue', import.meta.url), 'utf8');
  const standaloneEntry = await readFile(
    new URL('../../../srs-review-main.js', import.meta.url),
    'utf8',
  );
  assert.match(reviewPage, /dictionaryClient:\s*\{\s*type:\s*Object,\s*default:\s*null\s*\}/);
  assert.match(reviewPage, /v-if="flowState\.answerRevealed"[\s\S]*本地词典 · ECDICT/);
  assert.match(overlayEntry, /:dictionary-client="dictionaryClient"/);
  assert.match(standaloneEntry, /dictionaryClient:\s*createOptionalLocalDictionaryClient\(\)/);
  assert.doesNotMatch(reviewPage, /cacheGeneralMeanings|VocabularyRepository|reviewLog/);
});
