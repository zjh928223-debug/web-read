import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile, rename, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const releaseManifestSchemaPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../config/release-manifest.schema.json')

export const RELEASE_FRONTEND_ENTRY_PATH = 'dist/index.html'
export const RELEASE_PYTHON_LOCK_PATH = 'tools/subtitle-workflow/requirements-service.lock'
export const RELEASE_REQUIRED_ARTIFACTS = Object.freeze([
  RELEASE_FRONTEND_ENTRY_PATH,
  'package-lock.json',
  RELEASE_PYTHON_LOCK_PATH,
])

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
  failures.push(...validateReleaseManifestSemantics(manifest))
  if (failures.length) {
    throw new Error(`release manifest schema validation failed: ${manifestPath}: ${failures.join('; ')}`)
  }
  return { manifest, bytes, sha256: createHash('sha256').update(bytes).digest('hex') }
}

export function validateReleaseManifestSemantics(manifest) {
  const failures = []
  const source = manifest?.source
  if (source?.readOnly === true && source.kind === 'working-tree') failures.push('$.source: a read-only source cannot be a working tree')
  if (source?.kind === 'manifest' && source.readOnly !== true) failures.push('$.source: manifest inputs must be read-only')

  const identity = manifest?.runtime?.pythonIdentity
  const pythonLock = manifest?.dependencyLocks?.python
  if (source?.kind === 'manifest' || source?.kind === 'immutable-release') {
    if (source.readOnly !== true) failures.push('$.source: immutable manifest inputs must be read-only')
    if (identity?.status !== 'verified') failures.push('$.runtime.pythonIdentity: immutable previous releases require a verified Python environment')
    if (pythonLock?.status !== 'verified') failures.push('$.dependencyLocks.python: immutable previous releases require a verified Python lock')
    const requiredArtifacts = new Set((manifest?.artifacts || []).map((item) => String(item?.path || '').replaceAll('\\', '/')))
    for (const required of RELEASE_REQUIRED_ARTIFACTS) {
      if (!requiredArtifacts.has(required)) failures.push(`$.artifacts: immutable previous release is missing ${required}`)
    }
  }
  if (identity?.status === 'verified') {
    for (const [name, value] of Object.entries({
      executable: identity.executable,
      version: identity.version,
      packageSetSha256: identity.packageSetSha256,
      environmentSha256: identity.environmentSha256,
    })) {
      if (typeof value !== 'string' || !value) failures.push(`$.runtime.pythonIdentity.${name}: verified identity is incomplete`)
    }
    if (pythonLock?.status !== 'verified' || typeof pythonLock.sha256 !== 'string') {
      failures.push('$.dependencyLocks.python: verified Python identity requires a verified Python lock')
    }
  }
  if (pythonLock?.status === 'verified' && typeof pythonLock.sha256 !== 'string') failures.push('$.dependencyLocks.python: verified lock must include sha256')
  if (pythonLock?.status === 'missing' && pythonLock.sha256 !== null) failures.push('$.dependencyLocks.python: missing lock must use null sha256')

  for (const [name, lock] of Object.entries(manifest?.dependencyLocks || {})) {
    if (lock?.status !== 'verified') continue
    const artifact = (manifest.artifacts || []).find((item) => typeof item?.path === 'string' && item.path.replaceAll('\\', '/') === String(lock.path).replaceAll('\\', '/'))
    if (!artifact) failures.push(`$.dependencyLocks.${name}: verified lock is not covered by an artifact checksum`)
    else if (artifact.sha256 !== lock.sha256) failures.push(`$.dependencyLocks.${name}: lock checksum does not match its artifact`)
  }

  if (manifest?.role === 'optimization-local') {
    if (source?.readOnly !== false) failures.push('$.source: release candidates must identify a writable build source')
    if (identity?.status !== 'verified') failures.push('$.runtime.pythonIdentity: release candidates require a verified Python environment')
    if (pythonLock?.status !== 'verified') failures.push('$.dependencyLocks.python: release candidates require a verified Python lock')
  }
  return failures
}

export function releaseSourceError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

export async function resolvePreviousReleaseSource({ previousRoot = '', previousManifest = '' } = {}) {
  if (!previousManifest && !previousRoot) {
    throw releaseSourceError(
      'RELEASE_PREVIOUS_SOURCE_NOT_CONFIGURED',
      'no previous release source configured; provide --previous-manifest or --previous-root (or READ_WEB_PREVIOUS_RELEASE_MANIFEST/READ_WEB_PREVIOUS_RELEASE_ROOT)',
    )
  }
  if (previousManifest) {
    const manifestPath = path.resolve(previousManifest)
    let verified
    try {
      verified = await readReleaseManifest(manifestPath)
    } catch (error) {
      throw releaseSourceError('RELEASE_PREVIOUS_MANIFEST_INVALID', `previous release manifest is invalid: ${manifestPath}: ${error.message}`)
    }
    if (verified.manifest.source.manifestSha256 && verified.manifest.source.manifestSha256 !== verified.sha256) {
      throw releaseSourceError(
        'RELEASE_PREVIOUS_MANIFEST_IDENTITY_MISMATCH',
        `previous release manifest source identity does not match its bytes: ${manifestPath}`,
      )
    }
    const root = resolveManifestRoot(manifestPath, verified.manifest, previousRoot)
    const integrity = await verifyReleaseManifest(manifestPath, root)
    if (!integrity.passed) {
      throw releaseSourceError('RELEASE_PREVIOUS_MANIFEST_UNVERIFIED', `previous release manifest failed read-only artifact verification: ${integrity.failures.join('; ')}`)
    }
    if (verified.manifest.source.readOnly !== true) {
      throw releaseSourceError('RELEASE_PREVIOUS_SOURCE_NOT_READ_ONLY', `previous release manifest source is not marked read-only: ${manifestPath}`)
    }
    if (!['manifest', 'immutable-release'].includes(verified.manifest.source.kind)) {
      throw releaseSourceError(
        'RELEASE_PREVIOUS_SOURCE_NOT_IMMUTABLE',
        `formal previous release input must declare source.kind=manifest or immutable-release: ${manifestPath}`,
      )
    }
    return {
      kind: 'manifest',
      readOnly: true,
      manifestPath,
      root,
      manifest: verified.manifest,
      manifestBytes: verified.bytes,
      manifestSha256: verified.sha256,
    }
  }

  const root = path.resolve(previousRoot)
  try {
    await stat(path.join(root, 'index.html'))
  } catch {
    throw releaseSourceError('RELEASE_PREVIOUS_SOURCE_NOT_FOUND', `previous release root is not readable: ${root}`)
  }
  const pythonLock = path.join(root, RELEASE_PYTHON_LOCK_PATH)
  if (!existsSync(pythonLock)) {
    throw releaseSourceError(
      'RELEASE_PREVIOUS_SOURCE_INCOMPLETE',
      `legacy previous release has no Python lock: ${pythonLock}; provide a version-controlled previous-release manifest with auditable lock/identity metadata`,
    )
  }
  return { kind: 'legacy-root', readOnly: true, manifestPath: null, root, manifest: null, manifestSha256: null }
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
  const root = resolveManifestRoot(manifestPath, manifest, rootOverride)
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

function resolveManifestRoot(manifestPath, manifest, rootOverride = '') {
  if (rootOverride) return path.resolve(rootOverride)
  const configuredRoot = manifest.release.root || '.'
  if (path.isAbsolute(configuredRoot)) return path.normalize(configuredRoot)
  return path.resolve(path.dirname(path.resolve(manifestPath)), configuredRoot)
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
