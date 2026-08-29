import { createWindowsOwnerApiClient } from './windows-owner-api-client.js'
import { readWindowsOwnerHealth } from './windows-owner-reader-session-composition.js'

const HEALTH_PATH = '/api/app/health'
const DOMAINS = Object.freeze([
  'reader-session',
  'marks-activity',
  'passage-preview',
  'annotation',
  'vocabulary-srs',
  'workflow',
])
const SAFE_IDENTITY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u

function cutoverError(domain, operation) {
  const error = new Error(`The ${domain} browser writer is frozen after Host cutover`)
  error.name = 'WindowsOwnerWriterFrozenError'
  error.code = 'windows-owner-writer-frozen'
  error.domain = domain
  error.operation = operation
  return error
}

function readyDomains(health) {
  if (!health || typeof health !== 'object') return []
  return DOMAINS.filter((domain) => {
    const item = Array.isArray(health.domains)
      ? health.domains.find((candidate) => candidate?.domain === domain)
      : null
    return health.profileId
      && health.liveness?.ready === true
      && health.contractValid === true
      && health.profileEvidenceReady === true
      && health.ownerRegistry?.valid === true
      && item?.authority === 'authoritative'
      && item?.queryCapability === 'read-only'
      && item?.commandCapability === 'writable'
  })
}

export function createWindowsOwnerDomainCutover(options = {}) {
  const windowObject = options.windowObject || globalThis
  const health = options.health
  const authoritativeDomains = Object.freeze([...new Set(
    Array.isArray(options.authoritativeDomains) ? options.authoritativeDomains : readyDomains(health),
  )].filter((domain) => DOMAINS.includes(domain)))
  const authoritative = new Set(authoritativeDomains)
  const ownerClient = options.ownerClient || null
  const cutover = {
    status: authoritativeDomains.length ? 'authoritative' : 'not-ready',
    authoritativeDomains,
    health: health || null,
    isAuthoritative(domain) {
      return authoritative.has(domain)
    },
    assertBrowserWriterAllowed(domain, operation = 'write') {
      if (authoritative.has(domain)) throw cutoverError(domain, operation)
    },
    async query(request) {
      if (!ownerClient || !authoritative.has(request?.domain)) throw cutoverError(request?.domain || 'unknown', 'query')
      return ownerClient.query(request)
    },
    async command(request) {
      if (!ownerClient || !authoritative.has(request?.domain)) throw cutoverError(request?.domain || 'unknown', 'command')
      return ownerClient.command(request)
    },
    async receipt(request) {
      if (!ownerClient || !authoritative.has(request?.domain)) throw cutoverError(request?.domain || 'unknown', 'receipt-query')
      return ownerClient.receipt(request)
    },
    dispose() {
      if (windowObject.__windowsOwnerDomainCutover === cutover) windowObject.__windowsOwnerDomainCutover = null
    },
  }
  return Object.freeze(cutover)
}

export async function initializeWindowsOwnerDomainCutoverComposition(options = {}) {
  const windowObject = options.windowObject || globalThis
  const fetchImpl = options.fetchImpl || windowObject.fetch?.bind(windowObject) || globalThis.fetch
  const health = options.health || await readWindowsOwnerHealth(
    fetchImpl,
    options.healthPath || HEALTH_PATH,
    options.healthTimeoutMs,
  )
  const domains = readyDomains(health)
  if (!domains.length || !SAFE_IDENTITY.test(String(health?.profileId || ''))) {
    const previous = windowObject.__windowsOwnerDomainCutover
    try { previous?.dispose?.() } catch (_error) {}
    return Object.freeze({ status: 'not-ready', authoritativeDomains: [], health: health || null, ownerClient: null, cutover: null })
  }
  try {
    const ownerClient = options.ownerClient || createWindowsOwnerApiClient({
      profileId: health.profileId,
      instanceId: SAFE_IDENTITY.test(String(health.instanceId || '')) ? health.instanceId : undefined,
      fetchImpl,
      timeoutMs: options.timeoutMs,
    })
    const cutover = createWindowsOwnerDomainCutover({ windowObject, health, ownerClient, authoritativeDomains: domains })
    windowObject.__windowsOwnerDomainCutover = cutover
    return Object.freeze({
      status: 'ready',
      authoritativeDomains: domains,
      health,
      ownerClient,
      cutover,
    })
  } catch (_error) {
    return Object.freeze({ status: 'not-ready', authoritativeDomains: [], health: health || null, ownerClient: null, cutover: null })
  }
}

export function assertWindowsOwnerBrowserWriterAllowed(domain, operation = 'write', windowObject = globalThis) {
  windowObject?.__windowsOwnerDomainCutover?.assertBrowserWriterAllowed?.(domain, operation)
}

export const WINDOWS_OWNER_CUTOVER_ORDER = Object.freeze([...DOMAINS])
