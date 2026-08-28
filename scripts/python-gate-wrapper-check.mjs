import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const repoRoot = process.cwd()
const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'read-web-python-gate-wrapper-'))
const configPath = path.resolve(repoRoot, 'config/runtime.optimization.json')
const targetSource = [
  'import json',
  'import os',
  'import sys',
  'print(json.dumps({"argv": sys.argv[1:], "runtimeConfig": os.environ.get("READ_WEB_RUNTIME_CONFIG", ""), "python": os.environ.get("READ_WEB_PYTHON", "")}))',
  '',
].join('\n')

try {
  for (const testCase of [
    {
      name: 'backend benchmark argv',
      filename: 'backend-http-benchmark.py',
      targetArgs: ['--rounds', '1', '--warmup', '0'],
    },
    {
      name: 'atomic sentence warehouse argv',
      filename: 'test_atomic_sentence_warehouse_builder.py',
      targetArgs: [],
    },
  ]) {
    const targetPath = path.join(tempRoot, testCase.filename)
    await writeFile(targetPath, targetSource, 'utf8')
    const result = spawnSync(process.execPath, [
      'scripts/run-python-gate.mjs',
      targetPath,
      '--config',
      configPath,
      ...testCase.targetArgs,
    ], {
      cwd: repoRoot,
      env: process.env,
      encoding: 'utf8',
      windowsHide: true,
    })
    assert.equal(result.status, 0, `${testCase.name} failed:\n${result.stdout}\n${result.stderr}`)
    const report = JSON.parse(result.stdout.trim())
    assert.deepEqual(report.argv, testCase.targetArgs, `${testCase.name} received wrapper arguments`)
    assert.equal(report.runtimeConfig, configPath, `${testCase.name} did not receive the selected RuntimeConfig`)
    assert.ok(report.python, `${testCase.name} did not receive the selected Python identity`)
    assert.equal(report.argv.includes('--config'), false, `${testCase.name} received wrapper --config`)
  }
} finally {
  await rm(tempRoot, { recursive: true, force: true })
}

console.log('python gate wrapper argument regression check passed')
