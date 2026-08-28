import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { verifyReleaseManifest, writeJsonAtomic } from './lib/release-manifest.mjs'

const values = process.argv.slice(2)
const stateIndex = values.indexOf('--state')
const statePath = path.resolve(stateIndex >= 0 ? values[stateIndex + 1] : path.join('output', 'release', 'release-state.json'))
const state = JSON.parse(await readFile(statePath, 'utf8'))
if (state.schema !== 'read-web.release-state' || !state.active?.manifest || !state.previous?.manifest) throw new Error('release state is incomplete')

const activeManifest = path.resolve(path.dirname(statePath), state.active.manifest)
const previousManifest = path.resolve(path.dirname(statePath), state.previous.manifest)
await verifyStateDescriptor('active', state.active, activeManifest)
const verified = await verifyReleaseManifest(previousManifest, state.previous.root)
if (!verified.passed) throw new Error(`previous release is not healthy: ${verified.failures.join('; ')}`)
await verifyStateDescriptor('previous', state.previous, previousManifest, verified)

const nextState = { ...state, status: 'rolled-back', rolledBackAt: new Date().toISOString(), active: state.previous, previous: state.active }
if (!values.includes('--apply')) {
  console.log(JSON.stringify({ status: 'dry-run', state: statePath, target: nextState.active, verified: true }, null, 2))
} else {
  await mkdir(path.dirname(statePath), { recursive: true })
  await writeJsonAtomic(statePath, nextState)
  console.log(JSON.stringify({ status: 'rolled-back', state: statePath, active: nextState.active }, null, 2))
}

async function verifyStateDescriptor(label, descriptor, manifestPath, existing = null) {
  if (!descriptor.manifestSha256 || !/^[0-9a-f]{64}$/.test(String(descriptor.manifestSha256))) {
    throw new Error(`${label} release state identity is incomplete: manifestSha256 is required`)
  }
  const verified = existing || await verifyReleaseManifest(manifestPath, descriptor.root)
  if (!verified.passed) throw new Error(`${label} release is not healthy: ${verified.failures.join('; ')}`)
  if (descriptor.releaseId !== verified.manifest.release.releaseId) {
    throw new Error(`${label} release state identity mismatch: releaseId does not match manifest`)
  }
  if (descriptor.manifestSha256 !== verified.manifestSha256) {
    throw new Error(`${label} release state identity mismatch: manifestSha256 does not match manifest`)
  }
}
