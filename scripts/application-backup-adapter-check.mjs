import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { readFile } from 'node:fs/promises'

const backupSource = await readFile(new URL('../src/services/persistence/application-backup.js', import.meta.url), 'utf8')
const runtimeSource = await readFile(new URL('../src/services/persistence/read-web-application-backup.js', import.meta.url), 'utf8')
const backupUrl = `data:text/javascript;base64,${Buffer.from(backupSource).toString('base64')}`
const runtimeUrl = `data:text/javascript;base64,${Buffer.from(
  runtimeSource.replace("from './application-backup.js'", `from '${backupUrl}'`),
).toString('base64')}`

const {
  createReadWebApplicationBackupAdapters,
  createReadWebApplicationBackupService,
  createReaderSaveOutboxQuarantineProtector,
} = await import(runtimeUrl)

class MapStorage {
  constructor(initial = {}) { this.values = new Map(Object.entries(initial)) }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null }
  setItem(key, value) { this.values.set(key, String(value)) }
  removeItem(key) { this.values.delete(key) }
  key(index) { return [...this.values.keys()][index] ?? null }
  get length() { return this.values.size }
}

const outboxMarks = {
  jobId: 'job-1',
  kind: 'marks',
  operationId: 'operation-marks-1',
  expectedRevision: 2,
  intent: { marks: [{ globalIndex: 1, word: 'hello', start: null, sourceType: 'manual-mark' }] },
}
const outboxActivity = {
  jobId: 'job-1',
  kind: 'activity',
  operationId: 'operation-activity-1',
  expectedRevision: 3,
  intent: {
    event: 'pause',
    sessionId: 'session-1',
    sessionStartedAt: '2026-08-14T00:00:00Z',
    positionSeconds: 1,
    durationSeconds: 2,
    intervals: [[0, 1]],
    coverageRatio: 0.5,
    markCount: 1,
  },
}

const storage = new MapStorage({
  'read-web.reader-save-outbox.v1': JSON.stringify({ schemaVersion: 1, entries: [outboxMarks] }),
  'read-web.reader-save-outbox.v2.6a_6f_62_2d_31.activity.6f_70_65_72_61_74_69_6f_6e_2d_61_63_74_69_76_69_74_79_2d_31': JSON.stringify({ schemaVersion: 2, ...outboxActivity }),
  'vocabulary.passage-preview.durable-state.v1': JSON.stringify({
    schemaVersion: 'passage-preview.durable-state.v1',
    revision: 4,
    contentId: 'preview-1',
    payload: { batchId: 'batch-1' },
  }),
  'vocabulary.passage-preview.translation-display-mode.v1': 'sentence',
  'vocabulary.passage-preview.data.v1': JSON.stringify([{ id: 'legacy-preview-1', lemma: 'hello' }]),
})
const rows = [
  { id: 'audioMeta', schemaVersion: 1, revision: 'session:1', contentId: 'reader-1', content: { jobId: 'reader-1', streamUrl: 'https://media.example/audio.mp4' } },
  { id: 'transcript', schemaVersion: 1, revision: 'session:1', contentId: 'reader-1', content: { segments: [] } },
  { id: 'chunkData', schemaVersion: 1, revision: 'session:1', contentId: 'reader-1', content: { s: [] } },
  { id: 'marks', schemaVersion: 1, revision: 'session:1', contentId: 'reader-1', content: [] },
  { id: 'readerSession', schemaVersion: 3, revision: 'session:1', contentId: 'reader-1', content: { schemaVersion: 3, contentId: 'reader-1' } },
  { id: 'vocabulary.srs.store.v1', schemaVersion: 1, revision: 2, contentId: 'word-1', content: { schemaVersion: 1, entries: [] } },
]

const marksActivityAdapter = simpleAdapter('marks-activity')
const workflowAdapter = simpleAdapter('workflow')
const options = {
  applicationPersistence: { async getAllRows() { return rows } },
  storage,
  marksActivityAdapter,
  workflowAdapter,
  release: { applicationVersion: 'test', gitSha: 'adapter-test' },
}
const adapters = createReadWebApplicationBackupAdapters(options)
const preview = await adapters['passage-preview'].collect()
assert.equal(preview.records[0].revision, 4)
assert.equal(preview.records[0].contentId, 'preview-1')
assert.equal(preview.records.find((record) => record.id.endsWith('translation-display-mode.v1')).payload.value, 'sentence')

const service = createReadWebApplicationBackupService(options)
const artifact = await service.createBackup()
assert.equal(artifact.manifest.domainRegistry.length, 6)
assert.equal(artifact.manifest.recordCounts['reader-session'], 7)
assert.equal(artifact.manifest.recordCounts['vocabulary-srs'], 1)
const outboxRecords = artifact.domains['reader-session'].records.filter((record) => record.id.startsWith('reader-save-outbox:'))
assert.equal(outboxRecords.length, 2)
assert.deepEqual(outboxRecords.map((record) => record.contentId), ['job-1', 'job-1'])
assert.deepEqual(new Set(outboxRecords.map((record) => record.revision)), new Set([2, 3]))

storage.setItem('vocabulary.passage-preview.future.v9', JSON.stringify({ schemaVersion: 'future.v9', revision: 1 }))
await assert.rejects(
  adapters['passage-preview'].collect(),
  (error) => error?.code === 'BACKUP_UNCLAIMED_LOCAL_STORAGE_KEY',
  'new durable localStorage keys must fail closed until they are registered',
)
storage.removeItem('vocabulary.passage-preview.future.v9')

const outboxV2Key = 'read-web.reader-save-outbox.v2.6a_6f_62_2d_31.activity.6f_70_65_72_61_74_69_6f_6e_2d_61_63_74_69_76_69_74_79_2d_31'
storage.setItem(outboxV2Key, '{truncated')
await assert.rejects(
  adapters['reader-session'].collect(),
  (error) => error?.code === 'BACKUP_READER_OUTBOX_CORRUPT',
  'malformed durable outbox entries must fail closed',
)
storage.setItem(outboxV2Key, JSON.stringify({ schemaVersion: 99, ...outboxActivity }))
await assert.rejects(
  adapters['reader-session'].collect(),
  (error) => error?.code === 'BACKUP_READER_OUTBOX_UNKNOWN_SCHEMA',
  'future durable outbox schemas must fail closed',
)
storage.setItem(outboxV2Key, JSON.stringify({ schemaVersion: 2, ...outboxActivity }))
storage.setItem('read-web.reader-save-outbox.v3', JSON.stringify({ schemaVersion: 3 }))
await assert.rejects(
  adapters['reader-session'].collect(),
  (error) => error?.code === 'BACKUP_READER_OUTBOX_UNKNOWN_SCHEMA',
  'unknown durable outbox namespaces must fail closed',
)
storage.removeItem('read-web.reader-save-outbox.v3')

const quarantineKey = 'read-web.reader-save-outbox-quarantine.v1.corrupt-1'
const quarantinedRawValue = JSON.stringify({ token: 'quarantine-secret' })
storage.setItem(quarantineKey, JSON.stringify({
  schemaVersion: 1,
  sourceKey: 'read-web.reader-save-outbox.v2.corrupt-1',
  detectedAt: '2026-08-14T00:00:00.000Z',
  reason: 'malformed-json',
  rawValue: quarantinedRawValue,
}))
await assert.rejects(
  adapters['reader-session'].collect(),
  (error) => error?.code === 'BACKUP_READER_OUTBOX_QUARANTINE_UNRECOVERABLE',
  'quarantined raw evidence must fail closed when no recovery protector is configured',
)
assert.equal(JSON.parse(storage.getItem(quarantineKey)).rawValue, quarantinedRawValue)
await assert.rejects(
  createReaderSaveOutboxQuarantineProtector().encrypt(quarantinedRawValue, {
    sourceKey: quarantineKey,
    detectedAt: '2026-08-14T00:00:00.000Z',
    reason: 'malformed-json',
  }),
  (error) => error?.code === 'BACKUP_READER_OUTBOX_QUARANTINE_KEY_REQUIRED',
  'a missing quarantine protector must fail closed without exposing raw evidence',
)
const quarantineProtector = createReaderSaveOutboxQuarantineProtector({ key: 'fixture-recovery-key', keyId: 'fixture-key-1' })
const freshQuarantineProtector = createReaderSaveOutboxQuarantineProtector({ key: 'fixture-recovery-key', keyId: 'fixture-key-1' })
const protectedAdapters = createReadWebApplicationBackupAdapters({
  ...options,
  readerSaveOutboxQuarantineProtector: quarantineProtector,
})
const protectedService = createReadWebApplicationBackupService({
  ...options,
  readerSaveOutboxQuarantineProtector: quarantineProtector,
})
const protectedArtifact = await protectedService.createBackup()
const quarantineRecord = protectedArtifact.domains['reader-session'].records.find((record) => record.id.startsWith('reader-save-outbox:quarantine:'))
assert.ok(quarantineRecord)
assert.equal(JSON.stringify(protectedArtifact).includes('quarantine-secret'), false)
assert.equal((await protectedService.verifyBackup(JSON.stringify(protectedArtifact))).valid, true)
assert.equal(await quarantineProtector.decrypt(quarantineRecord.payload.recovery), quarantinedRawValue)
assert.equal(await freshQuarantineProtector.decrypt(quarantineRecord.payload.recovery), quarantinedRawValue)
await assert.rejects(
  createReaderSaveOutboxQuarantineProtector({ key: 'wrong-recovery-key', keyId: 'fixture-key-1' }).decrypt(quarantineRecord.payload.recovery),
  (error) => error?.code === 'BACKUP_READER_OUTBOX_QUARANTINE_DECRYPT_FAILED',
)
await assert.rejects(
  createReaderSaveOutboxQuarantineProtector({ key: 'fixture-recovery-key', keyId: 'another-key' }).decrypt(quarantineRecord.payload.recovery),
  (error) => error?.code === 'BACKUP_READER_OUTBOX_QUARANTINE_KEY_MISMATCH',
)
for (const unsafeKeyId of ['../fixture-key', 'https://example.test/key', 'fixture/key', 'fixture\nkey', '']) {
  assert.throws(
    () => createReaderSaveOutboxQuarantineProtector({ key: 'fixture-recovery-key', keyId: unsafeKeyId }),
    (error) => error?.code === 'BACKUP_READER_OUTBOX_QUARANTINE_KEY_ID_INVALID',
  )
}
assert.throws(
  () => createReaderSaveOutboxQuarantineProtector({ key: 'fixture-recovery-key', keyId: 'x'.repeat(65) }),
  (error) => error?.code === 'BACKUP_READER_OUTBOX_QUARANTINE_KEY_ID_INVALID',
)
assert.equal(JSON.stringify(protectedArtifact).includes('rawValue'), false)
assert.equal(JSON.stringify(protectedArtifact).includes('fixture-recovery-key'), false)
assert.equal(JSON.stringify(protectedArtifact).includes('C:\\'), false)
assert.equal(JSON.stringify(protectedArtifact).includes('/home/'), false)
assert.equal((await protectedAdapters['reader-session'].collect()).records.length, 8)
storage.removeItem(quarantineKey)

assert.throws(
  () => createReadWebApplicationBackupService({
    applicationPersistence: { async getAllRows() { return rows } },
    storage,
  }),
  (error) => error?.code === 'BACKUP_ADAPTER_MISSING',
  'cross-process marks/activity and workflow adapters must be required explicitly',
)
assert.throws(
  () => createReadWebApplicationBackupService({
    applicationPersistence: { async getAllRows() { return rows } },
    marksActivityAdapter,
    workflowAdapter,
  }),
  (error) => error?.code === 'BACKUP_ADAPTER_MISSING',
  'a missing localStorage owner must fail closed instead of omitting the durable reader outbox',
)

await assert.rejects(
  createReadWebApplicationBackupService({
    ...options,
    applicationPersistence: { async getAllRows() { return [...rows, { id: 'future-domain-row', content: {} }] } },
  }).createBackup(),
  (error) => error?.code === 'BACKUP_UNCLAIMED_PERSISTENCE_ROW',
  'an unregistered IndexedDB row must fail closed instead of disappearing from the backup',
)
await assert.rejects(
  createReadWebApplicationBackupService({
    ...options,
    applicationPersistence: { async getAllRows() { return [...rows, { id: 'audio', content: { blob: 'not-exported' } }] } },
  }).createBackup(),
  (error) => error?.code === 'BACKUP_MEDIA_PAYLOAD_REJECTED',
  'the retired full-media IndexedDB row must remain rejected',
)

storage.setItem('vocabulary.passage-preview.durable-state.v1', JSON.stringify({
  schemaVersion: 'passage-preview.durable-state.v1',
  revision: 5,
  scope: { documentId: 42 },
}))
await assert.rejects(
  adapters['passage-preview'].collect(),
  /Invalid contentId/,
  'localStorage contentId semantics must be validated before export',
)

console.log('Application backup adapter checks passed.')

function simpleAdapter(key) {
  return {
    key,
    schemaVersion: 1,
    adapterVersion: 1,
    async collect() {
      return {
        schemaVersion: 1,
        revision: 1,
        records: [{
          id: `${key}:record`,
          schemaVersion: 1,
          revision: 1,
          contentId: `${key}:content`,
          payload: { state: key },
          references: [],
          mediaReferences: [],
        }],
      }
    },
  }
}
