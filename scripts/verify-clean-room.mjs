import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { spawn } from 'node:child_process'

const repositoryRoot = path.resolve(import.meta.dirname, '..')
const cleanRoot = await mkdtemp(path.join(tmpdir(), 'read-web-clean-room-'))
const archivePath = path.join(cleanRoot, 'source.zip')
const sourceRoot = path.join(cleanRoot, 'source')
const pythonRoot = path.join(cleanRoot, 'python')
const keep = process.env.READ_WEB_KEEP_CLEAN_ROOM === '1'
const python = process.env.READ_WEB_PYTHON || process.env.PYTHON || 'python'

try {
  console.log(`clean-room source: git HEAD -> ${sourceRoot}`)
  await run('git', ['archive', '--format=zip', '-o', archivePath, 'HEAD'], { cwd: repositoryRoot })
  await runPowerShell(`Expand-Archive -LiteralPath '${escapePowerShell(archivePath)}' -DestinationPath '${escapePowerShell(sourceRoot)}'`)

  await runNpm(['ci', '--ignore-scripts'], sourceRoot)
  await runNpm(['audit', '--audit-level=moderate'], sourceRoot)
  await runNpm(['run', 'build'], sourceRoot)

  await run(python, ['-m', 'venv', pythonRoot], { cwd: sourceRoot })
  const cleanPython = process.platform === 'win32'
    ? path.join(pythonRoot, 'Scripts', 'python.exe')
    : path.join(pythonRoot, 'bin', 'python')
  await run(cleanPython, [
    '-m', 'pip', 'install', '--disable-pip-version-check', '--require-hashes',
    '--only-binary=:all:', '-r', 'tools/subtitle-workflow/requirements-service.lock',
  ], { cwd: sourceRoot })
  await run(cleanPython, ['tools/subtitle-workflow/scripts/verify_runtime_dependencies.py', '--profile', 'service'], { cwd: sourceRoot })
  await run(cleanPython, ['-m', 'unittest', 'discover', '-s', 'tests', '-p', 'test_*.py'], {
    cwd: path.join(sourceRoot, 'tools', 'subtitle-workflow'),
  })

  for (const relativePath of ['dist/index.html', 'dist/srs-review.html', 'dist/personalization-shadow.html']) {
    const info = await stat(path.join(sourceRoot, relativePath))
    if (!info.isFile() || info.size === 0) throw new Error(`clean-room artifact is missing: ${relativePath}`)
  }
  console.log('clean-room verification passed: npm ci, zero moderate+ audit findings, build, hashed Python install, dependency inventory, backend tests')
} finally {
  if (keep) console.log(`READ_WEB_KEEP_CLEAN_ROOM=1; retained ${cleanRoot}`)
  else await rm(cleanRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}

function runNpm(args, cwd) {
  return process.platform === 'win32'
    ? run('npm.cmd', args, { cwd, shell: true })
    : run('npm', args, { cwd })
}

function runPowerShell(command) {
  return run('powershell', ['-NoProfile', '-NonInteractive', '-Command', command], { cwd: cleanRoot })
}

function run(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd || repositoryRoot,
      env: process.env,
      stdio: 'inherit',
      windowsHide: true,
      shell: options.shell === true,
    })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) resolvePromise()
      else reject(new Error(`${command} exited ${code ?? 'unknown'}${signal ? ` (${signal})` : ''}`))
    })
  })
}

function escapePowerShell(value) {
  return String(value).replaceAll("'", "''")
}
