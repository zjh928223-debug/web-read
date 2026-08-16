import { spawn } from 'node:child_process'
import process from 'node:process'

const stages = [
  ['complete persistence fault matrix', process.execPath, ['scripts/persistence-fault-matrix.mjs', '--require-complete']],
  ['clean-room install and build', process.execPath, ['scripts/verify-clean-room.mjs']],
  ['full behavior gate', process.execPath, ['scripts/verify-full.mjs']],
  ['performance budget contract', process.execPath, ['scripts/perf/validate-performance-budgets.mjs']],
  ['isolated browser performance journeys (3 runs)', process.execPath, ['scripts/perf/run-browser-budget-candidate.mjs']],
  ['browser baseline diff and budget gate', process.execPath, ['scripts/perf/performance-budget-gate.mjs']],
  ['offline 1k/10k playback scale gate', process.execPath, ['scripts/perf/run-playback-scale-gate.mjs']],
  ['isolated backend HTTP benchmark', 'python', ['scripts/perf/backend-http-benchmark.py']],
  ['isolated application-state foundation rehearsal (12.1)', process.execPath, ['scripts/application-backup-release-rehearsal.mjs']],
  ['six-domain atomic visibility and application-startup recovery (12.2)', process.execPath, ['scripts/application-backup-atomic-boundary-check.mjs']],
  ['real six-domain backup/restore round trip (12.2)', process.execPath, ['scripts/application-backup-real-restore-check.mjs']],
  ['real six-domain restore fault matrix (12.2)', process.execPath, ['scripts/application-backup-restore-fault-matrix.mjs']],
  ['release manifest', process.execPath, ['scripts/generate-release-manifest.mjs']],
]

const pending = [
  'real isolated profile domain recovery and end-to-end Reader/Vocabulary/SRS/Preview/Annotation/workflow verification (12.3) — pending',
  'cold-start, long-playback, restart, cancellation, quota/corruption, and memory-growth evidence (12.4) — pending',
  'old-version versus next fixture performance/behavior differential (12.5) — pending',
  'final release manifest, checksums, previous manifest, health-check, and rollback rehearsal (12.6) — pending',
  'shortcut rollback rehearsal (12.7) — pending',
  'user-approved desktop shortcut migration after every release gate (12.8) — pending',
]

console.log('verify-release included:')
stages.forEach(([label], index) => console.log(`  ${index + 1}. ${label}`))
console.log('verify-release evidence rule: canonical architecture is prerequisite evidence only; behavior, browser, performance, and recovery stages remain independently required.')
console.log('verify-release pending before migration:')
pending.forEach((label) => console.log(`  - ${label}`))

if (process.argv.includes('--list')) {
  console.log('verify-release status: BLOCKED by pending release gates (12.3, 12.4, 12.5, 12.6, 12.7, 12.8)')
  process.exit(0)
}

if (pending.length) {
  console.error('\nverify-release BLOCKED: 12.3/12.4/12.5/12.6/12.7/12.8 release gates are still pending.')
  console.error('Run npm run verify:backup-restore-rehearsal for the 12.1 foundation rehearsal and complete every pending gate before release.')
  process.exit(2)
}

for (const [label, executable, args] of stages) {
  console.log(`\n[verify-release] ${label}`)
  const code = await new Promise((resolve, reject) => {
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
  if (code !== 0) {
    console.error(`verify-release failed at ${label} (exit ${code})`)
    process.exit(code)
  }
}

console.log('\nRelease gate passed.')
