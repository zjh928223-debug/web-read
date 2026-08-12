import assert from 'node:assert/strict'
import http from 'node:http'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'

const repoRoot = path.resolve(import.meta.dirname, '..')
const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url || '/', 'http://127.0.0.1')
    if (url.pathname === '/') {
      return send(response, 200, 'text/html', `<!doctype html>
        <meta charset="utf-8"><title>Accessible request state journeys</title>
        <button id="open">Open action</button>
        <section id="dialog" hidden>
          <h1 id="title">Fixture action</h1>
          <button id="submit">Run</button>
          <button id="retry" hidden>Retry</button>
          <button id="close">Close</button>
          <p id="status"></p><p id="error" hidden></p><output id="result"></output>
        </section>`)
    }
    if (url.pathname.startsWith('/src/') && url.pathname.endsWith('.js')) {
      const target = path.resolve(repoRoot, url.pathname.slice(1))
      if (!target.startsWith(`${repoRoot}${path.sep}`)) return send(response, 404, 'text/plain', 'not found')
      return send(response, 200, 'text/javascript', await readFile(target))
    }
    if (url.pathname === '/api/action') {
      const delay = Number(url.searchParams.get('delay') || 0)
      return setTimeout(() => send(response, 200, 'application/json', JSON.stringify({ value: url.searchParams.get('value') || 'ready' })), delay)
    }
    send(response, 404, 'text/plain', 'not found')
  } catch (error) {
    send(response, 500, 'text/plain', error.stack || String(error))
  }
})

await new Promise((resolve, reject) => {
  server.once('error', reject)
  server.listen(0, '127.0.0.1', resolve)
})
const origin = `http://127.0.0.1:${server.address().port}`
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext()
const page = await context.newPage()
const unexpectedNetwork = []
page.on('request', (request) => {
  if (new URL(request.url()).origin !== origin) unexpectedNetwork.push(request.url())
})

try {
  await page.goto(origin)
  await page.evaluate(async () => {
    const [dialogModule, supervisorModule, presenterModule, typedErrorModule] = await Promise.all([
      import('/src/services/runtime/dialog-controller.js'),
      import('/src/services/runtime/request-supervisor.js'),
      import('/src/services/runtime/error-presenter.js'),
      import('/src/services/runtime/typed-error.js'),
    ])
    const open = document.querySelector('#open')
    const root = document.querySelector('#dialog')
    const submit = document.querySelector('#submit')
    const retry = document.querySelector('#retry')
    const close = document.querySelector('#close')
    const status = document.querySelector('#status')
    const error = document.querySelector('#error')
    const output = document.querySelector('#result')
    const supervisor = supervisorModule.createRequestSupervisor({ defaultTimeoutMs: 80 })
    const presenter = presenterModule.createErrorPresenter()
    const dialog = dialogModule.createDialogController()
    const state = {
      mode: 'success',
      attempts: 0,
      commits: 0,
      value: 'initial',
      uiGeneration: 0,
      pending: new Set(),
      lateCommitAccepted: null,
    }

    function openDialog() {
      root.hidden = false
      dialog.open(root, {
        labelledBy: 'title',
        statusElement: status,
        initialFocus: submit,
        restoreFocusTarget: open,
        isPending: () => guard.isPending(),
        onRequestClose: closeDialog,
      })
    }

    function closeDialog() {
      if (guard.isPending()) return
      dialog.close()
      root.hidden = true
    }

    function renderPresentation(presentation) {
      error.hidden = !presentation.notice.visible
      error.textContent = presentation.notice.visible
        ? `${presentation.notice.title}: ${presentation.notice.message}`
        : ''
      error.dataset.code = presentation.status.code
      error.dataset.operationId = presentation.status.operationId
      status.textContent = `${presentation.status.state}: ${presentation.notice.title}`
      retry.hidden = !presentation.retry.allowed
      retry.textContent = presentation.retry.label
    }

    function resultError(result) {
      if (result.status === 'timeout') {
        return typedErrorModule.createTypedError({
          code: 'REQUEST_TIMEOUT', category: 'timeout', message: 'The local request timed out', retryable: true,
          operationId: result.correlationId, details: { operation: result.operation },
        })
      }
      if (result.status === 'superseded') {
        return typedErrorModule.createTypedError({
          code: 'REQUEST_SUPERSEDED', category: 'canceled', message: 'A newer request replaced this request', retryable: false,
          operationId: result.correlationId, details: { operation: result.operation },
        })
      }
      return typedErrorModule.createTypedError({
        code: 'NETWORK_OFFLINE', category: 'network', message: 'The local service is unavailable while offline', retryable: true,
        operationId: result.correlationId, details: { operation: result.operation },
      })
    }

    async function requestTask({ signal, commit }, mode, value) {
      state.attempts += 1
      if (mode === 'late') {
        await new Promise((resolve) => setTimeout(resolve, value === 'old' ? 220 : 20))
        const accepted = commit(() => { state.value = value; state.commits += 1 })
        if (value === 'old') state.lateCommitAccepted = accepted
        return value
      }
      const delay = mode === 'timeout' ? 250 : 5
      const response = await fetch(`/api/action?delay=${delay}&value=${encodeURIComponent(value)}`, { signal })
      const payload = await response.json()
      commit(() => { state.value = payload.value; state.commits += 1 })
      return payload.value
    }

    async function runLatest(mode = state.mode, value = mode) {
      const uiGeneration = ++state.uiGeneration
      dialog.setBusy(true)
      submit.disabled = true
      retry.hidden = true
      error.hidden = true
      status.textContent = `Loading ${value}`
      const promise = supervisor.run('accessible-fixture-action', (context) => requestTask(context, mode, value), {
        timeoutMs: mode === 'timeout' ? 40 : 1000,
      })
      state.pending.add(promise)
      const result = await promise.finally(() => state.pending.delete(promise))
      if (uiGeneration !== state.uiGeneration) return result
      dialog.setBusy(false)
      submit.disabled = false
      if (result.ok) {
        error.hidden = true
        retry.hidden = true
        status.textContent = `Loaded ${state.value}`
        output.textContent = state.value
      } else {
        renderPresentation(presenter.present(resultError(result)))
      }
      return result
    }

    const guard = dialogModule.createPendingActionGuard({
      onChange(pending) {
        dialog.setBusy(pending)
        submit.disabled = pending
      },
    })
    function guardedRun() {
      return guard.run(() => runLatest())
    }

    open.addEventListener('click', openDialog)
    close.addEventListener('click', closeDialog)
    submit.addEventListener('click', guardedRun)
    retry.addEventListener('click', () => { state.mode = 'success'; guardedRun() })
    globalThis.__accessibleFixture = {
      state,
      configure(mode) { state.mode = mode },
      runLatest,
      waitForIdle: () => Promise.allSettled([...state.pending]),
    }
  })

  await page.locator('#open').click()
  await assertDialogAccessibility(page)

  await context.setOffline(true)
  await page.evaluate(() => globalThis.__accessibleFixture.configure('offline'))
  const offlineBusy = await page.evaluate(() => {
    document.querySelector('#submit').click()
    return {
      busy: document.querySelector('#dialog').getAttribute('aria-busy'),
      disabled: document.querySelector('#submit').disabled,
      status: document.querySelector('#status').textContent,
    }
  })
  assert.deepEqual(offlineBusy, { busy: 'true', disabled: true, status: 'Loading offline' })
  await assertSettled(page, /failed: Network problem/)
  assert.match(await page.locator('#error').innerText(), /Network problem: .*offline/i)
  assert.equal(await page.locator('#retry').isVisible(), true)
  assert.equal(await page.locator('#error').getAttribute('data-code'), 'NETWORK_OFFLINE')
  await context.setOffline(false)
  await page.locator('#retry').click()
  await page.locator('#status').filter({ hasText: 'Loaded success' }).waitFor()
  assert.equal(await page.locator('#error').isVisible(), false)

  await page.evaluate(() => globalThis.__accessibleFixture.configure('timeout'))
  const timeoutBusy = await page.evaluate(() => {
    document.querySelector('#submit').click()
    return {
      busy: document.querySelector('#dialog').getAttribute('aria-busy'),
      disabled: document.querySelector('#submit').disabled,
      status: document.querySelector('#status').textContent,
    }
  })
  assert.deepEqual(timeoutBusy, { busy: 'true', disabled: true, status: 'Loading timeout' })
  await assertSettled(page, /timed-out: Timed out/)
  assert.equal(await page.locator('#retry').isVisible(), true)
  assert.equal(await page.locator('#error').getAttribute('data-code'), 'REQUEST_TIMEOUT')

  await page.evaluate(() => globalThis.__accessibleFixture.configure('success'))
  const attemptsBeforeDoubleClick = await page.evaluate(() => globalThis.__accessibleFixture.state.attempts)
  await page.locator('#submit').dblclick({ delay: 1 })
  await page.locator('#status').filter({ hasText: 'Loaded success' }).waitFor()
  const attemptsAfterDoubleClick = await page.evaluate(() => globalThis.__accessibleFixture.state.attempts)
  assert.equal(attemptsAfterDoubleClick - attemptsBeforeDoubleClick, 1, 'double click must execute one request')

  const late = await page.evaluate(async () => {
    const fixture = globalThis.__accessibleFixture
    const commitsBefore = fixture.state.commits
    const old = fixture.runLatest('late', 'old')
    await new Promise((resolve) => setTimeout(resolve, 10))
    const current = fixture.runLatest('late', 'new')
    const results = await Promise.all([old, current])
    await new Promise((resolve) => setTimeout(resolve, 240))
    return {
      statuses: results.map((item) => item.status),
      value: fixture.state.value,
      commits: fixture.state.commits - commitsBefore,
      lateCommitAccepted: fixture.state.lateCommitAccepted,
      statusText: document.querySelector('#status').textContent,
      busy: document.querySelector('#dialog').getAttribute('aria-busy'),
    }
  })
  assert.deepEqual(late.statuses, ['superseded', 'success'])
  assert.equal(late.value, 'new')
  assert.equal(late.commits, 1)
  assert.equal(late.lateCommitAccepted, false)
  assert.equal(late.statusText, 'Loaded new')
  assert.equal(late.busy, null)

  assert.deepEqual(unexpectedNetwork, [])
  const final = await page.evaluate(() => ({
    attempts: globalThis.__accessibleFixture.state.attempts,
    commits: globalThis.__accessibleFixture.state.commits,
    value: globalThis.__accessibleFixture.state.value,
  }))
  console.log(JSON.stringify({
    status: 'passed', origin, journeys: ['offline-retry', 'timeout-retry', 'double-click', 'late-response', 'screen-reader-state'], final,
  }, null, 2))
} finally {
  await context.setOffline(false).catch(() => {})
  await context.close()
  await browser.close()
  await new Promise((resolve) => server.close(resolve))
}

async function assertDialogAccessibility(page) {
  const dialog = page.locator('#dialog')
  assert.equal(await dialog.getAttribute('role'), 'dialog')
  assert.equal(await dialog.getAttribute('aria-modal'), 'true')
  assert.equal(await dialog.getAttribute('aria-labelledby'), 'title')
  assert.equal(await page.locator('#status').getAttribute('role'), 'status')
  assert.equal(await page.locator('#status').getAttribute('aria-live'), 'polite')
  assert.equal(await page.locator('#status').getAttribute('aria-atomic'), 'true')
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'submit')
}

async function assertSettled(page, expectedStatus) {
  const dialog = page.locator('#dialog')
  await page.locator('#status').filter({ hasText: expectedStatus }).waitFor()
  assert.equal(await dialog.getAttribute('aria-busy'), null)
  assert.equal(await page.locator('#submit').isEnabled(), true)
}

function send(response, status, contentType, body) {
  response.writeHead(status, { 'content-type': contentType, 'cache-control': 'no-store' })
  response.end(body)
}
