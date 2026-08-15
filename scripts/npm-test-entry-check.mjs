import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const packageJson = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
assert.equal(packageJson.scripts.test, 'npm run verify:full', 'npm test must delegate to the repository full verification entry')

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const result = spawnSync(npmCommand, ['test', '--', '--list'], {
  cwd: root,
  env: { ...process.env, READ_WEB_TEST_PLAN_ONLY: '1' },
  encoding: 'utf8',
  maxBuffer: 4 * 1024 * 1024,
  shell: process.platform === 'win32',
})
assert.equal(result.status, 0, `${result.error?.message || ''}\n${result.stdout}\n${result.stderr}`)
const plan = `${result.stdout}\n${result.stderr}`
assert.match(plan, /verify-full layers: architecture=INCLUDED.*behavior=INCLUDED.*browser=INCLUDED.*performance=EXCLUDED.*release=EXCLUDED/)
assert.match(plan, /fast gate \(canonical architecture \+ behavior\)/)
assert.match(plan, /isolated development browser journeys/)
assert.match(plan, /Python backend suite/)
assert.doesNotMatch(plan, /npm(?:\.cmd)?\s+test(?:\s|$)/, 'the npm test plan must not recurse into itself')

console.log('npm test entry execution graph passed')
