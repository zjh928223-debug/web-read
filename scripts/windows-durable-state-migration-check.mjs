import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const appBackupSource = await readFile(path.join(repositoryRoot, 'src/services/persistence/application-backup.js'), 'utf8')
const migrationSource = await readFile(path.join(repositoryRoot, 'src/services/persistence/windows-durable-state-migration.js'), 'utf8')
const bridgeSource = await readFile(path.join(repositoryRoot, 'src/services/windows-owner-legacy-compatibility-bridge.js'), 'utf8')
const apiContract = JSON.parse(await readFile(path.join(repositoryRoot, 'docs/architecture/windows-local-owner-thin-reader/api-contract.json'), 'utf8'))
const domainInventory = JSON.parse(await readFile(path.join(repositoryRoot, 'docs/architecture/windows-local-owner-thin-reader/domain-inventory.json'), 'utf8'))
const ownerRegistry = JSON.parse(await readFile(path.join(repositoryRoot, 'docs/architecture/windows-local-owner-thin-reader/owner-registry.json'), 'utf8'))

function dataUrl(source) {
  return `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
}

const migration = await import(dataUrl(migrationSource.replace("from './application-backup.js'", `from '${dataUrl(appBackupSource)}'`)))
const bridge = await import(dataUrl(
  bridgeSource
    .replace(
      "import apiContract from '../../docs/architecture/windows-local-owner-thin-reader/api-contract.json'",
      `const apiContract = ${JSON.stringify(apiContract)}`,
    )
    .replace(
      "import domainInventory from '../../docs/architecture/windows-local-owner-thin-reader/domain-inventory.json'",
      `const domainInventory = ${JSON.stringify(domainInventory)}`,
    )
    .replace(
      "import ownerRegistry from '../../docs/architecture/windows-local-owner-thin-reader/owner-registry.json'",
      `const ownerRegistry = ${JSON.stringify(ownerRegistry)}`,
    ),
))

const {
  WINDOWS_DURABLE_STATE_MIGRATION_DOMAINS,
  createMemoryMigrationStateStore,
  createWindowsDurableStateMigration,
} = migration
const { createWindowsOwnerLegacyCompatibilityBridge } = bridge

class MapStorage {
  constructor(entries = {}) {
    this.entries = new Map(Object.entries(entries))
    this.writeCount = 0
  }

  get length() { return this.entries.size }

  key(index) { return [...this.entries.keys()][index] ?? null }

  getItem(key) { return this.entries.has(key) ? this.entries.get(key) : null }

  setItem(key, value) {
    this.writeCount += 1
    this.entries.set(key, String(value))
  }

  removeItem(key) { this.entries.delete(key) }
}

function clone(value) {
  return typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value))
}

function emptySnapshot() {
  return { schemaVersion: 1, adapterVersion: 1, revision: 0, records: [], references: [], mediaReferences: [] }
}

class HostAdapter {
  constructor(initial = emptySnapshot(), { failImport = false } = {}) {
    this.snapshot = clone(initial)
    this.failImport = failImport
    this.freezeCalls = 0
    this.unfreezeCalls = 0
    this.importCalls = 0
    this.collectCalls = 0
  }

  async collect() {
    this.collectCalls += 1
    return clone(this.snapshot)
  }

  async freeze() {
    this.freezeCalls += 1
    return { ok: true }
  }

  async unfreeze() {
    this.unfreezeCalls += 1
    return { ok: true }
  }

  async importRecords({ snapshot, expectedRevision }) {
    this.importCalls += 1
    if (this.snapshot.revision !== expectedRevision) return { status: 'conflict', currentRevision: this.snapshot.revision }
    if (this.failImport) {
      const error = new Error('isolated replace fault')
      error.code = 'migration-import-failed'
      throw error
    }
    this.snapshot = clone(snapshot)
    return {
      status: 'committed',
      commitStatus: 'committed',
      revision: this.snapshot.revision,
      receiptId: `receipt-${this.snapshot.revision}`,
    }
  }
}

function createHostAdapters(overrides = {}) {
  return Object.fromEntries(WINDOWS_DURABLE_STATE_MIGRATION_DOMAINS.map((domain) => [
    domain,
    overrides[domain] || new HostAdapter(),
  ]))
}

function createLegacyFixture({ includeUnknown = false, includeBadSchema = false } = {}) {
  let persistenceReads = 0
  const storage = new MapStorage({
    'vocabulary.passage-preview.data.v2': JSON.stringify([{ id: 'preview-1', text: 'hello' }]),
  })
  const rows = [
    {
      id: 'audioMeta',
      revision: 2,
      content: {
        schemaVersion: 1,
        contentId: 'content-1',
        mediaIdentity: {
          mediaId: 'audio-1',
          kind: 'audio',
          size: 12,
          contentType: 'audio/mp4',
          etag: '"audio-1-v1"',
          revision: 1,
          authorizedReference: '/api/jobs/job-1/media/audio',
        },
      },
    },
    { id: 'transcript', revision: 2, content: { segments: [] } },
    { id: 'chunkData', revision: 2, content: { chunks: [] } },
    { id: 'marks', revision: 2, content: [] },
    { id: 'readerSession', schemaVersion: 3, revision: 'session:2', content: { schemaVersion: 3, contentId: 'content-1' } },
    { id: 'vocabulary.srs.store.v1', schemaVersion: 1, revision: 2, content: { schemaVersion: 1, entries: [] } },
  ]
  if (includeUnknown) rows.push({ id: 'unclaimed-row', content: { value: 'must block' } })
  if (includeBadSchema) {
    rows.find((row) => row.id === 'vocabulary.srs.store.v1').schemaVersion = 99
    rows.find((row) => row.id === 'vocabulary.srs.store.v1').content.schemaVersion = 99
  }
  const bridgeInstance = createWindowsOwnerLegacyCompatibilityBridge({
    profileId: 'optimization',
    applicationPersistence: {
      async getAllRows() {
        persistenceReads += 1
        return clone(rows)
      },
    },
    storage,
    sources: [{
      kind: 'json',
      sourceId: 'workflow-fixture',
      read: async () => ({ records: [
        {
          key: '_workflow/reader-marks.json',
          schemaVersion: 'reader-marks.v1',
          revision: 4,
          payload: { schemaVersion: 'reader-marks.v1', marks: [] },
        },
        {
          key: 'jobs.json',
          schemaVersion: 1,
          revision: 4,
          payload: { schemaVersion: 1, jobs: [{ id: 'job-1', status: 'queued' }] },
        },
      ] }),
    }],
  })
  return { bridge: bridgeInstance, storage, getPersistenceReads: () => persistenceReads }
}

function createMigrationFixture({ stateStore, hostAdapters, includeUnknown = false, includeBadSchema = false, capacityBytes, writerControls } = {}) {
  const legacy = createLegacyFixture({ includeUnknown, includeBadSchema })
  const service = createWindowsDurableStateMigration({
    profileId: 'optimization',
    legacyBridge: legacy.bridge,
    hostAdapters: hostAdapters || createHostAdapters(),
    stateStore: stateStore || createMemoryMigrationStateStore(),
    ...(writerControls ? { writerControls } : {}),
    capacityBytes: capacityBytes ?? 1_000_000,
    now: () => 1_760_000_000_000,
    release: { applicationVersion: 'migration-check', releaseId: 'migration-check' },
  })
  return { ...legacy, service, hostAdapters: hostAdapters || null }
}

const fixture = createMigrationFixture()
const inventory = await fixture.service.inventory()
assert.equal(inventory.status, 'ready')
assert.deepEqual(inventory.domains.map((item) => item.domain), [...WINDOWS_DURABLE_STATE_MIGRATION_DOMAINS])
assert.equal(inventory.domains.find((item) => item.domain === 'annotation').recordCount, 0, 'empty domains remain in inventory')
assert.equal(inventory.frozenIndexedDbSchema.databaseName, 'SeekPlayerDB')
assert.equal(inventory.frozenIndexedDbSchema.version, 1)
assert.equal(inventory.frozenIndexedDbSchema.objectStore, 'files')
assert.equal(fixture.storage.writeCount, 0, 'legacy inventory must not write browser storage')

const beforeDryRunFinal = await fixture.service.createFinalBackup('reader-session')
assert.equal(beforeDryRunFinal.ok, false)
assert.equal(beforeDryRunFinal.reasonCode, 'migration-freeze-required')
const beforeFinalImport = await fixture.service.importDomain('reader-session')
assert.equal(beforeFinalImport.ok, false)
assert.equal(beforeFinalImport.reasonCode, 'migration-final-backup-required')
const dryRun = await fixture.service.dryRun('reader-session')
assert.equal(dryRun.ok, true)
assert.equal(dryRun.write, false)
assert.equal(dryRun.sourceRevision, 2)
assert.equal(fixture.hostAdapters, null)

const capacityBlocked = createMigrationFixture({ capacityBytes: 1 })
const capacityResult = await capacityBlocked.service.dryRun('reader-session')
assert.equal(capacityResult.ok, false)
assert.equal(capacityResult.reasonCode, 'migration-capacity-insufficient')

const frozen = await fixture.service.freeze('reader-session')
assert.equal(frozen.status, 'frozen')
assert.equal(frozen.ok, true)
const finalResult = await fixture.service.createFinalBackup('reader-session')
assert.equal(finalResult.ok, true)
assert.equal(finalResult.status, 'final-backup')
const finalBackup = finalResult.finalBackup
assert.equal(finalBackup.frozen, true)
assert.equal(finalBackup.final, true)
assert.equal(finalBackup.domains.length, 6)
assert.equal(finalBackup.artifact.manifest.domainRegistry.length, 6)
assert.equal(finalBackup.artifact.manifest.recordCounts.annotation, 0)
assert.equal(JSON.stringify(finalBackup).includes('mediaBytes'), false)
assert.equal(JSON.stringify(finalBackup).includes('Blob'), false)
assert.equal(JSON.stringify(finalBackup).includes('E:\\'), false)
assert.equal(fixture.storage.writeCount, 0, 'final backup remains read-only over legacy storage')

const imported = await fixture.service.importDomain('reader-session', {
  expectedRevision: 0,
  idempotencyKey: 'migration-reader-session-1',
})
assert.equal(imported.ok, true)
assert.equal(imported.commitStatus, 'committed')
assert.equal(fixture.service ? fixture.service.domains.includes('reader-session') : false, true)
const readerHost = fixture.service && (await fixture.service.status())
assert.equal(readerHost.authorityMode, 'pre-cutover')

const hostForRetry = createHostAdapters()
const retryStore = createMemoryMigrationStateStore()
const retryFixture = createMigrationFixture({ stateStore: retryStore, hostAdapters: hostForRetry })
await retryFixture.service.dryRun('reader-session')
await retryFixture.service.freeze('reader-session')
const retryFinal = await retryFixture.service.createFinalBackup('reader-session')
const firstImport = await retryFixture.service.importDomain('reader-session', {
  expectedRevision: 0,
  idempotencyKey: 'migration-retry-reader',
})
const retryCount = hostForRetry['reader-session'].importCalls
const sameImport = await retryFixture.service.importDomain('reader-session', {
  expectedRevision: 0,
  idempotencyKey: 'migration-retry-reader',
})
assert.equal(firstImport.receiptId, sameImport.receiptId)
assert.equal(sameImport.idempotent, true)
assert.equal(hostForRetry['reader-session'].importCalls, retryCount, 'same final import retry must not write twice')
assert.equal((await retryFixture.service.verify('reader-session')).status, 'verified')
assert.equal((await retryFixture.service.switchHostAuthoritative('reader-session')).authorityChanged, false)
assert.equal((await retryFixture.service.smokeCheck('reader-session')).reasonCode, 'cutover-deferred')
assert.equal(retryFinal.finalBackup.artifact.manifest.recordCounts.annotation, 0)

const reopened = createWindowsDurableStateMigration({
  profileId: 'optimization',
  legacyBridge: retryFixture.bridge,
  hostAdapters: hostForRetry,
  stateStore: retryStore,
  capacityBytes: 1_000_000,
})
const reopenedStatus = await reopened.status()
assert.equal(reopenedStatus.domains['reader-session'].verified, true)
const reopenedRetry = await reopened.importDomain('reader-session', {
  expectedRevision: 0,
  idempotencyKey: 'migration-retry-reader',
})
assert.equal(reopenedRetry.idempotent, true)
assert.equal(hostForRetry['reader-session'].importCalls, retryCount, 'reopen must replay stored result without a second import')

const migrationRun = createMigrationFixture()
const runResult = await migrationRun.service.migrateDomain('workflow', {
  expectedRevision: 0,
  idempotencyKey: 'migration-workflow-1',
})
assert.equal(runResult.ok, true)
assert.deepEqual(Object.keys(runResult.steps), ['inventory', 'dryRun', 'freeze', 'finalBackup', 'import', 'verify', 'switch', 'smoke'])
assert.equal(runResult.steps.switch.authorityChanged, false)

const conflictHost = createHostAdapters({
  'reader-session': new HostAdapter({ ...emptySnapshot(), revision: 1, records: [{ id: 'old', revision: 1, payload: { value: 'old' } }] }),
})
const conflictFixture = createMigrationFixture({ hostAdapters: conflictHost })
const conflict = await conflictFixture.service.dryRun('reader-session', { expectedRevision: 0 })
assert.equal(conflict.ok, false)
assert.equal(conflict.status, 'conflict')
assert.equal(conflict.currentRevision, 1)
assert.equal(conflictHost['reader-session'].importCalls, 0)

const unknownFixture = createMigrationFixture({ includeUnknown: true })
assert.equal((await unknownFixture.service.inventory()).status, 'blocked')
const unknownDryRun = await unknownFixture.service.dryRun('reader-session')
assert.equal(unknownDryRun.ok, false)
assert.equal(unknownDryRun.reasonCode, 'legacy-unclaimed-record')
assert.equal(unknownFixture.storage.writeCount, 0)

const schemaFixture = createMigrationFixture({ includeBadSchema: true })
assert.equal((await schemaFixture.service.inventory()).status, 'blocked')
assert.equal((await schemaFixture.service.dryRun('reader-session')).ok, false)

const mediaBytesBridge = {
  async inventory() { return { status: 'ready', records: [] } },
  async prepareImport() {
    return {
      status: 'ready',
      importInput: {
        schemaVersion: 1,
        mode: 'legacy-import-input',
        profileId: 'optimization',
        records: [{
          domain: 'reader-session',
          recordKey: 'audioMeta',
          schemaVersion: 1,
          revision: 1,
          payload: { mediaBytes: new Uint8Array([1, 2, 3]) },
        }],
      },
    }
  },
}
const mediaBytesHost = createHostAdapters()
const mediaBytesFixture = createWindowsDurableStateMigration({
  profileId: 'optimization',
  legacyBridge: mediaBytesBridge,
  hostAdapters: mediaBytesHost,
  capacityBytes: 1_000_000,
})
const mediaBytesDryRun = await mediaBytesFixture.dryRun('reader-session')
assert.equal(mediaBytesDryRun.ok, false)
assert.equal(mediaBytesDryRun.reasonCode, 'migration-media-payload-rejected')
assert.equal(mediaBytesHost['reader-session'].importCalls, 0, 'media bytes are rejected before host writes')

const stoppedHost = createHostAdapters()
const stoppedFixture = createMigrationFixture({
  hostAdapters: stoppedHost,
  writerControls: {
    'reader-session': { async freeze() { return { ok: false } } },
  },
})
const stopped = await stoppedFixture.service.runAll({ domains: ['reader-session', 'workflow'] })
assert.equal(stopped.ok, false)
assert.deepEqual(stopped.results.map((result) => result.domain), ['reader-session'], 'one failed domain stops later domains')
assert.equal(stoppedHost.workflow.freezeCalls, 0)

const tampered = clone(finalBackup)
tampered.artifact.domains['reader-session'].records[0].payload.contentId = 'tampered'
const tamperedRestore = await fixture.service.dryRunRestore('reader-session', tampered)
assert.equal(tamperedRestore.ok, false)
assert.equal(tamperedRestore.reasonCode, 'migration-backup-invalid')
const tamperedManifest = clone(finalBackup)
tamperedManifest.domains[0].recordCount += 1
const tamperedManifestRestore = await fixture.service.dryRunRestore('reader-session', tamperedManifest)
assert.equal(tamperedManifestRestore.ok, false)
assert.equal(tamperedManifestRestore.reasonCode, 'migration-backup-invalid')

const restoreHost = createHostAdapters()
const restoreFixture = createMigrationFixture({ hostAdapters: restoreHost })
const restoreDryRun = await restoreFixture.service.dryRunRestore('reader-session', finalBackup)
assert.equal(restoreDryRun.ok, true)
assert.equal(restoreDryRun.write, false)
const restored = await restoreFixture.service.restore('reader-session', finalBackup, {
  expectedRevision: 0,
  idempotencyKey: 'restore-reader-session-1',
})
assert.equal(restored.ok, true)
assert.equal(restoreHost['reader-session'].snapshot.records.length, finalBackup.artifact.domains['reader-session'].records.length)
const restoredRetry = await restoreFixture.service.restore('reader-session', finalBackup, {
  expectedRevision: 0,
  idempotencyKey: 'restore-reader-session-1',
})
assert.equal(restoredRetry.idempotent, true)

const faultHost = createHostAdapters({ 'reader-session': new HostAdapter(emptySnapshot(), { failImport: true }) })
const faultFixture = createMigrationFixture({ hostAdapters: faultHost })
await faultFixture.service.dryRun('reader-session')
await faultFixture.service.freeze('reader-session')
await faultFixture.service.createFinalBackup('reader-session')
const failedImport = await faultFixture.service.importDomain('reader-session', {
  expectedRevision: 0,
  idempotencyKey: 'migration-fault-1',
})
assert.equal(failedImport.ok, false)
assert.equal(faultHost['reader-session'].snapshot.revision, 0, 'failed replace keeps the old host value')
assert.equal(faultHost['reader-session'].snapshot.records.length, 0)

const rollbackHost = createHostAdapters()
const rollbackStore = createMemoryMigrationStateStore()
const rollbackFixture = createMigrationFixture({ hostAdapters: rollbackHost, stateStore: rollbackStore })
await rollbackFixture.service.dryRun('reader-session')
await rollbackFixture.service.freeze('reader-session')
await rollbackFixture.service.createFinalBackup('reader-session')
await rollbackFixture.service.importDomain('reader-session', { expectedRevision: 0, idempotencyKey: 'migration-rollback-1' })
const rollback = await rollbackFixture.service.rollback('reader-session')
assert.equal(rollback.ok, true, JSON.stringify(rollback))
assert.equal(rollback.status, 'rolled-back')
assert.equal(rollbackHost['reader-session'].snapshot.records.length, 0)
assert.equal(rollbackHost['reader-session'].unfreezeCalls, 1)

console.log('Windows durable-state migration checks passed.')
