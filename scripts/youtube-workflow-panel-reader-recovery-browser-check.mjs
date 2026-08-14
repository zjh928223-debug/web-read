import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { chromium } from 'playwright'

const repoRoot = path.resolve(import.meta.dirname, '..')
const workflowRoot = path.join(repoRoot, 'tools', 'subtitle-workflow')
const distDir = path.join(repoRoot, 'dist')
const token = 'reader-recovery-browser-test-token'
const outboxKey = 'read-web.reader-save-outbox.v1'

const apiPort = await randomPort()
const appUrl = `http://127.0.0.1:${apiPort}`
const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'read-web-reader-recovery-'))
const childProcesses = []
let browser = null

try {
  await runCommand(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build'], {
    cwd: repoRoot,
    env: {
      ...process.env,
      VITE_LOCAL_SERVICE_BASE_URL: appUrl,
      VITE_READ_WEB_SERVICE_TOKEN: token,
    },
  })

  const backend = startBackend(apiPort, tempRoot)
  childProcesses.push(backend)
  await waitFor(async () => {
    if (backend.exitCode !== null) throw new Error(`backend exited: ${backend.diagnostic()}`)
    return (await fetch(`${appUrl}/api/app/health`)).ok
  }, 'production app host')

  const jobOne = await createReadyJob('reader-recovery-conflict')
  const jobTwo = await createReadyJob('reader-recovery-outbox')

  browser = await chromium.launch({ headless: true })
  await verifyConflictReloadAndSingleFlight(jobOne.jobId)
  await verifyCloseOutboxReplayAndAuth(jobTwo.jobId)
  await verifyUnknownOutboxFailsClosed()
  console.log('youtube workflow panel reader recovery browser check passed')
} finally {
  if (browser) await browser.close()
  for (const child of childProcesses.reverse()) await stopProcess(child)
  await rm(tempRoot, { recursive: true, force: true })
}

async function verifyConflictReloadAndSingleFlight(jobId) {
  const context = await browser.newContext()
  const page = await context.newPage()
  const marksRequests = []
  let authorityGets = 0
  let abortFirstAuthorityGet = true

  page.on('request', (request) => {
    const url = new URL(request.url())
    if (request.method() !== 'POST' || !url.pathname.endsWith('/reader-marks')) return
    marksRequests.push({
      body: request.postDataJSON(),
      headers: request.headers(),
      url: request.url(),
    })
  })
  await page.addInitScript((key) => localStorage.removeItem(key), outboxKey)
  await page.route(`${appUrl}/api/jobs/${encodeURIComponent(jobId)}/reader-marks`, async (route) => {
    if (route.request().method() !== 'GET') return route.continue()
    authorityGets += 1
    if (abortFirstAuthorityGet) {
      abortFirstAuthorityGet = false
      return route.abort('failed')
    }
    await new Promise((resolve) => setTimeout(resolve, 120))
    return route.continue()
  })

  await page.goto(`${appUrl}/`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.youtube-reader-controls .small-btn')
  await page.locator('.youtube-reader-controls .small-btn').first().click()
  await page.waitForSelector('.youtube-workflow-panel', { state: 'visible' })
  await postJson(`/api/jobs/${encodeURIComponent(jobId)}/reader-marks`, {
    marks: [{ globalIndex: 1, word: 'owner-a', start: 0.5, sourceType: 'manual-mark' }],
    expectedRevision: 0,
    operationId: 'reader-recovery-owner-a',
  })
  await setReaderState(page, jobId, 'owner-b', true)
  try {
    await page.waitForSelector('[data-reader-conflict-action]', { state: 'visible' })
  } catch (error) {
    const debug = await page.evaluate(() => ({
      currentAudioMeta: window.__state?.currentAudioMeta || null,
      currentJobId: document.querySelector('[data-reader-save-state]')?.textContent || '',
      state: document.querySelector('[data-reader-save-state]')?.textContent || '',
      actionCount: document.querySelectorAll('[data-reader-conflict-action]').length,
    }))
    throw new Error(`conflict action did not appear: ${JSON.stringify(debug)}; ${error.message}`)
  }
  assert.match(await page.locator('[data-reader-save-state]').innerText(), /并发冲突/)

  await page.evaluate(() => {
    const button = document.querySelector('[data-reader-conflict-action]')
    button.click()
    button.click()
  })
  await waitFor(async () => {
    const value = await getJson(`/api/jobs/${encodeURIComponent(jobId)}/reader-marks`)
    return value.revision === 2 && value.marks.some((mark) => mark.word === 'owner-b')
  }, 'conflict retry')
  await page.waitForFunction(() => document.querySelector('[data-reader-save-state]')?.textContent === '学习记录已保存')

  assert.equal(authorityGets, 2, 'the failed authority read plus two clicks must make only one retry read')
  assert.equal(marksRequests.length, 2, 'conflict resolution must not duplicate the original write')
  assert.equal(marksRequests[0].body.operationId, marksRequests[1].body.operationId)
  assert.deepEqual(marksRequests.map((request) => request.body.expectedRevision), [0, 1])
  assert.equal(marksRequests.every((request) => request.headers['x-read-web-token'] === token), true)
  assert.equal(marksRequests.every((request) => !request.url.includes('access_token=')), true)
  assert.equal(await page.locator('[data-reader-conflict-action]').count(), 0)
  assert.equal(await page.locator('p.youtube-workflow-hint[data-tone="warning"]').count(), 0)
  await context.close()
}

async function verifyCloseOutboxReplayAndAuth(jobId) {
  const context = await browser.newContext()
  const firstPage = await context.newPage()
  const unloadRequests = []
  const pageErrors = []
  firstPage.on('pageerror', (error) => pageErrors.push(error.message))
  await firstPage.addInitScript((key) => localStorage.removeItem(key), outboxKey)
  await firstPage.addInitScript(() => {
    window.__readerRecoveryFetches = []
    const originalFetch = window.fetch.bind(window)
    window.fetch = (input, init) => {
      window.__readerRecoveryFetches.push({ url: String(input), method: String(init?.method || 'GET'), keepalive: init?.keepalive === true })
      return originalFetch(input, init)
    }
  })
  firstPage.on('request', (request) => {
    if (request.method() !== 'POST' || !isReaderWrite(request.url())) return
    unloadRequests.push({ body: request.postDataJSON(), headers: request.headers(), url: request.url() })
  })
  await firstPage.goto(`${appUrl}/`, { waitUntil: 'domcontentloaded' })
  await firstPage.waitForSelector('.youtube-reader-controls .small-btn')
  await setReaderState(firstPage, jobId, 'page-close')
  await firstPage.route(`${appUrl}/api/**`, async (route) => {
    if (route.request().method() === 'POST' && isReaderWrite(route.request().url())) {
      return route.abort('failed')
    }
    return route.continue()
  })
  await firstPage.evaluate(() => window.dispatchEvent(new Event('pagehide')))
  try {
    await waitFor(() => unloadRequests.length >= 2, 'keepalive requests')
  } catch (error) {
    const debug = await firstPage.evaluate((key) => ({ outbox: localStorage.getItem(key), jobId: window.__state?.currentAudioMeta?.jobId || '', fetches: window.__readerRecoveryFetches }), outboxKey)
    throw new Error(`keepalive requests missing: ${JSON.stringify({ debug, pageErrors })}; ${error.message}`)
  }
  const storedOutbox = await firstPage.evaluate((key) => localStorage.getItem(key), outboxKey)
  assert.ok(storedOutbox, 'page close must synchronously persist reader outbox before keepalive')
  const envelope = JSON.parse(storedOutbox)
  assert.equal(envelope.schemaVersion, 1)
  assert.equal(envelope.entries.length, 2)
  assert.equal(envelope.entries.every((entry) => entry.jobId === jobId), true)
  assert.equal(envelope.entries.every((entry) => ['marks', 'activity'].includes(entry.kind)), true)
  assert.equal(envelope.entries.every((entry) => entry.operationId && Number.isInteger(entry.expectedRevision)), true)
  assert.equal(storedOutbox.includes(token), false, 'outbox must not persist the service token')
  assert.equal(storedOutbox.includes('127.0.0.1'), false, 'outbox must not persist a private service path')
  const keepaliveFetches = await firstPage.evaluate(() => window.__readerRecoveryFetches.filter((item) => item.url.includes('/reader-marks') || item.url.includes('/reader/activity')))
  assert.equal(keepaliveFetches.length, 2)
  assert.equal(keepaliveFetches.every((item) => item.keepalive === true), true)
  assert.equal(unloadRequests.every((request) => request.headers['x-read-web-token'] === token), true)
  assert.equal(unloadRequests.every((request) => !request.url.includes('access_token=')), true)

  await firstPage.close()
  const rejectedReplayPage = await context.newPage()
  const rejectedReplays = []
  rejectedReplayPage.on('request', (request) => {
    if (request.method() === 'POST' && isReaderWrite(request.url())) rejectedReplays.push(request.postDataJSON())
  })
  await rejectedReplayPage.route(`${appUrl}/api/**`, async (route) => {
    if (route.request().method() === 'POST' && isReaderWrite(route.request().url())) {
      return route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ detail: 'token rejected for replay test' }) })
    }
    return route.continue()
  })
  await rejectedReplayPage.goto(`${appUrl}/`, { waitUntil: 'domcontentloaded' })
  await rejectedReplayPage.waitForSelector('.youtube-reader-controls .small-btn')
  await waitFor(() => rejectedReplays.length >= 2, 'rejected outbox replay')
  assert.ok(await rejectedReplayPage.evaluate((key) => localStorage.getItem(key), outboxKey), '401 must retain the outbox')

  await rejectedReplayPage.unroute(`${appUrl}/api/**`)
  await rejectedReplayPage.close()
  const replayPage = await context.newPage()
  const replayRequests = []
  replayPage.on('request', (request) => {
    if (request.method() === 'POST' && isReaderWrite(request.url())) replayRequests.push({ body: request.postDataJSON(), url: request.url() })
  })
  await replayPage.goto(`${appUrl}/`, { waitUntil: 'domcontentloaded' })
  await replayPage.waitForSelector('.youtube-reader-controls .small-btn')
  await waitFor(async () => (await replayPage.evaluate((key) => localStorage.getItem(key), outboxKey)) === null, 'successful outbox replay cleanup')
  const marks = await getJson(`/api/jobs/${encodeURIComponent(jobId)}/reader-marks`)
  const activity = await getJson(`/api/jobs/${encodeURIComponent(jobId)}/reader-activity`)
  assert.equal(marks.revision, 1, 'replayed marks must commit once')
  assert.equal(marks.marks[0].word, 'page-close')
  assert.equal(activity.revision, 1, 'replayed activity must commit once')
  assert.equal(replayRequests.length, 2)
  assert.equal(new Set(replayRequests.map((request) => request.body.operationId || request.body.activityOperationId)).size, 2)
  assert.equal(replayRequests.every((request) => !request.url.includes('access_token=')), true)
  await context.close()
}

async function verifyUnknownOutboxFailsClosed() {
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.addInitScript(({ key, secret }) => {
    localStorage.setItem(key, JSON.stringify({
      schemaVersion: 99,
      token: secret,
      entries: [{ jobId: 'private/path', kind: 'marks', operationId: 'unknown' }],
    }))
  }, { key: outboxKey, secret: token })
  await page.goto(`${appUrl}/`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.youtube-reader-controls .small-btn')
  await waitFor(async () => (await page.evaluate((key) => localStorage.getItem(key), outboxKey)) === null, 'unknown outbox quarantine')
  const quarantine = await page.evaluate((key) => localStorage.getItem(`${key}.quarantine`), outboxKey)
  assert.ok(quarantine)
  assert.match(quarantine, /unknown-or-invalid-envelope/)
  assert.equal(quarantine.includes(token), false)
  assert.equal(quarantine.includes('private/path'), false)
  await context.close()
}

async function setReaderState(page, jobId, word, dispatchMarksChange = false) {
  await page.evaluate(({ id, markWord, dispatch }) => {
    window.__state.currentAudioMeta = { source: 'youtube-workflow', jobId: id, name: `${id}.audio`, size: 1 }
    window.__state.words = [
      { word: markWord, start: 0, end: 0.5 },
      { word: `${markWord}-second`, start: 0.5, end: 1 },
    ]
    window.__state.markedMap = new Map([[0, {
      globalIndex: 0,
      word: markWord,
      start: 0,
      sourceType: 'manual-mark',
    }]])
    if (dispatch) window.dispatchEvent(new Event('reader-marks-changed'))
  }, { id: jobId, markWord: word, dispatch: dispatchMarksChange })
}

function isReaderWrite(url) {
  const pathname = new URL(url).pathname
  return pathname.endsWith('/reader-marks') || pathname.endsWith('/reader/activity')
}

async function createReadyJob(label) {
  const created = await postJson('/api/jobs', { url: `https://example.test/${label}`, geminiMode: 'mock' })
  await waitFor(async () => (await getJson(`/api/jobs/${created.jobId}`)).status === 'ready', `${label} ready job`)
  return created
}

async function postJson(pathname, body) {
  const response = await fetch(`${appUrl}${pathname}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-Read-Web-Token': token },
    body: JSON.stringify(body),
  })
  assert.equal(response.ok, true, `POST ${pathname} failed with ${response.status}`)
  return response.json()
}

async function getJson(pathname) {
  const response = await fetch(`${appUrl}${pathname}`, { headers: { 'X-Read-Web-Token': token } })
  assert.equal(response.ok, true, `GET ${pathname} failed with ${response.status}`)
  return response.json()
}

async function waitFor(predicate, description, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      if (await predicate()) return
    } catch {
      // The isolated server may still be starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`timed out waiting for ${description}`)
}

async function randomPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port
      server.close((error) => error ? reject(error) : resolve(port))
    })
  })
}

function startBackend(port, tempRoot) {
  const python = process.env.READ_WEB_PYTHON || process.env.PYTHON || 'python'
  const code = [
    'import os, uvicorn',
    'from pathlib import Path',
    'from youtube_workflow.core import FakeWorkflowRunner, WorkflowConfig',
    'from youtube_workflow.production_host_prototype import create_local_app_host',
    'from youtube_workflow.service import JobManager, create_app',
    'token = os.environ["READ_WEB_TEST_TOKEN"]',
    'root = Path(os.environ["READ_WEB_TEST_ROOT"])',
    'config = WorkflowConfig(output_dir=root / "output", state_dir=root / "state")',
    'manager = JobManager(config=config, runner_factory=lambda: FakeWorkflowRunner(config))',
    'workflow = create_app(manager, access_token=token)',
    'app = create_local_app_host(dist_dir=Path(os.environ["READ_WEB_TEST_DIST"]), workflow_app=workflow, access_token=token, workflow_access_token=token)',
    'uvicorn.run(app, host="127.0.0.1", port=int(os.environ["READ_WEB_TEST_PORT"]), log_level="warning", access_log=False)',
  ].join('\n')
  const child = spawn(python, ['-c', code], {
    cwd: workflowRoot,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      READ_WEB_TEST_DIST: distDir,
      READ_WEB_TEST_PORT: String(port),
      READ_WEB_TEST_ROOT: tempRoot,
      READ_WEB_TEST_TOKEN: token,
    },
  })
  let diagnostics = ''
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk) => { diagnostics += String(chunk) })
  child.diagnostic = () => diagnostics
  return child
}

async function runCommand(command, args, options) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      ...options,
      windowsHide: true,
      shell: process.platform === 'win32' && command.endsWith('.cmd'),
      stdio: ['ignore', 'ignore', 'pipe'],
    })
    let stderr = ''
    child.stderr.on('data', (chunk) => { stderr += String(chunk) })
    child.once('error', reject)
    child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`${command} ${args.join(' ')} failed: ${stderr}`)))
  })
}

async function stopProcess(child) {
  if (!child || child.exitCode !== null) return
  child.kill()
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 2_000)
    child.once('exit', () => { clearTimeout(timer); resolve() })
  })
}
