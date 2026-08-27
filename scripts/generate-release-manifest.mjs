import { execFileSync } from 'node:child_process'
import { mkdir, readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { sha256File, writeJsonAtomic } from './lib/release-manifest.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = parseArgs(process.argv.slice(2))
const outputDir = path.resolve(args.output || path.join(repoRoot, 'output', 'release'))
const previousRoot = path.resolve(args['previous-root'] || process.env.READ_WEB_PREVIOUS_RELEASE_ROOT || 'E:\\read-web')

if (args['require-clean'] && git(repoRoot, 'status', '--porcelain')) throw new Error('release candidate requires a clean Git worktree')
await stat(path.join(repoRoot, 'dist', 'index.html'))
await stat(path.join(previousRoot, 'index.html'))
await mkdir(outputDir, { recursive: true })

const current = await createManifest(repoRoot, 'candidate')
const previous = await createManifest(previousRoot, 'previous')
await writeJsonAtomic(path.join(outputDir, 'release-manifest.json'), current)
await writeJsonAtomic(path.join(outputDir, 'previous-release-manifest.json'), previous)
await writeJsonAtomic(path.join(outputDir, 'release-state.json'), {
  schema: 'read-web.release-state',
  schemaVersion: 1,
  status: 'staged',
  generatedAt: new Date().toISOString(),
  active: { manifest: 'release-manifest.json', root: repoRoot, releaseId: current.release.gitSha },
  previous: { manifest: 'previous-release-manifest.json', root: previousRoot, releaseId: previous.release.gitSha },
})

console.log(`Release manifests written: ${outputDir}`)
console.log(`current=${current.release.gitSha} previous=${previous.release.gitSha}`)

async function createManifest(root, role) {
  const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
  const artifactPaths = await collectArtifacts(root)
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    role,
    release: {
      application: packageJson.name,
      frontendVersion: packageJson.version,
      productionHostVersion: '0.2.3',
      backendVersion: '0.2.3',
      gitSha: git(root, 'rev-parse', 'HEAD'),
      gitBranch: git(root, 'branch', '--show-current'),
      dirty: Boolean(git(root, 'status', '--porcelain')),
      root,
    },
    runtime: {
      node: process.version,
      npm: packageJson.packageManager?.replace(/^npm@/, '') || null,
      python: command(root, 'python', ['--version']),
    },
    dependencyLocks: {
      node: await optionalHash(root, 'package-lock.json'),
      python: await optionalHash(root, 'tools/subtitle-workflow/requirements-service.lock'),
    },
    externalTools: {
      ffmpeg: command(root, 'ffmpeg', ['-version'])?.split(/\r?\n/, 1)[0] || null,
      ytDlp: command(root, 'yt-dlp', ['--version']),
      whisperx: command(root, 'whisperx', ['--version']),
    },
    dataCompatibility: {
      indexedDb: { name: 'SeekPlayerDB', version: 1, objectStore: 'files' },
      workflowServiceVersion: '0.2.3',
      rollback: { minimumSchemaVersion: 1, maximumSchemaVersion: 1, reversible: true },
    },
    configuration: { schemaVersion: 1, minimumCompatible: 1, maximumCompatible: 1 },
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
    'vite.config.mjs', 'scripts/launch-next-preview.ps1',
    'tools/subtitle-workflow/requirements-service.txt',
    'tools/subtitle-workflow/requirements-service.lock',
    'tools/subtitle-workflow/youtube_workflow/service.py',
    'tools/subtitle-workflow/youtube_workflow/production_host_prototype.py',
  ]
  const files = []
  for (const relative of [...required, ...optional]) {
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

function git(root, ...values) {
  return execFileSync('git', ['-C', root, ...values], { encoding: 'utf8', windowsHide: true }).trim()
}

function command(root, file, values) {
  try { return execFileSync(file, values, { cwd: root, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }).trim() } catch { return null }
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
