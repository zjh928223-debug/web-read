import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(scriptDirectory, '..')
const workflowRoot = resolve(projectRoot, 'tools', 'subtitle-workflow')
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'

const isolatedPorts = Object.freeze({
  dev: '4193',
  preview: '4194',
})

const included = [
  command('fast gate (canonical architecture + behavior)', npmCommand, ['run', 'verify:fast']),
  command('Python dependency health (selected Production Host interpreter)', process.execPath, ['scripts/run-python-gate.mjs', 'tools/subtitle-workflow/scripts/verify_python_dependency_health.py', '--config', 'config/runtime.optimization.json', '--json']),
  command('persistence fault matrix evidence', process.execPath, ['scripts/persistence-fault-matrix.mjs']),
  command('real application backup/restore round trip', process.execPath, ['scripts/application-backup-real-restore-check.mjs']),
  command('real application backup/restore fault matrix', process.execPath, ['scripts/application-backup-restore-fault-matrix.mjs']),
  command('workflow application restore tests', process.execPath, ['scripts/run-python-command.mjs', '--config', 'config/runtime.optimization.json', '--cwd', 'tools/subtitle-workflow', '--', '-m', 'unittest', 'tests.test_application_backup_restore']),
  command('frontend production build', npmCommand, ['run', 'build']),
  command('optimization built launcher lifecycle and release safety', npmCommand, ['run', 'verify:optimization-launcher']),
  command('optimization built launcher lifecycle and release safety (pwsh)', npmCommand, ['run', 'verify:optimization-launcher:pwsh']),
  command('Windows owner focused boundary slice (Node/Python/browser)', npmCommand, ['run', 'verify:windows-owner-focused-boundaries']),
  command('Reader Session owner repository focused checks', npmCommand, ['run', 'verify:windows-owner-reader-session']),
  command('Reader Session owner C1 browser consumer journey', npmCommand, ['run', 'verify:windows-owner-reader-session-c1']),
  command('isolated development browser journeys', process.execPath, ['scripts/vite-verify.js'], {
    env: {
      READ_WEB_PORT: isolatedPorts.dev,
      READ_WEB_URL: `http://127.0.0.1:${isolatedPorts.dev}/`,
    },
  }),
  command('isolated production preview load', process.execPath, ['scripts/production-preview-load-check.cjs'], {
    env: {
      READ_WEB_PREVIEW_PORT: isolatedPorts.preview,
      READ_WEB_URL: `http://127.0.0.1:${isolatedPorts.preview}/`,
    },
  }),
  command('independent production host lifecycle and browser journeys', process.execPath, ['scripts/production-host-lifecycle-check.mjs']),
  command('reader session load browser fault journeys', process.execPath, ['scripts/reader-session-load-browser-journeys-check.mjs']),
  command('accessible request state browser journeys', process.execPath, ['scripts/accessible-request-state-browser-journeys-check.mjs']),
  command('UI compatibility store browser behavior', process.execPath, ['scripts/ui-compatibility-store-check.cjs']),
  command('compatibility consumer map browser capture', process.execPath, ['scripts/compatibility-consumer-map.mjs']),
  command('compatibility consumer map determinism', process.execPath, ['scripts/compatibility-consumer-map-determinism-check.mjs']),
  command('Python backend suite', process.execPath, ['scripts/run-python-command.mjs', '--config', 'config/runtime.optimization.json', '--cwd', 'tools/subtitle-workflow', '--', '-m', 'unittest', 'discover', '-s', 'tests', '-p', 'test_*.py']),
]

const excluded = [
  ['ports 5173/8765', 'reserved for the current daily installation and never started or stopped by this gate'],
  ['live TTS, dictionary, AI, and YouTube checks', 'may use network, credentials, paid APIs, or external media'],
  ['performance and long-duration journeys', 'planned for verify-release after budgets and fixtures exist'],
  ['clean-room install, secret/license/SBOM, and release-only rollback drill', 'planned for verify-release'],
]

function command(label, executable, args, options = {}) {
  return { label, executable, args, cwd: options.cwd || projectRoot, env: options.env || {} }
}

function printable(item) {
  return [item.executable, ...item.args].map((part) => JSON.stringify(part)).join(' ')
}

function printPlan() {
  console.log(`verify-full isolated ports: dev=${isolatedPorts.dev}, preview=${isolatedPorts.preview}`)
  console.log('verify-full layers: architecture=INCLUDED via canonical verify:architecture:source-shape, behavior=INCLUDED via canonical verify:behavior:migrated-interfaces, browser=INCLUDED, performance=EXCLUDED, release=EXCLUDED')
  console.log('verify-full included:')
  included.forEach((item, index) => console.log(`  ${index + 1}. ${item.label}: ${printable(item)}`))
  console.log('verify-full excluded:')
  excluded.forEach(([area, reason]) => console.log(`  - ${area}: ${reason}`))
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
  if (process.argv.includes('--list') || process.env.READ_WEB_TEST_PLAN_ONLY === '1') return

  const startedAt = Date.now()
  for (const [index, item] of included.entries()) {
    console.log(`\n[verify-full ${index + 1}/${included.length}] ${item.label}`)
    const result = await run(item)
    if (result.code !== 0) {
      console.error(`verify-full failed: ${item.label} exited ${result.code}${result.signal ? ` (${result.signal})` : ''}`)
      process.exitCode = result.code
      return
    }
  }
  console.log(`\nverify-full passed (${included.length} stages, ${((Date.now() - startedAt) / 1000).toFixed(1)}s)`)
}

main().catch((error) => {
  console.error(`verify-full failed to run: ${error?.message || error}`)
  process.exitCode = 1
})
