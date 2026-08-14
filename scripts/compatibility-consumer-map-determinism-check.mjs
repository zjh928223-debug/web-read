import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const mapScript = path.join(root, 'scripts', 'compatibility-consumer-map.mjs')
const canonicalPath = path.join(root, 'docs', 'architecture', 'compatibility-consumer-map.json')
const tempParent = path.join(root, 'output', 'architecture')
fs.mkdirSync(tempParent, { recursive: true })
const tempRoot = fs.mkdtempSync(path.join(tempParent, 'compatibility-map-determinism-'))

function runMap(args, port) {
  const result = spawnSync(process.execPath, [mapScript, ...args], {
    cwd: root,
    env: { ...process.env, READ_WEB_COMPAT_MAP_PORT: String(port) },
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024
  })
  assert.equal(
    result.status,
    0,
    `compatibility map failed on port ${port}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
  )
}

function gitDiff() {
  const result = spawnSync('git', ['diff', '--binary'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024
  })
  assert.equal(result.status, 0, `git diff failed: ${result.stderr}`)
  return result.stdout
}

async function findFreePort() {
  const server = net.createServer()
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  if (port === 5173 || port === 8765 || port < 1) return findFreePort()
  return port
}

const beforeCanonical = fs.readFileSync(canonicalPath, 'utf8')
const beforeDiff = gitDiff()
const firstPort = await findFreePort()
const secondPort = await findFreePort()
assert.notEqual(firstPort, secondPort, 'determinism check needs two distinct runtime ports')

try {
  const firstRuntime = path.join(tempRoot, 'verify-first.runtime.json')
  const secondRuntime = path.join(tempRoot, 'verify-second.runtime.json')
  runMap(['--output', firstRuntime], firstPort)
  runMap(['--output', secondRuntime], secondPort)

  assert.equal(fs.readFileSync(canonicalPath, 'utf8'), beforeCanonical, 'normal verify must not change the tracked canonical map')
  assert.notEqual(
    JSON.parse(fs.readFileSync(firstRuntime, 'utf8')).capture.port,
    JSON.parse(fs.readFileSync(secondRuntime, 'utf8')).capture.port,
    'runtime evidence should retain the actual isolated ports'
  )

  const firstCanonical = path.join(tempRoot, 'canonical-first.json')
  const secondCanonical = path.join(tempRoot, 'canonical-second.json')
  runMap(['--update', '--output', path.join(tempRoot, 'update-first.runtime.json'), '--canonical-output', firstCanonical], firstPort)
  runMap(['--update', '--output', path.join(tempRoot, 'update-second.runtime.json'), '--canonical-output', secondCanonical], secondPort)

  assert.equal(
    fs.readFileSync(firstCanonical, 'utf8'),
    fs.readFileSync(secondCanonical, 'utf8'),
    'canonical maps from different runtime ports must be byte-identical'
  )
  assert.equal(fs.readFileSync(firstCanonical, 'utf8'), beforeCanonical, 'generated canonical map must match the tracked snapshot')
  assert.equal(gitDiff(), beforeDiff, 'repeated compatibility map verification must not add or change tracked diffs')
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true })
}

console.log('compatibility consumer map determinism check passed')
