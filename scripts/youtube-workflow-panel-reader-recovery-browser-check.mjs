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
const token = 'reader-recovery-browser-test-token'
const outboxKey = 'read-web.reader-save-outbox.v1'
const outboxEntryPrefix = 'read-web.reader-save-outbox.v2.'
const outboxQuarantinePrefix = 'read-web.reader-save-outbox-quarantine.v1.'
const bfcacheEventKey = 'read-web.test.reader-bfcache-events'

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
  const concurrentJobOne = await createReadyJob('reader-recovery-concurrent-one')
  const concurrentJobTwo = await createReadyJob('reader-recovery-concurrent-two')
  const sameJob = await createReadyJob('reader-recovery-same-job')
  const bfcacheJob = await createReadyJob('reader-recovery-bfcache')
  const legacyJob = await createReadyJob('reader-recovery-legacy-migration')

  browser = await chromium.launch({ headless: true })
  await verifyConflictReloadAndSingleFlight(jobOne.jobId)
  await verifyCloseOutboxReplayAndAuth(jobTwo.jobId)
  await verifyConcurrentOutboxAndConflict(concurrentJobOne.jobId, concurrentJobTwo.jobId, sameJob.jobId)
  await verifyBfcacheReceiptGeneration(bfcacheJob.jobId)
  await verifyLegacyOutboxMigration(legacyJob.jobId)
  await verifyInvalidOutboxQuarantine()
  await verifyQuarantineQuotaFailureFailsClosed()
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
  let allowInitialAuthorityGet = true
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
    if (allowInitialAuthorityGet) {
      allowInitialAuthorityGet = false
      await new Promise((resolve) => setTimeout(resolve, 120))
      return route.continue()
    }
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
  const initialAuthorityResponse = page.waitForResponse((response) => {
    const url = new URL(response.url())
    return response.request().method() === 'GET' && url.pathname.endsWith('/reader-marks')
  })
  await setReaderState(page, jobId, 'initial', true)
  await (await initialAuthorityResponse).finished()
  authorityGets = 0
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
      currentAudioMeta: window.__sessionStateProvider?.getState?.()?.currentAudioMeta || null,
      notice: document.querySelector('p.youtube-workflow-hint[data-tone="warning"]')?.textContent || '',
      actionCount: document.querySelectorAll('[data-reader-conflict-action]').length,
    }))
    throw new Error(`conflict action did not appear: ${JSON.stringify(debug)}; ${error.message}`)
  }
  assert.match(await page.locator('p.youtube-workflow-hint[data-tone="warning"]').innerText(), /并发冲突|其他标签页更新/)

  await page.evaluate(() => {
    const button = document.querySelector('[data-reader-conflict-action]')
    button.click()
    button.click()
  })
  await waitFor(async () => {
    const value = await getJson(`/api/jobs/${encodeURIComponent(jobId)}/reader-marks`)
    return value.revision === 2 && value.marks.some((mark) => mark.word === 'owner-b')
  }, 'conflict retry')
  await page.waitForFunction(() => document.querySelectorAll('[data-reader-conflict-action]').length === 0)

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
  await addClearOutboxScript(firstPage)
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
    const debug = await firstPage.evaluate((key) => ({ outbox: localStorage.getItem(key), fetches: window.__readerRecoveryFetches }), outboxKey)
    throw new Error(`keepalive requests missing: ${JSON.stringify({ debug, pageErrors })}; ${error.message}`)
  }
  const storedEntries = await readOutboxEntries(firstPage)
  assert.equal(storedEntries.length, 2, 'page close must synchronously persist one key per operation before keepalive')
  assert.equal(storedEntries.every(({ value }) => value.schemaVersion === 2), true)
  assert.equal(storedEntries.every(({ value }) => value.jobId === jobId), true)
  assert.equal(storedEntries.every(({ value }) => ['marks', 'activity'].includes(value.kind)), true)
  assert.equal(storedEntries.every(({ value }) => value.operationId && Number.isInteger(value.expectedRevision)), true)
  const storedOutbox = JSON.stringify(storedEntries)
  assert.equal(storedOutbox.includes(token), false, 'outbox must not persist the service token')
  assert.equal(storedOutbox.includes('127.0.0.1'), false, 'outbox must not persist a private service path')
  const keepaliveFetches = await firstPage.evaluate(() => window.__readerRecoveryFetches.filter((item) => item.method === 'POST' && (item.url.includes('/reader-marks') || item.url.includes('/reader/activity'))))
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
  assert.equal((await readOutboxEntries(rejectedReplayPage)).length, 2, '401 must retain every operation receipt')

  await rejectedReplayPage.unroute(`${appUrl}/api/**`)
  await rejectedReplayPage.close()
  const replayPage = await context.newPage()
  const replayRequests = []
  replayPage.on('request', (request) => {
    if (request.method() === 'POST' && isReaderWrite(request.url())) replayRequests.push({ body: request.postDataJSON(), url: request.url() })
  })
  await replayPage.goto(`${appUrl}/`, { waitUntil: 'domcontentloaded' })
  await replayPage.waitForSelector('.youtube-reader-controls .small-btn')
  await waitFor(async () => (await readOutboxEntries(replayPage)).length === 0, 'successful outbox replay cleanup')
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

async function verifyConcurrentOutboxAndConflict(jobOneId, jobTwoId, sameJobId) {
  const context = await browser.newContext()
  const firstPage = await context.newPage()
  const secondPage = await context.newPage()
  await addClearOutboxScript(firstPage)
  await addClearOutboxScript(secondPage)
  await Promise.all([
    firstPage.goto(`${appUrl}/`, { waitUntil: 'domcontentloaded' }),
    secondPage.goto(`${appUrl}/`, { waitUntil: 'domcontentloaded' }),
  ])
  await Promise.all([
    firstPage.waitForSelector('.youtube-reader-controls .small-btn'),
    secondPage.waitForSelector('.youtube-reader-controls .small-btn'),
  ])
  await installLegacyEnvelopeRaceBarrier(firstPage, 'one')
  await installLegacyEnvelopeRaceBarrier(secondPage, 'two')
  await setReaderState(firstPage, jobOneId, 'concurrent-one')
  await setReaderState(secondPage, jobTwoId, 'concurrent-two')
  await Promise.all([
    abortReaderWrites(firstPage),
    abortReaderWrites(secondPage),
  ])
  await Promise.all([
    dispatchPageHide(firstPage, false),
    dispatchPageHide(secondPage, false),
  ])
  await waitFor(async () => (await readOutboxEntries(firstPage)).length === 4, 'concurrent independent outbox writes')
  const concurrentEntries = await readOutboxEntries(firstPage)
  assert.deepEqual(new Set(concurrentEntries.map(({ value }) => value.jobId)), new Set([jobOneId, jobTwoId]))

  const replayPage = await context.newPage()
  const replayRequests = []
  replayPage.on('request', (request) => {
    if (request.method() === 'POST' && isReaderWrite(request.url())) replayRequests.push(request.postDataJSON())
  })
  await replayPage.goto(`${appUrl}/`, { waitUntil: 'domcontentloaded' })
  await replayPage.waitForSelector('.youtube-reader-controls .small-btn')
  await waitFor(async () => (await readOutboxEntries(replayPage)).length === 0, 'concurrent independent outbox replay')
  assert.equal(replayRequests.length, 4)
  assert.equal((await getJson(`/api/jobs/${encodeURIComponent(jobOneId)}/reader-marks`)).marks[0].word, 'concurrent-one')
  assert.equal((await getJson(`/api/jobs/${encodeURIComponent(jobTwoId)}/reader-marks`)).marks[0].word, 'concurrent-two')
  await replayPage.close()

  await clearOutboxStorage(firstPage)
  await firstPage.close()
  await secondPage.close()
  const sameFirstPage = await context.newPage()
  const sameSecondPage = await context.newPage()
  await addClearOutboxScript(sameFirstPage)
  await addClearOutboxScript(sameSecondPage)
  await Promise.all([
    sameFirstPage.goto(`${appUrl}/`, { waitUntil: 'domcontentloaded' }),
    sameSecondPage.goto(`${appUrl}/`, { waitUntil: 'domcontentloaded' }),
  ])
  await Promise.all([
    sameFirstPage.waitForSelector('.youtube-reader-controls .small-btn'),
    sameSecondPage.waitForSelector('.youtube-reader-controls .small-btn'),
  ])
  await abortReaderWrites(sameFirstPage)
  await abortReaderWrites(sameSecondPage)
  await setReaderState(sameFirstPage, sameJobId, 'same-job-one')
  await setReaderState(sameSecondPage, sameJobId, 'same-job-two')
  await Promise.all([
    dispatchPageHide(sameFirstPage, false),
    dispatchPageHide(sameSecondPage, false),
  ])
  await waitFor(async () => (await readOutboxEntries(sameFirstPage)).length === 4, 'same-job operation receipts')
  const sameJobEntries = await readOutboxEntries(sameFirstPage)
  const sameJobMarks = sameJobEntries.filter(({ value }) => value.kind === 'marks')
  assert.equal(sameJobMarks.length, 2)
  assert.equal(new Set(sameJobMarks.map(({ value }) => value.operationId)).size, 2)
  assert.deepEqual(new Set(sameJobMarks.map(({ value }) => value.intent.marks[0].word)), new Set(['same-job-one', 'same-job-two']))

  const conflictPage = await context.newPage()
  await conflictPage.goto(`${appUrl}/`, { waitUntil: 'domcontentloaded' })
  await conflictPage.waitForSelector('.youtube-reader-controls .small-btn')
  await waitFor(async () => (await readOutboxEntries(conflictPage)).length === 2, 'same-job winner and conflict replay')
  const remaining = await readOutboxEntries(conflictPage)
  assert.equal(remaining.every(({ value }) => value.jobId === sameJobId), true)
  assert.equal(remaining.filter(({ value }) => value.kind === 'marks').length, 1)
  assert.equal(remaining.filter(({ value }) => value.kind === 'activity').length, 1)
  assert.equal((await getJson(`/api/jobs/${encodeURIComponent(sameJobId)}/reader-marks`)).revision, 1)
  const winnerWord = (await getJson(`/api/jobs/${encodeURIComponent(sameJobId)}/reader-marks`)).marks[0].word
  assert.ok(['same-job-one', 'same-job-two'].includes(winnerWord))
  assert.ok(remaining.some(({ value }) => value.kind === 'marks' && value.intent.marks[0].word !== winnerWord), 'conflict must retain the losing local intent')
  await context.close()
}

async function verifyBfcacheReceiptGeneration(jobId) {
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.addInitScript((eventKey) => {
    const record = (type, event) => {
      let events = []
      try {
        events = JSON.parse(localStorage.getItem(eventKey) || '[]')
      } catch {
        events = []
      }
      events.push({ type, persisted: event.persisted === true, href: location.href })
      localStorage.setItem(eventKey, JSON.stringify(events))
    }
    window.addEventListener('pagehide', (event) => record('pagehide', event))
    window.addEventListener('pageshow', (event) => record('pageshow', event))
  }, bfcacheEventKey)
  const readerUrl = `${appUrl}/?bfcacheProbe=reader`
  const destinationUrl = `${appUrl}/?bfcacheProbe=destination`
  await page.goto(readerUrl, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.youtube-reader-controls .small-btn')
  await setReaderState(page, jobId, 'before-bfcache')
  await abortReaderWrites(page)
  await page.goto(destinationUrl, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.youtube-reader-controls .small-btn')
  await waitFor(async () => (await readOutboxEntries(page)).length === 2, 'persisted pagehide receipt')
  const firstGeneration = await readOutboxEntries(page)
  await page.goBack({ waitUntil: 'commit' })
  await page.waitForSelector('.youtube-reader-controls .small-btn')
  try {
    await page.waitForFunction(({ eventKey, expectedHref }) => {
      const events = JSON.parse(localStorage.getItem(eventKey) || '[]')
      return events.some((event) => event.type === 'pagehide' && event.persisted && event.href === expectedHref)
        && events.some((event) => event.type === 'pageshow' && event.persisted && event.href === expectedHref)
    }, { eventKey: bfcacheEventKey, expectedHref: readerUrl }, { timeout: 5_000 })
  } catch (error) {
    const evidence = await page.evaluate((eventKey) => ({
      events: JSON.parse(localStorage.getItem(eventKey) || '[]'),
      navigation: performance.getEntriesByType('navigation').map((entry) => ({
        type: entry.type,
        notRestoredReasons: entry.notRestoredReasons || null,
      })),
    }), bfcacheEventKey)
    const readerLifecycle = evidence.events.filter((event) => event.href === readerUrl)
    const realLifecycleUnsupported = readerLifecycle.some((event) => event.type === 'pagehide' && event.persisted === false)
      && readerLifecycle.some((event) => event.type === 'pageshow' && event.persisted === false)
      && !readerLifecycle.some((event) => event.persisted === true)
    if (!realLifecycleUnsupported) {
      throw new Error(`real BFCache lifecycle failed without unsupported-runtime evidence: ${JSON.stringify(evidence)}; ${error.message}`)
    }
    console.log(`real BFCache unavailable in this Chromium headless run; using synthetic lifecycle coverage: ${JSON.stringify(evidence)}`)
    await context.close()
    await verifySyntheticBfcacheReceiptGeneration(jobId)
    return
  }
  await page.unroute(`${appUrl}/api/**`)
  await setReaderState(page, jobId, 'after-bfcache')
  await page.evaluate(() => window.dispatchEvent(new Event('reader-marks-changed')))
  await waitFor(async () => {
    const marks = await getJson(`/api/jobs/${encodeURIComponent(jobId)}/reader-marks`)
    return marks.marks[0]?.word === 'after-bfcache'
  }, 'post-BFCache latest intent')
  await abortReaderWrites(page)
  await page.close({ runBeforeUnload: true })
  const inspector = await context.newPage()
  await abortReaderWrites(inspector)
  await inspector.goto(destinationUrl, { waitUntil: 'domcontentloaded' })
  await inspector.waitForSelector('.youtube-reader-controls .small-btn')
  await waitFor(async () => (await readOutboxEntries(inspector)).filter(({ value }) => value.kind === 'marks').length >= 2, 'new generation close receipt')
  const lifecycleEvents = await inspector.evaluate((eventKey) => JSON.parse(localStorage.getItem(eventKey) || '[]'), bfcacheEventKey)
  assert.ok(lifecycleEvents.some((event) => event.type === 'pagehide' && event.persisted === false && event.href === readerUrl), 'final page close must dispatch non-persisted pagehide')
  const finalEntries = await readOutboxEntries(inspector)
  const finalMarks = finalEntries.filter(({ value }) => value.kind === 'marks')
  const finalActivity = finalEntries.filter(({ value }) => value.kind === 'activity')
  const firstActivity = firstGeneration.find(({ value }) => value.kind === 'activity')
  assert.ok(finalMarks.some(({ value }) => value.intent.marks[0].word === 'after-bfcache'))
  assert.ok(finalMarks.some(({ value }) => value.operationId !== firstGeneration.find(({ value: first }) => first.kind === 'marks')?.operationId))
  assert.ok(finalActivity.some(({ value }) => value.operationId !== firstActivity?.value.operationId && value.intent.event === 'close'))
  assert.equal((await getJson(`/api/jobs/${encodeURIComponent(jobId)}/reader-marks`)).marks[0].word, 'after-bfcache')
  await context.close()
}

async function verifySyntheticBfcacheReceiptGeneration(jobId) {
  const context = await browser.newContext()
  const page = await context.newPage()
  await addClearOutboxScript(page)
  await page.goto(`${appUrl}/`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.youtube-reader-controls .small-btn')
  await setReaderState(page, jobId, 'before-bfcache')
  await abortReaderWrites(page)
  await dispatchPageHide(page, true)
  await waitFor(async () => (await readOutboxEntries(page)).length === 2, 'synthetic persisted pagehide receipt')
  const firstGeneration = await readOutboxEntries(page)
  await dispatchPageShow(page, true)
  await page.unroute(`${appUrl}/api/**`)
  await setReaderState(page, jobId, 'after-bfcache')
  await page.evaluate(() => window.dispatchEvent(new Event('reader-marks-changed')))
  await waitFor(async () => {
    const marks = await getJson(`/api/jobs/${encodeURIComponent(jobId)}/reader-marks`)
    return marks.marks[0]?.word === 'after-bfcache'
  }, 'synthetic post-BFCache latest intent')
  await abortReaderWrites(page)
  await dispatchPageHide(page, false)
  await waitFor(async () => (await readOutboxEntries(page)).filter(({ value }) => value.kind === 'marks').length >= 2, 'synthetic new generation close receipt')
  const finalEntries = await readOutboxEntries(page)
  const finalMarks = finalEntries.filter(({ value }) => value.kind === 'marks')
  const finalActivity = finalEntries.filter(({ value }) => value.kind === 'activity')
  const firstActivity = firstGeneration.find(({ value }) => value.kind === 'activity')
  assert.ok(finalMarks.some(({ value }) => value.intent.marks[0].word === 'after-bfcache'))
  assert.ok(finalMarks.some(({ value }) => value.operationId !== firstGeneration.find(({ value: first }) => first.kind === 'marks')?.operationId))
  assert.ok(finalActivity.some(({ value }) => value.operationId !== firstActivity?.value.operationId && value.intent.event === 'close'))
  assert.equal((await getJson(`/api/jobs/${encodeURIComponent(jobId)}/reader-marks`)).marks[0].word, 'after-bfcache')
  await context.close()
}

async function verifyLegacyOutboxMigration(jobId) {
  const context = await browser.newContext()
  const page = await context.newPage()
  await addClearOutboxScript(page)
  const marksOperationId = `legacy-marks-${jobId}`
  const activityOperationId = `legacy-activity-${jobId}`
  await page.addInitScript(({ key, job, marksId, activityId }) => {
    localStorage.setItem(key, JSON.stringify({
      schemaVersion: 1,
      entries: [
        {
          jobId: job,
          kind: 'marks',
          operationId: marksId,
          expectedRevision: 0,
          intent: {
            marks: [{ globalIndex: 0, word: 'legacy-migrated', start: 0, sourceType: 'manual-mark' }],
          },
        },
        {
          jobId: job,
          kind: 'activity',
          operationId: activityId,
          expectedRevision: 0,
          intent: {
            event: 'close',
            sessionId: `${job}-legacy-session`,
            sessionStartedAt: '2026-08-14T00:00:00.000Z',
            positionSeconds: 0,
            durationSeconds: 1,
            intervals: [],
            coverageRatio: 0,
            markCount: 1,
          },
        },
      ],
    }))
  }, { key: outboxKey, job: jobId, marksId: marksOperationId, activityId: activityOperationId })
  const replayRequests = []
  page.on('request', (request) => {
    if (request.method() === 'POST' && isReaderWrite(request.url())) replayRequests.push(request.postDataJSON())
  })
  await page.goto(`${appUrl}/`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.youtube-reader-controls .small-btn')
  await waitFor(async () => (await page.evaluate((key) => localStorage.getItem(key), outboxKey)) === null, 'legacy envelope migration')
  await waitFor(async () => (await readOutboxEntries(page)).length === 0, 'legacy migrated operation replay')
  assert.equal(replayRequests.length, 2)
  assert.ok(replayRequests.some((payload) => payload.operationId === marksOperationId))
  assert.ok(replayRequests.some((payload) => payload.activityOperationId === activityOperationId))
  const marks = await getJson(`/api/jobs/${encodeURIComponent(jobId)}/reader-marks`)
  const activity = await getJson(`/api/jobs/${encodeURIComponent(jobId)}/reader-activity`)
  assert.equal(marks.revision, 1)
  assert.equal(marks.marks[0].word, 'legacy-migrated')
  assert.equal(activity.revision, 1)
  await context.close()
}

async function verifyInvalidOutboxQuarantine() {
  const legacyMalformed = '{"token":"LEGACY-MALFORMED-SECRET"'
  await verifyQuarantineScenario('legacy malformed', [{
    key: outboxKey,
    rawValue: legacyMalformed,
    reason: 'malformed-json',
    sensitiveValues: ['LEGACY-MALFORMED-SECRET'],
  }])

  const legacyUnknown = JSON.stringify({
    schemaVersion: 99,
    token: 'LEGACY-UNKNOWN-SECRET',
    entries: [{ jobId: 'private/legacy/path', kind: 'marks', operationId: 'unknown' }],
  })
  await verifyQuarantineScenario('legacy unknown', [{
    key: outboxKey,
    rawValue: legacyUnknown,
    reason: 'unknown-or-invalid-envelope',
    sensitiveValues: ['LEGACY-UNKNOWN-SECRET', 'private/legacy/path'],
  }])

  const malformedKey = `${outboxEntryPrefix}malformed-entry`
  const unknownKey = `${outboxEntryPrefix}unknown-entry`
  const mismatchKey = `${outboxEntryPrefix}mismatched-entry`
  const malformedRaw = '{"token":"V2-MALFORMED-SECRET"'
  const unknownRaw = JSON.stringify({ schemaVersion: 99, token: 'V2-UNKNOWN-SECRET', jobId: 'private/v2/path' })
  const mismatchRaw = JSON.stringify({
    schemaVersion: 2,
    jobId: 'mismatch-job',
    kind: 'marks',
    operationId: 'mismatch-operation',
    expectedRevision: 0,
    intent: { marks: [] },
  })
  await verifyQuarantineScenario('v2 malformed, unknown, and key mismatch', [
    { key: malformedKey, rawValue: malformedRaw, reason: 'malformed-json', sensitiveValues: ['V2-MALFORMED-SECRET'] },
    { key: unknownKey, rawValue: unknownRaw, reason: 'unknown-or-invalid-envelope', sensitiveValues: ['V2-UNKNOWN-SECRET', 'private/v2/path'] },
    { key: mismatchKey, rawValue: mismatchRaw, reason: 'outbox-key-mismatch' },
  ])
}

async function verifyQuarantineScenario(label, sources) {
  const context = await browser.newContext()
  const page = await context.newPage()
  const readerRequests = []
  const consoleMessages = []
  page.on('request', (request) => {
    if (request.method() === 'POST' && isReaderWrite(request.url())) readerRequests.push(request.url())
  })
  page.on('console', (message) => consoleMessages.push(message.text()))
  await page.addInitScript((items) => {
    items.forEach(({ key, rawValue }) => localStorage.setItem(key, rawValue))
  }, sources)
  await page.goto(`${appUrl}/`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.youtube-reader-controls .small-btn')
  await waitFor(async () => {
    const remaining = await page.evaluate((keys) => keys.filter((key) => localStorage.getItem(key) !== null), sources.map((item) => item.key))
    return remaining.length === 0
  }, `${label} source removal after verified quarantine`)
  const quarantines = await readQuarantineEntries(page)
  assert.equal(quarantines.length, sources.length, `${label} must preserve one independent quarantine per source`)
  for (const source of sources) {
    const quarantine = quarantines.find(({ value }) => value.sourceKey === source.key)?.value
    assert.ok(quarantine, `${label} must retain source key ${source.key}`)
    assert.equal(quarantine.rawValue, source.rawValue, `${label} must retain the exact original string`)
    assert.equal(quarantine.reason, source.reason)
    assert.equal(Number.isNaN(Date.parse(quarantine.detectedAt)), false)
  }
  assert.equal(readerRequests.length, 0, `${label} must never replay quarantined data`)
  const visibleText = await page.locator('body').innerText()
  const ordinaryDiagnostics = `${visibleText}\n${consoleMessages.join('\n')}`
  for (const source of sources) {
    assert.equal(ordinaryDiagnostics.includes(source.rawValue), false, `${label} raw value must not enter visible diagnostics or logs`)
    for (const sensitiveValue of source.sensitiveValues || []) {
      assert.equal(ordinaryDiagnostics.includes(sensitiveValue), false, `${label} sensitive values must not enter visible diagnostics or logs`)
    }
  }
  await context.close()
}

async function verifyQuarantineQuotaFailureFailsClosed() {
  const context = await browser.newContext()
  const page = await context.newPage()
  const sourceKey = `${outboxEntryPrefix}quota-entry`
  const rawValue = JSON.stringify({ schemaVersion: 99, token: 'QUOTA-SECRET', jobId: 'private/quota/path' })
  const readerRequests = []
  const consoleMessages = []
  page.on('request', (request) => {
    if (request.method() === 'POST' && isReaderWrite(request.url())) readerRequests.push(request.url())
  })
  page.on('console', (message) => consoleMessages.push(message.text()))
  await page.addInitScript(({ key, raw, quarantinePrefix }) => {
    localStorage.setItem(key, raw)
    const originalSetItem = Storage.prototype.setItem
    Storage.prototype.setItem = function (targetKey, value) {
      if (String(targetKey).startsWith(quarantinePrefix)) {
        throw new DOMException('Storage quota exceeded', 'QuotaExceededError')
      }
      return originalSetItem.call(this, targetKey, value)
    }
  }, { key: sourceKey, raw: rawValue, quarantinePrefix: outboxQuarantinePrefix })
  await page.goto(`${appUrl}/`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.youtube-reader-controls .small-btn')
  await page.waitForTimeout(300)
  assert.equal(await page.evaluate((key) => localStorage.getItem(key), sourceKey), rawValue, 'quota failure must retain the invalid source')
  assert.equal((await readQuarantineEntries(page)).length, 0, 'quota failure must not claim a completed quarantine')
  assert.equal(readerRequests.length, 0, 'quota failure must remain fail-closed without replay')
  const ordinaryDiagnostics = `${await page.locator('body').innerText()}\n${consoleMessages.join('\n')}`
  assert.equal(ordinaryDiagnostics.includes(rawValue), false, 'quota failure diagnostics must not expose the raw source')
  assert.equal(ordinaryDiagnostics.includes('QUOTA-SECRET'), false, 'quota failure diagnostics must not expose secrets')
  assert.equal(ordinaryDiagnostics.includes('private/quota/path'), false, 'quota failure diagnostics must not expose paths')
  await context.close()
}

async function addClearOutboxScript(page) {
  await page.addInitScript(({ legacyKey, prefix, quarantinePrefix }) => {
    for (let index = localStorage.length - 1; index >= 0; index -= 1) {
      const key = localStorage.key(index)
      if (key === legacyKey
        || key === `${legacyKey}.quarantine`
        || key?.startsWith(prefix)
        || key?.startsWith(quarantinePrefix)) localStorage.removeItem(key)
    }
  }, { legacyKey: outboxKey, prefix: outboxEntryPrefix, quarantinePrefix: outboxQuarantinePrefix })
}

async function clearOutboxStorage(page) {
  await page.evaluate(({ legacyKey, prefix, quarantinePrefix }) => {
    for (let index = localStorage.length - 1; index >= 0; index -= 1) {
      const key = localStorage.key(index)
      if (key === legacyKey
        || key === `${legacyKey}.quarantine`
        || key?.startsWith(prefix)
        || key?.startsWith(quarantinePrefix)) localStorage.removeItem(key)
    }
  }, { legacyKey: outboxKey, prefix: outboxEntryPrefix, quarantinePrefix: outboxQuarantinePrefix })
}

async function readOutboxEntries(page) {
  return page.evaluate((prefix) => {
    const entries = []
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index)
      if (!key?.startsWith(prefix)) continue
      try {
        entries.push({ key, value: JSON.parse(localStorage.getItem(key) || '') })
      } catch {
        entries.push({ key, value: null })
      }
    }
    return entries
  }, outboxEntryPrefix)
}

async function readQuarantineEntries(page) {
  return page.evaluate((prefix) => {
    const entries = []
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index)
      if (!key?.startsWith(prefix)) continue
      entries.push({ key, value: JSON.parse(localStorage.getItem(key) || '') })
    }
    return entries
  }, outboxQuarantinePrefix)
}

async function installLegacyEnvelopeRaceBarrier(page, label) {
  await page.evaluate((name) => {
    const legacyKey = 'read-web.reader-save-outbox.v1'
    const ownBarrier = `${legacyKey}.race.${name}`
    const otherBarrier = `${legacyKey}.race.${name === 'one' ? 'two' : 'one'}`
    const originalGetItem = Storage.prototype.getItem
    const originalSetItem = Storage.prototype.setItem
    let blocked = false
    Storage.prototype.getItem = function (key) {
      if (key === legacyKey && !blocked) {
        blocked = true
        const raw = originalGetItem.call(this, key)
        originalSetItem.call(this, ownBarrier, 'ready')
        const deadline = Date.now() + 5_000
        while (originalGetItem.call(this, otherBarrier) !== 'ready') {
          if (Date.now() > deadline) throw new Error('legacy envelope race barrier timed out')
        }
        return raw
      }
      return originalGetItem.call(this, key)
    }
  }, label)
}

async function abortReaderWrites(page) {
  await page.route(`${appUrl}/api/**`, async (route) => {
    if (route.request().method() === 'POST' && isReaderWrite(route.request().url())) return route.abort('failed')
    return route.continue()
  })
}

async function dispatchPageHide(page, persisted) {
  await page.evaluate((isPersisted) => {
    const event = typeof PageTransitionEvent === 'function'
      ? new PageTransitionEvent('pagehide', { persisted: isPersisted })
      : new Event('pagehide')
    if (typeof PageTransitionEvent !== 'function') Object.defineProperty(event, 'persisted', { configurable: true, value: isPersisted })
    window.dispatchEvent(event)
  }, persisted)
}

async function dispatchPageShow(page, persisted) {
  await page.evaluate((isPersisted) => {
    const event = typeof PageTransitionEvent === 'function'
      ? new PageTransitionEvent('pageshow', { persisted: isPersisted })
      : new Event('pageshow')
    if (typeof PageTransitionEvent !== 'function') Object.defineProperty(event, 'persisted', { configurable: true, value: isPersisted })
    window.dispatchEvent(event)
  }, persisted)
}

async function setReaderState(page, jobId, word, dispatchMarksChange = false) {
  await page.waitForFunction(() => {
    try {
      return Boolean(window.__sessionStateProvider?.getState?.())
    } catch (_error) {
      return false
    }
  })
  await page.evaluate(({ id, markWord, dispatch }) => {
    const state = window.__sessionStateProvider.getState()
    state.currentAudioMeta = { source: 'youtube-workflow', jobId: id, name: `${id}.audio`, size: 1 }
    state.words = [
      { word: markWord, start: 0, end: 0.5 },
      { word: `${markWord}-second`, start: 0.5, end: 1 },
    ]
    state.markedMap = new Map([[0, {
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
  const python = selectedPython.executable
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
      ...gateEnvironment(selectedPython),
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
