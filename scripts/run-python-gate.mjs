import { spawn } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { gateEnvironment, PythonRuntimeError, resolveSelectedPython } from './lib/python-runtime.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const scriptIndex = args.findIndex((value) => value.toLowerCase().endsWith('.py'))
if (scriptIndex < 0) {
  console.error('PYTHON_RUNTIME_GATE_FAILED[PYTHON_SCRIPT_REQUIRED]: expected a Python script path')
  process.exit(2)
}

const script = path.resolve(repoRoot, args[scriptIndex])

function splitWrapperArguments(values) {
  const targetArgs = []
  let configPath = ''
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]
    if (value !== '--config') {
      targetArgs.push(value)
      continue
    }
    const next = values[index + 1]
    if (!next || next === '--config') {
      throw new PythonRuntimeError('RUNTIME_CONFIG_ARGUMENT_INVALID', '--config requires a RuntimeConfig path')
    }
    if (configPath) {
      throw new PythonRuntimeError('RUNTIME_CONFIG_ARGUMENT_DUPLICATE', 'run-python-gate accepts only one wrapper --config option')
    }
    configPath = next
    index += 1
  }
  return { configPath, targetArgs }
}

try {
  const { configPath, targetArgs } = splitWrapperArguments(args.slice(scriptIndex + 1))
  const selected = await resolveSelectedPython({ repoRoot, configPath })
  const child = spawn(selected.executable, [script, ...targetArgs], {
    cwd: repoRoot,
    env: gateEnvironment(selected),
    stdio: 'inherit',
    windowsHide: true,
  })
  child.once('error', (error) => {
    console.error(`PYTHON_RUNTIME_GATE_FAILED[PYTHON_START_FAILED]: ${error.message}`)
    process.exit(2)
  })
  child.once('exit', (code, signal) => {
    if (signal) {
      console.error(`PYTHON_RUNTIME_GATE_FAILED[PYTHON_SIGNAL]: selected Python exited by ${signal}`)
      process.exit(2)
    }
    process.exit(code ?? 1)
  })
} catch (error) {
  const code = error instanceof PythonRuntimeError ? error.code : 'PYTHON_RUNTIME_RESOLUTION_FAILED'
  console.error(`PYTHON_RUNTIME_GATE_FAILED[${code}]: ${error.message}`)
  process.exit(2)
}
