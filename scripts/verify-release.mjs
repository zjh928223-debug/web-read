import { spawn } from 'node:child_process'
import process from 'node:process'

const releaseInputArgs = []
for (const name of ['previous-root', 'previous-manifest', 'config']) {
  const index = process.argv.indexOf(`--${name}`)
  if (index >= 0 && process.argv[index + 1]) releaseInputArgs.push(`--${name}`, process.argv[index + 1])
}

const stages = [
  ['complete persistence fault matrix', process.execPath, ['scripts/persistence-fault-matrix.mjs', '--require-complete']],
  ['clean-room install and build', process.execPath, ['scripts/verify-clean-room.mjs']],
  ['full behavior gate', process.execPath, ['scripts/verify-full.mjs']],
  ['performance budget contract', process.execPath, ['scripts/perf/validate-performance-budgets.mjs']],
  ['isolated browser performance journeys (3 runs)', process.execPath, ['scripts/perf/run-browser-budget-candidate.mjs']],
  ['browser baseline diff and budget gate', process.execPath, ['scripts/perf/performance-budget-gate.mjs']],
  ['offline 1k/10k playback scale gate', process.execPath, ['scripts/perf/run-playback-scale-gate.mjs']],
  ['isolated 30-minute stability rehearsal (12.4)', process.execPath, ['scripts/release-stability-rehearsal.mjs']],
  ['legacy versus next fixture differential (12.5)', process.execPath, ['scripts/release-version-differential.mjs']],
  ['isolated backend HTTP benchmark', process.execPath, ['scripts/run-python-gate.mjs', 'scripts/perf/backend-http-benchmark.py', '--config', 'config/runtime.optimization.json']],
  ['isolated application-state foundation rehearsal (12.1)', process.execPath, ['scripts/application-backup-release-rehearsal.mjs']],
  ['six-domain atomic visibility and application-startup recovery (12.2)', process.execPath, ['scripts/application-backup-atomic-boundary-check.mjs']],
  ['real six-domain backup/restore round trip (12.2)', process.execPath, ['scripts/application-backup-real-restore-check.mjs']],
  ['real six-domain restore fault matrix (12.2)', process.execPath, ['scripts/application-backup-restore-fault-matrix.mjs']],
  ['final and previous release manifests (12.6)', process.execPath, ['scripts/generate-release-manifest.mjs', '--require-clean', ...releaseInputArgs]],
  ['release artifact health check (12.6)', process.execPath, ['scripts/release-health-check.mjs']],
  ['non-interactive rollback dry-run (12.6)', process.execPath, ['scripts/release-rollback.mjs']],
  ['isolated shortcut switch and automatic rollback rehearsal (12.7)', 'powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', 'scripts/release-shortcut-rollback-rehearsal.ps1']],
]

const pending = []

console.log('verify-release included:')
stages.forEach(([label], index) => console.log(`  ${index + 1}. ${label}`))
console.log('verify-release evidence rule: canonical architecture is prerequisite evidence only; behavior, browser, performance, and recovery stages remain independently required.')
console.log('verify-release pending before migration: none')

const preflightArgs = ['scripts/release-preflight.mjs', ...releaseInputArgs]
const preflightCode = await runStage('release preflight (previous source, Python health, OSV)', process.execPath, preflightArgs)
if (preflightCode !== 0) {
  console.error('verify-release status: BLOCKED; release preflight did not establish a verified previous source and production Python environment')
  process.exit(2)
}

if (process.argv.includes('--list')) {
  console.log('verify-release status: READY; release preflight passed and all release stages are implemented')
  process.exit(0)
}

if (pending.length) {
  console.error('\nverify-release BLOCKED: pending release work remains.')
  console.error('Run npm run verify:backup-restore-rehearsal for the 12.1 foundation rehearsal and complete every pending gate before release.')
  process.exit(2)
}

for (const [label, executable, args] of stages) {
  console.log(`\n[verify-release] ${label}`)
  const code = await runStage(label, executable, args)
  if (code !== 0) {
    console.error(`verify-release failed at ${label} (exit ${code})`)
    process.exit(code)
  }
}

console.log('\nRelease gate passed.')

function runStage(label, executable, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: 'inherit',
      windowsHide: true,
      shell: process.platform === 'win32' && executable.endsWith('.cmd'),
    })
    child.once('error', reject)
    child.once('exit', (value) => resolve(value ?? 1))
  })
}
