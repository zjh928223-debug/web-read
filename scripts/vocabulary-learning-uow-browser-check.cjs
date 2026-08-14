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

    const productionFaults = await page.evaluate(async () => {
      const uow = await import('/src/services/vocabulary/vocabulary-learning-uow.js');
      const persistence = await import('/src/services/vocabulary/vocabulary-persistence.js');
      const readRows = () => new Promise((resolve, reject) => {
        const request = indexedDB.open('SeekPlayerDB', 1);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const database = request.result;
          const transaction = database.transaction(['files'], 'readonly');
          const rowsRequest = transaction.objectStore('files').getAll();
          rowsRequest.onerror = () => reject(rowsRequest.error);
          rowsRequest.onsuccess = () => {
            transaction.oncomplete = () => {
              database.close();
              resolve(rowsRequest.result);
            };
            transaction.onerror = () => reject(transaction.error);
          };
        };
      });
      const writeRows = (mutate) => new Promise((resolve, reject) => {
        const request = indexedDB.open('SeekPlayerDB', 1);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const database = request.result;
          const transaction = database.transaction(['files'], 'readwrite');
          const store = transaction.objectStore('files');
          try {
            mutate(store);
          } catch (error) {
            transaction.abort();
            reject(error);
            return;
          }
          transaction.oncomplete = () => {
            database.close();
            resolve();
          };
          transaction.onerror = () => reject(transaction.error);
          transaction.onabort = () => reject(transaction.error);
        };
      });
      const baseRows = await readRows();
      const baseAcquisition = baseRows.find((row) => row.id === 'vocabulary.acquisition.store.v1');
      const backupContent = {
        schema_version: 'vocabulary-backup.v1',
        sourceId: baseAcquisition.id,
        sourceRow: { ...baseAcquisition, revision: 1 },
        createdAt: '2026-07-20T11:00:00.000Z',
      };
      const corruptContent = { ...baseAcquisition.content, by_learning_unit_id: {} };
      const corruptRow = {
        ...baseAcquisition,
        revision: 3,
        content: corruptContent,
        checksum: `sha256:${'0'.repeat(64)}`,
      };
      await writeRows((store) => {
        store.put({
          id: `${baseAcquisition.id}.backup:1`,
          content: backupContent,
          revision: 1,
          timestamp: backupContent.createdAt,
          checksum: persistence.checksumFor(backupContent),
        });
        store.put(corruptRow);
      });
      let recoveryCalls = 0;
      const recovered = await uow.runVocabularyLearningUnitOfWork(
        { now: () => '2026-07-20T11:00:01.000Z' },
        {
          command_id: 'browser-command-uow-corrupt-recovery',
          command_type: 'browser_uow_corrupt_recovery',
          correlation_id: 'browser-correlation-uow-corrupt-recovery',
          event_partition: '2026-07',
          payload: { synthetic: true },
        },
        async (bound) => {
          recoveryCalls += 1;
          return bound.acquisition.getLearningUnit('browser-unit-candidate');
        },
      );
      const afterRecovery = await readRows();
      const recoveredRow = afterRecovery.find((row) => row.id === baseAcquisition.id);
      const recoveryQuarantine = afterRecovery.find((row) => row.id.startsWith('vocabulary.corrupt.quarantine.v1:'));

      const noBackupContent = { ...recoveredRow.content, by_learning_unit_id: {} };
      await writeRows((store) => {
        afterRecovery
          .filter((row) => row.id.startsWith(`${baseAcquisition.id}.backup:`))
          .forEach((row) => store.delete(row.id));
        store.put({
          ...recoveredRow,
          revision: 7,
          content: noBackupContent,
          checksum: `sha256:${'0'.repeat(64)}`,
        });
      });
      let noBackupError;
      try {
        await uow.runVocabularyLearningUnitOfWork(
          { now: () => '2026-07-20T11:00:02.000Z' },
          {
            command_id: 'browser-command-uow-corrupt-no-backup',
            command_type: 'browser_uow_corrupt_no_backup',
            correlation_id: 'browser-correlation-uow-corrupt-no-backup',
            event_partition: '2026-07',
            payload: { synthetic: true },
          },
          (bound) => bound.acquisition.getLearningUnit('browser-unit-candidate'),
        );
      } catch (error) {
        noBackupError = error.code;
      }
      const afterNoBackup = await readRows();
      const noBackupRow = afterNoBackup.find((row) => row.id === baseAcquisition.id);

      const unknownContent = { ...noBackupRow.content, schema_version: 'acquisition-store.v99' };
      const unknownRow = {
        ...noBackupRow,
        content: unknownContent,
        checksum: persistence.checksumFor(unknownContent),
      };
      await writeRows((store) => store.put(unknownRow));
      let unknownError;
      try {
        await uow.runVocabularyLearningUnitOfWork(
          { now: () => '2026-07-20T11:00:03.000Z' },
          {
            command_id: 'browser-command-uow-unknown-schema',
            command_type: 'browser_uow_unknown_schema',
            correlation_id: 'browser-correlation-uow-unknown-schema',
            event_partition: '2026-07',
            payload: { synthetic: true },
          },
          (bound) => bound.acquisition.getLearningUnit('browser-unit-candidate'),
        );
      } catch (error) {
        unknownError = error.code;
      }
      const unknownStored = (await readRows()).find((row) => row.id === baseAcquisition.id);

      const faultProbe = async (faultName, commandId) => {
        const originalPut = IDBObjectStore.prototype.put;
        let injected = false;
        IDBObjectStore.prototype.put = function injectedPut(...args) {
          if (!injected && this.transaction.mode === 'readwrite') {
            injected = true;
            throw new DOMException('injected vocabulary fault', faultName);
          }
          return originalPut.apply(this, args);
        };
        let code;
        try {
          await uow.runVocabularyLearningUnitOfWork(
            { now: () => '2026-07-20T11:00:04.000Z' },
            {
              command_id: commandId,
              command_type: `browser_${faultName}`,
              correlation_id: `${commandId}:correlation`,
              event_partition: '2026-07',
              payload: { synthetic: true },
            },
            (bound) => bound.review.putInitial({
              schema_version: 'review-state.v2',
              review_state_id: `${commandId}:review`,
              learning_unit_id: `${commandId}:learning`,
              word_id: `${commandId}:word`,
              state: 'new',
              due_at: '2026-07-20T11:00:04.000Z',
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
              created_at: '2026-07-20T11:00:04.000Z',
              updated_at: '2026-07-20T11:00:04.000Z',
              revision: 0,
              extensions: {},
            }),
          );
        } catch (error) {
          code = error.code;
        } finally {
          IDBObjectStore.prototype.put = originalPut;
        }
        return code;
      };
      const quotaError = await faultProbe('QuotaExceededError', 'browser-command-uow-quota');
      const closeError = await faultProbe('InvalidStateError', 'browser-command-uow-close');
      return {
        recovered: recovered.learning_unit_id,
        recoveryCalls,
        recoveredRevision: recoveredRow.revision,
        damagedRevision: corruptRow.revision,
        recoveryQuarantine: Boolean(recoveryQuarantine),
        noBackupError,
        noBackupRevision: noBackupRow.revision,
        unknownError,
        unknownUnchanged: JSON.stringify(unknownStored) === JSON.stringify(unknownRow),
        quotaError,
        closeError,
      };
    });
    assert.deepEqual(productionFaults, {
      recovered: 'browser-unit-candidate',
      recoveryCalls: 2,
      recoveredRevision: 4,
      damagedRevision: 3,
      recoveryQuarantine: true,
      noBackupError: 'CORRUPT',
      noBackupRevision: 7,
      unknownError: 'UNKNOWN_SCHEMA',
      unknownUnchanged: true,
      quotaError: 'QUOTA_EXCEEDED',
      closeError: 'CONNECTION_CLOSED',
    });

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
      missingDatabase: 'UNKNOWN_SCHEMA',
      missingStore: 'UNKNOWN_SCHEMA',
      wrongKeyPath: 'UNKNOWN_SCHEMA',
      wrongVersion: 'UNKNOWN_SCHEMA',
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
