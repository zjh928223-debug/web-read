// Small browser-side bridge shared by the domains that have already been cut
// over.  It only exposes the typed Host client after the domain guard says the
// domain is authoritative; callers keep their existing legacy path otherwise.

export function getAuthoritativeWindowsOwner(domain, windowObject = globalThis) {
  const cutover = windowObject?.__windowsOwnerDomainCutover
  return cutover
    && typeof cutover.isAuthoritative === 'function'
    && cutover.isAuthoritative(domain)
    && typeof cutover.query === 'function'
    && typeof cutover.command === 'function'
    ? cutover
    : null
}

export function ownerRecordContent(record) {
  if (!record || typeof record !== 'object') return record
  return record.content ?? record.payload ?? record
}

export function ownerResponseRecords(response) {
  const records = response?.payload?.records
  if (!records || typeof records !== 'object' || Array.isArray(records)) return {}
  return records
}

export function requireOwnerRead(response, domain) {
  if (response?.outcome === 'read') return response
  throw ownerResponseError(response, domain, 'query')
}

export function requireOwnerCommitted(response, domain) {
  if (response?.outcome === 'committed' && response?.commitStatus === 'committed') return response
  throw ownerResponseError(response, domain, 'command')
}

export function ownerResponseError(response, domain, operation) {
  const error = new Error(`${domain} Host ${operation} did not complete`)
  error.name = 'WindowsOwnerDomainError'
  error.code = response?.error?.code || response?.outcome || 'owner-not-ready'
  error.outcome = response?.outcome || null
  error.response = response || null
  return error
}

export function stableOwnerIdempotencyKey(prefix, value) {
  const input = canonicalOwnerValue(value)
  let hash = 2166136261
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 16777619) >>> 0
  }
  return `${prefix}-${hash.toString(16).padStart(8, '0')}`.slice(0, 256)
}

function canonicalOwnerValue(value) {
  if (value === null || value === undefined) return 'null'
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalOwnerValue).join(',')}]`
  if (typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalOwnerValue(value[key])}`).join(',')}}`
  }
  return JSON.stringify(String(value))
}
