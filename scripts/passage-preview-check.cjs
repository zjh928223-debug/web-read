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
  const importer = await importPassagePreviewImporter()
  const storageModule = await importSource('src/features/passage-preview/passage-preview-storage.js')
  const pronunciation = await importSource('src/services/pronunciation/aria-american-pronunciation.js')
  const items = importer.importPassageOnePreview(payload)

  assert.equal(items.length, 6, 'generic preview should keep words outside the former five-word pilot')
  assert.equal(new Set(items.map((item) => item.word)).size, 6)
  assert.ok(items.every((item) => (
    item.primaryMeaningZh
    && item.primarySenseStatus
    && item.targetSenseKey
    && !item.focusChunks
    && !item.paragraphChunks
  )))
  assert.equal(importer.validatePassagePreviewItems(items), true)

  verifyGenericBatch(importer)
  verifyNoReviewOrDictionaryCoupling()
  verifyProgressPersistence(storageModule, items)
  await verifyRealSentenceSelection()
  await verifyRealSentenceEndpoint()
  await verifyStrictSystemAria(pronunciation)
  await verifyStrictLocalAriaFallback(pronunciation)
  await verifyNonAriaRejection(pronunciation)
  await verifyPendingVoiceCancellation(pronunciation)
  await verifyPendingFetchCancellation(pronunciation)
  await verifyActiveAudioCancellation(pronunciation)
  await verifyEdgeTtsService()

  console.log('First-contact vocabulary preview focused verification passed.')
}

function verifyGenericBatch(importer) {
  const items = importer.importVocabularyPreview({
    title: '通用批次',
    answers: Array.from({ length: 50 }, (_, index) => ({
      word: `word${index}`,
      zh: index === 0 ? '怀疑，觉察，嫌疑' : `释义${index}`,
      source: `batch-${index}`,
    })),
  })
  assert.equal(items.length, 50)
  assert.equal(items[0].primaryMeaningZh, '怀疑')
  assert.equal(items[0].primarySenseStatus, 'suggested')
  assert.equal(items[0].batchTitle, '通用批次')
}

function verifyNoReviewOrDictionaryCoupling() {
  const importerSource = read('src/features/passage-preview/passage-preview-import.js')
  const componentSource = read('src/features/passage-preview/PassagePreviewPage.vue')
  const appSource = read('src/App.vue')
  assert.doesNotMatch(importerSource, /ReviewState|addWord|createInitialReviewState|indexedDB/i)
  assert.doesNotMatch(componentSource, /ECDICT|again|hard|good|easy|processChunkData|ChunkModeView/i)
  assert.match(componentSource, /v-if="!isRevealed"[\s\S]*看看这个词怎么用/)
  assert.match(componentSource, /简短真实语境/)
  assert.match(componentSource, /不会用 AI 现编句或剑雅长段落自动代替/)
  assert.doesNotMatch(componentSource, /完整语境|focusChunks|paragraphChunks/)
  assert.match(componentSource, /watch\([\s\S]*speakWord\(\)/)
  assert.match(componentSource, /progress\.status = 'completed'/)
  assert.match(componentSource, /progress\.completedAt = new Date\(\)\.toISOString\(\)/)
  assert.match(appSource, /今日复习[\s\S]*待预习/)
  const sourceAdapter = read('src/features/passage-preview/tatoeba-preview-sentence.js')
  assert.match(sourceAdapter, /rankSentenceCandidates/)
  assert.match(sourceAdapter, /target_sense_match/)
  assert.match(sourceAdapter, /CC BY 2\.0 FR/)
}

function verifyProgressPersistence(storageModule, items) {
  const memoryStorage = createMemoryStorage()
  storageModule.savePassagePreviewData(items, memoryStorage)
  assert.equal(storageModule.loadPassagePreviewData(memoryStorage).length, 6)
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
  storageModule.savePassagePreviewProgress({ ...progress, currentIndex: 49 }, memoryStorage)
  assert.equal(storageModule.loadPassagePreviewProgress(memoryStorage).currentIndex, 49)

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

async function verifyRealSentenceSelection() {
  const adapter = await importTatoebaPreviewAdapter()
  const result = await adapter.findRealPreviewSentence({
    lemma: 'suspicion',
    primaryMeaningZh: '怀疑',
    targetSenseKey: 'suspicion:n:01',
  }, {
    fetchImpl: async () => ({
      ok: true,
      async json() {
        return {
          items: [{
            id: '12576498',
            sentence: 'I have a suspicion.',
            translationZh: '我有一点怀疑。',
            owner: 'fixture-author',
            license: 'CC BY 2.0 FR',
            url: 'https://tatoeba.org/en/sentences/show/12576498',
          }, {
            id: '2',
            sentence: 'Suspicion can spread.',
            translationZh: '消息会传播。',
            owner: 'fixture-author',
            license: 'CC BY 2.0 FR',
            url: 'https://tatoeba.org/en/sentences/show/2',
          }],
        }
      },
    }),
  })
  assert.equal(result.status, adapter.REAL_SENTENCE_STATUS.READY)
  assert.equal(result.sentence, 'I have a suspicion.')
  assert.equal(result.source.recordId, '12576498')
  assert.equal(result.source.license, 'CC BY 2.0 FR')
  assert.equal(adapter.hasMeaningOverlap('怀疑，嫌疑', '我的怀疑没有根据。'), true)
  assert.equal(adapter.hasMeaningOverlap('河岸', '我去了银行。'), false)
}

async function verifyRealSentenceEndpoint() {
  const plugin = await import(pathToFileURL(path.join(
    projectRoot,
    'src/services/vocabulary/tatoeba-sentence-vite-plugin.mjs',
  )))
  const upstreamUrls = []
  const response = createJsonResponse()
  await plugin.handleTatoebaSentenceRequest(
    { method: 'GET', url: `${plugin.TATOEBA_SENTENCE_ENDPOINT}?word=suspicion&limit=2` },
    response,
    () => assert.fail('real sentence endpoint should handle the request'),
    {
      fetchImpl: async (url) => {
        upstreamUrls.push(String(url))
        return {
          ok: true,
          async json() {
            return {
              data: [{
                id: 1,
                text: 'I have a suspicion.',
                lang: 'eng',
                license: 'CC BY 2.0 FR',
                owner: 'fixture-author',
                is_unapproved: false,
                translations: [{
                  id: 11,
                  text: '我有一点怀疑。',
                  lang: 'cmn',
                  script: 'Hans',
                  license: 'CC BY 2.0 FR',
                  owner: 'fixture-translator',
                  is_unapproved: false,
                  is_direct: true,
                }],
              }],
            }
          },
        }
      },
    },
  )
  assert.equal(response.statusCode, 200)
  assert.equal(response.json.items[0].id, '1')
  assert.equal(response.json.items[0].translationZh, '我有一点怀疑。')
  assert.match(upstreamUrls[0], /api\.tatoeba\.org/)
  assert.match(upstreamUrls[0], /trans%3Alang=cmn/)
}

async function importSource(relativePath) {
  const source = read(relativePath)
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)
}

async function importPassagePreviewImporter() {
  const tempDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'read-web-preview-importer-'))
  const policySource = read('src/services/vocabulary/personalization/primary-sense-policy.js')
  const importerSource = read('src/features/passage-preview/passage-preview-import.js')
    .replace('../../services/vocabulary/personalization/primary-sense-policy.js', './primary-sense-policy.mjs')
  const policyPath = path.join(tempDir, 'primary-sense-policy.mjs')
  const importerPath = path.join(tempDir, 'passage-preview-import.mjs')
  await fsPromises.writeFile(policyPath, policySource, 'utf8')
  await fsPromises.writeFile(importerPath, importerSource, 'utf8')
  return import(`${pathToFileURL(importerPath).href}?v=${Date.now()}`)
}

async function importTatoebaPreviewAdapter() {
  const tempDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'read-web-preview-sentence-'))
  const rankingSource = read('src/services/vocabulary/personalization/sentence-candidate-ranking.js')
  const adapterSource = read('src/features/passage-preview/tatoeba-preview-sentence.js')
    .replace('../../services/vocabulary/personalization/sentence-candidate-ranking.js', './sentence-candidate-ranking.mjs')
  const rankingPath = path.join(tempDir, 'sentence-candidate-ranking.mjs')
  const adapterPath = path.join(tempDir, 'tatoeba-preview-sentence.mjs')
  await fsPromises.writeFile(rankingPath, rankingSource, 'utf8')
  await fsPromises.writeFile(adapterPath, adapterSource, 'utf8')
  return import(`${pathToFileURL(adapterPath).href}?v=${Date.now()}`)
}

function createJsonResponse() {
  return {
    statusCode: 0,
    headers: {},
    setHeader(name, value) { this.headers[name] = value },
    end(value) { this.json = JSON.parse(value) },
  }
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
