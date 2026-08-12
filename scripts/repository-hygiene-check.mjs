import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const root = path.resolve(import.meta.dirname, '..')
const attributes = fs.readFileSync(path.join(root, '.gitattributes'), 'utf8')
const editorConfig = fs.readFileSync(path.join(root, '.editorconfig'), 'utf8')
const ignore = fs.readFileSync(path.join(root, '.gitignore'), 'utf8')
const envExample = fs.readFileSync(path.join(root, '.env.example'), 'utf8')

assert.match(attributes, /^\* text=auto eol=lf$/m)
assert.match(attributes, /^\*\.ps1 text eol=crlf$/m)
assert.match(editorConfig, /^charset = utf-8$/m)
assert.match(editorConfig, /^end_of_line = lf$/m)
for (const pattern of ['.claude/settings.local.json', 'cankao/dist/', '*.sqlite.previous', '*.sqlite.build-*']) {
  assert.equal(ignore.includes(pattern), true, `missing ignore rule: ${pattern}`)
}
assert.match(envExample, /^# READ_WEB_RUNTIME_CONFIG=/m)
assert.equal(/(?:token|key|secret)\s*=\s*[^\s#]+/i.test(envExample), false, '.env.example must not contain secrets')

const trackedIgnored = execFileSync('git', ['ls-files', '-ci', '--exclude-standard'], {
  cwd: root,
  encoding: 'utf8',
}).trim().split(/\r?\n/).filter(Boolean)
const stillPresentTrackedIgnored = trackedIgnored.filter((relative) => fs.existsSync(path.join(root, relative)))
assert.deepEqual(stillPresentTrackedIgnored, [], `tracked files must not also be ignored:\n${stillPresentTrackedIgnored.join('\n')}`)

console.log('repository hygiene check passed')
