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
      response.end('<!doctype html><meta charset="utf-8"><title>Vocabulary revision watermark check</title>');
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

async function openTwoPages(server, profilePrefix) {
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), profilePrefix));
  const context = await chromium.launchPersistentContext(profileDir, { headless: true });
  const first = context.pages()[0] ?? await context.newPage();
  const second = await context.newPage();
  await Promise.all([first.goto(server.origin), second.goto(server.origin)]);
  return { context, first, second, profileDir };
}

async function resetDatabase(page) {
  await page.evaluate(async () => {
    const deleteRequest = indexedDB.deleteDatabase('SeekPlayerDB');
    await new Promise((resolve, reject) => {
      deleteRequest.onsuccess = resolve;
      deleteRequest.onerror = () => reject(deleteRequest.error);
      deleteRequest.onblocked = () => reject(new Error('database delete was blocked'));
    });
    const openRequest = indexedDB.open('SeekPlayerDB', 1);
    openRequest.onupgradeneeded = () => openRequest.result.createObjectStore('files', { keyPath: 'id' });
    await new Promise((resolve, reject) => {
      openRequest.onsuccess = () => {
        openRequest.result.close();
        resolve();
      };
      openRequest.onerror = () => reject(openRequest.error);
    });
  });
}

async function readRow(page, rowId) {
  return page.evaluate(async (id) => new Promise((resolve, reject) => {
    const openRequest = indexedDB.open('SeekPlayerDB', 1);
    openRequest.onerror = () => reject(openRequest.error);
    openRequest.onsuccess = () => {
      const database = openRequest.result;
      const transaction = database.transaction(['files'], 'readonly');
      const request = transaction.objectStore('files').get(id);
      let row;
      request.onsuccess = () => { row = request.result || null; };
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => {
        database.close();
        resolve(row);
      };
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error('row read aborted'));
    };
  }), rowId);
}

async function damageRow(page, rowId) {
  await page.evaluate(async (id) => new Promise((resolve, reject) => {
    const openRequest = indexedDB.open('SeekPlayerDB', 1);
    openRequest.onerror = () => reject(openRequest.error);
    openRequest.onsuccess = () => {
      const database = openRequest.result;
      const transaction = database.transaction(['files'], 'readwrite');
      const store = transaction.objectStore('files');
      const readRequest = store.get(id);
      readRequest.onerror = () => reject(readRequest.error);
      readRequest.onsuccess = () => {
        const row = readRequest.result;
        delete row.revision;
        row.content = { ...row.content, by_learning_unit_id: {} };
        row.checksum = `sha256:${'0'.repeat(64)}`;
        store.put(row);
      };
      transaction.oncomplete = () => {
        database.close();
        resolve();
      };
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error('row damage aborted'));
    };
  }), rowId);
}

async function seedAcquisition(page) {
  return page.evaluate(async () => {
    const module = await import('/src/services/vocabulary/vocabulary-acquisition-repository.js');
    const unit = {
      learning_unit_id: 'watermark-unit',
      word_id: 'watermark-word',
      normalized_form: 'watermark',
      language: 'en',
      target_sense_id: null,
      target_sense_key: null,
      target_sense: null,
      created_at: '2026-08-14T00:00:00.000Z',
      updated_at: '2026-08-14T00:00:00.000Z',
      revision: 0,
    };
    const repository = module.createIndexedDbAcquisitionRepository();
    await repository.putLearningUnit(unit, null);
    for (let expected = 0; expected < 5; expected += 1) {
      await repository.putLearningUnit({
        ...unit,
        revision: expected,
        updated_at: `2026-08-14T00:0${expected + 1}:00.000Z`,
      }, expected);
    }
    return unit;
  });
}

async function runAcquisitionScenario(server) {
  const scenario = await openTwoPages(server, 'read-web-vocabulary-watermark-acquisition-');
  const { context, first, second, profileDir } = scenario;
  try {
    await resetDatabase(first);
    const unit = await seedAcquisition(first);
    const staleSnapshot = await first.evaluate(async (seededUnit) => {
      const module = await import('/src/services/vocabulary/vocabulary-acquisition-repository.js');
      const repository = module.createIndexedDbAcquisitionRepository();
      window.__staleAcquisitionRepository = repository;
      window.__staleAcquisitionUnit = seededUnit;
      return repository.loadSnapshot();
    }, unit);
    assert.equal(Object.keys(staleSnapshot.by_learning_unit_id).length, 1);
    assert.equal((await readRow(first, 'vocabulary.acquisition.store.v1')).revision, 6);

    await damageRow(second, 'vocabulary.acquisition.store.v1');
    const recoveryPage = await context.newPage();
    await recoveryPage.goto(server.origin);
    const recovered = await recoveryPage.evaluate(async () => {
      const module = await import('/src/services/vocabulary/vocabulary-acquisition-repository.js');
      return module.createIndexedDbAcquisitionRepository().loadSnapshot();
    });
    assert.equal(Object.keys(recovered.by_learning_unit_id).length, 1);
    const recoveredRow = await readRow(recoveryPage, 'vocabulary.acquisition.store.v1');
    assert.ok(recoveredRow.revision > 6, `acquisition recovery reused revision 6: ${recoveredRow.revision}`);

    const staleResult = await first.evaluate(async () => window.__staleAcquisitionRepository.putLearningUnit({
      ...window.__staleAcquisitionUnit,
      revision: 6,
      updated_at: '2026-08-14T00:10:00.000Z',
    }, 6).then(
      (result) => ({ ok: true, revision: result.revision }),
      (error) => ({ ok: false, code: error?.code ?? null }),
    ));
    assert.equal(staleResult.ok, false);
    assert.equal(staleResult.code, 'CONCURRENT_MODIFICATION');

    await recoveryPage.close();
    const reopened = await context.newPage();
    await reopened.goto(server.origin);
    const reopenedRow = await readRow(reopened, 'vocabulary.acquisition.store.v1');
    assert.ok(reopenedRow.revision >= recoveredRow.revision);
    console.log('Vocabulary acquisition persistent watermark multi-page verification passed.');
  } finally {
    await context.close();
    const resolvedProfileDir = path.resolve(profileDir);
    const resolvedTempDir = `${path.resolve(os.tmpdir())}${path.sep}`;
    assert.equal(resolvedProfileDir.startsWith(resolvedTempDir), true);
    fs.rmSync(resolvedProfileDir, { recursive: true, force: true });
  }
}

async function runUowScenario(server) {
  const scenario = await openTwoPages(server, 'read-web-vocabulary-watermark-uow-');
  const { context, first, second, profileDir } = scenario;
  try {
    await resetDatabase(first);
    const unit = await seedAcquisition(first);
    const staleRevision = (await readRow(first, 'vocabulary.acquisition.store.v1')).revision;
    assert.equal(staleRevision, 6);
    await first.evaluate(async (seededUnit) => {
      const module = await import('/src/services/vocabulary/vocabulary-acquisition-repository.js');
      window.__staleUowUnit = seededUnit;
      window.__staleUowRepository = module.createIndexedDbAcquisitionRepository();
      await window.__staleUowRepository.loadSnapshot();
    }, unit);

    await damageRow(second, 'vocabulary.acquisition.store.v1');
    const recoveryPage = await context.newPage();
    await recoveryPage.goto(server.origin);
    const command = {
      command_id: 'watermark-uow-recovery',
      command_type: 'watermark_uow_recovery',
      correlation_id: 'watermark-uow-recovery-correlation',
      event_partition: '2026-08',
      payload: { synthetic: true },
    };
    const recovered = await recoveryPage.evaluate(async (activeCommand) => {
      const module = await import('/src/services/vocabulary/vocabulary-learning-uow.js');
      return module.runVocabularyLearningUnitOfWork(
        {},
        activeCommand,
        (bound) => bound.acquisition.getLearningUnit('watermark-unit'),
      );
    }, command);
    assert.equal(recovered.learning_unit_id, 'watermark-unit');
    const recoveredRow = await readRow(recoveryPage, 'vocabulary.acquisition.store.v1');
    assert.ok(recoveredRow.revision > 6, `UoW recovery reused revision 6: ${recoveredRow.revision}`);

    const staleResult = await first.evaluate(async (activeCommand) => {
      const module = await import('/src/services/vocabulary/vocabulary-learning-uow.js');
      return module.runVocabularyLearningUnitOfWork(
        {},
        activeCommand,
        (bound) => bound.acquisition.putLearningUnit({
          ...window.__staleUowUnit,
          revision: 6,
          updated_at: '2026-08-14T00:11:00.000Z',
        }, 6),
      ).then(
        (result) => ({ ok: true, result }),
        (error) => ({ ok: false, code: error?.code ?? null }),
      );
    }, {
      ...command,
      command_id: 'watermark-uow-stale-owner',
      correlation_id: 'watermark-uow-stale-owner-correlation',
    });
    assert.deepEqual(staleResult, { ok: false, code: 'REVISION_CONFLICT' });

    await recoveryPage.close();
    const reopened = await context.newPage();
    await reopened.goto(server.origin);
    const reopenedRow = await readRow(reopened, 'vocabulary.acquisition.store.v1');
    assert.ok(reopenedRow.revision >= recoveredRow.revision);
    console.log('Production vocabulary-learning-uow persistent watermark multi-page verification passed.');
  } finally {
    await context.close();
    const resolvedProfileDir = path.resolve(profileDir);
    const resolvedTempDir = `${path.resolve(os.tmpdir())}${path.sep}`;
    assert.equal(resolvedProfileDir.startsWith(resolvedTempDir), true);
    fs.rmSync(resolvedProfileDir, { recursive: true, force: true });
  }
}

async function main() {
  const server = await startModuleServer(path.resolve(__dirname, '..'));
  try {
    await runAcquisitionScenario(server);
    await runUowScenario(server);
  } finally {
    await server.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
