import { spawn, spawnSync } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import http from 'node:http'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { evaluatePlaybackScaleArtifact } from './playback-scale-budget.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const port = Number(process.env.READ_WEB_PLAYBACK_SCALE_PORT || 4198)
if ([5173, 5174, 8765, 8766].includes(port)) throw new Error(`playback scale gate refuses reserved port ${port}`)
const baseUrl = `http://127.0.0.1:${port}/`
const outputPath = path.resolve(process.env.READ_WEB_PLAYBACK_SCALE_OUTPUT || path.join(repoRoot, 'output', 'playback-scale', 'playback-scale-results.json'))
const diffPath = path.resolve(process.env.READ_WEB_PLAYBACK_SCALE_DIFF || path.join(repoRoot, 'output', 'playback-scale', 'playback-scale-budget-diff.json'))
const captureOnly = process.argv.includes('--capture-only')

if (await canReach(baseUrl)) throw new Error(`playback scale gate will not reuse existing service at ${baseUrl}`)
const viteBin = path.join(path.dirname(fileURLToPath(import.meta.resolve('vite/package.json'))), 'bin', 'vite.js')
const server = spawn(process.execPath, [viteBin, '--host', '127.0.0.1', '--port', String(port), '--strictPort', '--clearScreen', 'false'], {
  cwd: repoRoot,
  env: process.env,
  stdio: 'ignore',
  windowsHide: true,
})

try {
  if (!await waitForServer(baseUrl)) throw new Error(`isolated Vite did not start at ${baseUrl}`)
  const code = await run(process.execPath, ['scripts/perf/playback-scale-journey.mjs'], {
    ...process.env,
    READ_WEB_PLAYBACK_SCALE_URL: baseUrl,
    READ_WEB_PLAYBACK_SCALE_OUTPUT: outputPath,
  })
  if (code !== 0) process.exitCode = code
  if (!captureOnly && code === 0) {
    const [config, artifact] = await Promise.all([
      readJson(path.join(repoRoot, 'config', 'playback-scale-budgets.json')),
      readJson(outputPath),
    ])
    const evaluation = evaluatePlaybackScaleArtifact(config, artifact)
    const diff = {
      schema: 'read-web.playback-scale-budget-diff',
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      artifact: path.relative(repoRoot, outputPath),
      ...evaluation,
    }
    await writeFile(diffPath, `${JSON.stringify(diff, null, 2)}\n`, 'utf8')
    for (const metric of evaluation.metrics) console.log(`${metric.passed ? 'PASS' : 'FAIL'} ${metric.id}: ${metric.actual} <= ${metric.limit}`)
    if (!evaluation.passed) {
      evaluation.failures.forEach((failure) => console.error(`- ${failure}`))
      process.exitCode = 1
    } else {
      console.log(`Playback scale gate passed: ${diffPath}`)
    }
  }
} finally {
  killTree(server)
}

function canReach(url) {
  return new Promise((resolve) => {
    const request = http.get(url, (response) => { response.resume(); resolve(response.statusCode >= 200 && response.statusCode < 500) })
    request.once('error', () => resolve(false))
    request.setTimeout(750, () => { request.destroy(); resolve(false) })
  })
}

async function waitForServer(url, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await canReach(url)) return true
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  return false
}

function run(executable, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd: repoRoot, env, stdio: 'inherit', windowsHide: true })
    child.once('error', reject)
    child.once('exit', (code) => resolve(code ?? 1))
  })
}

function killTree(child) {
  if (!child || child.exitCode !== null) return
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
  else child.kill('SIGTERM')
}

function readJson(filePath) {
  return readFile(filePath, 'utf8').then(JSON.parse)
}
