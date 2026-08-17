import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { access, mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { listenOnBrowserSafePort } from './lib/browser-port-policy.mjs'

const nextRoot = path.resolve(import.meta.dirname, '..')
const legacyRoot = path.resolve(process.env.READ_WEB_LEGACY_ROOT || 'E:\\read-web')
const outputRoot = process.env.READ_WEB_RELEASE_DIFFERENTIAL_OUTPUT
  ? path.resolve(process.env.READ_WEB_RELEASE_DIFFERENTIAL_OUTPUT)
  : await mkdtemp(path.join(os.tmpdir(), 'read-web-release-differential-12.5-'))
const configPath = path.join(nextRoot, 'config', 'release-differential-budgets.json')
const config = JSON.parse(await readFile(configPath, 'utf8'))
const viteBin = path.join(nextRoot, 'node_modules', 'vite', 'bin', 'vite.js')
const fixturePath = path.join(nextRoot, 'scripts', 'fixtures', 'performance-browser-journeys.v1.json')
const fixtureSha256 = createHash('sha256').update(await readFile(fixturePath)).digest('hex')
const legacyStatusBefore = git(legacyRoot, 'status', '--porcelain=v1', '--untracked-files=all')
const reportPath = path.join(outputRoot, 'release-version-differential.json')
const versions = [
  { id: 'legacy', root: legacyRoot, dist: path.join(outputRoot, 'legacy-dist') },
  { id: 'next', root: nextRoot, dist: path.join(outputRoot, 'next-dist') },
]

assert.equal(config.status, 'active')
assert.ok(Number.isInteger(config.runCount) && config.runCount >= 3)
assert.notEqual(path.normalize(legacyRoot).toLowerCase(), path.normalize(nextRoot).toLowerCase())
await Promise.all([access(path.join(legacyRoot, 'index.html')), access(path.join(nextRoot, 'index.html')), access(viteBin)])
await mkdir(outputRoot, { recursive: true })

const report = {
  schema: 'read-web.release-version-differential',
  schemaVersion: 1,
  task: '12.5',
  capturedAt: new Date().toISOString(),
  status: 'running',
  config: { path: path.relative(nextRoot, configPath).replaceAll(path.sep, '/'), ...config },
  fixture: { path: path.relative(nextRoot, fixturePath).replaceAll(path.sep, '/'), sha256: fixtureSha256 },
  isolation: {
    outputRoot,
    legacySourceReadOnly: true,
    reservedPortsUntouched: true,
    externalNetworkRequests: 0,
  },
  sources: {},
  versions: {},
  metrics: [],
  summary: null,
  failures: [],
}

try {
  for (const version of versions) {
    report.sources[version.id] = sourceIdentity(version.root)
    await run(process.execPath, [viteBin, 'build', version.root, '--outDir', version.dist, '--emptyOutDir'], {
      cwd: nextRoot,
      env: isolatedEnv(version.id),
      label: `${version.id} production build`,
    })
    const server = await startStaticServer(version.dist)
    try {
      const artifacts = []
      for (let runIndex = 1; runIndex <= config.runCount; runIndex += 1) {
        const runOutput = path.join(outputRoot, version.id, `run-${runIndex}`)
        await run(process.execPath, [path.join(nextRoot, 'scripts', 'perf', 'browser-journeys.mjs')], {
          cwd: nextRoot,
          env: {
            ...isolatedEnv(version.id),
            READ_WEB_PERF_BASE_URL: server.baseUrl,
            READ_WEB_PERF_OUTPUT: runOutput,
          },
          label: `${version.id} journey run ${runIndex}`,
        })
        artifacts.push(JSON.parse(await readFile(path.join(runOutput, 'browser-journeys.json'), 'utf8')))
      }
      report.versions[version.id] = summarizeVersion(version, server.baseUrl, artifacts)
    } finally {
      await server.close()
    }
  }

  assert.equal(git(legacyRoot, 'status', '--porcelain=v1', '--untracked-files=all'), legacyStatusBefore, 'legacy source worktree changed during differential')
  validateBehavior(report.versions.legacy, report.failures)
  validateBehavior(report.versions.next, report.failures)
  for (const metric of config.metrics) {
    const legacy = metricValue(report.versions.legacy, metric)
    const next = metricValue(report.versions.next, metric)
    const ratio = legacy > 0 ? next / legacy : next === 0 ? 1 : Number.POSITIVE_INFINITY
    const absoluteRegressionMs = next - legacy
    const improved = next < legacy
    const passed = Number.isFinite(legacy) && Number.isFinite(next)
      && (ratio <= config.maximumSingleMetricRegressionRatio || absoluteRegressionMs <= config.maximumSingleMetricAbsoluteRegressionMs)
    report.metrics.push({ id: metric.id, statistic: metric.statistic, legacyMs: legacy, nextMs: next, absoluteRegressionMs, ratio, changePercent: (ratio - 1) * 100, improved, passed })
    if (!passed) report.failures.push(`${metric.id} regressed beyond the single-metric allowance`)
  }
  const comparable = report.metrics.filter((item) => Number.isFinite(item.ratio) && item.ratio > 0)
  const aggregateRatio = Math.exp(comparable.reduce((sum, item) => sum + Math.log(item.ratio), 0) / comparable.length)
  const improvedMetrics = comparable.filter((item) => item.improved).length
  if (aggregateRatio > config.maximumAggregateRegressionRatio) report.failures.push('aggregate performance regressed beyond the allowance')
  if (improvedMetrics < config.minimumImprovedMetrics) report.failures.push('no key performance metric improved')
  report.summary = {
    behaviorParity: report.failures.filter((item) => item.startsWith('legacy behavior') || item.startsWith('next behavior')).length === 0,
    metricCount: comparable.length,
    improvedMetrics,
    regressedMetrics: comparable.length - improvedMetrics,
    aggregateRatio,
    aggregateChangePercent: (aggregateRatio - 1) * 100,
    maximumSingleRatio: Math.max(...comparable.map((item) => item.ratio)),
  }
  report.status = report.failures.length ? 'failed' : 'passed'
} catch (error) {
  report.status = 'failed'
  report.failures.push(error.stack || error.message || String(error))
} finally {
  await writeFile(reportPath, `${JSON.stringify(report, jsonNumberReplacer, 2)}\n`, 'utf8')
}

console.log(`release version differential: ${reportPath}`)
console.log(JSON.stringify({ status: report.status, summary: report.summary, failures: report.failures }, null, 2))
if (report.status !== 'passed') process.exitCode = 1

function isolatedEnv(versionId) {
  const versionRoot = path.join(outputRoot, 'runtime', versionId)
  return {
    ...process.env,
    READ_WEB_SUBTITLE_DATA_ROOT: path.join(versionRoot, 'data'),
    READ_WEB_OUTPUT_ROOT: path.join(versionRoot, 'output'),
    READ_WEB_PROFILE_ID: `release-differential-${versionId}`,
  }
}

function sourceIdentity(root) {
  const status = git(root, 'status', '--porcelain=v1', '--untracked-files=all')
  return {
    root,
    gitSha: git(root, 'rev-parse', 'HEAD'),
    branch: git(root, 'branch', '--show-current'),
    dirty: status.length > 0,
    dirtyEntryCount: status ? status.split(/\r?\n/).length : 0,
  }
}

function summarizeVersion(version, baseUrl, artifacts) {
  return {
    id: version.id,
    baseUrl,
    build: { dist: version.dist },
    runCount: artifacts.length,
    requestedJourneys: artifacts[0].requestedJourneys,
    journeys: artifacts.flatMap((artifact, index) => artifact.journeys.map((item) => ({ run: index + 1, ...item }))),
    measures: artifacts.flatMap((artifact, index) => artifact.measures.map((item) => ({ run: index + 1, ...item }))),
    samples: artifacts.flatMap((artifact, index) => artifact.samples.map((item) => ({ run: index + 1, ...item }))),
    longTasks: artifacts.flatMap((artifact, index) => artifact.longTasks.map((item) => ({ run: index + 1, ...item }))),
    errors: artifacts.flatMap((artifact, index) => artifact.errors.map((item) => ({ run: index + 1, ...item }))),
    requests: {
      failed: artifacts.reduce((sum, artifact) => sum + artifact.requests.failed, 0),
      httpErrors: artifacts.reduce((sum, artifact) => sum + artifact.requests.httpErrors, 0),
    },
  }
}

function validateBehavior(version, failures) {
  const expected = ['cold-start', 'material-open', 'play-pause-seek', 'continuous-word-chunk', 'material-workflow', 'passage-preview', 'srs-review']
  if (version.runCount !== config.runCount || version.journeys.length !== config.runCount * expected.length) failures.push(`${version.id} behavior journey count is incomplete`)
  if (version.errors.length || version.requests.failed || version.requests.httpErrors) failures.push(`${version.id} behavior contains browser or network errors`)
  if (version.journeys.some((item) => item.status !== 'passed')) failures.push(`${version.id} behavior contains a failed journey`)
  for (let runIndex = 1; runIndex <= config.runCount; runIndex += 1) {
    const rows = version.journeys.filter((item) => item.run === runIndex)
    if (rows.length !== expected.length || expected.some((name) => rows.filter((item) => item.name === name).length !== 1)) failures.push(`${version.id} behavior run ${runIndex} is incomplete`)
    const byName = Object.fromEntries(rows.map((item) => [item.name, item.metrics || {}]))
    if (byName['material-open']?.wordCount < 96) failures.push(`${version.id} behavior material fixture mismatch`)
    if (byName['continuous-word-chunk']?.wordUpdates !== 40 || byName['continuous-word-chunk']?.chunkUpdates !== 24) failures.push(`${version.id} behavior interaction fixture mismatch`)
    if (byName['material-workflow']?.dialogVisible !== true || byName['passage-preview']?.cardVisible !== true || byName['srs-review']?.reviewVisible !== true) failures.push(`${version.id} behavior learning journey visibility mismatch`)
  }
}

function metricValue(version, metric) {
  let values = []
  if (metric.source === 'measures') values = version.measures.filter((item) => item.name === metric.name).map((item) => Number(item.durationMs))
  else if (metric.source === 'samples') values = version.samples.map((item) => Number(item.durationMs))
  else if (metric.source === 'longTasks') values = version.longTasks.map((item) => Number(item.duration))
  values = values.filter(Number.isFinite)
  if (!values.length) return 0
  if (metric.statistic === 'max') return Math.max(...values)
  const sorted = values.sort((left, right) => left - right)
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)]
}

async function startStaticServer(distRoot) {
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url || '/', 'http://127.0.0.1')
      const requested = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)
      let target = path.resolve(distRoot, `.${requested}`)
      if (!target.startsWith(`${path.resolve(distRoot)}${path.sep}`)) return end(response, 403, 'text/plain', 'forbidden')
      try {
        const info = await stat(target)
        if (info.isDirectory()) target = path.join(target, 'index.html')
      } catch {
        if (!path.extname(requested)) target = path.join(distRoot, 'index.html')
      }
      const info = await stat(target)
      response.writeHead(200, { 'content-type': mime(target), 'content-length': info.size, 'cache-control': 'no-store' })
      createReadStream(target).pipe(response)
    } catch {
      end(response, 404, 'text/plain', 'not found')
    }
  })
  const port = await listenOnBrowserSafePort(server)
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  }
}

function end(response, status, contentType, body) {
  response.writeHead(status, { 'content-type': contentType })
  response.end(body)
}

function mime(filename) {
  return ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' })[path.extname(filename).toLowerCase()] || 'application/octet-stream'
}

function run(executable, args, options) {
  console.log(`[release differential] ${options.label}`)
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd: options.cwd, env: options.env, stdio: 'inherit', windowsHide: true })
    child.once('error', reject)
    child.once('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`${options.label} exited ${code ?? 1}${signal ? ` (${signal})` : ''}`)))
  })
}

function git(root, ...args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim()
}

function jsonNumberReplacer(_key, value) {
  return typeof value === 'number' && !Number.isFinite(value) ? null : value
}
