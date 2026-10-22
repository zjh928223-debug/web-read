import { createHash } from 'node:crypto'
import { Buffer } from 'node:buffer'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const KEY_V1 = 'vocabulary.passage-preview.translation-display-mode.v1'
const KEY_V2 = 'vocabulary.passage-preview.translation-display-mode.v2'
const V1_SCHEMA = 'passage-preview.display-mode.v1'
const V2_SCHEMA = 'passage-preview.display-mode.v2'
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const startedAt = new Date().toISOString()
const probeSha256 = createHash('sha256').update(await readFile(new URL(import.meta.url))).digest('hex')

class ProbeFailure extends Error {
  constructor(message, details = {}) { super(message); this.name = 'ProbeFailure'; this.details = details }
}

function check(condition, message, details = {}) {
  if (!condition) throw new ProbeFailure(message, details)
}

class MapStorage {
  constructor(entries = {}) { this.values = new Map(Object.entries(entries)); this.setCount = 0; this.removeCount = 0 }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null }
  setItem(key, value) { this.setCount += 1; this.values.set(key, String(value)) }
  removeItem(key) { this.removeCount += 1; this.values.delete(key) }
  key(index) { return [...this.values.keys()][index] ?? null }
  get length() { return this.values.size }
}

class ReadOnlyStorage extends MapStorage {
  setItem() { this.setCount += 1; throw new Error('bridge source must not set localStorage') }
  removeItem() { this.removeCount += 1; throw new Error('bridge source must not remove localStorage') }
}

const rows = [
  { id: 'audioMeta', schemaVersion: 1, revision: 'session:1', contentId: 'reader-1', content: { contentId: 'reader-1' } },
  { id: 'transcript', schemaVersion: 1, revision: 'session:1', contentId: 'reader-1', content: { segments: [] } },
  { id: 'chunkData', schemaVersion: 1, revision: 'session:1', contentId: 'reader-1', content: { chunks: [] } },
  { id: 'marks', schemaVersion: 1, revision: 'session:1', contentId: 'reader-1', content: [] },
  { id: 'readerSession', schemaVersion: 3, revision: 'session:1', contentId: 'reader-1', content: { schemaVersion: 3, contentId: 'reader-1' } },
  { id: 'vocabulary.srs.store.v1', schemaVersion: 1, revision: 2, contentId: 'word-1', content: { schemaVersion: 1, entries: [] } },
]

function simpleAdapter(key) {
  return { key, schemaVersion: 1, adapterVersion: 1, async collect() {
    return { schemaVersion: 1, revision: 1, records: [{ id: `${key}:record`, schemaVersion: 1, revision: 1, contentId: `${key}:content`, payload: { state: key }, references: [], mediaReferences: [] }] }
  } }
}

function backupOptions(storage) {
  return { applicationPersistence: { async getAllRows() { return rows } }, storage, marksActivityAdapter: simpleAdapter('marks-activity'), workflowAdapter: simpleAdapter('workflow'), release: { applicationVersion: 'v2-probe', gitSha: 'isolated-fixture' } }
}

async function loadBackupRuntime() {
  const backupSource = await readFile(new URL('../src/services/persistence/application-backup.js', import.meta.url), 'utf8')
  const runtimeSource = await readFile(new URL('../src/services/persistence/read-web-application-backup.js', import.meta.url), 'utf8')
  return import(toDataUrl(runtimeSource.replace("from './application-backup.js'", `from '${toDataUrl(backupSource)}'`)))
}

async function loadBridgeRuntime() {
  const source = await readFile(path.join(repositoryRoot, 'src/services/windows-owner-legacy-compatibility-bridge.js'), 'utf8')
  const json = async (name) => JSON.stringify(JSON.parse(await readFile(path.join(repositoryRoot, 'docs/architecture/windows-local-owner-thin-reader', name), 'utf8')))
  return import(toDataUrl(source
    .replace("import apiContract from '../../docs/architecture/windows-local-owner-thin-reader/api-contract.json'", `const apiContract = ${await json('api-contract.json')}`)
    .replace("import domainInventory from '../../docs/architecture/windows-local-owner-thin-reader/domain-inventory.json'", `const domainInventory = ${await json('domain-inventory.json')}`)
    .replace("import ownerRegistry from '../../docs/architecture/windows-local-owner-thin-reader/owner-registry.json'", `const ownerRegistry = ${await json('owner-registry.json')}`)))
}

const backupRuntime = await loadBackupRuntime()
const bridgeRuntime = await loadBridgeRuntime()
const { createReadWebApplicationBackupAdapters, createReadWebApplicationBackupService } = backupRuntime
const { createWindowsOwnerLegacyCompatibilityBridge } = bridgeRuntime

async function runBackup(entries) {
  const storage = new MapStorage(Object.fromEntries(entries))
  try {
    const options = backupOptions(storage)
    const adapters = createReadWebApplicationBackupAdapters(options)
    const preview = await adapters['passage-preview'].collect()
    const service = createReadWebApplicationBackupService(options)
    const artifact = await service.createBackup()
    const verification = await service.verifyBackup(JSON.stringify(artifact))
    return { status: 'ready', storage, adapters, preview, artifact, verification }
  } catch (error) {
    return { status: 'error', storage, error: { code: error?.code || null, message: error?.message || String(error) } }
  }
}

async function runBridge(entries) {
  const storage = new ReadOnlyStorage(Object.fromEntries(entries))
  const bridge = createWindowsOwnerLegacyCompatibilityBridge({ profileId: 'optimization', storage })
  const inventory = await bridge.inventory()
  const plan = await bridge.prepareImport()
  return { storage, bridge, inventory, plan }
}

function storageEvidence(storage) { return { setCount: storage.setCount, removeCount: storage.removeCount } }
function recordFor(result, key) { return result.inventory.records.find((record) => record.recordKey === key) }
function recordsById(domain) { return new Map((domain?.records || []).map((record) => [record.id, record])) }

function backupEvidence(result) {
  return result.status === 'ready'
    ? { status: result.status, sourceWrites: storageEvidence(result.storage), domainRegistryCount: result.artifact.manifest.domainRegistry.length, records: result.artifact.domains['passage-preview'].records.map((record) => ({ id: record.id, schemaVersion: record.schemaVersion, value: record.payload?.value, checksum: record.checksum })) }
    : { status: result.status, error: result.error, sourceWrites: storageEvidence(result.storage) }
}

function bridgeEvidence(result, keys = [KEY_V1, KEY_V2]) {
  return { inventoryStatus: result.inventory.status, inventoryReason: result.inventory.reasonCode, planStatus: result.plan.status, records: keys.map((key) => recordFor(result, key)).filter(Boolean), sourceWrites: storageEvidence(result.storage) }
}

function requireBackupReady(result, label) {
  check(result.status === 'ready', `${label}: backup did not become ready`, backupEvidence(result))
}

async function checkBackupScenario(entries, expected, restore = false) {
  const result = await runBackup(entries)
  requireBackupReady(result, 'backup scenario')
  const domain = result.artifact.domains['passage-preview']
  const records = recordsById(domain)
  check(result.artifact.manifest.domainRegistry.length === 6, 'backup did not use six domains', backupEvidence(result))
  check(result.verification.valid === true, 'backup verification failed', backupEvidence(result))
  check(JSON.stringify([...records.keys()].sort()) === JSON.stringify(Object.keys(expected).sort()), 'backup record set differs', backupEvidence(result))
  for (const [key, value] of Object.entries(expected)) {
    const record = records.get(key)
    check(record?.schemaVersion === value.schema, `${key}: schema mismatch`, backupEvidence(result))
    check(record?.payload?.value === value.value, `${key}: raw value mismatch`, backupEvidence(result))
    check(/^sha256:[a-f0-9]{64}$/u.test(record?.checksum || ''), `${key}: checksum missing`, backupEvidence(result))
  }
  check(result.storage.setCount === 0 && result.storage.removeCount === 0, 'backup source storage was mutated', backupEvidence(result))
  const evidence = backupEvidence(result)
  if (restore) {
    const target = new MapStorage()
    const targetAdapters = createReadWebApplicationBackupAdapters(backupOptions(target))
    await targetAdapters['passage-preview'].restoreRecords(domain, { expectedRevision: domain.revision })
    const restored = recordsById(await targetAdapters['passage-preview'].collect())
    for (const [key, value] of Object.entries(expected)) {
      check(restored.get(key)?.schemaVersion === value.schema, `${key}: restored schema mismatch`)
      check(restored.get(key)?.payload?.value === value.value, `${key}: restored raw value mismatch`)
      check(target.getItem(key) === value.value, `${key}: target raw value mismatch`)
    }
    check(target.setCount === Object.keys(expected).length && target.removeCount === 0, 'restore target write boundary mismatch', { targetWrites: storageEvidence(target) })
    evidence.restore = { perKey: Object.keys(expected), targetWrites: storageEvidence(target) }
  }
  return evidence
}

async function checkBridgeCoexist() {
  const result = await runBridge([[KEY_V1, 'sentence'], [KEY_V2, 'persistent']])
  const evidence = bridgeEvidence(result)
  check(result.inventory.status === 'ready', 'bridge inventory did not become ready', evidence)
  check(result.plan.status === 'ready', 'bridge prepareImport did not become ready', evidence)
  for (const [key, schema, value] of [[KEY_V1, V1_SCHEMA, 'sentence'], [KEY_V2, V2_SCHEMA, 'persistent']]) {
    const record = recordFor(result, key)
    check(record?.status === 'ready' && record.sourceKind === 'localStorage' && record.sourceId === 'localStorage', `${key}: default source/claim mismatch`, evidence)
    check(record.domain === 'passage-preview' && record.classification === 'non-canonical' && record.schemaVersion === schema, `${key}: bridge metadata mismatch`, evidence)
    const rollback = await result.bridge.readRollbackWindow({ sourceId: 'localStorage', domain: 'passage-preview', recordKey: key })
    check(rollback.payload === value, `${key}: rollback raw value mismatch`, { ...evidence, rollback: { key, value: rollback.payload } })
  }
  const inventoryText = JSON.stringify(result.inventory)
  check(!inventoryText.includes('sentence') && !inventoryText.includes('persistent'), 'bridge inventory leaked raw values', evidence)
  for (const key of [KEY_V1, KEY_V2]) {
    check(result.plan.excludedRecords.some((record) => record.recordKey === key && record.classification === 'non-canonical'), `${key}: missing excluded record`, evidence)
    check(!result.plan.importInput.records.some((record) => record.recordKey === key), `${key}: entered importInput`, evidence)
  }
  check(result.storage.setCount === 0 && result.storage.removeCount === 0, 'bridge source storage was mutated', evidence)
  return { ...evidence, rollbackValues: { [KEY_V1]: 'sentence', [KEY_V2]: 'persistent' } }
}

async function checkBackupUnknown(key, mixed) {
  const result = await runBackup(mixed ? [[KEY_V2, 'persistent'], [key, 'unknown']] : [[key, 'unknown']])
  check(result.status === 'error' && result.error.code === 'BACKUP_UNCLAIMED_LOCAL_STORAGE_KEY', 'unknown backup key was not rejected', backupEvidence(result))
  check(result.storage.setCount === 0 && result.storage.removeCount === 0, 'unknown backup source storage was mutated', backupEvidence(result))
  return backupEvidence(result)
}

async function checkBridgeUnknown(key, mixed) {
  const result = await runBridge(mixed ? [[KEY_V2, 'persistent'], [key, 'unknown']] : [[key, 'unknown']])
  const record = recordFor(result, key)
  const evidence = bridgeEvidence(result, [key])
  check(result.inventory.status === 'blocked' && result.plan.status === 'blocked', 'unknown bridge key was not rejected', evidence)
  check(['legacy-unclaimed-record', 'legacy-source-kind-mismatch'].includes(record?.reasonCode), 'unknown bridge reason was not fail-closed', evidence)
  check(result.plan.blockedRecords.some((entry) => entry.recordKey === key), 'prepareImport omitted blocked unknown key', evidence)
  check(result.storage.setCount === 0 && result.storage.removeCount === 0, 'unknown bridge source storage was mutated', evidence)
  return evidence
}

const matrix = []
async function execute(id, axis, fn) {
  try { matrix.push({ id, axis, status: 'passed', evidence: await fn() }) }
  catch (error) { matrix.push({ id, axis, status: 'failed', error: { name: error.name, message: error.message, details: error.details || null } }) }
}

await execute('V2-01/v2-hold-alone', 'backup', () => checkBackupScenario([[KEY_V2, 'hold']], { [KEY_V2]: { schema: V2_SCHEMA, value: 'hold' } }))
await execute('V2-01/v2-persistent-alone', 'backup', () => checkBackupScenario([[KEY_V2, 'persistent']], { [KEY_V2]: { schema: V2_SCHEMA, value: 'persistent' } }))
await execute('V2-02/empty-no-v2', 'backup', () => checkBackupScenario([], {}))
await execute('V2-02/v1-sentence-no-v2', 'backup', () => checkBackupScenario([[KEY_V1, 'sentence']], { [KEY_V1]: { schema: V1_SCHEMA, value: 'sentence' } }))
await execute('V2-03/coexist-hold-restore-each-key', 'backup', () => checkBackupScenario([[KEY_V1, 'sentence'], [KEY_V2, 'hold']], { [KEY_V1]: { schema: V1_SCHEMA, value: 'sentence' }, [KEY_V2]: { schema: V2_SCHEMA, value: 'hold' } }, true))
await execute('V2-03/coexist-persistent-restore-each-key', 'backup', () => checkBackupScenario([[KEY_V1, 'sentence'], [KEY_V2, 'persistent']], { [KEY_V1]: { schema: V1_SCHEMA, value: 'sentence' }, [KEY_V2]: { schema: V2_SCHEMA, value: 'persistent' } }, true))
await execute('V2-04/non-enumerated-raw-string', 'backup', () => checkBackupScenario([[KEY_V2, ' original value ']], { [KEY_V2]: { schema: V2_SCHEMA, value: ' original value ' } }))
await execute('V2-05/V2-06/bridge-v1-v2-claim-rollback-exclusion', 'bridge', checkBridgeCoexist)
for (const key of ['vocabulary.passage-preview.future.v9', 'vocabulary.passage-preview.translation-display-mode.v3']) {
  await execute(`V2-07/backup-${key}-alone`, 'backup', () => checkBackupUnknown(key, false))
  await execute(`V2-07/backup-${key}-mixed`, 'backup', () => checkBackupUnknown(key, true))
  await execute(`V2-07/bridge-${key}-alone`, 'bridge', () => checkBridgeUnknown(key, false))
  await execute(`V2-07/bridge-${key}-mixed`, 'bridge', () => checkBridgeUnknown(key, true))
}
await execute('V2-08/source-set-remove-zero', 'backup', () => checkBackupScenario([[KEY_V2, 'persistent']], { [KEY_V2]: { schema: V2_SCHEMA, value: 'persistent' } }))

const finishedAt = new Date().toISOString()
const failures = matrix.filter((entry) => entry.status !== 'passed')
console.log(JSON.stringify({ probe: 'passage-preview-v2-backup-compatibility', sourceRoot: repositoryRoot, probeSha256, nodeVersion: process.version, cwd: process.cwd(), startedAt, finishedAt, status: failures.length ? 'failed' : 'passed', counts: { executed: matrix.length, passed: matrix.length - failures.length, failed: failures.length }, matrix }, null, 2))
process.exitCode = failures.length ? 1 : 0

function toDataUrl(source) {
  return `data:text/javascript;base64,${Buffer.from(source, 'utf8').toString('base64')}`
}
