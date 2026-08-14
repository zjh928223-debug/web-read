const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');

function startModuleServer(repoRoot) {
  const root = path.resolve(repoRoot);
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    if (url.pathname === '/') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end('<!doctype html><meta charset="utf-8"><title>Vocabulary multi-page CAS check</title>');
      return;
    }
    const relative = decodeURIComponent(url.pathname).replace(/^\/+/u, '');
    const target = path.resolve(root, relative);
    if (!target.startsWith(`${root}${path.sep}`) || !target.endsWith('.js')) {
      response.writeHead(404);
      response.end('not found');
      return;
    }
    fs.readFile(target, (error, content) => {
      if (error) {
        response.writeHead(404);
        response.end('not found');
        return;
      }
      response.writeHead(200, {
        'content-type': 'text/javascript; charset=utf-8',
        'cache-control': 'no-store',
      });
      response.end(content);
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({
        origin: `http://127.0.0.1:${address.port}`,
        close: () => new Promise((closeResolve, closeReject) => {
          server.close((error) => (error ? closeReject(error) : closeResolve()));
        }),
      });
    });
  });
}

async function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'read-web-vocabulary-multi-page-'));
  const server = await startModuleServer(repoRoot);
  let context;
  try {
    context = await chromium.launchPersistentContext(profileDir, { headless: true });
    const writer = context.pages()[0] ?? await context.newPage();
    const reader = await context.newPage();
    await Promise.all([writer.goto(server.origin), reader.goto(server.origin)]);

    await writer.evaluate(async () => {
      await new Promise((resolve, reject) => {
        const request = indexedDB.deleteDatabase('SeekPlayerDB');
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error('database delete was blocked'));
      });
      await new Promise((resolve, reject) => {
        const request = indexedDB.open('SeekPlayerDB', 1);
        request.onupgradeneeded = () => request.result.createObjectStore('files', { keyPath: 'id' });
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          request.result.close();
          resolve();
        };
      });
      const module = await import('/src/services/vocabulary/vocabulary-repository.js');
      const repository = module.createIndexedDbVocabularyRepository();
      await repository.updateSnapshot((snapshot) => {
        snapshot.words.push({
          id: 'multi-base',
          word: 'base',
          lemma: 'base',
          lookup_key: 'base',
          entry_type: 'word',
          language: 'en',
          status: 'new',
          tags: [],
          created_at: '2026-08-13T00:00:00.000Z',
          updated_at: '2026-08-13T00:00:00.000Z',
        });
        return 'seed';
      });
    });

    const baseWriter = await writer.evaluate(async () => {
      const module = await import('/src/services/vocabulary/vocabulary-repository.js');
      return module.createIndexedDbVocabularyRepository().loadSnapshot();
    });
    const baseReader = await reader.evaluate(async () => {
      const module = await import('/src/services/vocabulary/vocabulary-repository.js');
      return module.createIndexedDbVocabularyRepository().loadSnapshot();
    });
    assert.deepEqual(baseWriter, baseReader, 'same-origin pages must observe the same revision snapshot');

    await writer.evaluate((snapshot) => {
      window.__requestSuccessBeforeComplete = false;
      window.__txCompleted = false;
      const originalTransaction = IDBDatabase.prototype.transaction;
      IDBDatabase.prototype.transaction = function patchedTransaction(...args) {
        const transaction = originalTransaction.apply(this, args);
        if (args[1] === 'readwrite') {
          transaction.addEventListener('complete', () => {
            window.__txCompleted = true;
          }, { once: true });
        }
        return transaction;
      };
      const originalPut = IDBObjectStore.prototype.put;
      let firstWrite = true;
      IDBObjectStore.prototype.put = function patchedPut(...args) {
        const request = originalPut.apply(this, args);
        if (firstWrite && this.transaction.mode === 'readwrite') {
          firstWrite = false;
          request.addEventListener('success', () => {
            window.__requestSuccessBeforeComplete = !window.__txCompleted;
          }, { once: true });
        }
        return request;
      };
      const repositoryModule = window.__repositoryModulePromise = import('/src/services/vocabulary/vocabulary-repository.js');
      const nextWord = {
        id: 'multi-writer',
        word: 'writer',
        lemma: 'writer',
        lookup_key: 'writer',
        entry_type: 'word',
        language: 'en',
        status: 'new',
        tags: [],
        created_at: '2026-08-13T00:00:00.000Z',
        updated_at: '2026-08-13T00:00:00.000Z',
      };
      window.__writerPromise = repositoryModule.then((module) => (
        module.createIndexedDbVocabularyRepository().compareAndSwap({
          ...snapshot,
          words: [...snapshot.words, nextWord],
        }, 1)
      )).then(
        (revision) => ({ ok: true, revision }),
        (error) => ({ ok: false, code: error?.code ?? null }),
      );
    }, baseWriter);
    await writer.waitForFunction(() => window.__requestSuccessBeforeComplete === true);
    const requestSuccessOrdering = await writer.evaluate(() => window.__requestSuccessBeforeComplete);
    assert.equal(requestSuccessOrdering, true, 'writer must be closed after request success and before tx complete');

    // Do not await the writer CAS promise: the writer is deliberately closed at the request-success boundary.
    await writer.close();

    const readerResult = await reader.evaluate(async (snapshot) => {
      const module = await import('/src/services/vocabulary/vocabulary-repository.js');
      const nextWord = {
        id: 'multi-reader',
        word: 'reader',
        lemma: 'reader',
        lookup_key: 'reader',
        entry_type: 'word',
        language: 'en',
        status: 'new',
        tags: [],
        created_at: '2026-08-13T00:00:00.000Z',
        updated_at: '2026-08-13T00:00:00.000Z',
      };
      return module.createIndexedDbVocabularyRepository().compareAndSwap({
        ...snapshot,
        words: [...snapshot.words, nextWord],
      }, 1).then(
        (revision) => ({ ok: true, revision }),
        (error) => ({ ok: false, code: error?.code ?? null }),
      );
    }, baseReader);
    assert.ok(
      readerResult.ok || readerResult.code === 'REVISION_CONFLICT',
      `unexpected second CAS result: ${JSON.stringify(readerResult)}`,
    );

    const fresh = await context.newPage();
    await fresh.goto(server.origin);
    const finalState = await fresh.evaluate(async () => {
      const persistence = await import('/src/services/vocabulary/vocabulary-persistence.js');
      const requestResult = (request) => new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const request = indexedDB.open('SeekPlayerDB', 1);
      const database = await requestResult(request);
      const transaction = database.transaction(['files'], 'readonly');
      const rows = await new Promise((resolve, reject) => {
        const rowsRequest = transaction.objectStore('files').getAll();
        rowsRequest.onerror = () => reject(rowsRequest.error);
        rowsRequest.onsuccess = () => {
          transaction.oncomplete = () => resolve(rowsRequest.result);
          transaction.onerror = () => reject(transaction.error);
        };
      });
      database.close();
      const current = rows.find((row) => row.id === 'vocabulary.srs.store.v1');
      return {
        revision: current.revision,
        words: current.content.words.map((entry) => entry.lemma).sort(),
        checksumValid: current.checksum === persistence.checksumFor(current.content),
        completeRows: rows.filter((row) => row.id.startsWith('vocabulary.srs.store.v1')).map((row) => ({
          id: row.id,
          revision: row.revision,
          checksumValid: row.checksum === persistence.checksumFor(row.content),
        })),
      };
    });
    assert.ok(finalState.revision >= 2, 'a successful writer must advance the canonical revision');
    assert.ok(
      [['base', 'reader'], ['base', 'writer']].some((words) => JSON.stringify(words) === JSON.stringify(finalState.words)),
      `fresh page observed a torn or lost snapshot: ${JSON.stringify(finalState)}`,
    );
    assert.equal(finalState.checksumValid, true);
    assert.equal(finalState.completeRows.every((row) => row.checksumValid), true);
    console.log('Vocabulary repository real Chromium multi-page CAS verification passed.');
  } finally {
    if (context) await context.close();
    await server.close();
    const resolvedProfileDir = path.resolve(profileDir);
    const resolvedTempDir = `${path.resolve(os.tmpdir())}${path.sep}`;
    assert.equal(resolvedProfileDir.startsWith(resolvedTempDir), true);
    fs.rmSync(resolvedProfileDir, { recursive: true, force: true });
  }
}

function word(id, lemma) {
  return {
    id,
    word: lemma,
    lemma,
    lookup_key: lemma,
    entry_type: 'word',
    language: 'en',
    status: 'new',
    tags: [],
    created_at: '2026-08-13T00:00:00.000Z',
    updated_at: '2026-08-13T00:00:00.000Z',
  };
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
