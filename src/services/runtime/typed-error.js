export const ERROR_CATEGORIES = Object.freeze([
  'validation',
  'configuration',
  'network',
  'timeout',
  'canceled',
  'conflict',
  'storage',
  'external-tool',
  'permission',
  'internal',
])

const CATEGORY_SET = new Set(ERROR_CATEGORIES)
const SENSITIVE_KEY = /(?:authorization|credential|cookie|password|passwd|secret|token|api[-_]?key|proxy[-_]?auth|stack)/i
const MAX_DETAIL_DEPTH = 6
const MAX_DETAIL_ITEMS = 100
let operationSequence = 0

function createOperationId() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
    return `operation-${globalThis.crypto.randomUUID()}`
  }
  operationSequence += 1
  return `operation-${Date.now().toString(36)}-${operationSequence.toString(36)}`
}

function sanitizeText(value) {
  return String(value)
    .replace(/\b(?:https?|socks5?):\/\/[^\s/@:]+:[^\s/@]+@/gi, (match) => match.replace(/\/\/.*@/, '//[credentials]@'))
    .replace(/\b(?:authorization\s*:\s*)?(?:basic|bearer)\s+[A-Za-z0-9._~+/=-]+/gi, '[credential]')
    .replace(/\b(?:token|api[-_]?key|password|passwd|secret|cookie)\s*[=:]\s*[^\s,;]+/gi, '[credential]')
    .replace(/\b[A-Za-z]:\\(?:Users|Documents and Settings)\\[^\s,;"']+(?:\\[^\s,;"']*)*/gi, '[private-path]')
    .replace(/(?:^|\s)\/(?:home|Users)\/[^\s,;"']+(?:\/[^\s,;"']*)*/g, (match) => `${match.charAt(0) === ' ' ? ' ' : ''}[private-path]`)
}

function sanitizeDetailsValue(value, depth, seen) {
  if (value === null || value === undefined || typeof value === 'boolean' || typeof value === 'number') return value
  if (typeof value === 'string') return sanitizeText(value)
  if (typeof value === 'bigint') return String(value)
  if (typeof value === 'function' || typeof value === 'symbol') return undefined
  if (depth >= MAX_DETAIL_DEPTH) return '[truncated]'
  if (seen.has(value)) return '[circular]'
  seen.add(value)
  if (Array.isArray(value)) {
    const sanitized = value.slice(0, MAX_DETAIL_ITEMS).map((item) => sanitizeDetailsValue(item, depth + 1, seen))
    seen.delete(value)
    return sanitized
  }
  const sanitized = {}
  let count = 0
  for (const [key, item] of Object.entries(value)) {
    if (count >= MAX_DETAIL_ITEMS) break
    if (SENSITIVE_KEY.test(key)) continue
    const next = sanitizeDetailsValue(item, depth + 1, seen)
    if (next !== undefined) sanitized[key] = next
    count += 1
  }
  seen.delete(value)
  return sanitized
}

export function sanitizeErrorDetails(details) {
  const sanitized = sanitizeDetailsValue(details && typeof details === 'object' ? details : {}, 0, new WeakSet())
  return sanitized && !Array.isArray(sanitized) && typeof sanitized === 'object' ? sanitized : {}
}

function requireText(value, field) {
  const text = String(value || '').trim()
  if (!text) throw new TypeError(`${field} is required`)
  return text
}

export class TypedApplicationError extends Error {
  constructor(input) {
    const category = requireText(input && input.category, 'error category')
    if (!CATEGORY_SET.has(category)) throw new TypeError(`unsupported error category: ${category}`)
    const message = sanitizeText(requireText(input && input.message, 'error message'))
    super(message)
    this.name = 'TypedApplicationError'
    delete this.stack
    this.code = requireText(input && input.code, 'error code')
    if (!/^[A-Z][A-Z0-9_]*$/.test(this.code)) {
      throw new TypeError('error code must be a stable uppercase identifier')
    }
    this.category = category
    this.retryable = category !== 'canceled' && input && input.retryable === true
    this.operationId = requireText(input && input.operationId, 'error operationId')
    this.details = sanitizeErrorDetails(input && input.details)
  }
}

export function createTypedError(input) {
  return new TypedApplicationError(input)
}

export function isTypedError(value) {
  return !!value
    && typeof value === 'object'
    && typeof value.code === 'string'
    && CATEGORY_SET.has(value.category)
    && typeof value.message === 'string'
    && typeof value.retryable === 'boolean'
    && typeof value.operationId === 'string'
    && value.details !== null
    && typeof value.details === 'object'
    && !Array.isArray(value.details)
}

export function normalizeError(error, context = {}) {
  if (isTypedError(error)) {
    return createTypedError({
      code: error.code,
      category: error.category,
      message: error.message,
      retryable: error.retryable,
      operationId: error.operationId || context.operationId || createOperationId(),
      details: { ...error.details, ...context.details },
    })
  }
  return createTypedError({
    code: 'INTERNAL_ERROR',
    category: 'internal',
    message: 'Something went wrong',
    retryable: false,
    operationId: context.operationId || createOperationId(),
    details: context.details,
  })
}
