import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(scriptDirectory, '..')
const workflowRoot = resolve(projectRoot, 'tools', 'subtitle-workflow')
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const pythonCommand = process.env.READ_WEB_PYTHON || process.env.PYTHON || 'python'

const isolatedPorts = Object.freeze({
  dev: '4193',
  preview: '4194',
})

const included = [
  command('fast gate (canonical architecture + behavior)', npmCommand, ['run', 'verify:fast']),
  command('persistence fault matrix evidence', process.execPath, ['scripts/persistence-fault-matrix.mjs']),
  command('frontend production build', npmCommand, ['run', 'build']),
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
  command('Python backend suite', pythonCommand, ['-m', 'unittest', 'discover', '-s', 'tests', '-p', 'test_*.py'], {
    cwd: workflowRoot,
  }),
]

const excluded = [
  ['ports 5173/8765', 'reserved for the current daily installation and never started or stopped by this gate'],
  ['live TTS, dictionary, AI, and YouTube checks', 'may use network, credentials, paid APIs, or external media'],
  ['performance and long-duration journeys', 'planned for verify-release after budgets and fixtures exist'],
  ['clean-room install, secret/license/SBOM, backup/restore, and rollback drill', 'planned for verify-release'],
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
  if (process.argv.includes('--list')) return

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
