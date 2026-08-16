import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'

const TEST_ISOLATION_ISSUER_TOKEN = 'application-backup-check-isolation-issuer'
const moduleSource = (await (await import('node:fs/promises')).readFile(
  new URL('../src/services/persistence/application-backup.js', import.meta.url),
  'utf8',
)).replace(
  'const ISOLATION_ISSUER_TOKEN = null',
  `const ISOLATION_ISSUER_TOKEN = ${JSON.stringify(TEST_ISOLATION_ISSUER_TOKEN)}`,
)
const {
  APPLICATION_BACKUP_REQUIRED_DOMAINS,
  createApplicationBackupIsolationCertificate,
  createApplicationBackupService,
  createLocalStorageDomainAdapter,
  registerApplicationBackupIsolationTarget,
  verifyBackupArtifact,
} = await import(`data:text/javascript;base64,${Buffer.from(moduleSource).toString('base64')}`)

class MapStorage {
  constructor(initial = {}) { this.values = new Map(Object.entries(initial)) }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null }
  setItem(key, value) { this.values.set(key, String(value)) }
  removeItem(key) { this.values.delete(key) }
}

assert.deepEqual(APPLICATION_BACKUP_REQUIRED_DOMAINS, [
  'reader-session',
  'marks-activity',
  'vocabulary-srs',
  'passage-preview',
  'annotation',
  'workflow',
])

assert.throws(
  () => createApplicationBackupService({ adapters: {} }),
  (error) => error?.code === 'BACKUP_ADAPTER_MISSING',
  'a missing required adapter must fail closed instead of becoming an empty domain',
)

const adapters = createDomainAdapters()
const service = createApplicationBackupService({
  adapters,
  release: { applicationVersion: '1.0.0', gitSha: 'test-sha', releaseId: 'test-release' },
  now: () => 1700000000000,
})

const artifact = await service.createBackup()
assert.equal(artifact.format, 'read-web.application-backup')
assert.equal(artifact.manifest.formatVersion, 1)
assert.equal(artifact.manifest.schemaVersion, 1)
assert.equal(artifact.manifest.createdAt, '2023-11-14T22:13:20.000Z')
assert.equal(artifact.manifest.domainRegistry.length, 6)
assert.deepEqual(artifact.manifest.recordCounts['vocabulary-srs'], 1)
assert.equal(artifact.manifest.mediaPolicy.mode, 'identity-metadata-rebind')
assert.equal(JSON.stringify(artifact).includes('super-secret-token'), false)
assert.equal(JSON.stringify(artifact).includes('api-key-value'), false)
assert.equal(JSON.stringify(artifact).includes('Authorization'), false)

const verification = await verifyBackupArtifact(JSON.stringify(artifact), {
  requiredDomains: APPLICATION_BACKUP_REQUIRED_DOMAINS,
})
assert.equal(verification.valid, true)
assert.equal(verification.summary.totalRecords, 6)
assert.deepEqual(verification.summary.domainKeys, APPLICATION_BACKUP_REQUIRED_DOMAINS)

const tampered = structuredClone(artifact)
tampered.domains['vocabulary-srs'].records[0].payload.words[0].word = 'tampered'
const tamperedVerification = await verifyBackupArtifact(tampered, {
  requiredDomains: APPLICATION_BACKUP_REQUIRED_DOMAINS,
})
assert.equal(tamperedVerification.valid, false)
assert.equal(tamperedVerification.error.code, 'BACKUP_CHECKSUM_MISMATCH')

const unknownDomain = structuredClone(artifact)
unknownDomain.domains.unknown = { schemaVersion: 1, records: [] }
unknownDomain.manifest.domainRegistry.push({
  key: 'unknown',
  schemaVersion: 1,
  adapterVersion: 1,
  required: false,
})
const unknownVerification = await verifyBackupArtifact(unknownDomain, {
  requiredDomains: APPLICATION_BACKUP_REQUIRED_DOMAINS,
})
assert.equal(unknownVerification.valid, false)
assert.equal(unknownVerification.error.code, 'BACKUP_UNKNOWN_DOMAIN')

const dryRun = await service.dryRunRestore(artifact, {
  target: { isolated: true, capacityBytes: 10_000_000 },
})
assert.equal(dryRun.write, false)
assert.equal(dryRun.ok, true)
assert.ok(dryRun.domains.some((domain) => domain.decision === 'keep'))
assert.equal(adapters['vocabulary-srs'].writes, 0)

const target = createRestoreTarget(adapters)
const restoreService = createApplicationBackupService({
  adapters,
  target,
  release: { applicationVersion: '1.0.0', gitSha: 'test-sha', releaseId: 'test-release' },
})
const unsafeAdapters = createDomainAdapters()
const unsafeService = createApplicationBackupService({ adapters: unsafeAdapters })
const unsafeArtifact = await unsafeService.createBackup()
const selfAssertedTarget = createRestoreTarget(unsafeAdapters)
delete selfAssertedTarget.isolationCertificate
await assert.rejects(
  unsafeService.restore(unsafeArtifact, {
    target: selfAssertedTarget,
    restoreId: 'self-asserted-isolation',
    resolutions: Object.fromEntries(APPLICATION_BACKUP_REQUIRED_DOMAINS.map((key) => [key, 'restore'])),
  }),
  (error) => error?.code === 'RESTORE_TARGET_UNSAFE',
  'isolated:true without a concrete isolation certificate must fail before any restore write',
)
const unsafeTarget = createRestoreTarget(unsafeAdapters)
delete unsafeTarget.restoreCapabilities
// TDD RED evidence: the pre-capability service accepted this target and
// committed it; the contract now requires an explicit revision/evidence claim.
await assert.rejects(
  unsafeService.restore(unsafeArtifact, {
    target: unsafeTarget,
    restoreId: 'unsafe-target-capability',
    resolutions: Object.fromEntries(APPLICATION_BACKUP_REQUIRED_DOMAINS.map((key) => [key, 'restore'])),
  }),
  (error) => error?.code === 'RESTORE_TARGET_UNSAFE',
  'a target without explicit revision/evidence capabilities must fail before any restore write',
)
assert.equal(unsafeTarget.transactionCommits, 0)
const noEvidenceTarget = createRestoreTarget(unsafeAdapters, { commitWithoutEvidence: true })
await assert.rejects(
  unsafeService.restore(unsafeArtifact, {
    target: noEvidenceTarget,
    restoreId: 'missing-commit-evidence',
    resolutions: Object.fromEntries(APPLICATION_BACKUP_REQUIRED_DOMAINS.map((key) => [key, 'restore'])),
  }),
  (error) => error?.code === 'RESTORE_COMMIT_EVIDENCE_UNAVAILABLE',
  'a commit without revision evidence must fail explicitly after possible write, never silently skip rollback',
)
assert.equal(noEvidenceTarget.journal.last.status, 'rollback-failed')
assert.equal(noEvidenceTarget.journal.last.manualRecoveryRequired, true)
const newerArtifact = await restoreService.createBackup({ now: () => 1700000000001 })
adapters['vocabulary-srs'].records[0].payload.words[0].word = 'changed-locally'
adapters['vocabulary-srs'].revision = 2
const restoreReport = await restoreService.restore(newerArtifact, {
  restoreId: 'restore-1',
  resolutions: { 'vocabulary-srs': 'restore' },
})
assert.equal(restoreReport.status, 'completed')
assert.equal(target.rollbackWrites, 1)
assert.equal(target.journal.attempts, 1)
assert.equal(adapters['vocabulary-srs'].records[0].payload.words[0].word, 'hello')
assert.equal(target.transactionCommits, 1)

const secondRestore = await restoreService.restore(newerArtifact, { restoreId: 'restore-1' })
assert.equal(secondRestore.status, 'already-complete')
assert.equal(target.transactionCommits, 1, 'completed restore retry must be idempotent')

const storage = new MapStorage({
  preview: JSON.stringify({ schemaVersion: 'preview.v1', revision: 3, contentId: 'preview-1', items: [] }),
})
const localAdapter = createLocalStorageDomainAdapter({
  key: 'preview',
  domainKey: 'passage-preview',
  schemaVersion: 'preview.v1',
  storage,
  requiredFields: { revision: 'integer', contentId: 'string' },
})
const localCollected = await localAdapter.collect()
assert.equal(localCollected.records[0].revision, 3)
assert.equal(localCollected.records[0].contentId, 'preview-1')
storage.setItem('preview', JSON.stringify({ schemaVersion: 'preview.v1', revision: 'not-an-integer', contentId: 'preview-1' }))
await assert.rejects(localAdapter.collect(), (error) => error?.code === 'BACKUP_LOCAL_STORAGE_INVALID_ENVELOPE')

const binaryService = createApplicationBackupService({
  adapters: createDomainAdapters({ binary: true }),
  release: { applicationVersion: '1.0.0', gitSha: 'test-sha', releaseId: 'test-release' },
})
await assert.rejects(
  binaryService.createBackup(),
  (error) => error?.code === 'BACKUP_BINARY_PAYLOAD_REJECTED',
)

const directBinaryArtifact = structuredClone(artifact)
directBinaryArtifact.domains.annotation.records[0].payload.nested = new Uint8Array([1, 2, 3])
const directBinaryVerification = await verifyBackupArtifact(directBinaryArtifact)
assert.equal(directBinaryVerification.valid, false)
assert.equal(directBinaryVerification.error.code, 'BACKUP_BINARY_PAYLOAD_REJECTED')

const inlineMediaService = createApplicationBackupService({
  adapters: createDomainAdapters({ inlineMedia: true }),
  release: { applicationVersion: '1.0.0', gitSha: 'test-sha', releaseId: 'test-release' },
})
await assert.rejects(
  inlineMediaService.createBackup(),
  (error) => error?.code === 'BACKUP_MEDIA_PAYLOAD_REJECTED',
)

console.log('Application backup checks passed.')

function createDomainAdapters({ binary = false, inlineMedia = false } = {}) {
  return Object.fromEntries(APPLICATION_BACKUP_REQUIRED_DOMAINS.map((key) => {
    const domain = {
      key,
      schemaVersion: 1,
      adapterVersion: 1,
      revision: 1,
      writes: 0,
      records: [{
        id: `${key}:record-1`,
        schemaVersion: 1,
        revision: 1,
        contentId: `${key}-content-1`,
        payload: key === 'vocabulary-srs'
          ? {
              schemaVersion: 1,
              words: [{ word: 'hello', sourceUrl: inlineMedia ? 'data:audio/mp4;base64,AAAA' : 'https://example.test/words?token=super-secret-token' }],
            }
          : { schemaVersion: 1, value: key },
        references: [{ type: 'content', id: `${key}-content-1` }],
        mediaReferences: key === 'reader-session'
          ? [{ type: 'media', identity: 'media-1', url: 'https://example.test/audio.mp4?api_key=api-key-value' }]
          : [],
      }],
      async collect() {
        if (binary && key === 'annotation') {
          return {
            schemaVersion: 1,
            revision: this.revision,
            records: [{ ...this.records[0], payload: { binary: new Uint8Array([1, 2, 3]) } }],
          }
        }
        return { schemaVersion: this.schemaVersion, revision: this.revision, records: structuredClone(this.records) }
      },
    }
    return [key, domain]
  }))
}

function createRestoreTarget(adapters, { commitWithoutEvidence = false } = {}) {
  const isolationLayout = Object.freeze({
    isolationRoot: '[application-backup-test-root]',
    paths: Object.freeze({ target: '[application-backup-test-root]/target' }),
  })
  const target = {
    isolated: true,
    isolationCertificate: createApplicationBackupIsolationCertificate({
      ...isolationLayout,
      issuerToken: TEST_ISOLATION_ISSUER_TOKEN,
    }),
    isolationLayout,
    restoreCapabilities: {
      atomicRevisionCommit: true,
      commitRevisionEvidence: true,
      verifyAppliedRevision: true,
    },
    captureRestoreOperation() { return Object.freeze({}) },
    capacityBytes: 10_000_000,
    revision: 0,
    rollbackWrites: 0,
    transactionCommits: 0,
    rollback: null,
    journal: { attempts: 0, last: null },
    rollbackStore: {
      async write(entry) {
        target.rollbackWrites += 1
        target.rollback = { ...entry, rawState: { revision: target.revision } }
        return target.rollback
      },
      async read() { return target.rollback ? structuredClone(target.rollback) : null },
    },
    async readJournal() { return target.journal.last },
    quarantine: { entries: [], async write(entry) { this.entries.push(entry) } },
    async writeJournal(entry) {
      target.journal.last = entry
      target.journal.attempts += entry.status === 'started' ? 1 : 0
    },
    async beginTransaction({ expectedBaseRevision } = {}) {
      if (Number.isInteger(expectedBaseRevision) && expectedBaseRevision !== target.revision) {
        throw Object.assign(new Error('stale restore base revision'), { code: 'RESTORE_REVISION_CONFLICT' })
      }
      const staged = new Map()
      const transaction = {
        async applyDomain(key, value) { staged.set(key, structuredClone(value)) },
        async commit() {
          for (const [key, value] of staged) {
            adapters[key].records = structuredClone(value.records)
            adapters[key].revision = value.revision
            adapters[key].writes += 1
          }
          target.transactionCommits += 1
          target.revision += 1
          transaction.committedRevision = target.revision
          if (commitWithoutEvidence) {
            delete transaction.committedRevision
            return undefined
          }
          return { revision: transaction.committedRevision }
        },
        async rollback() { staged.clear() },
      }
      return transaction
    },
    async restoreSnapshot(artifact, context = {}) {
      if (Number.isInteger(context.expectedRevision) && target.revision !== context.expectedRevision) {
        throw Object.assign(new Error('stale rollback revision'), { code: 'RESTORE_REVISION_CONFLICT' })
      }
      for (const key of APPLICATION_BACKUP_REQUIRED_DOMAINS) {
        const domain = artifact.domains[key]
        adapters[key].records = structuredClone(domain.records)
        adapters[key].revision = domain.revision
      }
      target.revision += 1
      return { revision: target.revision }
    },
    async verifyApplied({ artifact }) {
      return { ok: true, revision: target.revision }
    },
  }
  assert.equal(
    registerApplicationBackupIsolationTarget({
      target,
      isolationCertificate: target.isolationCertificate,
      isolationLayout,
      issuerToken: TEST_ISOLATION_ISSUER_TOKEN,
    }),
    true,
  )
  return target
}
