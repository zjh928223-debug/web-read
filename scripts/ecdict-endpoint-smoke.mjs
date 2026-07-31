#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createServer } from 'node:http';

import { createEcdictRequestHandler } from '../src/dictionary/ecdict/api/ecdict-vite-plugin.mjs';
import { createEcdictService } from '../src/dictionary/ecdict/application/ecdict-service.mjs';

if (process.env.ECDICT_ENABLED !== 'true') {
  throw new Error('Set ECDICT_ENABLED=true for the endpoint smoke check.');
}

const handler = createEcdictRequestHandler({
  serviceFactory() {
    return createEcdictService({
      enabled: true,
      databasePath: process.env.ECDICT_DATABASE_PATH,
    });
  },
});
const server = createServer((request, response) => {
  void handler(request, response, () => {
    response.statusCode = 404;
    response.end();
  });
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const { port } = server.address();
const queries = [
  'looked',
  'left',
  'better',
  "can't",
  'cant',
  'run into',
  'this phrase definitely has no ecdict entry',
];
const results = [];
try {
  for (const query of queries) {
    const response = await fetch(
      `http://127.0.0.1:${port}/api/dev/dictionary/ecdict?q=${encodeURIComponent(query)}`,
    );
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.available, true, query);
    results.push({
      query,
      matchedBy: result.matchedBy,
      direct: result.directMatch?.word || null,
      normalized: result.normalizedCandidates.map(({ word }) => word),
      lemmas: result.lemmaCandidates.map(({ lemma }) => lemma),
    });
  }
  assert.equal(results.at(-1).matchedBy, 'none');
  assert.ok(results.find(({ query }) => query === 'better').lemmas.includes('good'));
  assert.ok(results.find(({ query }) => query === 'left').lemmas.includes('leave'));
  process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
} finally {
  await handler.close();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
