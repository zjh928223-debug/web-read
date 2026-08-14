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
  ['isolated application-state foundation rehearsal (12.1 only; not full application restore)', process.execPath, ['scripts/application-backup-release-rehearsal.mjs']],
  ['release manifest', process.execPath, ['scripts/generate-release-manifest.mjs']],
]

const pending = [
  'application restore target adapters and atomic restore contract (12.2) — pending; the current rehearsal only exercises isolated application-state files',
  'real isolated profile domain recovery and end-to-end Reader/Vocabulary/SRS/Preview/Annotation/workflow verification (12.3) — pending',
  'shortcut rollback rehearsal (12.7)',
]

console.log('verify-release included:')
stages.forEach(([label], index) => console.log(`  ${index + 1}. ${label}`))
console.log('verify-release pending before migration:')
pending.forEach((label) => console.log(`  - ${label}`))

if (process.argv.includes('--list')) {
  console.log('verify-release status: BLOCKED by pending release gates (12.2, 12.3, 12.7)')
  process.exit(0)
}

if (pending.length) {
  console.error('\nverify-release BLOCKED: the isolated application-state foundation is not a full application restore release pass.')
  console.error('Run npm run verify:backup-restore-rehearsal for the foundation rehearsal; complete every pending gate before release.')
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
