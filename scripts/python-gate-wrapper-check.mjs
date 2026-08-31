import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { getDefaultOptimizationPythonPath, resolveSelectedPython } from './lib/python-runtime.mjs'

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
  const localAppData = path.join(tempRoot, 'local-app-data')
  const defaultPython = getDefaultOptimizationPythonPath({ env: { LOCALAPPDATA: localAppData }, platform: 'win32' })
  await mkdir(path.dirname(defaultPython), { recursive: true })
  await writeFile(defaultPython, 'fixture interpreter', 'utf8')
  const originalPython = process.env.READ_WEB_PYTHON
  const originalPythonPath = process.env.READ_WEB_PYTHON_PATH
  const originalLocalAppData = process.env.LOCALAPPDATA
  try {
    delete process.env.READ_WEB_PYTHON
    delete process.env.READ_WEB_PYTHON_PATH
    process.env.LOCALAPPDATA = localAppData
    const selectedDefault = await resolveSelectedPython({ repoRoot, configPath, platform: 'win32' })
    assert.equal(selectedDefault.executable, defaultPython, 'optimization gates did not prefer the stable external venv')

    const explicitPython = path.join(tempRoot, 'explicit-python.exe')
    await writeFile(explicitPython, 'explicit interpreter', 'utf8')
    process.env.READ_WEB_PYTHON = explicitPython
    const selectedExplicit = await resolveSelectedPython({ repoRoot, configPath, platform: 'win32' })
    assert.equal(selectedExplicit.executable, explicitPython, 'READ_WEB_PYTHON did not remain the canonical override')
  } finally {
    if (originalPython === undefined) delete process.env.READ_WEB_PYTHON
    else process.env.READ_WEB_PYTHON = originalPython
    if (originalPythonPath === undefined) delete process.env.READ_WEB_PYTHON_PATH
    else process.env.READ_WEB_PYTHON_PATH = originalPythonPath
    if (originalLocalAppData === undefined) delete process.env.LOCALAPPDATA
    else process.env.LOCALAPPDATA = originalLocalAppData
  }

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
