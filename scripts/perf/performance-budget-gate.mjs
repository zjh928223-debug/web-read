import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const configPath = path.resolve(process.env.READ_WEB_PERF_BUDGETS || path.join(repoRoot, 'config', 'performance-budgets.json'))
const artifactPath = path.resolve(process.env.READ_WEB_PERF_ARTIFACT || path.join(repoRoot, 'output', 'performance', 'browser-journeys.json'))
const outputPath = path.resolve(process.env.READ_WEB_PERF_DIFF_OUTPUT || path.join(path.dirname(artifactPath), 'browser-budget-diff.json'))

const config = JSON.parse(await fs.readFile(configPath, 'utf8'))
const artifact = JSON.parse(await fs.readFile(artifactPath, 'utf8'))
const failures = []
const results = []
const expectedJourneys = config.releaseGate?.candidate?.journeys || []

if (config.status !== 'active') failures.push('performance budget status must be active for release enforcement')
if (artifact.schema !== 'read-web.browser-performance-journeys' || artifact.schemaVersion !== 2) failures.push('unsupported browser journey artifact')
if (artifact.errors?.length) failures.push(`journey artifact contains ${artifact.errors.length} error(s)`)
if (artifact.journeys?.some((journey) => journey.status !== 'passed')) failures.push('not every requested journey passed')
if (artifact.fixture?.schema !== config.releaseGate?.candidate?.fixture?.schema
  || artifact.fixture?.version !== config.releaseGate?.candidate?.fixture?.version) {
  failures.push(`candidate fixture must be ${config.releaseGate?.candidate?.fixture?.schema} v${config.releaseGate?.candidate?.fixture?.version}`)
}
if (artifact.runCount !== config.releaseGate?.candidate?.runCount) failures.push(`candidate runCount must be ${config.releaseGate?.candidate?.runCount}`)
if (!sameSet(artifact.requestedJourneys, expectedJourneys)) failures.push('candidate requested journey set does not match the release contract')
if (artifact.provenance?.hostKind !== 'local-app-host' || artifact.provenance?.distMode !== 'built-dist' || artifact.provenance?.independentBaseUrls !== true) {
  failures.push('candidate must contain independent Local App Host runs over built dist assets')
}
const seenBaseUrls = new Set()
const seenInstanceIds = new Set()
for (let run = 1; run <= Number(artifact.runCount || 0); run += 1) {
  const runJourneys = (artifact.journeys || []).filter((journey) => journey.run === run)
  if (!sameSet(runJourneys.map((journey) => journey.name), expectedJourneys) || runJourneys.length !== expectedJourneys.length) {
    failures.push(`candidate run ${run} does not contain each required journey exactly once`)
  }
  const runArtifact = (artifact.runArtifacts || []).filter((entry) => entry.run === run)
  if (runArtifact.length !== 1 || runArtifact[0].summary?.requestedJourneys !== expectedJourneys.length || runArtifact[0].summary?.passedJourneys !== expectedJourneys.length || runArtifact[0].summary?.errorCount !== 0) {
    failures.push(`candidate run ${run} summary is incomplete or inconsistent`)
  }
  const provenance = runArtifact[0]?.provenance
  if (!isProductionHostProvenance(provenance)) failures.push(`candidate run ${run} lacks verified Local App Host provenance`)
  else if (seenBaseUrls.has(provenance.baseUrl)) failures.push(`candidate run ${run} reused a previous host address`)
  else if (seenInstanceIds.has(provenance.instanceId)) failures.push(`candidate run ${run} reused a previous host instance identity`)
  else {
    seenBaseUrls.add(provenance.baseUrl)
    seenInstanceIds.add(provenance.instanceId)
  }
  for (const evidenceType of ['json', 'trace', 'screenshot']) {
    const evidencePath = runArtifact[0]?.evidence?.[evidenceType]
    if (typeof evidencePath !== 'string' || evidencePath.length === 0) failures.push(`candidate run ${run} lacks ${evidenceType} evidence`)
    else {
      try {
        await fs.access(path.resolve(path.dirname(artifactPath), evidencePath))
      } catch {
        failures.push(`candidate run ${run} ${evidenceType} evidence is missing on disk`)
      }
    }
  }
}

for (const budget of config.releaseGate?.browser || []) {
  const values = selectValues(artifact, budget)
  const actual = statistic(values, budget.statistic)
  const sampleCount = values.length
  const passed = sampleCount >= budget.minimumSamples && Number.isFinite(actual) && actual <= budget.limit
  results.push({ id: budget.id, statistic: budget.statistic, sampleCount, minimumSamples: budget.minimumSamples, actual, limit: budget.limit, unit: budget.unit, passed })
  if (!passed) failures.push(`${budget.id}: ${sampleCount} sample(s), ${budget.statistic}=${actual}, limit=${budget.limit}, minimumSamples=${budget.minimumSamples}`)
}

const diff = {
  schema: 'read-web.performance-budget-diff',
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  baseline: { id: config.baseline.id, capturedAt: config.baseline.capturedAt, sampleRuns: config.baseline.sampleRuns },
  candidate: { path: path.relative(repoRoot, artifactPath), capturedAt: artifact.capturedAt, fixture: artifact.fixture },
  results,
  passed: failures.length === 0,
  failures,
}
await fs.mkdir(path.dirname(outputPath), { recursive: true })
await fs.writeFile(outputPath, `${JSON.stringify(diff, null, 2)}\n`, 'utf8')
console.log(`Performance budget diff: ${outputPath}`)
for (const result of results) console.log(`${result.passed ? 'PASS' : 'FAIL'} ${result.id}: ${result.actual} <= ${result.limit} (${result.sampleCount} samples)`)
if (failures.length) {
  for (const failure of failures) console.error(`- ${failure}`)
  process.exitCode = 1
}

function selectValues(candidate, budget) {
  if (budget.source === 'measures') return (candidate.measures || []).filter((item) => !budget.name || item.name === budget.name).map((item) => Number(item.durationMs)).filter(Number.isFinite)
  if (budget.source === 'samples') return (candidate.samples || []).filter((item) => !budget.name || item.name === budget.name).map((item) => Number(item.durationMs)).filter(Number.isFinite)
  if (budget.source === 'longTasks') return (candidate.longTasks || []).map((item) => Number(item.duration)).filter(Number.isFinite)
  if (budget.source === 'summary') return [Number(candidate.summary?.[budget.name])].filter(Number.isFinite)
  return []
}

function statistic(values, name) {
  if (!values.length) return null
  if (name === 'max') return Math.max(...values)
  if (name === 'count') return values.length
  const quantile = name === 'p50' ? 0.5 : name === 'p95' ? 0.95 : null
  if (!quantile) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * quantile) - 1)]
}

function sameSet(actual, expected) {
  if (!Array.isArray(actual) || !Array.isArray(expected) || actual.length !== expected.length) return false
  return new Set(actual).size === actual.length && [...actual].sort().every((value, index) => value === [...expected].sort()[index])
}

function isProductionHostProvenance(value) {
  if (!value || value.hostKind !== 'local-app-host' || value.distMode !== 'built-dist') return false
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(value.baseUrl || '')) return false
  for (const key of ['releaseId', 'profileId', 'instanceId', 'manifestSha256', 'manifestGitSha']) {
    if (typeof value[key] !== 'string' || value[key].length === 0) return false
  }
  return Number.isInteger(value.configSchemaVersion) && value.configSchemaVersion > 0
}
