import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  createEcdictRequestHandler,
  createEcdictVitePlugin,
} from '../api/ecdict-vite-plugin.mjs';

function invoke(handler, { method = 'GET', url = '/api/dev/dictionary/ecdict?q=look' } = {}) {
  return new Promise((resolve, reject) => {
    const headers = {};
    const response = {
      statusCode: 200,
      setHeader(name, value) {
        headers[name.toLowerCase()] = value;
      },
      end(body = '') {
        resolve({ status: this.statusCode, headers, body: String(body) });
      },
    };
    Promise.resolve(handler({ method, url }, response, () => resolve({ next: true })))
      .catch(reject);
  });
}

function result(query, overrides = {}) {
  return {
    available: true,
    errorCode: null,
    query,
    normalizedQuery: query,
    matchedBy: 'exact',
    directMatch: { word: query },
    normalizedCandidates: [],
    lemmaCandidates: [],
    ...overrides,
  };
}

test('ECDICT endpoint is lazy, validates requests, returns DTO, and closes service', async () => {
  let initializations = 0;
  let closed = 0;
  const queries = [];
  const handler = createEcdictRequestHandler({
    maxQueryLength: 8,
    async serviceFactory() {
      initializations += 1;
      return {
        async lookup(query) {
          queries.push(query);
          return result(query);
        },
        close() {
          closed += 1;
        },
      };
    },
  });

  assert.equal((await invoke(handler, { url: '/other' })).next, true);
  assert.equal(initializations, 0);
  assert.equal((await invoke(handler, { method: 'POST' })).status, 405);
  assert.equal(initializations, 0);
  assert.equal((await invoke(handler, {
    url: '/api/dev/dictionary/ecdict?q=123456789',
  })).status, 400);
  assert.equal(initializations, 0);

  const response = await invoke(handler, {
    url: '/api/dev/dictionary/ecdict?q=run%20into',
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers['content-type'], 'application/json; charset=utf-8');
  assert.equal(JSON.parse(response.body).directMatch.word, 'run into');
  assert.deepEqual(queries, ['run into']);
  assert.equal(initializations, 1);

  await handler.close();
  assert.equal(closed, 1);
});

test('ECDICT endpoint preserves structured unavailable results', async () => {
  const handler = createEcdictRequestHandler({
    async serviceFactory() {
      return {
        async lookup(query) {
          return result(query, {
            available: false,
            errorCode: 'ECDICT_DATABASE_UNAVAILABLE',
            matchedBy: 'none',
            directMatch: null,
          });
        },
        close() {},
      };
    },
  });
  const response = await invoke(handler);
  assert.equal(response.status, 200);
  assert.equal(JSON.parse(response.body).errorCode, 'ECDICT_DATABASE_UNAVAILABLE');
  await handler.close();
});

test('handler.close resolves after a rejected service load', async () => {
  const handler = createEcdictRequestHandler({
    async serviceFactory() {
      throw new Error('synthetic loader failure');
    },
  });
  const response = await invoke(handler);
  assert.equal(response.status, 200);
  assert.equal(JSON.parse(response.body).errorCode, 'ECDICT_QUERY_FAILED');
  await assert.doesNotReject(handler.close());
});

test('disabled Vite plugin registers nothing and never loads the service', () => {
  let loads = 0;
  let middlewareRegistrations = 0;
  const plugin = createEcdictVitePlugin({
    enabled: false,
    serviceLoader: async () => {
      loads += 1;
      return {};
    },
  });
  const server = {
    middlewares: { use() { middlewareRegistrations += 1; } },
    httpServer: { once() {} },
  };
  plugin.configureServer(server);
  plugin.configurePreviewServer(server);
  assert.equal(loads, 0);
  assert.equal(middlewareRegistrations, 0);
});

test('Vite config keeps the SQLite service lazy with a stable absolute module URL', async () => {
  const source = await readFile(new URL('../../../../vite.config.mjs', import.meta.url), 'utf8');
  assert.match(source, /pathToFileURL\(resolve\(/);
  assert.match(source, /serviceLoader:\s*\(\)\s*=>\s*import\(ecdictServiceUrl\)/);
  assert.doesNotMatch(source, /^import\s+.*ecdict-service\.mjs.*$/m);
});
