import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

class FakeStorage {
  constructor(entries = {}) {
    this.entries = new Map(Object.entries(entries))
    this.writeCount = 0
  }

  get length() {
    return this.entries.size
  }

  key(index) {
    return [...this.entries.keys()][index] ?? null
  }

  getItem(key) {
    return this.entries.has(key) ? this.entries.get(key) : null
  }

  setItem() {
    this.writeCount += 1
    throw new Error('compatibility bridge must never write localStorage')
  }
}

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const bridgePath = path.join(repositoryRoot, 'src', 'services', 'windows-owner-legacy-compatibility-bridge.js')
const apiContract = JSON.parse(await readFile(
  path.join(repositoryRoot, 'docs', 'architecture', 'windows-local-owner-thin-reader', 'api-contract.json'),
  'utf8',
))
const domainInventory = JSON.parse(await readFile(
  path.join(repositoryRoot, 'docs', 'architecture', 'windows-local-owner-thin-reader', 'domain-inventory.json'),
  'utf8',
))
const ownerRegistry = JSON.parse(await readFile(
  path.join(repositoryRoot, 'docs', 'architecture', 'windows-local-owner-thin-reader', 'owner-registry.json'),
  'utf8',
))
const bridgeSource = await readFile(bridgePath, 'utf8')
const imported = await import(toDataUrl(bridgeSource
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
  )))

const {
  WINDOWS_OWNER_LEGACY_BRIDGE_METHODS,
  WindowsOwnerLegacyBridgeError,
  createWindowsOwnerLegacyCompatibilityBridge,
} = imported

assert.deepEqual(WINDOWS_OWNER_LEGACY_BRIDGE_METHODS, [
  'inventory',
  'prepareImport',
  'readRollbackWindow',
])

const storage = new FakeStorage({
  'vocabulary.passage-preview.data.v2': JSON.stringify([{ id: 'preview-1', text: 'hello' }]),
  'vocabulary.passage-preview.shortcut.translation.v1': 'translation preference',
  'vocabulary.passage-preview.future.v9': 'secret-value-must-not-escape',
  'vocabulary.passage-preview.progress.v2': '{truncated',
})
let persistenceReads = 0
let persistenceWrites = 0
const persistenceRows = [
  {
    id: 'audioMeta',
    revision: 2,
    content: { schemaVersion: 1, contentId: 'content-1', mediaIdentity: { id: 'audio-1', size: 12 } },
  },
  {
    id: 'audio',
    schemaVersion: 'legacy-media-row.unversioned',
    content: { mediaBytes: 'media-bytes-must-not-escape' },
  },
  {
    id: 'unclaimed-row',
    content: { apiKey: 'secret-value-must-not-escape' },
  },
  {
    id: 'history.json',
    schemaVersion: '99',
    content: { schemaVersion: 99, jobs: [] },
  },
]
const persistence = {
  async getAllRows() {
    persistenceReads += 1
    return persistenceRows
  },
  async put() {
    persistenceWrites += 1
  },
}
const jsonFixture = {
  kind: 'json',
  sourceId: 'workflow-fixture',
  read: async () => ({
    records: [{
      key: 'jobs.json',
      schemaVersion: '1',
      revision: 3,
      payload: { schemaVersion: 1, jobs: [] },
    }],
  }),
}
const blockedBridge = createWindowsOwnerLegacyCompatibilityBridge({
  profileId: 'optimization',
  applicationPersistence: persistence,
  storage,
  jsonSources: [jsonFixture],
})
const blockedInventory = await blockedBridge.inventory()
assert.equal(blockedInventory.status, 'blocked')
assert.equal(blockedInventory.frozenIndexedDbSchema.databaseName, 'SeekPlayerDB')
assert.equal(blockedInventory.frozenIndexedDbSchema.version, 1)
assert.equal(blockedInventory.frozenIndexedDbSchema.objectStore, 'files')
assert.equal(blockedInventory.frozenIndexedDbSchema.keyPath, 'id')
assert.ok(blockedInventory.records.some((record) => record.reasonCode === 'legacy-media-payload'))
assert.ok(blockedInventory.records.some((record) => record.reasonCode === 'legacy-unclaimed-record'))
assert.ok(blockedInventory.records.some((record) => record.reasonCode === 'legacy-record-corrupt'))
assert.ok(blockedInventory.records.some((record) => record.reasonCode === 'legacy-unsupported-schema'))
assert.ok(blockedInventory.records.some((record) => record.recordKey === 'jobs.json' && record.domain === 'workflow'))
assert.equal(JSON.stringify(blockedInventory).includes('media-bytes-must-not-escape'), false)
assert.equal(JSON.stringify(blockedInventory).includes('secret-value-must-not-escape'), false)
assert.ok(persistenceReads > 0)
assert.equal(persistenceWrites, 0)
assert.equal(storage.writeCount, 0)

const validRows = [
  {
    id: 'audioMeta',
    revision: 'rev-a',
    content: { schemaVersion: 1, contentId: 'content-1', mediaIdentity: { id: 'audio-1', size: 12 } },
  },
  {
    id: 'readerSession',
    revision: 'rev-a',
    content: { schemaVersion: 1, contentId: 'content-1', state: 'ready' },
  },
]
const validStorage = new FakeStorage({
  'vocabulary.passage-preview.data.v2': JSON.stringify([{ id: 'preview-1', text: 'hello' }]),
  'vocabulary.passage-preview.shortcut.translation.v1': 'translation preference',
})
const validPersistence = {
  async getAllRows() {
    return validRows
  },
}
const hostCommitCalls = []
const validBridge = createWindowsOwnerLegacyCompatibilityBridge({
  profileId: 'optimization',
  applicationPersistence: validPersistence,
  storage: validStorage,
  sources: [{
    kind: 'json',
    sourceId: 'host-commit-probe',
    commit: () => hostCommitCalls.push('must-not-run'),
    read: async () => ({ records: [
      {
        key: '_workflow/reader-marks.json',
        schemaVersion: 'reader-marks.v1',
        revision: 4,
        payload: { schemaVersion: 'reader-marks.v1', marks: [] },
      },
      {
        key: 'vocabulary.srs.store.v1',
        schemaVersion: '1',
        revision: 4,
        payload: { schemaVersion: 1, entries: [] },
      },
      {
        key: 'AnnotationGenerationStorage::audio-1::doc-1::annotation.bundle.v2.json',
        schemaVersion: 'annotation-bundle.v2',
        revision: 4,
        payload: { schemaVersion: 'annotation-bundle.v2', items: [] },
      },
    ] }),
  }],
  backupAdapters: {
    workflow: {
      schemaVersion: 1,
      collect: async () => ({ records: [{
        key: 'jobs.json',
        schemaVersion: '1',
        revision: 4,
        payload: { schemaVersion: 1, jobs: [{ id: 'job-1', status: 'queued' }] },
      }] }),
      restoreRecords: async () => { throw new Error('restore must not be called') },
    },
  },
})
const firstInventory = await validBridge.inventory()
const secondInventory = await validBridge.inventory()
assert.equal(firstInventory.status, 'ready')
assert.deepEqual(firstInventory, secondInventory)
assert.match(firstInventory.checksum, /^sha256:[a-f0-9]{64}$/u)
assert.deepEqual([...new Set(firstInventory.sources.map((source) => source.sourceKind))], ['indexeddb', 'localStorage', 'json'])
assert.deepEqual(
  [...new Set(firstInventory.records.filter((record) => record.status === 'ready').map((record) => record.domain))].sort(),
  ['annotation', 'marks-activity', 'passage-preview', 'reader-session', 'vocabulary-srs', 'workflow'],
)
assert.equal(firstInventory.records.some((record) => record.recordKey === 'vocabulary.passage-preview.shortcut.translation.v1' && record.classification === 'non-canonical'), true)
assert.ok(!JSON.stringify(firstInventory).includes('translation preference'))

const firstPlan = await validBridge.prepareImport()
const secondPlan = await validBridge.prepareImport()
assert.equal(firstPlan.status, 'ready')
assert.deepEqual(firstPlan, secondPlan)
assert.match(firstPlan.importIdentity, /^sha256:[a-f0-9]{64}$/u)
assert.ok(firstPlan.importInput)
assert.equal(firstPlan.importInput.mode, 'legacy-import-input')
assert.ok(firstPlan.importInput.records.some((record) => record.recordKey === 'audioMeta'))
assert.ok(firstPlan.importInput.records.some((record) => record.recordKey === 'jobs.json'))
assert.ok(firstPlan.excludedRecords.some((record) => record.recordKey === 'vocabulary.passage-preview.shortcut.translation.v1'))
assert.ok(!JSON.stringify(firstPlan).includes('must-not-run'))
assert.equal(JSON.stringify(firstPlan).includes('mediaBytes'), false)
assert.equal(JSON.stringify(firstPlan).includes('secret'), false)
assert.deepEqual(hostCommitCalls, [])

const rollbackRead = await validBridge.readRollbackWindow({
  sourceId: 'SeekPlayerDB/files',
  domain: 'reader-session',
  recordKey: 'audioMeta',
})
assert.equal(rollbackRead.mode, 'rollback-window-read')
assert.equal(rollbackRead.source.sourceKind, 'indexeddb')
assert.equal(rollbackRead.domain, 'reader-session')
assert.equal(rollbackRead.recordKey, 'audioMeta')
assert.notEqual(rollbackRead.payload, validRows[0].content)
assert.throws(() => { rollbackRead.payload.contentId = 'changed' }, TypeError)
const rollbackReadAgain = await validBridge.readRollbackWindow({
  sourceId: 'SeekPlayerDB/files',
  domain: 'reader-session',
  recordKey: 'audioMeta',
})
assert.equal(rollbackReadAgain.payload.contentId, 'content-1')
await assert.rejects(
  validBridge.readRollbackWindow({
    sourceId: 'SeekPlayerDB/files',
    domain: 'workflow',
    recordKey: 'audioMeta',
  }),
  (error) => error instanceof WindowsOwnerLegacyBridgeError && error.code === 'legacy-domain-mismatch',
)

const noSources = createWindowsOwnerLegacyCompatibilityBridge({ profileId: 'optimization' })
assert.deepEqual(Object.keys(noSources).sort(), [...WINDOWS_OWNER_LEGACY_BRIDGE_METHODS].sort())
for (const forbiddenMethod of ['put', 'setItem', 'deleteItem', 'removeItem', 'clear', 'replace', 'restore', 'commit']) {
  assert.equal(forbiddenMethod in noSources, false, `bridge must not expose ${forbiddenMethod}`)
}
const noSourcesInventory = await noSources.inventory()
assert.equal(noSourcesInventory.status, 'blocked')
assert.equal(noSourcesInventory.reasonCode, 'legacy-source-unavailable')
const corruptSourceBridge = createWindowsOwnerLegacyCompatibilityBridge({
  sources: [{ kind: 'json', sourceId: 'broken-fixture', read: async () => { throw new Error('private path must not escape') } }],
})
const corruptSourceInventory = await corruptSourceBridge.inventory()
assert.equal(corruptSourceInventory.status, 'blocked')
assert.equal(corruptSourceInventory.reasonCode, 'legacy-source-read-failed')
assert.equal(JSON.stringify(corruptSourceInventory).includes('private path must not escape'), false)
assert.throws(
  () => createWindowsOwnerLegacyCompatibilityBridge({
    sources: [{ kind: 'json', sourceId: 'unsafe-fixture', path: 'C:\\private\\profile.json', read: async () => ({ records: [] }) }],
  }),
  (error) => error instanceof WindowsOwnerLegacyBridgeError && error.code === 'legacy-source-handle-exposed',
)

console.log('windows owner legacy compatibility bridge checks passed')

function toDataUrl(source) {
  return `data:text/javascript;base64,${Buffer.from(source, 'utf8').toString('base64')}`
}
