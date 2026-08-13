const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');

function startModuleServer(repoRoot) {
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    if (url.pathname === '/') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end('<!doctype html><meta charset="utf-8"><title>P6 IDB verification</title>');
      return;
    }
    const relative = decodeURIComponent(url.pathname).replace(/^\/+/u, '');
    const target = path.resolve(repoRoot, relative);
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
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'read-web-p6-idb-profile-'));
  const server = await startModuleServer(repoRoot);
  let context;
  try {
    context = await chromium.launchPersistentContext(profileDir, { headless: true });
    const page = context.pages()[0] ?? await context.newPage();
    await page.goto(server.origin);

    await page.evaluate(async () => {
      const deleteDatabase = () => new Promise((resolve, reject) => {
        const request = indexedDB.deleteDatabase('SeekPlayerDB');
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error('delete blocked'));
      });
      const createDatabase = ({ version = 1, createStore = true, keyPath = 'id' } = {}) => (
        new Promise((resolve, reject) => {
          const request = indexedDB.open('SeekPlayerDB', version);
          request.onupgradeneeded = () => {
            if (createStore) request.result.createObjectStore('files', { keyPath });
          };
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            request.result.close();
            resolve();
          };
        })
      );
      await deleteDatabase();
      await createDatabase();
    });

    const first = await page.evaluate(async () => {
      const uow = await import('/src/services/vocabulary/vocabulary-learning-uow.js');
      const acquisition = await import('/src/services/vocabulary/vocabulary-acquisition-service.js');
      const command = {
        command_id: 'browser-command-candidate',
        correlation_id: 'browser-correlation-candidate',
        event_partition: '2026-07',
        payload: {
          learning_unit: {
            learning_unit_id: 'browser-unit-candidate',
            word_id: 'browser-word-candidate',
            normalized_form: 'browser-synthetic',
            language: 'en',
            target_sense_id: null,
            target_sense_key: null,
            target_sense: null,
            created_at: '2026-07-20T08:00:00.000Z',
            updated_at: '2026-07-20T08:00:00.000Z',
          },
          event_id: 'browser-event-candidate',
        },
      };
      let callbackInvocations = 0;
      let completedTransactions = 0;
      const originalTransaction = IDBDatabase.prototype.transaction;
      IDBDatabase.prototype.transaction = function patchedTransaction(...args) {
        const transaction = originalTransaction.apply(this, args);
        if (args[1] === 'readwrite') {
          transaction.addEventListener('complete', () => {
            completedTransactions += 1;
          });
        }
        return transaction;
      };
      const service = acquisition.createVocabularyAcquisitionService({
        enabled: true,
        now: () => '2026-07-20T08:00:01.000Z',
        runUnitOfWork: (dependencies, activeCommand, execute) => (
          uow.runVocabularyLearningUnitOfWork(
            dependencies,
            activeCommand,
            async (bound) => {
              callbackInvocations += 1;
              return execute(bound);
            },
          )
        ),
      });
      let result;
      try {
        result = await service.queueCandidate(command);
      } finally {
        IDBDatabase.prototype.transaction = originalTransaction;
      }
      const rows = await new Promise((resolve, reject) => {
        const request = indexedDB.open('SeekPlayerDB', 1);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const database = request.result;
          const transaction = database.transaction(['files'], 'readonly');
          const getAll = transaction.objectStore('files').getAll();
          getAll.onerror = () => reject(getAll.error);
          transaction.oncomplete = () => {
            database.close();
            resolve(getAll.result.sort((left, right) => left.id.localeCompare(right.id)));
          };
        };
      });
      return {
        command,
        result,
        callbackInvocations,
        completedTransactions,
        rows,
      };
    });
    assert.equal(first.callbackInvocations, 1);
    assert.ok(first.completedTransactions >= 1, 'Promise resolves only after readwrite oncomplete');
    assert.equal(
      first.rows.some((row) => row.id === 'vocabulary.learning-command-receipt.v1:browser-command-candidate'),
      true,
    );
    assert.equal(
      first.rows.some((row) => row.id === 'vocabulary.learning-events.manifest.v1'),
      true,
    );
    const acquisitionRow = first.rows.find((row) => row.id === 'vocabulary.acquisition.store.v1');
    assert.match(acquisitionRow.checksum, /^sha256:[a-f0-9]{64}$/u);
    assert.equal(acquisitionRow.revision, 1);

    await page.reload();
    const retry = await page.evaluate(async (command) => {
      const uow = await import('/src/services/vocabulary/vocabulary-learning-uow.js');
      const acquisition = await import('/src/services/vocabulary/vocabulary-acquisition-service.js');
      let callbackInvocations = 0;
      const service = acquisition.createVocabularyAcquisitionService({
        enabled: true,
        now: () => '2030-01-01T00:00:00.000Z',
        runUnitOfWork: (dependencies, activeCommand, execute) => (
          uow.runVocabularyLearningUnitOfWork(
            dependencies,
            activeCommand,
            async (bound) => {
              callbackInvocations += 1;
              return execute(bound);
            },
          )
        ),
      });
      const result = await service.queueCandidate(command);
      result.learning_unit_id = 'mutated-return-copy';
      const rows = await new Promise((resolve, reject) => {
        const request = indexedDB.open('SeekPlayerDB', 1);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const database = request.result;
          const transaction = database.transaction(['files'], 'readonly');
          const getAll = transaction.objectStore('files').getAll();
          getAll.onerror = () => reject(getAll.error);
          transaction.oncomplete = () => {
            database.close();
            resolve(getAll.result.sort((left, right) => left.id.localeCompare(right.id)));
          };
        };
      });
      const receipt = rows.find(
        (row) => row.id === 'vocabulary.learning-command-receipt.v1:browser-command-candidate',
      );
      return {
        callbackInvocations,
        storedResult: receipt.content.result,
        rows,
      };
    }, first.command);
    assert.equal(retry.callbackInvocations, 0);
    assert.equal(retry.storedResult.learning_unit_id, 'browser-unit-candidate');
    assert.deepEqual(retry.rows, first.rows, 'refresh retry preserves timestamps and events');

    const conflict = await page.evaluate(async (command) => {
      const uow = await import('/src/services/vocabulary/vocabulary-learning-uow.js');
      const acquisition = await import('/src/services/vocabulary/vocabulary-acquisition-service.js');
      let callbackInvocations = 0;
      const service = acquisition.createVocabularyAcquisitionService({
        enabled: true,
        runUnitOfWork: (dependencies, activeCommand, execute) => (
          uow.runVocabularyLearningUnitOfWork(
            dependencies,
            activeCommand,
            async (bound) => {
              callbackInvocations += 1;
              return execute(bound);
            },
          )
        ),
      });
      const changed = structuredClone(command);
      changed.payload.learning_unit.normalized_form = 'browser-semantic-conflict';
      let error;
      try {
        await service.queueCandidate(changed);
      } catch (caught) {
        error = { code: caught.code, details: caught.details };
      }
      const rows = await new Promise((resolve, reject) => {
        const request = indexedDB.open('SeekPlayerDB', 1);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const database = request.result;
          const transaction = database.transaction(['files'], 'readonly');
          const getAll = transaction.objectStore('files').getAll();
          transaction.oncomplete = () => {
            database.close();
            resolve(getAll.result.sort((left, right) => left.id.localeCompare(right.id)));
          };
        };
      });
      return { error, callbackInvocations, rows };
    }, first.command);
    assert.equal(conflict.error.code, 'IDEMPOTENCY_CONFLICT');
    assert.equal(conflict.callbackInvocations, 0);
    assert.deepEqual(conflict.rows, first.rows);

    const callbackFailure = await page.evaluate(async () => {
      const uow = await import('/src/services/vocabulary/vocabulary-learning-uow.js');
      const readRows = () => new Promise((resolve, reject) => {
        const request = indexedDB.open('SeekPlayerDB', 1);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const database = request.result;
          const transaction = database.transaction(['files'], 'readonly');
          const getAll = transaction.objectStore('files').getAll();
          transaction.oncomplete = () => {
            database.close();
            resolve(getAll.result.sort((left, right) => left.id.localeCompare(right.id)));
          };
        };
      });
      const before = await readRows();
      let error;
      try {
        await uow.runVocabularyLearningUnitOfWork(
          { now: () => '2026-07-20T09:00:00.000Z' },
          {
            command_id: 'browser-command-callback-failure',
            command_type: 'browser_callback_failure',
            correlation_id: 'browser-correlation-callback-failure',
            event_partition: '2026-07',
            payload: { synthetic: true },
          },
          async (bound) => {
            await bound.review.putInitial({
              schema_version: 'review-state.v2',
              review_state_id: 'browser-review-rollback',
              learning_unit_id: 'browser-unit-rollback',
              word_id: 'browser-word-rollback',
              state: 'new',
              due_at: '2026-07-20T09:00:00.000Z',
              stability: 0,
              difficulty: 5,
              elapsed_days: 0,
              scheduled_days: 0,
              reps: 0,
              lapses: 0,
              learning_steps: 0,
              last_review_at: null,
              scheduler_version: 'fsrs.v1',
              scheduler_parameters_version: 'fsrs-parameters.v1',
              created_at: '2026-07-20T09:00:00.000Z',
              updated_at: '2026-07-20T09:00:00.000Z',
              revision: 0,
              extensions: {},
            });
            throw new Error('synthetic callback failure');
          },
        );
      } catch (caught) {
        error = { code: caught.code, details: caught.details };
      }
      return { before, after: await readRows(), error };
    });
    assert.equal(callbackFailure.error.code, 'TRANSACTION_ABORTED');
    assert.deepEqual(callbackFailure.after, callbackFailure.before);

    const requestFailure = await page.evaluate(async () => {
      const uow = await import('/src/services/vocabulary/vocabulary-learning-uow.js');
      const readRows = () => new Promise((resolve, reject) => {
        const request = indexedDB.open('SeekPlayerDB', 1);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const database = request.result;
          const transaction = database.transaction(['files'], 'readonly');
          const getAll = transaction.objectStore('files').getAll();
          transaction.oncomplete = () => {
            database.close();
            resolve(getAll.result.sort((left, right) => left.id.localeCompare(right.id)));
          };
        };
      });
      const before = await readRows();
      const originalPut = IDBObjectStore.prototype.put;
      let abortedOnce = false;
      IDBObjectStore.prototype.put = function abortingPut(...args) {
        const request = originalPut.apply(this, args);
        if (!abortedOnce && this.transaction.mode === 'readwrite') {
          abortedOnce = true;
          this.transaction.abort();
        }
        return request;
      };
      let error;
      try {
        await uow.runVocabularyLearningUnitOfWork(
          { now: () => '2026-07-20T10:00:00.000Z' },
          {
            command_id: 'browser-command-request-failure',
            command_type: 'browser_request_failure',
            correlation_id: 'browser-correlation-request-failure',
            event_partition: '2026-07',
            payload: { synthetic: true },
          },
          async () => ({ schema_version: 'browser-result.v1' }),
        );
      } catch (caught) {
        error = { code: caught.code, details: caught.details };
      } finally {
        IDBObjectStore.prototype.put = originalPut;
      }
      return { before, after: await readRows(), error, abortedOnce };
    });
    assert.equal(requestFailure.abortedOnce, true);
    assert.equal(requestFailure.error.code, 'TRANSACTION_ABORTED');
    assert.deepEqual(requestFailure.after, requestFailure.before);

    const schemaResults = await page.evaluate(async () => {
      const uow = await import('/src/services/vocabulary/vocabulary-learning-uow.js');
      const deleteDatabase = () => new Promise((resolve, reject) => {
        const request = indexedDB.deleteDatabase('SeekPlayerDB');
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error('delete blocked'));
      });
      const createDatabase = ({ version = 1, createStore = true, keyPath = 'id' } = {}) => (
        new Promise((resolve, reject) => {
          const request = indexedDB.open('SeekPlayerDB', version);
          request.onupgradeneeded = () => {
            if (createStore) request.result.createObjectStore('files', { keyPath });
          };
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            request.result.close();
            resolve();
          };
        })
      );
      const runProbe = async (suffix) => {
        try {
          await uow.runVocabularyLearningUnitOfWork(
            {},
            {
              command_id: `browser-schema-${suffix}`,
              command_type: 'browser_schema_probe',
              correlation_id: `browser-schema-correlation-${suffix}`,
              event_partition: '2026-07',
              payload: { suffix },
            },
            async () => ({ schema_version: 'browser-result.v1' }),
          );
          return null;
        } catch (error) {
          return error.code;
        }
      };
      await deleteDatabase();
      const missingDatabase = await runProbe('missing-database');
      await deleteDatabase();
      await createDatabase({ createStore: false });
      const missingStore = await runProbe('missing-store');
      await deleteDatabase();
      await createDatabase({ keyPath: 'uuid' });
      const wrongKeyPath = await runProbe('wrong-key-path');
      await deleteDatabase();
      await createDatabase({ version: 2 });
      const wrongVersion = await runProbe('wrong-version');
      await deleteDatabase();
      return { missingDatabase, missingStore, wrongKeyPath, wrongVersion };
    });
    assert.deepEqual(schemaResults, {
      missingDatabase: 'TRANSACTION_ABORTED',
      missingStore: 'TRANSACTION_ABORTED',
      wrongKeyPath: 'TRANSACTION_ABORTED',
      wrongVersion: 'TRANSACTION_ABORTED',
    });

    console.log('Vocabulary learning production IndexedDB browser verification passed.');
  } finally {
    if (context) await context.close();
    await server.close();
    const resolvedProfileDir = path.resolve(profileDir);
    const resolvedTempDir = `${path.resolve(os.tmpdir())}${path.sep}`;
    assert.equal(
      resolvedProfileDir.startsWith(resolvedTempDir),
      true,
      'disposable profile cleanup must remain inside the system temp directory',
    );
    fs.rmSync(resolvedProfileDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
