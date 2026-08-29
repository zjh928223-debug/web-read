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

function frozenDomains(health) {
  if (!health || typeof health !== 'object') return []
  const fromOwnerMode = Array.isArray(health.ownerMode?.frozenDomains)
    ? health.ownerMode.frozenDomains
    : []
  const fromDomains = Array.isArray(health.domains)
    ? health.domains.filter((item) => item?.writerFrozen === true).map((item) => item.domain)
    : []
  return [...new Set([...fromOwnerMode, ...fromDomains])].filter((domain) => DOMAINS.includes(domain))
}

function baseHealthReady(health) {
  return Boolean(health && typeof health === 'object'
    && health.profileId
    && health.liveness?.ready === true
    && health.contractValid === true
    && health.profileEvidenceReady === true
    && health.ownerRegistry?.valid === true)
}

export function createWindowsOwnerDomainCutover(options = {}) {
  const windowObject = options.windowObject || globalThis
  const health = options.health
  const authoritativeDomains = Object.freeze([...new Set(
    Array.isArray(options.authoritativeDomains) ? options.authoritativeDomains : readyDomains(health),
  )].filter((domain) => DOMAINS.includes(domain)))
  const frozen = Object.freeze([...new Set(
    Array.isArray(options.frozenDomains) ? options.frozenDomains : frozenDomains(health),
  )].filter((domain) => DOMAINS.includes(domain)))
  const authoritative = new Set(authoritativeDomains)
  const frozenSet = new Set(frozen)
  const ownerClient = options.ownerClient || null
  const cutover = {
    status: authoritativeDomains.length ? 'authoritative' : frozen.length ? 'frozen' : 'not-ready',
    authoritativeDomains,
    frozenDomains: frozen,
    health: health || null,
    isAuthoritative(domain) {
      return authoritative.has(domain)
    },
    assertBrowserWriterAllowed(domain, operation = 'write') {
      if (authoritative.has(domain) || frozenSet.has(domain)) throw cutoverError(domain, operation)
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
  const frozen = frozenDomains(health)
  if ((!domains.length && !frozen.length) || !SAFE_IDENTITY.test(String(health?.profileId || '')) || !baseHealthReady(health)) {
    const previous = windowObject.__windowsOwnerDomainCutover
    try { previous?.dispose?.() } catch (_error) {}
    return Object.freeze({ status: 'not-ready', authoritativeDomains: [], health: health || null, ownerClient: null, cutover: null })
  }
  try {
    const ownerClient = options.ownerClient || (domains.length ? createWindowsOwnerApiClient({
      profileId: health.profileId,
      instanceId: SAFE_IDENTITY.test(String(health.instanceId || '')) ? health.instanceId : undefined,
      fetchImpl,
      timeoutMs: options.timeoutMs,
    }) : null)
    const cutover = createWindowsOwnerDomainCutover({
      windowObject,
      health,
      ownerClient,
      authoritativeDomains: domains,
      frozenDomains: frozen,
    })
    windowObject.__windowsOwnerDomainCutover = cutover
    return Object.freeze({
      status: domains.length ? 'ready' : 'frozen',
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
