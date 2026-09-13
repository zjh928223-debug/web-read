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
const diagnosticEnabled = process.env.READ_WEB_PLAYBACK_SCALE_DIAGNOSTIC === '1'
const diagnosticTracePath = process.env.READ_WEB_PLAYBACK_SCALE_TRACE
  ? path.resolve(process.env.READ_WEB_PLAYBACK_SCALE_TRACE)
  : null
const diagnosticTraceWordCount = Number(process.env.READ_WEB_PLAYBACK_SCALE_TRACE_WORD_COUNT || 10_000)
const modeDiagnosticEnabled = process.env.READ_WEB_PLAYBACK_SCALE_MODE_DIAGNOSTIC === '1'
const modeDiagnosticTracePath = process.env.READ_WEB_PLAYBACK_SCALE_MODE_TRACE
  ? path.resolve(process.env.READ_WEB_PLAYBACK_SCALE_MODE_TRACE)
  : null
const modeDiagnosticTraceWordCount = Number(process.env.READ_WEB_PLAYBACK_SCALE_MODE_TRACE_WORD_COUNT || 10_000)
const artifact = {
  schema: 'read-web.playback-scale-results',
  schemaVersion: 1,
  capturedAt: new Date().toISOString(),
  baseUrl,
  fixture: { schema: fixture.schema, version: fixture.version, offline: fixture.offline, path: path.relative(repoRoot, fixturePath) },
  errors: [],
  results: [],
}
const diagnosticStages = [
  ...(diagnosticEnabled ? ['sentence-highlight'] : []),
  ...(modeDiagnosticEnabled ? ['mode-switch-stable-frame'] : []),
]
if (diagnosticStages.length > 0) {
  artifact.diagnostics = { enabled: true, stages: diagnosticStages }
  if (diagnosticTracePath) artifact.diagnostics.trace = path.relative(repoRoot, diagnosticTracePath).replaceAll(path.sep, '/')
  if (modeDiagnosticTracePath) artifact.diagnostics.modeTrace = path.relative(repoRoot, modeDiagnosticTracePath).replaceAll(path.sep, '/')
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
    drainLongTasks() {
      const entries = [...this.longTasks]
      this.longTasks.length = 0
      return entries
    },
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
  await page.evaluate(() => {
    const button = document.getElementById('highlight-mode-btn')
    if (!button || typeof window.cycleHighlightMode !== 'function') {
      throw new Error('Highlight mode public control is unavailable')
    }
    let attempts = 0
    while (button.textContent?.trim() !== '高亮:词' && attempts < 3) {
      window.cycleHighlightMode()
      attempts += 1
    }
    if (button.textContent?.trim() !== '高亮:词') throw new Error('Unable to select word highlight mode')
    window.forceUpdateUI(0, { wordIndex: 0 })
  })
  for (let index = 0; index < fixture.interactionsPerOperation; index += 1) {
    samples.word.push(await sample(page, (wordIndex) => {
      const word = document.querySelector(`#transcript-vue-container [data-word-index="${wordIndex}"]`)
      const start = Number(word?.getAttribute('data-word-start'))
      if (!Number.isFinite(start)) throw new Error(`Missing DOM word start for index ${wordIndex}`)
      window.forceUpdateUI(start, { wordIndex })
    }, index))
  }
  await page.evaluate(() => window.toggleChunkMode(true))
  await page.locator(`#chunk-${material.segmentCount - 1}`).waitFor({ state: 'attached', timeout: 30_000 })
  for (let index = 0; index < fixture.interactionsPerOperation; index += 1) {
    samples.chunk.push(await sample(page, (chunkIndex) => {
      const chunk = document.querySelector(`#chunk-${chunkIndex}`)
      const firstWord = chunk?.querySelector('[data-word-start]')
      const start = Number(firstWord?.getAttribute('data-word-start'))
      if (!Number.isFinite(start)) throw new Error(`Missing DOM chunk start for index ${chunkIndex}`)
      window.forceUpdateUI(start + 0.001)
    }, index))
  }
  await page.evaluate(() => window.toggleChunkMode(false))
  for (let index = 0; index < fixture.interactionsPerOperation; index += 1) {
    samples.seek.push(await sample(page, (wordIndex) => {
      const word = document.querySelector(`#transcript-vue-container [data-word-index="${wordIndex}"]`)
      const start = Number(word?.getAttribute('data-word-start'))
      if (!Number.isFinite(start)) throw new Error(`Missing DOM word start for index ${wordIndex}`)
      const audio = document.getElementById('audio-player')
      audio.currentTime = (wordIndex % 90) / 100
      audio.dispatchEvent(new Event('seeking'))
      window.forceUpdateUI(start, { wordIndex })
      audio.dispatchEvent(new Event('seeked'))
    }, index))
  }
  for (let index = 0; index < fixture.interactionsPerOperation; index += 1) {
    samples.mark.push(await sample(page, (wordIndex) => {
      const word = document.querySelector(`#transcript-vue-container [data-word-index="${wordIndex}"]`)
      const start = Number(word?.getAttribute('data-word-start'))
      if (!Number.isFinite(start)) throw new Error(`Missing DOM word start for index ${wordIndex}`)
      window.forceUpdateUI(start, { wordIndex })
      const markKey = document.getElementById('hotkey-input')?.value || 'm'
      document.dispatchEvent(new KeyboardEvent('keydown', { key: markKey, bubbles: true }))
    }, index))
  }
  for (let index = 0; index < fixture.interactionsPerOperation; index += 1) {
    samples.mode.push(await sample(page, () => window.toggleChunkMode(), null, false))
  }
  await page.waitForFunction(() => {
    const transcript = document.getElementById('transcript-vue-container')
    const chunk = document.getElementById('chunk-vue-container')
    return transcript?.classList.contains('reader-view-hidden') === false
      && chunk?.classList.contains('reader-view-hidden') === true
      && transcript.querySelectorAll('.word-highlight').length === 1
      && chunk.querySelectorAll('.chunk-active').length === 0
  })
  const afterOperations = await listenerSnapshot(page)
  const runtime = await page.evaluate(() => ({
    longTasks: [...window.__playbackScaleProbe.longTasks],
    wordCount: document.querySelectorAll('#transcript-vue-container [data-word-index]').length,
    chunkCount: document.querySelectorAll('#chunk-vue-container .chunk-block').length,
    markedWords: document.querySelectorAll('#transcript-vue-container [data-word-index].marked').length,
    finalMode: document.getElementById('chunk-vue-container')?.classList.contains('reader-view-hidden') ? 'transcript' : 'chunk',
    activeWordCount: document.querySelectorAll('#transcript-vue-container .word-highlight').length,
    activeChunkCount: document.querySelectorAll('#chunk-vue-container .chunk-active').length,
  }))
  const diagnostics = {}
  if (diagnosticEnabled) {
    const runWithTrace = diagnosticTracePath && wordCount === diagnosticTraceWordCount
    const sentenceHighlight = runWithTrace
      ? await captureSentenceHighlightTrace(page, material, diagnosticTracePath)
      : await runSentenceHighlightDiagnostic(page, material)
    diagnostics.sentenceHighlight = sentenceHighlight
  }
  if (modeDiagnosticEnabled) {
    const runWithTrace = modeDiagnosticTracePath && wordCount === modeDiagnosticTraceWordCount
    const modeSwitchStableFrame = runWithTrace
      ? await captureTrace(page, modeDiagnosticTracePath, () => runModeSwitchStableFrameDiagnostic(page))
      : await runModeSwitchStableFrameDiagnostic(page)
    diagnostics.modeSwitchStableFrame = modeSwitchStableFrame
  }
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
    ...(Object.keys(diagnostics).length > 0 ? { diagnostics } : {}),
  }
}
async function runSentenceHighlightDiagnostic(page, material) {
  const previous = await page.evaluate(() => ({
    highlightMode: document.getElementById('highlight-mode-btn')?.textContent?.trim() || '',
    chunkMode: document.getElementById('chunk-vue-container')?.classList.contains('reader-view-hidden') === false,
  }))
  const targetCount = fixture.interactionsPerOperation
  if (material.segmentCount < targetCount) {
    throw new Error(`Sentence diagnostic needs ${targetCount} segments, received ${material.segmentCount}`)
  }
  try {
    await page.evaluate(() => {
      if (document.getElementById('chunk-vue-container')?.classList.contains('reader-view-hidden') === false) {
        window.toggleChunkMode(false)
      }
      const button = document.getElementById('highlight-mode-btn')
      if (!button || typeof window.cycleHighlightMode !== 'function') {
        throw new Error('Highlight mode public control is unavailable for sentence diagnostic')
      }
      let attempts = 0
      while (button.textContent?.trim() !== '高亮:句' && attempts < 3) {
        window.cycleHighlightMode()
        attempts += 1
      }
      if (button.textContent?.trim() !== '高亮:句') {
        throw new Error('Unable to select sentence highlight mode')
      }
    })
    await page.waitForFunction(() => {
      const transcript = document.getElementById('transcript-vue-container')
      const chunk = document.getElementById('chunk-vue-container')
      const button = document.getElementById('highlight-mode-btn')
      return transcript?.classList.contains('reader-view-hidden') === false
        && chunk?.classList.contains('reader-view-hidden') === true
        && button?.textContent?.trim() === '高亮:句'
        && document.body.classList.contains('highlight-sentence-mode')
    })
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve())))
    await page.evaluate(() => window.__playbackScaleProbe.resetLongTasks())
    const targets = Array.from({ length: targetCount }, (_, index) => index)
    const samples = []
    const longTasks = []
    for (const target of targets) {
      const segment = material.transcript.segments[target]
      samples.push(await sample(page, (time) => window.forceUpdateUI(time), segment.start + 0.001))
      longTasks.push(...await collectLongTasks(page))
      const correctness = await page.evaluate((segmentIndex) => {
        const targetElement = document.getElementById(`segment-${segmentIndex}`)
        const activeElements = [...document.querySelectorAll('#transcript-vue-container .sentence-active')]
        return {
          targetActive: targetElement?.classList.contains('sentence-active') === true,
          activeCount: activeElements.length,
          activeId: activeElements[0]?.id || '',
        }
      }, target)
      if (!correctness.targetActive || correctness.activeCount !== 1 || correctness.activeId !== `segment-${target}`) {
        throw new Error(`Sentence highlight correctness failed for segment ${target}`)
      }
      await page.evaluate(() => new Promise((resolve) => setTimeout(() => {
        window.__playbackScaleProbe.resetLongTasks()
        resolve()
      }, 0)))
    }
    const runtime = await page.evaluate(() => {
      const transcript = document.getElementById('transcript-vue-container')
      const chunk = document.getElementById('chunk-vue-container')
      return {
        visibleMode: transcript?.classList.contains('reader-view-hidden') === false ? 'transcript' : 'chunk',
        transcript: {
          visible: transcript?.classList.contains('reader-view-hidden') === false,
          wordCount: transcript?.querySelectorAll('[data-word-index]').length || 0,
          segmentCount: transcript?.querySelectorAll('[id^="segment-"]').length || 0,
        },
        chunk: {
          visible: chunk?.classList.contains('reader-view-hidden') === false,
          wordCount: chunk?.querySelectorAll('[data-word-index]').length || 0,
          chunkCount: chunk?.querySelectorAll('.chunk-block').length || 0,
        },
        activeSentenceCount: transcript?.querySelectorAll('.sentence-active').length || 0,
        activeSentenceId: transcript?.querySelector('.sentence-active')?.id || '',
      }
    })
    return {
      samples,
      targets,
      longTasks,
      view: {
        visibleMode: runtime.visibleMode,
        transcript: runtime.transcript,
        chunk: runtime.chunk,
      },
      correctness: {
        sampleCount: samples.length,
        targetCount: targets.length,
        firstTarget: targets[0],
        lastTarget: targets.at(-1),
        activeSentenceCount: runtime.activeSentenceCount,
        activeSentenceId: runtime.activeSentenceId,
      },
    }
  } finally {
    await restorePlaybackScaleState(page, previous)
  }
}

async function restorePlaybackScaleState(page, previous) {
  await page.evaluate((targetChunkMode) => {
    const chunkVisible = document.getElementById('chunk-vue-container')?.classList.contains('reader-view-hidden') === false
    if (chunkVisible !== targetChunkMode) window.toggleChunkMode(targetChunkMode)
  }, previous.chunkMode)
  await page.evaluate((targetHighlightMode) => {
    const button = document.getElementById('highlight-mode-btn')
    if (!button || typeof window.cycleHighlightMode !== 'function') return
    let attempts = 0
    while (button.textContent?.trim() !== targetHighlightMode && attempts < 3) {
      window.cycleHighlightMode()
      attempts += 1
    }
    if (button.textContent?.trim() !== targetHighlightMode) {
      throw new Error(`Unable to restore highlight mode ${targetHighlightMode}`)
    }
  }, previous.highlightMode)
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve())))
}
async function runModeSwitchStableFrameDiagnostic(page) {
  const previous = await page.evaluate(() => ({ highlightMode: document.getElementById('highlight-mode-btn')?.textContent?.trim() || '', chunkMode: document.getElementById('chunk-vue-container')?.classList.contains('reader-view-hidden') === false }))
  const transitionCount = 20
  const samples = { transcriptToChunk: [], chunkToTranscript: [] }
  try {
    await page.evaluate(() => {
      const chunk = document.getElementById('chunk-vue-container')
      if (chunk?.classList.contains('reader-view-hidden') === false) window.toggleChunkMode(false)
      const audio = document.getElementById('audio-player')
      if (audio) audio.currentTime = 0.11
      window.forceUpdateUI(0.11)
    })
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)))
    for (let index = 0; index < transitionCount; index += 1) {
      const targetChunkMode = index % 2 === 0
      const started = performance.now()
      await page.evaluate((target) => window.toggleChunkMode(target), targetChunkMode)
      await page.waitForFunction((target) => {
        const transcript = document.getElementById('transcript-vue-container')
        const chunk = document.getElementById('chunk-vue-container')
        if (!transcript || !chunk) return false
        const transcriptVisible = !transcript.classList.contains('reader-view-hidden')
        const chunkVisible = !chunk.classList.contains('reader-view-hidden')
        const activeRoot = target ? chunk : transcript
        return transcriptVisible === !target
          && chunkVisible === target
          && activeRoot.querySelectorAll('.word-highlight').length === 1
          && !transcript.querySelector('.sentence-active')
      }, targetChunkMode, { timeout: 30_000 })
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)))
      samples[targetChunkMode ? 'transcriptToChunk' : 'chunkToTranscript'].push(performance.now() - started)
    }
    const finalState = await page.evaluate(() => {
      const transcript = document.getElementById('transcript-vue-container')
      const chunk = document.getElementById('chunk-vue-container')
      return {
        visibleMode: chunk?.classList.contains('reader-view-hidden') ? 'transcript' : 'chunk',
        activeWordCount: document.querySelectorAll('#transcript-vue-container .word-highlight, #chunk-vue-container .word-highlight').length,
        activeChunkCount: chunk?.querySelectorAll('.chunk-active').length || 0,
        activeSentenceCount: transcript?.querySelectorAll('.sentence-active').length || 0,
      }
    })
    return {
      transitionCount,
      samples,
      correctness: { transitionCount, transcriptToChunkCount: samples.transcriptToChunk.length, chunkToTranscriptCount: samples.chunkToTranscript.length, allStatesValid: true, finalVisibleMode: finalState.visibleMode, finalActiveWordCount: finalState.activeWordCount, finalActiveChunkCount: finalState.activeChunkCount, finalActiveSentenceCount: finalState.activeSentenceCount },
    }
  } finally {
    await restorePlaybackScaleState(page, previous)
  }
}

function collectLongTasks(page) {
  return page.evaluate(() => new Promise((resolve) => setTimeout(() => {
    resolve(window.__playbackScaleProbe.drainLongTasks())
  }, 0)))
}

async function captureSentenceHighlightTrace(page, material, tracePath) {
  return captureTrace(page, tracePath, () => runSentenceHighlightDiagnostic(page, material))
}

async function captureTrace(page, tracePath, operation) {
  const cdp = await page.context().newCDPSession(page)
  const tracingComplete = new Promise((resolve) => cdp.once('Tracing.tracingComplete', resolve))
  let tracingStarted = false
  try {
    await cdp.send('Tracing.start', {
      categories: 'devtools.timeline,disabled-by-default-devtools.timeline,v8.execute,blink.user_timing',
      options: 'record-until-full',
      transferMode: 'ReturnAsStream',
    })
    tracingStarted = true
    return await operation()
  } finally {
    if (tracingStarted) {
      await cdp.send('Tracing.end')
      const { stream } = await tracingComplete
      const chunks = []
      let eof = false
      while (stream && !eof) {
        const response = await cdp.send('IO.read', { handle: stream })
        if (response.data) chunks.push(response.data)
        eof = response.eof === true
      }
      if (stream) await cdp.send('IO.close', { handle: stream }).catch(() => {})
      await mkdir(path.dirname(tracePath), { recursive: true })
      await writeFile(tracePath, chunks.join(''), 'utf8')
    }
    await cdp.detach().catch(() => {})
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
