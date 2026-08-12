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
  await importSource('src/features/passage-preview/passage-preview-shortcuts.js')
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
  await verifySentenceSourceRegistry()
  await verifyRealSentenceSelection()
  await verifyRealSentenceEndpoint()
  await verifyWordnikSentenceEndpoint()
  await verifyStrictSystemAria(pronunciation)
  await verifySystemAriaFailureFallsBackToLocal(pronunciation)
  await verifyStrictLocalAriaFallback(pronunciation)
  await verifyAriaPrefetchCache(pronunciation)
  await verifyManualPlaybackPreemptsBackgroundPrefetch(pronunciation)
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

  const [automatic] = importer.importVocabularyPreview({
    title: '词性优先',
    answers: [{
      word: 'automatic',
      pos: 'adjective',
      translation: 'n. 自动手枪, 自动机械\na. 自动的, 机械的, 必然的, 无意识的',
    }],
  })
  assert.equal(automatic.primaryMeaningZh, '自动的', 'an adjective must not inherit the first noun gloss')
}

function verifyNoReviewOrDictionaryCoupling() {
  const importerSource = read('src/features/passage-preview/passage-preview-import.js')
  const componentSource = read('src/features/passage-preview/PassagePreviewPage.vue')
  const appSource = read('src/App.vue')
  assert.doesNotMatch(importerSource, /ReviewState|addWord|createInitialReviewState|indexedDB/i)
  assert.doesNotMatch(componentSource, /ECDICT|again|hard|good|easy|processChunkData|ChunkModeView/i)
  assert.match(componentSource, /v-if="!isRevealed"[\s\S]*看看这个词怎么用/)
  assert.match(componentSource, /validatedStoredSentence\(current\.value\)/)
  assert.match(componentSource, /realSentence\.value\?\.matchedForm/)
  assert.match(componentSource, /\(\?<\!\[A-Za-z\]\)\(\$\{word\}\)\(\?!\[A-Za-z\]\)/)
  assert.match(componentSource, /wordLengthClass/)
  assert.match(componentSource, /role="switch"/)
  assert.match(componentSource, /handleShortcutKeyup/)
  assert.match(componentSource, /handlePreviewWindowBlur/)
  assert.match(componentSource, /handlePreviewVisibilityChange/)
  assert.match(componentSource, /简短真实语境/)
  assert.match(componentSource, /真实短句不可用时，会尝试生成一条经过规则校验的 AI 辅助例句/)
  assert.doesNotMatch(componentSource, /剑雅原句已退出首次接触|复习模型安排原文迁移/)
  assert.doesNotMatch(read('src/features/passage-preview/passage-preview.css'), /passage-preview-later-note/)
  assert.doesNotMatch(componentSource, /完整语境|focusChunks|paragraphChunks/)
  assert.match(componentSource, /watch\([\s\S]*speakWord\(\)/)
  assert.match(componentSource, /progress\.status = 'completed'/)
  assert.match(componentSource, /progress\.completedAt = new Date\(\)\.toISOString\(\)/)
  assert.match(appSource, /今日复习[\s\S]*待预习/)
  const sourceAdapter = read('src/features/passage-preview/tatoeba-preview-sentence.js')
  const sourceComposition = read('src/features/passage-preview/preview-sentence-source.js')
  const wordnikPort = read('src/services/vocabulary/personalization/wordnik-sentence-source.js')
  const wordnikAdapter = read('src/features/passage-preview/wordnik-preview-sentence.js')
  const merriamWebsterPort = read('src/services/vocabulary/personalization/merriam-webster-sentence-source.js')
  const merriamWebsterAdapter = read('src/features/passage-preview/merriam-webster-preview-sentence.js')
  assert.match(sourceAdapter, /rankSentenceCandidates/)
  assert.match(sourceAdapter, /target_sense_match/)
  assert.match(sourceAdapter, /CC BY 2\.0 FR/)
  assert.match(componentSource, /from '\.\/preview-sentence-source\.js'/)
  assert.doesNotMatch(componentSource, /from '\.\/tatoeba-preview-sentence\.js'/)
  assert.match(sourceComposition, /createWordnikSentenceSourceProvider/)
  assert.match(sourceComposition, /createMerriamWebsterSentenceSourceProvider/)
  assert.match(sourceComposition, /findLocalWarehousePreviewSentence/)
  assert.doesNotMatch(componentSource, /暂无整句中文翻译|真实出版摘句来源|本地词典例句来源/)
  assert.doesNotMatch(wordnikPort, /\bfetch\b|localStorage|indexedDB|repository|api\.wordnik\.com/i)
  assert.match(wordnikAdapter, /WORDNIK_PREVIEW_ENDPOINT/)
  assert.doesNotMatch(wordnikAdapter, /localStorage|indexedDB|savePassagePreviewData/i)
  assert.doesNotMatch(merriamWebsterPort, /\bfetch\b|localStorage|indexedDB|repository|dictionaryapi\.com/i)
  assert.match(merriamWebsterAdapter, /MERRIAM_WEBSTER_PREVIEW_ENDPOINT/)
  assert.doesNotMatch(merriamWebsterAdapter, /localStorage|indexedDB|savePassagePreviewData/i)
  assert.match(componentSource, /result\.persistence !== 'none'/)
  assert.doesNotMatch(componentSource, /Powered by Wordnik|passage-preview-attribution|passage-preview-wordnik-badge/)
  assert.match(componentSource, /brandingRequired/)
  assert.match(componentSource, /width="50"/)
  assert.match(componentSource, /translateSentenceBatches/)
  assert.match(componentSource, /passagePreviewActionForKeyboardEvent/)
  assert.match(componentSource, /action === 'revealContent'/)
  assert.match(componentSource, /passage-preview-header-meta/)
  assert.match(componentSource, /window\.addEventListener\('keydown', handleShortcutKeydown, true\)/)
  assert.match(componentSource, /sentenceTranslationVisible/)
  assert.match(componentSource, /快捷键设置/)
  const previewCss = read('src/features/passage-preview/passage-preview.css')
  assert.match(previewCss, /text-decoration-line:\s*underline/)
  assert.match(previewCss, /background:\s*transparent/)
  assert.match(previewCss, /font-size:\s*clamp\(21px,\s*1\.8vw,\s*28px\)/)
  assert.match(previewCss, /\.passage-preview-shortcut-open[\s\S]*border:\s*0[\s\S]*opacity:\s*\.46/)
  assert.match(previewCss, /\.passage-preview-shortcut-open[\s\S]*display:\s*inline-flex/)
  assert.match(previewCss, /\.passage-preview-shortcut-open[\s\S]*align-items:\s*center/)
  assert.match(previewCss, /\.passage-preview-shortcut-open[\s\S]*justify-content:\s*center/)
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

async function verifySystemAriaFailureFallsBackToLocal(pronunciation) {
  let playedUrl = ''
  const exactVoice = { name: pronunciation.REQUIRED_ARIA_SYSTEM_VOICE, lang: 'en-US' }
  const synthesis = {
    getVoices: () => [exactVoice],
    cancel() {},
    speak(utterance) {
      queueMicrotask(() => utterance.onerror?.())
    },
  }
  const service = pronunciation.createAriaAmericanPronunciationService({
    windowObject: {
      location: { origin: 'http://127.0.0.1:5198' },
      speechSynthesis: synthesis,
      SpeechSynthesisUtterance() {},
    },
    fetchImpl: async () => ({
      ok: true,
      async json() {
        return {
          voice: pronunciation.REQUIRED_ARIA_EDGE_VOICE,
          audioUrl: `/api/tts/edge/audio/${'d'.repeat(64)}.mp3`,
        }
      },
    }),
    audioFactory(url) {
      playedUrl = url
      return { async play() {} }
    },
  })
  const result = await service.speak('sentence fallback')
  assert.equal(result.source, 'local-tts')
  assert.match(playedUrl, /\/api\/tts\/edge\/audio\/d{64}\.mp3$/)
}

async function verifyAriaPrefetchCache(pronunciation) {
  const requests = []
  let audioFactoryCount = 0
  let playCount = 0
  const service = pronunciation.createAriaAmericanPronunciationService({
    windowObject: {
      location: { origin: 'http://127.0.0.1:5198' },
      speechSynthesis: { getVoices: () => [], cancel() {} },
      SpeechSynthesisUtterance() {},
    },
    fetchImpl: async (_url, options) => {
      const text = JSON.parse(options.body).text
      requests.push(text)
      return {
        ok: true,
        async json() {
          return {
            voice: pronunciation.REQUIRED_ARIA_EDGE_VOICE,
            audioUrl: `/api/tts/edge/audio/${text === 'first word' ? 'e'.repeat(64) : 'f'.repeat(64)}.mp3`,
          }
        },
      }
    },
    audioFactory() {
      audioFactoryCount += 1
      return {
        async play() {
          playCount += 1
        },
      }
    },
  })
  const result = await service.prefetch(['first word', 'first word', 'second word'])
  assert.equal(result.prefetched, 2)
  assert.deepEqual(requests.sort(), ['first word', 'second word'])
  await service.speak('first word')
  assert.equal(requests.length, 2, 'manual playback should reuse warmed TTS audio')
  assert.equal(audioFactoryCount, 2, 'warm-up should create one audio object per unique text')
  assert.equal(playCount, 1)
}

async function verifyManualPlaybackPreemptsBackgroundPrefetch(pronunciation) {
  let fetchCount = 0
  let firstFetchStarted
  let firstFetchAborted = false
  let playCount = 0
  const firstStarted = new Promise((resolve) => {
    firstFetchStarted = resolve
  })
  const service = pronunciation.createAriaAmericanPronunciationService({
    windowObject: {
      location: { origin: 'http://127.0.0.1:5198' },
      speechSynthesis: { getVoices: () => [], cancel() {} },
      SpeechSynthesisUtterance() {},
    },
    fetchImpl: (_url, options) => {
      fetchCount += 1
      if (fetchCount === 1) {
        firstFetchStarted()
        return new Promise((resolve, reject) => {
          const abort = () => {
            firstFetchAborted = true
            reject(Object.assign(new Error('background fetch aborted'), { name: 'AbortError' }))
          }
          options.signal?.addEventListener('abort', abort, { once: true })
          setTimeout(() => reject(new Error('background fetch timeout')), 500)
        })
      }
      return Promise.resolve({
        ok: true,
        async json() {
          return {
            voice: pronunciation.REQUIRED_ARIA_EDGE_VOICE,
            audioUrl: `/api/tts/edge/audio/${'a'.repeat(64)}.mp3`,
          }
        },
      })
    },
    audioFactory() {
      return {
        async play() {
          playCount += 1
        },
      }
    },
  })
  const background = service.prefetch(['priority word'])
  await firstStarted
  const result = await Promise.race([
    service.speak('priority word'),
    new Promise((_, reject) => setTimeout(() => reject(new Error('manual playback waited for background prefetch')), 250)),
  ])
  assert.equal(result.source, 'local-tts')
  assert.equal(firstFetchAborted, true)
  assert.equal(fetchCount, 2)
  assert.equal(playCount, 1)
  await Promise.race([background, new Promise((resolve) => setTimeout(resolve, 20))])
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

async function verifySentenceSourceRegistry() {
  const modules = await importPreviewSentenceSources()
  const defaults = modules.composition.listPreviewSentenceSources()
  assert.deepEqual(defaults.map(({ id, enabled }) => ({ id, enabled })), [
    { id: 'merriam-webster', enabled: true },
    { id: 'local-warehouse', enabled: true },
    { id: 'tatoeba', enabled: true },
    { id: 'wordnik', enabled: true },
  ])

  let disabledWordnikCalls = 0
  const disabledRegistry = modules.composition.createPreviewSentenceSourceRegistry({
    localWarehouseResolver: async () => ({ status: 'unavailable', message: 'fixture miss' }),
    tatoebaResolver: async () => ({ status: 'unavailable', message: 'fixture miss' }),
    merriamWebster: { enabled: false },
    wordnik: {
      enabled: false,
      resolver: async () => {
        disabledWordnikCalls += 1
        return { status: 'ready' }
      },
    },
  })
  const unavailable = await disabledRegistry.findPreviewSentence({ word: 'example' })
  assert.equal(unavailable.status, 'unavailable')
  assert.equal(disabledWordnikCalls, 0, 'disabled Wordnik port must remain inert')

  const exhaustedRegistry = modules.composition.createPreviewSentenceSourceRegistry({
    localWarehouseResolver: async () => ({ status: 'unavailable', message: '本地例句仓库尚未构建' }),
    tatoebaResolver: async () => ({ status: 'unavailable', message: '暂未找到与主要义匹配的合格真实短句' }),
    merriamWebster: {
      enabled: true,
      resolver: async () => ({ status: 'unavailable', message: 'Merriam-Webster 暂无合格短句。' }),
    },
    wordnik: {
      enabled: true,
      resolver: async () => ({ status: 'unavailable', message: 'Wordnik API Key 尚未配置。' }),
    },
  })
  const exhausted = await exhaustedRegistry.findPreviewSentence({ word: 'example' })
  assert.equal(exhausted.status, 'unavailable')
  assert.deepEqual(exhausted.sourceAttempts.map(({ providerId, status }) => ({ providerId, status })), [
    { providerId: 'merriam-webster', status: 'unavailable' },
    { providerId: 'local-warehouse', status: 'unavailable' },
    { providerId: 'tatoeba', status: 'unavailable' },
    { providerId: 'wordnik', status: 'unavailable' },
  ])
  assert.match(exhausted.message, /Tatoeba：暂未找到与主要义匹配的合格真实短句/)
  assert.match(exhausted.message, /本地例句仓库：尚未构建/)
  assert.match(exhausted.message, /Merriam-Webster：暂无合格短句/)
  assert.match(exhausted.message, /Wordnik：API Key 尚未配置/)

  const enabledRegistry = modules.composition.createPreviewSentenceSourceRegistry({
    localWarehouseResolver: async () => ({ status: 'unavailable', message: 'fixture miss' }),
    tatoebaResolver: async () => ({ status: 'unavailable', message: 'fixture miss' }),
    merriamWebster: { enabled: false },
    wordnik: {
      enabled: true,
      resolver: async () => ({
        status: 'ready',
        sentence: 'This is a Wordnik fixture.',
        translationZh: 'fixture',
        source: { name: 'Wordnik', recordId: 'fixture', license: 'fixture', url: '#' },
      }),
    },
  })
  const selected = await enabledRegistry.findPreviewSentence({ word: 'fixture' })
  assert.equal(selected.providerId, 'wordnik')
  assert.equal(selected.persistence, 'none')
  assert.equal(selected.sentence, 'This is a Wordnik fixture.')

  let downstreamCalls = 0
  const localFirstRegistry = modules.composition.createPreviewSentenceSourceRegistry({
    localWarehouseResolver: async () => ({
      status: 'ready',
      sentence: 'The park is a wildlife sanctuary.',
      matchedLemma: 'sanctuary',
      source: { name: 'Longman', recordId: 'fixture', license: 'local', url: '#' },
    }),
    merriamWebster: { enabled: true, priority: 75, resolver: async () => { downstreamCalls += 1; return { status: 'ready' } } },
    tatoebaResolver: async () => { downstreamCalls += 1; return { status: 'ready' } },
    wordnik: { enabled: true, resolver: async () => { downstreamCalls += 1; return { status: 'ready' } } },
  })
  const localSelected = await localFirstRegistry.findPreviewSentence({ word: 'sanctuaries' })
  assert.equal(localSelected.providerId, 'local-warehouse')
  assert.equal(localSelected.persistence, 'local-preview')
  assert.equal(downstreamCalls, 0, 'a local hit must not call online providers')

  const automatic = await modules.localAdapter.findLocalWarehousePreviewSentence({
    word: 'automatic',
    lemma: 'automatic',
    pos: 'adjective',
    primaryMeaningZh: '自动手枪',
  }, {
    fetchImpl: async () => ({
      ok: true,
      async json() {
        return {
          available: true,
          primarySense: {
            lemma: 'automatic',
            partOfSpeech: 'adjective',
            definitionEn: '(of a device or process) working by itself with little or no direct human control',
            meaningZh: '自动的',
            source: { name: 'New Oxford English-Chinese Dictionary' },
          },
          items: [{
            lemma: 'automatic', sentence: 'The gun is an automatic pistol.',
            senseGloss: 'a gun that continues firing', partOfSpeech: 'noun', senseOrder: 1, wordCount: 6,
            source: { name: 'fixture', type: 'dictionary_example', recordId: 'noun', license: 'fixture', url: '#' },
          }, {
            lemma: 'automatic', sentence: 'The heating system is fully automatic.',
            senseGloss: 'a machine or device that works by itself without direct human control',
            partOfSpeech: 'adjective', senseOrder: 2, wordCount: 6,
            source: { name: 'fixture', type: 'dictionary_example', recordId: 'primary-adjective', license: 'fixture', url: '#' },
          }, {
            lemma: 'automatic', sentence: 'His response was almost automatic.',
            senseGloss: 'done without thinking because it is familiar',
            partOfSpeech: 'adjective', senseOrder: 4, wordCount: 5,
            source: { name: 'fixture', type: 'dictionary_example', recordId: 'secondary-adjective', license: 'fixture', url: '#' },
          }],
        }
      },
    }),
  })
  assert.equal(automatic.status, 'ready')
  assert.equal(automatic.sentence, 'The heating system is fully automatic.')
  assert.equal(automatic.primaryMeaningZh, '自动的')
  assert.equal(automatic.primaryPartOfSpeech, 'adjective')

  let fetchCount = 0
  const direct = await modules.wordnikAdapter.findWordnikPreviewSentence({
    word: 'suspicion',
    primaryMeaningZh: '怀疑',
    targetSenseKey: 'suspicion:n:01',
  }, {
    fetchImpl: async () => {
      fetchCount += 1
      return {
        ok: true,
        async json() {
          return {
            items: [{
              id: '77',
              sentence: 'Her suspicion grew.',
              providerName: 'fixture-provider',
              wordUrl: 'https://www.wordnik.com/words/suspicion',
            }],
          }
        },
      }
    },
  })
  assert.equal(direct.status, 'ready')
  assert.equal(direct.translationZh, '')
  assert.equal(direct.source.name, 'Wordnik')
  assert.match(direct.source.url, /wordnik\.com\/words\/suspicion/)
  assert.match(direct.source.poweredByLogoUrl, /wordnik_badge_a2\.png$/)
  await modules.wordnikAdapter.findWordnikPreviewSentence({
    word: 'suspicion',
    primaryMeaningZh: '怀疑',
    targetSenseKey: 'suspicion:n:01',
  }, { fetchImpl: async () => assert.fail('formatted Wordnik result should use session memory') })
  assert.equal(fetchCount, 1)
  modules.wordnikAdapter.clearWordnikPreviewSessionCache()

  assert.throws(() => modules.registry.createSentenceSourceRegistry({
    providers: [
      { id: 'duplicate', enabled: true, findPreviewSentence: async () => ({ status: 'unavailable' }) },
      { id: 'duplicate', enabled: true, findPreviewSentence: async () => ({ status: 'unavailable' }) },
    ],
  }), /Duplicate sentence source provider/)
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

async function verifyWordnikSentenceEndpoint() {
  const plugin = await import(pathToFileURL(path.join(
    projectRoot,
    'src/services/vocabulary/wordnik-sentence-vite-plugin.mjs',
  )))

  let fetchCount = 0
  const missingKeyResponse = createJsonResponse()
  await plugin.handleWordnikSentenceRequest(
    { method: 'GET', url: `${plugin.WORDNIK_SENTENCE_ENDPOINT}?word=suspicion` },
    missingKeyResponse,
    () => assert.fail('Wordnik endpoint should handle the request'),
    { fetchImpl: async () => { fetchCount += 1 } },
  )
  assert.equal(missingKeyResponse.statusCode, 503)
  assert.equal(missingKeyResponse.json.code, 'WORDNIK_NOT_CONFIGURED')
  assert.equal(fetchCount, 0)

  let currentTime = 1_000_000
  const budget = plugin.createWordnikHourlyBudget({ limit: 1, now: () => currentTime })
  const response = createJsonResponse()
  let upstreamUrl = ''
  let upstreamApiKey = ''
  await plugin.handleWordnikSentenceRequest(
    { method: 'GET', url: `${plugin.WORDNIK_SENTENCE_ENDPOINT}?word=suspicion&limit=2` },
    response,
    () => assert.fail('Wordnik endpoint should handle the request'),
    {
      apiKey: 'fixture-secret',
      budget,
      fetchImpl: async (url, options) => {
        fetchCount += 1
        upstreamUrl = String(url)
        upstreamApiKey = options.headers.api_key
        return {
          ok: true,
          status: 200,
          headers: { get: (name) => ({
            'x-ratelimit-remaining-hour': '99',
            'x-ratelimit-remaining-minute': '4',
          })[name] || null },
          async json() {
            return {
              examples: [{
                exampleId: 77,
                text: 'Her suspicion grew.',
                title: 'Fixture title',
                provider: { name: 'Fixture provider' },
                url: 'https://example.test/original',
              }],
            }
          },
        }
      },
    },
  )
  assert.equal(response.statusCode, 200)
  assert.equal(response.headers['cache-control'], 'no-store')
  assert.equal(response.json.items[0].id, '77')
  assert.equal(response.json.items[0].sentence, 'Her suspicion grew.')
  assert.equal(response.json.remainingHour, 99)
  assert.equal(response.json.remainingMinute, 4)
  assert.match(upstreamUrl, /api\.wordnik\.com\/v4\/word\.json\/suspicion\/examples/)
  assert.doesNotMatch(upstreamUrl, /fixture-secret/)
  assert.equal(upstreamApiKey, 'fixture-secret')

  const limitedResponse = createJsonResponse()
  await plugin.handleWordnikSentenceRequest(
    { method: 'GET', url: `${plugin.WORDNIK_SENTENCE_ENDPOINT}?word=example` },
    limitedResponse,
    () => assert.fail('Wordnik endpoint should handle the request'),
    { apiKey: 'fixture-secret', budget, fetchImpl: async () => { fetchCount += 1 } },
  )
  assert.equal(limitedResponse.statusCode, 429)
  assert.equal(limitedResponse.json.code, 'WORDNIK_LOCAL_BUDGET_EXHAUSTED')
  assert.equal(fetchCount, 1)
  currentTime += 60 * 60 * 1000 + 1
  assert.equal(budget.tryTake(), true, 'local budget should reopen after the rolling hour')
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
  const registrySource = read('src/services/vocabulary/personalization/sentence-source-registry.js')
  const adapterSource = read('src/features/passage-preview/tatoeba-preview-sentence.js')
    .replace('../../services/vocabulary/personalization/sentence-candidate-ranking.js', './sentence-candidate-ranking.mjs')
    .replace('../../services/vocabulary/personalization/sentence-source-registry.js', './sentence-source-registry.mjs')
  const rankingPath = path.join(tempDir, 'sentence-candidate-ranking.mjs')
  const registryPath = path.join(tempDir, 'sentence-source-registry.mjs')
  const adapterPath = path.join(tempDir, 'tatoeba-preview-sentence.mjs')
  await fsPromises.writeFile(rankingPath, rankingSource, 'utf8')
  await fsPromises.writeFile(registryPath, registrySource, 'utf8')
  await fsPromises.writeFile(adapterPath, adapterSource, 'utf8')
  return import(`${pathToFileURL(adapterPath).href}?v=${Date.now()}`)
}

async function importPreviewSentenceSources() {
  const tempDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'read-web-sentence-sources-'))
  const registryPath = path.join(tempDir, 'sentence-source-registry.mjs')
  const wordnikPath = path.join(tempDir, 'wordnik-sentence-source.mjs')
  const merriamWebsterPath = path.join(tempDir, 'merriam-webster-sentence-source.mjs')
  const rankingPath = path.join(tempDir, 'sentence-candidate-ranking.mjs')
  const tatoebaPath = path.join(tempDir, 'tatoeba-preview-sentence.mjs')
  const wordnikAdapterPath = path.join(tempDir, 'wordnik-preview-sentence.mjs')
  const merriamWebsterAdapterPath = path.join(tempDir, 'merriam-webster-preview-sentence.mjs')
  const localAdapterPath = path.join(tempDir, 'local-warehouse-preview-sentence.mjs')
  const morphologyPath = path.join(tempDir, 'english-inflection-match.mjs')
  const targetValidationPath = path.join(tempDir, 'preview-sentence-target-validation.mjs')
  const compositionPath = path.join(tempDir, 'preview-sentence-source.mjs')

  await fsPromises.writeFile(registryPath, read('src/services/vocabulary/personalization/sentence-source-registry.js'), 'utf8')
  await fsPromises.writeFile(wordnikPath, read('src/services/vocabulary/personalization/wordnik-sentence-source.js')
    .replace('./sentence-source-registry.js', './sentence-source-registry.mjs'), 'utf8')
  await fsPromises.writeFile(merriamWebsterPath, read('src/services/vocabulary/personalization/merriam-webster-sentence-source.js')
    .replace('./sentence-source-registry.js', './sentence-source-registry.mjs'), 'utf8')
  await fsPromises.writeFile(rankingPath, read('src/services/vocabulary/personalization/sentence-candidate-ranking.js'), 'utf8')
  await fsPromises.writeFile(tatoebaPath, read('src/features/passage-preview/tatoeba-preview-sentence.js')
    .replace('../../services/vocabulary/personalization/sentence-candidate-ranking.js', './sentence-candidate-ranking.mjs')
    .replace('../../services/vocabulary/personalization/sentence-source-registry.js', './sentence-source-registry.mjs'), 'utf8')
  await fsPromises.writeFile(wordnikAdapterPath, read('src/features/passage-preview/wordnik-preview-sentence.js')
    .replace('../../services/vocabulary/personalization/sentence-candidate-ranking.js', './sentence-candidate-ranking.mjs')
    .replace('../../services/vocabulary/personalization/sentence-source-registry.js', './sentence-source-registry.mjs'), 'utf8')
  await fsPromises.writeFile(merriamWebsterAdapterPath, read('src/features/passage-preview/merriam-webster-preview-sentence.js')
    .replace('../../services/vocabulary/personalization/sentence-candidate-ranking.js', './sentence-candidate-ranking.mjs')
    .replace('../../services/vocabulary/personalization/sentence-source-registry.js', './sentence-source-registry.mjs'), 'utf8')
  await fsPromises.writeFile(morphologyPath, read('src/services/vocabulary/english-inflection-match.mjs'), 'utf8')
  await fsPromises.writeFile(targetValidationPath, read('src/features/passage-preview/preview-sentence-target-validation.mjs')
    .replace('../../services/vocabulary/english-inflection-match.mjs', './english-inflection-match.mjs'), 'utf8')
  await fsPromises.writeFile(localAdapterPath, read('src/features/passage-preview/local-warehouse-preview-sentence.js')
    .replace('../../services/vocabulary/personalization/sentence-source-registry.js', './sentence-source-registry.mjs')
    .replace('../../services/vocabulary/english-inflection-match.mjs', './english-inflection-match.mjs'), 'utf8')
  await fsPromises.writeFile(compositionPath, read('src/features/passage-preview/preview-sentence-source.js')
    .replace('../../services/vocabulary/personalization/sentence-source-registry.js', './sentence-source-registry.mjs')
    .replace('../../services/vocabulary/personalization/wordnik-sentence-source.js', './wordnik-sentence-source.mjs')
    .replace('../../services/vocabulary/personalization/merriam-webster-sentence-source.js', './merriam-webster-sentence-source.mjs')
    .replace('./tatoeba-preview-sentence.js', './tatoeba-preview-sentence.mjs')
    .replace('./wordnik-preview-sentence.js', './wordnik-preview-sentence.mjs')
    .replace('./merriam-webster-preview-sentence.js', './merriam-webster-preview-sentence.mjs')
    .replace('./local-warehouse-preview-sentence.js', './local-warehouse-preview-sentence.mjs'), 'utf8')

  return {
    composition: await import(`${pathToFileURL(compositionPath).href}?v=${Date.now()}`),
    registry: await import(`${pathToFileURL(registryPath).href}?v=${Date.now()}`),
    wordnikAdapter: await import(`${pathToFileURL(wordnikAdapterPath).href}?v=${Date.now()}`),
    merriamWebsterAdapter: await import(`${pathToFileURL(merriamWebsterAdapterPath).href}?v=${Date.now()}`),
    localAdapter: await import(`${pathToFileURL(localAdapterPath).href}?v=${Date.now()}`),
  }
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
