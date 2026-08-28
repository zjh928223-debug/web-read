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
  'reader.bootstrap-audio-adapter',
  'reader.workflow-loader',
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

export function missingMatrixConsumerRefs(consumerRecords, matrixRefs, requiredIds = REQUIRED_READER_SESSION_CONSUMERS) {
  const records = Array.isArray(consumerRecords) ? consumerRecords : []
  const refs = new Set(Array.isArray(matrixRefs) ? matrixRefs : [])
  const required = new Set(requiredIds)
  return records
    .filter((consumer) => required.has(consumer?.id))
    .map((consumer) => consumer.id)
    .filter((id) => !refs.has(id))
}

const SOURCE_TOKEN_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]*$/u
const INDEXED_DB_API_ROOTS = new Set(['indexedDB', 'indexedDBApi'])

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

export function indexedDbSchemaSemanticFingerprint(source) {
  const tokens = tokenizeJavaScript(source)
  const bindings = collectLiteralBindings(tokens)
  const indexedDbApiAliases = collectIndexedDbApiAliases(tokens)
  const openCalls = findCalls(tokens, 'open')
    .filter((call) => isIndexedDbApiMethodCall(tokens, call, indexedDbApiAliases))
  const objectStoreCalls = findCalls(tokens, 'objectStore')
    .filter((call) => isIndexedDbObjectStoreCall(tokens, call))
  const transactionCalls = findCalls(tokens, 'transaction')
  const createObjectStoreCalls = findCalls(tokens, 'createObjectStore')
  const deleteObjectStoreCalls = findCalls(tokens, 'deleteObjectStore')
  const deleteDatabaseCalls = findCalls(tokens, 'deleteDatabase')
    .filter((call) => isIndexedDbApiMethodCall(tokens, call, indexedDbApiAliases))
  const objectStoreAliases = collectObjectStoreAliases(tokens, objectStoreCalls, bindings)

  const databaseNames = [
    ...literalBindingsByName(bindings, /^(?:DATABASE_NAME|DB_NAME)$/u),
    ...openCalls.map((call) => firstResolvedLiteral(call.args[0], bindings)).filter(Boolean),
  ]
  const versions = [
    ...literalBindingsByName(bindings, /^(?:DATABASE_VERSION|DB_VERSION)$/u),
    ...openCalls.map((call) => firstResolvedLiteral(call.args[1], bindings)).filter(Boolean),
  ]
  const storeNames = [
    ...literalBindingsByName(bindings, /^(?:STORE_NAME|storeName)$/u),
    ...objectStoreCalls.map((call) => firstResolvedLiteral(call.args[0], bindings)).filter(Boolean),
    ...createObjectStoreCalls.map((call) => firstResolvedLiteral(call.args[0], bindings)).filter(Boolean),
    ...deleteObjectStoreCalls.map((call) => firstResolvedLiteral(call.args[0], bindings)).filter(Boolean),
    ...transactionCalls.map((call) => firstResolvedLiteral(call.args[0], bindings)).filter(Boolean),
  ]
  const keyPaths = [
    ...createObjectStoreCalls.map((call) => keyPathFromArgument(call.args[1], bindings)).filter(Boolean),
    ...objectStoreCalls
      .map((call) => keyPathAfterObjectStoreCall(tokens, call, bindings))
      .filter(Boolean),
    ...tokens
      .map((token, index) => tokens[index - 1]?.value === '.'
        && token.value === 'keyPath'
        && objectStoreAliases.has(tokens[index - 2]?.value)
        ? literalAfterProperty(tokens, index, bindings)
        : null)
      .filter(Boolean),
  ]

  return {
    databaseNames: uniqueSorted(databaseNames),
    versions: uniqueSorted(versions),
    storeNames: uniqueSorted(storeNames),
    keyPaths: uniqueSorted(keyPaths),
    schemaOperations: [
      ...createObjectStoreCalls.map((call) => operationSignature('createObjectStore', call, bindings, true)),
      ...deleteObjectStoreCalls.map((call) => operationSignature('deleteObjectStore', call, bindings)),
      ...deleteDatabaseCalls.map((call) => operationSignature('deleteDatabase', call, bindings)),
      ...rebuildOperations(tokens, bindings),
      ...objectStoreClearOperations(tokens, objectStoreCalls, bindings),
    ].sort(compareCodePoint),
  }
}

export function indexedDbSchemaSemanticDiff(expected, actual) {
  const differences = []
  for (const field of ['databaseNames', 'versions', 'storeNames', 'keyPaths']) {
    if (canonicalJson(expected?.[field] || []) !== canonicalJson(actual?.[field] || [])) {
      differences.push(`${field} changed`)
    }
  }
  const expectedOperationCounts = frequencyMap(expected?.schemaOperations || [])
  const actualOperationCounts = frequencyMap(actual?.schemaOperations || [])
  const introducedOperations = []
  for (const [operation, actualCount] of actualOperationCounts) {
    const introducedCount = actualCount - (expectedOperationCounts.get(operation) || 0)
    if (introducedCount > 0) introducedOperations.push(`${operation} (+${introducedCount})`)
  }
  if (introducedOperations.length > 0) {
    differences.push(`introduced schema operation(s): ${introducedOperations.join(', ')}`)
  }
  return differences
}

function frequencyMap(values) {
  const frequencies = new Map()
  for (const value of values) frequencies.set(value, (frequencies.get(value) || 0) + 1)
  return frequencies
}

export function aggregateIndexedDbSchemaSemantics(fingerprints) {
  const list = Array.isArray(fingerprints) ? fingerprints : []
  return {
    databaseNames: uniqueSorted(list.flatMap((value) => value.databaseNames || [])),
    versions: uniqueSorted(list.flatMap((value) => value.versions || [])),
    storeNames: uniqueSorted(list.flatMap((value) => value.storeNames || [])),
    keyPaths: uniqueSorted(list.flatMap((value) => value.keyPaths || [])),
    schemaOperations: list.flatMap((value) => value.schemaOperations || []).sort(compareCodePoint),
  }
}

function tokenizeJavaScript(source) {
  const text = String(source)
  const tokens = []
  let index = 0
  while (index < text.length) {
    const char = text[index]
    const next = text[index + 1]
    if (/\s/u.test(char)) {
      index += 1
      continue
    }
    if (char === '/' && next === '/') {
      index += 2
      while (index < text.length && text[index] !== '\n') index += 1
      continue
    }
    if (char === '/' && next === '*') {
      index += 2
      while (index < text.length && !(text[index] === '*' && text[index + 1] === '/')) index += 1
      index = Math.min(text.length, index + 2)
      continue
    }
    if (char === "'" || char === '"' || char === '`') {
      const quote = char
      let value = ''
      let interpolated = false
      index += 1
      while (index < text.length) {
        const current = text[index]
        const escaped = text[index + 1]
        if (current === '\\') {
          value += decodeEscapedCharacter(escaped)
          index += 2
          continue
        }
        if (quote === '`' && current === '$' && escaped === '{') interpolated = true
        if (current === quote) {
          index += 1
          break
        }
        value += current
        index += 1
      }
      tokens.push({ type: 'literal', value: interpolated ? null : value })
      continue
    }
    if (/[A-Za-z_$]/u.test(char)) {
      const start = index
      index += 1
      while (index < text.length && /[A-Za-z0-9_$]/u.test(text[index])) index += 1
      tokens.push({ type: 'identifier', value: text.slice(start, index) })
      continue
    }
    if (/[0-9]/u.test(char)) {
      const start = index
      index += 1
      while (index < text.length && /[0-9.]/u.test(text[index])) index += 1
      tokens.push({ type: 'literal', value: text.slice(start, index) })
      continue
    }
    tokens.push({ type: 'punctuation', value: char })
    index += 1
  }
  return tokens
}

function decodeEscapedCharacter(value) {
  if (value === undefined) return ''
  return ({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v' }[value] || value)
}

function collectLiteralBindings(tokens) {
  const bindings = new Map()
  for (let index = 0; index < tokens.length - 3; index += 1) {
    if (!['const', 'let', 'var'].includes(tokens[index].value)) continue
    const name = tokens[index + 1]
    if (name?.type !== 'identifier' || tokens[index + 2]?.value !== '=') continue
    const value = resolveLiteralToken(tokens[index + 3], bindings)
    if (value !== null) bindings.set(name.value, value)
  }
  return bindings
}

function collectIndexedDbApiAliases(tokens) {
  const aliases = new Set(INDEXED_DB_API_ROOTS)
  let changed = true
  while (changed) {
    changed = false
    for (let index = 0; index < tokens.length - 3; index += 1) {
      if (!['const', 'let', 'var'].includes(tokens[index].value)) continue
      const name = tokens[index + 1]
      const source = tokens[index + 3]
      if (name?.type !== 'identifier' || tokens[index + 2]?.value !== '=' || source?.type !== 'identifier') continue
      if (!aliases.has(source.value) || aliases.has(name.value)) continue
      aliases.add(name.value)
      changed = true
    }
  }
  return aliases
}

function literalBindingsByName(bindings, pattern) {
  return [...bindings.entries()]
    .filter(([name]) => pattern.test(name))
    .map(([, value]) => value)
}

function findCalls(tokens, method) {
  const calls = []
  for (let index = 0; index < tokens.length - 1; index += 1) {
    if (tokens[index].value !== method || tokens[index + 1].value !== '(') continue
    const close = matchingDelimiter(tokens, index + 1, '(', ')')
    if (close === null) continue
    calls.push({ index, open: index + 1, close, args: splitArguments(tokens, index + 1, close) })
    index = close
  }
  return calls
}

function matchingDelimiter(tokens, open, opening, closing) {
  let depth = 0
  for (let index = open; index < tokens.length; index += 1) {
    if (tokens[index].value === opening) depth += 1
    if (tokens[index].value === closing) {
      depth -= 1
      if (depth === 0) return index
    }
  }
  return null
}

function splitArguments(tokens, open, close) {
  const args = []
  let start = open + 1
  let depth = 0
  for (let index = start; index < close; index += 1) {
    if (['(', '[', '{'].includes(tokens[index].value)) depth += 1
    if ([')', ']', '}'].includes(tokens[index].value)) depth -= 1
    if (tokens[index].value === ',' && depth === 0) {
      args.push(tokens.slice(start, index))
      start = index + 1
    }
  }
  if (start < close) args.push(tokens.slice(start, close))
  return args
}

function resolveLiteralToken(token, bindings) {
  if (!token) return null
  if (token.type === 'literal') return token.value
  if (token.type === 'identifier' && bindings.has(token.value)) return bindings.get(token.value)
  return null
}

function firstResolvedLiteral(argument, bindings) {
  if (!Array.isArray(argument)) return null
  for (const token of argument) {
    const value = resolveLiteralToken(token, bindings)
    if (value !== null) return value
  }
  return null
}

function keyPathFromArgument(argument, bindings) {
  if (!Array.isArray(argument)) return null
  for (let index = 0; index < argument.length; index += 1) {
    if (argument[index].value !== 'keyPath') continue
    return literalAfterProperty(argument, index, bindings)
  }
  return null
}

function keyPathAfterObjectStoreCall(tokens, call, bindings) {
  const propertyIndex = call.close + 2
  if (tokens[call.close + 1]?.value !== '.' || tokens[propertyIndex]?.value !== 'keyPath') return null
  return literalAfterProperty(tokens, propertyIndex, bindings)
}

function literalAfterProperty(tokens, index, bindings) {
  for (let offset = 1; offset <= 5 && index + offset < tokens.length; offset += 1) {
    const token = tokens[index + offset]
    if (token.value === ';' || token.value === ',' || token.value === '}') break
    const value = resolveLiteralToken(token, bindings)
    if (value !== null) return value
  }
  return null
}

function operationSignature(method, call, bindings, includeKeyPath = false) {
  const target = firstResolvedLiteral(call.args[0], bindings) || '<dynamic>'
  const keyPath = includeKeyPath ? keyPathFromArgument(call.args[1], bindings) : null
  return `${method}:${target}${keyPath ? `:keyPath=${keyPath}` : ''}`
}

function rebuildOperations(tokens, bindings) {
  const operations = []
  for (const method of ['rebuildDatabase', 'recreateDatabase', 'rebuildStore', 'recreateStore', 'rebuildSchema', 'recreateSchema']) {
    for (const call of findCalls(tokens, method)) {
      operations.push(operationSignature(method, call, bindings))
    }
  }
  return operations
}

function objectStoreClearOperations(tokens, objectStoreCalls, bindings) {
  const aliases = collectObjectStoreAliases(tokens, objectStoreCalls, bindings)
  const operations = []
  for (const call of objectStoreCalls) {
    const target = firstResolvedLiteral(call.args[0], bindings) || '<dynamic>'
    if (tokens[call.close + 1]?.value === '.' && tokens[call.close + 2]?.value === 'clear') {
      operations.push(`clearObjectStore:${target}`)
    }
  }
  for (const call of findCalls(tokens, 'clear')) {
    const receiver = tokens[call.index - 2]
    if (tokens[call.index - 1]?.value !== '.' || receiver?.type !== 'identifier') continue
    const target = aliases.get(receiver.value)
    if (target) operations.push(`clearObjectStore:${target}`)
  }
  return operations
}

function collectObjectStoreAliases(tokens, objectStoreCalls, bindings) {
  const aliases = new Map()
  for (const call of objectStoreCalls) {
    const alias = assignedIdentifierBefore(tokens, call.index)
    if (alias) aliases.set(alias, firstResolvedLiteral(call.args[0], bindings) || '<dynamic>')
  }
  return aliases
}

function isIndexedDbObjectStoreCall(tokens, call) {
  const receiver = tokens[call.index - 2]
  if (receiver?.type === 'identifier' && /transaction$/iu.test(receiver.value)) return true
  if (receiver?.value !== ')') return false
  for (let cursor = call.index - 3; cursor >= 0 && call.index - cursor <= 20; cursor -= 1) {
    if ([';', '{', '}'].includes(tokens[cursor].value)) break
    if (tokens[cursor].value === 'transaction' && tokens[cursor + 1]?.value === '(') return true
  }
  return false
}

function isIndexedDbApiMethodCall(tokens, call, indexedDbApiAliases) {
  const receiver = tokens[call.index - 2]
  return tokens[call.index - 1]?.value === '.'
    && receiver?.type === 'identifier'
    && indexedDbApiAliases.has(receiver.value)
}

function assignedIdentifierBefore(tokens, index) {
  for (let cursor = index - 1; cursor >= 0 && index - cursor <= 12; cursor -= 1) {
    if ([';', '{', '}'].includes(tokens[cursor].value)) break
    if (tokens[cursor].value === '=' && tokens[cursor - 1]?.type === 'identifier') {
      return tokens[cursor - 1].value
    }
  }
  return null
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
