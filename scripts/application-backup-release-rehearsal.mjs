import { mkdir, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'

const repoRoot = process.cwd()
const outputPath = path.resolve(
  process.env.APPLICATION_BACKUP_REHEARSAL_OUTPUT || 'output/verification/application-backup-rehearsal.json',
)
const pythonCommand = process.env.READ_WEB_PYTHON || process.env.PYTHON || 'python'
const steps = [
  {
    name: 'browser-facing manifest/verifier contract',
    executable: process.execPath,
    args: ['scripts/application-backup-check.mjs'],
    cwd: repoRoot,
  },
  {
    name: 'application persistence domain adapter coverage',
    executable: process.execPath,
    args: ['scripts/application-backup-adapter-check.mjs'],
    cwd: repoRoot,
  },
  {
    name: 'browser-facing restore fault matrix',
    executable: process.execPath,
    args: ['scripts/application-backup-fault-injection-check.mjs'],
    cwd: repoRoot,
  },
  {
    name: 'workflow durable-state adapter',
    executable: pythonCommand,
    args: ['-m', 'unittest', 'tests.test_application_backup'],
    cwd: path.join(repoRoot, 'tools', 'subtitle-workflow'),
  },
]

const startedAt = new Date().toISOString()
const results = []
for (const step of steps) {
  const began = Date.now()
  const result = await run(step)
  results.push({
    name: step.name,
    command: [step.executable, ...step.args],
    ...result,
    durationMs: Date.now() - began,
  })
  if (result.exitCode !== 0) break
}

const evidence = {
  schemaVersion: 1,
  kind: 'isolated-backup-restore-rehearsal',
  startedAt,
  completedAt: new Date().toISOString(),
  realDataTouched: false,
  reservedDailyPortsTouched: false,
  steps: results,
  passed: results.length === steps.length && results.every((result) => result.exitCode === 0),
}
await mkdir(path.dirname(outputPath), { recursive: true })
await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8')
console.log(`backup/restore rehearsal: ${evidence.passed ? 'passed' : 'failed'}`)
console.log(`evidence: ${outputPath}`)
if (!evidence.passed) process.exitCode = 1

function run(step) {
  return new Promise((resolve, reject) => {
    const child = spawn(step.executable, step.args, {
      cwd: step.cwd,
      env: process.env,
      stdio: 'inherit',
      windowsHide: true,
      shell: process.platform === 'win32' && step.executable.endsWith('.cmd'),
    })
    child.once('error', reject)
    child.once('exit', (code, signal) => resolve({ exitCode: code ?? 1, signal: signal || null }))
  })
}
