const assert = require('node:assert/strict')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { chromium } = require('playwright')

const projectRoot = path.resolve(__dirname, '..')
const port = 43000 + (process.pid % 1000)
const targetUrl = process.env.READ_WEB_URL || `http://127.0.0.1:${port}/`
const ownsServer = !process.env.READ_WEB_URL
const fixtures = [
  ['resilient', '有韧性的', 'A resilient system recovers quickly.'],
  ['subtle', '不易察觉的', 'The subtle signal was easy to miss.'],
  ['thorough', '全面细致的', 'A thorough review catches hidden problems.'],
  ['readily', '容易地', 'The next card should appear readily.'],
  ['enhance', '提升', 'Small changes enhance the learning flow.'],
]

function transcriptFixture() {
  return {
    segments: fixtures.map(([, , sentence], index) => ({
      text: sentence,
      start: index * 2,
      end: index * 2 + 1.5,
      words: sentence.split(/\s+/u).map((token, wordIndex) => ({
        word: token,
        start: index * 2 + wordIndex * 0.1,
        end: index * 2 + wordIndex * 0.1 + 0.08,
      })),
    })),
  }
}

function chunksFixture() {
  return {
    s: fixtures.map(([, meaning, sentence]) => ({
      chunks: [{ en: sentence, zh: `这句话包含“${meaning}”这个意思。` }],
    })),
  }
}

async function seedReviewCards(page) {
  await page.evaluate(async (items) => {
    const { createVocabularyService } = await import('/src/services/vocabulary/index.js')
    const service = createVocabularyService({ acquisitionEnabled: true })
    const createdAt = new Date(Date.now() - 60_000).toISOString()
    for (let index = 0; index < items.length; index += 1) {
      const [word, meaning, sentence] = items[index]
      await service.queueVocabularyAcquisition({
        word,
        lemma: word,
        language: 'en',
        meaning,
        createdAt,
        acquisitionIdentity: {
          sourceId: `latency-source-${word}`,
          targetId: `latency-target-${word}`,
        },
        context: {
          sentence,
          surrounding_text: sentence,
          source_id: `latency-source-${word}`,
          source_title: 'Review latency fixture',
          sentence_index: index,
        },
      })
    }
  }, fixtures)
}

async function measureRating(page, actionLabel, blockMs, revealAnswer = true) {
  await page.evaluate((value) => {
    window.__reviewMediaLoadBlockMs = value
    window.__reviewMediaLoadEvents.length = 0
  }, blockMs)
  if (revealAnswer) await page.getByRole('button', { name: 'Space 显示答案' }).click()
  return page.evaluate(async (label) => {
    const heading = document.querySelector('.srs-review-word-line h2')
    const previousWord = heading?.textContent?.trim()
    const button = [...document.querySelectorAll('.srs-review-actions button')]
      .find((candidate) => candidate.textContent.trim() === label)
    if (!heading || !previousWord || !button) throw new Error(`Unable to measure ${label}`)
    const startedAt = performance.now()
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        observer.disconnect()
        reject(new Error(`Timed out waiting for the next review word after ${label}`))
      }, 5000)
      const observer = new MutationObserver(() => {
        const nextWord = document.querySelector('.srs-review-word-line h2')?.textContent?.trim()
        if (!nextWord || nextWord === previousWord) return
        const domUpdatedAt = performance.now()
        observer.disconnect()
        clearTimeout(timeout)
        requestAnimationFrame(() => requestAnimationFrame(() => resolve({
          actionLabel: label,
          previousWord,
          nextWord,
          domMs: domUpdatedAt - startedAt,
          paintedMs: performance.now() - startedAt,
          mediaLoadEvents: window.__reviewMediaLoadEvents
            .filter((event) => event.startedAt >= startedAt)
            .map((event) => ({ ...event, offsetMs: event.startedAt - startedAt })),
        })))
      })
      observer.observe(document.querySelector('.srs-review-page'), {
        childList: true,
        characterData: true,
        subtree: true,
      })
      button.click()
    })
  }, actionLabel)
}

async function readPersistedAttempts(page) {
  return page.evaluate(async () => {
    const { createSrsReviewUiService } = await import(
      '/src/features/srs-review/srs-review-ui-service.js'
    )
    const service = createSrsReviewUiService({
      personalizationShadowRunner: async () => null,
    })
    return service.getReviewEvents()
  })
}

async function waitForPersistedAttempts(page, expected) {
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    const attempts = await readPersistedAttempts(page)
    if (attempts.length >= expected) return attempts
    await page.waitForTimeout(50)
  }
  return readPersistedAttempts(page)
}

async function runBrowserCheck() {
  const silentWav = Buffer.from(
    'UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=',
    'base64',
  )
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  await context.addInitScript(() => {
    const nativeLoad = HTMLMediaElement.prototype.load
    window.__reviewMediaLoadEvents = []
    window.__reviewMediaLoadBlockMs = 0
    HTMLMediaElement.prototype.load = function reviewLatencyLoadProbe() {
      const startedAt = performance.now()
      const blockMs = Number(window.__reviewMediaLoadBlockMs || 0)
      if (blockMs > 0) {
        while (performance.now() - startedAt < blockMs) {}
      }
      const result = nativeLoad.call(this)
      window.__reviewMediaLoadEvents.push({
        startedAt,
        durationMs: performance.now() - startedAt,
        connected: this.isConnected,
      })
      return result
    }
    class FixtureUtterance {
      constructor(text) { this.text = text }
    }
    Object.defineProperty(window, 'SpeechSynthesisUtterance', {
      configurable: true,
      value: FixtureUtterance,
    })
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: {
        cancel() {},
        getVoices: () => [{ name: 'Fixture US voice', lang: 'en-US' }],
        speak(utterance) { setTimeout(() => utterance.onend?.(), 0) },
      },
    })
  })
  const page = await context.newPage()
  const pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  await page.route('**/api/jobs/*/file/transcript*', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(transcriptFixture()),
  }))
  await page.route('**/api/jobs/*/file/chunkData*', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(chunksFixture()),
  }))
  await page.route('**/api/jobs/*/file/audio*', (route) => route.fulfill({
    contentType: 'audio/wav',
    body: silentWav,
  }))
  await page.route('**/api/vocabulary/sentence-translations', async (route) => {
    const body = route.request().postDataJSON()
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        schemaVersion: 'sentence-translations.v1',
        available: true,
        items: body.items.map((item) => ({
          ...item,
          translationZh: '这是有韧性的、不易察觉的、全面细致的、容易地和提升的测试句。',
        })),
      }),
    })
  })

  try {
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded' })
    await page.locator('[data-vue-mounted]').waitFor({ state: 'attached' })
    await seedReviewCards(page)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.getByRole('button', { name: '今日复习' }).click()
    await page.locator('.srs-review-word-line h2').waitFor()
    await page.locator('.srs-review-audio audio').waitFor({ timeout: 10_000 })
    assert.equal(await page.locator('.srs-review-progress').innerText(), '复习 1 / 5')

    const showTargetButton = page.getByRole('button', { name: '显示目标句' })
    if (await showTargetButton.count()) await showTargetButton.click()
    await page.getByRole('button', { name: 'Space 显示答案' }).click()
    await page.locator('.srs-review-sentence-translation').waitFor()
    assert.equal(
      await page.locator('.srs-review-passages > p:not(.srs-review-sentence-translation)').count(),
      1,
      'review should display only the target sentence until surrounding context is requested',
    )
    assert.ok(
      await page.locator('.srs-review-sentence-translation .is-review-meaning').count() > 0,
      'the matching Chinese meaning should remain underlined',
    )

    const measurements = []
    measurements.push(await measureRating(page, '一般', 0, false))
    for (let index = 0; index < fixtures.length - 2; index += 1) {
      measurements.push(await measureRating(page, '一般', 600))
    }
    await page.getByRole('button', { name: 'Space 显示答案' }).click()
    await page.getByRole('button', { name: '一般' }).click()
    await page.getByText('本次复习完成', { exact: true }).waitFor()
    await page.getByText('共完成 5 张', { exact: true }).waitFor()
    await page.getByText('Good 一般：5', { exact: true }).waitFor()

    for (const measurement of measurements) {
      assert.ok(
        measurement.domMs < 100,
        `rating-to-DOM latency exceeded 100ms: ${JSON.stringify(measurement)}`,
      )
      assert.ok(
        measurement.paintedMs < 250,
        `rating-to-visible-frame latency exceeded 250ms: ${JSON.stringify(measurement)}`,
      )
      assert.equal(
        measurement.mediaLoadEvents.length,
        0,
        `media load must not run on the visual card-transition path: ${JSON.stringify(measurement)}`,
      )
    }
    assert.equal(new Set(measurements.map((item) => item.previousWord)).size, fixtures.length - 1)
    const persistedAttempts = await waitForPersistedAttempts(page, fixtures.length)
    assert.equal(persistedAttempts.length, fixtures.length, 'each card should persist exactly once')
    assert.equal(new Set(persistedAttempts.map((event) => event.attempt_id)).size, fixtures.length)
    assert.deepEqual(pageErrors, [], `browser errors: ${pageErrors.join('; ')}`)

    if (process.env.REVIEW_LATENCY_SCREENSHOT) {
      await page.screenshot({ path: process.env.REVIEW_LATENCY_SCREENSHOT, fullPage: false })
    }
    return measurements
  } finally {
    await context.close()
    await browser.close()
  }
}

async function waitForServer(server, output) {
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(`Vite exited before startup: ${output.value}`)
    }
    try {
      const response = await fetch(targetUrl)
      if (response.ok) return
    } catch (_error) {}
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`Timed out waiting for Vite: ${output.value}`)
}

async function main() {
  let server = null
  const output = { value: '' }
  try {
    if (ownsServer) {
      server = spawn(process.execPath, [
        path.join(projectRoot, 'node_modules', 'vite', 'bin', 'vite.js'),
        '--host', '127.0.0.1',
        '--port', String(port),
        '--strictPort',
      ], {
        cwd: projectRoot,
        env: {
          ...process.env,
          VITE_SRS_REVIEW_V2_ENABLED: 'true',
          VITE_LOCAL_SERVICE_BASE_URL: 'http://127.0.0.1:8766',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      const capture = (chunk) => {
        output.value = `${output.value}${chunk}`.slice(-8000)
      }
      server.stdout.on('data', capture)
      server.stderr.on('data', capture)
      await waitForServer(server, output)
    }
    const measurements = await runBrowserCheck()
    const dom = measurements.map((item) => item.domMs.toFixed(1)).join(', ')
    const painted = measurements.map((item) => item.paintedMs.toFixed(1)).join(', ')
    console.log(`SRS rating latency browser check passed (DOM ms: ${dom}; visible ms: ${painted}).`)
  } finally {
    if (server && server.exitCode === null) server.kill()
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
