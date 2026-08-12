import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8')
const retiredFiles = [
  'src/composables/reader-notes-runtime.js',
  'src/composables/reader-notes-session-runtime.js',
  'src/composables/reader-notes-session-runtime-deps.js',
  'src/composables/reader-session-runtime.js',
  'src/pinia-stores/notes.js',
  'src/stores/notes.js',
  'src/utils/sentence-notes-persistence.js',
]

for (const relative of retiredFiles) {
  assert.equal(fs.existsSync(path.join(root, relative)), false, `${relative} must stay retired`)
}

const sourceFiles = walk(path.join(root, 'src')).filter((file) => /\.(?:js|vue)$/.test(file))
const retiredSurfaces = [
  'loadChunkNotesForCurrentAudio',
  'loadSentenceNotesForCurrentAudio',
  'switchSentenceNotesDoc',
  'setChunkNoteVisible',
  'notesSessionRuntime',
  'chunkNotesApi',
  'sentenceNotesApi',
  'tryRestoreChunkNoteDraft',
]
for (const file of sourceFiles) {
  const source = fs.readFileSync(file, 'utf8')
  for (const surface of retiredSurfaces) {
    assert.equal(source.includes(surface), false, `${path.relative(root, file)} still consumes retired ${surface}`)
  }
}

const html = read('index.html')
for (const id of ['notes-file', 'btn-import-chunk-notes', 'btn-export-chunk-notes', 'hotkey-notes-input', 'hotkey-chunk-note-input']) {
  assert.equal(html.includes(id), false, `retired notes UI must stay absent: ${id}`)
}

const audioIdentity = read('src/composables/audio-identity-module.js')
const bootstrap = read('src/composables/reader-bootstrap-runtime.js')
const featureDeps = read('src/composables/reader-feature-runtime-deps.js')
const publicFacades = read('src/composables/reader-public-facades.js')
assert.match(audioIdentity, /function applyCurrentAudioMeta\(meta\)/)
assert.match(featureDeps, /applyCurrentAudioMeta: bootstrapRuntime\.audioIdentityApi\.applyCurrentAudioMeta/)
assert.match(publicFacades, /window\.applyCurrentAudioMeta = applyCurrentAudioMeta/)
assert.match(bootstrap, /bridgeToPinia: bridgeToPinia/)

console.log('retired notes drain check passed')

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name)
    return entry.isDirectory() ? walk(target) : [target]
  })
}
