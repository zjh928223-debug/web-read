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
  console.log('youtube workflow operation receipt check passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
