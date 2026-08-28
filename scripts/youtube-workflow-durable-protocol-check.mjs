import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { gateEnvironment, resolveSelectedPython } from './lib/python-runtime.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const backendRoot = path.join(repoRoot, 'tools', 'subtitle-workflow')
const selectedPython = await resolveSelectedPython({
  repoRoot,
  configPath: process.env.READ_WEB_RUNTIME_CONFIG || 'config/runtime.optimization.json',
})
const python = selectedPython.executable
const token = 'workflow-ui-test-token'

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port
      server.close((error) => error ? reject(error) : resolve(port))
    })
  })
}

async function waitForHttp(url, headers = {}, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs
  let lastError = null
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { headers })
      if (response.ok) return response
      lastError = new Error(`${url} returned ${response.status}`)
    } catch (error) {
      lastError = error
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw lastError || new Error(`Timed out waiting for ${url}`)
}

async function waitForFile(pathname, predicate, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const value = JSON.parse(fs.readFileSync(pathname, 'utf8'))
      if (predicate(value)) return value
    } catch (_error) {
      // The repository may be between temp replace and the next durable read.
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`Timed out waiting for durable file ${pathname}`)
}

function stopProcess(child) {
  if (!child || child.exitCode !== null) return Promise.resolve()
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      resolve()
    }, 10000)
    child.once('exit', () => {
      clearTimeout(timer)
      resolve()
    })
    child.kill('SIGTERM')
  })
}

async function openWorkflowPanel(page, appUrl) {
  await page.goto(`${appUrl}?workflowMode=mock`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.youtube-reader-controls .small-btn')
  await page.locator('.youtube-reader-controls .small-btn').first().click()
  await page.locator('.youtube-workflow-panel').waitFor({ state: 'visible' })
  await page.locator('button[data-view="queue"]').click()
  await page.waitForSelector('.youtube-workflow-process-view')
}

async function submitUrl(page, url) {
  await page.getByRole('button', { name: /添加素材/ }).click()
  const input = page.locator('textarea[name="youtube-material-link"]')
  await input.fill(url)
  await input.press('Tab')
  await page.locator('.youtube-link-card').waitFor({ state: 'visible' })
  await page.locator('.youtube-workflow-form button[type="submit"]').click()
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'read-web-workflow-ui-'))
  const backendPort = await reservePort()
  const vitePort = await reservePort()
  const backendUrl = `http://127.0.0.1:${backendPort}`
  const appUrl = `http://127.0.0.1:${vitePort}/`
  const pythonScript = `
from pathlib import Path
import sys
import uvicorn
from youtube_workflow.core import WorkflowConfig
from youtube_workflow.service import JobManager, create_app

class HoldRunner:
    def __init__(self, _config):
        pass

    def run(self, _request, _job_id, emit=None, cancel_event=None):
        emit({"status": "downloading", "stage": "downloading", "message": "protocol fixture"})
        while not cancel_event.wait(0.05):
            pass
        raise RuntimeError("protocol fixture canceled")

root = Path(sys.argv[1])
port = int(sys.argv[2])
config = WorkflowConfig(output_dir=root / "output", state_dir=root / "state")
manager = JobManager(
    config=config,
    runner_factory=lambda: HoldRunner(config),
    persistence_delay_seconds=10,
)
uvicorn.run(create_app(manager, access_token=${JSON.stringify(token)}), host="127.0.0.1", port=port, log_level="warning")
`
  const environment = {
    ...gateEnvironment(selectedPython),
    PYTHONPATH: `${backendRoot}${path.delimiter}${process.env.PYTHONPATH || ''}`,
    READ_WEB_ALLOWED_ORIGIN: appUrl.slice(0, -1),
  }
  const backend = spawn(python, ['-c', pythonScript, root, String(backendPort)], {
    cwd: backendRoot,
    env: environment,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const vite = spawn(process.execPath, [
    path.join(repoRoot, 'node_modules', 'vite', 'bin', 'vite.js'),
    '--host',
    '127.0.0.1',
    '--port',
    String(vitePort),
  ], {
    cwd: repoRoot,
    env: {
      ...process.env,
      VITE_LOCAL_SERVICE_BASE_URL: backendUrl,
      VITE_READ_WEB_SERVICE_TOKEN: token,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const requests = []
  const responses = []
  let firstCreateResponseDropped = false
  let firstSnapshotDelayed = false
  let offlineSnapshot = false
  let dropPrioritizeResponse = false
  const pages = []

  function trackPage(page) {
    pages.push(page)
    page.on('request', (request) => {
      const url = new URL(request.url())
      if (url.hostname !== '127.0.0.1' || !url.pathname.startsWith('/api/jobs')) return
      if (request.method() !== 'POST') return
      requests.push({
        page,
        url: url.pathname,
        headers: request.headers(),
        body: request.postData() || '',
      })
    })
    page.on('response', (response) => {
      const url = new URL(response.url())
      if (url.hostname === '127.0.0.1' && url.pathname.endsWith('/prioritize')) {
        responses.push({ page, url: url.pathname, status: response.status() })
      }
    })
  }

  try {
    await waitForHttp(`${backendUrl}/api/health`)
    await waitForHttp(appUrl)

    await context.route(`${backendUrl}/api/**`, async (route) => {
      const pathname = new URL(route.request().url()).pathname
      if (offlineSnapshot && pathname === '/api/jobs/snapshot') {
        await route.abort('internetdisconnected')
        return
      }
      if (dropPrioritizeResponse && route.request().method() === 'POST' && pathname.endsWith('/prioritize')) {
        dropPrioritizeResponse = false
        await route.fetch()
        await route.abort('connectionreset')
        return
      }
      if (!firstSnapshotDelayed && pathname === '/api/jobs/snapshot') {
        firstSnapshotDelayed = true
        await new Promise((resolve) => setTimeout(resolve, 350))
        await route.continue()
        return
      }
      if (firstCreateResponseDropped || route.request().method() !== 'POST' || pathname !== '/api/jobs') {
        await route.continue()
        return
      }
      firstCreateResponseDropped = true
      await route.fetch()
      await route.abort('connectionreset')
    })

    let page = await context.newPage()
    trackPage(page)
    page.on('dialog', (dialog) => dialog.dismiss())

    await openWorkflowPanel(page, appUrl)
    await submitUrl(page, 'https://example.com/ui-disconnect-first')
    await page.locator('.youtube-workflow-form button[type="submit"]').waitFor({ state: 'visible' })
    await waitForFile(path.join(root, 'state', 'jobs.json'), (document) => document?.payload?.jobs?.length === 1)
    await page.waitForFunction(() => !document.querySelector('.youtube-workflow-form button[type="submit"]')?.disabled)
    const receiptBeforeClose = await page.evaluate(() => Object.entries(localStorage)
      .filter(([key]) => key.startsWith('read-web.workflow-operation-receipt.v1.')))
    assert.equal(receiptBeforeClose.length, 1, 'uncertain create must leave one safe operation receipt before page close')
    const receiptBytes = receiptBeforeClose[0][1]
    assert.equal(receiptBytes.includes('ui-disconnect-first'), false, 'receipt must not persist URL text')
    assert.equal(receiptBytes.includes(token), false, 'receipt must not persist the access token')
    assert.equal(receiptBytes.includes('apiKey'), false, 'receipt must not persist API key fields')

    // The first POST was committed by the real backend, but the production UI
    // received a connection reset. Closing and reopening the page before the
    // user submits the same action must still reuse its receipt operation key.
    await page.close()
    page = await context.newPage()
    trackPage(page)
    page.on('dialog', (dialog) => dialog.dismiss())
    await openWorkflowPanel(page, appUrl)
    const receiptAfterReload = await page.evaluate(() => Object.entries(localStorage)
      .filter(([key]) => key.startsWith('read-web.workflow-operation-receipt.v1.')))
    assert.equal(receiptAfterReload.length, 1, 'reload must retain the pending safe operation receipt')
    await submitUrl(page, 'https://example.com/ui-disconnect-first')
    await page.waitForTimeout(500)
    await page.locator('.youtube-workflow-queue-job').first().waitFor({ state: 'visible' })
    const durableAfterRetry = await waitForFile(
      path.join(root, 'state', 'jobs.json'),
      (document) => document?.payload?.jobs?.length === 1,
    )
    assert.equal(durableAfterRetry.payload.jobs.length, 1, 'same UI action must leave exactly one durable job')
    const createRequests = requests.filter((request) => request.url === '/api/jobs')
    assert.equal(createRequests.length, 2, 'disconnect scenario must issue exactly one initial POST and one retry')
    assert.equal(createRequests[0].headers['idempotency-key'], createRequests[1].headers['idempotency-key'], 'UI retry must reuse one stable idempotency key')
    assert.ok(createRequests.every((request) => request.headers['x-expected-revision']), 'create must never be sent without an expected revision')
    assert.ok(createRequests.every((request) => request.headers['if-match'] === `"${request.headers['x-expected-revision']}"`), 'create must send matching If-Match')

    await submitUrl(page, 'https://example.com/ui-mutation-first')
    await page.locator('.youtube-workflow-queue-job').nth(1).waitFor({ state: 'visible' })
    await page.waitForFunction(() => document.querySelectorAll('.youtube-workflow-queue-job[data-status="queued"]').length >= 1)

    const pageTwo = await context.newPage()
    trackPage(pageTwo)
    pageTwo.on('dialog', (dialog) => dialog.dismiss())
    await openWorkflowPanel(pageTwo, appUrl)
    await pageTwo.waitForFunction(() => document.querySelectorAll('.youtube-workflow-queue-job').length >= 2)
    await page.waitForFunction(() => document.querySelectorAll('.youtube-workflow-queue-job[data-status="queued"]').length >= 1)

    await Promise.all([
      page.waitForResponse((response) => response.url().endsWith('/prioritize') && response.request().method() === 'POST'),
      pageTwo.waitForResponse((response) => response.url().endsWith('/prioritize') && response.request().method() === 'POST'),
      page.getByRole('button', { name: '置顶' }).first().click(),
      pageTwo.getByRole('button', { name: '置顶' }).first().click(),
    ])
    await page.waitForTimeout(500)
    assert.deepEqual(responses.map((item) => item.status).sort(), [200, 409], 'same-revision mutation must have one winner and one conflict')
    const prioritizeRequests = requests.filter((request) => request.url.endsWith('/prioritize'))
    assert.equal(prioritizeRequests.length, 2)
    assert.equal(prioritizeRequests[0].headers['x-expected-revision'], prioritizeRequests[1].headers['x-expected-revision'], 'both pages must mutate from the same known revision')
    assert.equal(prioritizeRequests[0].headers['if-match'], prioritizeRequests[1].headers['if-match'])
    assert.ok(
      await page.locator('[data-workflow-mutation-notice]').count() + await pageTwo.locator('[data-workflow-mutation-notice]').count() > 0,
      'conflict must be visible as an explicit refresh-and-retry notice',
    )

    await submitUrl(page, 'https://example.com/ui-prioritize-response-loss')
    const responseLossRow = page.locator('.youtube-workflow-queue-job').filter({ hasText: 'ui-prioritize-response-loss' })
    await responseLossRow.waitFor({ state: 'visible' })
    await page.waitForFunction(() => document.querySelectorAll('.youtube-workflow-queue-job[data-status="queued"]').length >= 1)
    dropPrioritizeResponse = true
    await responseLossRow.getByRole('button', { name: '置顶' }).click()
    await page.locator('[data-workflow-mutation-notice]').waitFor({ state: 'visible' })
    const prioritizeCountAfterDroppedResponse = requests.filter((request) => request.url.endsWith('/prioritize')).length
    await responseLossRow.getByRole('button', { name: '置顶' }).click()
    await page.waitForResponse((response) => response.url().endsWith('/prioritize') && response.status() === 200)
    const prioritizeAfterResponseLoss = requests.filter((request) => request.url.endsWith('/prioritize'))
    assert.equal(prioritizeAfterResponseLoss.length, prioritizeCountAfterDroppedResponse + 1)
    assert.equal(
      prioritizeAfterResponseLoss.at(-1).headers['idempotency-key'],
      prioritizeAfterResponseLoss.at(-2).headers['idempotency-key'],
      'prioritize response-loss retry must replay the same backend receipt',
    )

    offlineSnapshot = true
    await page.getByRole('button', { name: '刷新' }).click()
    await page.waitForTimeout(300)
    const prioritizeCountBeforeBlockedRetry = requests.filter((request) => request.url.endsWith('/prioritize')).length
    await page.getByRole('button', { name: '置顶' }).first().click()
    await page.locator('[data-workflow-mutation-notice]').waitFor({ state: 'visible' })
    await page.waitForTimeout(300)
    assert.equal(
      requests.filter((request) => request.url.endsWith('/prioritize')).length,
      prioritizeCountBeforeBlockedRetry,
      'failed authoritative refresh must block a protected mutation without sending a request',
    )
    offlineSnapshot = false

    for (const request of requests) {
      assert.equal(request.headers['x-read-web-token'], token, 'production client must send the configured access token')
      assert.equal(request.body.includes(token), false, 'access token must not enter request persistence payloads')
    }
    const mutationRequests = requests.filter((request) => request.url === '/api/jobs' || request.url.endsWith('/prioritize'))
    assert.ok(mutationRequests.every((request) => request.headers['idempotency-key']), 'protected mutation must carry an idempotency key')
    const persistedText = [
      path.join(root, 'state', 'jobs.json'),
      path.join(root, 'state', 'logs', 'service.log'),
    ].map((pathname) => fs.existsSync(pathname) ? fs.readFileSync(pathname, 'utf8') : '').join('\n')
    assert.equal(persistedText.includes(token), false, 'access token must not enter durable state or service logs')

    await pageTwo.close()
    await page.close()
    console.log('youtube workflow durable protocol browser check passed')
  } finally {
    await context.close()
    await browser.close()
    await stopProcess(vite)
    await stopProcess(backend)
    fs.rmSync(root, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
