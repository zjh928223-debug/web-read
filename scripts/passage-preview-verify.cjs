const http = require('node:http')
const path = require('node:path')
const { spawn, spawnSync } = require('node:child_process')

const projectRoot = path.resolve(__dirname, '..')
const host = '127.0.0.1'
const port = Number(process.env.PASSAGE_PREVIEW_VERIFY_PORT || 4197)
const targetUrl = `http://${host}:${port}/`

async function run() {
  const unitCode = await runCheck('passage-preview-check.cjs', {})
  if (unitCode !== 0) process.exit(unitCode)

  const viteBin = path.join(path.dirname(require.resolve('vite/package.json')), 'bin', 'vite.js')
  const server = spawn(process.execPath, [
    viteBin,
    '--host', host,
    '--port', String(port),
    '--strictPort',
    '--clearScreen', 'false',
  ], {
    cwd: projectRoot,
    stdio: 'ignore',
    windowsHide: true,
  })

  try {
    if (!await waitForServer(targetUrl)) {
      throw new Error(`Vite server did not start at ${targetUrl}`)
    }
    for (const script of ['aria-edge-tts-live-check.cjs', 'passage-preview-browser-check.cjs']) {
      const code = await runCheck(script, { READ_WEB_URL: targetUrl })
      if (code !== 0) process.exitCode = code
      if (code !== 0) return
    }
  } finally {
    killProcessTree(server)
  }
}

function runCheck(script, extraEnv) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(__dirname, script)], {
      cwd: projectRoot,
      stdio: 'inherit',
      env: { ...process.env, ...extraEnv },
      windowsHide: true,
    })
    child.on('error', reject)
    child.on('exit', (code) => resolve(code ?? 1))
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

function canReach(url) {
  return new Promise((resolve) => {
    const request = http.get(url, (response) => {
      response.resume()
      resolve(response.statusCode >= 200 && response.statusCode < 500)
    })
    request.setTimeout(1000, () => {
      request.destroy()
      resolve(false)
    })
    request.on('error', () => resolve(false))
  })
}

function killProcessTree(child) {
  if (!child?.pid) return
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
    return
  }
  child.kill('SIGTERM')
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
