import { spawn } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { gateEnvironment, PythonRuntimeError, resolveSelectedPython } from './lib/python-runtime.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const delimiter = args.indexOf('--')
const options = delimiter >= 0 ? args.slice(0, delimiter) : args
const pythonArgs = delimiter >= 0 ? args.slice(delimiter + 1) : []
const configIndex = options.indexOf('--config')
const configPath = configIndex >= 0 ? options[configIndex + 1] || '' : ''
const cwdIndex = options.indexOf('--cwd')
const cwd = cwdIndex >= 0 ? path.resolve(repoRoot, options[cwdIndex + 1] || '') : repoRoot

if (!pythonArgs.length) {
  console.error('PYTHON_RUNTIME_COMMAND_FAILED[PYTHON_ARGUMENTS_REQUIRED]: expected Python arguments after --')
  process.exit(2)
}

try {
  const selected = await resolveSelectedPython({ repoRoot, configPath })
  const child = spawn(selected.executable, pythonArgs, {
    cwd,
    env: gateEnvironment(selected),
    stdio: 'inherit',
    windowsHide: true,
  })
  child.once('error', (error) => {
    console.error(`PYTHON_RUNTIME_COMMAND_FAILED[PYTHON_START_FAILED]: ${error.message}`)
    process.exit(2)
  })
  child.once('exit', (code, signal) => {
    if (signal) {
      console.error(`PYTHON_RUNTIME_COMMAND_FAILED[PYTHON_SIGNAL]: selected Python exited by ${signal}`)
      process.exit(2)
    }
    process.exit(code ?? 1)
  })
} catch (error) {
  const code = error instanceof PythonRuntimeError ? error.code : 'PYTHON_RUNTIME_RESOLUTION_FAILED'
  console.error(`PYTHON_RUNTIME_COMMAND_FAILED[${code}]: ${error.message}`)
  process.exit(2)
}
