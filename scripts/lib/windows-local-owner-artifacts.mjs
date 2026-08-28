import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
export const OWNER_ARTIFACT_DIRECTORY = path.join(
  REPOSITORY_ROOT,
  'docs',
  'architecture',
  'windows-local-owner-thin-reader',
)

export const OWNER_ARTIFACT_FILES = Object.freeze([
  'environment-baseline.json',
  'domain-inventory.json',
  'ownership-matrix.json',
  'browser-direct-writer-consumer-map.json',
  'baseline-journeys.json',
  'non-goals.json',
  'api-contract.json',
])

export const WINDOWS_OWNER_DOMAINS = Object.freeze([
  'reader-session',
  'marks-activity',
  'vocabulary-srs',
  'passage-preview',
  'annotation',
  'workflow',
])

export const REQUIRED_READER_SESSION_CONSUMERS = Object.freeze([
  'reader.import-module',
  'reader.marks-store-toggle',
  'reader.startup-cleanup',
])

export const FROZEN_IDB_SCHEMA = Object.freeze({
  databaseName: 'SeekPlayerDB',
  version: 1,
  objectStore: 'files',
  keyPath: 'id',
})

export function compareCodePoint(left, right) {
  const leftValue = String(left)
  const rightValue = String(right)
  return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0
}

export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const entries = Object.keys(value)
    .sort(compareCodePoint)
    .filter((key) => value[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
  return `{${entries.join(',')}}`
}

export function sha256Text(value) {
  return `sha256:${createHash('sha256').update(String(value), 'utf8').digest('hex')}`
}

export function checksumFor(value) {
  return sha256Text(canonicalJson(value))
}

export function withoutArtifactChecksum(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  const copy = { ...value }
  delete copy.artifactChecksum
  return copy
}

export function artifactChecksumFor(value) {
  return checksumFor(withoutArtifactChecksum(value))
}

export async function readJson(relativePath) {
  const absolutePath = path.isAbsolute(relativePath)
    ? relativePath
    : path.join(REPOSITORY_ROOT, relativePath)
  return JSON.parse(await readFile(absolutePath, 'utf8'))
}

export async function readArtifact(filename) {
  if (!OWNER_ARTIFACT_FILES.includes(filename)) {
    throw new Error(`Unknown Windows owner artifact: ${filename}`)
  }
  const value = await readJson(path.join(OWNER_ARTIFACT_DIRECTORY, filename))
  if (value.artifactChecksum !== artifactChecksumFor(value)) {
    throw new Error(`${filename} artifactChecksum is stale or missing`)
  }
  return value
}

export async function loadOwnerArtifacts() {
  const entries = await Promise.all(OWNER_ARTIFACT_FILES.map(async (filename) => [
    filename,
    await readArtifact(filename),
  ]))
  return Object.fromEntries(entries)
}

export async function sha256File(relativePath) {
  const absolutePath = path.isAbsolute(relativePath)
    ? relativePath
    : path.join(REPOSITORY_ROOT, relativePath)
  return `sha256:${createHash('sha256').update(await readFile(absolutePath)).digest('hex')}`
}

export function normalizeRepositoryPath(value) {
  return String(value).replaceAll('\\', '/').replace(/^\.\//u, '')
}

export function protectedPathViolations({ milestonePaths = [], stagedPaths = [], protectedPaths = [] } = {}) {
  const protectedSet = new Set(protectedPaths.map(normalizeRepositoryPath))
  const violations = []
  for (const value of milestonePaths) {
    const normalized = normalizeRepositoryPath(value)
    if (protectedSet.has(normalized)) violations.push(`milestone:${normalized}`)
  }
  for (const value of stagedPaths) {
    const normalized = normalizeRepositoryPath(value)
    if (protectedSet.has(normalized)) violations.push(`staged:${normalized}`)
  }
  return [...new Set(violations)]
}

export function missingRequiredConsumerIds(consumerIds, requiredIds = REQUIRED_READER_SESSION_CONSUMERS) {
  const knownIds = consumerIds instanceof Set ? consumerIds : new Set(consumerIds)
  return requiredIds.filter((id) => !knownIds.has(id))
}

const SOURCE_TOKEN_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]*$/u

export function consumerEvidenceTokens(consumer) {
  const explicitTokens = Array.isArray(consumer?.evidenceTokens)
    ? consumer.evidenceTokens
    : []
  const exactSymbols = Array.isArray(consumer?.symbols)
    ? consumer.symbols.filter((symbol) => SOURCE_TOKEN_PATTERN.test(symbol))
    : []
  return [...new Set([...explicitTokens, ...exactSymbols].map(String))]
}

export function missingConsumerEvidenceTokens(consumer, source) {
  const tokens = consumerEvidenceTokens(consumer)
  if (tokens.length === 0) return ['<missing-evidence-token>']
  const sourceText = String(source)
  return tokens.filter((token) => !sourceContainsEvidenceToken(sourceText, token))
}

function sourceContainsEvidenceToken(source, token) {
  if (!SOURCE_TOKEN_PATTERN.test(token)) return source.includes(token)
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  return new RegExp(`(?<![A-Za-z0-9_$])${escaped}(?![A-Za-z0-9_$])`, 'u').test(source)
}

function uniqueSorted(values) {
  return [...new Set(values)].sort(compareCodePoint)
}

function captureValues(source, pattern, group = 1) {
  return [...String(source).matchAll(pattern)]
    .map((match) => match[group])
    .filter((value) => value !== undefined)
}

function countMatches(source, pattern) {
  return [...String(source).matchAll(pattern)].length
}

export function indexedDbSchemaSemanticFingerprint(source) {
  const sourceText = String(source)
  const databaseNames = [
    ...captureValues(sourceText, /\b(?:DATABASE_NAME|DB_NAME)\s*=\s*['"]([^'"]+)['"]/gu),
    ...captureValues(sourceText, /\b(?:indexedDB|indexedDBApi)\.open\(\s*['"]([^'"]+)['"]\s*,/gu),
  ]
  const versions = [
    ...captureValues(sourceText, /\b(?:DATABASE_VERSION|DB_VERSION)\s*=\s*(\d+)/gu),
    ...captureValues(sourceText, /\b(?:indexedDB|indexedDBApi)\.open\(\s*[^,]+,\s*(\d+)/gu),
  ]
  const storeNames = [
    ...captureValues(sourceText, /\b(?:STORE_NAME|storeName)\s*=\s*['"]([^'"]+)['"]/gu),
    ...captureValues(sourceText, /\b(?:objectStore|createObjectStore|deleteObjectStore)\(\s*['"]([^'"]+)['"]/gu),
    ...captureValues(sourceText, /\btransaction\(\s*\[\s*['"]([^'"]+)['"]/gu),
  ]
  const keyPaths = captureValues(
    sourceText,
    /\bkeyPath\s*(?::|===?|!==?)\s*['"]([^'"]+)['"]/gu,
  )

  return {
    databaseNames: uniqueSorted(databaseNames),
    versions: uniqueSorted(versions),
    storeNames: uniqueSorted(storeNames),
    keyPaths: uniqueSorted(keyPaths),
    operationCounts: {
      onupgradeneeded: countMatches(sourceText, /\bonupgradeneeded\b/gu),
      createObjectStore: countMatches(sourceText, /\bcreateObjectStore\s*\(/gu),
      deleteObjectStore: countMatches(sourceText, /\bdeleteObjectStore\s*\(/gu),
      deleteDatabase: countMatches(sourceText, /\bdeleteDatabase\s*\(/gu),
      clearStore: countMatches(sourceText, /\.\s*clear\s*\(/gu),
      schemaRebuild: countMatches(sourceText, /\b(?:rebuild|recreate)(?:Database|Store|Schema)\b/giu),
    },
  }
}

export function indexedDbSchemaSemanticDiff(expected, actual) {
  return canonicalJson(expected) === canonicalJson(actual)
    ? []
    : ['semantic fingerprint changed']
}

export function aggregateIndexedDbSchemaSemantics(fingerprints) {
  const list = Array.isArray(fingerprints) ? fingerprints : []
  return {
    databaseNames: uniqueSorted(list.flatMap((value) => value.databaseNames || [])),
    versions: uniqueSorted(list.flatMap((value) => value.versions || [])),
    storeNames: uniqueSorted(list.flatMap((value) => value.storeNames || [])),
    keyPaths: uniqueSorted(list.flatMap((value) => value.keyPaths || [])),
  }
}

export function relativeRepositoryPath(value) {
  return path.relative(REPOSITORY_ROOT, value).replaceAll(path.sep, '/')
}

export function artifactSetChecksum(artifacts) {
  const entries = Object.keys(artifacts)
    .sort(compareCodePoint)
    .map((filename) => ({ filename, artifactChecksum: artifacts[filename].artifactChecksum }))
  return checksumFor(entries)
}

export function assert(condition, message) {
  if (!condition) throw new Error(message)
}
