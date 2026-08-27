import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { chromium } from 'playwright'

const repoRoot = path.resolve(import.meta.dirname, '..')
const budgetPath = path.join(repoRoot, 'config', 'release-stability-budgets.json')
const budgets = JSON.parse(await readFile(budgetPath, 'utf8'))
const baseUrl = String(process.env.READ_WEB_STABILITY_BASE_URL || '').trim()
const outputPath = path.resolve(process.env.READ_WEB_STABILITY_OUTPUT || path.join(repoRoot, 'output', 'release-stability', 'release-playback-endurance.json'))
const durationMs = positiveInteger(process.env.READ_WEB_STABILITY_DURATION_MS, budgets.playbackDurationMs)
const sampleIntervalMs = Math.min(durationMs, positiveInteger(process.env.READ_WEB_STABILITY_SAMPLE_INTERVAL_MS, budgets.sampleIntervalMs))
const contractOnly = process.env.READ_WEB_STABILITY_CONTRACT_ONLY === '1'

assert.ok(baseUrl, 'READ_WEB_STABILITY_BASE_URL is required')
assert.equal(new URL(baseUrl).hostname, '127.0.0.1', 'endurance browser must use an isolated loopback host')
assert.ok(!['5173', '5174', '8765', '8766'].includes(new URL(baseUrl).port), 'endurance browser refuses reserved daily/dev ports')
if (!contractOnly) assert.ok(durationMs >= budgets.playbackDurationMs, 'release evidence must run the full configured playback duration')

const browser = await chromium.launch({
  headless: true,
  args: ['--autoplay-policy=no-user-gesture-required', '--enable-precise-memory-info', '--js-flags=--expose-gc'],
})
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
const origin = new URL(baseUrl).origin
const artifact = {
  schema: 'read-web.release-playback-endurance',
  schemaVersion: 1,
  capturedAt: new Date().toISOString(),
  status: 'running',
  mode: contractOnly ? 'contract-only' : 'release-evidence',
  baseOrigin: origin,
  budgets: { path: path.relative(repoRoot, budgetPath).replaceAll(path.sep, '/'), ...budgets },
  requestedDurationMs: durationMs,
  actualDurationMs: 0,
  rapidSwitch: null,
  playback: { samples: [], progressingSamples: 0, loopCount: 0 },
  memory: { samples: [] },
  resources: null,
  longTasks: [],
  errors: [],
  requests: { total: 0, mockedApi: 0, blockedExternal: 0, failed: 0, httpErrors: 0 },
}

await context.route('**/*', async (route) => {
  const requestUrl = new URL(route.request().url())
  if (requestUrl.origin === origin && requestUrl.pathname.startsWith('/api/')) {
    artifact.requests.mockedApi += 1
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'ok', jobs: [], items: [], revision: 1 }) })
    return
  }
  if (requestUrl.origin === origin || requestUrl.protocol === 'data:' || requestUrl.protocol === 'blob:') {
    await route.continue()
    return
  }
  artifact.requests.blockedExternal += 1
  await route.fulfill({ status: 204, body: '' })
})

await context.addInitScript(() => {
  const originalAdd = EventTarget.prototype.addEventListener
  const originalRemove = EventTarget.prototype.removeEventListener
  const registrations = new WeakMap()
  let activeListeners = 0
  let peakListeners = 0
  function capture(options) { return typeof options === 'boolean' ? options : Boolean(options?.capture) }
  function tracked(target) {
    return target === window || target === document || target === document.documentElement || target === document.body || target?.id === 'audio-player'
  }
  EventTarget.prototype.addEventListener = function (type, listener, options) {
    if (tracked(this) && listener && (typeof listener === 'function' || typeof listener === 'object')) {
      let listeners = registrations.get(this)
      if (!listeners) registrations.set(this, listeners = new WeakMap())
      let keys = listeners.get(listener)
      if (!keys) listeners.set(listener, keys = new Set())
      const key = `${type}:${capture(options)}`
      if (!keys.has(key)) {
        keys.add(key)
        activeListeners += 1
        peakListeners = Math.max(peakListeners, activeListeners)
      }
    }
    return originalAdd.call(this, type, listener, options)
  }
  EventTarget.prototype.removeEventListener = function (type, listener, options) {
    if (tracked(this) && listener) {
      const key = `${type}:${capture(options)}`
      if (registrations.get(this)?.get(listener)?.delete(key)) activeListeners -= 1
    }
    return originalRemove.call(this, type, listener, options)
  }
  const originalCreate = URL.createObjectURL.bind(URL)
  const originalRevoke = URL.revokeObjectURL.bind(URL)
  const liveUrls = new Set()
  let peakUrls = 0
  URL.createObjectURL = (value) => {
    const url = originalCreate(value)
    liveUrls.add(url)
    peakUrls = Math.max(peakUrls, liveUrls.size)
    return url
  }
  URL.revokeObjectURL = (url) => {
    liveUrls.delete(url)
    return originalRevoke(url)
  }
  window.__releaseStabilityProbe = {
    longTasks: [],
    rejections: [],
    resources: () => ({ activeListeners, peakListeners, liveObjectUrls: liveUrls.size, peakObjectUrls: peakUrls }),
  }
  window.addEventListener('unhandledrejection', (event) => window.__releaseStabilityProbe.rejections.push(String(event.reason?.message || event.reason || 'unknown')))
  if ('PerformanceObserver' in window) {
    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) window.__releaseStabilityProbe.longTasks.push({ startTime: entry.startTime, durationMs: entry.duration })
      })
      observer.observe({ type: 'longtask', buffered: true })
    } catch {}
  }
})

const page = await context.newPage()
page.on('console', (message) => { if (message.type() === 'error') artifact.errors.push({ type: 'console', text: message.text() }) })
page.on('pageerror', (error) => artifact.errors.push({ type: 'page', text: error.message }))
page.on('request', () => { artifact.requests.total += 1 })
page.on('requestfailed', (request) => {
  artifact.requests.failed += 1
  artifact.errors.push({ type: 'requestFailed', url: request.url(), text: request.failure()?.errorText || '' })
})
page.on('response', (response) => {
  if (response.status() >= 400) {
    artifact.requests.httpErrors += 1
    artifact.errors.push({ type: 'http', url: response.url(), status: response.status() })
  }
})

const cdp = await context.newCDPSession(page)
let playbackUrl = null
try {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 })
  await page.locator('[data-vue-mounted]').waitFor({ state: 'attached', timeout: 15_000 })
  await page.waitForFunction(() => typeof window.processTranscript === 'function' && typeof window.processChunkData === 'function')
  const materials = [buildMaterial('a', 240), buildMaterial('b', 320)]
  artifact.rapidSwitch = await page.evaluate(async ({ materials, bursts }) => {
    const sequence = []
    for (let index = 0; index < bursts; index += 1) {
      for (const material of [materials[0], materials[1], materials[0]]) {
        window.processTranscript(material.transcript)
        window.processChunkData(material.chunks)
        sequence.push(material.id)
      }
      await new Promise((resolve) => requestAnimationFrame(resolve))
    }
    return {
      bursts,
      switches: sequence.length,
      patternValid: sequence.every((value, index) => value === ['a', 'b', 'a'][index % 3]),
      finalWord: document.querySelector('#transcript-vue-container [data-word-index="0"]')?.textContent?.trim() || '',
      finalWordCount: document.querySelectorAll('#transcript-vue-container [data-word-index]').length,
    }
  }, { materials, bursts: budgets.rapidSwitchBursts })
  assert.equal(artifact.rapidSwitch.patternValid, true)
  assert.equal(artifact.rapidSwitch.finalWord, 'a-0')
  assert.equal(artifact.rapidSwitch.finalWordCount, materials[0].wordCount)

  const wavDataUrl = makeSilentWavDataUrl(10)
  playbackUrl = await page.evaluate(async (source) => {
    const blob = await (await fetch(source)).blob()
    const url = URL.createObjectURL(blob)
    const audio = document.getElementById('audio-player')
    audio.muted = true
    audio.loop = true
    audio.src = url
    audio.load()
    window.__releaseStabilityPlayback = { timeupdates: 0, loops: 0, previousTime: 0 }
    audio.addEventListener('timeupdate', () => {
      const probe = window.__releaseStabilityPlayback
      if (audio.currentTime < probe.previousTime) probe.loops += 1
      probe.previousTime = audio.currentTime
      probe.timeupdates += 1
    })
    await new Promise((resolve, reject) => {
      if (audio.readyState >= 2) return resolve()
      audio.addEventListener('canplay', resolve, { once: true })
      audio.addEventListener('error', () => reject(new Error('endurance audio failed to load')), { once: true })
    })
    await audio.play()
    return url
  }, wavDataUrl)
  const resourceBaseline = await page.evaluate(() => window.__releaseStabilityProbe.resources())
  await collectGarbage(cdp)
  const baselineHeap = await heapUsed(cdp)
  artifact.memory.baselineHeapBytes = baselineHeap
  const started = Date.now()
  let previousTimeupdates = await page.evaluate(() => window.__releaseStabilityPlayback.timeupdates)
  while (Date.now() - started < durationMs) {
    await delay(Math.min(sampleIntervalMs, durationMs - (Date.now() - started)))
    const elapsedMs = Date.now() - started
    const state = await page.evaluate(({ materials, sampleIndex }) => {
      const material = sampleIndex % 2 ? materials[1] : materials[0]
      window.processTranscript(material.transcript)
      window.processChunkData(material.chunks)
      const audio = document.getElementById('audio-player')
      return {
        currentTime: audio.currentTime,
        paused: audio.paused,
        readyState: audio.readyState,
        material: material.id,
        timeupdates: window.__releaseStabilityPlayback.timeupdates,
        loops: window.__releaseStabilityPlayback.loops,
      }
    }, { materials, sampleIndex: artifact.playback.samples.length })
    artifact.playback.loopCount = state.loops
    if (!state.paused && state.readyState >= 2 && state.timeupdates > previousTimeupdates) artifact.playback.progressingSamples += 1
    previousTimeupdates = state.timeupdates
    const heapBytes = await heapUsed(cdp)
    artifact.playback.samples.push({ elapsedMs, ...state })
    artifact.memory.samples.push({ elapsedMs, heapBytes })
    process.stdout.write(`[release endurance] ${Math.round(elapsedMs / 1000)}s/${Math.round(durationMs / 1000)}s heap=${heapBytes}\n`)
  }
  artifact.actualDurationMs = Date.now() - started
  await collectGarbage(cdp)
  artifact.memory.finalHeapBytes = await heapUsed(cdp)
  artifact.memory.peakHeapBytes = Math.max(baselineHeap, ...artifact.memory.samples.map((item) => item.heapBytes))
  artifact.memory.finalGrowthBytes = artifact.memory.finalHeapBytes - baselineHeap
  artifact.memory.peakGrowthBytes = artifact.memory.peakHeapBytes - baselineHeap
  const runtime = await page.evaluate(() => ({
    resources: window.__releaseStabilityProbe.resources(),
    longTasks: [...window.__releaseStabilityProbe.longTasks],
    rejections: [...window.__releaseStabilityProbe.rejections],
  }))
  artifact.resources = {
    baseline: resourceBaseline,
    final: runtime.resources,
    listenerGrowth: runtime.resources.activeListeners - resourceBaseline.activeListeners,
  }
  artifact.longTasks = runtime.longTasks
  artifact.errors.push(...runtime.rejections.map((text) => ({ type: 'unhandledRejection', text })))

  const minimumProgress = Math.max(1, Math.floor(artifact.playback.samples.length * 0.9))
  assert.ok(artifact.actualDurationMs >= durationMs, 'playback did not reach the requested wall-clock duration')
  assert.ok(artifact.playback.progressingSamples >= minimumProgress, 'playback stopped progressing during endurance run')
  assert.ok(artifact.memory.finalGrowthBytes <= budgets.memory.finalHeapGrowthMaxBytes, 'final JS heap growth exceeded the release budget')
  assert.ok(artifact.memory.peakGrowthBytes <= budgets.memory.peakHeapGrowthMaxBytes, 'peak JS heap growth exceeded the release budget')
  assert.ok(artifact.resources.listenerGrowth <= budgets.memory.listenerGrowthMax, 'persistent listener count grew during endurance run')
  assert.ok(artifact.resources.final.liveObjectUrls <= budgets.memory.liveObjectUrlMax, 'live Object URL count exceeded the release budget')
  for (const [type, limit] of Object.entries(budgets.errors)) {
    assert.ok(artifact.errors.filter((item) => item.type === type).length <= limit, `${type} error budget exceeded`)
  }
  artifact.status = 'passed'
} catch (error) {
  artifact.status = 'failed'
  artifact.errors.push({ type: 'harness', text: error.stack || error.message || String(error) })
  process.exitCode = 1
} finally {
  if (playbackUrl) {
    await page.evaluate((url) => {
      const audio = document.getElementById('audio-player')
      audio.pause()
      audio.removeAttribute('src')
      audio.load()
      URL.revokeObjectURL(url)
    }, playbackUrl).catch(() => {})
  }
  await browser.close()
  await mkdir(path.dirname(outputPath), { recursive: true })
  await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8')
  console.log(`release playback endurance evidence: ${outputPath}`)
}

function positiveInteger(value, fallback) {
  const parsed = Number(value ?? fallback)
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`expected a positive integer, received ${value}`)
  return parsed
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

async function collectGarbage(cdp) {
  await cdp.send('HeapProfiler.collectGarbage')
}

async function heapUsed(cdp) {
  const result = await cdp.send('Runtime.getHeapUsage')
  return result.usedSize
}

function buildMaterial(id, wordCount) {
  const wordsPerSegment = 8
  const segmentCount = Math.ceil(wordCount / wordsPerSegment)
  let globalIndex = 0
  const segments = Array.from({ length: segmentCount }, () => {
    const words = Array.from({ length: Math.min(wordsPerSegment, wordCount - globalIndex) }, () => {
      const index = globalIndex++
      return { word: `${id}-${index}`, start: index * 0.1, end: (index + 1) * 0.1 }
    })
    return { start: words[0].start, end: words.at(-1).end, words }
  })
  const chunks = segments.map((segment, index) => ({ id: index, chunks: [{ en: segment.words.map((word) => word.word).join(' '), zh: `${id}-${index}`, a: 1, b: segment.words.length }] }))
  return { id, wordCount, transcript: { segments }, chunks: { s: chunks } }
}

function makeSilentWavDataUrl(seconds, sampleRate = 8000) {
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
