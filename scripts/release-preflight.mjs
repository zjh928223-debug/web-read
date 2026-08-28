import { execFileSync } from 'node:child_process'
import { stat } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { resolvePreviousReleaseSource } from './lib/release-manifest.mjs'
import { PythonRuntimeError, resolveSelectedPython, runPythonHealth, runPythonOsv } from './lib/python-runtime.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = parseArgs(process.argv.slice(2))
const previousRoot = args['previous-root'] || process.env.READ_WEB_PREVIOUS_RELEASE_ROOT || ''
const previousManifest = args['previous-manifest'] || process.env.READ_WEB_PREVIOUS_RELEASE_MANIFEST || ''

try {
  const source = await resolvePreviousReleaseSource({ previousRoot, previousManifest })
  if (source.kind !== 'manifest') throw typed('RELEASE_PREVIOUS_MANIFEST_REQUIRED', 'formal release gates require an explicit verified previous-release manifest')
  await assertCandidatePreconditions(repoRoot)
  const selected = await resolveSelectedPython({ repoRoot, configPath: args.config || '' })
  const health = runPythonHealth({ repoRoot, selected, lockPath: path.join('tools', 'subtitle-workflow', 'requirements-service.lock') })
  const osvProduction = runPythonOsv({ repoRoot, selected, lockPath: path.join('tools', 'subtitle-workflow', 'requirements-service.lock') })
  const osvTest = runPythonOsv({ repoRoot, selected, lockPath: path.join('tools', 'subtitle-workflow', 'requirements-service-test.lock') })
  const result = {
    status: 'passed',
    previous: {
      kind: source.kind,
      root: source.root,
      manifestPath: source.manifestPath,
      manifestSha256: source.manifestSha256,
      releaseId: source.manifest.release.releaseId,
    },
    python: { executable: selected.executable, health, osv: { production: osvProduction, test: osvTest } },
  }
  console.log(JSON.stringify(result, null, 2))
  process.exit(0)
} catch (error) {
  const code = error?.code || (error instanceof PythonRuntimeError ? error.code : 'RELEASE_PREFLIGHT_FAILED')
  const message = `verify-release preflight BLOCKED[${code}]: ${error.message}`
  console.error(message)
  process.exit(2)
}

function typed(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

async function assertCandidatePreconditions(root) {
  let status
  try {
    status = execFileSync('git', ['-C', root, 'status', '--porcelain', '--untracked-files=all'], { encoding: 'utf8', windowsHide: true }).trim()
  } catch (error) {
    throw typed('RELEASE_CANDIDATE_GIT_UNAVAILABLE', `cannot inspect the release candidate Git state: ${error.message}`)
  }
  if (status) throw typed('RELEASE_CANDIDATE_NOT_CLEAN', 'formal release gates require a clean Git worktree before health/rollback stages')
  for (const relative of ['dist/index.html', 'package-lock.json', 'tools/subtitle-workflow/requirements-service.lock']) {
    try {
      const candidate = path.join(root, relative)
      const info = await stat(candidate)
      if (!info.isFile() || info.size === 0) throw new Error('empty')
    } catch {
      throw typed('RELEASE_CANDIDATE_INPUT_MISSING', `formal release candidate input is missing or empty: ${path.join(root, relative)}`)
    }
  }
}

function parseArgs(values) {
  const result = {}
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]
    if (!value.startsWith('--')) throw typed('RELEASE_PREFLIGHT_ARGUMENT', `unexpected argument: ${value}`)
    result[value.slice(2)] = values[++index]
  }
  return result
}
