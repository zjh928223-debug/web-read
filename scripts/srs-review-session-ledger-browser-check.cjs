const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');

function startServer(repoRoot) {
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    if (url.pathname === '/') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end('<!doctype html><meta charset="utf-8"><title>P7 ledger verification</title>');
      return;
    }
    const target = path.resolve(repoRoot, decodeURIComponent(url.pathname).replace(/^\/+/u, ''));
    if (!target.startsWith(`${path.resolve(repoRoot)}${path.sep}`) || !target.endsWith('.js')) {
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
    server.listen(0, '127.0.0.1', () => resolve({
      origin: `http://127.0.0.1:${server.address().port}`,
      close: () => new Promise((done, fail) => server.close((error) => (
        error ? fail(error) : done()
      ))),
    }));
  });
}

async function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'read-web-p7-ledger-profile-'));
  const server = await startServer(repoRoot);
  let context;
  try {
    context = await chromium.launchPersistentContext(profileDir, { headless: true });
    const page = context.pages()[0] ?? await context.newPage();
    await page.goto(server.origin);
    await page.evaluate(async () => {
      await new Promise((resolve, reject) => {
        const request = indexedDB.deleteDatabase('SeekPlayerDB');
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
      await new Promise((resolve, reject) => {
        const request = indexedDB.open('SeekPlayerDB', 1);
        request.onupgradeneeded = () => {
          request.result.createObjectStore('files', { keyPath: 'id' });
        };
        request.onsuccess = () => {
          request.result.close();
          resolve();
        };
        request.onerror = () => reject(request.error);
      });
    });
    const ledger = {
      schema_version: 'session-ledger.v1',
      session_id: 'browser-session',
      created_at: '2026-07-28T08:00:00.000Z',
      local_day: '2026-07-28',
      timezone: 'Asia/Shanghai',
      policy_version: 'browser-policy.v1',
      mode: 'once_daily',
      budget_ms: 3600000,
      estimated_attempt_ms: 36000,
      entries: [{
        ledger_item_id: 'browser-session:0:due_review:browser-unit',
        position: 0,
        queue_kind: 'due_review',
        learning_unit_id: 'browser-unit',
        enqueue_reason: 'SCHEDULER_DUE',
        estimated_duration_ms: 36000,
        planned_due_at: '2026-07-28T07:00:00.000Z',
        revisit_ordinal: 0,
        extensions: {},
      }],
      cursor: 0,
      status: 'active',
      backlog: {
        due_review_count: 0,
        relearning_count: 0,
        reassessment_count: 0,
        acquisition_count: 0,
        estimated_ms: 0,
        extensions: {},
      },
      revision: 0,
      extensions: {
        completed_item_ids: [],
        attempt_ids: [],
        attempt_fingerprints_by_id: {},
        attempt_results_by_id: {},
        revisit_counts_by_learning_unit_id: {},
        active_duration_ms: 0,
      },
    };
    const created = await page.evaluate(async (input) => {
      const module = await import('/src/services/vocabulary/srs-review-session-ledger.js');
      const repository = module.createIndexedDbReviewSessionLedgerRepository();
      return repository.put(input, null);
    }, ledger);
    assert.deepEqual(created, ledger);

    await page.reload();
    const restored = await page.evaluate(async () => {
      const module = await import('/src/services/vocabulary/srs-review-session-ledger.js');
      return module.createIndexedDbReviewSessionLedgerRepository()
        .getBySessionId('browser-session');
    });
    assert.deepEqual(restored, ledger);

    const updated = {
      ...restored,
      cursor: 1,
      status: 'completed',
      extensions: {
        ...restored.extensions,
        completed_item_ids: [restored.entries[0].ledger_item_id],
        attempt_ids: ['browser-attempt'],
        attempt_fingerprints_by_id: {
          'browser-attempt': 'a'.repeat(64),
        },
        attempt_results_by_id: {
          'browser-attempt': { schema_version: 'review-attempt-result.v1' },
        },
      },
    };
    const updateResult = await page.evaluate(async (input) => {
      const module = await import('/src/services/vocabulary/srs-review-session-ledger.js');
      return module.createIndexedDbReviewSessionLedgerRepository().put(input, 0);
    }, updated);
    assert.equal(updateResult.revision, 1);

    await page.reload();
    const final = await page.evaluate(async (stale) => {
      const module = await import('/src/services/vocabulary/srs-review-session-ledger.js');
      const repository = module.createIndexedDbReviewSessionLedgerRepository();
      const restoredLedger = await repository.getBySessionId('browser-session');
      let staleCode = null;
      try {
        await repository.put(stale, 0);
      } catch (error) {
        staleCode = error?.code ?? null;
      }
      const schema = await new Promise((resolve, reject) => {
        const request = indexedDB.open('SeekPlayerDB', 1);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const database = request.result;
          const stores = [...database.objectStoreNames];
          const keyPath = database.transaction(['files'], 'readonly')
            .objectStore('files').keyPath;
          const version = database.version;
          database.close();
          resolve({ version, stores, keyPath });
        };
      });
      return { restoredLedger, staleCode, schema };
    }, ledger);
    assert.equal(final.restoredLedger.revision, 1);
    assert.equal(final.restoredLedger.status, 'completed');
    assert.equal(final.staleCode, 'CONCURRENT_MODIFICATION');
    assert.deepEqual(final.schema, {
      version: 1,
      stores: ['files'],
      keyPath: 'id',
    });
    console.log('P7 production IndexedDB session ledger browser checks passed');
  } finally {
    await context?.close().catch(() => undefined);
    await server.close().catch(() => undefined);
    fs.rmSync(profileDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
