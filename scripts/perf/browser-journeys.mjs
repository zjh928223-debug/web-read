import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const baseUrl = process.env.READ_WEB_PERF_BASE_URL || 'http://127.0.0.1:5174'
const outputDirectory = path.resolve(
  process.env.READ_WEB_PERF_OUTPUT || path.join(repoRoot, 'output', 'performance'),
)
const requestedJourneys = new Set(
  (process.env.READ_WEB_PERF_JOURNEYS || 'startup,panel-open')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean),
)

const journeys = {
  startup: async ({ page, measure }) => {
    await measure('startup.navigate', async () => {
      await page.goto(baseUrl, { waitUntil: 'networkidle', timeout: 30_000 })
      await page.locator('#app').waitFor({ state: 'attached' })
    })
  },
  'panel-open': async ({ page, measure }) => {
    if (!page.url().startsWith(baseUrl)) {
      await page.goto(baseUrl, { waitUntil: 'networkidle', timeout: 30_000 })
    }
    const trigger = page.getByRole('button', { name: /YouTube|素材|材料|workflow/i }).first()
    if (!(await trigger.count())) throw new Error('Material Workflow trigger was not found')
    await measure('panel.open', async () => {
      await trigger.click()
      await page.locator('[role="dialog"], .youtube-workflow-panel').first().waitFor({ state: 'visible' })
    })
  },
}

function percentile(values, quantile) {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * quantile) - 1)]
}

await mkdir(outputDirectory, { recursive: true })
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext()
await context.tracing.start({ screenshots: true, snapshots: true, sources: true })
const page = await context.newPage()

const artifact = {
  schemaVersion: 1,
  capturedAt: new Date().toISOString(),
  baseUrl,
  journeys: [],
  errors: [],
  requests: { total: 0, failed: 0, httpErrors: 0 },
  longTasks: [],
  navigation: null,
}

page.on('console', (message) => {
  if (message.type() === 'error') artifact.errors.push({ type: 'console', text: message.text() })
})
page.on('pageerror', (error) => artifact.errors.push({ type: 'pageerror', text: error.message }))
page.on('request', () => { artifact.requests.total += 1 })
page.on('requestfailed', (request) => {
  artifact.requests.failed += 1
  artifact.errors.push({ type: 'requestfailed', url: request.url(), text: request.failure()?.errorText })
})
page.on('response', (response) => {
  if (response.status() >= 400) {
    artifact.requests.httpErrors += 1
    artifact.errors.push({ type: 'http', url: response.url(), status: response.status() })
  }
})

await page.addInitScript(() => {
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
})

const measures = []
const measure = async (name, action) => {
  const started = performance.now()
  await action()
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve())))
  measures.push({ name, durationMs: performance.now() - started })
}

let failed = false
try {
  for (const name of requestedJourneys) {
    const journey = journeys[name]
    if (!journey) throw new Error(`Unknown journey: ${name}`)
    const startedAt = performance.now()
    await journey({ page, measure })
    artifact.journeys.push({ name, durationMs: performance.now() - startedAt, status: 'passed' })
  }
  const runtime = await page.evaluate(() => ({
    performance: window.__readWebPerformance,
    navigation: performance.getEntriesByType('navigation')[0]?.toJSON?.() || null,
  }))
  artifact.longTasks = runtime.performance?.longTasks || []
  artifact.navigation = runtime.navigation
  for (const rejection of runtime.performance?.rejections || []) {
    artifact.errors.push({ type: 'unhandledrejection', text: rejection })
  }
} catch (error) {
  failed = true
  artifact.errors.push({ type: 'journey', text: error.stack || error.message })
  artifact.journeys.push({ name: 'run', status: 'failed' })
  await page.screenshot({ path: path.join(outputDirectory, 'browser-journeys-failure.png'), fullPage: true })
} finally {
  artifact.measures = measures
  artifact.summary = {
    measureP50Ms: percentile(measures.map((item) => item.durationMs), 0.5),
    measureP95Ms: percentile(measures.map((item) => item.durationMs), 0.95),
    longTaskCount: artifact.longTasks.length,
    longTaskMaxMs: Math.max(0, ...artifact.longTasks.map((item) => item.duration)),
  }
  await context.tracing.stop({ path: path.join(outputDirectory, 'browser-journeys-trace.zip') })
  await browser.close()
  const outputPath = path.join(outputDirectory, 'browser-journeys.json')
  await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8')
  console.log(`Browser performance artifact: ${outputPath}`)
  console.log(JSON.stringify(artifact.summary))
}

if (failed || artifact.errors.length) process.exitCode = 1
