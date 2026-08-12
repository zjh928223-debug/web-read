import http from 'node:http'
import { spawn, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const require = createRequire(import.meta.url)
const host = '127.0.0.1'
const port = Number(process.env.READ_WEB_PERF_PORT || 4196)
const baseUrl = process.env.READ_WEB_PERF_BASE_URL || `http://${host}:${port}`

function canReach(url) {
  return new Promise((resolve) => {
    const request = http.get(url, (response) => {
      response.resume()
      resolve(response.statusCode >= 200 && response.statusCode < 500)
    })
    request.setTimeout(1000, () => { request.destroy(); resolve(false) })
    request.on('error', () => resolve(false))
  })
}

async function waitForServer(url, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await canReach(url)) return true
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  return false
}

function killProcessTree(child) {
  if (!child?.pid || child.killed) return
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
    return
  }
  child.kill('SIGTERM')
}

function runHarness() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(repoRoot, 'scripts/perf/browser-journeys.mjs')], {
      cwd: repoRoot,
      stdio: 'inherit',
      windowsHide: true,
      env: { ...process.env, READ_WEB_PERF_BASE_URL: baseUrl },
    })
    child.on('error', reject)
    child.on('exit', (code) => resolve(code ?? 1))
  })
}

let server = null
try {
  if (!await canReach(baseUrl)) {
    const viteBin = path.join(path.dirname(require.resolve('vite/package.json')), 'bin', 'vite.js')
    server = spawn(process.execPath, [viteBin, '--host', host, '--port', String(port), '--strictPort', '--clearScreen', 'false'], {
      cwd: repoRoot,
      stdio: 'ignore',
      windowsHide: true,
    })
    if (!await waitForServer(baseUrl)) throw new Error(`Vite server did not start at ${baseUrl}`)
  }
  process.exitCode = await runHarness()
} finally {
  killProcessTree(server)
}
