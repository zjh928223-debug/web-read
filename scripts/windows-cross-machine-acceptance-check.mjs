import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const architectureRoot = path.join(
  repositoryRoot,
  'docs',
  'architecture',
  'windows-local-owner-thin-reader',
)
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

const checklist = await readText(checklistPath)
const schema = await readJson(schemaPath)
const template = await readJson(templatePath)

assert(checklist.includes('E-004'), 'acceptance checklist must identify E-004')
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
  'PASS',
  'FAIL',
  'BLOCKED',
  'NOT_RUN',
]) {
  assert(checklist.toLowerCase().includes(token.toLowerCase()), 'checklist is missing required coverage: ' + token)
}
assert(checklist.includes('Windows 是重任务、凭据、媒体和持久数据 owner'), 'checklist must state Windows owner boundary')
assert(checklist.includes('不能直连'), 'checklist must reject direct internal service access')
assert(checklist.includes('不得把'), 'checklist must reject placeholder pass claims')
assert(schema.$defs?.status?.enum && JSON.stringify(schema.$defs.status.enum) === JSON.stringify(statusValues), 'evidence schema status set changed')
assert(
  schema.$defs?.journey?.properties?.id?.enum
    && JSON.stringify([...schema.$defs.journey.properties.id.enum].sort()) === JSON.stringify([...journeyIds].sort()),
  'evidence schema journey set changed',
)
assert(schema.properties?.journeys?.maxItems === journeyIds.length, 'evidence schema journey count changed')
for (const field of ['preconditions', 'actions', 'expected', 'failure', 'recovery', 'evidence']) {
  assert(schema.$defs?.journey?.required?.includes(field), 'evidence schema journey is missing ' + field)
}
for (const field of ['http', 'contract', 'owner', 'media']) {
  assert(schema.$defs?.expected?.required?.includes(field), 'evidence schema expected evidence is missing ' + field)
}
for (const field of ['retry', 'rollback']) {
  assert(schema.$defs?.recovery?.required?.includes(field), 'evidence schema recovery is missing ' + field)
}
assert(schema.$defs?.evidence?.required?.includes('refs'), 'evidence schema refs are missing')
assert(schema.$defs?.evidenceRef?.required?.includes('path'), 'evidence schema evidence path is missing')
assert(schema.$defs?.evidenceRef?.properties?.path, 'evidence schema must require evidence locations')
assert(schema.$defs?.environment?.properties?.frontendPort?.const === 5184, 'evidence schema frontend port changed')
assert(schema.$defs?.environment?.properties?.capabilitySidecarPort?.const === 8776, 'evidence schema sidecar port changed')
assert(schema.$defs?.environment?.properties?.dataRoot?.const === 'E:\\ReadWebData\\SubtitleWorkflow-Optimization', 'evidence schema data root changed')
assert(template.$schema === 'cross-machine-acceptance-evidence.v1.schema.json', 'evidence template schema reference changed')

validateManifest(template, { template: true })

const evidencePath = readOption('--evidence')
if (evidencePath) {
  const manifest = await readJson(path.resolve(repositoryRoot, evidencePath))
  validateManifest(manifest, { template: false })
  console.log('windows cross-machine acceptance evidence passed (' + evidencePath + '; statuses are recorded with evidence refs)')
} else {
  console.log('windows cross-machine acceptance scaffold passed (schema v1, 9 journeys, template remains NOT_RUN; no live service or network was started)')
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
  assert(value && !value.startsWith('-'), name + ' requires a manifest path')
  return value
}

function validateManifest(manifest, { template }) {
  assert(manifest && typeof manifest === 'object' && !Array.isArray(manifest), 'evidence manifest must be an object')
  assert.equal(manifest.schemaVersion, 1, 'evidence manifest schema version changed')
  assert(
    manifest.artifactKind === (template ? 'cross-machine-acceptance-evidence-template' : 'cross-machine-acceptance-evidence'),
    'unexpected evidence artifact kind: ' + String(manifest.artifactKind),
  )
  assert(manifest.run && typeof manifest.run === 'object' && !Array.isArray(manifest.run), 'evidence manifest run is missing')
  assert(typeof manifest.run.runId === 'string' && manifest.run.runId.length > 0, 'evidence run id is missing')
  assert(['production', 'remote-dev'].includes(manifest.run.mode), 'evidence run mode is invalid')
  assert(['RECORDED', 'NOT_RUN'].includes(manifest.run.status), 'evidence run status is invalid')
  assert(typeof manifest.run.evidenceRoot === 'string' && manifest.run.evidenceRoot.length > 0, 'evidence root is missing')
  assertRelativePath(manifest.run.evidenceRoot, 'evidence root')
  validateEnvironment(manifest.run.environment)
  assert(Array.isArray(manifest.journeys), 'evidence journey list is missing')
  assert.equal(manifest.journeys.length, journeyIds.length, 'evidence journey count must cover all E-004 paths')

  const ids = manifest.journeys.map((journey) => journey?.id)
  assert.equal(new Set(ids).size, journeyIds.length, 'evidence journey ids must be unique')
  assert.deepEqual([...ids].sort(), [...journeyIds].sort(), 'evidence journey set is incomplete or has extras')

  for (const journey of manifest.journeys) {
    validateJourney(journey)
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
      assert(journeyText.includes(token.toLowerCase()), journey.id + ' is missing required evidence coverage: ' + token)
    }

    const refs = journey.evidence.refs
    if (template) {
      assert.equal(journey.status, 'NOT_RUN', journey.id + ' template status must remain NOT_RUN')
      assert.equal(refs.length, 0, journey.id + ' template must not contain evidence refs')
    } else if (journey.status === 'PASS') {
      assert(refs.length > 0, journey.id + ' PASS requires actual evidence refs')
      assert.equal(journey.failure.classification, 'none', journey.id + ' PASS must not carry a failure classification')
    } else if (journey.status === 'FAIL') {
      assert(refs.length > 0, journey.id + ' FAIL requires failure evidence refs')
      assert.notEqual(journey.failure.classification, 'none', journey.id + ' FAIL needs a failure classification')
    } else if (journey.status === 'BLOCKED') {
      assert(typeof journey.failure.blocker === 'string' && journey.failure.blocker.length > 0, journey.id + ' BLOCKED requires a blocker')
      assert.notEqual(journey.failure.classification, 'none', journey.id + ' BLOCKED needs a blocker classification')
    }
  }

  if (template) {
    assert.equal(manifest.run.status, 'NOT_RUN', 'template run status must remain NOT_RUN')
    assert.equal(manifest.run.capturedAt, null, 'template cannot contain a capture timestamp')
    assert.equal(manifest.run.operator, null, 'template cannot contain an operator')
    assert(manifest.run.runId.includes('REPLACE_WITH'), 'template run id must remain an explicit placeholder')
    assert(manifest.run.evidenceRoot.includes('<run-id>'), 'template evidence root must remain an explicit placeholder')
  } else {
    assert.equal(manifest.run.status, 'RECORDED', 'real evidence manifest must be RECORDED')
    assert(typeof manifest.run.capturedAt === 'string' && manifest.run.capturedAt.length > 0, 'real evidence requires capturedAt')
    assert(typeof manifest.run.operator === 'string' && manifest.run.operator.length > 0, 'real evidence requires operator')
    assert(!JSON.stringify(manifest.run).includes('REPLACE_WITH'), 'real evidence cannot retain run placeholders')
    assert(!JSON.stringify(manifest.run).includes('<run-id>'), 'real evidence cannot retain path placeholders')
  }
}

function validateEnvironment(environment) {
  assert(environment && typeof environment === 'object' && !Array.isArray(environment), 'evidence environment is missing')
  assert.equal(environment.profile, 'optimization', 'evidence must use the optimization profile')
  assert.equal(environment.frontendPort, 5184, 'evidence stable front door port changed')
  assert.equal(environment.capabilitySidecarPort, 8776, 'evidence capability sidecar port changed')
  assert.equal(environment.dataRoot, 'E:\\ReadWebData\\SubtitleWorkflow-Optimization', 'evidence data root is not isolated')
  assert.equal(environment.windowsHostRole, 'heavy-work-and-data-owner', 'evidence must identify Windows as owner')
  assert(['production-browser', 'remote-dev-vite'].includes(environment.macRole), 'evidence Mac role is invalid')
  assert.equal(environment.internalServicesLoopback, true, 'evidence must confirm internal services are loopback')
  assert.equal(environment.dailyIsolationVerified, true, 'evidence must confirm daily isolation')
  assert(typeof environment.frontDoorOrigin === 'string' && environment.frontDoorOrigin.length > 0, 'evidence front door origin is missing')
}

function validateJourney(journey) {
  assert(journey && typeof journey === 'object' && !Array.isArray(journey), 'journey must be an object')
  assert(journeyIds.includes(journey.id), 'unknown journey id: ' + String(journey.id))
  assert(typeof journey.name === 'string' && journey.name.length > 0, journey.id + ' name is missing')
  assert(statusValues.includes(journey.status), journey.id + ' has an invalid status')
  for (const field of ['preconditions', 'actions']) {
    assert(Array.isArray(journey[field]) && journey[field].length > 0, journey.id + ' needs ' + field)
    assert(journey[field].every((item) => typeof item === 'string' && item.length > 0), journey.id + ' ' + field + ' contains an invalid item')
  }
  assert(journey.expected && typeof journey.expected === 'object', journey.id + ' expected evidence is missing')
  for (const field of ['http', 'contract', 'owner', 'media']) {
    assert(Array.isArray(journey.expected[field]), journey.id + ' expected.' + field + ' must be an array')
    assert(journey.expected[field].every((item) => typeof item === 'string' && item.length > 0), journey.id + ' expected.' + field + ' contains an invalid item')
  }
  assert(journey.failure && typeof journey.failure === 'object', journey.id + ' failure classification is missing')
  assert(typeof journey.failure.classification === 'string', journey.id + ' failure classification is invalid')
  assert(typeof journey.failure.observation === 'string' && journey.failure.observation.length > 0, journey.id + ' failure observation is missing')
  assert(journey.recovery && typeof journey.recovery === 'object', journey.id + ' recovery is missing')
  for (const field of ['retry', 'rollback']) {
    assert(Array.isArray(journey.recovery[field]) && journey.recovery[field].length > 0, journey.id + ' recovery.' + field + ' is missing')
  }
  assert(journey.evidence && typeof journey.evidence === 'object', journey.id + ' evidence is missing')
  assert(Array.isArray(journey.evidence.refs), journey.id + ' evidence refs are missing')
  for (const ref of journey.evidence.refs) {
    assert(evidenceKinds.includes(ref?.kind), journey.id + ' evidence ref kind is invalid')
    assert(typeof ref.path === 'string' && ref.path.length > 0, journey.id + ' evidence ref path is missing')
    assertRelativePath(ref.path, journey.id + ' evidence ref')
    assert(typeof ref.description === 'string' && ref.description.length > 0, journey.id + ' evidence ref description is missing')
    if (!template) {
      assert(!ref.path.includes('REPLACE_WITH') && !ref.path.includes('<run-id>'), journey.id + ' real evidence ref retains a placeholder path')
    }
    if (ref.sha256 !== undefined) assert(/^sha256:[a-f0-9]{64}$/u.test(ref.sha256), journey.id + ' evidence ref checksum is invalid')
  }
}

function assertRelativePath(value, label) {
  assert(!path.isAbsolute(value), label + ' must be relative')
  assert(!/^[A-Za-z]:[\\/]/u.test(value), label + ' must not be an absolute drive path')
  assert(!value.split(/[\\/]/u).includes('..'), label + ' must not escape its evidence root')
}
