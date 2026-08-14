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
} = await import(runtimeUrl)

class MapStorage {
  constructor(initial = {}) { this.values = new Map(Object.entries(initial)) }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null }
  setItem(key, value) { this.values.set(key, String(value)) }
  removeItem(key) { this.values.delete(key) }
  key(index) { return [...this.values.keys()][index] ?? null }
  get length() { return this.values.size }
}

const storage = new MapStorage({
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
assert.equal(artifact.manifest.recordCounts['reader-session'], 5)
assert.equal(artifact.manifest.recordCounts['vocabulary-srs'], 1)

storage.setItem('vocabulary.passage-preview.future.v9', JSON.stringify({ schemaVersion: 'future.v9', revision: 1 }))
await assert.rejects(
  adapters['passage-preview'].collect(),
  (error) => error?.code === 'BACKUP_UNCLAIMED_LOCAL_STORAGE_KEY',
  'new durable localStorage keys must fail closed until they are registered',
)
storage.removeItem('vocabulary.passage-preview.future.v9')

assert.throws(
  () => createReadWebApplicationBackupService({
    applicationPersistence: { async getAllRows() { return rows } },
    storage,
  }),
  (error) => error?.code === 'BACKUP_ADAPTER_MISSING',
  'cross-process marks/activity and workflow adapters must be required explicitly',
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
