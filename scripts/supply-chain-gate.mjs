import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const root = path.resolve(import.meta.dirname, '..')
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8')
const packageJson = JSON.parse(read('package.json'))
const lock = JSON.parse(read('package-lock.json'))
const allowedLicenses = new Set(['0BSD', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'ISC', 'MIT', 'MPL-2.0', '(WTFPL OR MIT)'])
const reviewedLicenseExceptions = new Map([
  ['union@0.5.0', 'MIT'], // The package tarball contains the standard MIT LICENSE but omits package.json.license.
])

assert.equal(packageJson.license, 'ISC')
assert.match(read('LICENSE'), /^ISC License/m)
assert.match(read('THIRD_PARTY_NOTICES.md'), /Third-Party Notices/)
assert.match(read('docs/architecture/EXTERNAL_RESOURCES.md'), /Security boundary:/)

const packages = []
for (const [packagePath, record] of Object.entries(lock.packages || {})) {
  if (!packagePath || !packagePath.startsWith('node_modules/')) continue
  assert.equal(typeof record.version, 'string', `${packagePath} must have a locked version`)
  assert.equal(typeof record.integrity, 'string', `${packagePath} must have package integrity`)
  const packageName = packagePath.slice('node_modules/'.length)
  const license = record.license || reviewedLicenseExceptions.get(`${packageName}@${record.version}`)
  assert.equal(typeof license, 'string', `${packagePath} must declare or have a reviewed license`)
  assert.equal(allowedLicenses.has(license), true, `${packagePath} has unreviewed license ${license}`)
  packages.push({
    type: 'library',
    name: packageName,
    version: record.version,
    licenses: [{ license: { id: license } }],
    hashes: [{ alg: 'SHA-512', content: record.integrity.replace(/^sha512-/, '') }],
    purl: `pkg:npm/${encodeURIComponent(packageName)}@${encodeURIComponent(record.version)}`,
  })
}
packages.sort((a, b) => a.name.localeCompare(b.name))
assert.ok(packages.length > 0)

const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root }).toString('utf8').split('\0').filter(Boolean)
const highConfidenceSecrets = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bgh[opusr]_[A-Za-z0-9]{30,}\b/,
  /\bAIza[0-9A-Za-z_-]{30,}\b/,
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{24,}\b/,
]
const violations = []
for (const relative of tracked) {
  const absolute = path.join(root, relative)
  if (!fs.existsSync(absolute) || fs.statSync(absolute).size > 5 * 1024 * 1024) continue
  let source
  try { source = fs.readFileSync(absolute, 'utf8') } catch { continue }
  for (const pattern of highConfidenceSecrets) {
    if (pattern.test(source)) violations.push(relative)
  }
}
assert.deepEqual(violations, [], `tracked files contain high-confidence secrets: ${violations.join(', ')}`)

const outputDir = path.join(root, 'output', 'release')
fs.mkdirSync(outputDir, { recursive: true })
const sbom = {
  bomFormat: 'CycloneDX',
  specVersion: '1.6',
  serialNumber: `urn:uuid:${crypto.randomUUID()}`,
  version: 1,
  metadata: { component: { type: 'application', name: packageJson.name, version: packageJson.version } },
  components: packages,
}
const outputPath = path.join(outputDir, 'read-web-node-sbom.cdx.json')
fs.writeFileSync(outputPath, `${JSON.stringify(sbom, null, 2)}\n`, 'utf8')
const parsed = JSON.parse(fs.readFileSync(outputPath, 'utf8'))
assert.equal(parsed.components.length, packages.length)

console.log(`supply-chain gate passed (${tracked.length} tracked files scanned, ${packages.length} locked packages, SBOM ${path.relative(root, outputPath)})`)
