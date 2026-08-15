import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { isBrowserSafePort, RESERVED_DAILY_PORTS } from './lib/browser-port-policy.mjs'

const projectRoot = path.resolve(import.meta.dirname, '..')
const readProjectFile = (fileName) => readFile(path.join(projectRoot, fileName), 'utf8')
const [readme, operations, testingGates, verifyFull] = await Promise.all([
  readProjectFile('README.md'),
  readProjectFile('docs/OPERATIONS.md'),
  readProjectFile('docs/testing-gates.md'),
  readProjectFile('scripts/verify-full.mjs'),
])

assert.deepEqual([...RESERVED_DAILY_PORTS].sort((left, right) => left - right), [5173, 8765])
for (const port of [5173, 8765]) {
  assert.equal(isBrowserSafePort(port), false, `${port} must remain excluded from browser-owned ports`)
}
for (const port of [4193, 4194]) {
  assert.equal(isBrowserSafePort(port), true, `${port} must remain available for the fixed verify-full Vite owners`)
}

assert.match(verifyFull, /dev:\s*'4193'/)
assert.match(verifyFull, /preview:\s*'4194'/)
assert.match(verifyFull, /independent production host lifecycle and browser journeys/)
assert.match(verifyFull, /compatibility consumer map browser capture/)

for (const [name, contents] of Object.entries({ README: readme, OPERATIONS: operations, 'testing-gates': testingGates })) {
  assert.match(contents, /5173\/8765/, `${name} must name both daily ports`)
  assert.match(contents, /随机/, `${name} must explain random owned journey ports`)
  assert.match(contents, /browser-safe/, `${name} must identify the shared browser-safe policy`)
  assert.doesNotMatch(contents, /只(?:使用|用)[^\n。]*4193\/4194(?:\/4195)?/, `${name} must not claim all browser checks use only fixed ports`)
}

const fixedToRandomPortPattern = /4193[\s\S]{0,600}4194[\s\S]{0,600}随机/
assert.match(readme, fixedToRandomPortPattern, 'README must distinguish fixed Vite ports from random journeys')
assert.match(operations, fixedToRandomPortPattern, 'OPERATIONS must distinguish fixed Vite ports from random journeys')
assert.match(testingGates, fixedToRandomPortPattern, 'testing-gates must distinguish fixed Vite ports from random journeys')

console.log('port ownership documentation checks passed')
