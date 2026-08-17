const assert = require('node:assert/strict')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { chromium } = require('playwright')

const projectRoot = path.resolve(__dirname, '..')
const port = 44000 + (process.pid % 1000)
const targetUrl = process.env.READ_WEB_URL || `http://127.0.0.1:${port}/`
const ownsServer = !process.env.READ_WEB_URL

async function waitForServer(server, output) {
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`Vite exited before startup: ${output.value}`)
    try {
      const response = await fetch(targetUrl)
      if (response.ok) return
    } catch (_error) {}
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`Timed out waiting for Vite: ${output.value}`)
}

async function runBrowserCheck() {
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  await context.addInitScript(() => {
    window.__previewRatingSaveCount = 0
    window.__previewSpeechCancelBlockMs = 0
    window.__previewSpeechCancelEvents = []
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
        cancel() {
          const startedAt = performance.now()
          const blockMs = Number(window.__previewSpeechCancelBlockMs || 0)
          while (performance.now() - startedAt < blockMs) {}
          window.__previewSpeechCancelEvents.push({
            startedAt,
            durationMs: performance.now() - startedAt,
          })
        },
        getVoices: () => [{ name: 'Fixture US voice', lang: 'en-US' }],
        speak(utterance) { setTimeout(() => utterance.onend?.(), 0) },
      },
    })
  })
  const page = await context.newPage()
  const pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  try {
    await page.goto(targetUrl, { waitUntil: 'networkidle' })
    await page.evaluate(async () => {
      document.querySelector('#app')?.__vue_app__?.unmount()
      document.body.innerHTML = '<div id="preview-rating-latency-harness"></div>'
      const harness = await import('/scripts/fixtures/passage-preview-rating-latency-harness.js')
      harness.mountPassagePreviewRatingLatencyHarness('#preview-rating-latency-harness')
    })
    await page.getByRole('heading', { name: 'first', exact: true }).waitFor()
    await page.evaluate(() => { window.__previewSpeechCancelBlockMs = 700 })
    const measurement = await page.evaluate(() => new Promise((resolve, reject) => {
      const startedAt = performance.now()
      const timeout = setTimeout(() => reject(new Error('Timed out waiting for the second preview word')), 3000)
      const observer = new MutationObserver(() => {
        const word = document.querySelector('.passage-preview-word-line h2')?.textContent?.trim()
        if (word !== 'second') return
        const domMs = performance.now() - startedAt
        observer.disconnect()
        clearTimeout(timeout)
        requestAnimationFrame(() => resolve({ domMs, frameReadyMs: performance.now() - startedAt, startedAt }))
      })
      observer.observe(document.querySelector('.passage-preview-check-page'), {
        childList: true,
        characterData: true,
        subtree: true,
      })
      const button = [...document.querySelectorAll('.passage-preview-check-actions button')]
        .find((candidate) => candidate.textContent.trim() === '一般')
      button.click()
    }))
    await page.waitForFunction(() => (
      window.__previewSpeechCancelEvents.length > 0 && window.__previewRatingSaveCount === 1
    ))
    const cancelEvent = await page.evaluate(() => window.__previewSpeechCancelEvents[0])
    assert.ok(measurement.domMs < 150, `next preview word DOM update was slow: ${JSON.stringify(measurement)}`)
    assert.ok(measurement.frameReadyMs < 200, `next preview word missed the first render frame: ${JSON.stringify(measurement)}`)
    assert.ok(cancelEvent.durationMs >= 650, `the browser check did not exercise blocking pronunciation cleanup: ${JSON.stringify(cancelEvent)}`)
    assert.ok(cancelEvent.startedAt >= measurement.startedAt, 'pronunciation cleanup should happen after the rating starts')
    assert.deepEqual(pageErrors, [], `browser errors: ${pageErrors.join('; ')}`)
    return { measurement, cancelEvent }
  } finally {
    await context.close()
    await browser.close()
  }
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
      ], { cwd: projectRoot, stdio: ['ignore', 'pipe', 'pipe'] })
      const capture = (chunk) => { output.value = `${output.value}${chunk}`.slice(-8000) }
      server.stdout.on('data', capture)
      server.stderr.on('data', capture)
      await waitForServer(server, output)
    }
    const { measurement, cancelEvent } = await runBrowserCheck()
    console.log(
      `Passage preview rating latency browser check passed (DOM ${measurement.domMs.toFixed(1)} ms; render frame ${measurement.frameReadyMs.toFixed(1)} ms; deferred pronunciation block ${cancelEvent.durationMs.toFixed(1)} ms).`,
    )
  } finally {
    if (server && server.exitCode === null) server.kill()
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
