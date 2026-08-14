import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const inventoryPath = path.join(root, 'docs', 'architecture', 'legacy-deletion-inventory.json')
const inventory = JSON.parse(fs.readFileSync(inventoryPath, 'utf8'))

assert.equal(inventory.schemaVersion, 1)
assert.equal(inventory.change, 'stabilize-and-simplify-read-web')
assert.equal(inventory.task, '10.6')
assert.ok(Array.isArray(inventory.entries) && inventory.entries.length > 0)

const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8')
const exists = (relativePath) => fs.existsSync(path.join(root, relativePath))
const source = (relativePath) => read(relativePath)

const rootArtifacts = [
  'annotation-bubble.js',
  'annotation-api-settings-ui.js',
  'chunk-note-layout-core.js',
  'chunk-note-layout-helpers.js'
]
for (const relativePath of rootArtifacts) {
  assert.equal(exists(relativePath), false, `${relativePath} must be deleted after the root copy migration`)
}

const index = read('index.html')
const vite = read('vite.config.js')
const packageJson = read('package.json')
for (const artifact of rootArtifacts) {
  assert.equal(index.includes(`<script src="${artifact}"></script>`), false, `index.html must not load ${artifact}`)
  assert.equal(vite.includes(artifact), false, `vite.config.js must not copy ${artifact}`)
  assert.equal(packageJson.includes(artifact), false, `package scripts must not reference ${artifact}`)
}

const currentSourceFiles = [
  'src/App.vue',
  'src/main.js',
  'src/components/TranscriptContainer.vue',
  'src/components/ChunkModeView.vue',
  'src/composables/reader-runtime.js',
  'src/composables/transcript-state.js',
  'src/pinia-stores/transcript.js',
  'src/pinia-stores/chunk.js',
  'src/composables/chunk-interactions.js',
  'styles.css'
]
const currentSource = currentSourceFiles.map((relativePath) => [relativePath, read(relativePath)])
for (const [relativePath, text] of currentSource) {
  assert.equal(text.includes('__USE_VUE_RENDERING'), false, `${relativePath} still consumes retired __USE_VUE_RENDERING`)
  assert.equal(text.includes('__chunkNoteLayout'), false, `${relativePath} still consumes retired __chunkNoteLayout`)
}

assert.equal(source('src/pinia-stores/transcript.js').includes('useVueRendering'), false)
assert.equal(source('src/composables/transcript-state.js').includes('useVueRendering'), false)
assert.equal(source('src/pinia-stores/chunk.js').includes('chunkNoteVisible'), false)
assert.equal(source('src/components/TranscriptContainer.vue').includes('v-if="ts.useVueRendering"'), false)
assert.equal(source('src/components/ChunkModeView.vue').includes('v-if="ts.useVueRendering"'), false)
assert.equal(source('styles.css').includes('annotation-api-settings-'), false)
assert.match(source('src/main.js'), /oldContainer\.style\.display\s*=\s*['"]none['"]|oldContainer\.hidden\s*=\s*true/)

assert.match(source('src/main.js'), /import ['"]\.\/composables\/annotation-bubble\.js['"]|import ['"]\.\/composables\/annotation-bubble\.js['"];/)
assert.match(source('src/composables/annotation-bubble-resolver.js'), /from ['"]\.\/annotation-bubble\.js['"];/)
assert.match(source('src/components/ChunkModeView.vue'), /if \(chunk && chunk\.noteId\)/)
assert.match(source('src/components/ChunkModeView.vue'), /'seg-' \+ segId/)

const currentDocs = [
  'AGENTS.md',
  'README.md',
  'PROJECT_MAP.md',
  'CURRENT_PROJECT_STATUS.md',
  'docs/architecture/SCRIPT_INVENTORY.md'
].map((relativePath) => [relativePath, read(relativePath)])
for (const [relativePath, text] of currentDocs) {
  assert.equal(text.includes('src/composables/annotation-api-settings-ui.js'), false, `${relativePath} has a stale annotation settings owner`)
  assert.equal(text.includes('Root `annotation-*.js` and `chunk-note-layout-*.js`'), false, `${relativePath} has a stale root artifact inventory`)
  assert.equal(text.includes('root annotation/chunk-note 原型文件'), false, `${relativePath} has a stale root artifact retirement note`)
}

const map = read('docs/architecture/compatibility-consumer-map.json')
assert.equal(map.includes('__USE_VUE_RENDERING'), false, 'compatibility consumer map must not retain the deleted rendering flag')
assert.equal(map.includes('__chunkNoteLayout'), false, 'compatibility consumer map must not retain the deleted chunk-note global')

const retainedKeys = source('src/utils/identity-storage-keys.js')
assert.match(retainedKeys, /function getChunkNotesStorageKey|export function getChunkNotesStorageKey/)
assert.match(retainedKeys, /function getChunkNoteDraftStorageKey|export function getChunkNoteDraftStorageKey/)

const deleteEntries = inventory.entries.filter((entry) => entry.deletionDecision === 'delete')
assert.ok(deleteEntries.length >= 8)
for (const entry of deleteEntries) {
  assert.ok(entry.rationale && entry.replacementBehaviorTests?.length, `${entry.candidate} needs rationale and behavior evidence`)
  assert.deepEqual(entry.blockers, [], `${entry.candidate} has an unresolved deletion blocker`)
}
const retainedEntries = inventory.entries.filter((entry) => entry.deletionDecision === 'retain')
assert.ok(retainedEntries.some((entry) => entry.candidate.includes('getChunkNotesStorageKey')))

console.log(`legacy deletion gate passed (${deleteEntries.length} deletions, ${retainedEntries.length} retained compatibility entries)`)
