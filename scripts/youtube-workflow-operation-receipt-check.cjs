const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const source = fs.readFileSync(path.join(repoRoot, 'src', 'services', 'workflow', 'operation-receipt.js'), 'utf8');
  const encoded = Buffer.from(source, 'utf8').toString('base64');
  const api = await import(`data:text/javascript;base64,${encoded}#${Date.now()}`);
  const values = new Map();
  const storage = {
    get length() { return values.size; },
    key(index) { return [...values.keys()][index] || null; },
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
  };
  const payload = {
    url: 'https://example.com/private-video',
    apiKey: 'SECRET-RECEIPT-KEY',
    outputDir: 'D:/private/output',
    videoPriority: true,
  };
  const first = api.writeWorkflowOperationReceipt({
    actionType: 'create',
    payload,
    operationKey: 'create-operation-stable',
    storage,
    now: 1000,
  });
  const stored = [...values.values()][0];
  assert.equal(stored.includes(payload.url), false, 'receipt must not persist URL text');
  assert.equal(stored.includes(payload.apiKey), false, 'receipt must not persist API key');
  assert.equal(stored.includes(payload.outputDir), false, 'receipt must not persist path text');
  assert.deepEqual(
    api.readWorkflowOperationReceipt({ actionType: 'create', payload, storage, now: 1001 }),
    first,
  );
  assert.deepEqual(
    api.readWorkflowOperationReceipt({
      actionType: 'create',
      payload: { url: payload.url, videoPriority: true },
      storage,
      now: 1001,
    }),
    first,
    'reload retry without in-memory secrets or paths must reuse the same safe fingerprint',
  );
  assert.equal(
    api.readWorkflowOperationReceipt({ actionType: 'create', payload: { ...payload, url: 'https://example.com/other' }, storage, now: 1001 }),
    null,
    'different safe fingerprint must not reuse the operation key',
  );

  const corruptKey = 'read-web.workflow-operation-receipt.v1.corrupt';
  const corruptRaw = '{not-json-SECRET-QUARANTINE';
  const unknownKey = 'read-web.workflow-operation-receipt.v1.unknown';
  const unknownRaw = JSON.stringify({ schemaVersion: 99, operationKey: 'leak' });
  values.set(corruptKey, corruptRaw);
  values.set(unknownKey, unknownRaw);
  api.cleanupWorkflowOperationReceipts({ storage, now: 1001 });
  assert.equal(values.has(corruptKey), false);
  assert.equal(values.has(unknownKey), false);
  const quarantines = [...values.entries()]
    .filter(([key]) => key.startsWith(api.WORKFLOW_OPERATION_RECEIPT_QUARANTINE_PREFIX))
    .map(([, value]) => JSON.parse(value));
  assert.equal(quarantines.length, 2, 'malformed and unknown receipts must be isolated independently');
  assert.deepEqual(
    new Set(quarantines.map((entry) => entry.sourceKey)),
    new Set([corruptKey, unknownKey]),
  );
  assert.ok(quarantines.some((entry) => entry.raw === corruptRaw && entry.reason === 'malformed-json'));
  assert.ok(quarantines.some((entry) => entry.raw === unknownRaw && entry.reason === 'unsupported-schema'));
  assert.ok(quarantines.every((entry) => entry.detectedAt === new Date(1001).toISOString()));

  const quotaValues = new Map([['read-web.workflow-operation-receipt.v1.quota', '{broken']]);
  const quotaStorage = {
    get length() { return quotaValues.size; },
    key(index) { return [...quotaValues.keys()][index] || null; },
    getItem(key) { return quotaValues.has(key) ? quotaValues.get(key) : null; },
    setItem(key, value) {
      if (key.startsWith(api.WORKFLOW_OPERATION_RECEIPT_QUARANTINE_PREFIX)) throw new Error('quota');
      quotaValues.set(key, String(value));
    },
    removeItem(key) { quotaValues.delete(key); },
  };
  assert.throws(
    () => api.cleanupWorkflowOperationReceipts({ storage: quotaStorage, now: 1001 }),
    (error) => error instanceof api.WorkflowOperationReceiptError,
    'quarantine quota failure must fail closed',
  );
  assert.equal(quotaValues.get('read-web.workflow-operation-receipt.v1.quota'), '{broken', 'failed quarantine must retain the source receipt');

  api.writeWorkflowOperationReceipt({
    actionType: 'retry',
    targetJobId: 'job-1',
    payload: { stage: 'translating' },
    operationKey: 'retry-operation-expired',
    storage,
    now: 1000,
  });
  api.cleanupWorkflowOperationReceipts({ storage, now: 1000 + api.WORKFLOW_OPERATION_RECEIPT_TTL_MS + 1 });
  assert.equal(
    api.readWorkflowOperationReceipt({ actionType: 'retry', targetJobId: 'job-1', payload: { stage: 'translating' }, storage, now: 1000 + api.WORKFLOW_OPERATION_RECEIPT_TTL_MS + 1 }),
    null,
    'expired receipts must be removed before reuse',
  );
  // Import the real coordinator; only transport and browser storage are controlled.
  const { registerHooks } = require('node:module');
  const { pathToFileURL } = require('node:url');
  const esmRootUrl = pathToFileURL(path.join(repoRoot, 'src') + path.sep).href;
  registerHooks({ load(url, context, nextLoad) {
    return nextLoad(url, url.startsWith(esmRootUrl) && url.endsWith('.js') ? { ...context, format: 'module' } : context);
  } });
  const { createWorkflowMutationCoordinator } = await import(pathToFileURL(path.join(repoRoot, 'src/composables/create-workflow-mutation-coordinator.js')).href);
  const savedStorage = globalThis.localStorage;
  globalThis.localStorage = storage;
  const coordinators = [];
  try {
    let unavailable = false;
    let authorityRevision = 4;
    const deletions = [];
    function createCoordinator() {
      const owner = createWorkflowMutationCoordinator({
        client: {
          async deleteJob(jobId, options) { deletions.push([jobId, options.expectedRevision]); return { revision: 7 }; },
          async clearFailedJobs(options) { deletions.push(['failed-only', options.expectedRevision]); return { revision: 8 }; },
        },
        async requestWorkflowSnapshot() {
          if (unavailable) throw new Error('offline');
          const snapshot = { revision: authorityRevision, jobs: [] };
          owner.rememberWorkflowRevision(snapshot);
          return snapshot;
        },
        async refreshQueue() { throw new Error('offline refresh'); },
      });
      coordinators.push(owner);
      return owner;
    }
    const owner = createCoordinator();
    let selectedJob = 'job-old';
    let sendCount = 0;
    let resolveSend;
    let originalKey;
    const send = action => {
      sendCount += 1;
      originalKey = action.key;
      assert.equal(action.targetJobId, 'job-old', 'pending action keeps its captured target after selection changes');
      assert.deepEqual(owner.workflowMutationOptions(action), { idempotencyKey: originalKey, expectedRevision: 4 });
      assert.equal(Object.hasOwn(action, 'inFlight'), false, 'transport cannot access private flight ownership');
      return new Promise(resolve => { resolveSend = resolve; });
    };
    const firstFlight = owner.runPendingWorkflowAction('retry-old', 'retry', selectedJob, { stage: 'translating' }, send);
    assert.equal(owner.runPendingWorkflowAction('retry-old', 'retry', selectedJob, { stage: 'translating' }, send), firstFlight);
    selectedJob = 'job-new';
    for (let i = 0; i < 8; i += 1) await Promise.resolve();
    assert.equal(sendCount, 1);
    resolveSend({ revision: 5 });
    await firstFlight;
    await assert.rejects(owner.runPendingWorkflowAction('retry-old', 'retry', 'job-old', { stage: 'translating' }, action => {
      assert.equal(action.key, originalKey, 'failed sends retain the original operation identity');
      throw new Error('transport interrupted');
    }), /transport interrupted/);
    const reloaded = createCoordinator();
    await reloaded.runPendingWorkflowAction('retry-old', 'retry', 'job-old', { stage: 'translating' }, action => {
      assert.equal(action.key, originalKey, 'coordinator reload reuses the durable safe receipt');
    });
    reloaded.forgetPendingWorkflowAction('retry-old');
    assert.equal(api.readWorkflowOperationReceipt({ actionType: 'retry', targetJobId: 'job-old', payload: { stage: 'translating' }, storage }), null);
    const conflict = { status: 409, code: 'WORKFLOW_STATE_CONFLICT', actualRevision: 6 };
    assert.equal(owner.isWorkflowMutationConflict(conflict), true);
    await owner.handleWorkflowMutationConflict(conflict);
    assert.match(owner.workflowMutationNotice.value, /请再试一次/);
    unavailable = true;
    await assert.rejects(owner.runPendingWorkflowAction('cancel-new', 'cancel', 'job-new', {}, () => { throw new Error('must not send'); }), { code: 'WORKFLOW_REVISION_UNAVAILABLE' });
    unavailable = false;
    authorityRevision = 6;
    await owner.deleteJob('job-old');
    await owner.clearFailedJobs();
    assert.deepEqual(deletions, [['job-old', 6], ['failed-only', 7]], 'record removal follows successive authoritative revisions');
    assert.equal(Object.hasOwn(owner, 'pendingWorkflowActions'), false);
    for (const succeeds of [true, false]) {
      const closing = createCoordinator();
      let settleSend, closingKey;
      const closingFlight = closing.runPendingWorkflowAction('closing', 'cancel', 'job-closing', {}, action => {
        closingKey = action.key;
        return new Promise((resolve, reject) => { settleSend = succeeds ? resolve : reject; });
      });
      for (let i = 0; i < 8; i += 1) await Promise.resolve();
      closing.dispose();
      if (succeeds) {
        settleSend({ revision: 7 });
        await closingFlight;
        closing.forgetPendingWorkflowAction('closing');
        assert.equal(api.readWorkflowOperationReceipt({ actionType: 'cancel', targetJobId: 'job-closing', storage }), null, 'success after unmount still clears its confirmed receipt');
      } else {
        const rejection = assert.rejects(closingFlight, /closing offline/);
        settleSend(new Error('closing offline'));
        await rejection;
        const afterClose = createCoordinator();
        await afterClose.runPendingWorkflowAction('closing', 'cancel', 'job-closing', {}, action => {
          assert.equal(action.key, closingKey, 'failure after unmount keeps durable retry identity');
        });
      }
    }
  } finally {
    coordinators.forEach(owner => owner.dispose());
    globalThis.localStorage = savedStorage;
  }
  console.log('youtube workflow operation receipt and mutation coordinator checks passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
