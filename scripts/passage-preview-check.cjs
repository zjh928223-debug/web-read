const assert = require('node:assert/strict')
const fs = require('node:fs')
const fsPromises = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const projectRoot = path.resolve(__dirname, '..')
const fixturePath = path.join(__dirname, 'fixtures', 'passage-preview-result.fixture.json')

async function run() {
  const payload = JSON.parse(fs.readFileSync(fixturePath, 'utf8'))
  const importer = await importSource('src/features/passage-preview/passage-preview-import.js')
  const storageModule = await importSource('src/features/passage-preview/passage-preview-storage.js')
  const shortcutModule = await importSource('src/features/passage-preview/passage-preview-shortcuts.js')
  const pronunciation = await importSource('src/services/pronunciation/aria-american-pronunciation.js')
  const items = importer.importPassageOnePreview(payload)

  assert.deepEqual(items.map((item) => item.word), importer.PASSAGE_ONE_TARGET_WORDS)
  assert.equal(new Set(items.map((item) => item.word)).size, 5)
  assert.ok(items.every((item) => item.source.includes(importer.PASSAGE_ONE_SOURCE_MARKER)))
  assert.ok(items.every((item) => (
    item.pos
    && item.meaning
    && item.targetMeaningZh
    && item.focusPhraseEn
    && item.focusPhraseZh
    && item.focusChunks.some((chunk) => chunk.containsTarget)
    && item.paragraphChunks.some((chunk) => chunk.containsTarget)
  )))
  assert.equal(importer.validatePassagePreviewItems(items), true)

  verifyExactWordLock(importer, payload)
  verifyOptionalPrivateSource(importer)
  verifyNoReviewOrDictionaryCoupling()
  verifyProgressPersistence(storageModule, items)
  verifyIsolatedShortcuts(shortcutModule)
  await verifyStrictSystemAria(pronunciation)
  await verifyStrictLocalAriaFallback(pronunciation)
  await verifyNonAriaRejection(pronunciation)
  await verifyPendingVoiceCancellation(pronunciation)
  await verifyPendingFetchCancellation(pronunciation)
  await verifyActiveAudioCancellation(pronunciation)
  await verifyEdgeTtsService()

  console.log('Passage 1 preview focused verification passed.')
}

function verifyExactWordLock(importer, payload) {
  const duplicate = {
    ...payload.answers.find((answer) => answer.word === 'thorough'),
    source: 'duplicate-C19-T1-RP1-77',
    sentence: 'A second thorough entry must not become a sixth preview item.',
  }
  const deduplicated = importer.importPassageOnePreview({
    ...payload,
    answers: [duplicate, ...payload.answers],
  })
  assert.equal(deduplicated.length, 5)
  assert.equal(deduplicated.filter((item) => item.word === 'thorough').length, 1)

  const arbitraryFive = payload.answers
    .filter((answer) => answer.word !== 'enhance')
    .concat({
      word: 'replacement',
      form: 'replacement',
      pos: 'noun',
      meaning: 'substitute',
      zh: '替代物',
      sentence: 'An arbitrary replacement must not satisfy the pilot.',
      source: 'fixture-C19-T1-RP1-06',
    })
  assert.throws(
    () => importer.importPassageOnePreview({ ...payload, answers: arbitraryFive }),
    /enhance/,
  )
}

function verifyOptionalPrivateSource(importer) {
  const privatePath = process.env.PASSAGE_PREVIEW_RESULT_PATH
  if (!privatePath) return
  assert.ok(fs.existsSync(privatePath), `private vocabulary result is missing: ${privatePath}`)
  const privateItems = importer.importPassageOnePreview(
    JSON.parse(fs.readFileSync(privatePath, 'utf8')),
  )
  assert.deepEqual(privateItems.map((item) => item.word), importer.PASSAGE_ONE_TARGET_WORDS)

  const repositoryTextFiles = collectTextFiles([
    'src',
    'scripts',
    'openspec/changes/separate-vocabulary-acquisition-and-review',
    'package.json',
    'index.html',
    'styles.css',
  ])
  for (const filePath of repositoryTextFiles) {
    const relativePath = path.relative(projectRoot, filePath).replaceAll('\\', '/')
    const source = fs.readFileSync(filePath, 'utf8')
    for (const privateText of privateItems.flatMap((item) => [
      item.targetMeaningZh,
      item.focusPhraseEn,
      item.focusPhraseZh,
      ...item.focusChunks.flatMap((chunk) => [chunk.en, chunk.zh]),
      ...item.paragraphChunks.flatMap((chunk) => [chunk.en, chunk.zh]),
    ])) {
      assert.ok(
        !source.includes(privateText),
        `private sentence or phrase must not be embedded in repository source: ${relativePath}`,
      )
    }
  }
}

function verifyNoReviewOrDictionaryCoupling() {
  const importerSource = read('src/features/passage-preview/passage-preview-import.js')
  const componentSource = read('src/features/passage-preview/PassagePreviewPage.vue')
  const appSource = read('src/App.vue')
  assert.doesNotMatch(importerSource, /ReviewState|addWord|createInitialReviewState|indexedDB/i)
  assert.doesNotMatch(componentSource, /ECDICT|again|hard|good|easy|processChunkData|ChunkModeView/i)
  assert.match(componentSource, /v-if="!isRevealed"[\s\S]*显示学习内容/)
  assert.match(componentSource, /按住显示中文/)
  assert.match(componentSource, /查看完整语境/)
  assert.match(componentSource, /AI 美式朗读/)
  assert.match(componentSource, /watch\([\s\S]*speakWord\(\)/)
  assert.match(componentSource, /document\.visibilityState/)
  assert.match(componentSource, /progress\.status = 'completed'/)
  assert.match(componentSource, /progress\.completedAt = new Date\(\)\.toISOString\(\)/)
  assert.match(appSource, /今日复习[\s\S]*待预习/)
}

function verifyProgressPersistence(storageModule, items) {
  const memoryStorage = createMemoryStorage()
  storageModule.savePassagePreviewData(items, memoryStorage)
  assert.equal(storageModule.loadPassagePreviewData(memoryStorage).length, 5)
  const progress = {
    status: 'in_progress',
    currentIndex: 3,
    revealed: { [items[3].id]: true },
    contextExpanded: { [items[3].id]: true },
    startedAt: '2026-07-28T00:00:00.000Z',
    completedAt: null,
  }
  storageModule.savePassagePreviewProgress(progress, memoryStorage)
  assert.deepEqual(storageModule.loadPassagePreviewProgress(memoryStorage), progress)

  const legacyStorage = createMemoryStorage()
  legacyStorage.setItem(storageModule.LEGACY_PASSAGE_PREVIEW_DATA_KEY, JSON.stringify(items))
  legacyStorage.setItem(storageModule.LEGACY_PASSAGE_PREVIEW_PROGRESS_KEY, JSON.stringify({
    status: 'in_progress',
    currentIndex: 2,
    revealed: { [items[2].id]: true },
    sentenceExpanded: { [items[2].id]: true },
  }))
  assert.equal(storageModule.hasLegacyPassagePreviewData(legacyStorage), true)
  assert.deepEqual(storageModule.loadPassagePreviewData(legacyStorage), [])
  storageModule.savePassagePreviewData(items, legacyStorage)
  const migrated = storageModule.loadPassagePreviewProgress(legacyStorage)
  assert.equal(migrated.currentIndex, 2)
  assert.equal(migrated.contextExpanded[items[2].id], true)
}

function verifyIsolatedShortcuts(shortcutModule) {
  const storage = createMemoryStorage()
  storage.setItem('st.chunkCnKey', 'x')
  assert.deepEqual(shortcutModule.loadPassagePreviewShortcuts(storage), {
    translation: 'x',
    context: 'v',
  })
  shortcutModule.savePassagePreviewShortcut('translation', 'z', storage)
  assert.equal(storage.getItem('st.chunkCnKey'), 'x')
  assert.equal(shortcutModule.loadPassagePreviewShortcuts(storage).translation, 'z')
  assert.equal(shortcutModule.isEditableKeyboardTarget({ tagName: 'INPUT' }), true)
  assert.equal(shortcutModule.shortcutFromKeyboardEvent({ key: 'Z' }), 'z')
}

async function verifyStrictSystemAria(pronunciation) {
  const exactVoice = { name: pronunciation.REQUIRED_ARIA_SYSTEM_VOICE, lang: 'en-US' }
  const synthesis = {
    spoken: [],
    getVoices: () => [{ name: 'Microsoft Jenny Online (Natural) - English (United States)' }, exactVoice],
    cancel() {},
    speak(utterance) {
      this.spoken.push(utterance)
      queueMicrotask(() => utterance.onend())
    },
  }
  function Utterance(text) {
    this.text = text
  }
  const service = pronunciation.createAriaAmericanPronunciationService({
    windowObject: { speechSynthesis: synthesis, SpeechSynthesisUtterance: Utterance },
    fetchImpl: async () => assert.fail('fallback must not run when exact system Aria exists'),
  })
  const result = await service.speak('example')
  assert.equal(result.source, 'system')
  assert.equal(synthesis.spoken[0].voice, exactVoice)
}

async function verifyStrictLocalAriaFallback(pronunciation) {
  const requests = []
  let playedUrl = ''
  const service = pronunciation.createAriaAmericanPronunciationService({
    windowObject: {
      location: { origin: 'http://127.0.0.1:5198' },
      speechSynthesis: { getVoices: () => [], cancel() {} },
      SpeechSynthesisUtterance() {},
    },
    fetchImpl: async (url, options) => {
      requests.push({ url, options })
      return {
        ok: true,
        async json() {
          return {
            voice: pronunciation.REQUIRED_ARIA_EDGE_VOICE,
            audioUrl: `/api/tts/edge/audio/${'a'.repeat(64)}.mp3`,
          }
        },
      }
    },
    audioFactory(url) {
      playedUrl = url
      return { async play() {}, pause() {}, currentTime: 0 }
    },
  })
  const result = await service.speak('example')
  assert.equal(result.source, 'local-tts')
  assert.equal(requests[0].url, 'http://127.0.0.1:5198/api/tts/edge')
  assert.match(playedUrl, /\/api\/tts\/edge\/audio\/a{64}\.mp3$/)
}

async function verifyNonAriaRejection(pronunciation) {
  assert.equal(
    pronunciation.findRequiredAriaSystemVoice([
      { name: 'Microsoft Jenny Online (Natural) - English (United States)' },
      { name: 'Google US English' },
    ]),
    null,
  )
  const service = pronunciation.createAriaAmericanPronunciationService({
    windowObject: {
      speechSynthesis: { getVoices: () => [], cancel() {} },
      SpeechSynthesisUtterance() {},
    },
    fetchImpl: async () => ({
      ok: true,
      async json() {
        return {
          voice: 'en-US-AvaNeural',
          audioUrl: `/api/tts/edge/audio/${'b'.repeat(64)}.mp3`,
        }
      },
    }),
  })
  await assert.rejects(service.speak('example'), /Aria美式发音暂不可用/)
}

async function verifyPendingVoiceCancellation(pronunciation) {
  let voicesChanged
  let fetchCount = 0
  const synthesis = {
    getVoices: () => [],
    cancel() {},
    addEventListener(_name, listener) {
      voicesChanged = listener
    },
    removeEventListener() {},
  }
  const service = pronunciation.createAriaAmericanPronunciationService({
    windowObject: { speechSynthesis: synthesis, SpeechSynthesisUtterance() {} },
    fetchImpl: async () => {
      fetchCount += 1
      return { ok: false }
    },
    voiceWaitMs: 10_000,
  })
  const pending = service.speak('old word')
  service.stop()
  await assert.rejects(pending, { name: 'AbortError' })
  voicesChanged?.()
  assert.equal(fetchCount, 0)
}

async function verifyPendingFetchCancellation(pronunciation) {
  let playCount = 0
  let fetchStarted
  const started = new Promise((resolve) => {
    fetchStarted = resolve
  })
  const service = pronunciation.createAriaAmericanPronunciationService({
    windowObject: {
      speechSynthesis: { getVoices: () => [], cancel() {} },
      SpeechSynthesisUtterance() {},
    },
    fetchImpl: (_url, options) => new Promise((_resolve, reject) => {
      fetchStarted()
      options.signal.addEventListener('abort', () => reject(
        Object.assign(new Error('aborted'), { name: 'AbortError' }),
      ), { once: true })
    }),
    audioFactory() {
      playCount += 1
      return { async play() {} }
    },
  })
  const pending = service.speak('old word')
  await started
  service.stop()
  await assert.rejects(pending, { name: 'AbortError' })
  assert.equal(playCount, 0)
}

async function verifyActiveAudioCancellation(pronunciation) {
  const listeners = new Map()
  let pauseCount = 0
  let playbackStarted
  const started = new Promise((resolve) => {
    playbackStarted = resolve
  })
  const audio = {
    currentTime: 9,
    async play() {
      playbackStarted()
    },
    pause() {
      pauseCount += 1
    },
    addEventListener(name, listener) {
      listeners.set(name, listener)
    },
    removeEventListener(name) {
      listeners.delete(name)
    },
  }
  const service = pronunciation.createAriaAmericanPronunciationService({
    windowObject: {
      speechSynthesis: { getVoices: () => [], cancel() {} },
      SpeechSynthesisUtterance() {},
    },
    voiceWaitMs: 0,
    fetchImpl: async () => ({
      ok: true,
      async json() {
        return {
          voice: pronunciation.REQUIRED_ARIA_EDGE_VOICE,
          audioUrl: `/api/tts/edge/audio/${'c'.repeat(64)}.mp3`,
        }
      },
    }),
    audioFactory: () => audio,
  })
  const pending = service.speak('active playback')
  await started
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(listeners.has('ended'), true, 'local Aria completion should remain pending until audio ends')
  service.stop()
  await assert.rejects(pending, { name: 'AbortError' })
  assert.equal(pauseCount, 1)
  assert.equal(audio.currentTime, 0)
}

async function verifyEdgeTtsService() {
  const pluginModule = await import(pathToFileURL(
    path.join(projectRoot, 'src/services/pronunciation/aria-edge-tts-vite-plugin.mjs'),
  ))
  const cacheDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'read-web-aria-test-'))
  try {
    let synthesisCount = 0
    const service = pluginModule.createAriaEdgeTtsService({
      cacheDir,
      async synthesizeToFile(text, outputPath) {
        synthesisCount += 1
        await fsPromises.writeFile(outputPath, Buffer.from(`fake-mp3:${text}`))
      },
    })
    const [first, second] = await Promise.all([
      service.synthesize('thorough'),
      service.synthesize('thorough'),
    ])
    assert.equal(first.voice, pluginModule.ARIA_EDGE_VOICE)
    assert.deepEqual(second, first)
    assert.equal(synthesisCount, 1)
    const audioId = first.audioUrl.match(/[a-f0-9]{64}/)[0]
    assert.ok((await service.readAudio(audioId)).length > 0)
  } finally {
    await fsPromises.rm(cacheDir, { recursive: true, force: true })
  }
}

async function importSource(relativePath) {
  const source = read(relativePath)
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)
}

function read(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), 'utf8')
}

function createMemoryStorage() {
  const entries = new Map()
  return {
    getItem: (key) => entries.has(key) ? entries.get(key) : null,
    setItem: (key, value) => entries.set(key, String(value)),
  }
}

function collectTextFiles(entries) {
  const files = []
  for (const entry of entries) {
    const absolute = path.join(projectRoot, entry)
    if (!fs.existsSync(absolute)) continue
    const stat = fs.statSync(absolute)
    if (stat.isFile()) {
      files.push(absolute)
      continue
    }
    for (const child of fs.readdirSync(absolute, { withFileTypes: true })) {
      if (child.name === 'verification' || child.name.startsWith('.')) continue
      files.push(...collectTextFiles([path.relative(projectRoot, path.join(absolute, child.name))]))
    }
  }
  return files.filter((filePath) => /\.(?:c?js|mjs|vue|css|md|html|json)$/i.test(filePath))
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
