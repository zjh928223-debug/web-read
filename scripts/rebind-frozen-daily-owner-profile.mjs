import { createHash } from 'node:crypto'
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { connect } from 'node:net'

const root = 'E:/ReadWebDaily/N5-20261007'
const evidence = 'C:/Users/0/AppData/Local/Temp/reader-dual-runtime-20261007'
const config = JSON.parse(readFileSync(path.join(root, 'daily-deployment.json')))
const appRoot = path.join(config.dataRoot, '.read-web-application')
const authority = path.join(appRoot, 'profiles/optimization')
const active = path.join(authority, 'owner-mode/checkpoints')
const retained = path.join(authority, 'owner-mode/checkpoints-before-daily-binding-20261007')
const options = {
  isolationRoot: path.join(appRoot, 'daily-binding-setup'),
  profileDir: path.join(appRoot, 'daily-binding-setup/profile'),
  profileAuthorityIsolationRoot: path.join(appRoot, 'profiles'), profileAuthorityRoot: authority, profileId: 'optimization',
}
const module = await import(pathToFileURL(path.join(root, 'scripts/lib/read-web-production-backup.mjs')))
const sourceManifest = JSON.parse(readFileSync(path.join(evidence, 'data-source-before.json')))
const baseline = new Map(sourceManifest.map(row => [row.path, row.sha256]))
const hash = file => createHash('sha256').update(readFileSync(file)).digest('hex')
const domains = ['reader-session', 'vocabulary-srs', 'passage-preview', 'annotation', 'marks-activity', 'workflow']
const isListening = port => new Promise(resolve => {
  const socket = connect({ host: '127.0.0.1', port })
  socket.once('connect', () => { socket.destroy(); resolve(true) })
  socket.once('error', () => resolve(false))
})
for (const port of [config.publicPort, config.hostPort, config.capabilityPort]) {
  if (await isListening(port)) throw new Error('Stop daily services before rebinding their profile')
}
if (existsSync(retained)) throw new Error('Prior binding backup already exists; refusing another rebind')
// Existing owner data must be the exact copied snapshot before credentials can be rebound.
for (const row of sourceManifest.filter(row => row.path.startsWith('.read-web-application/profiles/optimization/owners/'))) {
  if (hash(path.join(config.dataRoot, row.path)) !== row.sha256) throw new Error('Copied owner content changed')
}
const records = Object.fromEntries(domains.map(domain => {
  const file = path.join(active, domain + '.json')
  const relative = path.relative(config.dataRoot, file).replaceAll('\\', '/')
  if (hash(file) !== baseline.get(relative)) throw new Error('Copied checkpoint is not the protected original')
  return [domain, JSON.parse(readFileSync(file))]
}))
const inspect = await module.inspectOwnerModeCheckpoints(options)
if (!domains.every(domain => inspect.domains[domain]?.code === 'OWNER_MODE_CHECKPOINT_LEASE_MISMATCH')) {
  throw new Error('Only the confirmed copied-directory lease mismatch may be rebound')
}
// Use the registered writer under an actual lock; preserve every old credential separately.
for (const target of [active, retained]) {
  if (!path.resolve(target).startsWith(path.resolve(config.dataRoot) + path.sep)) throw new Error('Path escapes daily data root')
}
await module.withReadWebApplicationProfileLease(options, async () => {
  renameSync(active, retained)
  for (const domain of domains) {
    await module.writeOwnerModeCheckpoint({
      ...options, domain, repository: records[domain].repository,
      oldWriterBlocked: true, compatibilityMode: 'read-only', inFlight: 0,
    })
  }
  const after = await module.inspectOwnerModeCheckpoints(options)
  if (after.status !== 'authoritative' || after.authoritativeDomains.length !== domains.length) {
    throw new Error('Rebound profile did not pass its registered checkpoint validator')
  }
  writeFileSync(path.join(evidence, 'binding-repair.json'), JSON.stringify({
    passed: true, domains: after.domains, originalCheckpointsRetained: retained,
    oldDataChanged: false, operation: 'Registered writeOwnerModeCheckpoint with real exclusive lease and unchanged copied repositories',
  }, null, 2))
})
console.log(JSON.stringify({ passed: true, domains: domains.length, originalCheckpointsRetained: true }))
