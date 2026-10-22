import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LocalDictionaryClientError,
  createLocalDictionaryClient,
} from '../browser/local-dictionary-client.mjs';
import { formatDictionarySuggestion } from '../browser/dictionary-suggestion-view.mjs';

function dictionaryEntry(word, overrides = {}) {
  return {
    word,
    phonetic: null,
    definition: null,
    translation: `${word} translation`,
    pos: null,
    collins: null,
    oxford: false,
    tags: [],
    bncRank: null,
    frequencyRank: null,
    exchange: null,
    ...overrides,
  };
}

function lookupResult(query, overrides = {}) {
  return {
    available: true,
    errorCode: null,
    query,
    normalizedQuery: query.toLowerCase().replace(/[^a-z0-9]/g, ''),
    matchedBy: 'exact',
    directMatch: dictionaryEntry(query),
    normalizedCandidates: [],
    lemmaCandidates: [],
    ...overrides,
  };
}

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body;
    },
  };
}

test('LocalDictionaryClient returns a validated lookup DTO', async () => {
  let requestedUrl = '';
  const client = createLocalDictionaryClient({
    fetchImpl: async (url) => {
      requestedUrl = String(url);
      return jsonResponse(lookupResult("can't"));
    },
  });

  const result = await client.lookup("can't");
  assert.match(requestedUrl, /\/api\/dev\/dictionary\/ecdict\?q=can%27t$/);
  assert.equal(result.directMatch.word, "can't");
});

test('LocalDictionaryClient rejects unavailable, invalid, and timed-out responses', async () => {
  const unavailable = createLocalDictionaryClient({
    fetchImpl: async () => jsonResponse({
      ...lookupResult('look'),
      available: false,
      errorCode: 'ECDICT_DATABASE_UNAVAILABLE',
    }),
  });
  assert.equal((await unavailable.lookup('look')).available, false);

  const invalid = createLocalDictionaryClient({
    fetchImpl: async () => jsonResponse({ available: true }),
  });
  await assert.rejects(
    invalid.lookup('look'),
    (error) => error instanceof LocalDictionaryClientError && error.code === 'ECDICT_INVALID_RESPONSE',
  );

  const timedOut = createLocalDictionaryClient({
    timeoutMs: 5,
    fetchImpl: (_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(options.signal.reason));
    }),
  });
  await assert.rejects(
    timedOut.lookup('look'),
    (error) => error instanceof LocalDictionaryClientError && error.code === 'ECDICT_REQUEST_TIMEOUT',
  );
});

test('LocalDictionaryClient rejects malformed nested lookup entries', async () => {
  const malformedNormalized = createLocalDictionaryClient({
    fetchImpl: async () => jsonResponse(lookupResult('cant', {
      normalizedCandidates: [{ ...dictionaryEntry('cant'), word: 123 }],
    })),
  });
  await assert.rejects(
    malformedNormalized.lookup('cant'),
    (error) => error instanceof LocalDictionaryClientError
      && error.code === 'ECDICT_INVALID_RESPONSE',
  );

  const missingLemmaEntry = createLocalDictionaryClient({
    fetchImpl: async () => jsonResponse(lookupResult('better', {
      lemmaCandidates: [{ lemma: 'good' }],
    })),
  });
  await assert.rejects(
    missingLemmaEntry.lookup('better'),
    (error) => error instanceof LocalDictionaryClientError
      && error.code === 'ECDICT_INVALID_RESPONSE',
  );
});




test('dictionary suggestion text labels exact and ambiguous results without inventing meaning', () => {
  assert.equal(
    formatDictionarySuggestion(lookupResult('look')),
    'ECDICT · look：look translation',
  );
  assert.equal(
    formatDictionarySuggestion(lookupResult('better', {
      normalizedCandidates: [
        dictionaryEntry('bet-ter'),
        dictionaryEntry('better'),
      ],
      lemmaCandidates: [
        { lemma: 'good', entry: dictionaryEntry('good') },
        { lemma: 'well', entry: dictionaryEntry('well') },
      ],
    })),
    'ECDICT · better：better translation · normalized 候选（1）：bet-ter · lemma 候选（2）：good、well',
  );
  assert.equal(
    formatDictionarySuggestion(lookupResult("c-a-n-t", {
      matchedBy: 'normalized',
      directMatch: null,
      normalizedCandidates: [dictionaryEntry("can't"), dictionaryEntry('cant')],
    })),
    "ECDICT normalized 候选（2）：can't、cant",
  );
  assert.equal(formatDictionarySuggestion(lookupResult('missing', {
    matchedBy: 'none',
    directMatch: null,
  })), '');
});

test('dictionary suggestion formatter never throws for malformed nested candidates', () => {
  const malformed = {
    available: true,
    matchedBy: 'exact',
    directMatch: {
      word: { unsafe: true },
      translation: { unsafe: true },
    },
    normalizedCandidates: [
      null,
      { word: 123 },
      { word: { unsafe: true } },
    ],
    lemmaCandidates: [
      null,
      { lemma: 456 },
      { entry: { word: Symbol('unsafe') } },
    ],
  };
  assert.doesNotThrow(() => formatDictionarySuggestion(malformed));
  assert.equal(typeof formatDictionarySuggestion(malformed), 'string');
  assert.doesNotThrow(() => formatDictionarySuggestion({
    ...malformed,
    normalizedCandidates: { not: 'an array' },
    lemmaCandidates: { not: 'an array' },
  }));
});
