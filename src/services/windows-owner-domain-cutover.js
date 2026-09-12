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
const SAFE_FREEZE_FINGERPRINT = /^(?:sha256:)?[a-f0-9]{64}$/u

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

function browserFreezeEvidenceError(code, message, details = {}) {
  const error = new Error(message)
  error.name = 'WindowsOwnerBrowserFreezeEvidenceError'
  error.code = code
  error.details = details
  return error
}

function safeFreezeEvidenceIdentity(value, field) {
  if (typeof value !== 'string' || !SAFE_IDENTITY.test(value)) {
    throw browserFreezeEvidenceError(
      'windows-owner-browser-freeze-evidence-invalid',
      `${field} is invalid`,
      { field },
    )
  }
  return value
}

function safeFreezeEvidenceFingerprint(value) {
  if (typeof value !== 'string' || !SAFE_FREEZE_FINGERPRINT.test(value)) {
    throw browserFreezeEvidenceError(
      'windows-owner-browser-freeze-evidence-invalid',
      'source fingerprint is invalid',
      { field: 'sourceFingerprint' },
    )
  }
  return value
}

function safeFreezeEvidenceOrigin(value) {
  if (typeof value !== 'string' || !value.trim()) {
    throw browserFreezeEvidenceError(
      'windows-owner-browser-freeze-evidence-invalid',
      'browser origin is required',
      { field: 'browserOrigin' },
    )
  }
  let origin
  try { origin = new URL(value) } catch {
    throw browserFreezeEvidenceError(
      'windows-owner-browser-freeze-evidence-invalid',
      'browser origin is invalid',
      { field: 'browserOrigin' },
    )
  }
  if (!['http:', 'https:'].includes(origin.protocol)
    || origin.pathname !== '/' || origin.search || origin.hash || origin.username || origin.password) {
    throw browserFreezeEvidenceError(
      'windows-owner-browser-freeze-evidence-invalid',
      'browser origin must not contain a path, query, or hash',
      { field: 'browserOrigin' },
    )
  }
  return origin.origin
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

function persistedOwnerModeDomains(health) {
  if (!health || typeof health !== 'object' || !SAFE_IDENTITY.test(String(health.profileId || ''))) {
    return { authoritativeDomains: [], frozenDomains: [] }
  }
  const ownerMode = health.ownerMode
  if (!ownerMode || typeof ownerMode !== 'object') {
    return { authoritativeDomains: [], frozenDomains: [] }
  }
  const domainEvidence = new Map(
    (Array.isArray(health.domains) ? health.domains : [])
      .filter((item) => DOMAINS.includes(item?.domain))
      .map((item) => [item.domain, item]),
  )
  const frozenCandidates = Array.isArray(ownerMode.frozenDomains)
    ? ownerMode.frozenDomains.filter((domain) => DOMAINS.includes(domain))
    : []
  const frozenDomains = [...new Set(frozenCandidates)].filter((domain) => (
    domainEvidence.get(domain)?.writerFrozen === true
  ))
  const frozen = new Set(frozenDomains)
  const authoritativeCandidates = Array.isArray(ownerMode.authoritativeDomains)
    ? ownerMode.authoritativeDomains.filter((domain) => DOMAINS.includes(domain))
    : []
  const authoritativeDomains = [...new Set(authoritativeCandidates)].filter((domain) => {
    const evidence = domainEvidence.get(domain)
    return !frozen.has(domain)
      && evidence
      && (evidence.authority === 'authoritative' || evidence.authority === 'unavailable')
      && evidence.writerFrozen !== true
  })
  return { authoritativeDomains, frozenDomains }
}

function selectHealthDomains(health) {
  const ready = readyDomains(health)
  const persisted = persistedOwnerModeDomains(health)
  return {
    ready,
    persisted,
    authoritativeDomains: [...new Set([...ready, ...persisted.authoritativeDomains])],
    frozenDomains: [...new Set([...frozenDomains(health), ...persisted.frozenDomains])],
    persistedNotReady: persisted.authoritativeDomains.some((domain) => !ready.includes(domain)),
  }
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
    const selection = selectHealthDomains(nextHealth)
    const authoritativeDomains = nextAuthoritative === undefined
      ? selection.authoritativeDomains
      : nextAuthoritative
    const frozen = nextFrozen === undefined ? selection.frozenDomains : nextFrozen
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
  let refreshPromise = null
  let disposed = false
  const currentRefreshState = () => ({
    status: cutover.status,
    authoritativeDomains: state.authoritativeDomains,
    frozenDomains: state.frozenDomains,
    health: state.health,
  })
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
    collectFreezeEvidence(options = {}) {
      return createWindowsOwnerBrowserFreezeEvidence({
        ...options,
        cutover,
        windowObject,
      })
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
      return currentRefreshState()
    },
    async refresh(refreshOptions = {}) {
      if (disposed) return currentRefreshState()
      if (refreshPromise) return refreshPromise
      refreshPromise = (async () => {
        if (disposed) return currentRefreshState()
        if (typeof fetchImpl !== 'function') {
          return cutover.markUnavailable()
        }
        const timeoutMs = refreshOptions.timeoutMs === undefined ? healthTimeoutMs : refreshOptions.timeoutMs
        const nextHealth = await readWindowsOwnerHealth(fetchImpl, healthPath, timeoutMs)
        if (disposed) return currentRefreshState()
        if (!nextHealth || !baseHealthReady(nextHealth)) {
          return cutover.markUnavailable(nextHealth)
        }
        setState(nextHealth)
        const nextSelection = selectHealthDomains(nextHealth)
        if (nextSelection.persistedNotReady) ownerClient = null
        if (!ownerClient && nextSelection.ready.length && !nextSelection.persistedNotReady) {
          try {
            ownerClient = createWindowsOwnerApiClient({
              profileId: nextHealth.profileId,
              instanceId: SAFE_IDENTITY.test(String(nextHealth.instanceId || '')) ? nextHealth.instanceId : undefined,
              fetchImpl,
              timeoutMs,
            })
          } catch (_error) {
            ownerClient = null
          }
        }
        return currentRefreshState()
      })()
      try {
        return await refreshPromise
      } finally {
        refreshPromise = null
      }
    },
    dispose() {
      disposed = true
      if (cutover.pollHandle) clearInterval(cutover.pollHandle)
      ownerClient = null
      if (windowObject.__windowsOwnerDomainCutover === cutover) windowObject.__windowsOwnerDomainCutover = null
    },
  }
  if (Number.isFinite(options.pollIntervalMs) && options.pollIntervalMs > 0 && typeof fetchImpl === 'function') {
    cutover.pollHandle = setInterval(() => { cutover.refresh().catch(() => {}) }, options.pollIntervalMs)
    cutover.pollHandle?.unref?.()
  }
  return Object.freeze(cutover)
}

/**
 * Produce an operator-consumable assertion from a live guarded browser page.
 * The CLI deliberately cannot synthesize this object: the page must refresh
 * Host state and prove that its own writer gate rejects a mutation.
 */
export async function createWindowsOwnerBrowserFreezeEvidence(options = {}) {
  const windowObject = options.windowObject || globalThis
  const cutover = options.cutover || windowObject?.__windowsOwnerDomainCutover
  const domain = options.domain
  if (!DOMAINS.includes(domain)) {
    throw browserFreezeEvidenceError(
      'windows-owner-browser-freeze-evidence-invalid',
      'freeze evidence domain is not registered',
      { field: 'domain' },
    )
  }
  if (!cutover || typeof cutover.refresh !== 'function'
    || typeof cutover.assertBrowserWriterAllowed !== 'function') {
    throw browserFreezeEvidenceError(
      'windows-owner-browser-freeze-guard-unavailable',
      'the current browser page does not expose a live owner freeze guard',
      { domain },
    )
  }
  const challenge = safeFreezeEvidenceIdentity(options.challenge, 'challenge')
  const sourceFingerprint = safeFreezeEvidenceFingerprint(options.sourceFingerprint)
  const browserOrigin = safeFreezeEvidenceOrigin(
    options.browserOrigin || windowObject?.location?.origin,
  )
  const refreshed = await cutover.refresh(options.refreshOptions || {})
  const frozenDomains = Array.isArray(refreshed?.frozenDomains)
    ? [...new Set(refreshed.frozenDomains)].filter((value) => DOMAINS.includes(value))
    : []
  if (!frozenDomains.includes(domain) || cutover.isAuthoritative?.(domain) === true) {
    throw browserFreezeEvidenceError(
      'windows-owner-browser-freeze-not-observed',
      'the live browser guard did not observe the requested domain frozen',
      { domain },
    )
  }
  let writerBlocked = false
  try {
    cutover.assertBrowserWriterAllowed(domain, 'production-migration-evidence')
  } catch (error) {
    if (error?.code !== 'windows-owner-writer-frozen') throw error
    writerBlocked = true
  }
  if (!writerBlocked) {
    throw browserFreezeEvidenceError(
      'windows-owner-browser-freeze-not-enforced',
      'the live browser guard observed a marker but did not block the writer',
      { domain },
    )
  }
  const profileId = refreshed?.health?.profileId || cutover.health?.profileId
  if (!SAFE_IDENTITY.test(String(profileId || ''))) {
    throw browserFreezeEvidenceError(
      'windows-owner-browser-freeze-evidence-invalid',
      'live owner health did not expose a safe profile id',
      { field: 'profileId' },
    )
  }
  return Object.freeze({
    schemaVersion: 'read-web.browser-writer-freeze-evidence.v1',
    kind: 'live-browser-owner-freeze',
    profileId,
    browserOrigin,
    domain,
    challenge,
    sourceFingerprint,
    capturedAt: new Date().toISOString(),
    guard: Object.freeze({
      implementation: 'windows-owner-domain-cutover',
      status: 'frozen',
      writerBlocked: true,
      assertion: 'assertBrowserWriterAllowed-rejected',
      observedFrozenDomains: Object.freeze(frozenDomains),
    }),
  })
}

export async function initializeWindowsOwnerDomainCutoverComposition(options = {}) {
  const windowObject = options.windowObject || globalThis
  const fetchImpl = options.fetchImpl || windowObject.fetch?.bind(windowObject) || globalThis.fetch
  const health = options.health || await readWindowsOwnerHealth(
    fetchImpl,
    options.healthPath || HEALTH_PATH,
    options.healthTimeoutMs,
  )
  const {
    ready,
    persisted,
    authoritativeDomains: domains,
    frozenDomains: frozen,
    persistedNotReady,
  } = selectHealthDomains(health)
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
    const previousFrozenDomains = DOMAINS.filter((domain) => previous?.frozenDomains?.includes?.(domain))
    if (previous && (previousAuthoritativeDomains.length || previousFrozenDomains.length)) {
      const preserved = previous.markUnavailable?.(health || null) || previous
      return Object.freeze({
        status: 'not-ready',
        authoritativeDomains: previousAuthoritativeDomains,
        frozenDomains: previousFrozenDomains,
        health: health || preserved.health || null,
        ownerClient: null,
        cutover: preserved,
      })
    }
    if (persisted.authoritativeDomains.length || persisted.frozenDomains.length) {
      const cutover = createWindowsOwnerDomainCutover({
        windowObject,
        health,
        ownerClient: null,
        fetchImpl,
        healthPath: options.healthPath || HEALTH_PATH,
        healthTimeoutMs: options.healthTimeoutMs,
        pollIntervalMs: options.pollIntervalMs,
        authoritativeDomains: persisted.authoritativeDomains,
        frozenDomains: persisted.frozenDomains,
      })
      windowObject.__windowsOwnerDomainCutover = cutover
      return Object.freeze({
        status: 'not-ready',
        authoritativeDomains: persisted.authoritativeDomains,
        frozenDomains: persisted.frozenDomains,
        health: health || null,
        ownerClient: null,
        cutover,
      })
    }
    try { previous?.dispose?.() } catch (_error) {}
    return Object.freeze({ status: 'not-ready', authoritativeDomains: [], health: health || null, ownerClient: null, cutover: null })
  }
  try {
    const ownerClient = persistedNotReady
      ? null
      : (options.ownerClient || (ready.length ? createWindowsOwnerApiClient({
          profileId: health.profileId,
          instanceId: SAFE_IDENTITY.test(String(health.instanceId || '')) ? health.instanceId : undefined,
          fetchImpl,
          timeoutMs: options.timeoutMs,
        }) : null))
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
      status: ready.length && !persistedNotReady ? 'ready' : (!domains.length && frozen.length ? 'frozen' : 'not-ready'),
      authoritativeDomains: domains,
      frozenDomains: frozen,
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
        frozenDomains: DOMAINS.filter((domain) => previous?.frozenDomains?.includes?.(domain)),
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
