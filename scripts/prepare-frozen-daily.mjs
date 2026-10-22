import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// One-time explicit snapshot. Never refreshes or replaces a running daily data root.
const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const root = 'E:/ReadWebDaily/N5-20261007'
const dataSource = 'E:/ReadWebData/SubtitleWorkflow-Optimization'
const dataRoot = 'E:/ReadWebData/SubtitleWorkflow-Daily-N5'
const evidence = 'C:/Users/0/AppData/Local/Temp/reader-dual-runtime-20261007'
const releaseSource = path.join(source, '.codex/releases/optimization/read-web-optimization-v2-153f9464356c-62e326feaea8-788ea7ad16d6')
if (existsSync(root) || existsSync(dataRoot)) throw new Error('Snapshot destination already exists; refusing overwrite')
mkdirSync(evidence, { recursive: true })
const files = [...new Set(execFileSync('git', ['ls-files', '-c', '-o', '--exclude-standard', '-z'], { cwd: source, encoding: 'utf8' }).split('\0').filter(Boolean))].sort()
const hash = (file) => createHash('sha256').update(readFileSync(file)).digest('hex')
const manifest = (dir) => {
  const rows = []
  const walk = (current) => {
    for (const item of readdirSync(current, { withFileTypes: true })) {
      const file = path.join(current, item.name)
      if (item.isDirectory()) walk(file)
      else if (item.isFile()) rows.push({ path: path.relative(dir, file).replaceAll('\\', '/'), bytes: statSync(file).size, sha256: hash(file) })
      else throw new Error(`Unsupported link in snapshot: ${file}`)
    }
  }
  walk(dir)
  return rows.sort((a, b) => a.path.localeCompare(b.path))
}
const save = (name, value) => writeFileSync(path.join(evidence, name), JSON.stringify(value, null, 2))
save('source-opening.json', files.filter(p => existsSync(path.join(source, p))).map(p => ({ path: p, sha256: hash(path.join(source, p)) })))
writeFileSync(path.join(evidence, 'opening-git-status.txt'), execFileSync('git', ['status', '--short'], { cwd: source, encoding: 'utf8' }))
save('acceptance.json', { status: 'NOT_RUN', fixedChecks: ['snapshot integrity', 'old data unchanged', 'independent source and dependencies', 'six authoritative persistence domains', 'HTTPS same-origin API', 'real UI load', 'save and durable readback', 'daily restart retains save', 'development stop/start leaves daily running', 'media range', 'owned stop only', 'Mac journey remains NOT_RUN until user validation'] })
console.log('Capturing complete data protection manifest...')
const oldData = manifest(dataSource)
save('data-source-before.json', oldData)
mkdirSync(root, { recursive: true })
for (const relative of files) {
  const from = path.join(source, relative)
  if (!existsSync(from)) continue
  const to = path.join(root, relative)
  mkdirSync(path.dirname(to), { recursive: true })
  copyFileSync(from, to)
}
console.log('Copying frozen N5 release, Node dependencies and Python environment...')
cpSync(releaseSource, path.join(root, 'release'), { recursive: true, errorOnExist: true, force: false })
cpSync(path.join(source, 'node_modules'), path.join(root, 'node_modules'), { recursive: true, dereference: true })
cpSync(path.dirname(process.execPath), path.join(root, 'runtime/node'), { recursive: true, dereference: true })
const release = JSON.parse(readFileSync(path.join(releaseSource, 'release-manifest.json')))
cpSync(path.dirname(path.dirname(release.runtime.pythonIdentity.executable)), path.join(root, 'runtime/python'), { recursive: true })
console.log('Copying complete learning data; original remains untouched...')
cpSync(dataSource, dataRoot, { recursive: true, errorOnExist: true, force: false })
const dataCopy = manifest(dataRoot)
const dataAfter = manifest(dataSource)
if (JSON.stringify(oldData) !== JSON.stringify(dataCopy) || JSON.stringify(oldData) !== JSON.stringify(dataAfter)) {
  throw new Error('Data source drift or copy mismatch; do not start this snapshot')
}
save('data-copy-verification.json', { passed: true, files: oldData.length, bytes: oldData.reduce((n, r) => n + r.bytes, 0) })
const deployment = {
  schemaVersion: 1, root: path.resolve(root), dataRoot: path.resolve(dataRoot),
  source: source, sourceRelease: releaseSource,
  publicOrigin: 'https://laptop-5jd5ouqg.tail5f3899.ts.net:5194/', publicPort: 5194, hostPort: 5195, capabilityPort: 8786,
  python: path.resolve(root, 'runtime/python/Scripts/python.exe'), node: path.resolve(root, 'runtime/node/node.exe'),
  nltkData: 'C:/Users/0/AppData/Local/Read-Web/whisperx/nltk_data',
}
writeFileSync(path.join(root, 'daily-deployment.json'), JSON.stringify(deployment, null, 2))
const config = JSON.parse(readFileSync(path.join(source, 'config/runtime.optimization.json')))
config.frontend.port = deployment.hostPort
config.backend.port = deployment.capabilityPort
config.dataRoot = deployment.dataRoot
config.python.executable = deployment.python
// Resolve external tools from the accepted N5 release, rather than a development PATH.
config.tools.ffmpeg = release.externalTools.ffmpeg.executable
config.tools.ytDlp = release.externalTools.ytDlp.executable
config.tools.whisperx = release.externalTools.whisperx.executable
writeFileSync(path.join(root, 'config/runtime.frozen-daily.json'), JSON.stringify(config, null, 2))
save('snapshot.json', deployment)
console.log(JSON.stringify({ status: 'copied-not-started', root, dataRoot, dataFiles: oldData.length }))
