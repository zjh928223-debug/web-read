import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const architectureRoot = path.join(repositoryRoot, 'docs', 'architecture', 'windows-local-owner-thin-reader')
const checklistPath = path.join(architectureRoot, 'cross-machine-acceptance-checklist.md')
const schemaPath = path.join(architectureRoot, 'cross-machine-acceptance-evidence.v1.schema.json')
const templatePath = path.join(architectureRoot, 'cross-machine-acceptance-evidence.template.json')
const journeyIds = [
  'health',
  'owner-query',
  'local-capability',
  'external-capability',
  'workflow-polling',
  'media-range',
  'media-seek-switch',
  'windows-restart',
  'mac-reconnect',
]
const requiredJourneyTokens = new Map([
  ['health', ['/api/health', 'read-web-local-app-health.v1', '5184']],
  ['owner-query', ['/api/app/owner', 'query', 'contractVersion', 'revision']],
  ['local-capability', ['capability-query', 'capability', 'profile.capability-query']],
  ['external-capability', ['job-start', 'idempotency', 'receipt', 'external']],
  ['workflow-polling', ['polling', 'stale', 'immutable']],
  ['media-range', ['audio', 'video', '206', 'content-range', 'accept-ranges', 'etag']],
  ['media-seek-switch', ['seek', 'switch', 'range', 'etag']],
  ['windows-restart', ['restart', 'revision', 'receipt', 'reconnect']],
  ['mac-reconnect', ['reconnect', 'idempotency', 'same origin', 'relative']],
])
const minimumEvidenceKinds = new Map([
  ['health', ['http-log', 'browser-network']],
  ['owner-query', ['http-log', 'owner-log']],
  ['local-capability', ['http-log', 'command-output']],
  ['external-capability', ['http-log', 'owner-log', 'command-output']],
  ['workflow-polling', ['browser-network', 'http-log', 'owner-log']],
  ['media-range', ['media-headers', 'browser-network']],
  ['media-seek-switch', ['browser-network']],
  ['windows-restart', ['command-output', 'owner-log']],
  ['mac-reconnect', ['browser-network', 'command-output']],
])
const statusValues = ['PASS', 'FAIL', 'BLOCKED', 'NOT_RUN']
const evidenceKinds = [
  'http-log',
  'browser-network',
  'browser-console',
  'owner-log',
  'media-headers',
  'screenshot',
  'manual-note',
  'command-output',
]
const placeholderPattern = /REPLACE_WITH|<[^>]+>|\b(?:example|sample|fixture|placeholder)\b/iu

const checklist = await readText(checklistPath)
const schema = await readJson(schemaPath)
const template = await readJson(templatePath)

validateScaffold(checklist, schema, template)
await validateManifest(template, { template: true })

if (process.argv.includes('--self-test')) await runEvidenceReferenceSelfTest()

const evidenceOption = readOption('--evidence')
if (evidenceOption) {
  const manifest = await readJson(path.resolve(repositoryRoot, evidenceOption))
  await validateManifest(manifest, { template: false })
  console.log(
    'windows cross-machine acceptance evidence structure passed '
      + '(' + evidenceOption + '; live behavior still requires independent review)',
  )
} else {
  console.log(
    'windows cross-machine acceptance scaffold passed '
      + '(schema v1, 9 journeys, template remains NOT_RUN; no live service or network was started)',
  )
}

async function readText(filename) {
  return readFile(filename, 'utf8')
}

async function readJson(filename) {
  return JSON.parse(await readText(filename))
}

function readOption(name) {
  const index = process.argv.indexOf(name)
  if (index === -1) return null
  const value = process.argv[index + 1]
  assert(value && !value.startsWith('-'), name + ' requires a path')
  return value
}

function validateScaffold(checklistText, evidenceSchema, evidenceTemplate) {
  assert(checklistText.includes('E-004'), 'acceptance checklist must identify E-004')
  for (const token of [
    'production',
    'remote-dev',
    'HMR',
    '5184',
    '8776',
    'E:\\ReadWebData\\SubtitleWorkflow-Optimization',
    'Range',
    'ETag',
    'revision',
    'idempotency',
    'receipt',
    'Windows restart',
    'Mac reconnect',
    ...statusValues,
  ]) {
    assert(
      checklistText.toLowerCase().includes(token.toLowerCase()),
      'checklist is missing required coverage: ' + token,
    )
  }
  assert(
    checklistText.includes('Windows 是重任务、凭据、媒体和持久数据 owner'),
    'checklist must state Windows owner boundary',
  )
  assert(checklistText.includes('不能直连'), 'checklist must reject direct internal service access')
  assert(checklistText.includes('不得把'), 'checklist must reject placeholder pass claims')
  assert.deepEqual(evidenceSchema.$defs?.status?.enum, statusValues, 'evidence schema status set changed')
  assert.deepEqual(
    [...(evidenceSchema.$defs?.journey?.properties?.id?.enum || [])].sort(),
    [...journeyIds].sort(),
    'evidence schema journey set changed',
  )
  assert.equal(
    evidenceSchema.properties?.journeys?.maxItems,
    journeyIds.length,
    'evidence schema journey count changed',
  )
  assert.equal(evidenceSchema.$defs?.environment?.properties?.frontendPort?.const, 5184)
  assert.equal(evidenceSchema.$defs?.environment?.properties?.capabilitySidecarPort?.const, 8776)
  assert.equal(
    evidenceSchema.$defs?.environment?.properties?.dataRoot?.const,
    'E:\\ReadWebData\\SubtitleWorkflow-Optimization',
  )
  assert.equal(evidenceTemplate.$schema, 'cross-machine-acceptance-evidence.v1.schema.json')
}

async function validateManifest(manifest, { template }) {
  assertObject(manifest, 'evidence manifest')
  assert.equal(manifest.schemaVersion, 1, 'evidence manifest schema version changed')
  assert.equal(
    manifest.artifactKind,
    template
      ? 'cross-machine-acceptance-evidence-template'
      : 'cross-machine-acceptance-evidence',
    'unexpected evidence artifact kind',
  )
  assertObject(manifest.run, 'evidence manifest run')
  assertNonEmptyString(manifest.run.runId, 'evidence run id')
  assert(['production', 'remote-dev'].includes(manifest.run.mode), 'evidence run mode is invalid')
  assert(['RECORDED', 'NOT_RUN'].includes(manifest.run.status), 'evidence run status is invalid')
  assertRelativePath(manifest.run.evidenceRoot, 'evidence root')
  validateEnvironment(manifest.run.environment, { template })

  assert(Array.isArray(manifest.journeys), 'evidence journey list is missing')
  assert.equal(manifest.journeys.length, journeyIds.length, 'evidence journey count must cover all E-004 paths')
  const ids = manifest.journeys.map((journey) => journey?.id)
  assert.equal(new Set(ids).size, journeyIds.length, 'evidence journey ids must be unique')
  assert.deepEqual([...ids].sort(), [...journeyIds].sort(), 'evidence journey set is incomplete or has extras')

  let evidenceRoot = null
  if (!template) {
    assert.equal(manifest.run.status, 'RECORDED', 'real evidence manifest must be RECORDED')
    assertNonEmptyString(manifest.run.capturedAt, 'real evidence capturedAt')
    assertNonEmptyString(manifest.run.operator, 'real evidence operator')
    assertNoPlaceholder(JSON.stringify(manifest.run), 'real evidence run')
    evidenceRoot = await resolveEvidenceRoot(manifest.run.evidenceRoot)
  }

  for (const journey of manifest.journeys) {
    await validateJourney(journey, { template, evidenceRoot })
  }

  if (template) {
    assert.equal(manifest.run.status, 'NOT_RUN', 'template run status must remain NOT_RUN')
    assert.equal(manifest.run.capturedAt, null, 'template cannot contain a capture timestamp')
    assert.equal(manifest.run.operator, null, 'template cannot contain an operator')
    assert(manifest.run.runId.includes('REPLACE_WITH'), 'template run id must remain an explicit placeholder')
    assert(manifest.run.evidenceRoot.includes('<run-id>'), 'template evidence root must remain an explicit placeholder')
  }
}

function validateEnvironment(environment, { template }) {
  assertObject(environment, 'evidence environment')
  assert.equal(environment.profile, 'optimization', 'evidence must use the optimization profile')
  assert.equal(environment.frontendPort, 5184, 'evidence stable front door port changed')
  assert.equal(environment.capabilitySidecarPort, 8776, 'evidence capability sidecar port changed')
  assert.equal(environment.dataRoot, 'E:\\ReadWebData\\SubtitleWorkflow-Optimization')
  assert.equal(environment.windowsHostRole, 'heavy-work-and-data-owner')
  assert(['production-browser', 'remote-dev-vite'].includes(environment.macRole), 'evidence Mac role is invalid')
  assert.equal(environment.internalServicesLoopback, true)
  assert.equal(environment.dailyIsolationVerified, true)
  assertNonEmptyString(environment.frontDoorOrigin, 'evidence front door origin')
  if (!template) assertNoPlaceholder(environment.frontDoorOrigin, 'evidence front door origin')
}

async function validateJourney(journey, { template, evidenceRoot }) {
  assertObject(journey, 'journey')
  assert(journeyIds.includes(journey.id), 'unknown journey id: ' + String(journey.id))
  assertNonEmptyString(journey.name, journey.id + ' name')
  assert(statusValues.includes(journey.status), journey.id + ' has an invalid status')
  assertStringArray(journey.preconditions, journey.id + ' preconditions', true)
  assertStringArray(journey.actions, journey.id + ' actions', true)
  assertObject(journey.expected, journey.id + ' expected evidence')
  for (const field of ['http', 'contract', 'owner', 'media']) {
    assertStringArray(journey.expected[field], journey.id + ' expected.' + field)
  }
  assertObject(journey.failure, journey.id + ' failure')
  assertNonEmptyString(journey.failure.classification, journey.id + ' failure classification')
  assertNonEmptyString(journey.failure.observation, journey.id + ' failure observation')
  assertObject(journey.recovery, journey.id + ' recovery')
  assertStringArray(journey.recovery.retry, journey.id + ' recovery.retry', true)
  assertStringArray(journey.recovery.rollback, journey.id + ' recovery.rollback', true)
  assertObject(journey.evidence, journey.id + ' evidence')
  assert(Array.isArray(journey.evidence.refs), journey.id + ' evidence refs are missing')

  const journeyText = [
    journey.name,
    ...journey.preconditions,
    ...journey.actions,
    ...journey.expected.http,
    ...journey.expected.contract,
    ...journey.expected.owner,
    ...journey.expected.media,
    journey.failure.observation,
    ...journey.recovery.retry,
    ...journey.recovery.rollback,
    journey.evidence.notes || '',
  ].join(' ').toLowerCase()
  for (const token of requiredJourneyTokens.get(journey.id)) {
    assert(journeyText.includes(token.toLowerCase()), journey.id + ' is missing required coverage: ' + token)
  }

  if (template) {
    assert.equal(journey.status, 'NOT_RUN', journey.id + ' template status must remain NOT_RUN')
    assert.equal(journey.evidence.refs.length, 0, journey.id + ' template must not contain evidence refs')
    return
  }

  const evidenceRecords = []
  for (const ref of journey.evidence.refs) {
    validateEvidenceRefShape(ref, journey.id)
    evidenceRecords.push(await loadEvidenceRef(ref, evidenceRoot, journey.id))
  }

  if (journey.status === 'PASS') {
    assert.equal(journey.failure.classification, 'none', journey.id + ' PASS must not carry a failure classification')
    assertMinimumEvidence(journey.id, evidenceRecords)
  } else if (journey.status === 'FAIL') {
    assert(evidenceRecords.length > 0, journey.id + ' FAIL requires evidence refs')
    assert.notEqual(journey.failure.classification, 'none', journey.id + ' FAIL needs a failure classification')
  } else if (journey.status === 'BLOCKED') {
    assertNonEmptyString(journey.failure.blocker, journey.id + ' BLOCKED blocker')
    assert.notEqual(journey.failure.classification, 'none', journey.id + ' BLOCKED needs a blocker classification')
  }
}

function validateEvidenceRefShape(ref, journeyId) {
  assertObject(ref, journeyId + ' evidence ref')
  assert(evidenceKinds.includes(ref.kind), journeyId + ' evidence ref kind is invalid')
  assertRelativePath(ref.path, journeyId + ' evidence ref path')
  assertNoPlaceholder(ref.path, journeyId + ' evidence ref path')
  assertNonEmptyString(ref.description, journeyId + ' evidence ref description')
  if (ref.sha256 !== undefined) {
    assert(/^sha256:[a-f0-9]{64}$/u.test(ref.sha256), journeyId + ' evidence ref checksum is invalid')
  }
}

async function resolveEvidenceRoot(value) {
  assertRelativePath(value, 'evidence root')
  assertNoPlaceholder(value, 'evidence root')
  const candidate = path.resolve(repositoryRoot, value)
  assertWithin(repositoryRoot, candidate, 'evidence root')
  const resolved = await realpath(candidate).catch(() => null)
  assert(resolved, 'evidence root does not exist: ' + value)
  assertWithin(repositoryRoot, resolved, 'evidence root')
  assert((await stat(resolved)).isDirectory(), 'evidence root must be a directory: ' + value)
  return resolved
}

async function loadEvidenceRef(ref, evidenceRoot, journeyId) {
  const candidate = path.resolve(evidenceRoot, ref.path)
  assertWithin(evidenceRoot, candidate, journeyId + ' evidence ref')
  const resolved = await realpath(candidate).catch(() => null)
  assert(resolved, journeyId + ' evidence file does not exist: ' + ref.path)
  assertWithin(evidenceRoot, resolved, journeyId + ' evidence ref')
  const fileStat = await stat(resolved)
  assert(fileStat.isFile(), journeyId + ' evidence ref must be a regular file: ' + ref.path)
  assert(fileStat.size > 0, journeyId + ' evidence file is empty: ' + ref.path)
  const bytes = await readFile(resolved)
  if (ref.sha256) {
    const actual = 'sha256:' + createHash('sha256').update(bytes).digest('hex')
    assert.equal(actual, ref.sha256, journeyId + ' evidence checksum mismatch: ' + ref.path)
  }
  return { kind: ref.kind, path: resolved }
}

function assertMinimumEvidence(journeyId, records) {
  const allowed = minimumEvidenceKinds.get(journeyId)
  assert(records.length > 0, journeyId + ' PASS requires evidence refs')
  assert(
    records.some((record) => allowed.includes(record.kind)),
    journeyId + ' PASS requires at least one matching non-manual evidence kind: ' + allowed.join(', '),
  )
}

function assertObject(value, label) {
  assert(value && typeof value === 'object' && !Array.isArray(value), label + ' must be an object')
}

function assertNonEmptyString(value, label) {
  assert(typeof value === 'string' && value.trim().length > 0, label + ' is missing')
}

function assertStringArray(value, label, requireItem = false) {
  assert(Array.isArray(value), label + ' must be an array')
  if (requireItem) assert(value.length > 0, label + ' must not be empty')
  assert(value.every((item) => typeof item === 'string' && item.length > 0), label + ' contains an invalid item')
}

function assertRelativePath(value, label) {
  assertNonEmptyString(value, label)
  assert(!path.isAbsolute(value), label + ' must be relative')
  assert(!/^[A-Za-z]:[\\/]/u.test(value), label + ' must not be an absolute drive path')
  assert(!value.split(/[\\/]/u).includes('..'), label + ' must not escape its root')
}

function assertNoPlaceholder(value, label) {
  assert(!placeholderPattern.test(value), label + ' contains a placeholder')
}

function assertWithin(root, candidate, label) {
  const relative = path.relative(root, candidate)
  assert(relative && !relative.startsWith('..') && !path.isAbsolute(relative), label + ' escapes its root')
}

async function runEvidenceReferenceSelfTest() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'read-web-e004-'))
  try {
    await writeFile(path.join(root, 'health.log'), 'status=200\n', 'utf8')
    const validRef = { kind: 'http-log', path: 'health.log', description: 'health response' }
    validateEvidenceRefShape(validRef, 'health')
    const record = await loadEvidenceRef(validRef, root, 'health')
    assertMinimumEvidence('health', [record])
    await assert.rejects(
      loadEvidenceRef({ ...validRef, path: 'missing.log' }, root, 'health'),
      /does not exist/u,
    )
    assert.throws(
      () => validateEvidenceRefShape({ ...validRef, path: '../outside.log' }, 'health'),
      /must not escape/u,
    )
    assert.throws(
      () => validateEvidenceRefShape({ ...validRef, path: 'REPLACE_WITH.log' }, 'health'),
      /placeholder/u,
    )
    assert.throws(
      () => assertMinimumEvidence('health', [{ kind: 'manual-note', path: 'note.txt' }]),
      /matching non-manual evidence kind/u,
    )
    console.log('windows cross-machine acceptance evidence-reference self-test passed')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}
