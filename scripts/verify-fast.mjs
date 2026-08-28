import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(scriptDirectory, '..')
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'

const included = [
  command('toolchain contract', npmCommand, ['run', 'verify:toolchain']),
  command('Python dependency lock (selected RuntimeConfig interpreter)', process.execPath, ['scripts/run-python-gate.mjs', 'tools/subtitle-workflow/scripts/verify_python_lock.py', '--config', 'config/runtime.optimization.json']),
  command('test inventory freshness and ownership', npmCommand, ['run', 'verify:test-inventory']),
  command('test inventory classifier self-test (canonical)', npmCommand, ['run', 'verify:architecture:test-inventory']),
  command('architecture source-shape guards (canonical)', npmCommand, ['run', 'verify:architecture:source-shape']),
  command('migrated interface behavior (canonical)', npmCommand, ['run', 'verify:behavior:migrated-interfaces']),
  command('compatibility network policy behavior', process.execPath, ['scripts/compatibility-network-policy-check.mjs']),
  command('browser port policy', npmCommand, ['run', 'verify:browser-port-policy']),
  command('port ownership documentation guard', npmCommand, ['run', 'verify:port-ownership-docs']),
  command('compatibility process isolation boundary', npmCommand, ['run', 'verify:compatibility-isolation']),
  command('npm test entry execution graph', npmCommand, ['run', 'verify:test-entry']),
  command('script inventory', process.execPath, ['scripts/script-inventory-check.mjs']),
  command('legacy deletion gate', process.execPath, ['scripts/legacy-deletion-gate.mjs']),
  command('critical async boundary', process.execPath, ['scripts/critical-async-boundary-check.mjs']),
  command('best-effort failure policy', process.execPath, ['scripts/best-effort-check.mjs']),
  command('audio IndexedDB transaction contract', process.execPath, ['scripts/audio-store-transaction-check.mjs']),
  command('SRS pending candidate transaction contract', process.execPath, ['scripts/srs-pending-candidates-transaction-check.mjs']),
  command('application backup manifest and verifier contract', process.execPath, ['scripts/application-backup-check.mjs']),
  command('application backup adapter coverage contract', process.execPath, ['scripts/application-backup-adapter-check.mjs']),
  command('application backup restore fault contract', process.execPath, ['scripts/application-backup-fault-injection-check.mjs']),
  command('application backup path concurrency contract', process.execPath, ['scripts/application-backup-concurrency-check.mjs']),
  command('supply-chain contract', process.execPath, ['scripts/supply-chain-gate.mjs']),
  command('playback helper behavior', process.execPath, ['scripts/playback-runtime-helpers-check.cjs']),
  command('playback single-owner boundary', process.execPath, ['scripts/playback-single-owner-check.cjs']),
  command('annotation resolver behavior', process.execPath, ['scripts/annotation-bubble-resolver-check.cjs']),
  command('annotation bundle merge behavior', process.execPath, ['scripts/session-annotation-bundle-merge-check.cjs']),
  command('vocabulary acquisition behavior', process.execPath, ['scripts/vocabulary-acquisition-service-check.cjs']),
  command('vocabulary learning events behavior', process.execPath, ['scripts/vocabulary-learning-events-check.cjs']),
  command('SRS v2 behavior', process.execPath, ['scripts/srs-review-service-v2-check.cjs']),
  command('workflow client contract', process.execPath, ['scripts/youtube-workflow-client-check.cjs']),
  command('workflow loader contract', process.execPath, ['scripts/youtube-workflow-loader-check.cjs']),
  command('workflow secret boundary', process.execPath, ['scripts/youtube-workflow-secret-check.cjs']),
  command(
    'Python service dependency inventory',
    process.execPath,
    ['scripts/run-python-gate.mjs', 'tools/subtitle-workflow/scripts/verify_runtime_dependencies.py', '--profile', 'service', '--config', 'config/runtime.optimization.json'],
  ),
]

const excluded = [
  ['browser journeys', 'require an isolated Vite process and belong to verify-full'],
  ['production build/preview', 'slower artifact checks belong to verify-full'],
  ['Python backend suite', 'contains threaded integration tests and belongs to verify-full'],
  ['live TTS, dictionary, AI, and YouTube checks', 'may use network, credentials, paid APIs, or external media'],
  ['performance, clean-room, secret/license/SBOM, restore, and rollback gates', 'planned for verify-release'],
  ['legacy source-shape aliases', 'legacy verify:* names remain callable for compatibility; canonical architecture checks execute above'],
  ['browser source-shape checks', 'browser-oriented checks remain in verify-full browser journeys; their source evidence is classified separately'],
]

function command(label, executable, args, options = {}) {
  return { label, executable, args, cwd: options.cwd || projectRoot, env: options.env || {} }
}

function printable(item) {
  return [item.executable, ...item.args].map((part) => JSON.stringify(part)).join(' ')
}

function printPlan() {
  console.log('verify-fast included:')
  included.forEach((item, index) => console.log(`  ${index + 1}. ${item.label}: ${printable(item)}`))
  console.log('verify-fast excluded:')
  excluded.forEach(([area, reason]) => console.log(`  - ${area}: ${reason}`))
  console.log('verify-fast layer summary: architecture=EXECUTED (canonical), behavior=EXECUTED (canonical), browser=EXCLUDED, performance=EXCLUDED, release=EXCLUDED')
}

function run(item) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(item.executable, item.args, {
      cwd: item.cwd,
      env: { ...process.env, ...item.env },
      stdio: 'inherit',
      windowsHide: true,
      shell: process.platform === 'win32' && item.executable.endsWith('.cmd'),
    })
    child.on('error', reject)
    child.on('exit', (code, signal) => resolvePromise({ code: code ?? 1, signal }))
  })
}

async function main() {
  printPlan()
  if (process.argv.includes('--list')) return

  const startedAt = Date.now()
  for (const [index, item] of included.entries()) {
    console.log(`\n[verify-fast ${index + 1}/${included.length}] ${item.label}`)
    const result = await run(item)
    if (result.code !== 0) {
      console.error(`verify-fast failed: ${item.label} exited ${result.code}${result.signal ? ` (${result.signal})` : ''}`)
      process.exitCode = result.code
      return
    }
  }
  console.log(`\nverify-fast passed (${included.length} checks, ${((Date.now() - startedAt) / 1000).toFixed(1)}s)`)
}

main().catch((error) => {
  console.error(`verify-fast failed to run: ${error?.message || error}`)
  process.exitCode = 1
})
