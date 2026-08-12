import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const baseUrl = process.env.READ_WEB_PLAYBACK_SCALE_URL
if (!baseUrl) throw new Error('READ_WEB_PLAYBACK_SCALE_URL is required')
const outputPath = path.resolve(process.env.READ_WEB_PLAYBACK_SCALE_OUTPUT || path.join(repoRoot, 'output', 'playback-scale', 'playback-scale-results.json'))
const fixturePath = path.join(repoRoot, 'scripts', 'fixtures', 'playback-scale.v1.json')
const fixture = JSON.parse(await readFile(fixturePath, 'utf8'))
const requestedCounts = String(process.env.READ_WEB_PLAYBACK_SCALE_WORD_COUNTS || fixture.wordCounts.join(','))
  .split(',')
  .map(Number)
  .filter((value) => fixture.wordCounts.includes(value))
const artifact = {
  schema: 'read-web.playback-scale-results',
  schemaVersion: 1,
  capturedAt: new Date().toISOString(),
  baseUrl,
  fixture: { schema: fixture.schema, version: fixture.version, offline: fixture.offline, path: path.relative(repoRoot, fixturePath) },
  errors: [],
  results: [],
}

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
await context.route('**/*', async (route) => {
  const url = new URL(route.request().url())
  const origin = new URL(baseUrl).origin
  if (url.pathname.startsWith('/api/')) {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'ok', jobs: [], items: [], revision: 1 }) })
  } else if (url.origin === origin || url.protocol === 'data:' || url.protocol === 'blob:') {
    await route.continue()
  } else {
    await route.fulfill({ status: 204, body: '' })
  }
})
await context.addInitScript(() => {
  const originalAdd = EventTarget.prototype.addEventListener
  const originalRemove = EventTarget.prototype.removeEventListener
  const targets = new WeakMap()
  let active = 0
  let peak = 0
  function isPersistentOwner(target) {
    return target === window || target === document || target === document.documentElement || target === document.body || target?.id === 'audio-player'
  }
  function capture(options) { return typeof options === 'boolean' ? options : Boolean(options && options.capture) }
  function registrations(target, listener) {
    let listeners = targets.get(target)
    if (!listeners) targets.set(target, listeners = new WeakMap())
    let keys = listeners.get(listener)
    if (!keys) listeners.set(listener, keys = new Set())
    return keys
  }
  EventTarget.prototype.addEventListener = function (type, listener, options) {
    if (isPersistentOwner(this) && listener && (typeof listener === 'function' || typeof listener === 'object')) {
      const key = `${type}:${capture(options)}`
      const keys = registrations(this, listener)
      if (!keys.has(key)) {
        keys.add(key)
        active += 1
        peak = Math.max(peak, active)
      }
    }
    return originalAdd.call(this, type, listener, options)
  }
  EventTarget.prototype.removeEventListener = function (type, listener, options) {
    if (isPersistentOwner(this) && listener && (typeof listener === 'function' || typeof listener === 'object')) {
      const keys = targets.get(this)?.get(listener)
      const key = `${type}:${capture(options)}`
      if (keys?.delete(key)) active -= 1
    }
    return originalRemove.call(this, type, listener, options)
  }
  window.__playbackScaleProbe = {
    longTasks: [],
    listeners: () => ({ active, peak }),
    resetLongTasks() { this.longTasks.length = 0 },
  }
  if ('PerformanceObserver' in window) {
    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) window.__playbackScaleProbe.longTasks.push({ startTime: entry.startTime, durationMs: entry.duration })
      })
      observer.observe({ type: 'longtask', buffered: true })
    } catch {}
  }
})

const page = await context.newPage()
page.on('console', (message) => {
  if (message.type() === 'error') artifact.errors.push({ type: 'console', text: message.text() })
})
page.on('pageerror', (error) => artifact.errors.push({ type: 'pageerror', text: error.message }))
page.on('requestfailed', (request) => artifact.errors.push({ type: 'requestfailed', url: request.url(), text: request.failure()?.errorText }))

try {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 })
  await page.locator('[data-vue-mounted]').waitFor({ state: 'attached', timeout: 15_000 })
  await page.waitForFunction(() => typeof window.processTranscript === 'function' && typeof window.processChunkData === 'function')
  for (const wordCount of requestedCounts) artifact.results.push(await runScale(page, wordCount))
} finally {
  await browser.close()
  await mkdir(path.dirname(outputPath), { recursive: true })
  await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8')
}

if (artifact.errors.length) process.exitCode = 1
console.log(`Playback scale artifact: ${outputPath}`)

async function runScale(page, wordCount) {
  const material = buildMaterial(wordCount)
  await page.evaluate(() => window.__playbackScaleProbe.resetLongTasks())
  const importStarted = performance.now()
  await page.evaluate((input) => {
    window.toggleChunkMode(false)
    window.processTranscript(input.transcript)
    window.processChunkData(input.chunks)
    window.toggleChunkMode(false)
  }, material)
  await page.locator(`#transcript-vue-container #word-${wordCount - 1}`).waitFor({ state: 'attached', timeout: 30_000 })
  const importDurationMs = performance.now() - importStarted
  const afterImport = await listenerSnapshot(page)
  await page.evaluate(() => window.__playbackScaleProbe.resetLongTasks())
  const samples = { word: [], chunk: [], seek: [], mark: [], mode: [] }

  await page.evaluate(() => { window.__state.highlightMode = 1; window.forceUpdateUI(0, { wordIndex: 0 }) })
  for (let index = 0; index < fixture.interactionsPerOperation; index += 1) {
    samples.word.push(await sample(page, (wordIndex) => window.forceUpdateUI(window.__state.words[wordIndex].start, { wordIndex }), index))
  }

  await page.evaluate(() => window.toggleChunkMode(true))
  await page.locator(`#chunk-${material.segmentCount - 1}`).waitFor({ state: 'attached', timeout: 30_000 })
  for (let index = 0; index < fixture.interactionsPerOperation; index += 1) {
    samples.chunk.push(await sample(page, (chunkIndex) => {
      const chunk = window.__state.chunkItems[chunkIndex]
      window.forceUpdateUI(chunk.start + 0.001)
    }, index))
  }
  await page.evaluate(() => window.toggleChunkMode(false))

  for (let index = 0; index < fixture.interactionsPerOperation; index += 1) {
    samples.seek.push(await sample(page, (wordIndex) => {
      const audio = document.getElementById('audio-player')
      audio.currentTime = (wordIndex % 90) / 100
      audio.dispatchEvent(new Event('seeking'))
      window.forceUpdateUI(window.__state.words[wordIndex].start, { wordIndex })
      audio.dispatchEvent(new Event('seeked'))
    }, index))
  }

  await page.evaluate(() => window.__state.markedMap.clear())
  for (let index = 0; index < fixture.interactionsPerOperation; index += 1) {
    samples.mark.push(await sample(page, (wordIndex) => {
      window.__marksStore.toggleMark(window.__state.markedMap, wordIndex, window.__state.words, () => {}, () => {})
    }, index))
  }

  for (let index = 0; index < fixture.interactionsPerOperation; index += 1) {
    samples.mode.push(await sample(page, () => window.toggleChunkMode(), null, false))
  }
  await page.waitForFunction(() => window.__state.isChunkMode === false)
  const afterOperations = await listenerSnapshot(page)
  const runtime = await page.evaluate(() => ({
    longTasks: [...window.__playbackScaleProbe.longTasks],
    wordCount: window.__state.words.length,
    chunkCount: window.__state.chunkItems.length,
    markedWords: window.__state.markedMap.size,
    finalMode: window.__state.isChunkMode ? 'chunk' : 'transcript',
    activeWordCount: document.querySelectorAll('.word-highlight').length,
    activeChunkCount: document.querySelectorAll('.chunk-active').length,
  }))
  return {
    wordCount,
    segmentCount: material.segmentCount,
    chunkCount: material.segmentCount,
    importDurationMs,
    samples,
    longTasks: runtime.longTasks,
    listeners: { afterImport: afterImport.active, afterOperations: afterOperations.active, peak: Math.max(afterImport.peak, afterOperations.peak) },
    correctness: {
      wordCount: runtime.wordCount,
      chunkCount: runtime.chunkCount,
      wordUpdates: samples.word.length,
      chunkUpdates: samples.chunk.length,
      seeks: samples.seek.length,
      markedWords: runtime.markedWords,
      modeSwitches: samples.mode.length,
      finalMode: runtime.finalMode,
      activeWordCount: runtime.activeWordCount,
      activeChunkCount: runtime.activeChunkCount,
    },
  }
}

async function sample(page, action, value, waitForPaint = true) {
  const started = performance.now()
  await page.evaluate(action, value)
  if (waitForPaint) await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve())))
  return performance.now() - started
}

function buildMaterial(wordCount) {
  const segmentCount = wordCount / fixture.wordsPerSegment
  let globalIndex = 0
  const segments = Array.from({ length: segmentCount }, (_, segmentIndex) => {
    const words = Array.from({ length: fixture.wordsPerSegment }, () => {
      const index = globalIndex++
      return { word: `word${index}`, start: index * fixture.wordDurationSeconds, end: (index + 1) * fixture.wordDurationSeconds }
    })
    return { start: words[0].start, end: words.at(-1).end, words }
  })
  const chunks = segments.map((segment, id) => ({ id, chunks: [{ en: segment.words.map((word) => word.word).join(' '), zh: `fixture ${id}`, a: 1, b: segment.words.length }] }))
  return { transcript: { segments }, chunks: { s: chunks }, segmentCount }
}

function listenerSnapshot(page) {
  return page.evaluate(() => window.__playbackScaleProbe.listeners())
}
