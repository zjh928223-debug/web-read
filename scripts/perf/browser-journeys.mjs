import { readFile, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const baseUrl = process.env.READ_WEB_PERF_BASE_URL || 'http://127.0.0.1:5174'
const baseOrigin = new URL(baseUrl).origin
const outputDirectory = path.resolve(process.env.READ_WEB_PERF_OUTPUT || path.join(repoRoot, 'output', 'performance'))
const fixturePath = path.join(repoRoot, 'scripts', 'fixtures', 'performance-browser-journeys.v1.json')
const previewFixturePath = path.join(repoRoot, 'scripts', 'fixtures', 'passage-preview-result.fixture.json')
const srsFixtureText = await readFile(path.join(repoRoot, 'src', 'features', 'srs-review', 'srs-review.sample.local.json'), 'utf8')
const fixture = JSON.parse(await readFile(fixturePath, 'utf8'))
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
    if (url.origin === baseOrigin && realHostApiPrefixes.some((prefix) => url.pathname === prefix)) {
      artifact.isolation.realHostApiRequests += 1
      artifact.isolation.realHostApiPaths.push(url.pathname)
      await route.continue()
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
  await page.locator(`#word-${readerMaterial.wordCount - 1}`).waitFor()
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
        const word = window.__state.words[wordIndex]
        window.forceUpdateUI(Number(word.start) + 0.001)
      }, index % readerMaterial.wordCount))
      wordSamples.push(durationMs)
    }
    await page.evaluate(() => window.toggleChunkMode(true))
    await page.locator('#chunk-0').waitFor()
    const chunkCount = await page.locator('.chunk-block').count()
    const chunkSamples = []
    for (let index = 0; index < fixture.interactions.chunkUpdates; index += 1) {
      const durationMs = await sample('chunk.active-update', () => page.evaluate((chunkIndex) => {
        const chunk = window.__state.chunkItems[chunkIndex]
        window.forceUpdateUI(Number(chunk.start) + 0.001)
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
    await measure('srs-review.reveal', async () => {
      await page.locator('.srs-review-actions .srs-review-reveal').click()
      await page.locator('.srs-review-meanings').waitFor({ state: 'visible' })
    })
    await measure('srs-review.rate', async () => {
      const rating = page.locator('.srs-review-actions .is-good')
      await rating.waitFor({ state: 'visible' })
      await rating.click()
      await page.waitForFunction(() => document.querySelector('.srs-review-actions button')?.disabled === true || document.querySelector('.srs-review-inline-notice'))
    })
    return { reviewVisible: await page.locator('.srs-review-page').isVisible() }
  },
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
  requests: { total: 0, failed: 0, httpErrors: 0 },
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
let activeJourney = 'setup'
page.on('console', (message) => {
  if (message.type() === 'error') artifact.errors.push({ journey: activeJourney, type: 'console', text: message.text() })
})
page.on('pageerror', (error) => artifact.errors.push({ journey: activeJourney, type: 'pageerror', text: error.message }))
page.on('request', () => { artifact.requests.total += 1 })
page.on('requestfailed', (request) => {
  artifact.requests.failed += 1
  artifact.errors.push({ journey: activeJourney, type: 'requestfailed', url: request.url(), text: request.failure()?.errorText })
})
page.on('response', (response) => {
  if (response.status() >= 400) {
    artifact.requests.httpErrors += 1
    artifact.errors.push({ journey: activeJourney, type: 'http', url: response.url(), status: response.status() })
  }
})

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
      const metrics = await journey({ page, measure, sample })
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
  await context.tracing.stop({ path: path.join(outputDirectory, 'browser-journeys-trace.zip') })
  await browser.close()
  const outputPath = path.join(outputDirectory, 'browser-journeys.json')
  await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8')
  console.log(`Browser performance artifact: ${outputPath}`)
  console.log(JSON.stringify(artifact.summary))
}

if (failed || artifact.errors.length || artifact.journeys.length !== requestedJourneys.length) process.exitCode = 1
