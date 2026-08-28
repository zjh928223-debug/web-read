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
