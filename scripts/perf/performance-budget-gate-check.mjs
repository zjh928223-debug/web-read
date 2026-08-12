import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'read-web-budget-gate-'))
try {
  const config = path.join(root, 'budget.json')
  const artifact = path.join(root, 'artifact.json')
  const output = path.join(root, 'diff.json')
  const journeys = ['cold-start', 'material-open', 'play-pause-seek', 'continuous-word-chunk', 'material-workflow', 'passage-preview', 'srs-review']
  await fs.writeFile(config, JSON.stringify({ status: 'active', baseline: { id: 'fixture', capturedAt: '2026-08-12', sampleRuns: 3 }, releaseGate: { candidate: { fixture: { schema: 'fixture.v1', version: 1 }, runCount: 3, journeys }, browser: [{ id: 'open', source: 'measures', name: 'open', statistic: 'p95', unit: 'ms', minimumSamples: 3, limit: 120 }] } }))
  const provenance = (run) => ({ hostKind: 'local-app-host', distMode: 'built-dist', baseUrl: `http://127.0.0.1:${9000 + run}`, releaseId: 'release', profileId: 'profile', instanceId: `instance-${run}`, manifestSha256: 'abc', manifestGitSha: 'def', configSchemaVersion: 1 })
  const runArtifacts = []
  for (const run of [1, 2, 3]) {
    const evidenceDirectory = path.join(root, `run-${run}`)
    await fs.mkdir(evidenceDirectory, { recursive: true })
    const evidence = { json: `run-${run}/journeys.json`, trace: `run-${run}/trace.zip`, screenshot: `run-${run}/final.png` }
    await Promise.all(Object.values(evidence).map((relativePath) => fs.writeFile(path.join(root, relativePath), 'evidence')))
    runArtifacts.push({ run, summary: { requestedJourneys: 7, passedJourneys: 7, errorCount: 0 }, provenance: provenance(run), evidence })
  }
  const journeyRows = [1, 2, 3].flatMap((run) => journeys.map((name) => ({ run, name, status: 'passed' })))
  const passingArtifact = { schema: 'read-web.browser-performance-journeys', schemaVersion: 2, capturedAt: 'now', fixture: { schema: 'fixture.v1', version: 1 }, provenance: { hostKind: 'local-app-host', distMode: 'built-dist', independentBaseUrls: true }, runCount: 3, requestedJourneys: journeys, runArtifacts, errors: [], journeys: journeyRows, measures: [{ run: 1, name: 'open', durationMs: 70 }, { run: 2, name: 'open', durationMs: 80 }, { run: 3, name: 'open', durationMs: 90 }] }
  await fs.writeFile(artifact, JSON.stringify(passingArtifact))
  assert.equal(run(config, artifact, output).status, 0)
  const passing = JSON.parse(await fs.readFile(output, 'utf8'))
  assert.equal(passing.passed, true)
  assert.equal(passing.results[0].actual, 90)

  const wrongFixture = structuredClone(passingArtifact)
  wrongFixture.fixture.version = 2
  await fs.writeFile(artifact, JSON.stringify(wrongFixture))
  assert.notEqual(run(config, artifact, output).status, 0, 'fixture identity must match')

  const fakeRunCount = structuredClone(passingArtifact)
  fakeRunCount.runCount = 4
  await fs.writeFile(artifact, JSON.stringify(fakeRunCount))
  assert.notEqual(run(config, artifact, output).status, 0, 'runCount cannot be declared without matching runs')

  const missingJourney = structuredClone(passingArtifact)
  missingJourney.journeys = missingJourney.journeys.filter((entry) => !(entry.run === 2 && entry.name === 'srs-review'))
  await fs.writeFile(artifact, JSON.stringify(missingJourney))
  assert.notEqual(run(config, artifact, output).status, 0, 'each run must contain all seven journeys')

  const underSampled = structuredClone(passingArtifact)
  underSampled.measures.pop()
  await fs.writeFile(artifact, JSON.stringify(underSampled))
  assert.notEqual(run(config, artifact, output).status, 0, 'missing samples must fail closed')

  underSampled.measures.push({ name: 'open', durationMs: 180 })
  await fs.writeFile(artifact, JSON.stringify(underSampled))
  assert.notEqual(run(config, artifact, output).status, 0, 'regression above baseline-derived limit must fail')
  for (const runArtifact of underSampled.runArtifacts) {
    for (const relativePath of Object.values(runArtifact.evidence)) {
      await fs.access(path.join(root, relativePath))
    }
  }

  const devArtifact = structuredClone(passingArtifact)
  devArtifact.runArtifacts[0].provenance.hostKind = 'vite-dev'
  await fs.writeFile(artifact, JSON.stringify(devArtifact))
  assert.notEqual(run(config, artifact, output).status, 0, 'Vite dev evidence must not satisfy the production release gate')

  const reusedAddress = structuredClone(passingArtifact)
  reusedAddress.runArtifacts[1].provenance.baseUrl = reusedAddress.runArtifacts[0].provenance.baseUrl
  await fs.writeFile(artifact, JSON.stringify(reusedAddress))
  assert.notEqual(run(config, artifact, output).status, 0, 'each release sample must use an independent host address')

  const reusedInstance = structuredClone(passingArtifact)
  reusedInstance.runArtifacts[1].provenance.instanceId = reusedInstance.runArtifacts[0].provenance.instanceId
  await fs.writeFile(artifact, JSON.stringify(reusedInstance))
  assert.notEqual(run(config, artifact, output).status, 0, 'each release sample must use an independent host identity')
} finally {
  await fs.rm(root, { recursive: true, force: true })
}
console.log('performance budget gate check passed')

function run(config, artifact, output) {
  return spawnSync(process.execPath, [new URL('./performance-budget-gate.mjs', import.meta.url).pathname.replace(/^\/(.:)/, '$1')], {
    env: { ...process.env, READ_WEB_PERF_BUDGETS: config, READ_WEB_PERF_ARTIFACT: artifact, READ_WEB_PERF_DIFF_OUTPUT: output },
    encoding: 'utf8',
  })
}
