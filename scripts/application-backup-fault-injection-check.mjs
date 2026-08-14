import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('../src/services/persistence/application-backup.js', import.meta.url), 'utf8')
const {
  APPLICATION_BACKUP_REQUIRED_DOMAINS,
  createApplicationBackupService,
  verifyBackupArtifact,
} = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)

const sourceState = createState('source')
const sourceService = createApplicationBackupService({
  adapters: sourceState.adapters,
  release: { applicationVersion: 'test', gitSha: 'fault-test' },
})
const artifact = await sourceService.createBackup()

const capacityState = createState('empty')
const capacityService = createApplicationBackupService({ adapters: capacityState.adapters })
const capacityReport = await capacityService.dryRunRestore(artifact, {
  target: { isolated: true, adapters: capacityState.adapters, capacityBytes: 1 },
})
assert.equal(capacityReport.write, false)
assert.equal(capacityReport.ok, false)
assert.ok(capacityReport.domains.every((domain) => domain.decision === 'blocked'))
assert.equal(capacityState.writes, 0)

const newerState = createState('newer')
const newerService = createApplicationBackupService({ adapters: newerState.adapters })
const newerReport = await newerService.dryRunRestore(artifact, {
  target: { isolated: true, adapters: newerState.adapters, capacityBytes: 10_000_000 },
})
assert.equal(newerReport.ok, false)
assert.ok(newerReport.blocked.some((item) => item.reason === 'newer-target-revision'))

const unknownSchema = structuredClone(artifact)
unknownSchema.domains['reader-session'].schemaVersion = 99
const unknownSchemaReport = await verifyBackupArtifact(unknownSchema)
assert.equal(unknownSchemaReport.valid, false)
assert.ok(['BACKUP_CHECKSUM_MISMATCH', 'BACKUP_DOMAIN_SCHEMA_MISMATCH'].includes(unknownSchemaReport.error.code))

const manifestUnknownSchema = structuredClone(artifact)
manifestUnknownSchema.manifest.schemaVersion = 99
const manifestUnknownSchemaReport = await verifyBackupArtifact(manifestUnknownSchema)
assert.equal(manifestUnknownSchemaReport.valid, false)
assert.equal(manifestUnknownSchemaReport.error.code, 'BACKUP_SCHEMA_UNSUPPORTED')

const largeObjectService = createApplicationBackupService({
  adapters: createState('large').adapters,
  maxRecordBytes: 256,
})
await assert.rejects(
  largeObjectService.createBackup(),
  (error) => error?.code === 'BACKUP_RECORD_TOO_LARGE',
  'large records must be rejected before a backup artifact is emitted',
)

const replaceFailureState = createState('empty')
const replaceFailureTarget = createTarget(replaceFailureState, { commitMode: 'write-then-fail' })
const replaceFailureService = createApplicationBackupService({ adapters: replaceFailureState.adapters, target: replaceFailureTarget })
await assert.rejects(
  replaceFailureService.restore(artifact, { restoreId: 'replace-failure' }),
  (error) => error?.code === 'RESTORE_COMMIT_FAILED',
)
assert.deepEqual(snapshotState(replaceFailureState), snapshotState(createState('empty')))
assert.equal(replaceFailureTarget.quarantine.entries.length, 1)
assert.equal(replaceFailureTarget.journal.last.status, 'rolled-back')

const retryState = createState('empty')
const retryTarget = createTarget(retryState, { commitMode: 'fail-once' })
const retryService = createApplicationBackupService({ adapters: retryState.adapters, target: retryTarget })
await assert.rejects(retryService.restore(artifact, { restoreId: 'retryable' }), { code: 'RESTORE_COMMIT_FAILED' })
assert.equal(retryTarget.rollbackWrites, 1)
const retryResult = await retryService.restore(artifact, { restoreId: 'retryable' })
assert.equal(retryResult.status, 'completed')
assert.equal(retryTarget.rollbackWrites, 1, 'retry must reuse the migration-before rollback backup')
assert.deepEqual(snapshotState(retryState), snapshotState(sourceState))

const interruptionState = createState('empty')
const interruptionTarget = createTarget(interruptionState, { commitMode: 'success' })
const interruptionService = createApplicationBackupService({ adapters: interruptionState.adapters, target: interruptionTarget })
const controller = new AbortController()
const interruptedPromise = interruptionService.restore(artifact, { restoreId: 'interrupted', signal: controller.signal })
interruptionTarget.onApply = () => controller.abort()
await assert.rejects(interruptedPromise, { code: 'RESTORE_INTERRUPTED' })
assert.deepEqual(snapshotState(interruptionState), snapshotState(createState('empty')))
const resumed = await interruptionService.restore(artifact, { restoreId: 'interrupted' })
assert.equal(resumed.status, 'completed')
assert.deepEqual(snapshotState(interruptionState), snapshotState(sourceState))

const missingRollbackState = createState('empty')
const missingRollbackTarget = createTarget(missingRollbackState, { commitMode: 'success' })
missingRollbackTarget.journal.last = { status: 'started', artifactChecksum: artifact.artifactChecksum }
const missingRollbackService = createApplicationBackupService({ adapters: missingRollbackState.adapters, target: missingRollbackTarget })
await assert.rejects(
  missingRollbackService.restore(artifact, { restoreId: 'missing-rollback' }),
  { code: 'RESTORE_ROLLBACK_UNAVAILABLE' },
)
assert.equal(missingRollbackState.writes, 0)

const rollbackFailedState = createState('empty')
const rollbackFailedTarget = createTarget(rollbackFailedState, { commitMode: 'success' })
rollbackFailedTarget.journal.last = { status: 'rollback-failed', artifactChecksum: artifact.artifactChecksum }
const rollbackFailedService = createApplicationBackupService({ adapters: rollbackFailedState.adapters, target: rollbackFailedTarget })
await assert.rejects(
  rollbackFailedService.restore(artifact, { restoreId: 'rollback-failed' }),
  { code: 'RESTORE_ROLLBACK_FAILED' },
)
assert.equal(rollbackFailedState.writes, 0)

const corruptArtifact = structuredClone(artifact)
corruptArtifact.manifest.checksum = 'sha256:corrupt'
const corruptTargetState = createState('empty')
const corruptTarget = createTarget(corruptTargetState, { commitMode: 'success' })
const corruptService = createApplicationBackupService({ adapters: corruptTargetState.adapters, target: corruptTarget })
await assert.rejects(corruptService.restore(corruptArtifact, { restoreId: 'corrupt-input' }), { code: 'BACKUP_CHECKSUM_MISMATCH' })
assert.equal(corruptTarget.rollbackWrites, 0)
assert.equal(corruptTarget.quarantine.entries.length, 1)
assert.equal(corruptTargetState.writes, 0)

const secretArtifact = structuredClone(artifact)
secretArtifact.manifest.apiKey = 'must-not-enter-quarantine'
const secretTargetState = createState('empty')
const secretTarget = createTarget(secretTargetState, { commitMode: 'success' })
const secretService = createApplicationBackupService({ adapters: secretTargetState.adapters, target: secretTarget })
await assert.rejects(secretService.restore(secretArtifact, { restoreId: 'secret-input' }), { code: 'BACKUP_SECRET_PRESENT' })
assert.equal(JSON.stringify(secretTarget.quarantine.entries).includes('must-not-enter-quarantine'), false)

console.log('Application backup fault-injection checks passed.')

function createState(kind) {
  const isSource = kind === 'source'
  const isNewer = kind === 'newer'
  const isLarge = kind === 'large'
  const records = isSource
    ? [{ id: 'record-1', schemaVersion: 1, revision: 1, contentId: 'content-1', payload: { value: 'source' } }]
    : isNewer
      ? [{ id: 'record-1', schemaVersion: 1, revision: 2, contentId: 'content-1', payload: { value: 'newer' } }]
      : isLarge
        ? [{ id: 'record-1', schemaVersion: 1, revision: 1, contentId: 'content-1', payload: { value: 'x'.repeat(2_000) } }]
      : []
  const adapters = Object.fromEntries(APPLICATION_BACKUP_REQUIRED_DOMAINS.map((key) => {
    const domain = {
      key,
      schemaVersion: 1,
      adapterVersion: 1,
      revision: isSource ? 1 : (isNewer ? 2 : 0),
      records: structuredClone(records.map((record) => ({ ...record, id: `${key}:${record.id}` }))),
      async collect() {
        return { schemaVersion: 1, revision: this.revision, records: structuredClone(this.records) }
      },
    }
    return [key, domain]
  }))
  return { adapters, writes: 0 }
}

function snapshotState(state) {
  return Object.fromEntries(APPLICATION_BACKUP_REQUIRED_DOMAINS.map((key) => [key, {
    revision: state.adapters[key].revision,
    records: state.adapters[key].records.map((record) => ({
      id: record.id,
      schemaVersion: record.schemaVersion,
      revision: record.revision,
      contentId: record.contentId,
      payload: record.payload,
    })),
  }]))
}

function createTarget(state, { commitMode = 'success' } = {}) {
  const target = {
    isolated: true,
    adapters: state.adapters,
    capacityBytes: 10_000_000,
    rollbackWrites: 0,
    journal: { last: null },
    quarantine: { entries: [], async write(entry) { this.entries.push(entry) } },
    rollbackStore: {
      async write(entry) { target.rollbackWrites += 1; target.rollback = entry.artifact },
      async read() { return target.rollback ? { artifact: target.rollback } : null },
    },
    async readJournal() { return target.journal.last },
    async writeJournal(entry) { target.journal.last = entry },
    async beginTransaction() {
      const staged = new Map()
      return {
        async applyDomain(key, domain) { staged.set(key, structuredClone(domain)); target.onApply?.(key) },
        async commit() {
          if (commitMode === 'write-then-fail' || (commitMode === 'fail-once' && !target.failed)) {
            target.failed = true
            applyStaged(staged)
            throw Object.assign(new Error('replace failed'), { code: 'RESTORE_COMMIT_FAILED' })
          }
          applyStaged(staged)
        },
        async rollback() { staged.clear() },
      }
      function applyStaged(stagedValues) {
        for (const [key, domain] of stagedValues) {
          state.adapters[key].records = structuredClone(domain.records)
          state.adapters[key].revision = domain.revision
          state.writes += 1
        }
      }
    },
    async restoreSnapshot(backup) {
      for (const key of APPLICATION_BACKUP_REQUIRED_DOMAINS) {
        state.adapters[key].records = structuredClone(backup.domains[key].records)
        state.adapters[key].revision = backup.domains[key].revision
      }
    },
  }
  return target
}
