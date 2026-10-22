import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { listenOnBrowserSafePort } from './lib/browser-port-policy.mjs'

// Real SrsReviewPage + App's retained active/v-show assembly, synthetic service,
// intercepted business requests and media-call probes. This does not test audible
// output, the live Host, or the existing optimization production snapshot.
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(path.join(repo, 'package.json'))
const { chromium } = require('playwright')
const { build } = await import(pathToFileURL(require.resolve('vite')).href)
const vue = (await import(pathToFileURL(require.resolve('@vitejs/plugin-vue')).href)).default
const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'read-web-srs-media-'))
const hash = (value) => createHash('sha256').update(value).digest('hex')
const slash = (value) => value.replaceAll('\\', '/')
const wav = Buffer.from('UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=', 'base64')
let bundle = ''
let css = ''
const server = http.createServer((req, res) => {
  if (req.url === '/') {
    res.setHeader('content-type', 'text/html')
    res.end(`<!doctype html><title>SRS media lifecycle fixture</title><style>${css}\n#unmount{position:fixed;right:0;top:0;z-index:10001}</style><div id="app"></div><script type="module" src="/fixture.js"></script>`)
  } else if (req.url === '/fixture.js') {
    res.setHeader('content-type', 'application/javascript')
    res.end(bundle)
  } else {
    res.writeHead(404)
    res.end()
  }
})
const results = []
let browser

function deferred() {
  let resolve
  const promise = new Promise((done) => { resolve = done })
  return { promise, resolve }
}

async function barrier(promise, label) {
  let timer
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Timed out: ${label}`)), 10000)
    })])
  } finally { clearTimeout(timer) }
}

async function frames(page) {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
}

async function runCase(name, options, journey) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' })
  const page = await context.newPage()
  const errors = []
  const unexpected = []
  const requests = []
  const requested = deferred()
  const released = deferred()
  const returned = deferred()
  const translations = (options.translations || []).map((text) => ({ text, requested: deferred(), released: deferred(), returned: deferred() }))
  const translationRequests = []
  let gateUsed = false
  await context.routeWebSocket('**/*', (socket) => socket.close())
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => { if (['error', 'warning'].includes(message.type())) errors.push(message.text()) })
  await context.addInitScript((scenario) => {
    window.__scenario = scenario
    window.__probe = { plays: [], speaks: [], created: [], revoked: [], ratings: [], settled: [], translationSettled: [] }
    window.__mediaElements = []
    const hidden = () => {
      const root = document.querySelector('.srs-review-page')
      return !root || getComputedStyle(root).display === 'none'
    }
    HTMLMediaElement.prototype.play = function () {
      window.__mediaElements.push(this)
      window.__probe.plays.push({ src: this.src, hidden: hidden(), connected: this.isConnected })
      if (scenario.autoEnd !== false) queueMicrotask(() => this.dispatchEvent(new Event('ended')))
      return Promise.resolve()
    }
    HTMLMediaElement.prototype.pause = function () {}
    HTMLMediaElement.prototype.load = function () {}
    Object.defineProperty(HTMLMediaElement.prototype, 'readyState', { configurable: true, get: () => scenario.metadataPending ? 0 : 1 })
    const createUrl = URL.createObjectURL.bind(URL)
    const revokeUrl = URL.revokeObjectURL.bind(URL)
    URL.createObjectURL = (blob) => { const url = createUrl(blob); window.__probe.created.push(url); return url }
    URL.revokeObjectURL = (url) => { window.__probe.revoked.push(url); revokeUrl(url) }
    const nativeFetch = window.fetch.bind(window)
    window.fetch = async (...args) => {
      const response = await nativeFetch(...args)
      // Observe body consumption before a two-frame completion barrier.
      await response.clone().arrayBuffer()
      window.__probe.settled.push(String(args[0]))
      if (response.headers.has('x-fixture-translation')) window.__probe.translationSettled.push(Number(response.headers.get('x-fixture-translation')))
      return response
    }
    window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text } }
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
      getVoices: () => [{ name: 'Fixture US', lang: 'en-US' }], cancel() {},
      speak(utterance) { window.__probe.speaks.push({ text: utterance.text, hidden: hidden() }); queueMicrotask(() => utterance.onend?.()) },
    } })
  }, options)
  await context.route('**/*', async (route) => {
    const request = route.request()
    const url = request.url()
    const pathname = new URL(url).pathname
    requests.push({ url, method: request.method() })
    if (url === `${origin}/` || url === `${origin}/fixture.js`) return route.continue()
    if (!gateUsed && options.gate && url.includes(options.gate)) {
      gateUsed = true
      requested.resolve()
      await released.promise
    }
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
    if (pathname === '/api/vocabulary/sentence-translations' && options.translations) {
      const index = translationRequests.length
      const gate = translations[index]
      const items = request.postDataJSON().items
      assert.deepEqual(items, [{ id: 'srs-review-synthetic-0', sentence: 'A resilient system recovers.' }])
      translationRequests.push({ index, items, response: gate?.text })
      if (!gate) { unexpected.push({ url, method: request.method() }); return route.abort() }
      gate.requested.resolve()
      await gate.released.promise
      await route.fulfill({ contentType: 'application/json', headers: { 'x-fixture-translation': String(index) },
        // Malformed JSON exercises the product's catch/finally failure path.
        body: gate.text === null ? '{' : JSON.stringify({ items: items.map((item) => ({ ...item, translationZh: gate.text })) }),
      })
      gate.returned.resolve()
    } else if (pathname === '/api/dictionary/pronunciation') {
      await json(options.fallback ? {} : { audioUrl: `https://media.merriam-webster.com/audio/prons/en/us/mp3/r/${new URL(url).searchParams.get('word')}.mp3` })
    } else if (['/api/dictionary/pronunciations', '/api/dictionary/general-meanings', '/api/tts/edge/batch'].includes(pathname)) {
      await json({ items: [] })
    } else if (pathname === '/api/tts/edge' || pathname.startsWith('/api/v2/entries/en/')) {
      await json({})
    } else if (pathname.endsWith('/file/transcript')) {
      await json({ segments: [{ text: 'A resilient system recovers.', start: 0, end: 2 }] })
    } else if (pathname.endsWith('/file/chunkData')) {
      await json({ s: [{ chunks: [{ en: 'A resilient system recovers.', ...(options.translations ? {} : { zh: '有韧性的系统恢复。' }) }] }] })
    } else if (pathname.endsWith('/file/audio') || pathname.endsWith('.mp3')) {
      await route.fulfill({ contentType: 'audio/wav', body: wav })
    } else {
      unexpected.push({ url, method: request.method() })
      await route.abort()
    }
    if (gateUsed && options.gate && url.includes(options.gate)) returned.resolve(url)
  })
  const probe = () => page.evaluate(() => ({
    ...window.__probe,
    display: document.querySelector('.srs-review-page') ? getComputedStyle(document.querySelector('.srs-review-page')).display : null,
    pronunciationSrc: document.querySelector('.srs-review-pronunciation-audio')?.getAttribute('src') || '',
    sourceSrc: document.querySelector('.srs-review-audio audio')?.getAttribute('src') || '',
    phase: Boolean(document.querySelector('.srs-review-speaker.is-playing')),
    sourceLoading: Boolean(document.querySelector('.srs-review-audio-loading')),
    heading: document.querySelector('.srs-review-word-line h2')?.textContent,
    progress: document.querySelector('.srs-review-progress')?.textContent.trim(),
    answerRevealed: Boolean(document.querySelector('.srs-review-actions')) && !document.querySelector('.srs-review-reveal'),
    translationText: document.querySelector('.srs-review-sentence-translation')?.textContent.trim() || '',
    translationLoading: Boolean(document.querySelector('.srs-review-sentence-translation.is-loading')),
    translationUnavailable: Boolean(document.querySelector('.srs-review-sentence-translation.is-unavailable')),
  }))
  const release = async () => {
    released.resolve()
    const url = await barrier(returned.promise, `${name} response returned`)
    await page.waitForFunction((target) => window.__probe.settled.includes(target), url)
    await frames(page)
  }
  const waitTranslation = (index) => barrier(translations[index].requested.promise, `${name} translation ${index} requested`)
  const releaseTranslation = async (index) => {
    translations[index].released.resolve()
    await barrier(translations[index].returned.promise, `${name} translation ${index} returned`)
    await page.waitForFunction((target) => window.__probe.translationSettled.includes(target), index)
    await frames(page)
  }
  try {
    await page.goto(origin)
    assert.equal(await page.title(), 'SRS media lifecycle fixture')
    await page.locator('#enter').click()
    await page.locator('.srs-review-word-line h2').waitFor()
    assert.equal(await page.locator('vite-error-overlay').count(), 0)
    if (options.gate) await barrier(requested.promise, `${name} pending request`)
    await journey({ page, probe, release, waitTranslation, releaseTranslation, translationRequests })
    assert.deepEqual(unexpected, [], 'every business request must match a synthetic response')
    assert.deepEqual(errors, [], 'framework/browser console health')
    const after = await probe()
    assert.equal(after.plays.some((item) => item.hidden || !item.connected), false)
    assert.equal(after.speaks.some((item) => item.hidden), false)
    await page.screenshot({ path: path.join(outputDir, `${name}.png`) })
    results.push({ name, status: 'PASS', after, requests, translationRequests, errors, unexpected })
  } catch (error) {
    results.push({ name, status: 'FAIL', error: error.stack, observed: await probe(), requests, translationRequests, errors, unexpected })
    throw error
  } finally {
    released.resolve()
    translations.forEach((gate) => gate.released.resolve())
    await context.close()
  }
}

const close = async (page) => {
  await page.getByRole('button', { name: '返回阅读器', exact: true }).click()
  await page.locator('.srs-review-page').waitFor({ state: 'hidden' })
}
const noMedia = (state) => {
  assert.equal(state.plays.length, 0)
  assert.equal(state.speaks.length, 0)
  assert.equal(state.pronunciationSrc, '')
  assert.equal(state.sourceSrc, '')
  assert.equal(state.phase, false)
  assert.equal(state.sourceLoading, false)
}

const checkTranslation = (state, text) => {
  assert.equal(state.heading, 'resilient')
  assert.equal(state.progress, '复习 1 / 1')
  assert.equal(state.answerRevealed, true)
  assert.equal(state.ratings.length, 0)
  assert.equal(state.translationText, text)
  assert.equal(state.translationLoading, false)
  assert.equal(state.translationUnavailable, false)
  assert.equal(state.plays.length, 1, 'same-card reopen must not autoplay')
}
const revealForTranslation = async (page) => {
  await page.waitForFunction(() => window.__probe.plays.length === 1 && document.querySelector('.srs-review-audio audio'))
  await page.getByRole('button', { name: 'Space 显示答案', exact: true }).click()
}
const reopen = async (page) => {
  await page.locator('#enter').click()
  await page.locator('.srs-review-page').waitFor({ state: 'visible' })
}

let origin
try {
  origin = `http://127.0.0.1:${await listenOnBrowserSafePort(server)}`
  const entry = path.join(outputDir, 'fixture.js')
  fs.writeFileSync(entry, `
import { createApp, ref, h, KeepAlive, withDirectives, vShow } from '${slash(repo)}/node_modules/vue/dist/vue.runtime.esm-bundler.js';
import SrsReviewPage from '${slash(repo)}/src/features/srs-review/SrsReviewPage.vue';
import { youtubeWorkflowClient } from '${slash(repo)}/src/composables/youtube-workflow-client.js';
import '${slash(repo)}/src/features/srs-review/srs-review.css';
if(window.__scenario.source) { youtubeWorkflowClient.mediaUrl = undefined; youtubeWorkflowClient.fileUrl = undefined; }
const words = window.__scenario.twoCards ? ['resilient','subtle'] : ['resilient'];
const service = { getDueWords: async () => words.map((word,i)=>({word:{id:'synthetic-'+i,word,lemma:word,meaning:'有韧性的'},contexts:window.__scenario.source?[{source_id:'synthetic-source',sentence:'A resilient system recovers.',surrounding_text:'A resilient system recovers.'}]:[],reviewState:{state:'new'}})), getReviewLogs:async()=>[], reviewWord:async(...args)=>{window.__probe.ratings.push(args);return {}} };
createApp({ setup(){const open=ref(false), mounted=ref(false); return ()=>h('div',[h('button',{id:'enter',onClick:()=>{mounted.value=true;open.value=true}},'今日复习'),h('button',{id:'unmount',onClick:()=>mounted.value=false},'卸载'),mounted.value?h(KeepAlive,{}, {default:()=>withDirectives(h(SrsReviewPage,{active:open.value,service,onClose:()=>open.value=false}),[[vShow,open.value]])}):null]);} }).mount('#app');
`)
  const built = await build({ root: outputDir, envDir: outputDir, configFile: false, publicDir: false, logLevel: 'error',
    plugins: [vue(), {
      name: 'synthetic-multi-clip-pronunciation',
      // Current real resolver returns one clip. Only A4 injects two synthetic
      // clips at the dependency boundary; component/lifecycle code is unchanged.
      transform(code, id) {
        if (!id.endsWith('/srs-review-pronunciation.js')) return null
        return code.replace('export async function resolveAmericanPronunciationSequence(value, options = {}) {',
          `export async function resolveAmericanPronunciationSequence(value, options = {}) {
          if(globalThis.__scenario?.multiClip) return ['${origin}/clip-one.mp3','${origin}/clip-two.mp3'];`)
      },
    }], resolve: { alias: { '@': path.join(repo, 'src') } },
    define: { 'import.meta.env.VITE_LOCAL_SERVICE_BASE_URL': JSON.stringify(origin), 'import.meta.env.VITE_READ_WEB_SERVICE_TOKEN': '""' },
    build: { write: false, minify: false, rollupOptions: { input: entry, output: { inlineDynamicImports: true } } },
  })
  const output = (Array.isArray(built) ? built[0] : built).output
  const chunk = output.find((item) => item.type === 'chunk')
  assert.ok(Object.keys(chunk.modules).some((id) => id.endsWith('/use-srs-review-media.js')), 'real media composable must be built')
  assert.ok(Object.keys(chunk.modules).some((id) => id.endsWith('/use-srs-review-answer-translation.js')), 'real translation composable must be built')
  bundle = chunk.code
  css = output.filter((item) => item.type === 'asset' && item.fileName.endsWith('.css')).map((item) => String(item.source)).join('\n')
  fs.writeFileSync(path.join(outputDir, 'fixture-built.js'), bundle)
  fs.writeFileSync(path.join(outputDir, 'fixture-built.css'), css)
  fs.writeFileSync(path.join(outputDir, 'identity.json'), JSON.stringify({ origin, bundleHash: hash(bundle), cssHash: hash(css),
    sourceFiles: Object.keys(chunk.modules).filter((id) => fs.existsSync(id) && fs.statSync(id).isFile()).map((id) => ({ path: id, sha256: hash(fs.readFileSync(id)) })),
    browser: 'Browser plugin not available; installed Playwright Chromium',
    seam: 'A4 only: resolver returns two synthetic URLs; source blob scenarios disable client mediaUrl/fileUrl to exercise real resource-release path.',
  }, null, 2))
  browser = await chromium.launch({ headless: true })
  for (const fallback of [false, true]) {
    await runCase(fallback ? 'A1-close-fallback' : 'A1-close-recorded', { gate: '/api/dictionary/pronunciation?', fallback }, async ({ page, probe, release }) => {
      assert.equal((await probe()).plays.length, 0)
      await close(page)
      noMedia(await probe())
      await release()
      if (fallback) {
        await page.waitForFunction(() => window.__probe.settled.some((url) => url.includes('/api/v2/entries/en/')))
        await frames(page)
      }
      noMedia(await probe())
    })
  }
  for (const unmount of [false, true]) {
    await runCase(unmount ? 'A2-unmount-source' : 'A2-close-source', { gate: '/file/audio', source: true }, async ({ page, probe, release }) => {
      await page.waitForFunction(() => window.__probe.plays.length === 1)
      if (unmount) await page.locator('#unmount').click()
      else await close(page)
      await release()
      const after = await probe()
      if (unmount) assert.equal(after.display, null, 'KeepAlive container actually unmounted')
      assert.equal(after.sourceSrc, '')
      assert.equal(after.created.length, 1)
      assert.deepEqual(after.revoked, after.created, 'late blob source released')
      assert.equal(after.plays.length, 1)
    })
  }
  await runCase('A3-switch-card', { gate: '/api/dictionary/pronunciation?word=resilient', twoCards: true }, async ({ page, probe, release }) => {
    await page.getByRole('button', { name: 'Space 显示答案', exact: true }).click()
    await page.getByRole('button', { name: '一般', exact: true }).click()
    await page.waitForFunction(() => document.querySelector('.srs-review-word-line h2')?.textContent === 'subtle' && window.__probe.plays.length === 1)
    await release()
    const after = await probe()
    assert.equal(after.heading, 'subtle')
    assert.equal(after.plays.length, 1)
    assert.match(after.pronunciationSrc, /subtle/)
    assert.equal(after.ratings.length, 1)
  })
  await runCase('A3-reopen-same-card', { gate: '/api/dictionary/pronunciation?' }, async ({ page, probe, release }) => {
    await close(page)
    await page.locator('#enter').click()
    await release()
    assert.equal((await probe()).plays.length, 0, 'reopen retains existing manual replay behavior')
    await page.getByRole('button', { name: '朗读 resilient', exact: true }).click()
    await page.waitForFunction(() => window.__probe.plays.length === 1)
    assert.match((await probe()).pronunciationSrc, /resilient/)
  })
  await runCase('A3-normal-replay-sentence-rating', { source: true, twoCards: true }, async ({ page, probe }) => {
    await page.waitForFunction(() => window.__probe.plays.length === 1 && document.querySelector('.srs-review-audio audio'))
    await page.getByRole('button', { name: '朗读 resilient', exact: true }).click()
    await page.waitForFunction(() => window.__probe.plays.length === 2)
    await page.keyboard.press('s')
    await page.waitForFunction(() => window.__probe.plays.length === 3)
    const state = await probe()
    assert.match(state.plays[2].src, /^blob:/)
    await page.getByRole('button', { name: 'Space 显示答案', exact: true }).click()
    await page.getByRole('button', { name: '一般', exact: true }).click()
    await page.waitForFunction(() => document.querySelector('.srs-review-word-line h2')?.textContent === 'subtle')
    await page.waitForFunction(() => window.__probe.ratings.length === 1)
    assert.equal((await probe()).ratings.length, 1)
  })
  for (const unmount of [false, true]) {
    await runCase(unmount ? 'A4-unmount-multi-clip' : 'A4-close-multi-clip', { multiClip: true, autoEnd: false }, async ({ page, probe }) => {
      await page.waitForFunction(() => window.__probe.plays.length === 1)
      if (unmount) await page.locator('#unmount').click()
      else await close(page)
      await page.evaluate(() => window.__mediaElements.forEach((element) => { element.dispatchEvent(new Event('ended')); element.dispatchEvent(new Event('error')) }))
      await frames(page)
      const after = await probe()
      if (unmount) assert.equal(after.display, null, 'KeepAlive container actually unmounted')
      assert.equal(after.plays.length, 1, 'canceled first clip must not start second clip')
      assert.equal(after.phase, false)
      assert.equal(after.pronunciationSrc, '')
    })
  }
  await runCase('T1-old-response-while-closed', { source: true, translations: ['旧代翻译。', '有效新代翻译。'] }, async ({ page, probe, waitTranslation, releaseTranslation, translationRequests }) => {
    await revealForTranslation(page)
    await waitTranslation(0)
    await close(page)
    const closed = await probe()
    assert.equal(closed.translationLoading, false, 'cancel settles loading immediately')
    await releaseTranslation(0)
    assert.equal((await probe()).translationText, '')
    assert.equal(translationRequests.length, 1, 'hidden response must not start another request')
    await reopen(page)
    await waitTranslation(1)
    assert.equal((await probe()).translationLoading, true)
    await releaseTranslation(1)
    checkTranslation(await probe(), '有效新代翻译。')
  })
  await runCase('T2-new-response-before-old', { source: true, translations: ['不能覆盖的新旧代翻译。', '新代先返回的翻译。'] }, async ({ page, probe, waitTranslation, releaseTranslation }) => {
    await revealForTranslation(page)
    await waitTranslation(0)
    await close(page)
    await reopen(page)
    await waitTranslation(1)
    await releaseTranslation(1)
    checkTranslation(await probe(), '新代先返回的翻译。')
    await releaseTranslation(0)
    checkTranslation(await probe(), '新代先返回的翻译。')
  })
  await runCase('T3-new-failure-old-failure-retry', { source: true, translations: [null, null, '重试成功的翻译。'] }, async ({ page, probe, waitTranslation, releaseTranslation }) => {
    await revealForTranslation(page)
    await waitTranslation(0)
    await close(page)
    await reopen(page)
    await waitTranslation(1)
    await releaseTranslation(1)
    const failed = await probe()
    assert.equal(failed.translationLoading, false)
    assert.equal(failed.translationUnavailable, true)
    await releaseTranslation(0)
    assert.equal((await probe()).translationText, failed.translationText, 'old catch/finally cannot replace new failure')
    await page.locator('.srs-review-sentence-translation.is-unavailable').getByRole('button', { name: '重试', exact: true }).click()
    await waitTranslation(2)
    await releaseTranslation(2)
    checkTranslation(await probe(), '重试成功的翻译。')
  })
  await runCase('T4-cached-same-card-reopen', { source: true, translations: ['已完成的缓存翻译。'] }, async ({ page, probe, waitTranslation, releaseTranslation, translationRequests }) => {
    await revealForTranslation(page)
    await waitTranslation(0)
    await releaseTranslation(0)
    checkTranslation(await probe(), '已完成的缓存翻译。')
    await close(page)
    await reopen(page)
    await page.waitForFunction(() => document.querySelector('.srs-review-audio audio') && !document.querySelector('.srs-review-sentence-translation.is-loading'))
    await frames(page)
    checkTranslation(await probe(), '已完成的缓存翻译。')
    assert.equal(translationRequests.length, 1, 'completed cache avoids an extra translation request')
  })
  console.log(`SRS media lifecycle browser check passed (${results.length} synthetic real-component journeys); evidence: ${outputDir}`)
} finally {
  if (browser) await browser.close()
  await new Promise((resolve) => server.close(resolve))
  fs.writeFileSync(path.join(outputDir, 'results.json'), JSON.stringify({ origin, results, serviceClosed: !server.listening, scope: 'Isolated synthetic component/media-call/translation checks; real Host/audible playback NOT_VERIFIED.' }, null, 2))
}
