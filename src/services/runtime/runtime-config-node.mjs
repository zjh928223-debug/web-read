import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

export const RUNTIME_CONFIG_SCHEMA_VERSION = 1

const DEFAULTS = Object.freeze({
  schemaVersion: RUNTIME_CONFIG_SCHEMA_VERSION,
  frontend: { host: '127.0.0.1', port: 5173 },
  backend: { host: '127.0.0.1', port: 8765 },
  dataRoot: String.raw`E:\ReadWebData\SubtitleWorkflow`,
  python: { executable: 'python' },
  tools: { ytDlp: 'yt-dlp', whisperx: 'whisperx', ffmpeg: 'ffmpeg' },
  network: { proxyUrl: 'http://127.0.0.1:7897' },
  ai: { model: 'gemini-2.5-flash', baseUrl: '' },
})

const ALLOWED = Object.freeze({
  root: new Set(['schemaVersion', 'frontend', 'backend', 'dataRoot', 'python', 'tools', 'network', 'ai']),
  frontend: new Set(['host', 'port']),
  backend: new Set(['host', 'port']),
  python: new Set(['executable']),
  tools: new Set(['ytDlp', 'whisperx', 'ffmpeg', 'cookies']),
  network: new Set(['proxyUrl']),
  ai: new Set(['model', 'baseUrl']),
})

export function loadRuntimeConfig(options = {}) {
  const env = options.env || process.env
  const cwd = path.resolve(options.cwd || process.cwd())
  const configuredPath = options.configPath || env.READ_WEB_RUNTIME_CONFIG || ''
  const sourcePath = configuredPath ? path.resolve(cwd, configuredPath) : ''
  const payload = sourcePath ? readPayload(sourcePath) : {}
  validatePayload(payload)
  const baseDir = sourcePath ? path.dirname(sourcePath) : cwd
  const version = payload.schemaVersion ?? RUNTIME_CONFIG_SCHEMA_VERSION
  if (version !== RUNTIME_CONFIG_SCHEMA_VERSION) throw new Error(`unsupported schemaVersion: ${version}`)

  const value = (envName, section, key, fallback) => {
    const envValue = env[envName]
    if (envValue !== undefined && envValue !== '') return envValue
    return payload[section]?.[key] ?? fallback
  }
  const resolvePath = (input) => {
    const text = String(input || '')
    if (!text || (!text.includes('/') && !text.includes('\\') && !text.startsWith('.'))) return text
    return path.isAbsolute(text) ? path.normalize(text) : path.resolve(baseDir, text)
  }
  const endpoint = (section, hostEnv, portEnv) => {
    const host = String(value(hostEnv, section, 'host', DEFAULTS[section].host)).trim()
    const port = parsePort(value(portEnv, section, 'port', DEFAULTS[section].port), `${section}.port`)
    if (!host) throw new Error(`${section}.host must not be empty`)
    return { host, port, url: `http://${host}:${port}${section === 'frontend' ? '/' : ''}` }
  }
  const frontend = endpoint('frontend', 'READ_WEB_FRONTEND_HOST', 'READ_WEB_FRONTEND_PORT')
  const backend = endpoint('backend', 'READ_WEB_BACKEND_HOST', 'READ_WEB_BACKEND_PORT')
  backend.healthUrl = `${backend.url}/api/health`
  return Object.freeze({
    schemaVersion: version,
    sourcePath,
    frontend,
    backend,
    dataRoot: resolvePath(env.READ_WEB_SUBTITLE_DATA_ROOT || payload.dataRoot || DEFAULTS.dataRoot),
    python: { executable: resolvePath(env.READ_WEB_PYTHON || value('READ_WEB_PYTHON_PATH', 'python', 'executable', DEFAULTS.python.executable)) },
    tools: {
      ytDlp: resolvePath(value('YT_DLP_PATH', 'tools', 'ytDlp', DEFAULTS.tools.ytDlp)),
      whisperx: resolvePath(value('WHISPERX_PATH', 'tools', 'whisperx', DEFAULTS.tools.whisperx)),
      ffmpeg: resolvePath(value('FFMPEG_PATH', 'tools', 'ffmpeg', DEFAULTS.tools.ffmpeg)),
      cookies: resolvePath(value('YOUTUBE_COOKIES_PATH', 'tools', 'cookies', path.join(env.READ_WEB_SUBTITLE_DATA_ROOT || payload.dataRoot || DEFAULTS.dataRoot, 'cookies.txt'))),
    },
    network: { proxyUrl: String(value('READ_WEB_PROXY_URL', 'network', 'proxyUrl', DEFAULTS.network.proxyUrl)) },
    ai: {
      model: String(value('GEMINI_MODEL', 'ai', 'model', DEFAULTS.ai.model)),
      baseUrl: String(value('GEMINI_BASE_URL', 'ai', 'baseUrl', DEFAULTS.ai.baseUrl)),
    },
  })
}

function readPayload(sourcePath) {
  try { return JSON.parse(fs.readFileSync(sourcePath, 'utf8')) }
  catch (error) { throw new Error(`cannot read runtime config: ${sourcePath}`, { cause: error }) }
}

function validatePayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('runtime config must be an object')
  for (const key of Object.keys(payload)) if (!ALLOWED.root.has(key)) throw new Error(`unknown field: ${key}`)
  for (const section of Object.keys(ALLOWED).filter((key) => key !== 'root')) {
    if (payload[section] === undefined) continue
    if (!payload[section] || typeof payload[section] !== 'object' || Array.isArray(payload[section])) throw new Error(`${section} must be an object`)
    for (const key of Object.keys(payload[section])) if (!ALLOWED[section].has(key)) throw new Error(`unknown field: ${section}.${key}`)
  }
}

function parsePort(value, name) {
  const port = Number(value)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`${name} must be between 1 and 65535`)
  return port
}
