import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import {
  loadReleaseManifestSchema,
  resolveViteConfigPath,
  sha256File,
  classifyExternalToolProbe,
  EXTERNAL_TOOL_SUPPORT_MATRIX,
  validateReleaseManifestSchema,
  writeJsonAtomic,
  resolvePreviousReleaseSource,
  validateReleaseManifestSemantics,
} from './lib/release-manifest.mjs'
import { resolveSelectedPython, runPythonHealth } from './lib/python-runtime.mjs'

process.on('uncaughtException', reportFailure)
process.on('unhandledRejection', reportFailure)

const args = parseArgs(process.argv.slice(2))
const repoRoot = path.resolve(args.root || path.join(path.dirname(fileURLToPath(import.meta.url)), '..'))
const outputDir = path.resolve(args.output || path.join(repoRoot, 'output', 'release'))
const previousRootInput = args['previous-root'] || process.env.READ_WEB_PREVIOUS_RELEASE_ROOT || ''
const previousManifestInput = args['previous-manifest'] || process.env.READ_WEB_PREVIOUS_RELEASE_MANIFEST || ''
const previousSource = await resolvePreviousReleaseSource({ previousRoot: previousRootInput, previousManifest: previousManifestInput })
assertOutputOutsideReadOnlySource(outputDir, previousSource.root)

if (args['require-clean'] && previousSource.kind !== 'manifest') {
  const error = new Error('formal release manifest generation requires an explicit, verified previous-release manifest; a legacy root is only accepted for non-formal fixture generation')
  error.code = 'RELEASE_PREVIOUS_MANIFEST_REQUIRED'
  throw error
}

if (args['require-clean'] && git(repoRoot, 'status', '--porcelain', '--untracked-files=all')) throw new Error('release candidate requires a clean Git worktree')
await stat(path.join(repoRoot, 'dist', 'index.html'))

const selectedPython = args['require-clean'] ? await resolveSelectedPython({ repoRoot, configPath: args.config || '' }) : null
const pythonHealth = args['require-clean']
  ? runPythonHealth({ repoRoot, selected: selectedPython, lockPath: path.join('tools', 'subtitle-workflow', 'requirements-service.lock') })
  : null
const current = await createManifest(repoRoot, 'candidate', {
  pythonHealth,
  source: { kind: 'working-tree', readOnly: false, provenance: 'current Git worktree' },
})
const previous = previousSource.manifest || await createManifest(previousSource.root, 'previous', {
  source: { kind: 'legacy-root', readOnly: true, provenance: 'explicit --previous-root input' },
})
const schema = await loadReleaseManifestSchema()
validateManifestOrThrow(current, schema, 'candidate', repoRoot)
validateManifestOrThrow(previous, schema, 'previous', previousSource.root)
await mkdir(outputDir, { recursive: true })
const currentManifestPath = path.join(outputDir, 'release-manifest.json')
const previousManifestPath = path.join(outputDir, 'previous-release-manifest.json')
await writeJsonAtomic(currentManifestPath, current)
if (previousSource.manifestPath && previousSource.manifestBytes) {
  await writeFile(previousManifestPath, previousSource.manifestBytes)
} else {
  await writeJsonAtomic(previousManifestPath, previous)
}
const currentManifestSha256 = await sha256File(currentManifestPath)
const previousManifestSha256 = await sha256File(previousManifestPath)
await writeJsonAtomic(path.join(outputDir, 'release-state.json'), {
  schema: 'read-web.release-state',
  schemaVersion: 1,
  status: 'staged',
  generatedAt: new Date().toISOString(),
  active: { manifest: 'release-manifest.json', root: repoRoot, releaseId: current.release.gitSha, manifestSha256: currentManifestSha256 },
  previous: { manifest: 'previous-release-manifest.json', root: previousSource.root, releaseId: previous.release.gitSha, manifestSha256: previousManifestSha256 },
})

console.log(`Release manifests written: ${outputDir}`)
console.log(`current=${current.release.gitSha} previous=${previous.release.gitSha}`)

async function createManifest(root, role, { pythonHealth = null, source = null } = {}) {
  const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
  const artifactPaths = await collectArtifacts(root)
  const sourcePaths = artifactPaths.filter((relative) => !relative.replaceAll('\\', '/').startsWith('dist/'))
  const distPaths = artifactPaths.filter((relative) => relative.replaceAll('\\', '/').startsWith('dist/'))
  const nodeVersion = resolveRuntimeVersion(root, 'node', process.execPath, ['--version'])
  const npmVersion = resolveRuntimeVersion(
    root,
    'npm',
    process.platform === 'win32' ? process.execPath : 'npm',
    process.platform === 'win32'
      ? [path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'), '--version']
      : ['--version'],
  )
  const pythonExecutable = pythonHealth?.python?.executable
    || await resolveCommandPath(root, 'python', process.env.READ_WEB_RELEASE_PYTHON || (process.platform === 'win32' ? 'python.exe' : 'python'))
  const pythonVersion = pythonHealth?.python?.version
    ? 'Python ' + pythonHealth.python.version
    : resolveRuntimeVersion(root, 'python', pythonExecutable, ['--version'])
  const nodeLock = await lockSummary(root, 'package-lock.json', 'npm')
  const pythonLock = await lockSummary(root, 'tools/subtitle-workflow/requirements-service.lock', 'pip-require-hashes')
  const externalTools = {
    ffmpeg: await toolDescriptor(root, 'ffmpeg', ['-version']),
    ytDlp: await toolDescriptor(root, 'yt-dlp', ['--version']),
    whisperx: await toolDescriptor(root, 'whisperx', ['--version']),
  }
  const runtime = {
    node: nodeVersion,
    npm: npmVersion,
    python: pythonVersion,
    pythonIdentity: pythonHealth ? {
      status: 'verified',
      executable: pythonHealth.python.executable,
      version: pythonHealth.python.version,
      packageSetSha256: pythonHealth.python.packageSetSha256,
      environmentSha256: pythonHealth.python.environmentSha256,
    } : {
      status: role === 'previous' ? 'not-declared' : 'unverified',
      executable: pythonExecutable || null,
      version: pythonVersion || null,
      packageSetSha256: null,
      environmentSha256: null,
    },
    dataRoot: process.env.READ_WEB_SUBTITLE_DATA_ROOT || null,
    sourceSha256: await digestPaths(root, sourcePaths),
    distSha256: await digestPaths(root, distPaths),
  }
  runtime.toolchainSha256 = toolchainDigest({
    node: runtime.node,
    npm: runtime.npm,
    python: runtime.python,
    packageManager: packageJson.packageManager || '',
    engines: packageJson.engines || {},
    dependencyLocks: { node: nodeLock, python: pythonLock },
    pythonIdentity: runtime.pythonIdentity,
    externalTools,
  })
  validateRuntimePolicy(packageJson, runtime, pythonLock, role, root, Boolean(args['require-clean']), pythonHealth)
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    role,
    source: source || { kind: 'working-tree', readOnly: false, provenance: 'explicit release root input' },
    release: {
      releaseId: git(root, 'rev-parse', 'HEAD'),
      application: packageJson.name,
      frontendVersion: packageJson.version,
      formatVersion: 2,
      productionHostVersion: '0.2.3',
      backendVersion: '0.2.3',
      gitSha: git(root, 'rev-parse', 'HEAD'),
      gitBranch: git(root, 'branch', '--show-current'),
      dirty: Boolean(git(root, 'status', '--porcelain', '--untracked-files=all')),
      root,
    },
    runtime,
    dependencyLocks: {
      node: nodeLock,
      python: pythonLock,
    },
    externalTools,
    dataCompatibility: {
      indexedDb: { name: 'SeekPlayerDB', version: 1, objectStore: 'files', keyPath: 'id' },
      workflowServiceVersion: '0.2.3',
      migration: { minimumSchemaVersion: 1, maximumSchemaVersion: 1, dryRunRequired: true, reversible: true },
      rollback: { minimumSchemaVersion: 1, maximumSchemaVersion: 1, reversible: true },
    },
    configuration: { schemaVersion: 1, minimumCompatible: 1, maximumCompatible: 1 },
    compatibility: {
      migration: { fromSchemaVersion: 1, toSchemaVersion: 1, dryRun: true, reversible: true },
      rollback: { minimumReleaseFormatVersion: 2, maximumReleaseFormatVersion: 2, compatible: true, dataPreserving: true, reversible: true },
    },
    artifacts: await Promise.all(artifactPaths.map(async (relative) => ({
      path: relative.replaceAll('\\', '/'),
      bytes: (await stat(path.join(root, relative))).size,
      sha256: await sha256File(path.join(root, relative)),
    }))),
  }
}

async function collectArtifacts(root) {
  const required = ['index.html', 'package.json', 'package-lock.json']
  const optional = [
    'scripts/launch-next-preview.ps1',
    'tools/subtitle-workflow/requirements-service.txt',
    'tools/subtitle-workflow/requirements-service.lock',
    'tools/subtitle-workflow/youtube_workflow/service.py',
    'tools/subtitle-workflow/youtube_workflow/production_host_prototype.py',
  ]
  const files = []
  const viteConfig = resolveViteConfigPath(root)
  for (const relative of [...required, ...(viteConfig ? [viteConfig] : []), ...optional]) {
    try {
      if ((await stat(path.join(root, relative))).isFile()) files.push(relative)
    } catch {
      if (required.includes(relative)) throw new Error(`required release artifact missing: ${path.join(root, relative)}`)
    }
  }
  try { files.push(...await walk(root, 'dist')) } catch {}
  return [...new Set(files)].sort()
}

async function walk(root, relative) {
  const entries = await readdir(path.join(root, relative), { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const child = path.join(relative, entry.name)
    if (entry.isDirectory()) files.push(...await walk(root, child))
    else if (entry.isFile()) files.push(child)
  }
  return files
}

async function optionalHash(root, relative) {
  try { return await sha256File(path.join(root, relative)) } catch { return null }
}

async function lockSummary(root, relative, kind) {
  const filename = path.join(root, relative)
  const sha256 = await optionalHash(root, relative)
  if (!sha256) return { path: relative.replaceAll('\\', '/'), sha256: null, kind, status: 'missing' }
  const summary = { path: relative.replaceAll('\\', '/'), sha256, kind, status: 'verified' }
  if (kind === 'npm') {
    try { summary.lockfileVersion = JSON.parse(await readFile(filename, 'utf8')).lockfileVersion ?? null } catch { summary.lockfileVersion = null }
  } else {
    try {
      const text = await readFile(filename, 'utf8')
      summary.requireHashLines = text.split(/\r?\n/).filter((line) => line.includes('--hash=sha256:')).length
      summary.pythonPolicy = /CPython\s+([0-9]+\.[0-9]+)/i.exec(text)?.[1] || null
    } catch {
      summary.requireHashLines = 0
      summary.pythonPolicy = null
    }
  }
  return summary
}

async function toolDescriptor(root, name, args) {
  const policy = name === 'yt-dlp' ? EXTERNAL_TOOL_SUPPORT_MATRIX.ytDlp : EXTERNAL_TOOL_SUPPORT_MATRIX[name]
  const configuredPath = process.env[`READ_WEB_RELEASE_${name === 'yt-dlp' ? 'YTDLP' : name.toUpperCase()}`]
  const executable = await resolveCommandPath(root, name, configuredPath)
  const verification = `probe=${args.join(' ')}; outputPattern=${policy.outputPattern}; supportMatrix=${policy.matrixId}; sha256=resolved-executable`
  if (!executable) {
    return {
      executable: configuredPath || name,
      version: null,
      versionLine: null,
      sha256: null,
      source: configuredPath ? 'configured-path' : 'PATH',
      verification,
      required: false,
      status: 'missing',
      supportMatrix: policy.matrixId,
      compatibility: {
        matrix: policy.matrixId,
        status: 'missing',
        supported: false,
        reason: 'executable-not-found',
      },
    }
  }
  const result = commandResult(root, executable, args)
  const probe = classifyExternalToolProbe(name, result || { exitCode: null })
  return {
    executable,
    version: probe.version,
    versionLine: probe.versionLine,
    sha256: await optionalHashAbsolute(executable),
    source: executable,
    verification,
    required: false,
    status: probe.status,
    supportMatrix: policy.matrixId,
    compatibility: probe.compatibility,
  }
}

async function resolveCommandPath(root, name, configuredPath = '') {
  const configuredAbsolute = configuredPath ? path.resolve(root, configuredPath) : ''
  if (configuredAbsolute) {
    try {
      if ((await stat(configuredAbsolute)).isFile()) return configuredAbsolute
    } catch {}
  }
  const resolver = process.platform === 'win32' ? 'where.exe' : 'which'
  try {
    const output = execFileSync(resolver, [name], { cwd: root, encoding: 'utf8', windowsHide: true })
    return output.split(/\r?\n/).map((line) => line.trim()).find(Boolean) || null
  } catch { return null }
}

async function optionalHashAbsolute(filename) {
  try { return await sha256File(filename) } catch { return null }
}

async function digestPaths(root, paths) {
  const lines = []
  for (const relative of paths.sort()) lines.push(`${relative.replaceAll('\\', '/')}:${await sha256File(path.join(root, relative))}`)
  return createHash('sha256').update(lines.join('\n')).digest('hex')
}

function git(root, ...values) {
  return execFileSync('git', ['-C', root, ...values], { encoding: 'utf8', windowsHide: true }).trim()
}

function command(root, file, values) {
  const result = commandResult(root, file, values)
  if (!result || result.error || result.exitCode !== 0) return null
  return `${result.stdout || ''}\n${result.stderr || ''}`.trim() || null
}

function commandResult(root, file, values) {
  try {
    const result = spawnSync(file, values, {
      cwd: root,
      encoding: 'utf8',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return {
      exitCode: result.status,
      stdout: result.stdout || '',
      stderr: result.stderr || '',
      error: result.error || null,
    }
  } catch (error) {
    return { exitCode: null, stdout: '', stderr: '', error }
  }
}

function resolveRuntimeVersion(root, environmentName, defaultExecutable, values) {
  const executable = process.env[`READ_WEB_RELEASE_${environmentName.toUpperCase()}`] || defaultExecutable
  const commandOutput = command(root, executable, values)
  const commandVersion = firstVersionLine(commandOutput)
  if (commandVersion) return commandVersion
  throw new Error(`release manifest runtime ${environmentName} version is unavailable: ${root}`)
}

function firstVersionLine(value) {
  if (!value) return null
  return String(value).split(/\r?\n/).map((line) => line.trim()).find(Boolean) || null
}

function versionToken(value) {
  const match = /(?<!\d)(\d+\.\d+\.\d+)(?!\d)/.exec(String(value || ''))
  return match?.[1] || null
}

function toolchainDigest(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function validateRuntimePolicy(packageJson, runtime, pythonLock, role, root, requirePackageManager = false, pythonHealth = null) {
  const expectedNode = packageJson.engines?.node
  const expectedNpm = packageJson.engines?.npm
  const actualNode = versionToken(runtime.node)
  const actualNpm = versionToken(runtime.npm)
  const actualPython = versionToken(runtime.python)
  const isCandidate = role === 'candidate'
  if (isCandidate && !/^\d+\.\d+\.\d+$/.test(String(expectedNode || ''))) {
    throw new Error(`release manifest Node policy is unavailable or unsupported: ${root}`)
  }
  if (isCandidate && !/^\d+\.\d+\.\d+$/.test(String(expectedNpm || ''))) {
    throw new Error(`release manifest npm policy is unavailable or unsupported: ${root}`)
  }
  if (expectedNode && actualNode !== expectedNode) {
    throw new Error(`release manifest Node version is unsupported: ${actualNode || runtime.node}; expected ${expectedNode}: ${root}`)
  }
  if (expectedNpm && actualNpm !== expectedNpm) {
    throw new Error(`release manifest npm version is unsupported: ${actualNpm || runtime.npm}; expected ${expectedNpm}: ${root}`)
  }
  const packageManager = String(packageJson.packageManager || '')
  if (isCandidate && requirePackageManager && !new RegExp(`^npm@${escapeRegExp(String(expectedNpm))}$`).test(packageManager)) {
    throw new Error(`release manifest packageManager must declare npm@${expectedNpm}: ${root}`)
  }
  if (packageManager && !new RegExp(`^npm@${escapeRegExp(String(expectedNpm || ''))}$`).test(packageManager)) {
    throw new Error(`release manifest packageManager does not match engines.npm: ${root}`)
  }
  const pythonPolicy = String(pythonLock.pythonPolicy || '')
  if (isCandidate && !/^\d+\.\d+$/.test(pythonPolicy)) {
    throw new Error(`release manifest Python policy is unavailable: ${root}`)
  }
  if (pythonPolicy && (!actualPython || !actualPython.startsWith(`${pythonPolicy}.`))) {
    throw new Error(`release manifest Python version is unsupported: ${actualPython || runtime.python}; expected CPython ${pythonPolicy}.x: ${root}`)
  }
  if (role === 'candidate' && requirePackageManager && (!pythonHealth || pythonHealth.status !== 'passed')) {
    throw new Error('release manifest Python dependency health is not verified: ' + root)
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function validateManifestOrThrow(manifest, schema, role, root) {
  const failures = validateReleaseManifestSchema(manifest, schema)
  failures.push(...validateReleaseManifestSemantics(manifest))
  if (failures.length) {
    throw new Error(`release manifest schema validation failed before write (${role}, ${root}): ${failures.join('; ')}`)
  }
}

function assertOutputOutsideReadOnlySource(output, sourceRoot) {
  const relative = path.relative(path.resolve(sourceRoot), path.resolve(output))
  if (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) {
    const error = new Error(`release output must be outside the read-only previous source: output=${path.resolve(output)} source=${path.resolve(sourceRoot)}`)
    error.code = 'RELEASE_OUTPUT_INSIDE_PREVIOUS_SOURCE'
    throw error
  }
}

function parseArgs(values) {
  const result = {}
  for (let index = 0; index < values.length; index += 1) {
    const name = values[index]
    if (!name.startsWith('--')) throw new Error(`unexpected argument: ${name}`)
    if (name === '--require-clean') result['require-clean'] = true
    else result[name.slice(2)] = values[++index]
  }
  return result
}

function reportFailure(error) {
  const code = error?.code || 'RELEASE_MANIFEST_FAILED'
  console.error(`release manifest BLOCKED[${code}]: ${error?.message || error}`)
  process.exitCode = 2
}
