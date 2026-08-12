import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { spawn } from 'node:child_process'

const outputRoot = path.resolve(process.env.READ_WEB_PERF_OUTPUT || 'output/performance')
const runCount = Number(process.env.READ_WEB_PERF_RUNS || 3)
if (!Number.isInteger(runCount) || runCount < 3) throw new Error('READ_WEB_PERF_RUNS must be at least 3 for a release candidate')
const artifacts = []
for (let index = 1; index <= runCount; index += 1) {
  const runOutput = path.join(outputRoot, `run-${index}`)
  await fs.rm(runOutput, { recursive: true, force: true })
  const code = await run(process.execPath, ['scripts/production-host-lifecycle-check.mjs'], {
    ...process.env,
    READ_WEB_PRODUCTION_HOST_OUTPUT: runOutput,
  })
  const artifact = JSON.parse(await fs.readFile(path.join(runOutput, 'browser-journeys', 'browser-journeys.json'), 'utf8'))
  for (const evidenceName of ['browser-journeys.json', 'browser-journeys-trace.zip', 'browser-journeys-final.png']) {
    await fs.access(path.join(runOutput, 'browser-journeys', evidenceName))
  }
  artifacts.push(artifact)
  if (code !== 0) process.exitCode = 1
}

const first = artifacts[0]
const combined = {
  ...first,
  schema: 'read-web.browser-performance-journeys',
  schemaVersion: 2,
  capturedAt: new Date().toISOString(),
  runCount,
  provenance: {
    hostKind: 'local-app-host',
    distMode: 'built-dist',
    independentBaseUrls: new Set(artifacts.map((artifact) => artifact.provenance?.baseUrl)).size === artifacts.length,
  },
  runArtifacts: artifacts.map((artifact, index) => ({
    run: index + 1,
    capturedAt: artifact.capturedAt,
    summary: artifact.summary,
    provenance: artifact.provenance,
    evidence: {
      json: `run-${index + 1}/browser-journeys/browser-journeys.json`,
      trace: `run-${index + 1}/browser-journeys/browser-journeys-trace.zip`,
      screenshot: `run-${index + 1}/browser-journeys/browser-journeys-final.png`,
    },
  })),
  journeys: artifacts.flatMap((artifact, run) => artifact.journeys.map((item) => ({ run: run + 1, ...item }))),
  measures: artifacts.flatMap((artifact, run) => artifact.measures.map((item) => ({ run: run + 1, ...item }))),
  samples: artifacts.flatMap((artifact, run) => artifact.samples.map((item) => ({ run: run + 1, ...item }))),
  errors: artifacts.flatMap((artifact, run) => artifact.errors.map((item) => ({ run: run + 1, ...item }))),
  longTasks: artifacts.flatMap((artifact, run) => artifact.longTasks.map((item) => ({ run: run + 1, ...item }))),
  requests: {
    total: artifacts.reduce((sum, artifact) => sum + artifact.requests.total, 0),
    failed: artifacts.reduce((sum, artifact) => sum + artifact.requests.failed, 0),
    httpErrors: artifacts.reduce((sum, artifact) => sum + artifact.requests.httpErrors, 0),
  },
}
combined.summary = {
  runCount,
  passedJourneys: combined.journeys.filter((item) => item.status === 'passed').length,
  requestedJourneys: first.requestedJourneys.length * runCount,
  errorCount: combined.errors.length,
}
await fs.mkdir(outputRoot, { recursive: true })
await fs.writeFile(path.join(outputRoot, 'browser-journeys.json'), `${JSON.stringify(combined, null, 2)}\n`, 'utf8')
console.log(`Combined ${runCount} browser performance runs: ${path.join(outputRoot, 'browser-journeys.json')}`)

function run(executable, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd: process.cwd(), env, stdio: 'inherit', windowsHide: true })
    child.once('error', reject)
    child.once('exit', (code) => resolve(code ?? 1))
  })
}
