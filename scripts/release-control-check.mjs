import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

const root = await mkdtemp(path.join(os.tmpdir(), 'read-web-release-control-'))
const currentRoot = path.join(root, 'current')
const previousRoot = path.join(root, 'previous')
await Promise.all([mkdir(currentRoot), mkdir(previousRoot)])
await Promise.all([writeFile(path.join(currentRoot, 'index.html'), 'current'), writeFile(path.join(previousRoot, 'index.html'), 'previous')])
const currentManifest = await manifest(currentRoot, 'current')
const previousManifest = await manifest(previousRoot, 'previous')
await Promise.all([
  writeFile(path.join(root, 'current.json'), JSON.stringify(currentManifest)),
  writeFile(path.join(root, 'previous.json'), JSON.stringify(previousManifest)),
  writeFile(path.join(root, 'state.json'), JSON.stringify({
    schema: 'read-web.release-state', schemaVersion: 1, status: 'active',
    active: { manifest: 'current.json', root: currentRoot, releaseId: 'current' },
    previous: { manifest: 'previous.json', root: previousRoot, releaseId: 'previous' },
  })),
])

run('scripts/release-health-check.mjs', ['--manifest', path.join(root, 'current.json')])
run('scripts/release-rollback.mjs', ['--state', path.join(root, 'state.json')])
run('scripts/release-rollback.mjs', ['--state', path.join(root, 'state.json'), '--apply'])
const rolledBack = JSON.parse(await readFile(path.join(root, 'state.json'), 'utf8'))
assert.equal(rolledBack.status, 'rolled-back')
assert.equal(rolledBack.active.releaseId, 'previous')

await writeFile(path.join(previousRoot, 'index.html'), 'corrupt')
const rejected = spawnSync(process.execPath, ['scripts/release-health-check.mjs', '--manifest', path.join(root, 'previous.json')], { cwd: process.cwd(), encoding: 'utf8' })
assert.notEqual(rejected.status, 0, 'checksum mismatch must fail health check')
console.log('release manifest health and rollback checks passed')

async function manifest(releaseRoot, gitSha) {
  const bytes = await readFile(path.join(releaseRoot, 'index.html'))
  return {
    schemaVersion: 1,
    release: { gitSha, root: releaseRoot },
    artifacts: [{ path: 'index.html', bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }],
  }
}

function run(script, args) {
  execFileSync(process.execPath, [script, ...args], { cwd: process.cwd(), stdio: 'pipe' })
}
