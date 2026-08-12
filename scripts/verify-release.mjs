import { spawn } from 'node:child_process'
import process from 'node:process'

const stages = [
  ['clean-room install and build', process.execPath, ['scripts/verify-clean-room.mjs']],
  ['full behavior gate', process.execPath, ['scripts/verify-full.mjs']],
  ['performance budget contract', process.execPath, ['scripts/perf/validate-performance-budgets.mjs']],
  ['isolated browser performance journeys (3 runs)', process.execPath, ['scripts/perf/run-browser-budget-candidate.mjs']],
  ['browser baseline diff and budget gate', process.execPath, ['scripts/perf/performance-budget-gate.mjs']],
  ['offline 1k/10k playback scale gate', process.execPath, ['scripts/perf/run-playback-scale-gate.mjs']],
  ['isolated backend HTTP benchmark', 'python', ['scripts/perf/backend-http-benchmark.py']],
  ['release manifest', process.execPath, ['scripts/generate-release-manifest.mjs']],
]

const pending = [
  'backup/restore and shortcut rollback rehearsal',
]

console.log('verify-release included:')
stages.forEach(([label], index) => console.log(`  ${index + 1}. ${label}`))
console.log('verify-release pending before migration:')
pending.forEach((label) => console.log(`  - ${label}`))

if (process.argv.includes('--list')) process.exit(0)

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

console.log('\nCurrent release gate passed, but migration remains blocked by the printed pending gates.')
