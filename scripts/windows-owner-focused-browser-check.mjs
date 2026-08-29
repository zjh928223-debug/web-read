import assert from 'node:assert/strict'
import http from 'node:http'
import { createServer as createViteServer } from 'vite'
import { chromium } from 'playwright'

import { listenOnBrowserSafePort } from './lib/browser-port-policy.mjs'

const CONTRACT_VERSION = 'windows-thin-reader-api.v1'
const PROFILE_ID = 'optimization'
const INSTANCE_ID = 'focused-browser-instance'
const ACCESS_TOKEN = 'focused-browser-token'
const MEDIA_URL = '/api/jobs/focused-media/media/audio'
const MEDIA_IDENTITY = 'focused-media'
const FINGERPRINT = `sha256:${'a'.repeat(64)}`

const fixture = {
  ownerRequests: [],
  mediaRequests: [],
  commandSideEffects: 0,
  receiptQueries: 0,
  mediaQueries: 0,
  lostUnknownCommand: false,
  unknownRequest: null,
}

const vite = await createViteServer({
  root: process.cwd(),
  configFile: false,
  appType: 'custom',
  logLevel: 'error',
  server: {
    middlewareMode: true,
    hmr: false,
    fs: { allow: [process.cwd()] },
  },
})

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url || '/', 'http://127.0.0.1')
    if (url.pathname === '/') {
      return send(response, 200, 'text/html', '<!doctype html><meta charset="utf-8"><title>Owner boundary fixture</title>')
    }
    if (url.pathname === '/api/app/owner' && request.method === 'POST') {
      return handleOwnerRequest(request, response)
    }
    const mediaMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)\/media\/(audio|video)$/u)
    if (mediaMatch && request.method === 'GET') return handleMediaRequest(request, response, mediaMatch)
    return vite.middlewares(request, response, () => send(response, 404, 'text/plain', 'not found'))
  } catch (error) {
    if (!response.headersSent) send(response, 500, 'text/plain', error?.stack || String(error))
    else response.destroy()
  }
})

const port = await listenOnBrowserSafePort(server)
const origin = `http://127.0.0.1:${port}`
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext()
const page = await context.newPage()
const observedRequests = []
page.on('request', (request) => observedRequests.push({ method: request.method(), url: request.url() }))

try {
  await context.addCookies([{
    name: 'read_web_instance',
    value: ACCESS_TOKEN,
    domain: '127.0.0.1',
    path: '/',
    httpOnly: true,
    sameSite: 'Lax',
  }])
  await page.goto(origin, { waitUntil: 'domcontentloaded' })

  const result = await page.evaluate(async ({ contractVersion, mediaUrl, profileId, instanceId }) => {
    const [{ createWindowsOwnerApiClient }, mediaModule] = await Promise.all([
      import('/src/services/windows-owner-api-client.js'),
      import('/src/services/media/media-resource-owner.js'),
    ])
    const {
      assertWindowsOwnerMediaMetadataOnly,
      createWindowsOwnerMediaResourceOwner,
      MediaResourceOwnerError,
    } = mediaModule
    const client = createWindowsOwnerApiClient({
      profileId,
      instanceId,
      timeoutMs: 1000,
    })

    const committed = await client.command({
      domain: 'workflow',
      operation: 'job-start',
      requestId: 'browser-commit-request',
      correlationId: 'browser-commit-correlation',
      expectedRevision: 0,
      idempotencyKey: 'browser-commit-1',
      payload: { source: 'focused-browser' },
    })
    if (committed.outcome !== 'committed' || committed.commitStatus !== 'committed') {
      throw new Error('browser command did not return a committed receipt')
    }

    const unknown = await client.command({
      domain: 'workflow',
      operation: 'job-start',
      requestId: 'browser-unknown-request',
      correlationId: 'browser-unknown-correlation',
      expectedRevision: 1,
      idempotencyKey: 'browser-unknown-1',
      payload: { source: 'focused-browser' },
    })
    if (unknown.outcome !== 'commit-unknown' || unknown.commitStatus !== 'commit-unknown') {
      throw new Error(`browser transport loss did not become commit-unknown: ${JSON.stringify(unknown)}`)
    }
    const resolved = await client.receipt({ domain: 'workflow', idempotencyKey: 'browser-unknown-1' })
    if (resolved.outcome !== 'committed' || resolved.receipt?.commitStatus !== 'committed') {
      throw new Error('browser receipt query did not resolve the unknown command')
    }

    const mediaElement = document.createElement('audio')
    mediaElement.preload = 'none'
    const owner = createWindowsOwnerMediaResourceOwner({
      profileId,
      mediaElement,
      ownerClient: client,
      fetchImpl: globalThis.fetch,
    })
    const bound = await owner.bind({
      domain: 'workflow',
      payload: { jobId: 'focused-media', kind: 'audio' },
    })
    if (bound.descriptor.authorizedUrl !== mediaUrl || mediaElement.getAttribute('src') !== mediaUrl) {
      throw new Error('media element was not bound to the authorized URL directly')
    }
    const firstDescriptor = owner.getDescriptor()

    await expectMediaError(
      owner.bindDescriptor({ ...firstDescriptor, etag: '"focused-b"', revision: 'focused-rev-b' }),
      'media-rebind-required',
    )
    if (owner.getDescriptor() !== null || mediaElement.getAttribute('src') !== null) {
      throw new Error('ETag mismatch did not dispose the old media resource')
    }

    await expectMediaError(
      owner.bindDescriptor({ ...firstDescriptor, mediaId: 'different-media', revision: 'focused-rev-c' }),
      'media-rebind-required',
    )
    if (owner.getDescriptor() !== null || mediaElement.getAttribute('src') !== null) {
      throw new Error('identity mismatch did not keep the media element unbound')
    }
    owner.dispose()

    const binaryValues = [
      new Blob(['media']),
      new ArrayBuffer(2),
      new Uint8Array([1, 2]),
    ]
    for (const value of binaryValues) {
      await expectError(
        client.query({
          domain: 'workflow',
          operation: 'media-capability',
          payload: { mediaData: value },
        }),
        'invalid-request',
      )
      await expectMediaError(
        Promise.resolve().then(() => assertWindowsOwnerMediaMetadataOnly({ mediaData: value })),
        'media-payload-rejected',
      )
    }

    const databases = typeof indexedDB.databases === 'function'
      ? await indexedDB.databases()
      : []
    return {
      committedReceipt: committed.receipt?.receiptId || null,
      unknownLookup: unknown.payload.receiptQuery,
      resolvedReceipt: resolved.receipt?.receiptId || null,
      boundUrl: mediaElement.getAttribute('src'),
      mediaId: firstDescriptor.mediaId,
      storage: {
        href: location.href,
        localStorage: Object.keys(localStorage),
        indexedDb: databases.map((database) => database.name).filter(Boolean),
      },
      observedErrorType: MediaResourceOwnerError.name,
      contractVersion,
    }

    async function expectError(operation, code) {
      try {
        await operation
      } catch (error) {
        if (error?.code !== code) throw error
        return
      }
      throw new Error(`expected ${code}`)
    }

    async function expectMediaError(operation, code) {
      try {
        await operation
      } catch (error) {
        if (!(error instanceof MediaResourceOwnerError) || error.code !== code) throw error
        return
      }
      throw new Error(`expected ${code}`)
    }
  }, { contractVersion: CONTRACT_VERSION, mediaUrl: MEDIA_URL, profileId: PROFILE_ID, instanceId: INSTANCE_ID })

  assert.equal(result.contractVersion, CONTRACT_VERSION)
  assert.equal(result.committedReceipt, 'receipt-browser-commit')
  assert.equal(result.resolvedReceipt, 'receipt-browser-unknown')
  assert.equal(result.unknownLookup.idempotencyKey, 'browser-unknown-1')
  assert.equal(result.boundUrl, null, 'the mismatch journey must finish with no active source')
  assert.equal(result.mediaId, MEDIA_IDENTITY)
  assert.equal(result.storage.href, origin + '/')
  assert.deepEqual(result.storage.localStorage, [])
  assert.deepEqual(result.storage.indexedDb, [])
  assert.equal(result.observedErrorType, 'MediaResourceOwnerError')

  assert.ok(fixture.ownerRequests.length >= 5 && fixture.ownerRequests.length <= 6, 'only typed command/query/receipt requests should reach the fixture')
  assert.ok(fixture.ownerRequests.every((request) => request.url === '/api/app/owner'))
  assert.ok(fixture.ownerRequests.every((request) => request.cookie.includes(ACCESS_TOKEN)))
  assert.ok(fixture.ownerRequests.every((request) => !request.url.includes(ACCESS_TOKEN)))
  assert.ok(fixture.ownerRequests.every((request) => !request.raw.includes(ACCESS_TOKEN)))
  assert.ok(fixture.ownerRequests.every((request) => request.body?.payload?.profileId === PROFILE_ID))
  assert.ok(fixture.ownerRequests.every((request) => request.body?.payload?.instanceId === INSTANCE_ID))
  assert.equal(fixture.commandSideEffects, 2, 'a commit-unknown path must not replay the command')
  assert.equal(fixture.receiptQueries, 1)
  assert.equal(fixture.mediaQueries, 1)

  assert.equal(fixture.mediaRequests.length, 3, 'media probe should be the only media traffic')
  assert.ok(fixture.mediaRequests.every((request) => request.range === 'bytes=0-0'))
  assert.ok(fixture.mediaRequests.every((request) => request.responseStatus === 206))
  assert.ok(fixture.mediaRequests.every((request) => request.responseBytes === 1))
  assert.ok(fixture.mediaRequests.every((request) => request.contentRange === 'bytes 0-0/4'))
  assert.ok(fixture.mediaRequests.every((request) => request.acceptRanges === 'bytes'))
  assert.ok(fixture.mediaRequests.every((request) => request.etag === '"focused-a"'))
  assert.ok(fixture.mediaRequests.every((request) => request.identity === MEDIA_IDENTITY))
  assert.ok(observedRequests.every((request) => new URL(request.url).origin === origin))
  assert.ok(observedRequests.every((request) => !request.url.includes(ACCESS_TOKEN)))

  console.log('windows owner focused browser boundary checks passed (Chromium typed API, receipt recovery, direct Range media, storage/no-copy boundary)')
} finally {
  await context.close()
  await browser.close()
  await closeServer(server)
  await vite.close()
}

async function handleOwnerRequest(request, response) {
  const raw = await readBody(request)
  const body = JSON.parse(raw || '{}')
  const cookie = String(request.headers.cookie || '')
  const captured = { url: request.url, raw, body, cookie }
  fixture.ownerRequests.push(captured)
  if (!cookie.includes(`read_web_instance=${ACCESS_TOKEN}`)) return sendJson(response, 401, { error: 'unauthorized' })
  if (body.contractVersion !== CONTRACT_VERSION) return sendJson(response, 400, { error: 'invalid contract' })

  if (body.kind === 'query' && body.domain === 'workflow' && body.operation === 'media-capability') {
    fixture.mediaQueries += 1
    return sendJson(response, 200, ownerResponse(body, {
      outcome: 'read',
      commitStatus: 'not-applicable',
      revision: 'focused-rev-a',
      payload: {
        media: {
          schemaVersion: 1,
          profileId: PROFILE_ID,
          mediaId: MEDIA_IDENTITY,
          kind: 'audio',
          authorizedUrl: MEDIA_URL,
          size: 4,
          contentType: 'audio/wav',
          etag: '"focused-a"',
          revision: 'focused-rev-a',
        },
      },
    }))
  }

  if (body.kind === 'receipt-query') {
    fixture.receiptQueries += 1
    const receipt = body.idempotencyKey === 'browser-unknown-1'
      ? committedReceipt(fixture.unknownRequest, { receiptId: 'receipt-browser-unknown', revision: 2 })
      : null
    return receipt
      ? sendJson(response, 200, ownerResponse(body, {
        outcome: 'committed',
        commitStatus: 'committed',
        revision: 2,
        receipt,
        payload: {},
      }))
      : sendJson(response, 404, ownerResponse(body, {
        outcome: 'rejected',
        commitStatus: 'rejected',
        revision: null,
        payload: {},
        error: typedError(body, 'not-found', 'not-found'),
      }))
  }

  if (body.kind === 'command' && body.domain === 'workflow' && body.operation === 'job-start') {
    if (body.requestId === 'browser-unknown-request') {
      if (!fixture.lostUnknownCommand) {
        fixture.lostUnknownCommand = true
        fixture.unknownRequest = body
        fixture.commandSideEffects += 1
      }
      request.socket.destroy()
      return
    }
    fixture.commandSideEffects += 1
    return sendJson(response, 200, ownerResponse(body, {
      outcome: 'committed',
      commitStatus: 'committed',
      revision: 1,
      receipt: committedReceipt(body, { receiptId: 'receipt-browser-commit', revision: 1 }),
      payload: { accepted: true },
    }))
  }

  return sendJson(response, 400, { error: 'unsupported fixture request' })
}

async function handleMediaRequest(request, response, match) {
  const rawRange = String(request.headers.range || '')
  const headers = {
    'accept-ranges': 'bytes',
    'content-range': 'bytes 0-0/4',
    'content-type': 'audio/wav',
    etag: '"focused-a"',
    'x-read-web-media-identity': MEDIA_IDENTITY,
  }
  if (match[1] !== 'focused-media' || match[2] !== 'audio' || rawRange !== 'bytes=0-0') {
    fixture.mediaRequests.push({ range: rawRange, responseStatus: 416, responseBytes: 0 })
    return send(response, 416, 'text/plain', 'range rejected', { 'content-range': 'bytes */4' })
  }
  const body = Buffer.from([0])
  fixture.mediaRequests.push({
    range: rawRange,
    responseStatus: 206,
    responseBytes: body.length,
    contentRange: headers['content-range'],
    acceptRanges: headers['accept-ranges'],
    etag: headers.etag,
    identity: headers['x-read-web-media-identity'],
  })
  return send(response, 206, 'audio/wav', body, { ...headers, 'content-length': String(body.length) })
}

function ownerResponse(request, overrides = {}) {
  return {
    contractVersion: CONTRACT_VERSION,
    requestId: request.requestId,
    correlationId: request.correlationId,
    domain: request.domain,
    operation: request.operation,
    outcome: overrides.outcome || 'read',
    commitStatus: overrides.commitStatus || 'not-applicable',
    revision: overrides.revision ?? null,
    receipt: overrides.receipt ?? null,
    payload: overrides.payload || {},
    error: overrides.error ?? null,
  }
}

function committedReceipt(request, { receiptId, revision }) {
  return {
    receiptId,
    contractVersion: CONTRACT_VERSION,
    profileId: PROFILE_ID,
    instanceId: INSTANCE_ID,
    requestId: request.requestId,
    correlationId: request.correlationId,
    domain: 'workflow',
    operation: 'job-start',
    idempotencyKey: request.idempotencyKey,
    expectedRevision: request.expectedRevision,
    requestFingerprint: FINGERPRINT,
    commitStatus: 'committed',
    revision,
    effectFingerprint: FINGERPRINT,
    recordChecksums: [FINGERPRINT],
    evidenceChecksum: FINGERPRINT,
    evidenceSource: 'focused-browser-fixture',
    createdAt: '2026-08-29T00:00:00.000Z',
    committedAt: '2026-08-29T00:00:00.000Z',
    queryOperation: 'receipt-query',
  }
}

function typedError(request, code, category) {
  return {
    type: 'windows-thin-reader-error.v1',
    code,
    category,
    message: 'fixture request rejected',
    retryable: false,
    correlationId: request.correlationId,
    details: {},
  }
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = []
    request.on('data', (chunk) => chunks.push(chunk))
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    request.on('error', reject)
  })
}

function send(response, status, contentType, body, headers = {}) {
  response.writeHead(status, { 'content-type': contentType, ...headers })
  response.end(body)
}

function sendJson(response, status, value) {
  send(response, status, 'application/json', JSON.stringify(value))
}

function closeServer(value) {
  return new Promise((resolve, reject) => value.close((error) => error ? reject(error) : resolve()))
}
