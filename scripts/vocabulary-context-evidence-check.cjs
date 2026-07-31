const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

async function importContextEvidenceModule(repoRoot) {
  const sourcePath = path.join(
    repoRoot,
    'src',
    'services',
    'vocabulary',
    'vocabulary-context-evidence.js',
  );
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'read-web-context-evidence-'));
  const modulePath = path.join(tempDir, 'vocabulary-context-evidence.mjs');
  fs.copyFileSync(sourcePath, modulePath);
  try {
    return await import(`${pathToFileURL(modulePath).href}?v=${Date.now()}`);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(',')}}`;
}

function expectedContentHash(sentence, surroundingText) {
  return crypto
    .createHash('sha256')
    .update(canonicalJson({
      sentence,
      surrounding_text: surroundingText,
    }))
    .digest('hex');
}

async function assertStableIndexedDbFailure(promise, operation, sensitiveText) {
  await assert.rejects(promise, (error) => {
    const exportedError = {
      code: error.code,
      message: error.message,
      details: error.details,
    };
    assert.deepEqual(exportedError, {
      code: 'TRANSACTION_ABORTED',
      message: 'ContextEvidence IndexedDB operation failed',
      details: { operation },
    });
    assert.equal(JSON.stringify(exportedError).includes(sensitiveText), false);
    return true;
  });
}

function createFakeIndexedDb(options = {}) {
  const keyPath = options.keyPath ?? 'id';
  const rows = new Map();
  const calls = {
    open: [],
    transactions: [],
    transactionAttempts: 0,
    objectStoreAttempts: 0,
    gets: 0,
    puts: 0,
    close: 0,
    createObjectStore: 0,
  };

  function createTransaction(storeNames, mode) {
    const transaction = {
      error: null,
      oncomplete: null,
      onerror: null,
      onabort: null,
      aborted: false,
      pending: 0,
      abort() {
        this.aborted = true;
        queueMicrotask(() => this.onabort?.());
      },
      objectStore(name) {
        calls.objectStoreAttempts += 1;
        if (calls.objectStoreAttempts === options.objectStoreThrowsAt) {
          throw new Error('P2_SENSITIVE_OBJECT_STORE_DIAGNOSTIC');
        }
        assert.equal(name, 'files');
        return {
          keyPath,
          get(id) {
            calls.gets += 1;
            if (calls.gets === options.getThrowsAt) {
              throw new Error('P2_SENSITIVE_GET_DIAGNOSTIC');
            }
            const request = { result: undefined, error: null, onsuccess: null, onerror: null };
            transaction.pending += 1;
            queueMicrotask(() => {
              if (transaction.aborted) return;
              if (calls.gets === options.getRequestErrorsAt) {
                request.error = new Error('P2_SENSITIVE_GET_REQUEST_DIAGNOSTIC');
                request.onerror?.();
                transaction.pending -= 1;
                return;
              }
              request.result = rows.has(id) ? clone(rows.get(id)) : undefined;
              request.onsuccess?.();
              transaction.pending -= 1;
              queueMicrotask(() => {
                if (calls.gets === options.transactionErrorOnGetAt) {
                  transaction.error = new Error('P2_SENSITIVE_ASYNC_TRANSACTION_DIAGNOSTIC');
                  transaction.onerror?.();
                } else if (!transaction.aborted && transaction.pending === 0) {
                  transaction.oncomplete?.();
                }
              });
            });
            return request;
          },
          put(row) {
            calls.puts += 1;
            if (calls.puts === options.putThrowsAt) {
              throw new Error('P2_SENSITIVE_PUT_DIAGNOSTIC');
            }
            const request = { result: undefined, error: null, onsuccess: null, onerror: null };
            transaction.pending += 1;
            queueMicrotask(() => {
              if (transaction.aborted) return;
              if (calls.puts === options.putRequestErrorsAt) {
                request.error = new Error('P2_SENSITIVE_PUT_REQUEST_DIAGNOSTIC');
                request.onerror?.();
                transaction.pending -= 1;
                return;
              }
              rows.set(row.id, clone(row));
              request.result = row.id;
              request.onsuccess?.();
              transaction.pending -= 1;
              queueMicrotask(() => {
                if (!transaction.aborted && transaction.pending === 0) transaction.oncomplete?.();
              });
            });
            return request;
          },
        };
      },
    };
    calls.transactions.push({ storeNames: clone(storeNames), mode });
    return transaction;
  }

  const database = {
    objectStoreNames: {
      contains(name) {
        return name === 'files';
      },
    },
    transaction(storeNames, mode) {
      calls.transactionAttempts += 1;
      if (calls.transactionAttempts === options.transactionThrowsAt) {
        throw new Error('P2_SENSITIVE_TRANSACTION_DIAGNOSTIC');
      }
      return createTransaction(storeNames, mode);
    },
    close() {
      calls.close += 1;
    },
    createObjectStore() {
      calls.createObjectStore += 1;
      throw new Error('createObjectStore must not be called');
    },
  };

  return {
    rows,
    calls,
    api: {
      open(name, version) {
        calls.open.push({ name, version });
        const request = {
          result: database,
          error: null,
          transaction: null,
          onsuccess: null,
          onerror: null,
          onupgradeneeded: null,
        };
        queueMicrotask(() => request.onsuccess?.());
        return request;
      },
    },
  };
}

async function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const api = await importContextEvidenceModule(repoRoot);
  const fixturePath = path.join(
    repoRoot,
    'scripts',
    'fixtures',
    'vocabulary-context-evidence.v1.json',
  );
  const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

  assert.equal(fixture.schema_version, 'context-evidence-fixtures.v1');
  assert.equal(api.CONTEXT_EVIDENCE_STORE_KEY, 'vocabulary.context-evidence.store.v1');
  assert.equal(api.CONTEXT_EVIDENCE_SCHEMA_VERSION, 'context-evidence.v1');
  assert.equal(api.SOURCE_LOCATOR_VERSION, 'source-locator.v1');
  assert.deepEqual(
    fixture.items.map((item) => item.source_kind),
    [
      'article',
      'subtitle',
      'user_local_exam_material',
      'open_corpus',
      'dictionary_example',
      'ai_candidate',
      'article',
    ],
  );

  const normalized = fixture.items.map(api.normalizeContextEvidence);
  normalized.forEach(api.assertContextEvidence);
  assert.equal(
    normalized[0].content_sha256,
    expectedContentHash(
      'The lantern glowed beside the quiet path.',
      'A traveler paused before continuing.',
    ),
    'content hash must cover canonical sentence and surrounding text',
  );
  assert.equal(normalized[5].quality_status, 'pending', 'AI candidates default to pending');
  assert.equal(
    normalized[6].quality_status,
    'pending',
    'unknown licenses cannot become validated anchors',
  );

  const articleWithoutProvenance = clone(fixture.items[0]);
  articleWithoutProvenance.context_evidence_id = 'context-article-unknown-provenance';
  delete articleWithoutProvenance.license_kind;
  delete articleWithoutProvenance.ownership;
  delete articleWithoutProvenance.quality_status;
  delete articleWithoutProvenance.validated_at;
  const normalizedArticleWithoutProvenance = api.normalizeContextEvidence(
    articleWithoutProvenance,
  );
  assert.equal(normalizedArticleWithoutProvenance.license_kind, 'unknown');
  assert.equal(normalizedArticleWithoutProvenance.ownership, 'third_party');
  assert.equal(normalizedArticleWithoutProvenance.quality_status, 'pending');
  assert.equal(
    api.selectValidatedAnchor('unit-shared-sense', [normalizedArticleWithoutProvenance]),
    null,
    'article evidence without explicit provenance cannot become an anchor',
  );

  const subtitleWithoutProvenance = clone(fixture.items[1]);
  subtitleWithoutProvenance.context_evidence_id = 'context-subtitle-unknown-provenance';
  delete subtitleWithoutProvenance.license_kind;
  delete subtitleWithoutProvenance.ownership;
  delete subtitleWithoutProvenance.quality_status;
  delete subtitleWithoutProvenance.validated_at;
  const normalizedSubtitleWithoutProvenance = api.normalizeContextEvidence(
    subtitleWithoutProvenance,
  );
  assert.equal(normalizedSubtitleWithoutProvenance.license_kind, 'unknown');
  assert.equal(normalizedSubtitleWithoutProvenance.ownership, 'third_party');
  assert.equal(normalizedSubtitleWithoutProvenance.quality_status, 'pending');
  assert.equal(
    api.selectValidatedAnchor('unit-shared-sense', [normalizedSubtitleWithoutProvenance]),
    null,
    'subtitle evidence without explicit provenance cannot become an anchor',
  );
  assert.throws(
    () => {
      const forgedValidatedArticle = clone(fixture.items[0]);
      forgedValidatedArticle.context_evidence_id = 'context-article-forged-validation';
      delete forgedValidatedArticle.license_kind;
      delete forgedValidatedArticle.ownership;
      api.normalizeContextEvidence(forgedValidatedArticle);
    },
    (error) => (
      error.code === 'INVALID_TIMESTAMP'
      && error.details?.field === 'validated_at'
    ),
    'validated status cannot bypass missing article provenance',
  );
  assert.equal(normalized[0].license_kind, 'user_owned');
  assert.equal(normalized[0].ownership, 'user');
  assert.equal(normalized[0].quality_status, 'validated');
  assert.equal(normalized[1].license_kind, 'user_owned');
  assert.equal(normalized[1].ownership, 'user');
  assert.equal(normalized[1].quality_status, 'validated');
  assert.equal(
    api.selectValidatedAnchor('unit-shared-sense', [normalized[0], normalized[1]])
      .context_evidence_id,
    normalized[0].context_evidence_id,
    'explicitly proven local article/subtitle evidence remains eligible',
  );

  const whitespaceNormalized = api.normalizeContextEvidence({
    ...fixture.items[0],
    context_evidence_id: 'context-normalization-1',
    sentence: '  The   lantern glowed beside the quiet path.  ',
    surrounding_text: 'A traveler   paused before continuing.',
    content_sha256: undefined,
  });
  assert.equal(whitespaceNormalized.sentence, 'The lantern glowed beside the quiet path.');
  assert.equal(
    whitespaceNormalized.surrounding_text,
    'A traveler paused before continuing.',
  );

  assert.throws(
    () => api.normalizeContextEvidence({
      ...fixture.items[0],
      schema_version: 'context-evidence.v2',
    }),
    (error) => error.code === 'UNSUPPORTED_SCHEMA_VERSION',
  );
  assert.throws(
    () => api.normalizeContextEvidence({
      ...fixture.items[0],
      source_kind: 'untracked_source',
    }),
    (error) => error.code === 'INVALID_ENUM_VALUE',
  );
  assert.throws(
    () => api.normalizeContextEvidence({
      ...fixture.items[0],
      source_locator: {
        locator_version: 'source-locator.v1',
      },
    }),
    (error) => error.code === 'INVALID_FIELD_TYPE',
  );
  assert.throws(
    () => api.normalizeContextEvidence({
      ...fixture.items[2],
      license_kind: 'licensed_open',
    }),
    (error) => error.code === 'INVALID_ENUM_VALUE',
  );
  assert.throws(
    () => api.normalizeContextEvidence({
      ...fixture.items[3],
      license_kind: 'unknown',
      quality_status: 'pending',
      validated_at: null,
    }),
    (error) => error.code === 'INVALID_ENUM_VALUE',
  );
  assert.throws(
    () => api.normalizeContextEvidence({
      ...fixture.items[4],
      license_kind: 'user_owned',
    }),
    (error) => error.code === 'INVALID_ENUM_VALUE',
  );
  assert.throws(
    () => api.normalizeContextEvidence({
      ...fixture.items[5],
      license_kind: 'unknown',
    }),
    (error) => error.code === 'INVALID_ENUM_VALUE',
  );

  const repository = api.createInMemoryContextEvidenceRepository();
  const articleInput = clone(normalized[0]);
  const storedArticle = await repository.put(articleInput, null);
  articleInput.sentence = 'mutated outside repository';
  assert.equal(
    (await repository.getById(storedArticle.context_evidence_id)).sentence,
    normalized[0].sentence,
    'repository input must be deep-cloned',
  );
  const fetchedArticle = await repository.getById(storedArticle.context_evidence_id);
  fetchedArticle.source_locator.sentence_index = 999;
  const fetchedSnapshot = await repository.loadSnapshot();
  fetchedSnapshot.by_context_evidence_id[storedArticle.context_evidence_id].sentence = 'mutated snapshot';
  assert.equal(
    (await repository.getById(storedArticle.context_evidence_id)).source_locator.sentence_index,
    4,
    'repository outputs must be deep-cloned',
  );
  assert.equal(
    (await repository.getById(storedArticle.context_evidence_id)).sentence,
    normalized[0].sentence,
    'snapshot outputs must be deep-cloned',
  );
  const storedSubtitle = await repository.put(normalized[1], null);
  assert.equal(storedSubtitle.revision, 0);
  assert.equal((await repository.listByLearningUnit('unit-shared-sense')).length, 2);

  await assert.rejects(
    repository.put({
      ...storedArticle,
      created_at: '2026-07-20T09:00:00.000Z',
    }, 0),
    (error) => (
      error.code === 'INVALID_FIELD_TYPE'
      && error.details?.field === 'created_at'
    ),
    'created_at is immutable after ContextEvidence creation',
  );

  const duplicate = api.normalizeContextEvidence({
    ...fixture.items[0],
    context_evidence_id: 'context-article-duplicate-id',
  });
  const deduplicated = await repository.put(duplicate, null);
  assert.equal(
    deduplicated.context_evidence_id,
    storedArticle.context_evidence_id,
    'the frozen provenance dedupe key must prevent duplicate sentences',
  );
  assert.equal((await repository.listByLearningUnit('unit-shared-sense')).length, 2);

  const updatedArticle = await repository.put({
    ...storedArticle,
    quality_reason: 'reviewed_again',
  }, 0);
  assert.equal(updatedArticle.revision, 1);
  const idempotentUpdate = await repository.put(updatedArticle, 1);
  assert.equal(idempotentUpdate.revision, 1, 'identical updates must be idempotent');
  await assert.rejects(
    repository.put({ ...updatedArticle, quality_reason: 'stale_update' }, 0),
    (error) => error.code === 'CONCURRENT_MODIFICATION',
  );

  const selectedAnchor = api.selectValidatedAnchor(
    'unit-shared-sense',
    await repository.listByLearningUnit('unit-shared-sense'),
  );
  assert.equal(
    selectedAnchor.context_evidence_id,
    'context-article-1',
    'anchor selection must be deterministic for multiple sentences supporting one sense',
  );
  assert.equal(
    api.selectValidatedAnchor('unit-ai-candidate', [normalized[5]]),
    null,
    'pending AI candidates cannot become anchors',
  );
  assert.equal(
    api.selectValidatedAnchor('unit-unknown-license', [normalized[6]]),
    null,
    'unknown-license evidence cannot become anchors',
  );

  const defaultExport = api.exportContextEvidence(normalized);
  assert.equal(defaultExport.schema_version, 'context-evidence-export.v1');
  assert.equal(defaultExport.include_user_owned_text, false);
  assert.equal('sentence' in defaultExport.items[0], false, 'user article text is private by default');
  assert.equal('sentence' in defaultExport.items[2], false, 'local exam text is private by default');
  assert.equal('sentence' in defaultExport.items[3], true, 'open-licensed text may be exported');
  assert.equal('sentence' in defaultExport.items[4], false, 'dictionary terms stay redacted');
  assert.equal('sentence' in defaultExport.items[5], true, 'AI-generated text may be exported');
  assert.equal(defaultExport.items[2].source_id, 'private-material-1');
  assert.equal(
    defaultExport.items[2].content_sha256,
    normalized[2].content_sha256,
    'redacted items retain source ID, hash, and locator',
  );
  assert.deepEqual(defaultExport.items[2].source_locator, normalized[2].source_locator);

  const exportBypassEvidence = api.normalizeContextEvidence({
    ...fixture.items[2],
    context_evidence_id: 'context-local-export-bypass',
    quality_reason: 'P2_SECRET_QUALITY_TEXT',
    source_locator: {
      ...fixture.items[2].source_locator,
      unknown_nested: {
        note: 'P2_SECRET_LOCATOR_TEXT',
      },
    },
    extensions: {
      copyright_excerpt: 'P2_SECRET_EXTENSION_TEXT',
    },
  });
  const exportBypassItem = api.exportContextEvidence([exportBypassEvidence]).items[0];
  assert.deepEqual(Object.keys(exportBypassItem).sort(), [
    'content_sha256',
    'context_evidence_id',
    'created_at',
    'learning_unit_id',
    'license_kind',
    'ownership',
    'quality_status',
    'revision',
    'schema_version',
    'source_id',
    'source_kind',
    'source_locator',
    'validated_at',
  ]);
  assert.deepEqual(exportBypassItem.source_locator, {
    locator_version: 'source-locator.v1',
    local_locator: 'page-2-item-3',
  });
  const serializedBypassExport = JSON.stringify(exportBypassItem);
  for (const secret of [
    'P2_SECRET_QUALITY_TEXT',
    'P2_SECRET_EXTENSION_TEXT',
    'P2_SECRET_LOCATOR_TEXT',
  ]) {
    assert.equal(
      serializedBypassExport.includes(secret),
      false,
      `default export must redact ${secret}`,
    );
  }

  const personalExport = api.exportContextEvidence(normalized, {
    includeUserOwnedText: true,
  });
  assert.equal(personalExport.items[0].sentence, normalized[0].sentence);
  assert.equal(personalExport.items[2].sentence, normalized[2].sentence);
  assert.equal(
    'sentence' in personalExport.items[4],
    false,
    'including personal content does not grant dictionary redistribution rights',
  );

  let transactionRow = null;
  const rowPortCalls = [];
  const rowPort = {
    transaction_id: 'transaction-context-1',
    async getRow(id) {
      rowPortCalls.push(['getRow', id]);
      return clone(transactionRow);
    },
    async putRow(row) {
      rowPortCalls.push(['putRow', row.id]);
      transactionRow = clone(row);
    },
    abort(error) {
      throw error;
    },
  };
  const boundRepository = api.bindContextEvidenceRepositoryToTransaction(rowPort);
  assert.equal('loadSnapshot' in boundRepository, false, 'transaction binding exposes only frozen methods');
  await boundRepository.put(normalized[2], null);
  assert.equal((await boundRepository.getById(normalized[2].context_evidence_id)).source_kind, 'user_local_exam_material');
  assert.deepEqual(
    rowPortCalls.slice(0, 2),
    [
      ['getRow', 'vocabulary.context-evidence.store.v1'],
      ['putRow', 'vocabulary.context-evidence.store.v1'],
    ],
  );

  const fakeIndexedDb = createFakeIndexedDb();
  const indexedRepository = api.createIndexedDbContextEvidenceRepository({
    indexedDBApi: fakeIndexedDb.api,
  });
  await indexedRepository.put(normalized[3], null);
  assert.equal(
    (await indexedRepository.getById(normalized[3].context_evidence_id)).source_kind,
    'open_corpus',
  );
  assert.deepEqual(fakeIndexedDb.calls.open, [{ name: 'SeekPlayerDB', version: 1 }]);
  assert.equal(fakeIndexedDb.calls.createObjectStore, 0);
  assert.ok(
    fakeIndexedDb.calls.transactions.some((entry) => entry.mode === 'readwrite'),
    'IndexedDB writes use the existing store in a readwrite transaction',
  );
  assert.throws(
    () => api.createIndexedDbContextEvidenceRepository({
      indexedDBApi: fakeIndexedDb.api,
      dbVersion: 2,
    }),
    (error) => error.code === 'INVALID_FIELD_TYPE',
  );

  const wrongKeyPathIndexedDb = createFakeIndexedDb({ keyPath: 'WRONG' });
  const wrongKeyPathRepository = api.createIndexedDbContextEvidenceRepository({
    indexedDBApi: wrongKeyPathIndexedDb.api,
  });
  await assert.rejects(
    wrongKeyPathRepository.loadSnapshot(),
    (error) => (
      error.code === 'TRANSACTION_ABORTED'
      && error.details?.operation === 'validate_schema'
      && !JSON.stringify(error).includes('WRONG')
    ),
    'a files store with the wrong keyPath must be rejected before any read',
  );
  assert.equal(wrongKeyPathIndexedDb.calls.gets, 0);
  assert.equal(wrongKeyPathIndexedDb.calls.puts, 0);
  assert.equal(wrongKeyPathIndexedDb.calls.close, 1);

  const sensitiveOpenRepository = api.createIndexedDbContextEvidenceRepository({
    indexedDBApi: {
      open() {
        throw new Error('P2_SENSITIVE_DOM_DIAGNOSTIC');
      },
    },
  });
  await assert.rejects(
    sensitiveOpenRepository.loadSnapshot(),
    (error) => {
      const exportedError = {
        code: error.code,
        message: error.message,
        details: error.details,
      };
      assert.deepEqual(exportedError, {
        code: 'TRANSACTION_ABORTED',
        message: 'ContextEvidence IndexedDB operation failed',
        details: {
          operation: 'open_database',
        },
      });
      assert.equal(
        JSON.stringify(exportedError).includes('P2_SENSITIVE_DOM_DIAGNOSTIC'),
        false,
      );
      return true;
    },
    'synchronous IndexedDB open errors must cross a stable redacted boundary',
  );

  const sensitiveTransactionIndexedDb = createFakeIndexedDb({
    transactionThrowsAt: 2,
  });
  const sensitiveTransactionRepository = api.createIndexedDbContextEvidenceRepository({
    indexedDBApi: sensitiveTransactionIndexedDb.api,
  });
  await assert.rejects(
    sensitiveTransactionRepository.loadSnapshot(),
    (error) => {
      const exportedError = {
        code: error.code,
        message: error.message,
        details: error.details,
      };
      assert.deepEqual(exportedError, {
        code: 'TRANSACTION_ABORTED',
        message: 'ContextEvidence IndexedDB operation failed',
        details: {
          operation: 'read_context_evidence',
        },
      });
      assert.equal(
        JSON.stringify(exportedError).includes('P2_SENSITIVE_TRANSACTION_DIAGNOSTIC'),
        false,
      );
      return true;
    },
    'synchronous transaction errors must cross a stable redacted boundary',
  );

  const asyncTransactionIndexedDb = createFakeIndexedDb({
    transactionErrorOnGetAt: 1,
  });
  const asyncTransactionRepository = api.createIndexedDbContextEvidenceRepository({
    indexedDBApi: asyncTransactionIndexedDb.api,
  });
  await assert.rejects(
    asyncTransactionRepository.loadSnapshot(),
    (error) => {
      const exportedError = {
        code: error.code,
        message: error.message,
        details: error.details,
      };
      assert.deepEqual(exportedError, {
        code: 'TRANSACTION_ABORTED',
        message: 'ContextEvidence IndexedDB operation failed',
        details: {
          operation: 'read_context_evidence',
        },
      });
      assert.equal(
        JSON.stringify(exportedError).includes('P2_SENSITIVE_ASYNC_TRANSACTION_DIAGNOSTIC'),
        false,
      );
      return true;
    },
    'readonly loads must not report success before transaction completion',
  );

  for (const failureCase of [
    {
      options: { objectStoreThrowsAt: 2 },
      operation: 'read_context_evidence',
      sensitiveText: 'P2_SENSITIVE_OBJECT_STORE_DIAGNOSTIC',
      invoke(repository) {
        return repository.loadSnapshot();
      },
    },
    {
      options: { getThrowsAt: 1 },
      operation: 'read_context_evidence',
      sensitiveText: 'P2_SENSITIVE_GET_DIAGNOSTIC',
      invoke(repository) {
        return repository.getById('context-open-corpus-1');
      },
    },
    {
      options: { getRequestErrorsAt: 1 },
      operation: 'read_context_evidence',
      sensitiveText: 'P2_SENSITIVE_GET_REQUEST_DIAGNOSTIC',
      invoke(repository) {
        return repository.loadSnapshot();
      },
    },
    {
      options: { putThrowsAt: 1 },
      operation: 'write_context_evidence',
      sensitiveText: 'P2_SENSITIVE_PUT_DIAGNOSTIC',
      invoke(repository) {
        return repository.put(normalized[3], null);
      },
    },
    {
      options: { putRequestErrorsAt: 1 },
      operation: 'write_context_evidence',
      sensitiveText: 'P2_SENSITIVE_PUT_REQUEST_DIAGNOSTIC',
      invoke(repository) {
        return repository.put(normalized[3], null);
      },
    },
  ]) {
    const failingIndexedDb = createFakeIndexedDb(failureCase.options);
    const failingRepository = api.createIndexedDbContextEvidenceRepository({
      indexedDBApi: failingIndexedDb.api,
    });
    await assertStableIndexedDbFailure(
      failureCase.invoke(failingRepository),
      failureCase.operation,
      failureCase.sensitiveText,
    );
  }

  const moduleSource = fs.readFileSync(
    path.join(
      repoRoot,
      'src',
      'services',
      'vocabulary',
      'vocabulary-context-evidence.js',
    ),
    'utf8',
  );
  const fixtureSource = fs.readFileSync(fixturePath, 'utf8');
  for (const forbiddenRuntime of ['fetch(', 'XMLHttpRequest', 'WebSocket', 'EventSource']) {
    assert.equal(
      moduleSource.includes(forbiddenRuntime),
      false,
      `ContextEvidence must not include network runtime: ${forbiddenRuntime}`,
    );
  }
  assert.equal(
    moduleSource.includes('createObjectStore'),
    false,
    'ContextEvidence must never create an IndexedDB object store',
  );
  assert.match(
    moduleSource,
    /indexedDBApi\.open\('SeekPlayerDB', 1\)/u,
    'ContextEvidence must open only the fixed database name and version',
  );
  assert.equal(/ielts/iu.test(moduleSource), false, 'module must not embed IELTS material');
  assert.equal(/ielts/iu.test(fixtureSource), false, 'fixtures must not embed IELTS material');

  console.log('vocabulary context evidence check passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
