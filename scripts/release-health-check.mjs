import path from 'node:path'
import process from 'node:process'
import { verifyReleaseManifest } from './lib/release-manifest.mjs'

const args = parseArgs(process.argv.slice(2))
const manifestPath = path.resolve(args.manifest || path.join('output', 'release', 'release-manifest.json'))
const result = await verifyReleaseManifest(manifestPath, args.root)

if (args.url) {
  try {
    const response = await fetch(args.url, { signal: AbortSignal.timeout(5000) })
    const health = await response.json()
    if (!response.ok || !['ok', 'ready'].includes(health.status)) result.failures.push(`health endpoint is not ready (${response.status})`)
    if (health.manifest?.sha256 !== result.manifestSha256) result.failures.push('health manifest identity mismatch')
    if (health.manifest?.gitSha !== result.manifest.release.gitSha) result.failures.push('health git identity mismatch')
  } catch (error) {
    result.failures.push(`health request failed: ${error.message}`)
  }
}

result.passed = result.failures.length === 0
console.log(JSON.stringify({ status: result.passed ? 'passed' : 'failed', manifest: manifestPath, manifestSha256: result.manifestSha256, failures: result.failures }, null, 2))
if (!result.passed) process.exitCode = 1

function parseArgs(values) {
  const result = {}
  for (let index = 0; index < values.length; index += 1) {
    const name = values[index]
    if (!name.startsWith('--')) throw new Error(`unexpected argument: ${name}`)
    result[name.slice(2)] = values[++index]
  }
  return result
}
