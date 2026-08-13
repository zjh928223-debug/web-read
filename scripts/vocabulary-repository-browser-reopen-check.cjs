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
      response.end('<!doctype html><meta charset="utf-8"><title>Vocabulary repository reopen check</title>');
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
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'read-web-vocabulary-reopen-'));
  const server = await startModuleServer(repoRoot);
  let context;
  try {
    context = await chromium.launchPersistentContext(profileDir, { headless: true });
    let page = context.pages()[0] ?? await context.newPage();
    await page.goto(server.origin);

    const first = await page.evaluate(async () => {
      const deleteDatabase = () => new Promise((resolve, reject) => {
        const request = indexedDB.deleteDatabase('SeekPlayerDB');
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error('delete blocked'));
      });
      const createDatabase = () => new Promise((resolve, reject) => {
        const request = indexedDB.open('SeekPlayerDB', 1);
        request.onupgradeneeded = () => request.result.createObjectStore('files', { keyPath: 'id' });
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          request.result.close();
          resolve();
        };
      });
      const readRows = () => new Promise((resolve, reject) => {
        const request = indexedDB.open('SeekPlayerDB', 1);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const database = request.result;
          const transaction = database.transaction(['files'], 'readonly');
          const rowsRequest = transaction.objectStore('files').getAll();
          rowsRequest.onerror = () => reject(rowsRequest.error);
          transaction.oncomplete = () => {
            database.close();
            resolve(rowsRequest.result);
          };
        };
      });
      await deleteDatabase();
      await createDatabase();
      const persistence = await import('/src/services/vocabulary/vocabulary-persistence.js');
      const learningModels = await import('/src/services/vocabulary/vocabulary-learning-models.js');
      const snapshotRepository = await import('/src/services/vocabulary/vocabulary-repository.js');
      const acquisitionRepository = await import('/src/services/vocabulary/vocabulary-acquisition-repository.js');
      const snapshot = snapshotRepository.createIndexedDbVocabularyRepository();
      await snapshot.updateSnapshot((value) => {
        value.words.push({
          id: 'browser-word',
          word: 'reopen',
          lemma: 'reopen',
          lookup_key: 'reopen',
          entry_type: 'word',
          language: 'en',
          status: 'new',
          tags: [],
          created_at: '2026-08-13T00:00:00.000Z',
          updated_at: '2026-08-13T00:00:00.000Z',
        });
        return 'snapshot-written';
      });
      const unit = learningModels.normalizeLearningUnit({
        learning_unit_id: 'browser-learning-unit',
        word_id: 'browser-word',
        normalized_form: 'reopen',
        language: 'en',
        target_sense_id: null,
        target_sense_key: null,
        target_sense: null,
        created_at: '2026-08-13T00:00:00.000Z',
        updated_at: '2026-08-13T00:00:00.000Z',
        archived_at: null,
        revision: 0,
        extensions: {},
      });
      const acquisition = acquisitionRepository.createIndexedDbAcquisitionRepository();
      await acquisition.putLearningUnit(unit, null);
      const rows = await readRows();
      return {
        snapshot: (await snapshot.loadSnapshot()).words.map((word) => word.lemma),
        acquisition: Object.keys((await acquisition.loadSnapshot()).by_learning_unit_id),
        checksums: rows
          .filter((row) => ['vocabulary.srs.store.v1', 'vocabulary.acquisition.store.v1'].includes(row.id))
          .map((row) => [row.id, row.checksum, persistence.checksumFor(row.content)]),
      };
    });

    assert.deepEqual(first.snapshot, ['reopen']);
    assert.deepEqual(first.acquisition, ['browser-learning-unit']);
    assert.equal(first.checksums.length, 2);
    for (const [, checksum, expectedChecksum] of first.checksums) {
      assert.match(checksum, /^sha256:[a-f0-9]{64}$/u);
      assert.equal(checksum, expectedChecksum);
    }

    await page.close();
    page = await context.newPage();
    await page.goto(server.origin);
    const reopened = await page.evaluate(async () => {
      const snapshotRepository = await import('/src/services/vocabulary/vocabulary-repository.js');
      const acquisitionRepository = await import('/src/services/vocabulary/vocabulary-acquisition-repository.js');
      const snapshot = snapshotRepository.createIndexedDbVocabularyRepository();
      const acquisition = acquisitionRepository.createIndexedDbAcquisitionRepository();
      return {
        snapshot: (await snapshot.loadSnapshot()).words.map((word) => word.lemma),
        acquisition: Object.keys((await acquisition.loadSnapshot()).by_learning_unit_id),
      };
    });
    assert.deepEqual(reopened, {
      snapshot: ['reopen'],
      acquisition: ['browser-learning-unit'],
    });
    console.log('Vocabulary repository browser page-close/reopen verification passed.');
  } finally {
    if (context) await context.close();
    await server.close();
    const resolvedProfileDir = path.resolve(profileDir);
    const tempRoot = `${path.resolve(os.tmpdir())}${path.sep}`;
    assert.equal(resolvedProfileDir.startsWith(tempRoot), true);
    fs.rmSync(resolvedProfileDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
