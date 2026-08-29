import { createWindowsOwnerApiClient } from './windows-owner-api-client.js'
import { createWindowsOwnerReaderSessionConsumer } from './windows-owner-reader-session-consumer.js'

const HEALTH_PATH = '/api/app/health'
const SAFE_IDENTITY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u

let composedConsumer = null

/**
 * Build the optional production Reader Session owner only after the Host has
 * explicitly reported this domain as API-authoritative.  A degraded or
 * pre-cutover Host leaves the existing browser path untouched.
 */
export async function initializeWindowsOwnerReaderSessionComposition(options = {}) {
  const windowObject = options.windowObject || globalThis
  const documentObject = options.documentObject || windowObject.document
  const fetchImpl = options.fetchImpl || windowObject.fetch?.bind(windowObject) || globalThis.fetch
  const healthPath = options.healthPath || HEALTH_PATH

  const health = await readHealth(fetchImpl, healthPath)
  const profileId = options.profileId || health?.profileId
  if (!isSafeIdentity(profileId) || !isReaderSessionOwnerReady(health, profileId)) {
    clearComposedConsumer(windowObject)
    return Object.freeze({
      status: 'not-ready',
      readerSessionOwner: null,
      ownerClient: null,
    })
  }

  const existing = windowObject.__windowsOwnerReaderSessionConsumer
  if (existing && existing !== composedConsumer) {
    return Object.freeze({
      status: 'ready',
      source: 'existing',
      readerSessionOwner: existing,
      ownerClient: null,
    })
  }

  try {
    const ownerClient = options.ownerClient || createWindowsOwnerApiClient({
      profileId,
      instanceId: options.instanceId || (isSafeIdentity(health.instanceId) ? health.instanceId : undefined),
      fetchImpl,
      timeoutMs: options.timeoutMs,
    })
    const mediaElement = options.mediaElement
      || documentObject?.getElementById?.('audio-player')
      || null
    const consumer = createWindowsOwnerReaderSessionConsumer({
      profileId,
      ownerClient,
      mediaElement,
      fetchImpl,
    })
    windowObject.__windowsOwnerReaderSessionConsumer = consumer
    composedConsumer = consumer
    return Object.freeze({
      status: 'ready',
      source: 'host-readiness',
      profileId,
      instanceId: isSafeIdentity(health.instanceId) ? health.instanceId : null,
      ownerClient,
      readerSessionOwner: consumer,
    })
  } catch (_error) {
    clearComposedConsumer(windowObject)
    return Object.freeze({
      status: 'not-ready',
      readerSessionOwner: null,
      ownerClient: null,
    })
  }
}

export function isReaderSessionOwnerReady(health, profileId) {
  if (!isSafeIdentity(profileId) || !health || typeof health !== 'object') return false
  const domain = Array.isArray(health.domains)
    ? health.domains.find((item) => item?.domain === 'reader-session')
    : null
  return health.profileId === profileId
    && health.liveness?.ready === true
    && health.durableOwnerReadiness?.ready === true
    && health.durableOwnerReadiness?.acceptingApiAuthoritativeOperations === true
    && health.ownerRegistry?.ownerApiReady === true
    && health.ownerRegistry?.acceptingApiAuthoritativeOperations === true
    && domain?.authority === 'authoritative'
    && domain?.commandCapability === 'writable'
}

async function readHealth(fetchImpl, healthPath) {
  if (typeof fetchImpl !== 'function' || !isHealthPath(healthPath)) return null
  try {
    const response = await fetchImpl(healthPath, {
      method: 'GET',
      headers: { accept: 'application/json' },
      credentials: 'same-origin',
      cache: 'no-store',
    })
    if (!response || response.ok === false || typeof response.json !== 'function') return null
    const health = await response.json()
    return health && typeof health === 'object' ? health : null
  } catch (_error) {
    return null
  }
}

function clearComposedConsumer(windowObject) {
  if (windowObject.__windowsOwnerReaderSessionConsumer !== composedConsumer) return
  try { composedConsumer?.dispose?.() } catch (_error) {}
  windowObject.__windowsOwnerReaderSessionConsumer = null
  composedConsumer = null
}

function isHealthPath(value) {
  return typeof value === 'string'
    && value.startsWith('/')
    && !value.startsWith('//')
    && !/[\\\u0000-\u001f\u007f?#]/u.test(value)
}

function isSafeIdentity(value) {
  return typeof value === 'string' && SAFE_IDENTITY.test(value)
}
