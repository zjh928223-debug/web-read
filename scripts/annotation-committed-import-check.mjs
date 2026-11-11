import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

Error.stackTraceLimit = 0
globalThis.window = {}

const moduleUrl = (source) => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
const indexSource = (await readFile(new URL('../src/composables/session-annotation-generated-index.js', import.meta.url), 'utf8'))
  .replace(/^import .*best-effort.js';$/m, 'const recordBestEffortFailure = () => {}; const observeBestEffort = (p, o) => Promise.resolve(p).catch(() => o.fallback);')
const { createSessionAnnotationGeneratedIndexRuntime } = await import(moduleUrl(indexSource))
const store = await import(moduleUrl(await readFile(new URL('../src/services/annotation/result-store.js', import.meta.url), 'utf8')))
const ioSource = (await readFile(new URL('../src/composables/session-annotation-lightweight-io.js', import.meta.url), 'utf8'))
  .replace(/import\s+\{[\s\S]*?\}\s+from\s+'[^']+';/g, '')
const ioPrelude = `
const createObjectUrlDownloader = () => ({ dispose() {} });
const buildManualLightweightImportedBundle = async (parsed, scope) => ({
  generated: { schemaVersion: 1, ...scope, items: parsed.items },
  status: { schemaVersion: 1, ...scope, blocks: {} }, importedCount: parsed.items.length
});
`
const { createSessionAnnotationLightweightIoRuntime } = await import(moduleUrl(ioPrelude + ioSource))
const state = { currentAudioKey: 'youtube-workflow::text-article', markedMap: new Map() }
const namespace = { currentDocId: 'default-document' }
let committed = false
let loadCount = 0
let beforeCommit = () => {}
const storage = {
  async saveBundle(scope, generated, status) {
    await beforeCommit()
    committed = true
    return { generated, status, storageMode: 'host-managed', revision: 1 }
  },
  async loadBundle() {
    loadCount++
    // Reproduces the transient not-ready reader falling back to empty local data.
    assert.equal(committed, true)
    return { generated: { items: [] }, storageMode: 'localStorage-fallback' }
  },
}
const index = createSessionAnnotationGeneratedIndexRuntime({
  state, namespace, getWindow: () => ({}),
  consoleApi: { warn() {}, debug() {} },
  getAnnotationGenerationStorage: () => storage,
  getAnnotationGeneratedResultStore: () => store,
})
const identity = (v) => v
const io = createSessionAnnotationLightweightIoRuntime({
  state,
  normalizeAnnotationTextValue: identity,
  normalizeAnnotationSentenceValue: identity,
  getAnnotationTargetSentenceText: identity,
  buildSyntheticAnnotationTargetFromEncodedId: identity,
  buildAnnotationTargetCollection: () => [],
  getAnnotationGenerationStorage: () => storage,
  getAnnotationGenerationScope: index.getAnnotationGenerationScope,
  refreshGeneratedAnnotationIndexForCurrentDocument: index.refreshGeneratedAnnotationIndexForCurrentDocument,
  rebuildMarksFromAnnotationItems: async () => {},
  syncAnnotationGenerationEntryStatus: async () => {},
})
const file = { text: async () => JSON.stringify({ items: [{ targetId: 'word-1', markedText: 'article', meaning: '文章' }] }) }
await io.importManualLightweightAnnotations(file, { replaceExisting: false })
assert.equal(store.getItems().length, 1, 'committed explanation must appear without a second import')
assert.equal(store.getItems()[0].meaning, '文章')
assert.equal(loadCount, 0, 'do not reread a different storage backend after a successful commit')

// An older background read must not overwrite the newer committed index.
let finishOldRead
storage.loadBundle = () => new Promise((resolve) => { finishOldRead = resolve })
const oldRead = index.refreshGeneratedAnnotationIndexForCurrentDocument()
await io.importManualLightweightAnnotations(file, { replaceExisting: false })
finishOldRead({ generated: { items: [] } })
assert.equal((await oldRead).stale, true)
assert.equal(store.getItems().length, 1)

// A commit belonging to the previous article must not populate the new article.
beforeCommit = () => { state.currentAudioKey = 'youtube-workflow::other-article'; index.clearGeneratedAnnotationIndex() }
await io.importManualLightweightAnnotations(file, { replaceExisting: false })
assert.equal(store.getItems().length, 0)
assert.equal(state.annotationGeneratedIndexScopeKey, '')
console.log('annotation committed import check passed')
