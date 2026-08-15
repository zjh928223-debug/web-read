import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const included = [
  ['reader runtime assembly lifecycle', 'scripts/runtime-assembly-lifecycle-check.mjs'],
  ['reader runtime assembly public behavior', 'scripts/reader-runtime-assembly-behavior-check.mjs'],
  ['session runtime adapters public behavior', 'scripts/session-runtime-adapters-behavior-check.mjs'],
  ['retired compatibility replacement behavior', 'scripts/retired-compatibility-behavior-check.mjs'],
  ['ApplicationPersistence behavior', 'scripts/application-persistence-check.mjs'],
  ['ReaderSession publisher fault behavior', 'scripts/reader-session-publisher-check.mjs'],
  ['ReaderSession loader behavior', 'scripts/youtube-workflow-loader-check.cjs'],
  ['Workflow client public behavior', 'scripts/youtube-workflow-client-check.cjs'],
]

function printPlan() {
  console.log('verify:behavior:migrated-interfaces included:')
  included.forEach(([label, script], index) => console.log(`  ${index + 1}. ${label}: ${script}`))
  console.log('verify:behavior:migrated-interfaces excluded:')
  console.log('  - source-shape-only guards: run through verify:architecture:source-shape')
  console.log('  - browser journeys: run through verify-full browser stages')
  console.log('  - performance/release/recovery: run through their dedicated gates')
}

function run(script) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(repositoryRoot, script)], {
      cwd: repositoryRoot,
      env: process.env,
      stdio: 'inherit',
      windowsHide: true,
    })
    child.once('error', reject)
    child.once('exit', (code, signal) => resolve({ code: code ?? 1, signal }))
  })
}

printPlan()
if (process.argv.includes('--list')) process.exit(0)

for (const [index, [label, script]] of included.entries()) {
  console.log(`\n[behavior ${index + 1}/${included.length}] ${label}`)
  const result = await run(script)
  if (result.code !== 0) {
    console.error(`verify:behavior:migrated-interfaces failed: ${label} exited ${result.code}${result.signal ? ` (${result.signal})` : ''}`)
    process.exit(result.code)
  }
}
console.log(`verify:behavior:migrated-interfaces passed (${included.length} checks)`)
