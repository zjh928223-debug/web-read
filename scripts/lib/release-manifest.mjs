import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const releaseManifestSchemaPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../config/release-manifest.schema.json')

export async function sha256File(filename) {
  return createHash('sha256').update(await readFile(filename)).digest('hex')
}

export function resolveViteConfigPath(root) {
  for (const relative of ['vite.config.mjs', 'vite.config.js']) {
    if (existsSync(path.join(root, relative))) return relative
  }
  return null
}

export async function readReleaseManifest(manifestPath) {
  const bytes = await readFile(manifestPath)
  const manifest = JSON.parse(bytes.toString('utf8'))
  const schema = await loadReleaseManifestSchema()
  const failures = validateReleaseManifestSchema(manifest, schema)
  for (const [name, descriptor] of Object.entries(manifest.externalTools || {})) {
    const semanticFailure = validateExternalToolDescriptorSemantics(descriptor)
    if (semanticFailure) failures.push(`$.externalTools.${name}: ${semanticFailure}`)
  }
  if (failures.length) {
    throw new Error(`release manifest schema validation failed: ${manifestPath}: ${failures.join('; ')}`)
  }
  return { manifest, sha256: createHash('sha256').update(bytes).digest('hex') }
}

export async function loadReleaseManifestSchema() {
  return JSON.parse(await readFile(releaseManifestSchemaPath, 'utf8'))
}

export function validateReleaseManifestSchema(value, schema) {
  const failures = []
  validateSchemaNode(value, schema, '$', schema, failures)
  return failures
}

const EXTERNAL_TOOL_DATE_PATTERN = /^(?<year>\d{4})[.-](?<month>\d{2})[.-](?<day>\d{2})$/

export const EXTERNAL_TOOL_SUPPORT_MATRIX = Object.freeze({
  ffmpeg: Object.freeze({
    kind: 'ffmpeg',
    matrixId: 'ffmpeg-stable-6-to-8-or-git-2024-to-2026',
    outputPattern: '^\\s*ffmpeg\\s+version\\s+(?<version>\\S+)',
  }),
  ytDlp: Object.freeze({
    kind: 'yt-dlp',
    matrixId: 'yt-dlp-calendar-2025-to-2026',
    outputPattern: '^\\s*(?<version>\\d{4}\\.\\d{2}\\.\\d{2})\\s*$',
  }),
  whisperx: Object.freeze({
    kind: 'whisperx',
    matrixId: 'whisperx-semver-3',
    outputPattern: '^\\s*(?:whisperx(?:\\s+version)?\\s+)?v?(?<version>\\d+\\.\\d+\\.\\d+)\\s*$',
  }),
})

export function classifyExternalToolProbe(name, { exitCode, stdout = '', stderr = '' } = {}) {
  const key = name === 'yt-dlp' || name === 'ytdlp' ? 'ytDlp' : name
  const policy = EXTERNAL_TOOL_SUPPORT_MATRIX[key]
  if (!policy) throw new Error(`unsupported external tool: ${name}`)
  const versionLine = String(`${stdout}\n${stderr}`).split(/\r?\n/).map((line) => line.trim()).find(Boolean) || null
  const result = {
    version: null,
    versionLine,
    status: 'degraded',
    compatibility: {
      matrix: policy.matrixId,
      status: 'probe-failed',
      supported: false,
      reason: '',
    },
  }
  if (exitCode !== 0) {
    result.compatibility.reason = `probe-exit-code-${Number.isInteger(exitCode) ? exitCode : 'unknown'}`
    return result
  }
  if (!versionLine) {
    result.compatibility.status = 'invalid-output'
    result.compatibility.reason = 'probe-returned-no-version-banner'
    return result
  }
  const match = new RegExp(policy.outputPattern, 'i').exec(versionLine)
  if (!match) {
    result.compatibility.status = 'invalid-output'
    result.compatibility.reason = `probe-output-does-not-match-${policy.kind}-banner`
    return result
  }
  const version = match.groups?.version || null
  result.version = version
  const support = supportedExternalToolVersion(policy.kind, version)
  if (!support.supported) {
    result.compatibility.status = 'unsupported-version'
    result.compatibility.reason = support.reason
    return result
  }
  result.status = 'verified'
  result.compatibility.status = 'supported'
  result.compatibility.supported = true
  result.compatibility.reason = support.reason
  return result
}

export function validateExternalToolDescriptorSemantics(descriptor) {
  if (!descriptor || !['verified', 'missing', 'degraded'].includes(descriptor.status)) return 'external tool status is invalid'
  const compatibility = descriptor.compatibility
  if (!compatibility || typeof compatibility.matrix !== 'string' || !compatibility.matrix
    || descriptor.supportMatrix !== compatibility.matrix
    || typeof compatibility.reason !== 'string' || !compatibility.reason) {
    return 'external tool support metadata is incomplete'
  }
  if (!['supported', 'missing', 'unsupported-version', 'invalid-output', 'probe-failed'].includes(compatibility.status)) {
    return 'external tool compatibility status is invalid'
  }
  if (descriptor.status === 'verified' && (compatibility.status !== 'supported' || compatibility.supported !== true)) {
    return 'verified external tool is not supported by its matrix'
  }
  if (compatibility.status === 'supported' && descriptor.status !== 'verified') return 'supported external tool is not verified'
  if (descriptor.status === 'missing' && compatibility.status !== 'missing') return 'missing external tool has a non-missing compatibility status'
  if (descriptor.status === 'degraded' && compatibility.status === 'supported') return 'degraded external tool is marked supported'
  return null
}

function supportedExternalToolVersion(kind, version) {
  if (kind === 'ffmpeg') {
    const stable = /^(?<major>\d+)\.\d+(?:\.\d+)?(?:[-+].*)?$/.exec(version || '')
    if (stable) {
      const major = Number(stable.groups.major)
      return major >= 6 && major <= 8
        ? { supported: true, reason: 'supported-stable-major' }
        : { supported: false, reason: 'version-outside-ffmpeg-stable-major-6-to-8' }
    }
    const dated = /^(?<date>20\d\d-\d\d-\d\d)(?:-|$)/.exec(version || '')
    if (dated && externalToolDateInRange(dated.groups.date, 2024, 2026, '-')) {
      return { supported: true, reason: 'supported-dated-git-build-2024-to-2026' }
    }
    return { supported: false, reason: 'ffmpeg-version-token-is-not-stable-or-dated-git-build' }
  }
  if (kind === 'yt-dlp') {
    return externalToolDateInRange(version, 2025, 2026, '.')
      ? { supported: true, reason: 'supported-calendar-release-2025-to-2026' }
      : { supported: false, reason: 'version-outside-yt-dlp-calendar-2025-to-2026' }
  }
  const whisperx = /^(?<major>\d+)\.\d+\.\d+$/.exec(version || '')
  return whisperx && Number(whisperx.groups.major) === 3
    ? { supported: true, reason: 'supported-whisperx-major-3' }
    : { supported: false, reason: 'version-outside-whisperx-major-3' }
}

function externalToolDateInRange(value, minimumYear, maximumYear, separator) {
  const match = EXTERNAL_TOOL_DATE_PATTERN.exec(value || '')
  if (!match || !String(value).includes(separator)) return false
  const year = Number(match.groups.year)
  const month = Number(match.groups.month)
  const day = Number(match.groups.day)
  const date = new Date(Date.UTC(year, month - 1, day))
  return year >= minimumYear && year <= maximumYear
    && date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day
}

export async function verifyReleaseManifest(manifestPath, rootOverride = '') {
  const { manifest, sha256 } = await readReleaseManifest(manifestPath)
  const root = path.resolve(rootOverride || manifest.release.root || path.dirname(manifestPath))
  const failures = []
  for (const artifact of manifest.artifacts) {
    const filename = path.resolve(root, artifact.path)
    if (filename !== root && !filename.startsWith(`${root}${path.sep}`)) {
      failures.push(`${artifact.path}: outside release root`)
      continue
    }
    try {
      const actual = await sha256File(filename)
      if (actual !== artifact.sha256) failures.push(`${artifact.path}: checksum mismatch`)
    } catch (error) {
      failures.push(`${artifact.path}: ${error.code || 'read failed'}`)
    }
  }
  return { manifest, manifestSha256: sha256, root, failures, passed: failures.length === 0 }
}

export async function writeJsonAtomic(filename, value) {
  const temporary = `${filename}.${process.pid}.${Date.now()}.tmp`
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  await rename(temporary, filename)
}

function validateSchemaNode(value, schema, location, rootSchema, failures) {
  if (schema?.$ref) {
    const definitionPath = schema.$ref.startsWith('#/$defs/') ? schema.$ref.slice('#/$defs/'.length) : ''
    validateSchemaNode(value, rootSchema.$defs?.[definitionPath] || {}, location, rootSchema, failures)
    return
  }
  if (schema?.const !== undefined && value !== schema.const) failures.push(`${location}: expected ${JSON.stringify(schema.const)}`)
  if (schema?.enum && !schema.enum.includes(value)) failures.push(`${location}: unexpected enum value`)
  if (schema?.type && !matchesType(value, schema.type)) {
    failures.push(`${location}: expected ${Array.isArray(schema.type) ? schema.type.join('|') : schema.type}`)
    return
  }
  if (schema?.format === 'date-time' && (typeof value !== 'string' || Number.isNaN(Date.parse(value)))) failures.push(`${location}: invalid date-time`)
  if (schema?.pattern && typeof value === 'string' && !(new RegExp(schema.pattern).test(value))) failures.push(`${location}: pattern mismatch`)
  if (schema?.minLength !== undefined && typeof value === 'string' && value.length < schema.minLength) failures.push(`${location}: shorter than minLength`)
  if (schema?.minimum !== undefined && typeof value === 'number' && value < schema.minimum) failures.push(`${location}: below minimum`)
  if (schema?.required && value && typeof value === 'object' && !Array.isArray(value)) {
    for (const required of schema.required) if (!(required in value)) failures.push(`${location}: missing required property ${required}`)
  }
  if (schema?.properties && value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [name, propertySchema] of Object.entries(schema.properties)) {
      if (name in value) validateSchemaNode(value[name], propertySchema, `${location}.${name}`, rootSchema, failures)
    }
  }
  if (schema?.items && Array.isArray(value)) value.forEach((item, index) => validateSchemaNode(item, schema.items, `${location}[${index}]`, rootSchema, failures))
}

function matchesType(value, type) {
  const types = Array.isArray(type) ? type : [type]
  return types.some((candidate) => (
    candidate === 'null' && value === null
    || candidate === 'object' && value !== null && typeof value === 'object' && !Array.isArray(value)
    || candidate === 'array' && Array.isArray(value)
    || candidate === 'string' && typeof value === 'string'
    || candidate === 'boolean' && typeof value === 'boolean'
    || candidate === 'integer' && Number.isInteger(value)
    || candidate === 'number' && typeof value === 'number' && Number.isFinite(value)
  ))
}
