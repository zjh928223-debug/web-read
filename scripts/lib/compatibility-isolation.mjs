import { randomUUID } from 'node:crypto'
import { isBrowserSafePort, RESERVED_DAILY_PORTS } from './browser-port-policy.mjs'

export { isBrowserSafePort, RESERVED_DAILY_PORTS } from './browser-port-policy.mjs'

const BLOCKED_ENV_NAMES = [
  /^READ_WEB_/,
  /^VITE_/,
  /^ECDICT_/,
  /^LOCAL_SENTENCE_/,
  /^VOCABULARY_/,
  /^MERRIAM_/,
  /^WORDNIK_/,
  /^GEMINI_/,
  /^YOUTUBE_/,
  /^IELTS_/,
  /^(?:HTTP|HTTPS|ALL|NO)_PROXY$/i,
]

export function rejectExplicitReadWebUrl(env = process.env) {
  if (typeof env.READ_WEB_URL === 'string' && env.READ_WEB_URL.trim()) {
    const error = new Error('compatibility browser gates refuse an explicit READ_WEB_URL; the gate must own its isolated Vite origin')
    error.code = 'COMPATIBILITY_EXPLICIT_URL_FORBIDDEN'
    throw error
  }
}

export function createIsolatedViteEnvironment(options = {}) {
  const frontendPort = assertPort(options.frontendPort, 'frontend', options.frontendPort)
  const backendPort = assertPort(options.backendPort, 'backend', options.backendPort)
  if (frontendPort === backendPort) throw new Error('isolated Vite frontend and backend ports must differ')
  for (const [name, value] of [['dataRoot', options.dataRoot], ['runtimeConfigPath', options.runtimeConfigPath], ['serviceToken', options.serviceToken]]) {
    if (typeof value !== 'string' || !value.trim()) throw new Error(`isolated Vite ${name} is required`)
  }

  const source = options.env || process.env
  const environment = Object.fromEntries(Object.entries(source).filter(([name]) => !BLOCKED_ENV_NAMES.some((pattern) => pattern.test(name))))
  const host = '127.0.0.1'
  return {
    ...environment,
    READ_WEB_FRONTEND_HOST: host,
    READ_WEB_FRONTEND_PORT: String(frontendPort),
    READ_WEB_BACKEND_HOST: host,
    READ_WEB_BACKEND_PORT: String(backendPort),
    READ_WEB_SUBTITLE_DATA_ROOT: options.dataRoot,
    READ_WEB_RUNTIME_CONFIG: options.runtimeConfigPath,
    VITE_LOCAL_SERVICE_BASE_URL: `http://${host}:${backendPort}`,
    VITE_READ_WEB_SERVICE_TOKEN: options.serviceToken,
    ECDICT_ENABLED: 'false',
  }
}

export function createIsolatedRuntimeConfig({ frontendPort, backendPort, dataRoot }) {
  assertPort(frontendPort, 'frontend', frontendPort)
  assertPort(backendPort, 'backend', backendPort)
  return {
    schemaVersion: 1,
    frontend: { host: '127.0.0.1', port: frontendPort },
    backend: { host: '127.0.0.1', port: backendPort },
    dataRoot,
    network: { proxyUrl: '' },
  }
}

export function createIsolatedServiceToken(prefix = 'compatibility') {
  return `${prefix}-${randomUUID()}`
}

function assertPort(value, name, originalValue) {
  const port = Number(value)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`isolated Vite ${name} port is invalid: ${originalValue}`)
  if (RESERVED_DAILY_PORTS.has(port)) throw new Error(`isolated Vite ${name} port cannot use reserved daily port ${port}`)
  if (!isBrowserSafePort(port)) throw new Error(`isolated Vite ${name} port is unsafe for Chromium: ${port}`)
  return port
}
