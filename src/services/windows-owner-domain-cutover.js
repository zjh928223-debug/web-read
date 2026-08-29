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

function ownerNotReadyError(domain, operation) {
  const error = new Error(`The ${domain} Windows owner is not ready for ${operation}`)
  error.name = 'WindowsOwnerNotReadyError'
  error.code = 'owner-not-ready'
  error.outcome = 'not-ready'
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
  const fetchImpl = options.fetchImpl || null
  const healthPath = options.healthPath || HEALTH_PATH
  const healthTimeoutMs = options.healthTimeoutMs
  const state = {
    health: options.health || null,
    readiness: baseHealthReady(options.health) ? 'ready' : 'not-ready',
    authoritativeDomains: [],
    frozenDomains: [],
    authoritative: new Set(),
    frozen: new Set(),
  }
  function setState(nextHealth, nextAuthoritative, nextFrozen) {
    const authoritativeDomains = nextAuthoritative === undefined
      ? (baseHealthReady(nextHealth) ? readyDomains(nextHealth) : [])
      : nextAuthoritative
    const frozen = nextFrozen === undefined ? frozenDomains(nextHealth) : nextFrozen
    state.health = nextHealth || null
    state.readiness = baseHealthReady(nextHealth) ? 'ready' : 'not-ready'
    state.authoritativeDomains = Object.freeze([...new Set(authoritativeDomains)].filter((domain) => DOMAINS.includes(domain)))
    state.frozenDomains = Object.freeze([...new Set(frozen)].filter((domain) => DOMAINS.includes(domain)))
    state.authoritative = new Set(state.authoritativeDomains)
    state.frozen = new Set(state.frozenDomains)
  }
  setState(
    state.health,
    Array.isArray(options.authoritativeDomains) ? options.authoritativeDomains : undefined,
    Array.isArray(options.frozenDomains) ? options.frozenDomains : undefined,
  )
  let ownerClient = options.ownerClient || null
  const cutover = {
    get status() {
      if (state.readiness !== 'ready') return 'not-ready'
      return state.authoritativeDomains.length ? 'authoritative' : state.frozenDomains.length ? 'frozen' : 'not-ready'
    },
    get authoritativeDomains() {
      return state.authoritativeDomains
    },
    get frozenDomains() {
      return state.frozenDomains
    },
    get health() {
      return state.health
    },
    get ownerReady() {
      return state.readiness === 'ready' && Boolean(ownerClient)
    },
    isAuthoritative(domain) {
      return state.authoritative.has(domain)
    },
    assertBrowserWriterAllowed(domain, operation = 'write') {
      if (state.authoritative.has(domain) || state.frozen.has(domain)) throw cutoverError(domain, operation)
    },
    async query(request) {
      if (!state.authoritative.has(request?.domain)) throw cutoverError(request?.domain || 'unknown', 'query')
      if (!ownerClient || state.readiness !== 'ready') throw ownerNotReadyError(request?.domain || 'unknown', 'query')
      return ownerClient.query(request)
    },
    async command(request) {
      if (!state.authoritative.has(request?.domain)) throw cutoverError(request?.domain || 'unknown', 'command')
      if (!ownerClient || state.readiness !== 'ready') throw ownerNotReadyError(request?.domain || 'unknown', 'command')
      return ownerClient.command(request)
    },
    async receipt(request) {
      if (!state.authoritative.has(request?.domain)) throw cutoverError(request?.domain || 'unknown', 'receipt-query')
      if (!ownerClient || state.readiness !== 'ready') throw ownerNotReadyError(request?.domain || 'unknown', 'receipt-query')
      return ownerClient.receipt(request)
    },
    markUnavailable(nextHealth = null) {
      if (nextHealth && typeof nextHealth === 'object') {
        state.health = {
          ...nextHealth,
          liveness: { ...(nextHealth.liveness || {}), ready: false },
        }
      } else if (state.health && typeof state.health === 'object') {
        state.health = {
          ...state.health,
          liveness: { ...(state.health.liveness || {}), ready: false },
        }
      } else {
        state.health = null
      }
      state.readiness = 'not-ready'
      ownerClient = null
      return {
        status: cutover.status,
        authoritativeDomains: state.authoritativeDomains,
        frozenDomains: state.frozenDomains,
        health: state.health,
      }
    },
    async refresh(refreshOptions = {}) {
      if (typeof fetchImpl !== 'function') {
        return cutover.markUnavailable()
      }
      const nextHealth = await readWindowsOwnerHealth(
        fetchImpl,
        healthPath,
        refreshOptions.timeoutMs === undefined ? healthTimeoutMs : refreshOptions.timeoutMs,
      )
      if (!nextHealth || !baseHealthReady(nextHealth)) {
        return cutover.markUnavailable(nextHealth)
      }
      setState(nextHealth)
      if (!ownerClient && state.authoritativeDomains.length) {
        try {
          ownerClient = createWindowsOwnerApiClient({
            profileId: nextHealth.profileId,
            instanceId: SAFE_IDENTITY.test(String(nextHealth.instanceId || '')) ? nextHealth.instanceId : undefined,
            fetchImpl,
            timeoutMs: refreshOptions.timeoutMs === undefined ? healthTimeoutMs : refreshOptions.timeoutMs,
          })
        } catch (_error) {
          ownerClient = null
        }
      }
      return {
        status: cutover.status,
        authoritativeDomains: state.authoritativeDomains,
        frozenDomains: state.frozenDomains,
        health: state.health,
      }
    },
    dispose() {
      if (cutover.pollHandle) clearInterval(cutover.pollHandle)
      if (windowObject.__windowsOwnerDomainCutover === cutover) windowObject.__windowsOwnerDomainCutover = null
    },
  }
  if (Number.isFinite(options.pollIntervalMs) && options.pollIntervalMs > 0 && typeof fetchImpl === 'function') {
    cutover.pollHandle = setInterval(() => { cutover.refresh().catch(() => {}) }, options.pollIntervalMs)
    cutover.pollHandle?.unref?.()
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
  // A valid pre-cutover health response still needs a live guard so an
  // already-open page can observe the first persisted freeze marker.  Only
  // invalid health/profile identity is non-pollable; an empty domain set is
  // an honest not-ready state, not a reason to tear down the guard.
  if (!SAFE_IDENTITY.test(String(health?.profileId || '')) || !baseHealthReady(health)) {
    const previous = windowObject.__windowsOwnerDomainCutover
    const previousAuthoritativeDomains = DOMAINS.filter((domain) => (
      previous?.isAuthoritative?.(domain) === true
      || previous?.authoritativeDomains?.includes?.(domain)
    ))
    if (previous && previousAuthoritativeDomains.length) {
      const preserved = previous.markUnavailable?.(health || null) || previous
      return Object.freeze({
        status: 'not-ready',
        authoritativeDomains: previousAuthoritativeDomains,
        health: health || preserved.health || null,
        ownerClient: null,
        cutover: preserved,
      })
    }
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
      fetchImpl,
      healthPath: options.healthPath || HEALTH_PATH,
      healthTimeoutMs: options.healthTimeoutMs,
      pollIntervalMs: options.pollIntervalMs,
      authoritativeDomains: domains,
      frozenDomains: frozen,
    })
    windowObject.__windowsOwnerDomainCutover = cutover
    return Object.freeze({
      status: domains.length ? 'ready' : (frozen.length ? 'frozen' : 'not-ready'),
      authoritativeDomains: domains,
      health,
      ownerClient,
      cutover,
    })
  } catch (_error) {
    const previous = windowObject.__windowsOwnerDomainCutover
    const previousAuthoritativeDomains = DOMAINS.filter((domain) => (
      previous?.isAuthoritative?.(domain) === true
      || previous?.authoritativeDomains?.includes?.(domain)
    ))
    if (previous && previousAuthoritativeDomains.length) {
      const preserved = previous.markUnavailable?.(health || null) || previous
      return Object.freeze({
        status: 'not-ready',
        authoritativeDomains: previousAuthoritativeDomains,
        health: health || preserved.health || null,
        ownerClient: null,
        cutover: preserved,
      })
    }
    return Object.freeze({ status: 'not-ready', authoritativeDomains: [], health: health || null, ownerClient: null, cutover: null })
  }
}

export function assertWindowsOwnerBrowserWriterAllowed(domain, operation = 'write', windowObject = globalThis) {
  windowObject?.__windowsOwnerDomainCutover?.assertBrowserWriterAllowed?.(domain, operation)
}

export const WINDOWS_OWNER_CUTOVER_ORDER = Object.freeze([...DOMAINS])
