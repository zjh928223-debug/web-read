import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const defaultOutput = path.join(repoRoot, 'output', 'release', 'release-manifest.json')
const outputPath = path.resolve(process.argv[2] || defaultOutput)

const trackedArtifacts = [
  'package.json',
  'package-lock.json',
  'vite.config.js',
  'scripts/launch-next-preview.ps1',
  'tools/subtitle-workflow/requirements-service.txt',
  'tools/subtitle-workflow/youtube_workflow/service.py',
]

function command(file, args) {
  try {
    return execFileSync(file, args, {
      cwd: repoRoot,
      encoding: 'utf8',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return null
  }
}

async function describeArtifact(relativePath) {
  const absolutePath = path.join(repoRoot, relativePath)
  try {
    const [content, info] = await Promise.all([readFile(absolutePath), stat(absolutePath)])
    return {
      path: relativePath.replaceAll('\\', '/'),
      bytes: info.size,
      sha256: createHash('sha256').update(content).digest('hex'),
    }
  } catch (error) {
    return {
      path: relativePath.replaceAll('\\', '/'),
      missing: true,
      error: error?.code || 'READ_FAILED',
    }
  }
}

const packageJson = JSON.parse(await readFile(path.join(repoRoot, 'package.json'), 'utf8'))
const gitStatus = command('git', ['status', '--porcelain'])
const manifest = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  release: {
    application: packageJson.name,
    frontendVersion: packageJson.version,
    backendVersion: '0.2.3',
    gitSha: command('git', ['rev-parse', 'HEAD']),
    gitBranch: command('git', ['branch', '--show-current']),
    dirty: Boolean(gitStatus),
  },
  runtime: {
    node: process.version,
    npm: packageJson.packageManager?.replace(/^npm@/, '') || null,
    python: command('python', ['--version']),
  },
  dataCompatibility: {
    indexedDb: { name: 'SeekPlayerDB', version: 1, objectStore: 'files' },
    workflowServiceVersion: '0.2.3',
  },
  artifacts: await Promise.all(trackedArtifacts.map(describeArtifact)),
}

await mkdir(path.dirname(outputPath), { recursive: true })
const temporaryPath = `${outputPath}.${process.pid}.tmp`
await writeFile(temporaryPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
await rename(temporaryPath, outputPath)

console.log(`Release manifest written: ${outputPath}`)
console.log(`gitSha=${manifest.release.gitSha} dirty=${manifest.release.dirty}`)
if (manifest.artifacts.some((artifact) => artifact.missing)) process.exitCode = 1
