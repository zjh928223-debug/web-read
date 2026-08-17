import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { verifyReleaseManifest, writeJsonAtomic } from './lib/release-manifest.mjs'

const values = process.argv.slice(2)
const stateIndex = values.indexOf('--state')
const statePath = path.resolve(stateIndex >= 0 ? values[stateIndex + 1] : path.join('output', 'release', 'release-state.json'))
const state = JSON.parse(await readFile(statePath, 'utf8'))
if (state.schema !== 'read-web.release-state' || !state.active?.manifest || !state.previous?.manifest) throw new Error('release state is incomplete')

const previousManifest = path.resolve(path.dirname(statePath), state.previous.manifest)
const verified = await verifyReleaseManifest(previousManifest, state.previous.root)
if (!verified.passed) throw new Error(`previous release is not healthy: ${verified.failures.join('; ')}`)

const nextState = { ...state, status: 'rolled-back', rolledBackAt: new Date().toISOString(), active: state.previous, previous: state.active }
if (!values.includes('--apply')) {
  console.log(JSON.stringify({ status: 'dry-run', state: statePath, target: nextState.active, verified: true }, null, 2))
} else {
  await mkdir(path.dirname(statePath), { recursive: true })
  await writeJsonAtomic(statePath, nextState)
  console.log(JSON.stringify({ status: 'rolled-back', state: statePath, active: nextState.active }, null, 2))
}
