import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { WINDOWS_OWNER_PRODUCTION_DEFAULT_MAX_BACKUP_BYTES } from './lib/windows-owner-production-entry.mjs'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function dataUrl(source) {
  return `data:text/javascript;base64,${Buffer.from(source, 'utf8').toString('base64')}`
}

const applicationBackupSource = await readFile(
  path.join(repositoryRoot, 'src/services/persistence/application-backup.js'),
  'utf8',
)
const migrationSource = await readFile(
  path.join(repositoryRoot, 'src/services/persistence/windows-durable-state-migration.js'),
  'utf8',
)
const applicationBackup = await import(dataUrl(applicationBackupSource))
const migrationModule = await import(dataUrl(
  migrationSource.replace("from './application-backup.js'", `from '${dataUrl(applicationBackupSource)}'`),
))

const {
  createApplicationBackupService,
  verifyBackupArtifact,
} = applicationBackup
const {
  WINDOWS_DURABLE_STATE_MIGRATION_DOMAINS,
  createMemoryMigrationStateStore,
  createWindowsDurableStateMigration,
} = migrationModule

const GENERIC_MAX_BACKUP_BYTES = 64 * 1024 * 1024
const MAX_RECORD_BYTES = 8 * 1024 * 1024
const LARGE_PAYLOAD_BYTES = 7 * 1024 * 1024
const LARGE_RECORD_COUNT = 10
const LARGE_ARTIFACT_CAPACITY_BYTES = 2 * 1024 * 1024 * 1024

function clone(value) {
  return structuredClone(value)
}

function emptySnapshot() {
  return {
    schemaVersion: 1,
    adapterVersion: 1,
    revision: 0,
    records: [],
    references: [],
    mediaReferences: [],
  }
}

function applicationAdapter(key, snapshot) {
  return {
    key,
    schemaVersion: 1,
    adapterVersion: 1,
    supportedSchemaVersions: [1],
    async collect() {
      return clone(snapshot)
    },
  }
}

function createApplicationAdapters(records) {
  const snapshots = Object.fromEntries(WINDOWS_DURABLE_STATE_MIGRATION_DOMAINS.map((domain) => [
    domain,
    emptySnapshot(),
  ]))
  snapshots['reader-session'] = {
    ...emptySnapshot(),
    records: clone(records),
  }
  return Object.fromEntries(WINDOWS_DURABLE_STATE_MIGRATION_DOMAINS.map((domain) => [
    domain,
    applicationAdapter(domain, snapshots[domain]),
  ]))
}

const largeValue = 'x'.repeat(LARGE_PAYLOAD_BYTES)
const applicationRecords = Array.from({ length: LARGE_RECORD_COUNT }, (_, index) => ({
  id: `large-${index}`,
  schemaVersion: 1,
  revision: 0,
  contentId: null,
  payload: { value: largeValue },
  references: [],
  mediaReferences: [],
}))

function applicationService(maxBackupBytes) {
  return createApplicationBackupService({
    requiredDomains: WINDOWS_DURABLE_STATE_MIGRATION_DOMAINS,
    adapters: createApplicationAdapters(applicationRecords),
    maxBackupBytes,
    maxRecordBytes: MAX_RECORD_BYTES,
    release: { applicationVersion: 'production-limit-check', releaseId: 'production-limit-check' },
  })
}

await assert.rejects(
  applicationService(GENERIC_MAX_BACKUP_BYTES).createBackup(),
  (error) => error?.code === 'BACKUP_QUOTA_EXCEEDED',
  'the generic application backup default must remain a 64 MiB hard limit',
)

const productionService = applicationService(WINDOWS_OWNER_PRODUCTION_DEFAULT_MAX_BACKUP_BYTES)
const productionArtifact = await productionService.createBackup()
assert.ok(productionArtifact.manifest.artifactBytes > GENERIC_MAX_BACKUP_BYTES)
assert.equal(productionArtifact.manifest.maxBackupBytes, WINDOWS_OWNER_PRODUCTION_DEFAULT_MAX_BACKUP_BYTES)
assert.equal((await productionService.verifyBackup(productionArtifact)).valid, true)

const productionVerification = await verifyBackupArtifact(productionArtifact, {
  requiredDomains: WINDOWS_DURABLE_STATE_MIGRATION_DOMAINS,
  maxBackupBytes: WINDOWS_OWNER_PRODUCTION_DEFAULT_MAX_BACKUP_BYTES,
})
assert.equal(productionVerification.valid, true)

await assert.rejects(
  productionService.createBackup({ limits: { maxBackupBytes: GENERIC_MAX_BACKUP_BYTES } }),
  (error) => error?.code === 'BACKUP_QUOTA_EXCEEDED',
  'a production backup must still fail closed when the configured limit is below the artifact',
)

const tamperedArtifact = clone(productionArtifact)
tamperedArtifact.manifest.maxBackupBytes = WINDOWS_OWNER_PRODUCTION_DEFAULT_MAX_BACKUP_BYTES * 2
const tamperedVerification = await productionService.verifyBackup(tamperedArtifact)
assert.equal(tamperedVerification.valid, false)
assert.equal(tamperedVerification.error.code, 'BACKUP_CHECKSUM_MISMATCH')

const migrationRecords = applicationRecords.map((record) => ({
  domain: 'reader-session',
  recordKey: record.id,
  schemaVersion: record.schemaVersion,
  revision: 1,
  contentId: record.contentId,
  payload: clone(record.payload),
  references: [],
  mediaReferences: [],
}))

function createLegacyBridge() {
  return {
    async inventory() {
      return { status: 'ready', records: clone(migrationRecords) }
    },
    async prepareImport() {
      return {
        status: 'ready',
        importIdentity: 'production-limit-check-import',
        importInput: {
          schemaVersion: 1,
          mode: 'legacy-import-input',
          profileId: 'production-limit-check',
          records: clone(migrationRecords),
        },
      }
    },
  }
}

function createHostAdapters() {
  return Object.fromEntries(WINDOWS_DURABLE_STATE_MIGRATION_DOMAINS.map((domain) => {
    let snapshot = emptySnapshot()
    return [domain, {
      async collect() {
        return clone(snapshot)
      },
      async importRecords({ snapshot: next, expectedRevision }) {
        if (snapshot.revision !== expectedRevision) return { status: 'conflict', currentRevision: snapshot.revision }
        snapshot = clone(next)
        return { status: 'committed', commitStatus: 'committed', revision: snapshot.revision }
      },
      async rollback({ snapshot: next, expectedRevision }) {
        if (snapshot.revision !== expectedRevision) return { status: 'conflict', currentRevision: snapshot.revision }
        snapshot = clone(next)
        return { status: 'committed', commitStatus: 'committed', revision: snapshot.revision }
      },
    }]
  }))
}

const hostAdapters = createHostAdapters()
const migration = createWindowsDurableStateMigration({
  profileId: 'production-limit-check',
  legacyBridge: createLegacyBridge(),
  hostAdapters,
  stateStore: createMemoryMigrationStateStore(),
  writerControls: Object.fromEntries(WINDOWS_DURABLE_STATE_MIGRATION_DOMAINS.map((domain) => [domain, {
    async freeze() { return { ok: true } },
    async unfreeze() { return { ok: true } },
  }])),
  capacityBytes: LARGE_ARTIFACT_CAPACITY_BYTES,
  backupLimits: {
    maxBackupBytes: WINDOWS_OWNER_PRODUCTION_DEFAULT_MAX_BACKUP_BYTES,
    maxRecordBytes: MAX_RECORD_BYTES,
  },
  release: { applicationVersion: 'production-limit-check', releaseId: 'production-limit-check' },
})

const migrationDryRun = await migration.dryRun('reader-session', { allowExistingTarget: true })
assert.equal(migrationDryRun.ok, true)
assert.equal((await migration.freeze('reader-session')).ok, true)
const finalBackup = await migration.createFinalBackup('reader-session')
assert.equal(finalBackup.ok, true)
assert.equal(finalBackup.finalBackup.artifact.manifest.maxBackupBytes, WINDOWS_OWNER_PRODUCTION_DEFAULT_MAX_BACKUP_BYTES)

const imported = await migration.importDomain('reader-session', { expectedRevision: 0, idempotencyKey: 'production-limit-import' })
assert.equal(imported.ok, true)
assert.equal((await migration.verify('reader-session')).ok, true)
const rolledBack = await migration.rollback('reader-session', { idempotencyKey: 'production-limit-rollback' })
assert.equal(rolledBack.ok, true)
assert.equal(rolledBack.status, 'rolled-back')

console.log('Windows owner production backup limit checks passed.')
