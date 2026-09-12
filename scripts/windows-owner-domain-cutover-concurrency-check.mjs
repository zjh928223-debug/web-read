import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = await readFile(
  path.join(repositoryRoot, 'src/services/windows-owner-domain-cutover.js'),
  'utf8',
)

globalThis.__windowsOwnerDomainCutoverCheck = {
  ownerClientCreations: 0,
  timeoutCalls: [],
}

const isolatedSource = source
  .replace(
    /import \{ createWindowsOwnerApiClient \} from '\.\/windows-owner-api-client\.js'\r?\n/u,
    `const createWindowsOwnerApiClient = (options) => {
      globalThis.__windowsOwnerDomainCutoverCheck.ownerClientCreations += 1
      return { options }
    }
`,
  )
  .replace(
    /import \{ readWindowsOwnerHealth \} from '\.\/windows-owner-reader-session-composition\.js'\r?\n/u,
    `const readWindowsOwnerHealth = async (fetchImpl, healthPath, timeoutMs) => {
      globalThis.__windowsOwnerDomainCutoverCheck.timeoutCalls.push(timeoutMs)
      const response = await fetchImpl(healthPath, { method: 'GET', timeoutMs })
      if (!response || response.ok === false || typeof response.json !== 'function') return null
      return response.json()
    }
`,
  )

const { createWindowsOwnerDomainCutover } = await import(
  `data:text/javascript;base64,${Buffer.from(isolatedSource, 'utf8').toString('base64')}`,
)
const hooks = globalThis.__windowsOwnerDomainCutoverCheck

function makeHealth({ frozen = false } = {}) {
  return {
    profileId: 'cutover-check-profile',
    instanceId: 'cutover-check-instance',
    liveness: { ready: true },
    contractValid: true,
    profileEvidenceReady: true,
    ownerRegistry: { valid: true },
    ownerMode: frozen
      ? { authoritativeDomains: [], frozenDomains: ['marks-activity'] }
      : { authoritativeDomains: ['marks-activity'], frozenDomains: [] },
    domains: [{
      domain: 'marks-activity',
      authority: frozen ? 'unavailable' : 'authoritative',
      queryCapability: 'read-only',
      commandCapability: 'writable',
      writerFrozen: frozen,
    }],
  }
}

function deferred() {
  let resolve
  let reject
  const promise = new Promise((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })
  return { promise, resolve, reject }
}

function createManualFetch() {
  const requests = []
  const fetchImpl = (url, init) => {
    const response = deferred()
    requests.push({ url, init, response })
    return Promise.resolve({
      ok: true,
      json: () => response.promise,
    })
  }
  return { fetchImpl, requests }
}

function resetHooks() {
  hooks.ownerClientCreations = 0
  hooks.timeoutCalls.length = 0
}

try {
  resetHooks()
  const manual = createManualFetch()
  const cutover = createWindowsOwnerDomainCutover({
    windowObject: {},
    fetchImpl: manual.fetchImpl,
    healthTimeoutMs: 1500,
  })
  const first = cutover.refresh({ timeoutMs: 111 })
  const second = cutover.refresh({ timeoutMs: 222 })
  const third = cutover.refresh({ timeoutMs: 333 })

  assert.equal(manual.requests.length, 1, 'overlapping refreshes must share one health request')
  assert.deepEqual(hooks.timeoutCalls, [111], 'the first refresh options must win for a merged refresh')
  manual.requests[0].response.resolve(makeHealth({ frozen: true }))
  const mergedResults = await Promise.all([first, second, third])
  assert.deepEqual(mergedResults.map((result) => result.status), ['frozen', 'frozen', 'frozen'])
  assert.equal(manual.requests.length, 1)
  assert.throws(
    () => cutover.assertBrowserWriterAllowed('marks-activity'),
    (error) => error?.code === 'windows-owner-writer-frozen',
    'a frozen health result must keep the browser writer blocked',
  )

  const nextRefresh = cutover.refresh({ timeoutMs: 444 })
  assert.equal(manual.requests.length, 2, 'a later refresh must start a new health request')
  manual.requests[1].response.resolve(makeHealth({ frozen: true }))
  await nextRefresh
  assert.deepEqual(hooks.timeoutCalls, [111, 444])

  resetHooks()
  let failureFetchCount = 0
  const recoveryHealth = makeHealth()
  const recovery = createWindowsOwnerDomainCutover({
    windowObject: {},
    fetchImpl: async () => ({
      ok: true,
      json: async () => {
        failureFetchCount += 1
        return failureFetchCount === 1 ? null : recoveryHealth
      },
    }),
  })
  const failed = await recovery.refresh()
  assert.equal(failed.status, 'not-ready')
  assert.equal(recovery.status, 'not-ready', 'a failed health check must use the existing not-ready state')
  assert.equal(recovery.ownerReady, false)
  const recovered = await recovery.refresh()
  assert.equal(failureFetchCount, 2, 'a failed refresh must not wedge the next refresh')
  assert.equal(recovered.status, 'authoritative')
  assert.equal(recovery.ownerReady, true)

  resetHooks()
  const disposedWindow = {}
  const disposedManual = createManualFetch()
  const disposed = createWindowsOwnerDomainCutover({
    windowObject: disposedWindow,
    fetchImpl: disposedManual.fetchImpl,
  })
  disposedWindow.__windowsOwnerDomainCutover = disposed
  const inFlight = disposed.refresh({ timeoutMs: 777 })
  assert.equal(disposedManual.requests.length, 1)
  disposed.dispose()
  disposedManual.requests[0].response.resolve(makeHealth())
  const disposedResult = await inFlight
  assert.equal(disposedResult.status, 'not-ready')
  assert.equal(disposed.health, null, 'a disposed cutover must not accept a late health response')
  assert.deepEqual(disposed.authoritativeDomains, [])
  assert.equal(disposed.ownerReady, false)
  assert.equal(hooks.ownerClientCreations, 0, 'a late response must not recreate the owner client')
  assert.equal(disposedWindow.__windowsOwnerDomainCutover, null)

  const afterDispose = await disposed.refresh({ timeoutMs: 888 })
  assert.equal(afterDispose.status, 'not-ready')
  assert.equal(disposedManual.requests.length, 1, 'refresh after dispose must not issue a request')
  assert.deepEqual(hooks.timeoutCalls, [777])
} finally {
  delete globalThis.__windowsOwnerDomainCutoverCheck
}

console.log('Windows owner domain cutover concurrency and lifecycle check passed.')
