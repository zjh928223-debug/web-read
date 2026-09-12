const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { chromium } = require('playwright')

const targetUrl = process.env.READ_WEB_URL || 'http://127.0.0.1:4197/'
const fixture = path.join(__dirname, 'fixtures/passage-preview-result.fixture.json')
const reviewSelector = 'main.srs-review-page:not(.passage-preview-page)'
const pages = [
  { name: '复习页', button: '今日复习', module: 'SrsReviewPage', selector: reviewSelector },
  { name: '预习页', button: '待预习', module: 'PassagePreviewPage', selector: '.passage-preview-page' },
]

async function mockServices(context) {
  await context.route('**/api/**', async (route) => {
    const url = new URL(route.request().url())
    const word = url.searchParams.get('word') || 'example'
    let body = { available: false, items: [] }
    if (url.pathname.endsWith('/real-sentences')) {
      body = { schemaVersion: 'tatoeba-real-sentences.v1', items: [{
        id: `fixture-${word}`, sentence: `Learners understand ${word} through practice.`,
        translationZh: '学习者通过练习理解这个词。', owner: 'fixture-author',
        translationOwner: 'fixture-translator', license: 'CC BY 2.0 FR',
        url: `https://tatoeba.org/en/sentences/show/fixture-${word}`,
      }] }
    } else if (url.pathname.endsWith('/sentence-translations')) {
      body = { schemaVersion: 'sentence-translations.v1', available: true,
        items: route.request().postDataJSON().items.map(item => ({ ...item, translationZh: '学习者通过练习理解这个词。' })) }
    }
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) })
  })
  await context.addInitScript(() => {
    class Utterance { constructor(text) { this.text = text } }
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { value: Utterance, configurable: true })
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
      getVoices: () => [{ name: 'Microsoft Aria Online (Natural)', lang: 'en-US' }],
      cancel() {}, speak(utterance) { setTimeout(() => utterance.onend?.(), 0) },
    } })
  })
}

async function makeSeed(browser) {
  const context = await browser.newContext()
  await mockServices(context)
  try {
    const page = await context.newPage()
    await page.goto(targetUrl, { waitUntil: 'networkidle' })
    await page.locator('.passage-preview-file-input').setInputFiles(fixture)
    await page.locator('.passage-preview-page').waitFor()
    await page.locator('.passage-preview-page .srs-review-back').click()
    await page.evaluate(async () => {
      const { createVocabularyService } = await import('/src/services/vocabulary/index.js')
      const service = createVocabularyService({ acquisitionEnabled: true })
      for (const word of ['resilient', 'subtle', 'thorough']) {
        await service.queueVocabularyAcquisition({
          word, lemma: word, language: 'en', meaning: '测试释义',
          createdAt: new Date(Date.now() - 60_000).toISOString(),
          acquisitionIdentity: { sourceId: `lazy-${word}`, targetId: `lazy-${word}` },
          context: { sentence: `A ${word} example helps.`, source_id: `lazy-${word}`, source_title: 'Lazy fixture', sentence_index: 0 },
        })
      }
    })
    return await context.storageState({ indexedDB: true })
  } finally { await context.close() }
}

async function openContext(browser, seed, url = targetUrl) {
  const storageState = structuredClone(seed)
  storageState.origins.forEach(origin => { origin.origin = new URL(url).origin })
  const context = await browser.newContext({ storageState, viewport: { width: 1280, height: 800 } })
  await mockServices(context)
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  return { context, page, errors }
}

async function verifyDelayedPage(browser, seed, spec) {
  const { context, page, errors } = await openContext(browser, seed)
  let release
  let loaded
  const responseDone = new Promise(resolve => { loaded = resolve })
  const pending = new Promise(resolve => { release = resolve })
  let requests = 0
  await page.route(`**/${spec.module}.vue`, async route => {
    requests += 1
    await pending
    await route.continue()
  })
  page.on('response', response => {
    if (new URL(response.url()).pathname.endsWith(`/${spec.module}.vue`)) {
      response.finished().then(loaded)
    }
  })
  try {
    const requestedModules = []
    page.on('request', request => {
      if (/\/(SrsReviewPage|PassagePreviewPage)\.vue(?:\?|$)/.test(request.url())) requestedModules.push(request.url())
    })
    await page.goto(targetUrl, { waitUntil: 'networkidle' })
    assert.equal(new URL(page.url()).pathname, '/')
    assert.ok(await page.title())
    assert.equal(await page.locator('vite-error-overlay').count(), 0)
    assert.deepEqual(requestedModules, [], 'reader startup must not fetch either page')
    await page.getByRole('button', { name: spec.button, exact: true }).click()
    const notice = page.getByRole('dialog', { name: `打开${spec.name}` })
    await notice.getByText(`正在打开${spec.name}…`, { exact: true }).waitFor()
    assert.equal(await page.locator('.passage-preview-preparing').count(), 0, 'page code loading follows material preparation')
    assert.equal(requests, 1)
    const screenshot = path.join(os.tmpdir(), `read-web-lazy-${spec.module}.png`)
    await page.screenshot({ path: screenshot })
    console.log(`Loading screenshot: ${screenshot}`)
    await notice.getByRole('button', { name: '返回阅读器' }).click()
    await notice.waitFor({ state: 'detached' })
    const focus = await page.evaluate(() => document.activeElement?.outerHTML)
    release()
    await responseDone
    await page.waitForLoadState('networkidle')
    assert.equal(await page.locator(spec.selector).isVisible(), false, 'late module response must not reopen page')
    assert.equal(await page.evaluate(() => document.activeElement?.outerHTML), focus, 'late response must not steal focus')
    await page.getByRole('button', { name: spec.button, exact: true }).click()
    const surface = page.locator(spec.selector)
    await surface.waitFor()
    if (spec.module === 'SrsReviewPage') {
      await page.locator('.srs-review-word-line h2').waitFor()
      assert.equal(await page.locator('.srs-review-progress').innerText(), '复习 1 / 3')
      await page.getByRole('button', { name: 'Space 显示答案' }).click()
      await page.getByRole('button', { name: '一般', exact: true }).click()
      await page.getByText('复习 2 / 3', { exact: true }).waitFor()
      const word = await page.locator('.srs-review-word-line h2').innerText()
      await surface.evaluate(element => { window.__lazyReviewElement = element })
      await surface.getByRole('button', { name: '返回阅读器' }).click()
      await surface.waitFor({ state: 'hidden' })
      await page.keyboard.press('Space')
      await page.getByRole('button', { name: spec.button, exact: true }).click()
      await surface.waitFor()
      assert.equal(await surface.evaluate(element => element === window.__lazyReviewElement), true, 'KeepAlive must reuse the page instance')
      assert.equal(await page.locator('.srs-review-word-line h2').innerText(), word)
      assert.equal(await page.locator('.srs-review-progress').innerText(), '复习 2 / 3')
      await page.getByRole('button', { name: 'Space 显示答案' }).waitFor()
      await page.keyboard.press('Space')
      await page.getByRole('button', { name: '一般', exact: true }).waitFor()
    } else {
      await page.getByRole('button', { name: '看看这个词怎么用' }).click()
      await page.getByRole('button', { name: '下一词', exact: true }).click()
      await page.getByText('预习 2 / 6', { exact: true }).waitFor()
      await surface.locator('.srs-review-back').click()
      await surface.waitFor({ state: 'detached' })
      await page.getByRole('button', { name: spec.button, exact: true }).click()
      await page.getByText('预习 2 / 6', { exact: true }).waitFor()
    }
    assert.equal(requests, 1, 'reopening must reuse the loaded module')
    assert.deepEqual(errors, [])
    console.log(`${spec.name}: delayed load, return, late response, reopen and state passed`)
  } finally { release(); await context.close() }
}

async function verifyFailure(browser, seed, spec) {
  const { context, page, errors } = await openContext(browser, seed)
  let requests = 0
  await page.route(`**/${spec.module}.vue`, route => {
    requests += 1
    return requests === 1 ? route.abort('failed') : route.continue()
  })
  try {
    await page.goto(targetUrl, { waitUntil: 'networkidle' })
    await page.getByRole('button', { name: spec.button, exact: true }).click()
    const notice = page.getByRole('dialog', { name: `打开${spec.name}` })
    await notice.getByRole('button', { name: '重试', exact: true }).waitFor()
    await notice.getByRole('button', { name: '重试', exact: true }).click()
    // Chromium may cache a failed module import. Either success or a clear error is valid.
    await page.waitForFunction(selector => document.querySelector(selector)
      || document.querySelector('.learning-page-load-notice button')?.textContent === '重试', spec.selector)
    if (await notice.isVisible()) {
      await notice.getByText(/仍无法打开.*手动刷新页面再试/).waitFor()
      await notice.getByRole('button', { name: '返回阅读器' }).click()
      await notice.waitFor({ state: 'detached' })
      console.log(`${spec.name}: browser cached failed import; retry reports failure and return works`)
    } else {
      await page.locator(spec.selector).waitFor()
      console.log(`${spec.name}: retry loaded the recovered module`)
    }
    assert.deepEqual(errors, [])
  } finally { await context.close() }
}

async function verifyDist(browser, seed) {
  const { preview } = await import('vite')
  const server = await preview({ preview: { host: '127.0.0.1', port: 4198, strictPort: true } })
  const url = 'http://127.0.0.1:4198/'
  // Read this build's filenames; the SRS facade and implementation may be separate chunks.
  const assets = fs.readdirSync(path.join(__dirname, '../dist/assets'))
  const chunks = pages.map(spec => ({ ...spec, files: assets.filter(file => file.startsWith(`${spec.module}-`) && file.endsWith('.js')) }))
  try {
    for (const spec of chunks) {
      assert.ok(spec.files.length, `missing built chunk for ${spec.module}`)
      const { context, page, errors } = await openContext(browser, seed, url)
      try {
        const requested = new Set()
        page.on('request', request => requested.add(new URL(request.url()).pathname.split('/').pop()))
        await page.goto(url, { waitUntil: 'networkidle' })
        for (const file of chunks.flatMap(item => item.files)) assert.equal(requested.has(file), false, `${file} loaded at startup`)
        await page.getByRole('button', { name: spec.button, exact: true }).click()
        await page.locator(spec.selector).waitFor()
        for (const file of spec.files) assert.equal(requested.has(file), true, `${file} was not requested on open`)
        assert.deepEqual(errors, [])
        console.log(`dist ${spec.name}: deferred and rendered (${spec.files.join(', ')})`)
      } finally { await context.close() }
    }
  } finally { await new Promise(resolve => server.httpServer.close(resolve)) }
}

async function run() {
  const browser = await chromium.launch({ headless: true })
  try {
    const seed = await makeSeed(browser)
    for (const spec of pages) {
      await verifyDelayedPage(browser, seed, spec)
      await verifyFailure(browser, seed, spec)
    }
    await verifyDist(browser, seed)
    console.log('Learning page lazy load browser check passed.')
  } finally { await browser.close() }
}
run().catch(error => { console.error(error); process.exitCode = 1 })
