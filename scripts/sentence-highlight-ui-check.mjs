import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { spawn, spawnSync } from 'node:child_process'
import http from 'node:http'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { chromium } from 'playwright'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const host = '127.0.0.1'
const port = Number(process.env.READ_WEB_SENTENCE_HIGHLIGHT_PORT || 4197)
const explicitUrl = String(process.env.READ_WEB_SENTENCE_HIGHLIGHT_URL || process.env.READ_WEB_URL || '').trim()
const targetUrl = explicitUrl || `http://${host}:${port}/`
const reservedPorts = new Set([5173, 5174, 8765, 8766, 4198])
if (!explicitUrl && reservedPorts.has(port)) throw new Error(`sentence highlight check refuses reserved port ${port}`)

const materialA = buildMaterial('A')
const materialB = buildMaterial('B')
const consoleErrors = []
const pageErrors = []
let server = null
let browser = null

try {
  if (!explicitUrl) {
    if (await canReach(targetUrl)) throw new Error(`sentence highlight check will not reuse existing service at ${targetUrl}`)
    const viteBin = path.join(path.dirname(require.resolve('vite/package.json')), 'bin', 'vite.js')
    server = spawn(process.execPath, [viteBin, '--host', host, '--port', String(port), '--strictPort', '--clearScreen', 'false'], {
      cwd: repoRoot,
      env: process.env,
      stdio: 'ignore',
      windowsHide: true,
    })
    if (!await waitForServer(targetUrl)) throw new Error(`isolated Vite did not start at ${targetUrl}`)
  }

  browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const origin = new URL(targetUrl).origin
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname.startsWith('/api/')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ status: 'ok', jobs: [], items: [], revision: 1 }),
      })
    } else if (url.origin === origin || url.protocol === 'data:' || url.protocol === 'blob:') {
      await route.continue()
    } else {
      await route.fulfill({ status: 204, body: '' })
    }
  })

  const page = await context.newPage()
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()) })
  page.on('pageerror', (error) => pageErrors.push(error.message))

  await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 })
  await page.locator('[data-vue-mounted]').waitFor({ state: 'attached', timeout: 15_000 })
  await page.waitForFunction(() => typeof window.processTranscript === 'function' && typeof window.forceUpdateUI === 'function')
  await page.evaluate(async () => {
    window.__sentenceHighlightStores = (await import('/src/pinia-stores/runtime-registry.js')).requirePiniaRuntimeStores()
    window.__sentenceHighlightRuntimeState = (await import('/src/composables/runtime-state-facade.js')).runtimeState
  })

  await page.evaluate(({ material, audioSrc }) => {
    window.processTranscript(material.transcript)
    window.processChunkData(material.chunks)
    window.toggleChunkMode(false)
    const audio = document.getElementById('audio-player')
    audio.src = audioSrc
    audio.muted = true
  }, { material: materialA, audioSrc: makeSilentWavDataUrl(8) })
  await page.locator('#segment-2').waitFor({ state: 'attached', timeout: 10_000 })
  await waitForNextAnimationFrame(page)
  await waitForViewMode(page, 'transcript')

  await page.evaluate(() => {
    window.__sentenceHighlightStores.chunk.isChunkMode = true
  })
  await waitForViewMode(page, 'chunk')
  await page.evaluate(() => {
    window.__sentenceHighlightStores.chunk.isChunkMode = false
  })
  await waitForViewMode(page, 'transcript')

  await setTranscriptState(page, 2, -1)
  await waitForSentenceIds(page, [])
  await setTranscriptState(page, 2, 0)
  await waitForSentenceIds(page, ['segment-0'])
  await setTranscriptState(page, 2, 1)
  await waitForSentenceIds(page, ['segment-1'])

  for (const invalidIndex of [-1, 99, 1.5, '1']) {
    await setTranscriptState(page, 2, invalidIndex)
    await waitForSentenceIds(page, [])
  }

  await setTranscriptState(page, 2, 1)
  await page.evaluate(() => {
    const audio = document.getElementById('audio-player')
    audio.currentTime = 2.2
    window.cycleHighlightMode()
  })
  await page.waitForFunction(() => document.getElementById('highlight-mode-btn')?.textContent.trim() === '高亮:关')
  await waitForSentenceIds(page, [])
  await page.evaluate(() => window.cycleHighlightMode())
  await page.waitForFunction(() => document.getElementById('highlight-mode-btn')?.textContent.trim() === '高亮:词')
  await waitForSentenceIds(page, [])

  await page.evaluate((material) => {
    const store = window.__sentenceHighlightStores.transcript
    store.highlightMode = 2
    store.activeSegIdx = 1
    window.processTranscript(material.transcript)
    window.processChunkData(material.chunks)
    window.toggleChunkMode(false)
  }, materialB)
  await waitForSegmentText(page, 1, 'B sentence 1')

  await page.evaluate(() => window.processTranscript({ segments: [] }))
  await page.waitForFunction(() => document.querySelectorAll('#transcript-vue-container [id^="segment-"]').length === 0)
  await waitForSentenceIds(page, [])
  await page.evaluate((material) => {
    const store = window.__sentenceHighlightStores.transcript
    store.activeSegIdx = 1
    window.processTranscript(material.transcript)
    window.processChunkData(material.chunks)
    window.toggleChunkMode(false)
  }, materialB)
  await waitForSegmentText(page, 1, 'B sentence 1')

  await page.evaluate(() => {
    const runtime = window.__sentenceHighlightRuntimeState
    const store = window.__sentenceHighlightStores.transcript
    runtime.markedMap.clear()
    store.activeSegIdx = 1
    const details = document.getElementById('note-1')
    if (details) details.open = true
  })
  // Exercise the retained mark owner; the retired preview state no longer forces a render.
  await page.locator('#word-2').click()
  await page.keyboard.press('m')
  await page.waitForFunction(() => {
    const active = document.querySelectorAll('#transcript-vue-container .sentence-active')
    return active.length === 1
      && active[0].id === 'segment-1'
      && document.querySelector('#word-2')?.classList.contains('marked')
      && document.getElementById('note-1')?.open === true
  })

  await page.evaluate(() => {
    const audio = document.getElementById('audio-player')
    audio.currentTime = 2.2
    window.cycleHighlightMode()
  })
  await page.waitForFunction(() => document.getElementById('highlight-mode-btn')?.textContent.trim() === '高亮:关')
  await waitForSentenceIds(page, [])
  await page.evaluate(() => window.cycleHighlightMode())
  await page.waitForFunction(() => document.getElementById('highlight-mode-btn')?.textContent.trim() === '高亮:词')
  await page.waitForSelector('#word-2.word-highlight', { timeout: 10_000 })
  await waitForSentenceIds(page, [])

  await page.evaluate(() => {
    const audio = document.getElementById('audio-player')
    window.toggleChunkMode(true)
    audio.currentTime = 2.2
    window.forceUpdateUI(2.2)
  })
  await page.waitForFunction(() => {
    const transcript = document.getElementById('transcript-vue-container')
    const chunk = document.getElementById('chunk-vue-container')
    return chunk?.classList.contains('reader-view-hidden') === false
      && transcript?.classList.contains('reader-view-hidden') === true
      && chunk.querySelectorAll('.chunk-active').length === 1
      && chunk.querySelector('.chunk-active')?.id === 'chunk-1'
      && transcript.querySelectorAll('.sentence-active').length === 0
      && chunk.querySelector('#chunk-word-2')?.classList.contains('marked')
  }, null, { timeout: 10_000 })

  await page.evaluate(() => {
    window.__sentenceHighlightFocusBefore = document.getElementById('chunk-vue-container')?.classList.contains('cn-mode-focus') === true
    window.toggleChunkFocusMode()
  })
  await page.waitForFunction(() => {
    const transcript = document.getElementById('transcript-vue-container')
    const chunk = document.getElementById('chunk-vue-container')
    return chunk?.classList.contains('reader-view-hidden') === false
      && transcript?.classList.contains('reader-view-hidden') === true
      && chunk.classList.contains('cn-mode-focus') !== window.__sentenceHighlightFocusBefore
  })
  await page.evaluate(() => window.toggleChunkFocusMode())
  await page.waitForFunction(() => document.getElementById('chunk-vue-container')?.classList.contains('cn-mode-focus') === window.__sentenceHighlightFocusBefore)

  const chunkCnKey = (await page.locator('#hotkey-chunk-cn-input').inputValue()) || 'c'
  await page.evaluate(() => {
    const store = window.__sentenceHighlightStores.chunk
    store.chunkCNVisible = false
    store.chunkCNHoldMode = false
  })
  await page.waitForFunction(() => {
    const translations = [...document.querySelectorAll('#chunk-vue-container .chunk-cn')]
    return translations.length > 0 && translations.every((element) => element.classList.contains('hidden-cn'))
  })
  await page.keyboard.press(chunkCnKey)
  await page.waitForFunction(() => {
    const translations = [...document.querySelectorAll('#chunk-vue-container .chunk-cn')]
    return translations.length > 0 && translations.every((element) => !element.classList.contains('hidden-cn'))
  })
  await page.keyboard.press(chunkCnKey)
  await page.waitForFunction(() => {
    const translations = [...document.querySelectorAll('#chunk-vue-container .chunk-cn')]
    return translations.length > 0 && translations.every((element) => element.classList.contains('hidden-cn'))
  })

  await page.evaluate(() => {
    const store = window.__sentenceHighlightStores.chunk
    store.chunkCNVisible = false
    store.chunkCNHoldMode = true
  })
  await page.waitForFunction(() => {
    const translations = [...document.querySelectorAll('#chunk-vue-container .chunk-cn')]
    return translations.length > 0 && translations.every((element) => element.classList.contains('hidden-cn'))
  })
  await page.keyboard.down(chunkCnKey)
  await page.waitForFunction(() => {
    const translations = [...document.querySelectorAll('#chunk-vue-container .chunk-cn')]
    return translations.length > 0 && translations.every((element) => !element.classList.contains('hidden-cn'))
  })
  await page.keyboard.up(chunkCnKey)
  await page.waitForFunction(() => {
    const translations = [...document.querySelectorAll('#chunk-vue-container .chunk-cn')]
    return translations.length > 0 && translations.every((element) => element.classList.contains('hidden-cn'))
  })

  await page.evaluate(() => window.toggleChunkMode(false))
  await page.waitForFunction(() => document.getElementById('chunk-vue-container')?.classList.contains('reader-view-hidden') === true)
  await page.evaluate(() => window.cycleHighlightMode())
  await waitForSentenceIds(page, ['segment-1'])
  assert.equal(await page.locator('#transcript-vue-container .sentence-active').count(), 1)

  await page.evaluate(() => {
    const root = document.getElementById('vue-root')
    const app = root?.__vue_app__
    const activeElement = document.querySelector('#transcript-vue-container .sentence-active')
    if (!app || typeof app.unmount !== 'function') throw new Error('Vue app unmount handle is unavailable')
    if (!activeElement) throw new Error('Active sentence is unavailable before unmount')
    const pinia = Reflect.ownKeys(app._context?.provides || {})
      .map((key) => app._context.provides[key])
      .find((value) => value?._s instanceof Map)
    if (!pinia) throw new Error('Pinia remount instance is unavailable')
    window.__sentenceHighlightStores.chunk.isChunkMode = true
    window.__sentenceHighlightUnmountProbe = activeElement
    window.__sentenceHighlightRemountPinia = pinia
    app.unmount()
  })
  await page.waitForFunction(() => {
    const oldElement = window.__sentenceHighlightUnmountProbe
    return oldElement instanceof HTMLElement
      && !oldElement.classList.contains('sentence-active')
      && document.getElementById('transcript-vue-container') === null
      && document.getElementById('chunk-vue-container') === null
  }, null, { timeout: 10_000 })
  await page.evaluate(() => {
    window.__sentenceHighlightStores.transcript.activeSegIdx = 2
  })
  await page.waitForTimeout(100)
  assert.equal(await page.locator('#transcript-vue-container').count(), 0)

  await page.evaluate(async () => {
    const root = document.getElementById('vue-root')
    const pinia = window.__sentenceHighlightRemountPinia
    if (!root || !pinia) throw new Error('Vue app remount dependencies are unavailable')
    const response = await fetch('/src/App.vue')
    if (!response.ok) throw new Error('Current App module is unavailable for remount')
    const appModule = await response.text()
    const vueUrl = appModule.match(/from\s+["']([^"']*\/vue\.js(?:\?[^"']*)?)["']/)?.[1]
    if (!vueUrl) throw new Error('Current Vite Vue dependency is unavailable for remount')
    const [{ createApp }, { default: App }] = await Promise.all([
      import(vueUrl),
      import('/src/App.vue'),
    ])
    const app = createApp(App)
    app.use(pinia)
    app.mount(root)
  })
  await waitForViewMode(page, 'chunk')

  await page.evaluate(() => {
    const chunk = window.__sentenceHighlightStores.chunk
    window.__sentenceHighlightExpectedFocus = !chunk.chunkFocusMode
    chunk.chunkFocusMode = window.__sentenceHighlightExpectedFocus
  })
  await page.waitForFunction(() => {
    const transcript = document.getElementById('transcript-vue-container')
    const chunk = document.getElementById('chunk-vue-container')
    return chunk?.classList.contains('reader-view-hidden') === false
      && transcript?.classList.contains('reader-view-hidden') === true
      && chunk.classList.contains('cn-mode-focus') === window.__sentenceHighlightExpectedFocus
  })

  await page.evaluate(() => {
  })
  await page.waitForFunction(() => {
    const transcript = document.getElementById('transcript-vue-container')
    const chunk = document.getElementById('chunk-vue-container')
    return chunk?.classList.contains('reader-view-hidden') === false
      && transcript?.classList.contains('reader-view-hidden') === true
  })

  assert.deepEqual(consoleErrors, [])
  assert.deepEqual(pageErrors, [])
  console.log('sentence highlight UI check passed')
} finally {
  await browser?.close()
  killTree(server)
}

function buildMaterial(label) {
  const segments = Array.from({ length: 3 }, (_, index) => ({
    start: index * 2,
    end: index * 2 + 1.5,
    translation: `B sentence ${index}`,
    words: [
      { word: `${label}-${index}-one`, start: index * 2, end: index * 2 + 0.7 },
      { word: `${label}-${index}-two`, start: index * 2 + 0.7, end: index * 2 + 1.5 },
    ],
  }))
  const chunks = segments.map((segment, id) => ({
    id,
    chunks: [{ en: segment.words.map((word) => word.word).join(' '), zh: `${label} chunk ${id}`, a: 1, b: 2 }],
  }))
  return { transcript: { segments }, chunks: { s: chunks } }
}

function makeSilentWavDataUrl(seconds = 6, sampleRate = 8000) {
  const numSamples = seconds * sampleRate
  const dataSize = numSamples * 2
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

function setTranscriptState(page, highlightMode, activeSegIdx) {
  return page.evaluate(({ highlightMode: mode, activeSegIdx: index }) => {
    const store = window.__sentenceHighlightStores.transcript
    store.highlightMode = mode
    store.activeSegIdx = index
  }, { highlightMode, activeSegIdx })
}

function waitForSentenceIds(page, expected) {
  return page.waitForFunction((ids) => {
    const actual = [...document.querySelectorAll('#transcript-vue-container .sentence-active')].map((element) => element.id)
    return actual.length === ids.length && actual.every((id, index) => id === ids[index])
  }, expected, { timeout: 10_000 })
}

function waitForViewMode(page, expected) {
  return page.waitForFunction((mode) => {
    const transcript = document.getElementById('transcript-vue-container')
    const chunk = document.getElementById('chunk-vue-container')
    const transcriptVisible = transcript?.classList.contains('reader-view-hidden') === false
    const chunkVisible = chunk?.classList.contains('reader-view-hidden') === false
    return mode === 'chunk'
      ? transcriptVisible === false && chunkVisible === true
      : transcriptVisible === true && chunkVisible === false
  }, expected, { timeout: 10_000 })
}

function waitForSegmentText(page, index, text) {
  return page.waitForFunction(({ index: segmentIndex, text: expectedText }) => {
    const element = document.getElementById(`segment-${segmentIndex}`)
    return element?.classList.contains('sentence-active') === true && element.textContent.includes(expectedText)
  }, { index, text }, { timeout: 10_000 })
}

function waitForNextAnimationFrame(page) {
  return page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)))
}

function canReach(url) {
  return new Promise((resolve) => {
    const request = http.get(url, (response) => {
      response.resume()
      resolve(response.statusCode >= 200 && response.statusCode < 500)
    })
    request.once('error', () => resolve(false))
    request.setTimeout(750, () => { request.destroy(); resolve(false) })
  })
}

async function waitForServer(url, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await canReach(url)) return true
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  return false
}

function killTree(child) {
  if (!child || child.exitCode !== null) return
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
  } else {
    child.kill('SIGTERM')
  }
}
