import { execFileSync, spawnSync } from 'node:child_process'
import os from 'node:os'
import { readFile, realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

// Keep this convention in sync with Get-OptimizationDefaultPythonPath in
// optimization-release.psm1. It is a user-owned path, never a repo venv.
const DEFAULT_OPTIMIZATION_VENV_RELATIVE_PATH = path.join(
  'Read-Web',
  'optimization-python',
  'Scripts',
  'python.exe',
)

export class PythonRuntimeError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'PythonRuntimeError'
    this.code = code
  }
}

export function resolveRuntimeConfigPath(repoRoot, explicit = '', env = process.env) {
  const configured = explicit || env.READ_WEB_RUNTIME_CONFIG || path.join(repoRoot, 'config', 'runtime.optimization.json')
  const resolved = path.resolve(repoRoot, configured)
  return resolved
}

export function getDefaultOptimizationPythonPath({ env = process.env, platform = process.platform } = {}) {
  if (platform !== 'win32') return ''
  const localAppData = env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local')
  return path.join(localAppData, DEFAULT_OPTIMIZATION_VENV_RELATIVE_PATH)
}

export async function resolveSelectedPython({ repoRoot = process.cwd(), configPath = '', env = process.env, platform = process.platform } = {}) {
  const resolvedConfig = resolveRuntimeConfigPath(repoRoot, configPath, env)
  let payload
  try {
    payload = JSON.parse(await readFile(resolvedConfig, 'utf8'))
  } catch (error) {
    throw new PythonRuntimeError('RUNTIME_CONFIG_INVALID', `RuntimeConfig could not be read: ${resolvedConfig}: ${error.message}`)
  }
  const explicit = env.READ_WEB_PYTHON || env.READ_WEB_PYTHON_PATH
  const defaultVenv = getDefaultOptimizationPythonPath({ env, platform })
  const raw = explicit || (defaultVenv && await isFile(defaultVenv) ? defaultVenv : '') || payload?.python?.executable
  if (!raw || typeof raw !== 'string') throw new PythonRuntimeError('PYTHON_NOT_CONFIGURED', `RuntimeConfig does not select a Python executable: ${resolvedConfig}`)
  const executable = await resolveExecutable(repoRoot, raw, path.dirname(resolvedConfig))
  return { executable, configPath: resolvedConfig, configuredValue: raw }
}

export async function resolveExecutable(repoRoot, rawValue, baseDir = repoRoot) {
  const raw = String(rawValue).trim()
  const candidate = path.resolve(baseDir, raw)
  if (await isFile(candidate)) return canonicalPath(candidate)
  const resolver = process.platform === 'win32' ? 'where.exe' : 'which'
  try {
    const output = execFileSync(resolver, [raw], { cwd: repoRoot, encoding: 'utf8', windowsHide: true })
    const first = output.split(/\r?\n/).map((line) => line.trim()).find(Boolean)
    if (first && await isFile(first)) return canonicalPath(first)
  } catch {}
  throw new PythonRuntimeError('PYTHON_NOT_FOUND', `selected Python executable was not found: ${raw}`)
}

async function canonicalPath(value) {
  try { return await realpath(value) } catch { return path.resolve(value) }
}

async function isFile(value) {
  try { return (await stat(value)).isFile() } catch { return false }
}

export function gateEnvironment(selected) {
  return {
    ...process.env,
    READ_WEB_PYTHON: selected.executable,
    READ_WEB_PYTHON_PATH: selected.executable,
    READ_WEB_RUNTIME_CONFIG: selected.configPath,
  }
}

export function runPythonHealth({ repoRoot = process.cwd(), selected, lockPath, probeImports = true } = {}) {
  if (!selected?.executable) throw new PythonRuntimeError('PYTHON_NOT_SELECTED', 'cannot run Python health without a selected executable')
  const script = path.join(repoRoot, 'tools', 'subtitle-workflow', 'scripts', 'verify_python_dependency_health.py')
  const args = [script, '--config', selected.configPath, '--expected-executable', selected.executable, '--lock', path.resolve(repoRoot, lockPath || path.join('tools', 'subtitle-workflow', 'requirements-service.lock')), '--json']
  if (!probeImports) args.push('--no-import-probe')
  const result = spawnSync(selected.executable, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    windowsHide: true,
    env: gateEnvironment(selected),
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const output = `${result.stdout || ''}`.trim()
  let report = null
  try { report = output ? JSON.parse(output) : null } catch {}
  if (result.error || result.status !== 0 || !report || report.status !== 'passed') {
    const details = report?.error || `${result.stderr || ''}\n${output}`.trim() || result.error?.message || `exit ${result.status}`
    throw new PythonRuntimeError('PYTHON_DEPENDENCY_HEALTH_FAILED', `selected Python failed production dependency health: ${details}`)
  }
  return report
}

export function runPythonOsv({ repoRoot = process.cwd(), selected, lockPath } = {}) {
  if (!selected?.executable) throw new PythonRuntimeError('PYTHON_NOT_SELECTED', 'cannot run OSV audit without a selected executable')
  const script = path.join(repoRoot, 'tools', 'subtitle-workflow', 'scripts', 'audit_python_dependencies.py')
  const args = [script, '--config', selected.configPath, '--expected-executable', selected.executable, '--lock', path.resolve(repoRoot, lockPath), '--json']
  const result = spawnSync(selected.executable, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    windowsHide: true,
    env: gateEnvironment(selected),
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const output = `${result.stdout || ''}`.trim()
  let report = null
  try { report = output ? JSON.parse(output) : null } catch {}
  if (result.error || result.status !== 0 || !report || report.status !== 'ok') {
    const details = report?.error || (report?.findings?.length ? `OSV findings: ${report.findings.map((item) => item.id).join(', ')}` : '') || `${result.stderr || ''}\n${output}`.trim() || result.error?.message || `exit ${result.status}`
    throw new PythonRuntimeError('OSV_AUDIT_FAILED', `OSV release audit failed closed: ${details}`)
  }
  return report
}
