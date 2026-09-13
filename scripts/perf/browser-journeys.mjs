import { readFile, mkdir, writeFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { isBrowserSafePort } from '../lib/browser-port-policy.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const baseUrl = String(process.env.READ_WEB_PERF_BASE_URL || '').trim()
if (!baseUrl) {
  throw new Error('READ_WEB_PERF_BASE_URL is required; point the journey runner at a temporary fixture on a random browser-safe loopback port')
}
const parsedBaseUrl = new URL(baseUrl)
if (parsedBaseUrl.protocol !== 'http:' || parsedBaseUrl.hostname !== '127.0.0.1' || !isBrowserSafePort(parsedBaseUrl.port)) {
  throw new Error(`Performance browser journeys require an explicit 127.0.0.1 browser-safe port: ${baseUrl}`)
}
const { chromium } = await import('playwright')
const baseOrigin = new URL(baseUrl).origin
const outputDirectory = path.resolve(process.env.READ_WEB_PERF_OUTPUT || path.join(repoRoot, 'output', 'performance'))
const fixtureRoot = path.join(repoRoot, 'scripts', 'fixtures')
const fixturePath = path.join(fixtureRoot, 'performance-browser-journeys.v1.json')
const fixture = JSON.parse(await readFile(fixturePath, 'utf8'))
const resolveFixturePath = (name) => {
  const resolved = path.resolve(fixtureRoot, String(name || ''))
  const relative = path.relative(fixtureRoot, resolved)
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Performance fixture path must stay under scripts/fixtures: ${name}`)
  }
  return resolved
}
const previewFixturePath = resolveFixturePath(fixture.previewFixture)
const srsFixtureText = await readFile(resolveFixturePath(fixture.srsFixture), 'utf8')
const fixedJourneyOrder = Object.freeze([
  'cold-start',
  'material-open',
  'play-pause-seek',
  'continuous-word-chunk',
  'material-workflow',
  'passage-preview',
  'srs-review',
])
const requestedJourneys = parseRequestedJourneys(process.env.READ_WEB_PERF_JOURNEYS)
const forcedFailureJourney = String(process.env.READ_WEB_PERF_FORCE_FAILURE || '').trim()
const realHostApiPrefixes = String(process.env.READ_WEB_PERF_REAL_HOST_APIS || '')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean)
const TTS_AUDIO_PATH_PREFIX = '/api/tts/edge/audio/'
const TTS_AUDIO_FILE_PATTERN = /^\/api\/tts\/edge\/audio\/[a-f0-9]{64}\.mp3$/i
const DEFAULT_LOCAL_SERVICE_ORIGIN = 'http://127.0.0.1:8765'

function parseRequestedJourneys(value) {
  const names = String(value || fixedJourneyOrder.join(','))
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
  return fixedJourneyOrder.filter((name) => names.includes(name))
    .concat(names.filter((name) => !fixedJourneyOrder.includes(name)))
}

function percentile(values, quantile) {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * quantile) - 1)]
}

function makeSilentWavDataUrl(seconds = 12, sampleRate = 8000) {
  const samples = Math.ceil(seconds * sampleRate)
  const dataSize = samples * 2
  const buffer = Buffer.alloc(44 + dataSize)
  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(36 + dataSize, 4)
  buffer.write('WAVE', 8)
  buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(sampleRate * 2, 28)
  buffer.writeUInt16LE(2, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36)
  buffer.writeUInt32LE(dataSize, 40)
  return `data:audio/wav;base64,${buffer.toString('base64')}`
}

function buildReaderMaterial(readerFixture) {
  let globalIndex = 0
  const segments = Array.from({ length: readerFixture.segmentCount }, (_, segmentIndex) => {
    const words = Array.from({ length: readerFixture.wordsPerSegment }, (_, wordIndex) => {
      const index = globalIndex++
      return {
        word: `word${index}`,
        start: index * readerFixture.wordDurationSeconds,
        end: (index + 1) * readerFixture.wordDurationSeconds,
      }
    })
    return {
      start: words[0].start,
      end: words.at(-1).end,
      words,
    }
  })
  const chunks = segments.map((segment, id) => ({
    id,
    chunks: [{
      en: segment.words.map((word) => word.word).join(' '),
      zh: `固定分块 ${id + 1}`,
      a: 1,
      b: segment.words.length,
    }],
  }))
  return { transcript: { segments }, chunks: { s: chunks }, wordCount: globalIndex }
}

const readerMaterial = buildReaderMaterial(fixture.reader)
const audioDataUrl = makeSilentWavDataUrl(fixture.reader.audioDurationSeconds)

function isEdgeTtsRequest(request) {
  if (request.method() !== 'POST') return false
  try {
    return new URL(request.url()).pathname === '/api/tts/edge'
  } catch {
    return false
  }
}

function isEdgeTtsAudioRequest(request) {
  if (request.method() !== 'GET') return false
  try {
    return new URL(request.url()).pathname.startsWith(TTS_AUDIO_PATH_PREFIX)
  } catch {
    return false
  }
}

function ttsRequestKind(request) {
  if (isEdgeTtsRequest(request)) return 'edge-post'
  if (isEdgeTtsAudioRequest(request)) return 'edge-audio-get'
  return ''
}

function isRealHostApiPath(pathname) {
  return realHostApiPrefixes.some((prefix) => (
    pathname === prefix
    || (
      prefix === '/api/tts/edge'
      && pathname.startsWith(TTS_AUDIO_PATH_PREFIX)
    )
  ))
}

function isRealHostApiRequest(url) {
  return url.origin === baseOrigin && isRealHostApiPath(url.pathname)
}

function isFallbackRealHostTtsRequest(url) {
  return url.origin === DEFAULT_LOCAL_SERVICE_ORIGIN
    && realHostApiPrefixes.includes('/api/tts/edge')
    && isRealHostApiPath(url.pathname)
}

function classifyIsolationRoute(url) {
  if (isRealHostApiRequest(url) || isFallbackRealHostTtsRequest(url)) return 'real-host'
  if (url.pathname.startsWith('/api/') || (url.origin !== baseOrigin && url.pathname.includes('/api/'))) {
    return 'mock'
  }
  if (url.origin === baseOrigin || url.protocol === 'data:' || url.protocol === 'blob:') {
    return 'same-origin'
  }
  return 'blocked-external'
}

function normalizePath(value) {
  try {
    return new URL(String(value || ''), baseOrigin).pathname
  } catch {
    return ''
  }
}

function isLikelyMp3(buffer) {
  if (!buffer?.length) return false
  return buffer.subarray(0, 3).toString('ascii') === 'ID3'
    || (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0)
}

function isValidTtsAudioResponse({ status, contentType, body } = {}) {
  if (Number(status) >= 400) return false
  if (!/^audio\//i.test(String(contentType || ''))) return false
  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body || [])
  if (!bytes.length) return false
  if (/^audio\/mpeg(?:;|$)/i.test(String(contentType || ''))) return isLikelyMp3(bytes)
  return true
}

function readTtsRequestToken(request) {
  return String(request.headers()['x-read-web-performance-tts-request'] || '').trim()
}

function classifyExpectedPronunciationAbort({
  method,
  pathname,
  failureText,
  pageUnloading = false,
  pageClosed = false,
  requestReplaced = false,
  testTriggered = false,
} = {}) {
  const normalizedMethod = String(method || '').toUpperCase()
  const normalizedPath = String(pathname || '')
  const isPost = normalizedMethod === 'POST' && normalizedPath === '/api/tts/edge'
  const isAudioGet = normalizedMethod === 'GET' && TTS_AUDIO_FILE_PATTERN.test(normalizedPath)
  if (!isPost && !isAudioGet) return ''
  if (failureText !== 'net::ERR_ABORTED') return ''
  if (pageClosed) return 'page-closed'
  if (pageUnloading) return 'page-unload'
  if (requestReplaced) return 'request-replaced'
  if (isPost && testTriggered) return 'test-triggered'
  return ''
}

function runTtsContractChecks() {
  const validAudioPath = `/api/tts/edge/audio/${'a'.repeat(64)}.mp3`
  assert.equal(
    isRealHostApiRequest(new URL(`${baseOrigin}${validAudioPath}`)),
    true,
    'enabled TTS real-host routing must include the audio child path',
  )
  assert.equal(
    isRealHostApiRequest(new URL(`${baseOrigin}/api/tts/edge-unrelated`)),
    false,
    'TTS routing must not widen to an unrelated API path',
  )
  assert.equal(
    classifyIsolationRoute(new URL(`${DEFAULT_LOCAL_SERVICE_ORIGIN}${validAudioPath}`)),
    'real-host',
    'the built-in local service fallback must be rewritten only for the configured TTS path',
  )
  assert.equal(
    classifyExpectedPronunciationAbort({
      method: 'GET',
      pathname: validAudioPath,
      failureText: 'net::ERR_ABORTED',
      requestReplaced: true,
    }),
    'request-replaced',
  )
  assert.equal(
    classifyExpectedPronunciationAbort({
      method: 'GET',
      pathname: validAudioPath,
      failureText: 'net::ERR_ABORTED',
    }),
    '',
    'an unexplained audio cancellation must remain an error',
  )
  assert.equal(
    classifyExpectedPronunciationAbort({
      method: 'GET',
      pathname: '/api/not-tts',
      failureText: 'net::ERR_ABORTED',
      pageUnloading: true,
    }),
    '',
    'a non-TTS request cancellation must remain an error',
  )
  assert.equal(
    classifyExpectedPronunciationAbort({
      method: 'POST',
      pathname: '/api/tts/edge',
      failureText: 'net::ERR_ABORTED',
      testTriggered: true,
    }),
    'test-triggered',
  )
  assert.equal(
    classifyExpectedPronunciationAbort({
      method: 'POST',
      pathname: '/api/tts/edge',
      failureText: 'net::ERR_ABORTED',
    }),
    '',
    'an unexplained generation cancellation must remain an error',
  )
  assert.equal(
    isValidTtsAudioResponse({
      status: 200,
      contentType: 'audio/mpeg',
      body: Buffer.from('ID3fixture-audio'),
    }),
    true,
  )
  assert.equal(
    isValidTtsAudioResponse({
      status: 200,
      contentType: 'application/json',
      body: Buffer.from('{}'),
    }),
    false,
    'JSON must not be accepted as audio',
  )
  assert.equal(
    isValidTtsAudioResponse({
      status: 404,
      contentType: 'audio/mpeg',
      body: Buffer.from('ID3missing'),
    }),
    false,
    'an audio 404 must not be accepted as a cancellation',
  )
  console.log('TTS browser route/classifier contract passed (positive and negative cases)')
}

async function mockApi(route) {
  const request = route.request()
  const url = new URL(request.url())
  let body = {}
  if (url.pathname.endsWith('/api/health')) body = { status: 'ok', service: 'fixed-performance-fixture' }
  else if (url.pathname.includes('/api/jobs/snapshot')) body = { jobs: [], revision: 1 }
  else if (url.pathname.includes('/api/jobs')) body = { jobs: [], items: [], revision: 1 }
  else if (url.pathname.includes('/api/recent') || url.pathname.includes('/api/history')) body = { items: [], jobs: [] }
  else if (url.pathname.includes('/api/reader/recent')) body = { items: [] }
  else if (url.pathname.includes('/api/config')) body = { config: {} }
  else if (url.pathname.includes('/api/credentials/')) body = { stored: false, provider: '' }
  else if (url.pathname.includes('/api/maintenance')) body = { healthy: true, items: [] }
  else if (url.pathname.includes('/api/vocabulary/local-sentences')) {
    body = { available: false, errorCode: 'FIXTURE_LOCAL_SENTENCES_DISABLED', items: [] }
  } else if (url.pathname.includes('/api/vocabulary/real-sentences')) {
    const word = url.searchParams.get('word') || 'fixture'
    body = {
      schemaVersion: 'tatoeba-real-sentences.v1',
      items: [{
        id: `performance-${word}`,
        sentence: `Learners can use ${word} in this fixed performance sentence.`,
        translationZh: `固定性能例句：${word}`,
        owner: 'performance-fixture',
        translationOwner: 'performance-fixture',
        license: 'CC BY 2.0 FR',
        url: `https://example.invalid/${word}`,
      }],
    }
  } else if (url.pathname.includes('/api/vocabulary/sentence-translations')) {
    const input = request.postDataJSON()?.items || []
    body = {
      schemaVersion: 'sentence-translations.v1',
      available: true,
      items: input.map((item) => ({ ...item, translationZh: `固定翻译：${item.id}` })),
    }
  } else if (url.pathname.includes('/api/vocabulary/')) {
    body = { available: false, items: [] }
  }
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
}

async function installNetworkIsolation(context, artifact) {
  await context.route('**/*', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (isRealHostApiRequest(url)) {
      artifact.isolation.realHostApiRequests += 1
      artifact.isolation.realHostApiPaths.push(url.pathname)
      await route.continue()
      return
    }
    if (isFallbackRealHostTtsRequest(url)) {
      artifact.isolation.realHostApiRequests += 1
      artifact.isolation.realHostApiPaths.push(url.pathname)
      const requestOrigin = request.headers().origin || baseOrigin
      if (request.method() === 'OPTIONS') {
        await route.fulfill({
          status: 204,
          headers: {
            'access-control-allow-origin': requestOrigin,
            'access-control-allow-credentials': 'true',
            'access-control-allow-methods': 'GET, POST, OPTIONS',
            'access-control-allow-headers': request.headers()['access-control-request-headers'] || 'content-type',
            'access-control-max-age': '60',
          },
        })
        return
      }
      const response = await route.fetch({ url: `${baseOrigin}${url.pathname}${url.search}` })
      await route.fulfill({
        response,
        headers: {
          ...response.headers(),
          'access-control-allow-origin': requestOrigin,
          'access-control-allow-credentials': 'true',
        },
      })
      return
    }
    if (url.pathname.startsWith('/api/') || url.origin !== baseOrigin && url.pathname.includes('/api/')) {
      artifact.isolation.mockedApiRequests += 1
      await mockApi(route)
      return
    }
    if (url.pathname === '/src/features/srs-review/srs-review.sample.local.json') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: srsFixtureText })
      return
    }
    if (url.origin === baseOrigin || url.protocol === 'data:' || url.protocol === 'blob:') {
      await route.continue()
      return
    }
    artifact.isolation.blockedExternalRequests += 1
    if (request.resourceType() === 'image') {
      await route.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1" />' })
      return
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
  })
}

async function waitForReader(page) {
  await page.locator('[data-vue-mounted]').waitFor({ state: 'attached', timeout: 15_000 })
  await page.waitForFunction(() => typeof window.processTranscript === 'function' && typeof window.processChunkData === 'function')
}

async function loadReaderMaterial(page) {
  await page.evaluate(({ material, source }) => {
    window.processTranscript(material.transcript)
    window.processChunkData(material.chunks)
    const audio = document.getElementById('audio-player')
    audio.src = source
    audio.muted = true
    audio.load()
  }, { material: readerMaterial, source: audioDataUrl })
  const lastWordIndex = readerMaterial.wordCount - 1
  await page.locator(`#word-${lastWordIndex}, #chunk-word-${lastWordIndex}`).first().waitFor({ state: 'attached' })
}

const journeys = {
  'cold-start': async ({ page, measure }) => {
    await measure('cold-start.navigate-to-reader-ready', async () => {
      await page.goto(`${baseUrl}/?performanceFixture=${fixture.version}`, { waitUntil: 'domcontentloaded', timeout: 30_000 })
      await waitForReader(page)
    })
    return {
      navigation: await page.evaluate(() => performance.getEntriesByType('navigation')[0]?.toJSON?.() || null),
    }
  },

  'material-open': async ({ page, measure }) => {
    if (!page.url().startsWith(baseOrigin)) {
      await page.goto(baseUrl, { waitUntil: 'domcontentloaded' })
      await waitForReader(page)
    }
    await measure('material.open-fixed-reader-fixture', () => loadReaderMaterial(page))
    return {
      wordCount: await page.locator('[data-word-index]').count(),
      segmentCount: await page.locator('[id^="segment-"]').count(),
    }
  },

  'play-pause-seek': async ({ page, measure }) => {
    if (!(await page.locator('#word-0').count())) await loadReaderMaterial(page)
    await measure('playback.play', async () => {
      await page.evaluate(() => document.getElementById('audio-player').play())
      await page.waitForFunction(() => !document.getElementById('audio-player').paused)
    })
    await measure('playback.pause', async () => {
      await page.evaluate(() => document.getElementById('audio-player').pause())
      await page.waitForFunction(() => document.getElementById('audio-player').paused)
    })
    await measure('playback.seek', async () => {
      await page.evaluate((target) => {
        const audio = document.getElementById('audio-player')
        audio.currentTime = target
        audio.dispatchEvent(new Event('seeking'))
        window.forceUpdateUI(target)
        audio.dispatchEvent(new Event('seeked'))
      }, fixture.reader.seekTargetSeconds)
      await page.waitForFunction((target) => Math.abs(document.getElementById('audio-player').currentTime - target) < 0.1, fixture.reader.seekTargetSeconds)
    })
    return await page.evaluate(() => {
      const audio = document.getElementById('audio-player')
      return { paused: audio.paused, currentTime: audio.currentTime }
    })
  },

  'continuous-word-chunk': async ({ page, sample }) => {
    if (!(await page.locator('#word-0').count())) await loadReaderMaterial(page)
    const wordSamples = []
    for (let index = 0; index < fixture.interactions.wordUpdates; index += 1) {
      const durationMs = await sample('word.active-update', () => page.evaluate((wordIndex) => {
        const word = document.querySelector(`#transcript-vue-container [data-word-index="${wordIndex}"]`)
        const start = Number(word?.getAttribute('data-word-start'))
        if (!Number.isFinite(start)) throw new Error(`Missing DOM word start for index ${wordIndex}`)
        window.forceUpdateUI(start + 0.001, { wordIndex })
      }, index % readerMaterial.wordCount))
      wordSamples.push(durationMs)
    }
    await page.evaluate(() => window.toggleChunkMode(true))
    await page.locator('#chunk-0').waitFor()
    const chunkCount = await page.locator('.chunk-block').count()
    const chunkSamples = []
    for (let index = 0; index < fixture.interactions.chunkUpdates; index += 1) {
      const durationMs = await sample('chunk.active-update', () => page.evaluate((chunkIndex) => {
        const chunk = document.querySelector(`#chunk-${chunkIndex}`)
        const firstWord = chunk?.querySelector('[data-word-start]')
        const start = Number(firstWord?.getAttribute('data-word-start'))
        if (!Number.isFinite(start)) throw new Error(`Missing DOM chunk start for index ${chunkIndex}`)
        window.forceUpdateUI(start + 0.001)
      }, index % chunkCount))
      chunkSamples.push(durationMs)
    }
    return {
      wordUpdates: wordSamples.length,
      wordP95Ms: percentile(wordSamples, 0.95),
      chunkUpdates: chunkSamples.length,
      chunkP95Ms: percentile(chunkSamples, 0.95),
    }
  },

  'material-workflow': async ({ page, measure }) => {
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' })
    await waitForReader(page)
    const trigger = page.locator('.youtube-reader-controls button').first()
    await trigger.waitFor()
    await measure('material-workflow.open', async () => {
      await trigger.click()
      await page.locator('.youtube-workflow-panel').waitFor({ state: 'visible' })
    })
    return { dialogVisible: await page.locator('.youtube-workflow-panel').isVisible() }
  },

  'passage-preview': async ({ page, measure }) => {
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' })
    await waitForReader(page)
    await measure('passage-preview.import-and-open', async () => {
      await page.locator('.passage-preview-file-input').setInputFiles(previewFixturePath)
      await page.locator('.passage-preview-page').waitFor({ state: 'visible' })
    })
    await measure('passage-preview.reveal', async () => {
      await page.locator('.passage-preview-actions .srs-review-reveal').click()
      await page.locator('.passage-preview-learning-content').waitFor({ state: 'visible' })
    })
    await measure('passage-preview.next', async () => {
      const before = await page.locator('.srs-review-progress').innerText()
      await page.locator('.passage-preview-actions .srs-review-next').click()
      await page.waitForFunction((text) => document.querySelector('.srs-review-progress')?.textContent !== text, before)
    })
    return { cardVisible: await page.locator('.passage-preview-content').isVisible() }
  },

  'srs-review': async ({ page, measure }) => {
    await measure('srs-review.open-fixed-sample', async () => {
      await page.goto(`${baseUrl}/srs-review.html`, { waitUntil: 'domcontentloaded' })
      await page.locator('.srs-review-content').waitFor({ state: 'visible', timeout: 20_000 })
    })
    await page.locator('.srs-review-pronunciation-audio').waitFor({ state: 'attached', timeout: 20_000 })
    await page.waitForFunction(() => {
      const audio = document.querySelector('.srs-review-pronunciation-audio')
      return Boolean(audio?.currentSrc && audio.readyState >= 2 && !audio.error)
    }, undefined, { timeout: 15_000 })
    const pronunciation = await page.evaluate(() => {
      const audio = document.querySelector('.srs-review-pronunciation-audio')
      return {
        path: audio?.currentSrc ? new URL(audio.currentSrc, location.href).pathname : '',
        readyState: audio?.readyState ?? 0,
        error: audio?.error?.code ?? null,
      }
    })
    await measure('srs-review.reveal', async () => {
      await page.locator('.srs-review-actions .srs-review-reveal').click()
      await page.locator('.srs-review-meanings').waitFor({ state: 'visible' })
    })
    await measure('srs-review.rate', async () => {
      const rating = page.locator('.srs-review-actions .is-good')
      await rating.waitFor({ state: 'visible' })
      const previousWord = await page.locator('.srs-review-word-line h2').textContent()
      const previousProgress = await page.locator('.srs-review-progress').textContent()
      await rating.click()
      await page.waitForFunction(({ previousWord: priorWord, previousProgress: priorProgress }) => {
        const completed = document.querySelector('.srs-review-state h2')?.textContent?.trim() === '今日复习已完成'
        const nextWord = document.querySelector('.srs-review-word-line h2')?.textContent?.trim()
        const nextProgress = document.querySelector('.srs-review-progress')?.textContent?.trim()
        return completed
          || Boolean(nextWord && nextWord !== priorWord?.trim())
          || Boolean(nextProgress && nextProgress !== priorProgress?.trim())
      }, { previousWord, previousProgress })
    })
    return {
      reviewVisible: await page.locator('.srs-review-page').isVisible(),
      pronunciation,
    }
  },
}

if (process.env.READ_WEB_PERF_TTS_CONTRACT_ONLY === '1') {
  runTtsContractChecks()
  process.exit(0)
}

await mkdir(outputDirectory, { recursive: true })
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
await context.tracing.start({ screenshots: true, snapshots: true, sources: true })

const artifact = {
  schema: 'read-web.browser-performance-journeys',
  schemaVersion: 2,
  capturedAt: new Date().toISOString(),
  baseUrl,
  fixture: { schema: fixture.schema, version: fixture.version, path: path.relative(repoRoot, fixturePath) },
  isolation: {
    mode: realHostApiPrefixes.length ? 'browser-route-fixtures-with-real-host-api' : 'browser-route-fixtures',
    mockedApiRequests: 0,
    realHostApiRequests: 0,
    realHostApiPaths: [],
    blockedExternalRequests: 0,
    realExternalRequests: 0,
  },
  requestedJourneys,
  journeys: [],
  measures: [],
  samples: [],
  errors: [],
  requests: { total: 0, failed: 0, httpErrors: 0, expectedAborted: 0 },
  ttsRequests: [],
  longTasks: [],
}

await installNetworkIsolation(context, artifact)
await context.addInitScript(() => {
  window.__readWebPerformance = { longTasks: [], rejections: [] }
  window.addEventListener('unhandledrejection', (event) => {
    window.__readWebPerformance.rejections.push(String(event.reason?.message || event.reason || 'unknown'))
  })
  if ('PerformanceObserver' in window) {
    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          window.__readWebPerformance.longTasks.push({ startTime: entry.startTime, duration: entry.duration })
        }
      })
      observer.observe({ type: 'longtask', buffered: true })
    } catch {}
  }
  class FixtureUtterance { constructor(text) { this.text = text } }
  Object.defineProperty(window, 'SpeechSynthesisUtterance', { configurable: true, value: FixtureUtterance })
  Object.defineProperty(window, 'speechSynthesis', {
    configurable: true,
    value: {
      getVoices: () => [{ name: 'Read-Web Fixture Voice', lang: 'en-US' }],
      cancel() {},
      speak(utterance) { setTimeout(() => utterance.onend?.(), 0) },
    },
  })
})

const page = await context.newPage()
await page.addInitScript(() => {
  const nativeFetch = window.fetch.bind(window)
  const ttsStates = new Map()
  let nextToken = 0

  window.__readWebPerformanceTtsState = (token) => {
    const state = ttsStates.get(String(token || ''))
    return state
      ? { aborted: state.aborted, testTriggered: state.testTriggered }
      : null
  }
  window.__readWebPerformanceExpectPendingTtsAbort = () => {
    for (const state of ttsStates.values()) {
      if (!state.settled) state.testTriggered = true
    }
  }

  window.fetch = (input, init = {}) => {
    let url = null
    try {
      url = new URL(typeof input === 'string' ? input : input?.url || '', window.location.href)
    } catch {}
    const method = String(init?.method || input?.method || 'GET').toUpperCase()
    if (url?.pathname !== '/api/tts/edge' || method !== 'POST' || !init?.signal) {
      return nativeFetch(input, init)
    }

    const token = `perf-tts-${++nextToken}`
    const state = {
      aborted: Boolean(init.signal.aborted),
      testTriggered: false,
      settled: false,
    }
    ttsStates.set(token, state)
    init.signal.addEventListener('abort', () => {
      state.aborted = true
    }, { once: true })
    const headers = new Headers(init.headers || (typeof Request !== 'undefined' && input instanceof Request ? input.headers : undefined))
    headers.set('X-Read-Web-Performance-TTS-Request', token)
    return nativeFetch(input, { ...init, headers }).finally(() => {
      state.settled = true
    })
  }
})
let activeJourney = 'setup'
let mainFrameNavigationSerial = 0
let pageClosed = false
let nextRequestSerial = 0
const ttsRequestStates = new Map()
const requestFailureTasks = []
const ttsObservationTasks = []
const responseDiagnosticTasks = []

async function captureReviewPageContext() {
  if (page.isClosed()) return null
  try {
    return await page.evaluate(() => {
      const pronunciationAudio = document.querySelector('.srs-review-pronunciation-audio')
      const pronunciationSource = pronunciationAudio?.currentSrc || pronunciationAudio?.getAttribute('src') || ''
      let pronunciationPath = ''
      try {
        pronunciationPath = pronunciationSource
          ? new URL(pronunciationSource, location.href).pathname
          : ''
      } catch {}
      return {
        word: document.querySelector('.srs-review-word-line h2')?.textContent?.trim() || '',
        progress: document.querySelector('.srs-review-progress')?.textContent?.trim() || '',
        pronunciationPath,
        pronunciationConnected: Boolean(pronunciationAudio?.isConnected),
      }
    })
  } catch {
    return null
  }
}

function isPronunciationRequestReplaced(observation, context) {
  if (observation?.kind !== 'edge-audio-get' || !context) return false
  const started = observation.cardAtStart
  if (!started || started.pronunciationPath !== observation.path) return false
  const cardChanged = started.word !== context.word || started.progress !== context.progress
  const sourceChanged = context.pronunciationPath !== observation.path || !context.pronunciationConnected
  return sourceChanged && (cardChanged || !context.word)
}

async function inspectTtsResponse(response, state) {
  const observation = state?.observation
  if (!observation) return
  const headers = response.headers()
  const contentType = String(headers['content-type'] || '')
  observation.response = {
    status: response.status(),
    contentType,
  }
  if (state.kind === 'edge-post' && response.status() < 400) {
    try {
      const payload = await response.json()
      const audioPath = normalizePath(payload?.audioUrl)
      if (audioPath) {
        state.audioPath = audioPath
        observation.response.audioPath = audioPath
      }
    } catch {}
    return
  }
  if (state.kind !== 'edge-audio-get' || response.status() >= 400) return
  let body = null
  try {
    body = await response.body()
  } catch {}
  if (body === null) {
    observation.audio = {
      byteLength: null,
      valid: null,
    }
    return
  }
  const valid = isValidTtsAudioResponse({ status: response.status(), contentType, body })
  observation.audio = {
    byteLength: body?.length ?? null,
    valid,
  }
  if (!valid) {
    artifact.errors.push({
      journey: observation.journeyAtStart,
      type: 'tts-invalid-audio-response',
      method: observation.method,
      resourceType: observation.resourceType,
      path: observation.path,
      status: response.status(),
      contentType,
      byteLength: body?.length ?? null,
    })
  }
}

page.on('console', (message) => {
  if (message.type() === 'error') artifact.errors.push({ journey: activeJourney, type: 'console', text: message.text() })
})
page.on('pageerror', (error) => artifact.errors.push({ journey: activeJourney, type: 'pageerror', text: error.message }))
page.on('close', () => { pageClosed = true })
page.on('request', (request) => {
  artifact.requests.total += 1
  const kind = ttsRequestKind(request)
  try {
    if (request.isNavigationRequest() && request.frame() === page.mainFrame()) {
      mainFrameNavigationSerial += 1
    }
  } catch {}
  if (kind) {
    const url = new URL(request.url())
    const observation = {
      kind,
      method: request.method(),
      resourceType: request.resourceType(),
      path: url.pathname,
      isolationRoute: classifyIsolationRoute(url),
      journeyAtStart: activeJourney,
      navigationSerialAtStart: mainFrameNavigationSerial,
      serial: ++nextRequestSerial,
      startedAtMs: performance.now(),
      cardAtStart: null,
      response: null,
      failure: null,
      outcome: 'pending',
    }
    const state = {
      request,
      kind,
      token: kind === 'edge-post' ? readTtsRequestToken(request) : '',
      serial: observation.serial,
      observation,
      navigationSerial: mainFrameNavigationSerial,
      failed: false,
      finished: false,
    }
    const contextTask = captureReviewPageContext().then((context) => {
      observation.cardAtStart = context
    })
    state.contextTask = contextTask
    ttsObservationTasks.push(contextTask)
    ttsRequestStates.set(request, state)
    artifact.ttsRequests.push(observation)
  }
})
page.on('requestfinished', (request) => {
  const state = ttsRequestStates.get(request)
  if (state) {
    state.finished = true
    state.observation.outcome = 'finished'
    state.observation.finishedAtMs = performance.now()
  }
})
page.on('requestfailed', (request) => {
  const task = handleRequestFailure(request)
  requestFailureTasks.push(task)
})

async function handleRequestFailure(request) {
  const failureText = request.failure()?.errorText
  const state = ttsRequestStates.get(request)
  const observation = state?.observation
  let pathname = ''
  try {
    pathname = new URL(request.url()).pathname
  } catch {}

  if (state?.contextTask) await state.contextTask
  const pageContextAtFailure = await captureReviewPageContext()
  let browserTtsState = null
  if (state?.kind === 'edge-post' && state.token && !page.isClosed()) {
    try {
      browserTtsState = await page.evaluate(
        (token) => window.__readWebPerformanceTtsState?.(token) || null,
        state.token,
      )
    } catch {}
  }
  const newerTtsRequest = state?.kind === 'edge-post'
    ? Array.from(ttsRequestStates.values()).some((candidate) => (
      candidate.kind === 'edge-post' && candidate.serial > state.serial
    ))
    : false
  const requestReplaced = isPronunciationRequestReplaced(observation, pageContextAtFailure)
  const reason = classifyExpectedPronunciationAbort({
    method: request.method(),
    pathname,
    failureText,
    pageUnloading: Boolean(state && mainFrameNavigationSerial > state.navigationSerial),
    pageClosed: pageClosed || page.isClosed(),
    requestReplaced: requestReplaced || Boolean(browserTtsState?.aborted && newerTtsRequest),
    testTriggered: state?.kind === 'edge-post' && Boolean(browserTtsState?.testTriggered),
  })
  if (state) {
    state.failed = true
    observation.outcome = 'failed'
    observation.failedAtMs = performance.now()
    observation.journeyAtFailure = activeJourney
    observation.navigationSerialAtFailure = mainFrameNavigationSerial
    observation.cardAtFailure = pageContextAtFailure
    observation.failure = { text: failureText }
    observation.expectedAbortReason = reason || null
  }
  if (reason) {
    artifact.requests.expectedAborted += 1
    return
  }
  artifact.requests.failed += 1
  if (observation) {
    artifact.errors.push({
      journey: observation.journeyAtStart,
      journeyAtFailure: activeJourney,
      type: 'requestfailed',
      method: observation.method,
      resourceType: observation.resourceType,
      path: observation.path,
      url: request.url(),
      text: failureText,
      serial: observation.serial,
      navigationSerialAtStart: observation.navigationSerialAtStart,
      navigationSerialAtFailure: mainFrameNavigationSerial,
    })
  } else {
    artifact.errors.push({ journey: activeJourney, type: 'requestfailed', url: request.url(), text: failureText })
  }
}

page.on('response', (response) => {
  const state = ttsRequestStates.get(response.request())
  if (state) responseDiagnosticTasks.push(inspectTtsResponse(response, state))
  if (response.status() >= 400) {
    artifact.requests.httpErrors += 1
    artifact.errors.push({
      journey: state?.observation?.journeyAtStart || activeJourney,
      journeyAtResponse: activeJourney,
      type: 'http',
      url: response.url(),
      status: response.status(),
      ...(state ? {
        method: state.observation.method,
        resourceType: state.observation.resourceType,
        path: state.observation.path,
      } : {}),
    })
  }
})

const expectPronunciationAbort = async () => {
  try {
    await page.evaluate(() => window.__readWebPerformanceExpectPendingTtsAbort?.())
  } catch {}
}

const measure = async (name, action) => {
  const started = performance.now()
  const result = await action()
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve())))
  artifact.measures.push({ journey: activeJourney, name, durationMs: performance.now() - started })
  return result
}
const sample = async (name, action) => {
  const started = performance.now()
  await action()
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve())))
  const durationMs = performance.now() - started
  artifact.samples.push({ journey: activeJourney, name, durationMs })
  return durationMs
}

let failed = false
try {
  for (const name of requestedJourneys) {
    activeJourney = name
    const journey = journeys[name]
    if (!journey) throw new Error(`Unknown journey: ${name}`)
    const startedAt = performance.now()
    try {
      if (forcedFailureJourney === name) throw new Error(`Forced journey failure: ${name}`)
      const metrics = await journey({ page, measure, sample, expectPronunciationAbort })
      const runtime = await page.evaluate(() => window.__readWebPerformance || { longTasks: [], rejections: [] })
      artifact.longTasks.push(...(runtime.longTasks || []).map((entry) => ({ journey: name, ...entry })))
      for (const rejection of runtime.rejections || []) {
        artifact.errors.push({ journey: name, type: 'unhandledrejection', text: rejection })
      }
      artifact.journeys.push({ name, durationMs: performance.now() - startedAt, status: 'passed', metrics })
    } catch (error) {
      failed = true
      artifact.errors.push({ journey: name, type: 'journey', text: error.stack || error.message })
      artifact.journeys.push({ name, durationMs: performance.now() - startedAt, status: 'failed' })
      await page.screenshot({ path: path.join(outputDirectory, `browser-journeys-${name}-failure.png`), fullPage: true })
    }
  }
} catch (error) {
  failed = true
  artifact.errors.push({ journey: activeJourney, type: 'harness', text: error.stack || error.message })
  await page.screenshot({ path: path.join(outputDirectory, 'browser-journeys-failure.png'), fullPage: true })
} finally {
  await Promise.allSettled([
    ...requestFailureTasks,
    ...ttsObservationTasks,
    ...responseDiagnosticTasks,
  ])
  artifact.summary = {
    passedJourneys: artifact.journeys.filter((item) => item.status === 'passed').length,
    requestedJourneys: requestedJourneys.length,
    measureP50Ms: percentile(artifact.measures.map((item) => item.durationMs), 0.5),
    measureP95Ms: percentile(artifact.measures.map((item) => item.durationMs), 0.95),
    sampleP95Ms: percentile(artifact.samples.map((item) => item.durationMs), 0.95),
    longTaskCount: artifact.longTasks.length,
    longTaskMaxMs: Math.max(0, ...artifact.longTasks.map((item) => item.duration)),
    errorCount: artifact.errors.length,
  }
  await page.screenshot({ path: path.join(outputDirectory, 'browser-journeys-final.png'), fullPage: true })
  await context.tracing.stop({ path: path.join(outputDirectory, 'browser-journeys-trace.zip') })
  await browser.close()
  const outputPath = path.join(outputDirectory, 'browser-journeys.json')
  await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8')
  console.log(`Browser performance artifact: ${outputPath}`)
  console.log(JSON.stringify(artifact.summary))
}

if (failed || artifact.errors.length || artifact.journeys.length !== requestedJourneys.length) process.exitCode = 1
