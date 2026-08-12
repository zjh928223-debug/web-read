const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

async function main() {
  const root = path.resolve(__dirname, '..')
  const modulePath = path.join(root, 'src/composables/audio-identity-module.js')
  const bootstrapPath = path.join(root, 'src/composables/reader-bootstrap-runtime.js')
  const featureDepsPath = path.join(root, 'src/composables/reader-feature-runtime-deps.js')
  const facadePath = path.join(root, 'src/composables/reader-public-facades.js')
  const source = fs.readFileSync(modulePath, 'utf8')
  const bootstrap = fs.readFileSync(bootstrapPath, 'utf8')
  const featureDeps = fs.readFileSync(featureDepsPath, 'utf8')
  const facades = fs.readFileSync(facadePath, 'utf8')

  assert.match(source, /export function initAudioIdentity/)
  assert.match(source, /function applyCurrentAudioMeta\(meta\)/)
  assert.match(source, /function buildCurrentSentenceDocId\(transcriptSource = null\)/)
  assert.match(bootstrap, /var audioIdentityApi = initAudioIdentity\(\{/)
  assert.match(featureDeps, /applyCurrentAudioMeta: bootstrapRuntime\.audioIdentityApi\.applyCurrentAudioMeta/)
  assert.match(facades, /window\.applyCurrentAudioMeta = applyCurrentAudioMeta/)
  assert.equal(featureDeps.includes('notesSessionRuntime'), false)

  const encoded = Buffer.from(source, 'utf8').toString('base64')
  const { initAudioIdentity } = await import(`data:text/javascript;base64,${encoded}#${Date.now()}`)
  const changes = []
  const fallbackSegments = [{ text: 'fallback transcript' }]
  const api = initAudioIdentity({
    buildAudioKey(meta) {
      return meta && meta.name ? `audio::${meta.name}` : 'default-audio'
    },
    buildCurrentAudioMetaState(meta, buildAudioKey) {
      return {
        currentAudioMeta: meta ? { ...meta, normalized: true } : null,
        currentAudioKey: buildAudioKey(meta),
        chunkNoteDraftRestoreDone: false,
      }
    },
    getCurrentAudioFilenameBase(meta, fallback) {
      return meta && meta.name ? meta.name.replace(/\.[^.]+$/, '') : fallback
    },
    buildCurrentSentenceDocId(transcriptSource, audioKey, segments) {
      return `${audioKey}::${transcriptSource ? transcriptSource.id : segments[0].text}`
    },
    getSegments() { return fallbackSegments },
    onCurrentAudioMetaChange(meta) { changes.push(meta) },
  })

  assert.equal(api.currentAudioKey, 'default-audio')
  assert.equal(api.currentAudioMeta, null)
  const next = api.applyCurrentAudioMeta({ name: 'lesson-one.mp3', size: 10 })
  assert.deepEqual(next, {
    currentAudioMeta: { name: 'lesson-one.mp3', size: 10, normalized: true },
    currentAudioKey: 'audio::lesson-one.mp3',
    chunkNoteDraftRestoreDone: false,
  })
  assert.deepEqual(api.currentAudioMeta, { name: 'lesson-one.mp3', size: 10, normalized: true })
  assert.equal(api.currentAudioKey, 'audio::lesson-one.mp3')
  assert.equal(api.getCurrentAudioFilenameBase('fallback'), 'lesson-one')
  assert.equal(api.buildCurrentSentenceDocId({ id: 'transcript-a' }), 'audio::lesson-one.mp3::transcript-a')
  assert.equal(changes.length, 1)
  assert.deepEqual(changes[0], api.currentAudioMeta)

  api.setCurrentAudioMeta({ name: 'manual.wav' })
  api.setCurrentAudioKey('manual-key')
  assert.deepEqual(api.currentAudioMeta, { name: 'manual.wav' })
  assert.equal(api.currentAudioKey, 'manual-key')
  assert.equal(api.getCurrentAudioFilenameBase('fallback'), 'manual')
  assert.equal(api.buildCurrentSentenceDocId(), 'manual-key::fallback transcript')
  assert.equal(changes.length, 2)

  api.setCurrentAudioMeta(null)
  api.setCurrentAudioKey('')
  assert.equal(api.currentAudioMeta, null)
  assert.equal(api.currentAudioKey, 'default-audio')
  assert.equal(api.getCurrentAudioFilenameBase('fallback'), 'fallback')

  console.log('audio identity module check passed')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
