import http from 'node:http'
import { spawn, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { isBrowserSafePort } from '../lib/browser-port-policy.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const require = createRequire(import.meta.url)
const host = '127.0.0.1'

const explicitBaseUrl = String(process.env.READ_WEB_PERF_BASE_URL || '').trim()
const explicitPort = String(process.env.READ_WEB_PERF_PORT || '').trim()
const port = explicitPort
  ? Number(explicitPort)
  : explicitBaseUrl
    ? null
    : await findFreeBrowserPort()
if (explicitPort && !isBrowserSafePort(port)) {
  throw new Error(`READ_WEB_PERF_PORT must be a browser-safe loopback port: ${explicitPort}`)
}
const baseUrl = explicitBaseUrl || `http://${host}:${port}`
const parsedBaseUrl = new URL(baseUrl)
if (parsedBaseUrl.protocol !== 'http:' || parsedBaseUrl.hostname !== host || !isBrowserSafePort(parsedBaseUrl.port)) {
  throw new Error(`Performance browser journeys require a 127.0.0.1 browser-safe base URL: ${baseUrl}`)
}

async function findFreeBrowserPort() {
  while (true) {
    const candidate = await new Promise((resolve, reject) => {
      const server = http.createServer()
      server.once('error', reject)
      server.listen(0, host, () => {
        const address = server.address()
        const value = typeof address === 'object' && address ? address.port : 0
        server.close((error) => error ? reject(error) : resolve(value))
      })
    })
    if (isBrowserSafePort(candidate)) return candidate
  }
}

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
    if (explicitBaseUrl) {
      throw new Error(`Explicit performance browser journey base URL is not reachable; the wrapper will not start a service for it: ${baseUrl}`)
    }
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
