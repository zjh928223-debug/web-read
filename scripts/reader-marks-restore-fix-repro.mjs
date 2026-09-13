import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { chromium } from 'playwright'
import { gateEnvironment, resolveSelectedPython } from './lib/python-runtime.mjs'

const repoRoot = path.resolve(import.meta.dirname, '..')
const workflowRoot = path.join(repoRoot, 'tools', 'subtitle-workflow')
const distDir = path.join(repoRoot, 'dist')
const selectedPython = await resolveSelectedPython({
  repoRoot,
  configPath: process.env.READ_WEB_RUNTIME_CONFIG || 'config/runtime.optimization.json',
})
const token = 'reader-marks-restore-fix-repro-token'
const apiPort = await randomPort()
const appUrl = `http://127.0.0.1:${apiPort}`
const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'read-web-reader-marks-restore-repro-'))
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
  }, 'temporary Host')

  const health = await getJson('/api/app/health')
  console.log(`temporary Host health: ${JSON.stringify({ status: health.status, applicationReadiness: health.applicationReadiness, durableOwnerReadiness: health.durableOwnerReadiness })}`)
  const job = await postJson('/api/jobs', { url: 'https://example.test/reader-marks-restore-repro', geminiMode: 'mock' })
  await waitFor(async () => (await getJson(`/api/jobs/${encodeURIComponent(job.jobId)}`)).status === 'ready', 'reproduction job')

  const authoritativeMarks = [
    { globalIndex: 0, word: 'authoritative', start: 0, sourceType: 'manual-mark' },
  ]
  await postJson(`/api/jobs/${encodeURIComponent(job.jobId)}/reader-marks`, {
    marks: authoritativeMarks,
    expectedRevision: 0,
    operationId: 'reader-marks-restore-repro-authority',
  })

  browser = await chromium.launch({ headless: true })
  const context = await browser.newContext()
  const page = await context.newPage()
  const trace = []
  page.on('console', (message) => trace.push({ type: `console:${message.type()}`, text: message.text() }))
  page.on('pageerror', (error) => trace.push({ type: 'pageerror', text: error.message }))
  await page.addInitScript(() => {
    window.__readerMarksRestoreTrace = []
    const record = (type, payload = {}) => {
      window.__readerMarksRestoreTrace.push({ type, at: performance.now(), ...payload })
    }
    window.addEventListener('reader-marks-changed', (event) => {
      record('reader-marks-changed', {
        markedCount: event.detail?.markedCount ?? null,
        source: event.detail?.source || 'unknown',
        operation: event.detail?.operation || null,
      })
    })
    const originalFetch = window.fetch.bind(window)
    window.fetch = async (input, init) => {
      const url = String(input)
      const isMarks = url.includes('/reader-marks')
      if (isMarks) record('fetch-start', { method: String(init?.method || 'GET'), body: init?.body || null })
      const response = await originalFetch(input, init)
      if (isMarks) record('fetch-end', { method: String(init?.method || 'GET'), status: response.status })
      return response
    }
  })

  await page.goto(`${appUrl}/`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.youtube-reader-controls .small-btn')
  await page.evaluate(async ({ id, baseUrl }) => {
    const session = {
      contentId: `session-${id}`,
      revision: `session-${id}:1`,
      audioMeta: {
        source: 'youtube-workflow',
        jobId: id,
        name: `${id}.audio`,
        size: 1,
        streamUrl: `${baseUrl}/api/jobs/${encodeURIComponent(id)}/media/audio`,
      },
      transcript: {
        segments: [{ start: 0, end: 1, words: [
          { word: 'session-snapshot', start: 0, end: 0.5 },
          { word: 'second', start: 0.5, end: 1 },
        ] }],
      },
      chunkData: { s: [{ chunks: [{ a: 0, b: 1, en: 'session-snapshot' }] }] },
      marks: [{ globalIndex: 0, word: 'session-snapshot', start: 0, sourceType: 'manual-mark' }],
    }
    const canonicalJson = (value) => {
      if (value === null || typeof value !== 'object') return JSON.stringify(value)
      if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
      return `{${Object.keys(value).sort().filter((key) => value[key] !== undefined).map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
    }
    const bytes = new TextEncoder().encode(canonicalJson(session))
    const digest = await crypto.subtle.digest('SHA-256', bytes)
    const checksum = `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`
    const timestamp = Date.now()
    const common = { contentId: session.contentId, revision: session.revision, checksum, timestamp }
    const rows = [
      { id: 'audioMeta', content: session.audioMeta, ...common },
      { id: 'transcript', content: session.transcript, ...common },
      { id: 'chunkData', content: session.chunkData, ...common },
      { id: 'marks', content: session.marks, ...common },
      {
        id: 'readerSession',
        content: { schemaVersion: 3, contentId: session.contentId, revision: session.revision, checksum, committedAt: timestamp },
        ...common,
      },
    ]
    await new Promise((resolve, reject) => {
      const request = indexedDB.open('SeekPlayerDB', 1)
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        const transaction = request.result.transaction('files', 'readwrite')
        transaction.oncomplete = resolve
        transaction.onerror = () => reject(transaction.error)
        rows.forEach((row) => transaction.objectStore('files').put(row))
      }
    })
  }, { id: job.jobId, baseUrl: appUrl })

  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.youtube-reader-controls .small-btn')
  await waitFor(async () => {
    const state = await page.evaluate(() => window.__sessionStateProvider?.getState?.() && ({
      jobId: window.__sessionStateProvider.getState().currentAudioMeta?.jobId || '',
      marks: Array.from(window.__sessionStateProvider.getState().markedMap?.values?.() || []),
    }))
    return state?.jobId === job.jobId && state.marks.length === 1
  }, 'session snapshot restore')
  await waitFor(async () => {
    const value = await getJson(`/api/jobs/${encodeURIComponent(job.jobId)}/reader-marks`)
    return value.revision >= 1
  }, 'authority read')
  await new Promise((resolve) => setTimeout(resolve, 800))

  const browserTrace = await page.evaluate(() => ({
    events: window.__readerMarksRestoreTrace,
    state: {
      jobId: window.__sessionStateProvider?.getState?.()?.currentAudioMeta?.jobId || '',
      marks: Array.from(window.__sessionStateProvider?.getState?.()?.markedMap?.values?.() || []),
    },
  }))
  const finalMarks = await getJson(`/api/jobs/${encodeURIComponent(job.jobId)}/reader-marks`)
  const staleMarksPost = browserTrace.events.find((event) => event.type === 'fetch-start'
    && event.method === 'POST'
    && String(event.body || '').includes('session-snapshot'))
  console.log(JSON.stringify({ browserTrace, finalMarks, staleMarksPost }, null, 2))
  assert.equal(staleMarksPost, undefined, 'session restore must not submit a stale marks snapshot')
  assert.deepEqual(finalMarks.marks, authoritativeMarks, 'an untouched reopened page must preserve the complete authoritative mark set')
  assert.equal(finalMarks.integrity?.representation, 'marks-fields.v1')
  assert.match(finalMarks.integrity?.sha256 || '', /^[a-f0-9]{64}$/)
  const authorityChecksum = finalMarks.integrity.sha256

  let delayedAuthorityGet = false
  await page.route(`${appUrl}/api/**`, async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (!delayedAuthorityGet
      && request.method() === 'GET'
      && url.pathname.endsWith('/reader-marks')) {
      delayedAuthorityGet = true
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
    return route.continue()
  })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.youtube-reader-controls .small-btn')
  try {
    await waitFor(async () => {
      return page.evaluate(() => Array.from(window.__sessionStateProvider?.getState?.()?.markedMap?.values?.() || [])[0]?.word === 'authoritative')
    }, 'authority wins when the session restore completes first')
  } catch (error) {
    const debug = await page.evaluate(() => ({
      state: window.__sessionStateProvider?.getState?.() && {
        currentAudioMeta: window.__sessionStateProvider.getState().currentAudioMeta,
        marks: Array.from(window.__sessionStateProvider.getState().markedMap?.values?.() || []),
      },
      trace: window.__readerMarksRestoreTrace,
    }))
    throw new Error(`delayed authority restore failed: ${JSON.stringify(debug)}; ${error.message}`)
  }
  const delayedTrace = await page.evaluate(() => window.__readerMarksRestoreTrace)
  const delayedMarks = await getJson(`/api/jobs/${encodeURIComponent(job.jobId)}/reader-marks`)
  assert.equal(delayedTrace.some((event) => event.type === 'fetch-start'
    && event.method === 'POST'
    && String(event.body || '').includes('session-snapshot')), false, 'a delayed authority GET must still reject a stale session save')
  assert.deepEqual(delayedMarks.marks, authoritativeMarks)
  assert.equal(delayedMarks.integrity?.sha256, authorityChecksum, 'the same authoritative content must retain its checksum across completion orders')
  await page.unroute(`${appUrl}/api/**`)

  const addedMark = { globalIndex: 1, word: 'browser-added', start: 0.5, sourceType: 'manual-mark' }
  await setReaderMarks(page, job.jobId, [...authoritativeMarks, addedMark], {
    dispatch: true,
    operation: { type: 'add', mark: addedMark },
  })
  await waitFor(async () => {
    const value = await getJson(`/api/jobs/${encodeURIComponent(job.jobId)}/reader-marks`)
    return value.marks.length === 2 && value.marks.some((mark) => mark.word === 'browser-added')
  }, 'browser add mark')
  await setReaderMarks(page, job.jobId, authoritativeMarks, {
    dispatch: true,
    operation: { type: 'remove', globalIndex: addedMark.globalIndex },
  })
  await waitFor(async () => {
    const value = await getJson(`/api/jobs/${encodeURIComponent(job.jobId)}/reader-marks`)
    return JSON.stringify(value.marks) === JSON.stringify(authoritativeMarks)
  }, 'browser delete mark')
  const afterDeleteMarks = await getJson(`/api/jobs/${encodeURIComponent(job.jobId)}/reader-marks`)
  assert.deepEqual(afterDeleteMarks.marks, authoritativeMarks, 'browser deletion must not be hidden by a set union')
  assert.equal(afterDeleteMarks.integrity?.representation, 'marks-fields.v1')
  assert.match(afterDeleteMarks.integrity?.sha256 || '', /^[a-f0-9]{64}$/)

  await waitFor(async () => page.evaluate(() => window.__readerMarksRestoreTrace.filter((event) => event.type === 'fetch-end' && event.method === 'POST').length >= 2), 'browser delete save completion')
  const beforeNoEditClose = await page.evaluate(() => window.__readerMarksRestoreTrace.filter((event) => event.type === 'fetch-start' && event.method === 'POST').length)
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')))
  await new Promise((resolve) => setTimeout(resolve, 350))
  const noEditTrace = await page.evaluate(() => window.__readerMarksRestoreTrace)
  const afterNoEditClose = noEditTrace.filter((event) => event.type === 'fetch-start' && event.method === 'POST').length
  assert.equal(afterNoEditClose, beforeNoEditClose, 'an untouched authoritative page close must not create a marks POST')
  assert.equal((await readOutboxEntries(page)).some((entry) => entry.kind === 'marks'), false, 'an untouched authoritative page close must not create a marks outbox entry')

  const rapidJob = await postJson('/api/jobs', { url: 'https://example.test/reader-marks-restore-rapid', geminiMode: 'mock' })
  await waitFor(async () => (await getJson(`/api/jobs/${encodeURIComponent(rapidJob.jobId)}`)).status === 'ready', 'rapid-edit job')
  const rapidContext = await browser.newContext()
  const rapidPage = await rapidContext.newPage()
  await rapidPage.addInitScript(() => {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('read-web.reader-save-outbox')) localStorage.removeItem(key)
    }
  })
  const rapidRequests = []
  rapidPage.on('request', (request) => {
    if (request.method() === 'POST' && request.url().includes('/reader-marks')) rapidRequests.push(request.postDataJSON())
  })
  let heldRapidRequest = false
  await rapidPage.route(`${appUrl}/api/**`, async (route) => {
    const request = route.request()
    if (request.method() === 'POST' && request.url().includes('/reader-marks')) {
      const body = request.postDataJSON() || {}
      if (!heldRapidRequest && body.marks?.some((mark) => mark.word === 'rapid-a')) {
        heldRapidRequest = true
        await new Promise((resolve) => setTimeout(resolve, 350))
      }
    }
    return route.continue()
  })
  await rapidPage.goto(`${appUrl}/`, { waitUntil: 'domcontentloaded' })
  await rapidPage.waitForSelector('.youtube-reader-controls .small-btn')
  const firstRapidPost = rapidPage.waitForRequest((request) => request.method() === 'POST'
    && request.url().includes('/reader-marks')
    && request.postDataJSON()?.marks?.some((mark) => mark.word === 'rapid-a'))
  await setReaderState(rapidPage, rapidJob.jobId, 'rapid-a', true)
  await firstRapidPost
  await setReaderState(rapidPage, rapidJob.jobId, 'rapid-b', true)
  await rapidPage.evaluate(() => window.dispatchEvent(new Event('pagehide')))
  try {
    await waitFor(async () => {
      const value = await getJson(`/api/jobs/${encodeURIComponent(rapidJob.jobId)}/reader-marks`)
      return value.marks[0]?.word === 'rapid-b'
    }, 'rapid edit close keeps the last intent')
  } catch (error) {
    const debug = await rapidPage.evaluate(() => ({
      state: window.__sessionStateProvider?.getState?.() && {
        currentAudioMeta: window.__sessionStateProvider.getState().currentAudioMeta,
        marks: Array.from(window.__sessionStateProvider.getState().markedMap?.values?.() || []),
      },
      outbox: Object.keys(localStorage).filter((key) => key.startsWith('read-web.reader-save-outbox')).map((key) => [key, localStorage.getItem(key)]),
    }))
    const value = await getJson(`/api/jobs/${encodeURIComponent(rapidJob.jobId)}/reader-marks`)
    throw new Error(`rapid edit close failed: ${JSON.stringify({ value, rapidRequests, debug })}; ${error.message}`)
  }
  const rapidMarks = await getJson(`/api/jobs/${encodeURIComponent(rapidJob.jobId)}/reader-marks`)
  assert.equal(rapidMarks.marks[0]?.word, 'rapid-b', 'the final rapid edit must win')
  assert.ok(rapidRequests.some((body) => body.marks?.[0]?.word === 'rapid-b'), 'close must send the latest pending marks intent')
  await waitFor(async () => !(await readOutboxEntries(rapidPage)).some((entry) => entry.kind === 'marks'), 'successful close-time marks receipt cleanup')
  assert.equal((await readOutboxEntries(rapidPage)).some((entry) => entry.kind === 'marks'), false, 'a successful close-time latest intent must settle its receipt')
  await rapidPage.close()
  await rapidContext.close()
  await context.close()
  console.log('reader marks restore fix browser check passed')
} finally {
  if (browser) await browser.close()
  for (const child of childProcesses.reverse()) await stopProcess(child)
  await rm(tempRoot, { recursive: true, force: true })
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

async function readOutboxEntries(page) {
  return page.evaluate(() => Object.keys(localStorage)
    .filter((key) => key.startsWith('read-web.reader-save-outbox.v2.'))
    .map((key) => {
      try { return JSON.parse(localStorage.getItem(key) || 'null') } catch { return null }
    })
    .filter(Boolean))
}

async function setReaderState(page, jobId, word, dispatch = false) {
  const mark = { globalIndex: 0, word, start: 0, sourceType: 'manual-mark' }
  return setReaderMarks(page, jobId, [mark], {
    dispatch,
    operation: { type: 'replace', marks: [mark] },
  })
}

async function setReaderMarks(page, jobId, marks, { dispatch = false, operation = null } = {}) {
  await page.evaluate(({ id, nextMarks, shouldDispatch, nextOperation }) => {
    const state = window.__sessionStateProvider.getState()
    state.currentAudioMeta = { source: 'youtube-workflow', jobId: id, name: `${id}.audio`, size: 1 }
    state.words = nextMarks.map((mark) => ({ word: mark.word, start: mark.start, end: Number(mark.start) + 0.5 }))
    state.markedMap = new Map(nextMarks.map((mark) => [mark.globalIndex, mark]))
    if (shouldDispatch) {
      window.dispatchEvent(new CustomEvent('reader-marks-changed', {
        detail: {
          source: 'edit',
          operation: nextOperation || { type: 'replace', marks: nextMarks },
        },
      }))
    }
  }, { id: jobId, nextMarks: marks, shouldDispatch: dispatch, nextOperation: operation })
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

function startBackend(port, root) {
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
  const child = spawn(selectedPython.executable, ['-c', code], {
    cwd: workflowRoot,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...gateEnvironment(selectedPython),
      READ_WEB_TEST_DIST: distDir,
      READ_WEB_TEST_PORT: String(port),
      READ_WEB_TEST_ROOT: root,
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
